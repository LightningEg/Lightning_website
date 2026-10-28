begin;
-- Website analytics in the owner console (2026-10-28).
-- js/analytics.js already sends one anonymous record per page view to the Apps Script receiver (privacy.html §2). On the
-- store pages (Marketplace, Collection, Wallet) it now sends the same record here too, without the linked-visit
-- identifiers (§3 stays with the receiver), so the owner console can follow a look from browsing to an order and a
-- top-up. Site-wide traffic stays in analytics/dashboard.html. A record names a page, never a person: no IP address,
-- no account, nothing typed. Records older than 90 days are deleted (privacy.html).

create table public.site_views (
  pv text primary key check (pv ~ '^[0-9a-f]{16}$'),
  day date not null default (now() at time zone 'Africa/Cairo')::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  page text not null check (page ~ '^[A-Za-z0-9._/-]{1,80}$'),
  ux text check (ux ~ '^[A-Za-z0-9._/@-]{0,80}$'),
  lang text check (lang in ('en', 'ar')),
  device text check (device in ('phone', 'tablet', 'desktop')),
  os text check (os ~ '^[a-z]{0,12}$'),
  browser text check (browser ~ '^[a-z]{0,12}$'),
  consent text check (consent in ('all', 'essential', 'gpc', 'undecided')),
  ref text check (ref ~ '^[A-Za-z0-9.-]{0,120}$'),
  from_page text check (from_page ~ '^[A-Za-z0-9._/-]{0,80}$'),
  utm_source text check (char_length(utm_source) <= 60),
  utm_medium text check (char_length(utm_medium) <= 60),
  utm_campaign text check (char_length(utm_campaign) <= 60),
  scroll smallint not null default 0 check (scroll between 0 and 100),
  active integer not null default 0 check (active between 0 and 86400),
  load_s real check (load_s between 0 and 600),
  lcp_s real check (lcp_s between 0 and 600),
  tl jsonb not null default '{}'::jsonb check (jsonb_typeof(tl) = 'object')
);
create index site_views_day on public.site_views (day);
create index site_views_page on public.site_views (page, day);
create index site_views_created on public.site_views (created_at);

alter table public.site_views enable row level security;
revoke all on public.site_views from public, anon, authenticated;
grant all on public.site_views to service_role;

-- One page view, sent again as it grows (scroll, time, what was pressed). Anyone may call it, so it checks every
-- field, only updates a record for two hours, and stops quietly when the whole site sends more than 600 new records
-- a minute. It never raises on bad input: analytics must never break a page.
create function public.site_track(p jsonb) returns void language plpgsql security definer set search_path = '' as $$
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
  if coalesce(p->>'page', '') not in ('marketplace', 'ar/marketplace', 'collection', 'ar/collection', 'topup', 'ar/topup') then return; end if;
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
  -- Keep 90 days: about one new record in a hundred also clears the oldest day.
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

-- ---------------------------------------------------------------- the owner's readout
-- A code "happened" on a page view when its timeline holds it; prefixes group families (store-try-nile).
create function private.tl_has(tl jsonb, prefix text) returns boolean language sql immutable set search_path = '' as $$
  select exists (select 1 from jsonb_object_keys(tl) k where k like prefix || '%');
$$;
revoke all on function private.tl_has(jsonb, text) from public, anon, authenticated;

-- The store from browsing to paying: marketplace views, Details and Try it (from page views), then carts, orders and
-- top-ups (from the store's own tables). Members are counted, never named.
create function public.admin_store_funnel(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d integer := least(greatest(coalesce(p_days, 30), 1), 90);
  t0 date := (now() at time zone 'Africa/Cairo')::date - (d - 1);
  ts timestamptz := t0::timestamp at time zone 'Africa/Cairo';
begin
  perform private.require_mfa_admin();
  return (
  with v as (select * from public.site_views where day >= t0),
  m as (select * from v where page in ('marketplace', 'ar/marketplace', 'collection', 'ar/collection')),
  tries as (select substr(k, 11) item_id, count(*) n from m, jsonb_object_keys(m.tl) k where k like 'store-try-%' group by 1),
  looks as (select substr(k, 15) item_id, count(*) n from m, jsonb_object_keys(m.tl) k where k like 'store-details-%' group by 1),
  sold as (select item_id, count(*) n from (
      select item_id from public.purchases where created_at >= ts
      union all select item_id from public.gifts where created_at >= ts
      union all select item_id from public.seat_purchases where created_at >= ts) s group by 1),
  adds as (select item_id, count(*) n from public.cart_events where event = 'add' and created_at >= ts group by 1),
  t as (select * from public.topup_requests where created_at >= ts)
  select jsonb_build_object(
    'days', d, 'since', t0,
    'steps', jsonb_build_object(
      'store_views', (select count(*) from m),
      'looked_closer', (select count(*) from m where private.tl_has(m.tl, 'store-details-') or private.tl_has(m.tl, 'store-try-')),
      'tried_on', (select count(*) from m where private.tl_has(m.tl, 'store-try-')),
      'started_buy', (select count(*) from m where private.tl_has(m.tl, 'store-buy')),
      'short_of_coins', (select count(*) from m where private.tl_has(m.tl, 'store-short')),
      'members_added_to_cart', (select count(distinct user_id) from public.cart_events where event = 'add' and created_at >= ts),
      'orders', (select count(*) from public.orders where created_at >= ts),
      'buyers', (select count(distinct buyer) from (
          select user_id buyer from public.purchases where created_at >= ts
          union select from_user from public.gifts where created_at >= ts
          union select user_id from public.seat_purchases where created_at >= ts) b)),
    'topups', jsonb_build_object(
      'wallet_views', (select count(*) from v where page in ('topup', 'ar/topup')),
      'requests', (select count(*) from t),
      'details_sent', (select count(*) from t where details_submitted_at is not null or receipt_uploaded_at is not null or status = 'approved'),
      'credited', (select count(*) from t where status = 'approved'),
      'credited_egp', (select coalesce(sum(received_piastres), 0) / 100 from t where status = 'approved'),
      'rejected', (select count(*) from t where status = 'rejected'),
      'cancelled', (select count(*) from t where status = 'cancelled'),
      'waiting', (select count(*) from t where status = 'pending'),
      'median_hours_to_credit', (select round((percentile_cont(0.5) within group (order by extract(epoch from reviewed_at - created_at) / 3600))::numeric, 1)
                                   from t where status = 'approved')),
    -- Tried, opened, carted and sold, item by item: what people want but do not buy.
    'items', (select coalesce(jsonb_agg(row_to_json(x) order by x.tried desc, x.opened desc, x.sold desc), '[]'::jsonb) from (
        select c.id, c.name, c.type, c.price,
               coalesce(tr.n, 0) tried, coalesce(lk.n, 0) opened, coalesce(ad.n, 0) added, coalesce(so.n, 0) sold
          from public.catalog_items c
          left join tries tr on tr.item_id = c.id left join looks lk on lk.item_id = c.id
          left join adds ad on ad.item_id = c.id left join sold so on so.item_id = c.id
         where coalesce(tr.n, 0) + coalesce(lk.n, 0) + coalesce(ad.n, 0) + coalesce(so.n, 0) > 0
         order by 5 desc, 6 desc, 8 desc limit 40) x))
  );
end $$;

revoke all on function public.site_track(jsonb), public.admin_store_funnel(integer) from public;
grant execute on function public.site_track(jsonb) to anon, authenticated;
revoke all on function public.admin_store_funnel(integer) from anon;
grant execute on function public.admin_store_funnel(integer) to authenticated, service_role;
commit;
