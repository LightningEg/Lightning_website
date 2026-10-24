-- For Geeks cosmetics marketplace (FG-08): the first paid items and the catalog read for the market page.
-- Proposal: docs/proposals/forgeeks-accounts-lightning-coins.md, "Cosmetic marketplace".
--
-- Rules, all already enforced by the core migration and relied on here:
--   * Cosmetics only. Nothing sold here unlocks a feature, access or ranking.
--   * Coins are earned, never bought. Spending lowers the wallet balance, never the contribution score.
--   * The server decides the price: purchase_item() reads it from catalog_items, the browser sends only an item id.
--   * The twelve themes seeded in the core migration stay free (is_default) and always equippable.
--
-- Prices are whole coins. Rewards are roughly 25 (small), 75 (medium) and 200 (large) coins a task, so
-- banners cost 40 to 120 (a small task to about half a large one) and themes 150 to 250.

insert into public.catalog_items (id, type, name, description, price) values
  ('moss',             'theme',  'Moss',      'Dark olive and lime',                                                                150),
  ('garnet',           'theme',  'Garnet',    'Wine red and cream',                                                                 200),
  ('frost',            'theme',  'Frost',     'Cool light, slate and indigo',                                                       250),
  ('banner-halo',      'banner', 'Halo',      'A soft glow in the colours of the theme it is seen in.',                              40),
  ('banner-blueprint', 'banner', 'Blueprint', 'A fine grid on deep blue.',                                                           50),
  ('banner-dusk',      'banner', 'Dusk',      'Indigo sky fading to a low orange sun.',                                              70),
  ('banner-circuit',   'banner', 'Circuit',   'Copper traces on graphite.',                                                          90),
  ('banner-dunes',     'banner', 'Dunes',     'Three sand dunes in warm light.',                                                    100),
  ('banner-borealis',    'banner', 'Borealis',    'Teal and violet light drifting over a night sky. It moves slowly and is still with reduced motion.', 120)
on conflict (id) do nothing;

-- The market page reads the catalog through this function. One call gives everything it draws:
--   * active items, plus retired items the caller still owns (retired items stay usable for their owners);
--   * for a signed-in caller, owned (free items count as owned) and equipped, from that caller's own rows;
--   * for anyone else, owned and equipped are false.
-- It never returns another member's data. Themes first, then banners, cheapest first.
create function public.market_catalog()
returns table (
  id text, type text, name text, description text, price integer,
  is_default boolean, asset_version integer, owned boolean, equipped boolean
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
       where e.user_id = auth.uid() and e.slot = c.type and e.item_id = c.id)) as equipped
  from public.catalog_items c
  where c.active or exists (select 1 from me where me.item_id = c.id)
  order by case c.type when 'theme' then 0 when 'banner' then 1 when 'frame' then 2 else 3 end,
           c.price, c.name;
$$;

revoke all on function public.market_catalog() from public;
grant execute on function public.market_catalog() to anon, authenticated, service_role;
