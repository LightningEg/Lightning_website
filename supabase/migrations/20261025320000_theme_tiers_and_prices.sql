begin;
-- Owner revision (2026-10-25): themes come in tiers, and prices are set for one-time buyers covering about
-- 3,000 EGP of fixed monthly cost at 5 coins per EGP. guideline/themes.md section 7 and docs/payment-operations.md
-- hold the reasoning. Purchases already made keep what they paid; only future prices change.
--   palette  colour only, both sites (app when ready)                 300 coins = 60 EGP
--   texture  palette plus a woven texture behind the page             600 coins = 120 EGP
--   motion   texture plus one signature motion (not on sale yet)     1,000 coins = 200 EGP
alter table public.catalog_items add column tier text check (tier in ('palette', 'texture', 'motion'));
update public.catalog_items set tier = 'palette' where type = 'theme';
alter table public.catalog_items add constraint catalog_items_tier_theme check ((type = 'theme') = (tier is not null));

update public.catalog_items set price = 300 where type = 'theme' and active and not is_default;

insert into public.catalog_items (id, type, name, description, price, is_default, tier) values
  ('papyrus', 'theme', 'Papyrus', 'Nile night and gold over fine papyrus fibres.', 600, false, 'texture'),
  ('cotton',  'theme', 'Cotton',  'Warm paper light over a soft cotton weave.',     600, false, 'texture');

update public.catalog_items set price = case id
  when 'banner-halo' then 100 when 'banner-blueprint' then 120 when 'banner-dusk' then 150
  when 'banner-circuit' then 150 when 'banner-dunes' then 150 when 'banner-borealis' then 200
  when 'frame-halo' then 80 when 'frame-nile' then 80 when 'frame-gold' then 100 when 'frame-double' then 100
  when 'badge-bolt' then 60 when 'badge-coin' then 60 when 'badge-pen' then 80 when 'badge-star' then 100
  else price end
 where type in ('banner', 'frame', 'badge');

drop function public.market_catalog();
create function public.market_catalog()
returns table (
  id text, type text, name text, description text, price integer,
  is_default boolean, asset_version integer, owned boolean, equipped boolean, tier text
)
language sql stable security definer set search_path = '' as $$
  with me as (
    select i.item_id from public.inventory i where i.user_id = auth.uid()
  )
  select
    c.id, c.type, c.name, c.description, c.price, c.is_default, c.asset_version,
    (auth.uid() is not null and (c.is_default or exists (select 1 from me where me.item_id = c.id))) as owned,
    (auth.uid() is not null and exists (
       select 1 from public.equipped_items e
       where e.user_id = auth.uid() and e.slot = c.type and e.item_id = c.id)) as equipped,
    c.tier
  from public.catalog_items c
  where c.active or exists (select 1 from me where me.item_id = c.id)
  order by case c.type when 'theme' then 0 when 'banner' then 1 when 'frame' then 2 else 3 end,
           c.price, c.name;
$$;
revoke all on function public.market_catalog() from public;
grant execute on function public.market_catalog() to anon, authenticated, service_role;

-- The coin rate and bonus steps are public prices: the market shows each item in EGP too, signed in or not.
create function public.coin_rate()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('coins_per_egp', p.coins_per_egp, 'minimum_egp', p.minimum_egp, 'maximum_egp', p.maximum_egp,
    'tiers', (select coalesce(jsonb_agg(jsonb_build_object('minimum_egp', t.minimum_egp, 'bonus_percent', t.bonus_percent) order by t.minimum_egp), '[]'::jsonb)
              from public.coin_bonus_tiers t))
  from public.coin_pricing p where p.id = 1;
$$;
revoke all on function public.coin_rate() from public;
grant execute on function public.coin_rate() to anon, authenticated, service_role;
commit;
