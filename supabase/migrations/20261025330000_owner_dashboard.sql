begin;
-- Owner dashboard (2026-10-25): one call that answers "how is the business doing and what needs me", for the
-- Today view of admin.html. Read-only, MFA admins only. Money is in piastres, months run on Cairo time, and revenue
-- counts only approved top-ups (the actual amount received when it was recorded, else the accepted quote).

alter table public.payment_settings add column monthly_fixed_cost_egp integer not null default 3000
  check (monthly_fixed_cost_egp between 0 and 10000000);

create function public.admin_set_fixed_cost(p_egp integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_mfa_admin();
  if p_egp is null or p_egp < 0 or p_egp > 10000000 then raise exception 'enter a whole EGP amount'; end if;
  update public.payment_settings set monthly_fixed_cost_egp = p_egp where id = 1;
  insert into public.audit_log(actor, action, target_type, target_id, detail)
  values (auth.uid(), 'payments.fixed_cost', 'settings', '1', jsonb_build_object('egp', p_egp));
end $$;

create function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  m0 timestamptz := date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo';
  p0 timestamptz := date_trunc('month', (now() at time zone 'Africa/Cairo') - interval '1 month') at time zone 'Africa/Cairo';
  d0 timestamptz := date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' - interval '29 days';
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

revoke all on function public.admin_dashboard(), public.admin_set_fixed_cost(integer) from public, anon;
grant execute on function public.admin_dashboard(), public.admin_set_fixed_cost(integer) to authenticated, service_role;
commit;
