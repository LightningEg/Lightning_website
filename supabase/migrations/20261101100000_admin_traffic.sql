-- Visitors in the owner console (owner, 2026-10-31/11-01; plan item 8X). The same anonymous page-view record that already
-- reaches the Apps Script receiver now also reaches Supabase from every main-site page, not only the store, so the owner
-- console can show visits next to sign-ups without a read key. No IP address, account or typed text is in a record; the
-- linked-visit ids (Allow all) never come here. Records are deleted after 90 days (privacy.html).
begin;

-- site_track keeps the same checks, now for any page name instead of the three store pages.
create or replace function public.site_track(p jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_pv text := p->>'pv';
  v_tl jsonb := '{}'::jsonb;
  e jsonb;
  code text;
  n integer := 0;
  s text;
  clip text := '^[A-Za-z0-9._/@-]{0,80}$';
begin
  if jsonb_typeof(p) <> 'object' or v_pv is null or v_pv !~ '^[0-9a-f]{16}$' then return; end if;
  if coalesce(p->>'page', '') !~ '^[a-z0-9][a-z0-9_/-]{0,79}$' then return; end if;
  if jsonb_typeof(p->'tl') = 'array' then
    for e in select value from jsonb_array_elements(p->'tl') limit 80 loop
      if jsonb_typeof(e) = 'array' and jsonb_array_length(e) = 2 and jsonb_typeof(e->1) = 'number' then
        code := e->>0;
        if code ~ '^[a-z0-9][a-z0-9@._:-]{0,79}$' then
          v_tl := v_tl || jsonb_build_object(code, least(greatest((e->>1)::numeric, 0), 86400)::integer);
          n := n + 1;
        end if;
      end if;
    end loop;
  end if;

  if exists (select 1 from public.site_views where pv = v_pv) then
    update public.site_views set
      updated_at = now(),
      scroll = greatest(scroll, least(greatest(coalesce((p->>'scroll')::numeric, 0), 0), 100)::smallint),
      active = greatest(active, least(greatest(coalesce((p->>'act')::numeric, 0), 0), 86400)::integer),
      lcp_s = coalesce(lcp_s, nullif(least(greatest(coalesce((p->>'lcp')::numeric, 0), 0), 600), 0)::real),
      load_s = coalesce(load_s, nullif(least(greatest(coalesce((p->>'load')::numeric, 0), 0), 600), 0)::real),
      tl = v_tl || tl -- the first time of each code is kept
    where pv = v_pv and created_at > now() - interval '2 hours';
    return;
  end if;

  if (select count(*) from public.site_views where created_at > now() - interval '1 minute') >= 600 then return; end if;
  if random() < 0.01 then delete from public.site_views where created_at < now() - interval '90 days'; end if;

  s := coalesce(p->>'ref', '');
  insert into public.site_views (pv, page, ux, lang, device, os, browser, consent, ref, from_page,
                                 utm_source, utm_medium, utm_campaign, scroll, active, load_s, lcp_s, tl)
  values (v_pv, p->>'page',
    case when coalesce(p->>'ux', '') ~ clip then p->>'ux' end,
    case when p->>'lang' in ('en', 'ar') then p->>'lang' end,
    case when p->>'device' in ('phone', 'tablet', 'desktop') then p->>'device' end,
    case when coalesce(p->>'os', '') ~ '^[a-z]{0,12}$' then p->>'os' end,
    case when coalesce(p->>'br', '') ~ '^[a-z]{0,12}$' then p->>'br' end,
    case when p->>'consent' in ('all', 'essential', 'gpc', 'undecided') then p->>'consent' end,
    case when s ~ '^[A-Za-z0-9.-]{0,120}$' then nullif(s, '') end,
    case when coalesce(p->>'from', '') ~ '^[A-Za-z0-9._/-]{0,80}$' then nullif(p->>'from', '') end,
    nullif(left(coalesce(p->>'us', ''), 60), ''), nullif(left(coalesce(p->>'um', ''), 60), ''), nullif(left(coalesce(p->>'uc', ''), 60), ''),
    least(greatest(coalesce((p->>'scroll')::numeric, 0), 0), 100)::smallint,
    least(greatest(coalesce((p->>'act')::numeric, 0), 0), 86400)::integer,
    nullif(least(greatest(coalesce((p->>'load')::numeric, 0), 0), 600), 0)::real,
    nullif(least(greatest(coalesce((p->>'lcp')::numeric, 0), 0), 600), 0)::real,
    v_tl)
  on conflict (pv) do nothing;
exception when others then
  return; -- a malformed number or anything else: drop the record, never the page
end $$;

-- Who came, from where, what they did, and how many then made an account. An arrival is a page view that did not come from
-- another page of this site (the same meaning as the decision dashboard). Members exclude administrators.
create function public.admin_traffic(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d integer := least(greatest(coalesce(p_days, 30), 1), 90);
  today date := (now() at time zone 'Africa/Cairo')::date;
  t0 date := today - (d - 1);
begin
  perform private.require_mfa_admin();
  return (
  with v as (select *, (from_page is null or from_page = 'outside') as arrival from public.site_views where day >= t0),
  a as (select * from v where arrival),
  src as (select coalesce(nullif(lower(utm_source), ''), nullif(regexp_replace(lower(ref), '^www\.', ''), ''), 'direct') as source from a),
  mem as (select (au.created_at at time zone 'Africa/Cairo')::date as day
            from auth.users au
           where not exists (select 1 from public.admin_roles r where r.user_id = au.id)
             and (au.created_at at time zone 'Africa/Cairo')::date >= t0)
  select jsonb_build_object(
    'days', d, 'since', t0,
    'live_from', (select min(day) from public.site_views),
    'totals', jsonb_build_object(
      'page_views', (select count(*) from v),
      'arrivals', (select count(*) from a),
      'engaged', (select count(*) from a where active >= 15 or scroll >= 50),
      'reached_downloads', (select count(*) from a where private.tl_has(tl, 'click-current-status') or private.tl_has(tl, 'nav-current-status')
                                                         or private.tl_has(tl, 'link-current-status') or private.tl_has(tl, 'foot-current-status')) + (select count(*) from a where page = 'current-status'),
      'download_presses', (select count(*) from v where private.tl_has(tl, 'download-app-')),
      'new_members', (select count(*) from mem)),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', g.day::date, 'arrivals', coalesce(x.n, 0), 'downloads', coalesce(x.dl, 0),
                                                           'members', coalesce(m.n, 0)) order by g.day), '[]'::jsonb)
                from generate_series(t0, today, interval '1 day') as g(day)
                left join (select day, count(*) filter (where arrival) n, count(*) filter (where private.tl_has(tl, 'download-app-')) dl from v group by day) x on x.day = g.day::date
                left join (select day, count(*) n from mem group by day) m on m.day = g.day::date),
    -- Groups under 5 arrivals are folded into "smaller groups" so a single visit never stands alone.
    'sources', (select coalesce(jsonb_agg(row_to_json(s) order by s.arrivals desc, s.source), '[]'::jsonb) from (
        select case when n >= 5 then source else 'smaller groups' end as source, sum(n)::integer as arrivals
          from (select source, count(*) n from src group by source) g group by 1) s),
    'pages', (select coalesce(jsonb_agg(row_to_json(p) order by p.arrivals desc, p.page), '[]'::jsonb) from (
        select page, count(*)::integer as arrivals, count(*) filter (where scroll >= 50 or active >= 15)::integer as engaged
          from a group by page order by count(*) desc, page limit 12) p),
    'devices', (select coalesce(jsonb_agg(row_to_json(x) order by x.arrivals desc), '[]'::jsonb) from (
        select coalesce(device, 'unknown') as device, count(*)::integer as arrivals from a group by 1) x),
    'languages', (select coalesce(jsonb_agg(row_to_json(x) order by x.arrivals desc), '[]'::jsonb) from (
        select coalesce(lang, 'unknown') as lang, count(*)::integer as arrivals from a group by 1) x),
    'errors', (select count(*) from v where exists (select 1 from jsonb_object_keys(tl) k where k like 'js-error-%' or k like 'js-reject-%' or k like 'res-error-%')),
    'slow', (select count(*) from v where lcp_s > 4)
  ));
end $$;

revoke all on function public.site_track(jsonb), public.admin_traffic(integer) from public;
grant execute on function public.site_track(jsonb) to anon, authenticated;
revoke all on function public.admin_traffic(integer) from anon;
grant execute on function public.admin_traffic(integer) to authenticated, service_role;
commit;
