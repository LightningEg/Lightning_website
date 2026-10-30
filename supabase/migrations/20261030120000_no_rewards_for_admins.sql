begin;
-- The owner and other administrators are never rewarded, on the pending path too (owner, 2026-10-30).
--
-- The rewards workflow skipped authors GitHub labels OWNER or MEMBER, but the owner's account reads COLLABORATOR
-- on LightningEg/Lightning, so every pull request merged under it (the owner's and the AI sessions') was held as a
-- pending award for that GitHub id. record_merge and award_merge refuse an administrator only once the id is
-- linked; when the owner signed in with GitHub, settle_pending paid the whole backlog. Now:
--   * settle_pending closes an administrator's pending rows without paying them (audited as reward.void_admin);
--   * what an administrator was already paid stays (owner, 2026-10-30: keep my credits);
--   * the workflow also skips any author with admin or maintain permission on the repository.

create or replace function private.settle_pending(p_user uuid, p_github_id bigint) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r public.pending_awards;
  e public.ledger_entries;
  n integer := 0;
  admin boolean := exists (select 1 from public.admin_roles where user_id = p_user);
begin
  update public.reward_claims set user_id = p_user where github_id = p_github_id and user_id is null;
  for r in
    select * from public.pending_awards where github_id = p_github_id and settled_at is null order by id for update
  loop
    if admin then
      update public.pending_awards set settled_at = now(), user_id = p_user where id = r.id;
      insert into public.audit_log (actor, action, target_type, target_id, detail)
      values (null, 'reward.void_admin', 'pending_award', r.id::text,
              jsonb_build_object('source', r.source_id, 'amount', coalesce(r.amount, r.points)));
      continue;
    end if;
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

-- Close what is still pending for an administrator's linked GitHub id.
do $$
declare r record;
begin
  for r in
    select p.id, p.source_id, coalesce(p.amount, p.points) as amt, l.user_id
      from public.pending_awards p
      join public.github_links l on l.github_id = p.github_id and l.unlinked_at is null
     where p.settled_at is null and exists (select 1 from public.admin_roles a where a.user_id = l.user_id)
  loop
    update public.pending_awards set settled_at = now(), user_id = r.user_id where id = r.id;
    insert into public.audit_log (actor, action, target_type, target_id, detail)
    values (null, 'reward.void_admin', 'pending_award', r.id::text, jsonb_build_object('source', r.source_id, 'amount', r.amt));
  end loop;
end $$;

commit;
