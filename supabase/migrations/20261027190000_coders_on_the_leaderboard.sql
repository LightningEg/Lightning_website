begin;
-- 8Q part 2: the leaderboard advertises who built what. A recognised merge now also writes the member's contributions row
-- (title and link, like a paid one), and leaderboard() returns the GitHub login, the last merge, merges this month and
-- the portfolio link. The earlier columns and their order are unchanged.

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
      insert into public.contributions (user_id, ledger_entry_id, repository, pr_number, title, url, merged_at)
      values (p_user, e.id, r.repository, r.pr_number, r.pr_title, r.pr_url, r.merged_at) on conflict (ledger_entry_id) do nothing;
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

create or replace function public.record_merge(
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
    insert into public.contributions (user_id, ledger_entry_id, repository, pr_number, title, url, merged_at)
    values (uid, e.id, repo.full_name, p_pr, ptitle, p_url, merged) on conflict (ledger_entry_id) do nothing;
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

drop function public.leaderboard(text, integer);
create function public.leaderboard(p_period text default 'all', p_limit integer default 50)
returns table(rank bigint, display_name text, avatar_url text, contribution_count bigint, score bigint,
  frame_item_id text, badge_item_id text, banner_item_id text, name_item_id text,
  github_login text, last_merge_title text, last_merge_url text, merges_month bigint, portfolio_url text)
language plpgsql stable security definer set search_path = '' as $$
declare since timestamptz; month_start timestamptz;
begin
 if p_period not in('all','month') then raise exception 'period must be all or month';end if;
 month_start:=date_trunc('month',now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo';
 since:=case when p_period='month' then month_start else '-infinity'::timestamptz end;
 return query
 with scores as(
  select m.user_id as uid,m.display_name as dn,m.avatar_url as av,
   case when m.visibility='public' and m.show_work then m.portfolio_url end as pf,
   count(*) filter(where l.contribution_delta>0) as cnt,sum(l.contribution_delta)::bigint as sc
  from public.ledger_entries l join public.member_profiles m on m.user_id=l.user_id
  where m.show_on_leaderboard and m.adult_confirmed and not m.suspended and l.earned_at>=since
  group by m.user_id,m.display_name,m.avatar_url,m.visibility,m.show_work,m.portfolio_url having sum(l.contribution_delta)>0)
 select(rank() over(order by s.sc desc))::bigint,s.dn,s.av,s.cnt,s.sc,
  (select e.item_id from public.equipped_items e where e.user_id=s.uid and e.slot='frame'),
  (select e.item_id from public.equipped_items e where e.user_id=s.uid and e.slot='badge'),
  (select e.item_id from public.equipped_items e where e.user_id=s.uid and e.slot='banner'),
  (select e.item_id from public.equipped_items e where e.user_id=s.uid and e.slot='name'),
  (select g.github_login from public.github_links g where g.user_id=s.uid and g.unlinked_at is null),
  (select c.title from public.contributions c where c.user_id=s.uid and not c.hidden order by c.merged_at desc nulls last, c.id desc limit 1),
  (select c.url from public.contributions c where c.user_id=s.uid and not c.hidden order by c.merged_at desc nulls last, c.id desc limit 1),
  (select count(*) from public.contributions c where c.user_id=s.uid and not c.hidden and c.merged_at>=month_start),
  s.pf
 from scores s order by 1,s.dn limit least(greatest(p_limit,1),100);
end $$;
revoke all on function public.leaderboard(text,integer) from public;
grant execute on function public.leaderboard(text,integer) to anon, authenticated, service_role;
commit;
