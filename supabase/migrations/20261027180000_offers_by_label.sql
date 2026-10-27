begin;
-- 8Q part 2: an issue labelled coins:<n> by someone with write access publishes its offer (the workflow checks the
-- labeler; these functions are service role only). The versioning is publish_reward's own, moved into
-- private.publish_offer so there is one copy of it.

create function private.publish_offer(p_repo text, p_issue integer, p_amount integer, p_criteria text, p_title text, p_actor uuid)
returns public.reward_offer_versions
language plpgsql security definer set search_path = '' as $$
declare
  repo_id bigint;
  offer public.reward_offers;
  v public.reward_offer_versions;
begin
  select id into repo_id from public.repositories where lower(full_name) = lower(p_repo) and eligible;
  if repo_id is null then raise exception 'repository is not eligible'; end if;
  insert into public.reward_offers (repository_id, issue_number)
  values (repo_id, p_issue)
  on conflict (repository_id, issue_number)
    do update set current_version = public.reward_offers.current_version + 1
  returning * into offer;
  insert into public.reward_offer_versions
    (offer_id, version, amount, title, acceptance_criteria, edited_by)
  values (offer.id, offer.current_version, p_amount, p_title, p_criteria, p_actor)
  returning * into v;
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (p_actor, 'reward.publish', 'reward_offer', offer.id::text,
          jsonb_build_object('repo', p_repo, 'issue', p_issue, 'amount', p_amount, 'version', v.version));
  return v;
end $$;
revoke all on function private.publish_offer(text, integer, integer, text, text, uuid) from public, anon, authenticated;

create or replace function public.publish_reward(
  p_repo text, p_issue integer, p_amount integer, p_criteria text, p_title text default null
) returns public.reward_offer_versions
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'administrator only' using errcode = '42501';
  end if;
  return private.publish_offer(p_repo, p_issue, p_amount, p_criteria, p_title, auth.uid());
end $$;

-- Statuses: published, updated, unchanged, reopened, already_awarded, ineligible_repository.
create function public.publish_offer_from_label(
  p_repo text, p_issue integer, p_amount integer, p_title text, p_url text, p_by_login text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  repo public.repositories;
  offer public.reward_offers;
  cur public.reward_offer_versions;
  v public.reward_offer_versions;
  src text;
  outcome text;
begin
  if p_issue is null or p_issue <= 0 then raise exception 'issue number required'; end if;
  if p_amount is null or p_amount not between 1 and 5000 then raise exception 'amount must be 1 to 5000'; end if;
  if p_url is null or p_url !~ '^https://' then raise exception 'issue url must start with https://'; end if;
  select * into repo from public.repositories where lower(full_name) = lower(p_repo) and eligible;
  if not found then return jsonb_build_object('status', 'ineligible_repository', 'issue', p_issue); end if;
  src := repo.full_name || '#' || p_issue;
  -- one label event at a time per issue
  perform pg_advisory_xact_lock(hashtextextended('offer:' || src, 0));
  select * into offer from public.reward_offers where repository_id = repo.id and issue_number = p_issue for update;
  if found then
    if exists (select 1 from public.ledger_entries where source_type = 'issue' and source_id = src
                and allocation_slot = 'primary' and kind = 'contribution_award')
       or exists (select 1 from public.pending_awards where source_type = 'issue' and source_id = src) then
      return jsonb_build_object('status', 'already_awarded', 'issue', p_issue);
    end if;
    select * into cur from public.reward_offer_versions where offer_id = offer.id and version = offer.current_version;
    if cur.amount = p_amount and offer.status = 'open' then
      return jsonb_build_object('status', 'unchanged', 'issue', p_issue, 'amount', p_amount);
    end if;
    outcome := case when offer.status = 'closed' then 'reopened' else 'updated' end;
  else
    outcome := 'published';
  end if;
  v := private.publish_offer(repo.full_name, p_issue, p_amount,
         'Done when a pull request that closes this issue is merged and accepted. Details: ' || p_url,
         left(nullif(btrim(p_title), ''), 200), null);
  update public.reward_offers set status = 'open' where repository_id = repo.id and issue_number = p_issue and status <> 'open';
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (null, 'reward.label', 'reward_offer', src,
          jsonb_build_object('by', left(coalesce(p_by_login, ''), 100), 'amount', p_amount, 'status', outcome));
  return jsonb_build_object('status', outcome, 'issue', p_issue, 'amount', p_amount, 'version', v.version);
end $$;

-- Removing the label closes the offer, but only while nobody has claimed it: a claimed task stays open for the console.
-- Statuses: closed, already_closed, claimed, no_offer, ineligible_repository.
create function public.close_offer_from_label(p_repo text, p_issue integer, p_by_login text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  repo public.repositories;
  offer public.reward_offers;
begin
  select * into repo from public.repositories where lower(full_name) = lower(p_repo) and eligible;
  if not found then return jsonb_build_object('status', 'ineligible_repository', 'issue', p_issue); end if;
  perform pg_advisory_xact_lock(hashtextextended('offer:' || repo.full_name || '#' || p_issue, 0));
  select * into offer from public.reward_offers where repository_id = repo.id and issue_number = p_issue for update;
  if not found then return jsonb_build_object('status', 'no_offer', 'issue', p_issue); end if;
  if offer.status = 'closed' then return jsonb_build_object('status', 'already_closed', 'issue', p_issue); end if;
  if exists (select 1 from public.reward_claims where offer_id = offer.id and status = 'active') then
    return jsonb_build_object('status', 'claimed', 'issue', p_issue);
  end if;
  update public.reward_offers set status = 'closed' where id = offer.id;
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (null, 'reward.offer_status', 'reward_offer', offer.id::text,
          jsonb_build_object('status', 'closed', 'by', left(coalesce(p_by_login, ''), 100), 'via', 'label'));
  return jsonb_build_object('status', 'closed', 'issue', p_issue);
end $$;

revoke all on function public.publish_offer_from_label(text, integer, integer, text, text, text),
  public.close_offer_from_label(text, integer, text) from public, anon, authenticated;
grant execute on function public.publish_offer_from_label(text, integer, integer, text, text, text),
  public.close_offer_from_label(text, integer, text) to service_role;
commit;
