begin;
-- Owner revision (2026-10-25): five palettes for sale while each is made to work on both sites, the rest archived.
-- Sold: Paper, Frost, Meadow, Nile, Garnet (Mono stays free). Archived items leave the market and cannot be bought
-- (purchase_item_at_price reads only active items), but members who own one keep it, see it and can equip it
-- (market_catalog and equip_item honour ownership). Bring one back with: update ... set active = true.
update public.catalog_items set active = false
 where type = 'theme' and id in ('ocean', 'tokyo', 'dracula', 'rose', 'synthwave', 'phosphor', 'amber', 'solarized', 'moss');
commit;
