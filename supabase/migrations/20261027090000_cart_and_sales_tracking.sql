begin;
-- Marketplace cart and sales tracking (2026-10-27).
-- A member's cart lives on the server, so it follows them between the website, the phone and the PC. Checkout buys
-- every line in ONE transaction through the existing purchase functions (same ledger, same price checks, same
-- idempotency), so a cart can never charge for half an order. The owner reads what sells and where carts stall from
-- admin_sales(). Nothing here sells anything new: cosmetics only, no money outside the existing coin ledger.

create table public.cart_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null references public.catalog_items (id),
  added_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index cart_items_item on public.cart_items (item_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 36),
  total integer not null check (total > 0),
  line_count integer not null check (line_count > 0),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index orders_created on public.orders (created_at);

create table public.order_lines (
  order_id uuid not null references public.orders (id) on delete cascade,
  item_id text not null references public.catalog_items (id),
  price_paid integer not null check (price_paid > 0),
  purchase_id bigint references public.purchases (id) on delete set null,
  primary key (order_id, item_id)
);

-- What members did with carts, for the owner's funnel. Written only by the functions below. Deleting an account
-- keeps the event but drops the link to the person.
create table public.cart_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  item_id text references public.catalog_items (id),
  event text not null check (event in ('add', 'remove', 'clear', 'checkout')),
  order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now()
);
create index cart_events_when on public.cart_events (created_at);
create index cart_events_item on public.cart_events (item_id, event);

alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.cart_events enable row level security;
revoke all on public.cart_items, public.orders, public.order_lines, public.cart_events from public, anon, authenticated;
grant all on public.cart_items, public.orders, public.order_lines, public.cart_events to service_role;
grant usage, select on sequence public.cart_events_id_seq to service_role;

-- ---------------------------------------------------------------- the plan: what the cart would cost right now
-- Sets are priced first; any cart item that is a part of a cart set rides inside it at no extra cost.
create function private.cart_plan(p_user uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.catalog_items;
  lines jsonb := '[]'::jsonb;
  covered text[] := '{}';
  total integer := 0;
  price integer;
  st text;
begin
  for c in
    select cat.* from public.cart_items ci join public.catalog_items cat on cat.id = ci.item_id
     where ci.user_id = p_user order by (cat.type <> 'set'), ci.added_at, cat.id
  loop
    price := 0;
    if c.type = 'set' then
      if not c.active or exists (select 1 from public.set_parts sp join public.catalog_items x on x.id = sp.item_id
                                  where sp.set_id = c.id and not (x.is_default or private.on_sale(x)
                                    or exists (select 1 from public.inventory i where i.user_id = p_user and i.item_id = x.id))) then
        st := 'unavailable';
      else
        price := private.set_price(c.id, p_user);
        if price <= 0 or exists (select 1 from public.inventory where user_id = p_user and item_id = c.id) then st := 'owned'; price := 0;
        else
          st := 'ok';
          covered := covered || coalesce((select array_agg(sp.item_id) from public.set_parts sp
                                           join public.catalog_items x on x.id = sp.item_id where sp.set_id = c.id and not x.is_default), '{}');
        end if;
      end if;
    elsif c.id = any (covered) then st := 'covered';
    elsif exists (select 1 from public.inventory where user_id = p_user and item_id = c.id) then st := 'owned';
    elsif not private.on_sale(c) then st := 'unavailable';
    else st := 'ok'; price := c.price;
    end if;
    if st = 'ok' then total := total + price; end if;
    lines := lines || jsonb_build_object('item_id', c.id, 'name', c.name, 'type', c.type, 'price', price, 'status', st);
  end loop;
  return jsonb_build_object('lines', lines, 'total', total);
end $$;
revoke all on function private.cart_plan(uuid) from public, anon, authenticated;

create function private.order_summary(p_order uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('order_id', o.id, 'total', o.total, 'created_at', o.created_at,
    'balance', coalesce((select balance from public.wallets where user_id = o.user_id), 0),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('item_id', l.item_id, 'name', c.name, 'price_paid', l.price_paid) order by c.name), '[]'::jsonb)
                from public.order_lines l join public.catalog_items c on c.id = l.item_id where l.order_id = o.id))
  from public.orders o where o.id = p_order;
$$;
revoke all on function private.order_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- the member's cart
create function public.cart_view() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); plan jsonb;
begin
  if uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  plan := private.cart_plan(uid);
  return plan || jsonb_build_object('balance', coalesce((select balance from public.wallets where user_id = uid), 0));
end $$;

create function public.cart_add(p_item_id text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); item public.catalog_items; n integer;
begin
  perform private.require_active_session();
  select * into item from public.catalog_items where id = p_item_id and active;
  if not found then raise exception 'item not available'; end if;
  if item.is_default then raise exception 'item is free and always available'; end if;
  if item.award is not null then raise exception 'this badge is earned, not sold'; end if;
  if item.type = 'set' then
    if private.set_price(item.id, uid) <= 0 or exists (select 1 from public.inventory where user_id = uid and item_id = item.id) then
      raise exception 'you already own every part of this set'; end if;
    if exists (select 1 from public.set_parts mine join public.set_parts other on other.item_id = mine.item_id and other.set_id <> mine.set_id
                join public.cart_items ci on ci.item_id = other.set_id and ci.user_id = uid where mine.set_id = item.id) then
      raise exception 'that set shares parts with a set already in your cart'; end if;
  else
    if not private.on_sale(item) then raise exception 'not on sale now'; end if;
    if exists (select 1 from public.inventory where user_id = uid and item_id = item.id) then raise exception 'already owned'; end if;
  end if;
  select count(*) into n from public.cart_items where user_id = uid;
  if n >= 25 then raise exception 'your cart is full: buy or remove something first'; end if;
  insert into public.cart_items (user_id, item_id) values (uid, item.id) on conflict do nothing;
  if found then insert into public.cart_events (user_id, item_id, event) values (uid, item.id, 'add'); end if;
  return public.cart_view();
end $$;

create function public.cart_remove(p_item_id text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  perform private.require_active_session();
  delete from public.cart_items where user_id = uid and item_id = p_item_id;
  if found then insert into public.cart_events (user_id, item_id, event) values (uid, p_item_id, 'remove'); end if;
  return public.cart_view();
end $$;

create function public.cart_clear() returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  perform private.require_active_session();
  delete from public.cart_items where user_id = uid;
  if found then insert into public.cart_events (user_id, event) values (uid, 'clear'); end if;
  return public.cart_view();
end $$;

-- ---------------------------------------------------------------- checkout: all lines or none
-- p_expected_total is the total the member saw; a different price now refuses the whole order. One retry key per
-- checkout dialog: replaying it returns the same order and never charges twice.
create function public.checkout_cart(p_expected_total integer, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); w public.wallets; o public.orders; plan jsonb; ln jsonb; pr public.purchases; total integer; n integer;
begin
  perform private.require_active_session();
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 36 then
    raise exception 'idempotency key must be 8 to 36 characters'; end if;
  select * into w from public.wallets where user_id = uid for update; -- one checkout at a time per member
  select * into o from public.orders where user_id = uid and idempotency_key = p_idempotency_key;
  if found then return private.order_summary(o.id); end if;
  plan := private.cart_plan(uid);
  if exists (select 1 from jsonb_array_elements(plan -> 'lines') l where l ->> 'status' in ('owned', 'unavailable')) then
    raise exception 'cart changed: remove the unavailable items and check again'; end if;
  total := (plan ->> 'total')::integer;
  select count(*) into n from jsonb_array_elements(plan -> 'lines') l where l ->> 'status' = 'ok';
  if n = 0 then raise exception 'your cart is empty'; end if;
  if p_expected_total is distinct from total then raise exception 'price changed; reload the cart before buying'; end if;
  if w.user_id is null or w.balance < total then raise exception 'insufficient coins' using errcode = 'P0001'; end if;
  insert into public.orders (user_id, idempotency_key, total, line_count) values (uid, p_idempotency_key, total, n) returning * into o;
  for ln in select l from jsonb_array_elements(plan -> 'lines') l where l ->> 'status' = 'ok' loop
    if ln ->> 'type' = 'set' then
      pr := public.purchase_set(ln ->> 'item_id', (ln ->> 'price')::integer, p_idempotency_key || ':' || (ln ->> 'item_id'));
    else
      pr := public.purchase_item_at_price(ln ->> 'item_id', (ln ->> 'price')::integer, p_idempotency_key || ':' || (ln ->> 'item_id'));
    end if;
    insert into public.order_lines (order_id, item_id, price_paid, purchase_id) values (o.id, pr.item_id, pr.price_paid, pr.id);
    insert into public.cart_events (user_id, item_id, event, order_id) values (uid, pr.item_id, 'checkout', o.id);
  end loop;
  delete from public.cart_items where user_id = uid;
  return private.order_summary(o.id);
end $$;

-- ---------------------------------------------------------------- the owner's view: what sells, where carts stall
create function public.admin_sales(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d integer := least(greatest(coalesce(p_days, 30), 1), 365);
  t0 timestamptz := date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' - make_interval(days => d - 1);
  stale timestamptz := now() - interval '24 hours';
begin
  perform private.require_mfa_admin();
  return (
  with s as (
    select p.created_at, p.user_id as buyer, p.item_id, p.price_paid,
           case when exists (select 1 from public.order_lines l where l.purchase_id = p.id) then 'cart' else 'direct' end as channel
      from public.purchases p where p.created_at >= t0
    union all
    select g.created_at, g.from_user, g.item_id, g.price_paid, 'gift' from public.gifts g where g.created_at >= t0),
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

revoke all on function public.cart_view(), public.cart_add(text), public.cart_remove(text), public.cart_clear(),
  public.checkout_cart(integer, text), public.admin_sales(integer) from public, anon;
grant execute on function public.cart_view(), public.cart_add(text), public.cart_remove(text), public.cart_clear(),
  public.checkout_cart(integer, text) to authenticated;
grant execute on function public.admin_sales(integer) to authenticated, service_role;
commit;
