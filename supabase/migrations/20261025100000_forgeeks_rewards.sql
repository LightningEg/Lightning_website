-- For Geeks rewards pipeline (FG-05, FG-06 and the admin half of FG-09)
-- Proposal: docs/proposals/forgeeks-accounts-lightning-coins.md
--
-- What this adds, on top of 20261024190000_forgeeks_core.sql:
--   * Verified GitHub identity. A member links GitHub through Supabase Auth (linkIdentity). Triggers on
--     auth.identities copy the numeric GitHub id into public.github_links; sync_github_link() is the fallback.
--     A typed handle is never trusted.
--   * Claims. The workflows in LightningEg/Lightning record a claim when someone is assigned an issue; the
--     claim locks the reward version and amount. The claimant may not have an account yet, so a claim is keyed
--     by the numeric GitHub id and user_id is filled in when that id is linked.
--   * Merge awards. award_merge() pays an issue once, however many pull requests close it. Authors without a
--     linked account get a pending award that is settled automatically when they link.
--   * Feedback with a moderation queue; accepted feedback posts one feedback_award.
--   * The member task board and the owner's admin read helpers.
--
-- Money rules kept: every coin goes through public.award_coins (one award per source, idempotent), nothing is
-- paid twice on a webhook replay, and service-role functions are not callable by members.
--
-- Fine print (decisions, in one place):
--   * A zero-coin task pays nothing and writes no ledger row; merging its pull request still closes the offer.
--   * Awards are sourced by the ISSUE ('issue', 'Owner/Repo#n'), so a second pull request cannot pay again.
--   * An author who is not the claimant is paid the offer's current amount; the claimant is paid the locked one.
--   * The trigger on auth.identities never raises for a GitHub id that belongs to another member: a failing
--     trigger would break sign-in. The conflict is refused where the member can see it, in sync_github_link().
--   * Feedback limit: 5 submissions per member in any rolling 24 hours.

-- ---------------------------------------------------------------- claims keyed by GitHub id

alter table public.reward_claims
  add column github_id bigint,
  add column github_login text check (github_login is null or char_length(github_login) <= 100);
alter table public.reward_claims alter column user_id drop not null;
alter table public.reward_claims
  add constraint reward_claims_has_claimant check (user_id is not null or github_id is not null);
create index reward_claims_github on public.reward_claims (github_id) where github_id is not null;
comment on column public.reward_claims.github_id is
  'Numeric GitHub id of the person assigned the issue. user_id is filled when that id is linked to a member.';

-- ---------------------------------------------------------------- pending awards

-- A merged pull request whose author has not linked GitHub yet. Service role and the functions below only.
create table public.pending_awards (
  id bigint generated always as identity primary key,
  github_id bigint not null,
  github_login text not null check (char_length(github_login) <= 100),
  repository text not null,
  issue_number integer not null check (issue_number > 0),
  pr_number integer not null check (pr_number > 0),
  pr_title text not null check (char_length(pr_title) <= 200),
  pr_url text not null check (pr_url ~ '^https://'),
  amount integer not null check (amount > 0),
  source_type text not null default 'issue',
  source_id text not null,
  merged_at timestamptz not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  user_id uuid references auth.users (id) on delete set null,
  ledger_entry_id bigint references public.ledger_entries (id),
  unique (source_type, source_id)
);
create index pending_awards_github on public.pending_awards (github_id) where settled_at is null;
comment on table public.pending_awards is
  'Merge awards waiting for the author to link GitHub. Settled by private.settle_pending when that GitHub id is linked.';

-- ---------------------------------------------------------------- feedback

create table public.feedback_submissions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  context text check (char_length(context) <= 200),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'duplicate')),
  amount integer not null default 0 check (amount >= 0),
  ledger_entry_id bigint unique references public.ledger_entries (id),
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  note text check (char_length(note) <= 500),
  constraint feedback_award_shape check ((status = 'accepted' and amount > 0) = (ledger_entry_id is not null)),
  constraint feedback_pending_unreviewed check ((status = 'pending') = (reviewed_at is null))
);
create index feedback_user_created on public.feedback_submissions (user_id, created_at desc);
create index feedback_status_created on public.feedback_submissions (status, created_at);
comment on column public.feedback_submissions.note is
  'The reviewer''s note. The member can read it, so write it for them.';

-- ---------------------------------------------------------------- GitHub identity

-- The login GitHub reports for an identity (public information; for display only).
create function private.github_login_of(d jsonb, fallback text) returns text
language sql immutable set search_path = '' as $$
  select left(coalesce(nullif(d ->> 'user_name', ''), nullif(d ->> 'preferred_username', ''), fallback), 100);
$$;

-- Link a verified GitHub id to a member. Returns 'linked', 'unchanged', 'taken' (the id belongs to another
-- member) or 'user_has_other' (the member already has a different GitHub account linked).
create function private.link_github(p_user uuid, p_github_id bigint, p_login text) returns text
language plpgsql security definer set search_path = '' as $$
declare cur public.github_links;
begin
  -- One at a time per GitHub id, so a merge being awarded and a link being made cannot miss each other.
  perform pg_advisory_xact_lock(hashtextextended('github:' || p_github_id::text, 0));
  select * into cur from public.github_links where github_id = p_github_id and unlinked_at is null;
  if found then
    if cur.user_id <> p_user then return 'taken'; end if;
    if cur.github_login is distinct from p_login then
      update public.github_links set github_login = p_login where id = cur.id;
    end if;
    return 'unchanged';
  end if;
  if exists (select 1 from public.github_links where user_id = p_user and unlinked_at is null) then
    return 'user_has_other';
  end if;
  insert into public.github_links (user_id, github_id, github_login) values (p_user, p_github_id, p_login);
  return 'linked';
end $$;

-- Pay every pending award of this GitHub id to the member, once. Also gives earlier claims their member.
create function private.settle_pending(p_user uuid, p_github_id bigint) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r public.pending_awards;
  e public.ledger_entries;
  n integer := 0;
begin
  update public.reward_claims set user_id = p_user where github_id = p_github_id and user_id is null;
  for r in
    select * from public.pending_awards where github_id = p_github_id and settled_at is null order by id for update
  loop
    select * into e from public.ledger_entries
     where source_type = r.source_type and source_id = r.source_id and allocation_slot = 'primary'
       and kind = 'contribution_award';
    if not found then
      e := public.award_coins(
        p_user, 'contribution_award', r.amount, r.source_type, r.source_id,
        'Merged pull request #' || r.pr_number || ' for issue #' || r.issue_number,
        r.merged_at, 'primary',
        jsonb_build_object('repository', r.repository, 'issue_number', r.issue_number, 'pr_number', r.pr_number,
                           'title', r.pr_title, 'url', r.pr_url, 'merged_at', r.merged_at));
    end if;
    update public.pending_awards
       set settled_at = now(), user_id = e.user_id, ledger_entry_id = e.id
     where id = r.id;
    insert into public.audit_log (actor, action, target_type, target_id, detail)
    values (null, 'reward.settle', 'pending_award', r.id::text,
            jsonb_build_object('source', r.source_id, 'amount', r.amount, 'ledger_entry_id', e.id));
    n := n + 1;
  end loop;
  return n;
end $$;

create function private.github_identity_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare res text;
begin
  if new.provider_id ~ '^[0-9]{1,18}$' then
    res := private.link_github(new.user_id, new.provider_id::bigint,
                               private.github_login_of(new.identity_data, new.provider_id));
    if res in ('linked', 'unchanged') then
      begin
        perform private.settle_pending(new.user_id, new.provider_id::bigint);
      exception when others then
        -- The link stands; sync_github_link() settles on the next visit and shows the real error.
        raise warning 'settling pending awards failed: %', sqlerrm;
      end;
    end if;
    -- 'taken' and 'user_has_other': nothing is linked; sync_github_link() tells the member why.
  end if;
  return null;
end $$;
create trigger on_auth_github_identity_changed
  after insert or update of identity_data on auth.identities
  for each row when (new.provider = 'github')
  execute function private.github_identity_changed();

create function private.github_identity_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.provider_id ~ '^[0-9]{1,18}$' then
    -- Only this member's own link: another member's link to the same id is never touched.
    update public.github_links set unlinked_at = now()
     where user_id = old.user_id and github_id = old.provider_id::bigint and unlinked_at is null;
  end if;
  return null;
end $$;
create trigger on_auth_github_identity_removed
  after delete on auth.identities
  for each row when (old.provider = 'github')
  execute function private.github_identity_removed();

-- Fallback and refresh: make public.github_links match this member's GitHub identity in Supabase Auth.
-- Returns the active link as {github_id, github_login, linked_at}, or null when there is none.
create function public.sync_github_link() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ident record;
  res text;
  l public.github_links;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  select i.provider_id, i.identity_data into ident
    from auth.identities i
   where i.user_id = uid and i.provider = 'github' and i.provider_id ~ '^[0-9]{1,18}$'
   order by i.created_at desc nulls last
   limit 1;
  if not found then
    update public.github_links set unlinked_at = now() where user_id = uid and unlinked_at is null;
    return null;
  end if;
  res := private.link_github(uid, ident.provider_id::bigint, private.github_login_of(ident.identity_data, ident.provider_id));
  if res = 'taken' then
    raise exception 'this GitHub account is already linked to another member' using errcode = '23505';
  elsif res = 'user_has_other' then
    raise exception 'unlink your current GitHub account before linking another' using errcode = '23505';
  end if;
  perform private.settle_pending(uid, ident.provider_id::bigint);
  select * into l from public.github_links where user_id = uid and unlinked_at is null;
  return jsonb_build_object('github_id', l.github_id, 'github_login', l.github_login, 'linked_at', l.linked_at);
end $$;

-- ---------------------------------------------------------------- claims (service role)

create function public.record_claim(p_repo text, p_issue integer, p_github_id bigint, p_github_login text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  repo public.repositories;
  offer public.reward_offers;
  v public.reward_offer_versions;
  c public.reward_claims;
  uid uuid;
begin
  if p_github_id is null or p_github_id <= 0 then raise exception 'github id required'; end if;
  select * into repo from public.repositories where lower(full_name) = lower(p_repo) and eligible;
  if not found then return jsonb_build_object('status', 'ineligible_repository'); end if;
  -- The offer row is the lock: two people taking one issue at once are served one at a time.
  select * into offer from public.reward_offers
   where repository_id = repo.id and issue_number = p_issue and status = 'open' for update;
  if not found then return jsonb_build_object('status', 'no_offer'); end if;
  select * into c from public.reward_claims where offer_id = offer.id and status = 'active';
  if found then
    return jsonb_build_object('status', case when c.github_id = p_github_id then 'already_yours' else 'taken' end,
                              'claim_id', c.id, 'amount', c.amount_locked, 'version', c.offer_version);
  end if;
  select * into v from public.reward_offer_versions where offer_id = offer.id and version = offer.current_version;
  select l.user_id into uid from public.github_links l where l.github_id = p_github_id and l.unlinked_at is null;
  insert into public.reward_claims (offer_id, offer_version, user_id, github_id, github_login, amount_locked)
  values (offer.id, v.version, uid, p_github_id, left(nullif(btrim(p_github_login), ''), 100), v.amount)
  returning * into c;
  return jsonb_build_object('status', 'claimed', 'claim_id', c.id, 'amount', c.amount_locked, 'version', c.offer_version);
end $$;

create function public.release_claim(p_repo text, p_issue integer, p_github_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cid bigint;
begin
  update public.reward_claims c
     set status = 'dropped', closed_at = now()
    from public.reward_offers o, public.repositories r
   where c.offer_id = o.id and r.id = o.repository_id
     and lower(r.full_name) = lower(p_repo) and o.issue_number = p_issue
     and c.status = 'active' and c.github_id = p_github_id
  returning c.id into cid;
  return jsonb_build_object('status', case when cid is null then 'none' else 'released' end);
end $$;

-- ---------------------------------------------------------------- merge awards (service role)

-- Pay the issues a merged pull request closed. Safe to call again with the same pull request.
-- Returns {status, repository, pr, results: [{issue, status, amount?, ledger_entry_id?}]}.
-- Issue statuses: awarded, pending, already_awarded, already_pending, closed, zero_reward, no_offer.
create function public.award_merge(
  p_repo text, p_pr integer, p_title text, p_url text, p_merged_at timestamptz,
  p_author_github_id bigint, p_author_login text, p_issues integer[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  repo public.repositories;
  merged timestamptz := coalesce(p_merged_at, now());
  ptitle text := left(coalesce(nullif(btrim(p_title), ''), 'Pull request #' || p_pr), 200);
  login text := left(coalesce(nullif(btrim(p_author_login), ''), p_author_github_id::text), 100);
  n integer;
  offer public.reward_offers;
  v public.reward_offer_versions;
  claim public.reward_claims;
  e public.ledger_entries;
  src text;
  amt integer;
  uid uuid;
  res jsonb;
  results jsonb := '[]'::jsonb;
begin
  if p_pr is null or p_pr <= 0 then raise exception 'pull request number required'; end if;
  if p_author_github_id is null or p_author_github_id <= 0 then raise exception 'author github id required'; end if;
  if p_url is null or p_url !~ '^https://' then raise exception 'pull request url must start with https://'; end if;
  select * into repo from public.repositories where lower(full_name) = lower(p_repo) and eligible;
  if not found then
    return jsonb_build_object('status', 'ineligible_repository', 'pr', p_pr, 'results', results);
  end if;
  if repo.rewards_start_at is not null and merged < repo.rewards_start_at then
    return jsonb_build_object('status', 'before_rewards_start', 'repository', repo.full_name, 'pr', p_pr, 'results', results);
  end if;
  -- Same lock as linking, so a link made while we run is seen by one side or the other.
  perform pg_advisory_xact_lock(hashtextextended('github:' || p_author_github_id::text, 0));

  for n in select distinct x from unnest(coalesce(p_issues, '{}'::integer[])) x where x > 0 order by x loop
    src := repo.full_name || '#' || n;
    select * into offer from public.reward_offers where repository_id = repo.id and issue_number = n for update;
    if not found then
      res := jsonb_build_object('issue', n, 'status', 'no_offer');
    else
      select * into e from public.ledger_entries
       where source_type = 'issue' and source_id = src and allocation_slot = 'primary' and kind = 'contribution_award';
      if found then
        res := jsonb_build_object('issue', n, 'status', 'already_awarded', 'ledger_entry_id', e.id);
      elsif exists (select 1 from public.pending_awards where source_type = 'issue' and source_id = src) then
        res := jsonb_build_object('issue', n, 'status', 'already_pending');
      elsif offer.status <> 'open' then
        res := jsonb_build_object('issue', n, 'status', 'closed');
      else
        select * into v from public.reward_offer_versions where offer_id = offer.id and version = offer.current_version;
        select * into claim from public.reward_claims
         where offer_id = offer.id and status = 'active' and github_id = p_author_github_id;
        amt := case when found then claim.amount_locked else v.amount end;
        if amt <= 0 then
          res := jsonb_build_object('issue', n, 'status', 'zero_reward');
        else
          select l.user_id into uid from public.github_links l
           where l.github_id = p_author_github_id and l.unlinked_at is null;
          if uid is not null then
            e := public.award_coins(
              uid, 'contribution_award', amt, 'issue', src,
              'Merged pull request #' || p_pr || ' for issue #' || n, merged, 'primary',
              jsonb_build_object('repository', repo.full_name, 'issue_number', n, 'pr_number', p_pr,
                                 'title', ptitle, 'url', p_url, 'merged_at', merged));
            res := jsonb_build_object('issue', n, 'status', 'awarded', 'amount', amt, 'ledger_entry_id', e.id);
            insert into public.audit_log (actor, action, target_type, target_id, detail)
            values (null, 'reward.award', 'reward_offer', offer.id::text,
                    jsonb_build_object('source', src, 'pr', p_pr, 'amount', amt, 'ledger_entry_id', e.id));
          else
            insert into public.pending_awards
              (github_id, github_login, repository, issue_number, pr_number, pr_title, pr_url, amount,
               source_type, source_id, merged_at)
            values (p_author_github_id, login, repo.full_name, n, p_pr, ptitle, p_url, amt, 'issue', src, merged);
            res := jsonb_build_object('issue', n, 'status', 'pending', 'amount', amt);
            insert into public.audit_log (actor, action, target_type, target_id, detail)
            values (null, 'reward.pending', 'reward_offer', offer.id::text,
                    jsonb_build_object('source', src, 'pr', p_pr, 'amount', amt));
          end if;
        end if;
        -- The task is done: close the offer and its claims (the author's completed, anyone else's expired).
        update public.reward_offers set status = 'closed' where id = offer.id;
        update public.reward_claims
           set status = case when github_id = p_author_github_id then 'completed' else 'expired' end,
               closed_at = now()
         where offer_id = offer.id and status = 'active';
      end if;
    end if;
    results := results || jsonb_build_array(res);
  end loop;
  return jsonb_build_object('status', 'ok', 'repository', repo.full_name, 'pr', p_pr, 'results', results);
end $$;

-- A merged pull request from someone who cannot earn coins (the owner, a bot): close the offers it finished,
-- pay nothing, so they do not stay on the task board.
create function public.close_rewarded_issues(p_repo text, p_pr integer, p_issues integer[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  repo public.repositories;
  n integer;
  offer public.reward_offers;
  closed integer[] := '{}';
begin
  select * into repo from public.repositories where lower(full_name) = lower(p_repo) and eligible;
  if not found then return jsonb_build_object('status', 'ineligible_repository', 'closed', closed); end if;
  for n in select distinct x from unnest(coalesce(p_issues, '{}'::integer[])) x where x > 0 order by x loop
    select * into offer from public.reward_offers
     where repository_id = repo.id and issue_number = n and status = 'open' for update;
    if found then
      update public.reward_offers set status = 'closed' where id = offer.id;
      update public.reward_claims set status = 'expired', closed_at = now() where offer_id = offer.id and status = 'active';
      insert into public.audit_log (actor, action, target_type, target_id, detail)
      values (null, 'reward.skip', 'reward_offer', offer.id::text,
              jsonb_build_object('source', repo.full_name || '#' || n, 'pr', p_pr));
      closed := closed || n;
    end if;
  end loop;
  return jsonb_build_object('status', 'ok', 'closed', closed);
end $$;

-- ---------------------------------------------------------------- feedback

create function public.submit_feedback(p_body text, p_context text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  b text := btrim(coalesce(p_body, ''));
  c text := nullif(btrim(coalesce(p_context, '')), '');
  f public.feedback_submissions;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  if char_length(b) not between 1 and 4000 then
    raise exception 'feedback must be 1 to 4000 characters' using errcode = '22023';
  end if;
  if char_length(c) > 200 then
    raise exception 'context must be at most 200 characters' using errcode = '22023';
  end if;
  -- One member's submissions are counted one at a time, so parallel requests cannot pass the limit together.
  perform pg_advisory_xact_lock(hashtextextended('feedback:' || uid::text, 0));
  if (select count(*) from public.feedback_submissions
       where user_id = uid and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'at most 5 feedback messages per day' using errcode = '54000';
  end if;
  insert into public.feedback_submissions (user_id, body, context) values (uid, b, c) returning * into f;
  return jsonb_build_object('id', f.id, 'status', f.status, 'created_at', f.created_at);
end $$;

create function public.admin_review_feedback(p_id bigint, p_status text, p_amount integer default 0, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f public.feedback_submissions;
  e public.ledger_entries;
  amt integer := coalesce(p_amount, 0);
  nt text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'administrator only' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('accepted', 'rejected', 'duplicate') then
    raise exception 'status must be accepted, rejected or duplicate' using errcode = '22023';
  end if;
  if p_status <> 'accepted' then amt := 0; end if;
  if amt < 0 or amt > 10000 then
    raise exception 'amount must be between 0 and 10000' using errcode = '22023';
  end if;
  if char_length(nt) > 500 then
    raise exception 'note must be at most 500 characters' using errcode = '22023';
  end if;
  select * into f from public.feedback_submissions where id = p_id for update;
  if not found then raise exception 'feedback not found'; end if;
  if f.status = p_status and f.amount = amt and f.note is not distinct from nt then
    return jsonb_build_object('id', f.id, 'status', f.status, 'amount', f.amount, 'ledger_entry_id', f.ledger_entry_id);
  end if;
  if f.ledger_entry_id is not null then
    raise exception 'coins were already awarded for this feedback: correct the ledger entry instead';
  end if;
  if amt > 0 then
    e := public.award_coins(f.user_id, 'feedback_award', amt, 'feedback', f.id::text, 'Feedback accepted', now(), 'primary', null);
  end if;
  update public.feedback_submissions
     set status = p_status, amount = amt, note = nt, reviewed_by = auth.uid(), reviewed_at = now(),
         ledger_entry_id = e.id
   where id = f.id
  returning * into f;
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (auth.uid(), 'feedback.review', 'feedback', f.id::text,
          jsonb_build_object('status', f.status, 'amount', f.amount, 'note', f.note, 'ledger_entry_id', f.ledger_entry_id));
  return jsonb_build_object('id', f.id, 'status', f.status, 'amount', f.amount, 'ledger_entry_id', f.ledger_entry_id);
end $$;

-- ---------------------------------------------------------------- task board (members)

-- Open, paid tasks. Says whether someone holds a claim and whether it is the caller's; never who.
create function public.task_board() returns table (
  repository text, issue_number integer, title text, amount integer, acceptance_criteria text,
  version integer, claimed boolean, mine boolean, locked_amount integer
)
language plpgsql stable security definer set search_path = '' as $$
declare gid bigint;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  select l.github_id into gid from public.github_links l where l.user_id = auth.uid() and l.unlinked_at is null;
  return query
  select r.full_name, o.issue_number, v.title, v.amount, v.acceptance_criteria, v.version,
         (c.id is not null),
         (c.id is not null and gid is not null and c.github_id = gid),
         case when c.id is not null and gid is not null and c.github_id = gid then c.amount_locked end
    from public.reward_offers o
    join public.repositories r on r.id = o.repository_id and r.eligible
    join public.reward_offer_versions v on v.offer_id = o.id and v.version = o.current_version
    left join public.reward_claims c on c.offer_id = o.id and c.status = 'active'
   where o.status = 'open' and v.amount > 0
   order by o.issue_number desc;
end $$;

-- ---------------------------------------------------------------- admin read helpers and offer status

create function public.admin_task_overview() returns table (
  offer_id bigint, repository text, issue_number integer, status text, version integer, amount integer,
  title text, acceptance_criteria text, edited_at timestamptz,
  claim_status text, claim_login text, claim_amount integer, claimed_at timestamptz,
  award text, award_amount integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'administrator only' using errcode = '42501';
  end if;
  return query
  select o.id, r.full_name, o.issue_number, o.status, v.version, v.amount, v.title, v.acceptance_criteria, v.edited_at,
         c.status, c.github_login, c.amount_locked, c.claimed_at,
         case when l.id is not null then 'paid' when pa.id is not null then 'pending' end,
         coalesce(l.contribution_delta, pa.amount)
    from public.reward_offers o
    join public.repositories r on r.id = o.repository_id
    join public.reward_offer_versions v on v.offer_id = o.id and v.version = o.current_version
    left join lateral (
      select c2.status, c2.github_login, c2.amount_locked, c2.claimed_at
        from public.reward_claims c2 where c2.offer_id = o.id
       order by (c2.status = 'active') desc, c2.claimed_at desc, c2.id desc limit 1) c on true
    left join lateral (
      select le.id, le.contribution_delta from public.ledger_entries le
       where le.source_type = 'issue' and le.source_id = r.full_name || '#' || o.issue_number
         and le.allocation_slot = 'primary' and le.kind = 'contribution_award' limit 1) l on true
    left join lateral (
      select p.id, p.amount from public.pending_awards p
       where p.source_type = 'issue' and p.source_id = r.full_name || '#' || o.issue_number
         and p.settled_at is null limit 1) pa on true
   order by (o.status = 'open') desc, o.issue_number desc;
end $$;

create function public.admin_pending_awards() returns table (
  id bigint, github_login text, github_id bigint, repository text, issue_number integer, pr_number integer,
  pr_title text, pr_url text, amount integer, merged_at timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'administrator only' using errcode = '42501';
  end if;
  return query
  select p.id, p.github_login, p.github_id, p.repository, p.issue_number, p.pr_number, p.pr_title, p.pr_url,
         p.amount, p.merged_at, p.created_at
    from public.pending_awards p where p.settled_at is null order by p.created_at, p.id;
end $$;

create function public.admin_feedback_queue(p_status text default 'pending', p_limit integer default 100)
returns table (
  id bigint, display_name text, body text, context text, status text, amount integer, note text,
  created_at timestamptz, reviewed_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'administrator only' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'accepted', 'rejected', 'duplicate', 'all') then
    raise exception 'status must be pending, accepted, rejected, duplicate or all' using errcode = '22023';
  end if;
  return query
  select f.id, m.display_name, f.body, f.context, f.status, f.amount, f.note, f.created_at, f.reviewed_at
    from public.feedback_submissions f
    left join public.member_profiles m on m.user_id = f.user_id
   where p_status = 'all' or f.status = p_status
   order by case when f.status = 'pending' then f.created_at end asc nulls last, f.created_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- Close an offer that will never be merged (the issue was dropped), or open it again.
create function public.admin_set_offer_status(p_offer_id bigint, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'administrator only' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('open', 'closed') then
    raise exception 'status must be open or closed' using errcode = '22023';
  end if;
  update public.reward_offers set status = p_status where id = p_offer_id and status <> p_status;
  if not found then
    if not exists (select 1 from public.reward_offers where id = p_offer_id) then
      raise exception 'offer not found';
    end if;
    return; -- already in that state: no change, no audit row
  end if;
  if p_status = 'closed' then
    update public.reward_claims set status = 'expired', closed_at = now() where offer_id = p_offer_id and status = 'active';
  end if;
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (auth.uid(), 'reward.offer_status', 'reward_offer', p_offer_id::text, jsonb_build_object('status', p_status));
end $$;

-- ---------------------------------------------------------------- row level security and privileges

alter table public.pending_awards enable row level security;      -- no policy: service role and the functions above
alter table public.feedback_submissions enable row level security;
create policy feedback_own_select on public.feedback_submissions for select to authenticated
  using (user_id = auth.uid());

-- Members read their own feedback (never who reviewed it); every write goes through submit_feedback.
grant select (id, body, context, status, amount, note, created_at, reviewed_at)
  on public.feedback_submissions to authenticated;
grant all on public.pending_awards, public.feedback_submissions to service_role;
grant all on all sequences in schema public to service_role;

revoke all on function
  public.sync_github_link(), public.record_claim(text, integer, bigint, text),
  public.release_claim(text, integer, bigint),
  public.award_merge(text, integer, text, text, timestamptz, bigint, text, integer[]),
  public.close_rewarded_issues(text, integer, integer[]),
  public.submit_feedback(text, text), public.admin_review_feedback(bigint, text, integer, text),
  public.task_board(), public.admin_task_overview(), public.admin_pending_awards(),
  public.admin_feedback_queue(text, integer), public.admin_set_offer_status(bigint, text)
  from public, anon, authenticated;

grant execute on function public.sync_github_link() to authenticated;
grant execute on function public.submit_feedback(text, text) to authenticated;
grant execute on function public.task_board() to authenticated;
grant execute on function public.admin_review_feedback(bigint, text, integer, text) to authenticated;
grant execute on function public.admin_task_overview() to authenticated;
grant execute on function public.admin_pending_awards() to authenticated;
grant execute on function public.admin_feedback_queue(text, integer) to authenticated;
grant execute on function public.admin_set_offer_status(bigint, text) to authenticated;

-- Trusted server code only.
grant execute on function public.record_claim(text, integer, bigint, text) to service_role;
grant execute on function public.release_claim(text, integer, bigint) to service_role;
grant execute on function public.award_merge(text, integer, text, text, timestamptz, bigint, text, integer[]) to service_role;
grant execute on function public.close_rewarded_issues(text, integer, integer[]) to service_role;
grant execute on function public.sync_github_link(), public.submit_feedback(text, text), public.task_board(),
  public.admin_review_feedback(bigint, text, integer, text), public.admin_task_overview(),
  public.admin_pending_awards(), public.admin_feedback_queue(text, integer),
  public.admin_set_offer_status(bigint, text) to service_role;

notify pgrst, 'reload schema';
