begin;
-- 8Q part 1: every merged pull request counts. record_merge() gives recognition points by size band to the author of a
-- merged, eligible, non-owner pull request, closing an issue or not, once per pull request. Coins still come only from
-- offers (award_merge). Points for an author who has not linked GitHub are held in pending_awards, like coins are, and
-- paid by private.settle_pending when the GitHub id is linked.

-- A pending row is now either coins for an issue (amount, issue_number) or recognition points for a pull request.
alter table public.pending_awards add column points integer check (points is null or points > 0);
alter table public.pending_awards alter column amount drop not null;
alter table public.pending_awards alter column issue_number drop not null;
alter table public.pending_awards drop constraint pending_awards_amount_check;
alter table public.pending_awards add constraint pending_awards_one_kind check (
  (points is null and amount is not null and amount > 0 and issue_number is not null)
  or (points is not null and amount is null and issue_number is null));

-- The owner's console still lists coin awards only.
create or replace function public.admin_pending_awards() returns table (
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
    from public.pending_awards p where p.settled_at is null and p.points is null order by p.created_at, p.id;
end $$;

-- Pay every pending row of this GitHub id to the member, once: coins as before, recognition points for pull requests.
create or replace function private.settle_pending(p_user uuid, p_github_id bigint) returns integer
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
    if r.points is not null then
      e := private.post_ledger(p_user, 'recognition', r.points, 0, r.source_type, r.source_id, 'primary',
                               'Merged pull request #' || r.pr_number, 'merge:' || r.source_id, r.merged_at, null, null);
    else
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
    end if;
    update public.pending_awards
       set settled_at = now(), user_id = e.user_id, ledger_entry_id = e.id
     where id = r.id;
    insert into public.audit_log (actor, action, target_type, target_id, detail)
    values (null, 'reward.settle', 'pending_award', r.id::text,
            jsonb_build_object('source', r.source_id, 'amount', coalesce(r.amount, r.points), 'ledger_entry_id', e.id));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Service role only (the workflow). p_lines is additions plus deletions without lockfiles and generated files.
-- Statuses: recorded, pending, already_recorded, already_pending, ineligible_repository, before_rewards_start, owner.
create function public.record_merge(
  p_repo text, p_pr integer, p_title text, p_url text, p_merged_at timestamptz,
  p_author_github_id bigint, p_author_login text, p_lines integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  repo public.repositories;
  merged timestamptz := coalesce(p_merged_at, now());
  ptitle text := left(coalesce(nullif(btrim(p_title), ''), 'Pull request #' || p_pr), 200);
  login text := left(coalesce(nullif(btrim(p_author_login), ''), p_author_github_id::text), 100);
  src text;
  pts integer;
  uid uuid;
  e public.ledger_entries;
begin
  if p_pr is null or p_pr <= 0 then raise exception 'pull request number required'; end if;
  if p_author_github_id is null or p_author_github_id <= 0 then raise exception 'author github id required'; end if;
  if p_url is null or p_url !~ '^https://' then raise exception 'pull request url must start with https://'; end if;
  if p_lines is null or p_lines < 0 then raise exception 'changed lines required'; end if;
  select * into repo from public.repositories where lower(full_name) = lower(p_repo) and eligible;
  if not found then return jsonb_build_object('status', 'ineligible_repository', 'pr', p_pr); end if;
  if repo.rewards_start_at is not null and merged < repo.rewards_start_at then
    return jsonb_build_object('status', 'before_rewards_start', 'repository', repo.full_name, 'pr', p_pr);
  end if;
  pts := case when p_lines < 50 then 20 when p_lines < 400 then 50 else 100 end;
  src := repo.full_name || '#' || p_pr;
  -- Same lock as linking and award_merge, so a link made while we run is seen by one side or the other.
  perform pg_advisory_xact_lock(hashtextextended('github:' || p_author_github_id::text, 0));
  select l.user_id into uid from public.github_links l where l.github_id = p_author_github_id and l.unlinked_at is null;
  -- The owner and other administrators are never recognised (the workflow also filters them).
  if uid is not null and exists (select 1 from public.admin_roles where user_id = uid) then
    return jsonb_build_object('status', 'owner', 'repository', repo.full_name, 'pr', p_pr);
  end if;
  select * into e from public.ledger_entries where idempotency_key = 'merge:' || src;
  if found then return jsonb_build_object('status', 'already_recorded', 'repository', repo.full_name, 'pr', p_pr, 'points', e.contribution_delta); end if;
  if exists (select 1 from public.pending_awards where source_type = 'pull_request' and source_id = src) then
    return jsonb_build_object('status', 'already_pending', 'repository', repo.full_name, 'pr', p_pr);
  end if;
  if uid is not null then
    e := private.post_ledger(uid, 'recognition', pts, 0, 'pull_request', src, 'primary',
                             'Merged pull request #' || p_pr, 'merge:' || src, merged, null, null);
    insert into public.audit_log (actor, action, target_type, target_id, detail)
    values (null, 'merge.record', 'pull_request', src,
            jsonb_build_object('pr', p_pr, 'points', pts, 'lines', p_lines, 'ledger_entry_id', e.id));
    return jsonb_build_object('status', 'recorded', 'repository', repo.full_name, 'pr', p_pr, 'points', pts, 'ledger_entry_id', e.id);
  end if;
  insert into public.pending_awards
    (github_id, github_login, repository, pr_number, pr_title, pr_url, points, source_type, source_id, merged_at)
  values (p_author_github_id, login, repo.full_name, p_pr, ptitle, p_url, pts, 'pull_request', src, merged);
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (null, 'merge.pending', 'pull_request', src, jsonb_build_object('pr', p_pr, 'points', pts, 'lines', p_lines));
  return jsonb_build_object('status', 'pending', 'repository', repo.full_name, 'pr', p_pr, 'points', pts);
end $$;

revoke all on function public.record_merge(text, integer, text, text, timestamptz, bigint, text, integer) from public, anon, authenticated;
grant execute on function public.record_merge(text, integer, text, text, timestamptz, bigint, text, integer) to service_role;
commit;
