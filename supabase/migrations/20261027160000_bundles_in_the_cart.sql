begin;
-- 8N: the cart points to the cheaper set. cart_view returns `suggestions`, and cart_swap_for_set swaps the parts in the
-- cart for the set in one step. Every price comes from private.set_price and the catalogue, the same functions
-- checkout_cart uses; nothing here invents a second formula.

-- A set is suggested when the cart's own parts plus what the member already owns cover at least half of its parts,
-- at least one part is in the cart, and cart_add would accept the set. saving = what its unowned parts cost one by one
-- minus the set price (the set also brings the parts not in the cart yet); extra = what the set adds to the cart total.
create function private.cart_suggestions(p_user uuid, p_plan jsonb) returns jsonb language sql stable security definer set search_path = '' as $$
  with inc as (
    select l ->> 'item_id' as item_id, (l ->> 'price')::integer as price
      from jsonb_array_elements(p_plan -> 'lines') l where l ->> 'status' = 'ok' and l ->> 'type' <> 'set')
  select coalesce(jsonb_agg(jsonb_build_object('set_id', s.id, 'name', s.name, 'parts_in_cart', x.in_cart, 'parts_total', x.total,
           'price', x.price, 'saving', x.listed - x.price, 'extra', x.price - x.cart_cost)
           order by (x.listed - x.price) desc, s.name), '[]'::jsonb)
  from public.catalog_items s
  cross join lateral (
    select count(*) as total,
           count(*) filter (where p.id in (select item_id from inc)) as in_cart,
           count(*) filter (where exists (select 1 from public.inventory i where i.user_id = p_user and i.item_id = p.id)) as owned,
           coalesce(sum(p.price) filter (where not exists (select 1 from public.inventory i where i.user_id = p_user and i.item_id = p.id)), 0)::integer as listed,
           coalesce(sum(p.price) filter (where p.id in (select item_id from inc)), 0)::integer as cart_cost,
           bool_and(exists (select 1 from public.inventory i where i.user_id = p_user and i.item_id = p.id) or private.on_sale(p)) as available,
           private.set_price(s.id, p_user) as price
      from public.set_parts sp join public.catalog_items p on p.id = sp.item_id
     where sp.set_id = s.id and not p.is_default) x
  where s.type = 'set' and s.active and x.total > 0 and x.in_cart >= 1 and (x.in_cart + x.owned) * 2 >= x.total
    and x.available and x.price > 0
    and not exists (select 1 from public.inventory i where i.user_id = p_user and i.item_id = s.id)
    and not exists (select 1 from public.cart_items ci where ci.user_id = p_user and ci.item_id = s.id)
    and not exists (select 1 from public.set_parts mine join public.set_parts other on other.item_id = mine.item_id and other.set_id <> mine.set_id
                     join public.cart_items ci on ci.item_id = other.set_id and ci.user_id = p_user where mine.set_id = s.id);
$$;
revoke all on function private.cart_suggestions(uuid, jsonb) from public, anon, authenticated;

create or replace function public.cart_view() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); plan jsonb;
begin
  if uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  plan := private.cart_plan(uid);
  return plan || jsonb_build_object('balance', coalesce((select balance from public.wallets where user_id = uid), 0),
                                    'suggestions', private.cart_suggestions(uid, plan));
end $$;

-- One transaction: the set's parts leave the cart and the set comes in under cart_add's own rules (already owned,
-- sets that share parts, the cart limit). Any refusal undoes the removal too, so a failed swap changes nothing.
create function public.cart_swap_for_set(p_set_id text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); s public.catalog_items; gone text;
begin
  perform private.require_active_session();
  select * into s from public.catalog_items where id = p_set_id and active and type = 'set';
  if not found then raise exception 'item not available'; end if;
  if exists (select 1 from public.set_parts sp join public.catalog_items p on p.id = sp.item_id
              where sp.set_id = s.id and not p.is_default and not private.on_sale(p)
                and not exists (select 1 from public.inventory i where i.user_id = uid and i.item_id = p.id)) then
    raise exception 'a part of this set is not on sale now'; end if;
  for gone in
    delete from public.cart_items ci using public.set_parts sp
     where ci.user_id = uid and sp.set_id = s.id and ci.item_id = sp.item_id returning ci.item_id
  loop
    insert into public.cart_events (user_id, item_id, event) values (uid, gone, 'remove');
  end loop;
  return public.cart_add(s.id);
end $$;

revoke all on function public.cart_view(), public.cart_swap_for_set(text) from public, anon;
grant execute on function public.cart_view(), public.cart_swap_for_set(text) to authenticated;
commit;
