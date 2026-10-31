-- Who signed up, and what they did next (owner, 2026-10-31). Counts only: nobody is named, and no email, id or
-- token leaves the database. Administrators are counted apart so the owner's own account never reads as a member.
-- MFA administrators only (private.require_mfa_admin), like admin_store_funnel.
begin;

create function public.admin_signups(p_days integer default 90) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d integer := least(greatest(coalesce(p_days, 90), 1), 365);
  t0 date := (now() at time zone 'Africa/Cairo')::date - (d - 1);
begin
  perform private.require_mfa_admin();
  return (
  with u as (
    select au.id,
           (au.created_at at time zone 'Africa/Cairo')::date as day,
           au.email_confirmed_at is not null as confirmed,
           au.last_sign_in_at is not null as signed_in,
           coalesce(au.is_anonymous, false) as anonymous,
           exists (select 1 from public.admin_roles r where r.user_id = au.id) as is_admin,
           coalesce((select array_agg(distinct i.provider order by i.provider) from auth.identities i where i.user_id = au.id), '{}') as providers,
           exists (select 1 from public.github_links g where g.user_id = au.id and g.unlinked_at is null) as github_linked,
           exists (select 1 from public.topup_requests t where t.user_id = au.id) as asked_topup,
           exists (select 1 from public.purchases p where p.user_id = au.id) as bought,
           exists (select 1 from public.contributions c where c.user_id = au.id and not c.hidden) as contributed
      from auth.users au),
  m as (select * from u where not is_admin)
  select jsonb_build_object(
    'days', d, 'since', t0,
    'totals', jsonb_build_object(
      'accounts', (select count(*) from u),
      'members', (select count(*) from m),
      'administrators', (select count(*) from u where is_admin),
      'anonymous', (select count(*) from m where anonymous),
      'first_signup', (select min(day) from m),
      'latest_signup', (select max(day) from m)),
    'period', jsonb_build_object('members', (select count(*) from m where day >= t0)),
    -- Members only, all time. The first three narrow one another; linked_github and the three actions are separate ways to have done something.
    'steps', jsonb_build_object(
      'signed_up', (select count(*) from m),
      'confirmed_email', (select count(*) from m where confirmed),
      'signed_in', (select count(*) from m where signed_in),
      'linked_github', (select count(*) from m where github_linked),
      'asked_topup', (select count(*) from m where asked_topup),
      'bought', (select count(*) from m where bought),
      'contributed', (select count(*) from m where contributed),
      'did_something', (select count(*) from m where asked_topup or bought or contributed)),
    'providers', (select coalesce(jsonb_agg(row_to_json(x) order by x.members desc, x.provider), '[]'::jsonb) from (
        select p as provider, count(*) as members from m, unnest(m.providers) p group by p) x),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', g.day::date, 'signups', coalesce(c.n, 0)) order by g.day), '[]'::jsonb)
                from generate_series(t0, (now() at time zone 'Africa/Cairo')::date, interval '1 day') as g(day)
                left join (select day, count(*) n from m where day >= t0 group by day) c on c.day = g.day::date),
    'recent', (select coalesce(jsonb_agg(row_to_json(r) order by r.day desc), '[]'::jsonb) from (
        select day, providers, confirmed, signed_in, (asked_topup or bought or contributed) as did_something
          from m order by day desc, id limit 15) r)
  ));
end $$;

revoke all on function public.admin_signups(integer) from public, anon;
grant execute on function public.admin_signups(integer) to authenticated, service_role;
commit;
