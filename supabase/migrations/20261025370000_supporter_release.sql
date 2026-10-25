-- Supporter release (owner, 2026-10-25: "build all"). Everything here is a look; nothing unlocks a feature, access or
-- a rank. Contribution badges stay earned by work, and the leaderboard still ranks by contribution only.
--   1. Supporter badges, earned by coins topped up (500, 2,500, 10,000), and Founding supporter for the first 100 payers.
--   2. Name styles: a new item type and slot, worn on the leaderboard, profiles and members.
--   3. Seasonal drops: items on sale only inside a window; owners keep them after it closes.
--   4. Sets: a theme, banner, frame and a fourth part at 80% of the parts not owned yet.
--   5. Animated banners: tier 'motion' on banners and names (one slow motion, still under reduced motion).
--   6. Gifts: buy an item for another member by display name.
--   7. Supporters vote on the next theme.

-- ---------------------------------------------------------------- catalog shape
alter table public.catalog_items drop constraint catalog_items_type_check;
alter table public.catalog_items add constraint catalog_items_type_check check (type in ('theme','banner','frame','badge','name','set'));
alter table public.catalog_items add column award text check (award in ('supporter','founding'));
alter table public.catalog_items add column award_coins integer check (award_coins is null or award_coins > 0);
alter table public.catalog_items add column available_from timestamptz;
alter table public.catalog_items add column available_until timestamptz;
alter table public.catalog_items add constraint catalog_window check (available_from is null or available_until is null or available_from < available_until);
alter table public.catalog_items add constraint catalog_award_shape check (
  (award is null and award_coins is null) or (award = 'supporter' and award_coins is not null) or (award = 'founding' and award_coins is null));
-- an earned item is free and never sold; a default is free; everything else has a price
alter table public.catalog_items drop constraint default_is_free;
alter table public.catalog_items add constraint catalog_price_shape check (
  (is_default and award is null and price = 0) or (not is_default and award is not null and price = 0) or (not is_default and award is null and price > 0));
alter table public.catalog_items drop constraint catalog_items_tier_theme;
alter table public.catalog_items add constraint catalog_items_tier_shape check (
  case type when 'theme' then tier is not null when 'banner' then tier is null or tier = 'motion' when 'name' then tier is null or tier = 'motion' else tier is null end);
alter table public.equipped_items drop constraint equipped_items_slot_check;
alter table public.equipped_items add constraint equipped_items_slot_check check (slot in ('theme','banner','frame','badge','name'));

create table public.set_parts (
  set_id text not null references public.catalog_items (id),
  item_id text not null references public.catalog_items (id),
  primary key (set_id, item_id)
);
alter table public.set_parts enable row level security;
revoke all on public.set_parts from public, anon, authenticated;
grant select on public.set_parts to anon, authenticated;
grant all on public.set_parts to service_role;
create policy set_parts_read on public.set_parts for select to anon, authenticated using (true);

-- On sale now: active, priced, not earned, inside its window. Sets are sold by purchase_set.
create function private.on_sale(c public.catalog_items) returns boolean language sql stable set search_path = '' as $$
  select c.active and not c.is_default and c.award is null
     and (c.available_from is null or now() >= c.available_from)
     and (c.available_until is null or now() < c.available_until);
$$;

-- ---------------------------------------------------------------- the items
insert into public.catalog_items (id, type, name, description, price, award, award_coins) values
 ('badge-supporter-bronze','badge','Bronze supporter','Earned when your top-ups reach 500 coins. Thank you for keeping Lightning free.',0,'supporter',500),
 ('badge-supporter-silver','badge','Silver supporter','Earned when your top-ups reach 2,500 coins.',0,'supporter',2500),
 ('badge-supporter-gold','badge','Gold supporter','Earned when your top-ups reach 10,000 coins.',0,'supporter',10000),
 ('badge-founding','badge','Founding supporter','For the first 100 members who ever topped up. It never comes back.',0,'founding',null);

insert into public.catalog_items (id, type, name, description, price, tier) values
 ('name-gold','name','Gold name','Your name in warm gold.',150,null),
 ('name-nile','name','Nile name','Your name in Nile blue.',150,null),
 ('name-sunset','name','Sunset name','Your name in a dusk gradient, orange to violet.',300,null),
 ('name-shimmer','name','Shimmer name','A slow gold light passes over your name. Still when your device asks for less motion.',500,'motion'),
 ('banner-nile-flow','banner','Nile at night','Gold light drifting on dark water. One slow motion; still when your device asks for less motion.',350,'motion'),
 ('banner-drift','banner','Drifting stars','A night sky that turns very slowly. Still when your device asks for less motion.',300,'motion');

insert into public.catalog_items (id, type, name, description, price, available_from, available_until) values
 ('banner-cotton-harvest','banner','Cotton harvest','Egyptian cotton in the autumn field. Harvest season only.',200,
   timestamp '2026-10-20 00:00' at time zone 'Africa/Cairo', timestamp '2026-11-21 00:00' at time zone 'Africa/Cairo'),
 ('badge-cotton-boll','badge','Cotton boll','A small open boll. Harvest season only.',100,
   timestamp '2026-10-20 00:00' at time zone 'Africa/Cairo', timestamp '2026-11-21 00:00' at time zone 'Africa/Cairo'),
 ('banner-new-year-2027','banner','New Year 2027','Fireworks over the Nile for 2027. On sale over the new year only.',200,
   timestamp '2026-12-20 00:00' at time zone 'Africa/Cairo', timestamp '2027-01-08 00:00' at time zone 'Africa/Cairo'),
 ('banner-ramadan-2027','banner','Ramadan lanterns','Fanous lanterns on a night street. Ramadan 2027 only.',250,
   timestamp '2027-02-01 00:00' at time zone 'Africa/Cairo', timestamp '2027-03-13 00:00' at time zone 'Africa/Cairo'),
 ('badge-lantern','badge','Fanous','A small Ramadan lantern. Ramadan 2027 only.',120,
   timestamp '2027-02-01 00:00' at time zone 'Africa/Cairo', timestamp '2027-03-13 00:00' at time zone 'Africa/Cairo'),
 ('banner-sham-el-nessim-2027','banner','Sham el-Nessim','Spring on the Nile bank. Sham el-Nessim 2027 only.',200,
   timestamp '2027-04-26 00:00' at time zone 'Africa/Cairo', timestamp '2027-05-11 00:00' at time zone 'Africa/Cairo');

-- A set's own price is the full price of its parts; the price you pay is 80% of the parts you do not own yet.
insert into public.catalog_items (id, type, name, description, price) values
 ('set-nile','set','Nile set','Nile theme, Nile at night banner, Nile frame and Nile name.',880),
 ('set-dusk','set','Dusk set','Garnet theme, Dusk banner, Gold ring and Sunset name.',850),
 ('set-cotton','set','Cotton set','Cotton theme, Dunes banner, Halo ring and Coin badge.',890);
insert into public.set_parts (set_id, item_id) values
 ('set-nile','nile'),('set-nile','banner-nile-flow'),('set-nile','frame-nile'),('set-nile','name-nile'),
 ('set-dusk','garnet'),('set-dusk','banner-dusk'),('set-dusk','frame-gold'),('set-dusk','name-sunset'),
 ('set-cotton','cotton'),('set-cotton','banner-dunes'),('set-cotton','frame-halo'),('set-cotton','badge-coin');

create function private.set_price(p_set text, p_user uuid) returns integer language sql stable security definer set search_path = '' as $$
  select ((coalesce(sum(c.price), 0) * 8 + 9) / 10)::integer
  from public.set_parts s join public.catalog_items c on c.id = s.item_id
  where s.set_id = p_set and not c.is_default
    and not exists (select 1 from public.inventory i where i.user_id = p_user and i.item_id = c.id);
$$;
revoke all on function private.set_price(text, uuid), private.on_sale(public.catalog_items) from public, anon, authenticated;

-- ---------------------------------------------------------------- buying
create or replace function public.purchase_item(p_item_id text, p_idempotency_key text)
returns public.purchases language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  item public.catalog_items;
  w public.wallets;
  e public.ledger_entries;
  p public.purchases;
begin
  if uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'idempotency key must be 8 to 100 characters';
  end if;
  -- Lock the wallet first: concurrent requests from one member run one at a time.
  select * into w from public.wallets where user_id = uid for update;
  if not found then raise exception 'insufficient coins' using errcode = 'P0001'; end if;
  select * into p from public.purchases where user_id = uid and idempotency_key = p_idempotency_key;
  if found then
    if p.item_id <> p_item_id then raise exception 'idempotency key already used for a different item'; end if;
    return p;
  end if;
  select * into item from public.catalog_items where id = p_item_id and active;
  if not found then raise exception 'item not available'; end if;
  if item.is_default then raise exception 'item is free and always available'; end if;
  if item.award is not null then raise exception 'this badge is earned, not sold'; end if;
  if item.type = 'set' then raise exception 'buy a set as a set'; end if;
  if not private.on_sale(item) then raise exception 'not on sale now'; end if;
  if exists (select 1 from public.inventory where user_id = uid and item_id = item.id) then raise exception 'already owned'; end if;
  if w.balance < item.price then raise exception 'insufficient coins' using errcode = 'P0001'; end if;
  e := private.post_ledger(uid, 'purchase', 0, -item.price, 'purchase', item.id, 'primary',
    'Purchased ' || item.name, 'purchase:' || uid::text || ':' || p_idempotency_key, now(), null, uid);
  insert into public.purchases (user_id, item_id, price_paid, ledger_entry_id, idempotency_key)
  values (uid, item.id, item.price, e.id, p_idempotency_key) returning * into p;
  insert into public.inventory (user_id, item_id, purchase_id) values (uid, item.id, p.id);
  return p;
end $$;

create function public.purchase_set(p_set_id text, p_expected_price integer, p_idempotency_key text)
returns public.purchases language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); s public.catalog_items; w public.wallets; e public.ledger_entries; p public.purchases; cost integer;
begin
  perform private.require_active_session();
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'idempotency key must be 8 to 100 characters';
  end if;
  select * into w from public.wallets where user_id = uid for update;
  if not found then raise exception 'insufficient coins' using errcode = 'P0001'; end if;
  select * into p from public.purchases where user_id = uid and idempotency_key = p_idempotency_key;
  if found then
    if p.item_id <> p_set_id then raise exception 'idempotency key already used for a different item'; end if;
    return p;
  end if;
  select * into s from public.catalog_items where id = p_set_id and type = 'set' and active;
  if not found then raise exception 'set not available'; end if;
  if exists (select 1 from public.set_parts sp join public.catalog_items c on c.id = sp.item_id
             where sp.set_id = s.id and not (c.is_default or private.on_sale(c)
               or exists (select 1 from public.inventory i where i.user_id = uid and i.item_id = c.id))) then
    raise exception 'part of this set is not on sale now';
  end if;
  cost := private.set_price(s.id, uid);
  if cost <= 0 or exists (select 1 from public.inventory where user_id = uid and item_id = s.id) then raise exception 'you already own every part of this set'; end if;
  if cost is distinct from p_expected_price then raise exception 'price changed; reload the market before buying'; end if;
  if w.balance < cost then raise exception 'insufficient coins' using errcode = 'P0001'; end if;
  e := private.post_ledger(uid, 'purchase', 0, -cost, 'purchase', s.id, 'primary', 'Purchased ' || s.name,
    'purchase:' || uid::text || ':' || p_idempotency_key, now(), null, uid);
  insert into public.purchases (user_id, item_id, price_paid, ledger_entry_id, idempotency_key)
  values (uid, s.id, cost, e.id, p_idempotency_key) returning * into p;
  insert into public.inventory (user_id, item_id, purchase_id)
  select uid, sp.item_id, p.id from public.set_parts sp join public.catalog_items c on c.id = sp.item_id
  where sp.set_id = s.id and not c.is_default on conflict (user_id, item_id) do nothing;
  insert into public.inventory (user_id, item_id, purchase_id) values (uid, s.id, p.id);
  return p;
end $$;
revoke all on function public.purchase_set(text, integer, text) from public, anon;
grant execute on function public.purchase_set(text, integer, text) to authenticated;

-- ---------------------------------------------------------------- supporter badges
-- Topped-up coins are the sum of credited top-ups. Badges are kept once earned.
create function private.grant_supporter_badges(p_user uuid) returns void language plpgsql security definer set search_path = '' as $$
declare total bigint;
begin
  select coalesce(sum(wallet_delta), 0) into total from public.ledger_entries where user_id = p_user and kind = 'paid_topup';
  if total <= 0 then return; end if;
  insert into public.inventory (user_id, item_id)
  select p_user, c.id from public.catalog_items c where c.award = 'supporter' and c.award_coins <= total
  on conflict (user_id, item_id) do nothing;
  -- the first 100 payers, in the order their first top-up was credited; one lock so the cap holds under concurrency
  perform pg_advisory_xact_lock(hashtext('lightning:founding-supporter'));
  if not exists (select 1 from public.inventory where user_id = p_user and item_id = 'badge-founding')
     and (select count(*) from public.inventory where item_id = 'badge-founding') < 100 then
    insert into public.inventory (user_id, item_id) values (p_user, 'badge-founding');
  end if;
end $$;
create function private.on_paid_topup() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.grant_supporter_badges(new.user_id); return null; end $$;
create trigger ledger_supporter_badges after insert on public.ledger_entries
  for each row when (new.kind = 'paid_topup') execute function private.on_paid_topup();
revoke all on function private.grant_supporter_badges(uuid), private.on_paid_topup() from public, anon, authenticated;

-- members who already paid, oldest first
do $$ declare u record; begin
  for u in select user_id from public.ledger_entries where kind = 'paid_topup' group by user_id order by min(id) loop
    perform private.grant_supporter_badges(u.user_id);
  end loop;
end $$;

create function public.supporter_status() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'topped_up_coins', (select coalesce(sum(wallet_delta), 0) from public.ledger_entries where user_id = auth.uid() and kind = 'paid_topup'),
    'tiers', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'coins', c.award_coins,
               'owned', exists (select 1 from public.inventory i where i.user_id = auth.uid() and i.item_id = c.id)) order by c.award_coins), '[]'::jsonb)
              from public.catalog_items c where c.award = 'supporter'),
    'founding_left', greatest(0, 100 - (select count(*) from public.inventory where item_id = 'badge-founding')),
    'founding_owned', exists (select 1 from public.inventory i where i.user_id = auth.uid() and i.item_id = 'badge-founding'));
$$;
revoke all on function public.supporter_status() from public;
grant execute on function public.supporter_status() to anon, authenticated, service_role;

-- ---------------------------------------------------------------- gifts
create table public.gifts (
  id bigint generated always as identity primary key,
  from_user uuid references auth.users (id) on delete set null,
  to_user uuid not null references auth.users (id) on delete cascade,
  item_id text not null references public.catalog_items (id),
  price_paid integer not null check (price_paid > 0),
  ledger_entry_id bigint not null unique references public.ledger_entries (id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (from_user, idempotency_key)
);
create index gifts_to_user on public.gifts (to_user, created_at desc);
alter table public.gifts enable row level security;
revoke all on public.gifts from public, anon, authenticated;
grant all on public.gifts to service_role;

create function public.gift_item(p_item_id text, p_recipient text, p_expected_price integer, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); item public.catalog_items; w public.wallets; e public.ledger_entries; g public.gifts; them public.member_profiles;
begin
  perform private.require_active_session();
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'idempotency key must be 8 to 100 characters';
  end if;
  select * into w from public.wallets where user_id = uid for update;
  if not found then raise exception 'insufficient coins' using errcode = 'P0001'; end if;
  select * into g from public.gifts where from_user = uid and idempotency_key = p_idempotency_key;
  if found then
    if g.item_id <> p_item_id then raise exception 'idempotency key already used for a different item'; end if;
    return jsonb_build_object('status', 'sent', 'item_id', g.item_id);
  end if;
  select * into them from public.member_profiles where lower(display_name) = lower(btrim(coalesce(p_recipient, '')));
  if not found or them.suspended or not them.adult_confirmed then raise exception 'no member with that display name'; end if;
  if them.user_id = uid then raise exception 'buy it for yourself from the market instead'; end if;
  select * into item from public.catalog_items where id = p_item_id;
  if not found or item.type = 'set' or not private.on_sale(item) then raise exception 'this item cannot be given now'; end if;
  if item.price is distinct from p_expected_price then raise exception 'price changed; reload the market before buying'; end if;
  if exists (select 1 from public.inventory where user_id = them.user_id and item_id = item.id) then raise exception 'they already have it'; end if;
  if (select count(*) from public.gifts where from_user = uid and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'gift limit reached for today';
  end if;
  if w.balance < item.price then raise exception 'insufficient coins' using errcode = 'P0001'; end if;
  e := private.post_ledger(uid, 'purchase', 0, -item.price, 'gift', item.id, 'primary',
    'Gift: ' || item.name || ' for ' || them.display_name, 'gift:' || uid::text || ':' || p_idempotency_key, now(), null, uid);
  insert into public.gifts (from_user, to_user, item_id, price_paid, ledger_entry_id, idempotency_key)
  values (uid, them.user_id, item.id, item.price, e.id, p_idempotency_key) returning * into g;
  insert into public.inventory (user_id, item_id) values (them.user_id, item.id);
  return jsonb_build_object('status', 'sent', 'item_id', item.id, 'to', them.display_name);
end $$;
revoke all on function public.gift_item(text, text, integer, text) from public, anon;
grant execute on function public.gift_item(text, text, integer, text) to authenticated;

create function public.my_gifts() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'received', (select coalesce(jsonb_agg(jsonb_build_object('item_id', g.item_id, 'item', c.name, 'type', c.type,
                   'from', coalesce(m.display_name, 'A former member'), 'at', g.created_at) order by g.created_at desc), '[]'::jsonb)
                 from public.gifts g join public.catalog_items c on c.id = g.item_id left join public.member_profiles m on m.user_id = g.from_user
                 where g.to_user = auth.uid()),
    'sent', (select coalesce(jsonb_agg(jsonb_build_object('item_id', g.item_id, 'item', c.name, 'type', c.type,
               'to', coalesce(m.display_name, 'A former member'), 'coins', g.price_paid, 'at', g.created_at) order by g.created_at desc), '[]'::jsonb)
             from public.gifts g join public.catalog_items c on c.id = g.item_id left join public.member_profiles m on m.user_id = g.to_user
             where g.from_user = auth.uid()));
$$;
revoke all on function public.my_gifts() from public, anon;
grant execute on function public.my_gifts() to authenticated;

-- ---------------------------------------------------------------- the next theme: supporters vote
create table public.theme_poll_options (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 200),
  sort integer not null default 0,
  active boolean not null default true
);
create table public.theme_votes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  option_id text not null references public.theme_poll_options (id),
  voted_at timestamptz not null default now()
);
alter table public.theme_poll_options enable row level security;
alter table public.theme_votes enable row level security;
revoke all on public.theme_poll_options, public.theme_votes from public, anon, authenticated;
grant all on public.theme_poll_options, public.theme_votes to service_role;
insert into public.theme_poll_options (id, name, description, sort) values
 ('lotus','Lotus','Pink lotus on deep teal water.',1),
 ('sinai','Sinai dawn','Red granite and a pale desert sunrise.',2),
 ('alexandria','Alexandria','Sea blue and warm limestone.',3),
 ('khan','Khan el-Khalili','Brass lamps and copper light.',4);

create function private.is_supporter(p_user uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.inventory i join public.catalog_items c on c.id = i.item_id where i.user_id = p_user and c.award is not null);
$$;
revoke all on function private.is_supporter(uuid) from public, anon, authenticated;

create function public.theme_poll() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'description', o.description,
                  'votes', (select count(*) from public.theme_votes v where v.option_id = o.id)) order by o.sort, o.name), '[]'::jsonb)
                from public.theme_poll_options o where o.active),
    'my_vote', (select v.option_id from public.theme_votes v where v.user_id = auth.uid()),
    'can_vote', auth.uid() is not null and private.is_supporter(auth.uid()));
$$;
create function public.vote_theme(p_option text) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_active_session();
  if not private.is_supporter(auth.uid()) then raise exception 'supporters vote: top up once to earn a supporter badge' using errcode = '42501'; end if;
  if not exists (select 1 from public.theme_poll_options where id = p_option and active) then raise exception 'not a choice in this vote'; end if;
  insert into public.theme_votes (user_id, option_id) values (auth.uid(), p_option)
  on conflict (user_id) do update set option_id = excluded.option_id, voted_at = now();
  return public.theme_poll();
end $$;
revoke all on function public.theme_poll(), public.vote_theme(text) from public;
grant execute on function public.theme_poll() to anon, authenticated, service_role;
grant execute on function public.vote_theme(text) to authenticated;

-- ---------------------------------------------------------------- reading the look back
drop function public.market_catalog();
create function public.market_catalog()
returns table (
  id text, type text, name text, description text, price integer,
  is_default boolean, asset_version integer, owned boolean, equipped boolean, tier text,
  award text, award_coins integer, available_from timestamptz, available_until timestamptz, parts text[], set_price integer
)
language sql stable security definer set search_path = '' as $$
  with me as (select i.item_id from public.inventory i where i.user_id = auth.uid())
  select c.id, c.type, c.name, c.description, c.price, c.is_default, c.asset_version,
    (auth.uid() is not null and (c.is_default or exists (select 1 from me where me.item_id = c.id))) as owned,
    (auth.uid() is not null and exists (select 1 from public.equipped_items e
       where e.user_id = auth.uid() and e.slot = c.type and e.item_id = c.id)) as equipped,
    c.tier, c.award, c.award_coins, c.available_from, c.available_until,
    case when c.type = 'set' then (select array_agg(sp.item_id order by sp.item_id) from public.set_parts sp where sp.set_id = c.id) end,
    case when c.type = 'set' then private.set_price(c.id, auth.uid()) end
  from public.catalog_items c
  where (c.active and (c.available_from is null or now() >= c.available_from) and (c.available_until is null or now() < c.available_until))
     or exists (select 1 from me where me.item_id = c.id)
  order by case c.type when 'set' then 0 when 'theme' then 1 when 'banner' then 2 when 'frame' then 3 when 'name' then 4 else 5 end,
           c.price, c.name;
$$;
revoke all on function public.market_catalog() from public;
grant execute on function public.market_catalog() to anon, authenticated, service_role;

create or replace view public.profile_directory as
select m.display_name,m.avatar_url,m.bio,m.visibility,
  case when m.show_setup then m.setup_editor end as setup_editor,
  case when m.show_setup then m.setup_os end as setup_os,
  case when m.show_setup then m.setup_languages end as setup_languages,
  case when m.show_setup then m.setup_tools end as setup_tools,
  case when m.show_setup then m.setup_notes end as setup_notes,
  case when m.show_setup then m.dotfiles_url end as dotfiles_url,
  case when m.show_setup then m.portfolio_url end as portfolio_url,
  case when m.show_on_leaderboard then w.contribution_score end as contribution_score,
  (select e.item_id from public.equipped_items e where e.user_id=m.user_id and e.slot='banner') as banner_item_id,
  (select e.item_id from public.equipped_items e where e.user_id=m.user_id and e.slot='frame') as frame_item_id,
  (select e.item_id from public.equipped_items e where e.user_id=m.user_id and e.slot='badge') as badge_item_id,
  (select e.item_id from public.equipped_items e where e.user_id=m.user_id and e.slot='name') as name_item_id
from public.member_profiles m left join public.wallets w on w.user_id=m.user_id
where not m.suspended and (m.visibility='public' or (m.visibility='members' and exists(select 1 from public.member_profiles current_member where current_member.user_id=auth.uid())));

drop function public.member_directory(integer, integer);
create function public.member_directory(p_limit integer default 24, p_offset integer default 0)
returns table(display_name text, avatar_url text, bio text, setup_editor text, setup_os text, setup_languages text[], setup_tools text[],
  contribution_score integer, banner_item_id text, frame_item_id text, badge_item_id text, name_item_id text)
language sql stable security definer set search_path = '' as $$
 select d.display_name,d.avatar_url,d.bio,d.setup_editor,d.setup_os,d.setup_languages,d.setup_tools,d.contribution_score,
  d.banner_item_id,d.frame_item_id,d.badge_item_id,d.name_item_id
 from public.profile_directory d order by d.contribution_score desc nulls last,lower(d.display_name),d.display_name
 limit least(greatest(coalesce(p_limit,24),1),60) offset greatest(coalesce(p_offset,0),0);
$$;

drop function public.get_profile(text);
create function public.get_profile(p_name text)
returns table(display_name text, avatar_url text, bio text, visibility text, setup_editor text, setup_os text, setup_languages text[],
  setup_tools text[], setup_notes text, dotfiles_url text, portfolio_url text, contribution_score integer, banner_item_id text,
  rank_all bigint, rank_month bigint, frame_item_id text, badge_item_id text, name_item_id text)
language sql stable security definer set search_path = '' as $$
 with d as(
  select d.* from public.profile_directory d where lower(d.display_name)=lower(p_name)
  union all
  select m.display_name,m.avatar_url,m.bio,m.visibility,m.setup_editor,m.setup_os,m.setup_languages,m.setup_tools,m.setup_notes,m.dotfiles_url,m.portfolio_url,
   case when m.show_on_leaderboard then w.contribution_score end,
   (select e.item_id from public.equipped_items e where e.user_id=m.user_id and e.slot='banner'),
   (select e.item_id from public.equipped_items e where e.user_id=m.user_id and e.slot='frame'),
   (select e.item_id from public.equipped_items e where e.user_id=m.user_id and e.slot='badge'),
   (select e.item_id from public.equipped_items e where e.user_id=m.user_id and e.slot='name')
  from public.member_profiles m left join public.wallets w on w.user_id=m.user_id
  where m.user_id=auth.uid() and not m.suspended and lower(m.display_name)=lower(p_name))
 select d.display_name,d.avatar_url,d.bio,d.visibility,d.setup_editor,d.setup_os,d.setup_languages,d.setup_tools,d.setup_notes,d.dotfiles_url,d.portfolio_url,
  d.contribution_score,d.banner_item_id,
  case when d.contribution_score is not null then(select r.rank from private.leaderboard_ranks('all') r where lower(r.display_name)=lower(d.display_name))end,
  case when d.contribution_score is not null then(select r.rank from private.leaderboard_ranks('month') r where lower(r.display_name)=lower(d.display_name))end,
  d.frame_item_id,d.badge_item_id,d.name_item_id
 from d limit 1;
$$;

drop function public.leaderboard(text, integer);
create function public.leaderboard(p_period text default 'all', p_limit integer default 50)
returns table(rank bigint, display_name text, avatar_url text, contribution_count bigint, score bigint,
  frame_item_id text, badge_item_id text, banner_item_id text, name_item_id text)
language plpgsql stable security definer set search_path = '' as $$
declare since timestamptz;
begin
 if p_period not in('all','month') then raise exception 'period must be all or month';end if;
 since:=case when p_period='month' then date_trunc('month',now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' else '-infinity'::timestamptz end;
 return query
 with scores as(
  select m.user_id as uid,m.display_name as dn,m.avatar_url as av,
   count(*) filter(where l.contribution_delta>0) as cnt,sum(l.contribution_delta)::bigint as sc
  from public.ledger_entries l join public.member_profiles m on m.user_id=l.user_id
  where m.show_on_leaderboard and m.adult_confirmed and not m.suspended and l.earned_at>=since
  group by m.user_id,m.display_name,m.avatar_url having sum(l.contribution_delta)>0)
 select(rank() over(order by s.sc desc))::bigint,s.dn,s.av,s.cnt,s.sc,
  (select e.item_id from public.equipped_items e where e.user_id=s.uid and e.slot='frame'),
  (select e.item_id from public.equipped_items e where e.user_id=s.uid and e.slot='badge'),
  (select e.item_id from public.equipped_items e where e.user_id=s.uid and e.slot='banner'),
  (select e.item_id from public.equipped_items e where e.user_id=s.uid and e.slot='name')
 from scores s order by 1,s.dn limit least(greatest(p_limit,1),100);
end $$;
revoke all on function public.leaderboard(text,integer), public.get_profile(text), public.member_directory(integer,integer) from public;
grant execute on function public.leaderboard(text,integer), public.get_profile(text), public.member_directory(integer,integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- your data
create or replace function public.export_my_data() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
 result:=private.export_payment_data_impl();
 return result||jsonb_build_object('bank_transfers',(select coalesce(jsonb_agg(jsonb_build_object('reference',b.reference,'amount_piastres',b.amount_piastres,'received_at',b.received_at,'request_id',b.request_id,'voided',b.voided)),'[]'::jsonb)from public.bank_transfers b join public.topup_requests r on r.id=b.request_id where r.user_id=auth.uid()),'topup_adjustments',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb)from public.topup_adjustments a join public.topup_requests r on r.id=a.request_id where r.user_id=auth.uid()),'payment_returns',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb)from public.payment_returns a join public.topup_requests r on r.id=a.request_id where r.user_id=auth.uid()),
  'gifts',public.my_gifts(),'theme_vote',(select to_jsonb(v) from public.theme_votes v where v.user_id=auth.uid()));
end $$;
