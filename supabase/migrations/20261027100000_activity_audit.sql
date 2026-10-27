begin;
-- Audit timeline (2026-10-27): one read-only list of everything that moved coins, changed a score or made a sale,
-- with what the owner did by hand, for the owner console's Activity view.
-- It adds no second copy of anything. The ledger is already append-only and holds every coin and score change; each
-- purchase, set and gift points at its ledger entry; audit_log (append-only) holds what the owner and the workflows did.
-- This function reads those, newest first, so the timeline cannot drift from the records it describes.

create function public.admin_activity(p_category text default 'all', p_search text default null,
                                      p_before timestamptz default null, p_limit integer default 50, p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  d integer := least(greatest(coalesce(p_days, 30), 1), 365);
  since timestamptz := now() - make_interval(days => d);
  cat text := coalesce(nullif(p_category, ''), 'all');
  q text := nullif(btrim(coalesce(p_search, '')), '');
  picked jsonb;
  n integer;
begin
  perform private.require_mfa_admin();
  if cat not in ('all', 'coins', 'score', 'sales', 'admin') then raise exception 'unknown category'; end if;
  if q is not null and char_length(q) > 80 then raise exception 'search is too long'; end if;

  with led as (
    select l.created_at as at, 'l' || l.id::text as ref_id,
           case when l.kind in ('purchase', 'refund') then 'sale' when l.contribution_delta <> 0 then 'score' else 'coins' end as category,
           l.kind as event, l.user_id, l.wallet_delta as coins, l.contribution_delta as score,
           left(l.reason, 200) as detail, l.source_type || ':' || l.source_id as ref,
           case when l.created_by is null then 'system' when l.created_by = l.user_id then 'member' else 'owner' end as actor_kind,
           coalesce(pc.name, gc.name) as item,
           left(ol.order_id::text, 8) as order_id,
           case when g.id is not null then (select m.display_name from public.member_profiles m where m.user_id = g.to_user) end as gift_to
      from public.ledger_entries l
      left join public.purchases p on p.ledger_entry_id = l.id
      left join public.catalog_items pc on pc.id = p.item_id
      left join public.order_lines ol on ol.purchase_id = p.id
      left join public.gifts g on g.ledger_entry_id = l.id
      left join public.catalog_items gc on gc.id = g.item_id),
  adm as (
    select a.created_at as at, 'a' || a.id::text as ref_id, 'admin' as category, a.action as event, a.actor as user_id,
           null::integer as coins, null::integer as score,
           left(trim(both ' ' from coalesce(a.target_type, '') || ' ' || coalesce(a.target_id, '') || ' ' || case when a.detail = '{}'::jsonb then '' else a.detail::text end), 200) as detail,
           null::text as ref, case when a.actor is null then 'system' else 'owner' end as actor_kind,
           null::text as item, null::text as order_id, null::text as gift_to
      from public.audit_log a),
  every as (select * from led union all select * from adm),
  named as (
    select e.*, u.email, m.display_name from every e
      left join auth.users u on u.id = e.user_id
      left join public.member_profiles m on m.user_id = e.user_id),
  hits as (
    select * from named
     where at >= since and (p_before is null or at < p_before)
       and case cat when 'all' then true
                    when 'coins' then category in ('coins', 'sale', 'score') and coalesce(coins, 0) <> 0
                    when 'score' then coalesce(score, 0) <> 0
                    when 'sales' then category = 'sale'
                    else category = 'admin' end
       and (q is null or concat_ws(' ', email, display_name, event, item, ref, detail, order_id, gift_to) ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
     order by at desc, ref_id desc limit lim + 1)
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', at, 'id', ref_id, 'category', category, 'event', event, 'coins', coins, 'score', score,
           'member', coalesce(display_name, split_part(email, '@', 1)), 'email', email, 'member_ref', left(user_id::text, 8),
           'by', actor_kind, 'item', item, 'order', order_id, 'gift_to', gift_to, 'ref', ref, 'detail', detail) order by at desc, ref_id desc), '[]'::jsonb),
         count(*)
    into picked, n from hits;

  -- the rows past the limit are only there to say whether more exist
  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(x order by (x ->> 'at') desc, (x ->> 'id') desc), '[]'::jsonb) from (select x from jsonb_array_elements(picked) x limit lim) s),
    'has_more', n > lim,
    'summary', jsonb_build_object(
      'days', d,
      'paid_in', (select coalesce(sum(wallet_delta), 0) from public.ledger_entries where kind = 'paid_topup' and created_at >= since),
      'given', (select coalesce(sum(wallet_delta), 0) from public.ledger_entries
                 where wallet_delta > 0 and kind not in ('paid_topup', 'purchase', 'refund', 'correction') and created_at >= since),
      'spent', (select coalesce(-sum(wallet_delta), 0) from public.ledger_entries where kind = 'purchase' and created_at >= since),
      'refunded', (select coalesce(sum(wallet_delta), 0) from public.ledger_entries where kind = 'refund' and created_at >= since),
      'corrections', (select count(*) from public.ledger_entries where kind = 'correction' and created_at >= since),
      'score_awarded', (select coalesce(sum(contribution_delta), 0) from public.ledger_entries where contribution_delta > 0 and created_at >= since),
      'manual_credits', (select count(*) from public.audit_log where action = 'wallet.manual_credit' and created_at >= since),
      'admin_actions', (select count(*) from public.audit_log where created_at >= since)));
end $$;

revoke all on function public.admin_activity(text, text, timestamptz, integer, integer) from public, anon;
grant execute on function public.admin_activity(text, text, timestamptz, integer, integer) to authenticated, service_role;
commit;
