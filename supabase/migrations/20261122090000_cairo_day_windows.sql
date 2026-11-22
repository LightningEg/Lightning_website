-- The owner's 30-day windows start on a Cairo calendar day, whatever the clock did in between.
-- admin_sales and admin_dashboard took Cairo midnight back to an instant and then subtracted days as 24-hour
-- blocks; across the end of summer time (Egypt, last Thursday of October) the window started at 01:00 Cairo, so
-- between 00:00 and 01:00 for 30 days its daily series lost a day (29 rows, not 30). The days are now subtracted in
-- Cairo local time before converting. Nothing else in either function changes.
begin;

create or replace function public.admin_sales(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d integer := least(greatest(coalesce(p_days, 30), 1), 365);
  t0 timestamptz := (date_trunc('day', now() at time zone 'Africa/Cairo') - make_interval(days => d - 1)) at time zone 'Africa/Cairo';
  stale timestamptz := now() - interval '24 hours';
begin
  perform private.require_mfa_admin();
  return (
  with s as (
    select p.created_at, p.user_id as buyer, p.item_id, p.price_paid,
           case when exists (select 1 from public.order_lines l where l.purchase_id = p.id) then 'cart' else 'direct' end as channel
      from public.purchases p where p.created_at >= t0
    union all
    select g.created_at, g.from_user, g.item_id, g.price_paid, 'gift' from public.gifts g where g.created_at >= t0
    union all
    select sp.created_at, sp.user_id, sp.item_id, sp.price_paid, 'seat' from public.seat_purchases sp where sp.created_at >= t0),
  ev as (select * from public.cart_events where created_at >= t0),
  open_carts as (
    select ci.user_id, count(*) as lines, max(ci.added_at) as last_add, min(ci.added_at) as first_add,
           sum(c.price) as listed
      from public.cart_items ci join public.catalog_items c on c.id = ci.item_id group by ci.user_id)
  select jsonb_build_object(
    'days', d,
    'since', t0,
    'sales', jsonb_build_object(
      'units', (select count(*) from s), 'coins', (select coalesce(sum(price_paid), 0) from s),
      'buyers', (select count(distinct buyer) from s),
      'by_channel', (select coalesce(jsonb_object_agg(channel, jsonb_build_object('units', u, 'coins', c)), '{}'::jsonb)
                       from (select channel, count(*) u, sum(price_paid) c from s group by channel) x)),
    'orders', jsonb_build_object(
      'count', (select count(*) from public.orders where created_at >= t0),
      'coins', (select coalesce(sum(total), 0) from public.orders where created_at >= t0),
      'avg_coins', (select coalesce(round(avg(total)), 0) from public.orders where created_at >= t0),
      'avg_lines', (select coalesce(round(avg(line_count)::numeric, 1), 0) from public.orders where created_at >= t0)),
    'funnel', jsonb_build_object(
      'adds', (select count(*) from ev where event = 'add'),
      'carts_started', (select count(distinct user_id) from ev where event = 'add'),
      'removed', (select count(*) from ev where event = 'remove'),
      'checkouts', (select count(*) from public.orders where created_at >= t0),
      'open_carts', (select count(*) from open_carts),
      'open_listed_coins', (select coalesce(sum(listed), 0) from open_carts),
      'stale_carts', (select count(*) from open_carts where last_add < stale),
      'stale_listed_coins', (select coalesce(sum(listed), 0) from open_carts where last_add < stale)),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(g.day, 'YYYY-MM-DD'), 'units', coalesce(x.u, 0), 'coins', coalesce(x.c, 0)) order by g.day), '[]'::jsonb)
                from generate_series(t0 at time zone 'Africa/Cairo', now() at time zone 'Africa/Cairo', interval '1 day') as g(day)
                left join (select date_trunc('day', created_at at time zone 'Africa/Cairo') as day, count(*) u, sum(price_paid) c from s group by 1) x
                  on x.day = date_trunc('day', g.day)),
    'by_type', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'units', u, 'coins', c) order by c desc), '[]'::jsonb)
                  from (select ca.type, count(*) u, sum(s.price_paid) c from s join public.catalog_items ca on ca.id = s.item_id group by ca.type) x),
    'by_item', (select coalesce(jsonb_agg(row_to_json(x) order by x.coins desc, x.units desc, x.name), '[]'::jsonb) from (
        select c.id, c.name, c.type, c.price,
               (select count(*) from s where s.item_id = c.id) as units,
               (select coalesce(sum(price_paid), 0) from s where s.item_id = c.id) as coins,
               (select count(*) from ev where ev.item_id = c.id and ev.event = 'add') as adds,
               (select count(*) from public.cart_items ci where ci.item_id = c.id) as in_carts
          from public.catalog_items c
         where c.active and not c.is_default and c.award is null
           and ((select count(*) from s where s.item_id = c.id) > 0
                or (select count(*) from ev where ev.item_id = c.id and ev.event = 'add') > 0
                or exists (select 1 from public.cart_items ci where ci.item_id = c.id))) x),
    'recent_orders', (select coalesce(jsonb_agg(jsonb_build_object('id', left(o.id::text, 8), 'at', o.created_at, 'lines', o.line_count, 'total', o.total,
                          'items', (select jsonb_agg(c.name order by c.name) from public.order_lines l join public.catalog_items c on c.id = l.item_id where l.order_id = o.id))
                        order by o.created_at desc), '[]'::jsonb)
                from (select * from public.orders order by created_at desc limit 15) o)));
end $$;

create or replace function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  m0 timestamptz := date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo';
  p0 timestamptz := date_trunc('month', (now() at time zone 'Africa/Cairo') - interval '1 month') at time zone 'Africa/Cairo';
  d0 timestamptz := (date_trunc('day', now() at time zone 'Africa/Cairo') - interval '29 days') at time zone 'Africa/Cairo';
begin
  perform private.require_mfa_admin();
  return jsonb_build_object(
    'month_start', m0,
    'fixed_cost_egp', (select monthly_fixed_cost_egp from public.payment_settings where id = 1),
    'coins_per_egp', (select coins_per_egp from public.coin_pricing where id = 1),
    'avg_topup_90d', (select coalesce(round(avg(coalesce(received_piastres, price_piastres))), 0) from public.topup_requests where status = 'approved' and reviewed_at >= now() - interval '90 days'),
    'revenue_month', (select coalesce(sum(coalesce(received_piastres, price_piastres)), 0) from public.topup_requests where status = 'approved' and reviewed_at >= m0),
    'revenue_prev', (select coalesce(sum(coalesce(received_piastres, price_piastres)), 0) from public.topup_requests where status = 'approved' and reviewed_at >= p0 and reviewed_at < m0),
    'topups_month', (select count(*) from public.topup_requests where status = 'approved' and reviewed_at >= m0),
    'topups_prev', (select count(*) from public.topup_requests where status = 'approved' and reviewed_at >= p0 and reviewed_at < m0),
    'payers_month', (select count(distinct user_id) from public.topup_requests where status = 'approved' and reviewed_at >= m0),
    'payers_all', (select count(distinct user_id) from public.topup_requests where status = 'approved'),
    'repeat_payers', (select count(*) from (select user_id from public.topup_requests where status = 'approved' group by user_id having count(*) > 1) x),
    'members_all', (select count(*) from public.member_profiles),
    'members_month', (select count(*) from public.member_profiles where created_at >= m0),
    'coins_sold_month', (select coalesce(sum(wallet_delta), 0) from public.ledger_entries where kind = 'paid_topup' and earned_at >= m0),
    'coins_given_month', (select coalesce(sum(wallet_delta), 0) from public.ledger_entries where kind in ('story_coins', 'admin_gift', 'contribution_award', 'feedback_award') and wallet_delta > 0 and earned_at >= m0),
    'coins_spent_month', (select coalesce(-sum(wallet_delta), 0) from public.ledger_entries where kind = 'purchase' and earned_at >= m0),
    'coins_outstanding', (select coalesce(sum(balance), 0) from public.wallets),
    'top_items', (select coalesce(jsonb_agg(x order by x.sold desc, x.coins desc), '[]'::jsonb) from (
        select c.id, c.name, c.type, c.tier, count(*) as sold, sum(p.price_paid) as coins
        from public.purchases p join public.catalog_items c on c.id = p.item_id
        where p.created_at >= m0 group by c.id, c.name, c.type, c.tier order by count(*) desc, sum(p.price_paid) desc limit 6) x),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(g.day, 'YYYY-MM-DD'), 'piastres', coalesce(s.piastres, 0)) order by g.day), '[]'::jsonb)
        from generate_series(d0 at time zone 'Africa/Cairo', now() at time zone 'Africa/Cairo', interval '1 day') as g(day)
        left join (select date_trunc('day', reviewed_at at time zone 'Africa/Cairo') as day, sum(coalesce(received_piastres, price_piastres)) as piastres
                   from public.topup_requests where status = 'approved' and reviewed_at >= d0 group by 1) s on s.day = date_trunc('day', g.day)),
    'needs', jsonb_build_object(
        'receipts', (select count(*) from public.topup_requests where status = 'pending' and receipt_object_key is not null),
        'awaiting_receipt', (select count(*) from public.topup_requests where status = 'pending' and receipt_object_key is null),
        'unmatched', (select count(*) from public.bank_transfers where request_id is null and not voided and returned_at is null),
        'stories', (select count(*) from public.community_stories where status = 'pending'),
        'mismatches', (select count(*) from (select w.user_id from public.wallets w left join public.ledger_entries e using (user_id)
                        group by w.user_id, w.balance having w.balance <> coalesce(sum(e.wallet_delta), 0)) x),
        'oldest_receipt_at', (select min(receipt_uploaded_at) from public.topup_requests where status = 'pending' and receipt_object_key is not null))
  );
end $$;

revoke all on function public.admin_sales(integer), public.admin_dashboard() from public, anon;
grant execute on function public.admin_sales(integer), public.admin_dashboard() to authenticated, service_role;
commit;
