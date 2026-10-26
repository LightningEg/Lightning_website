begin;
-- Dendera (owner, 2026-10-26: "improve and build out the full plan ... add it to the website"). The second animated
-- theme: temple pigments on aged papyrus (lapis, kenit gold, mefkat turquoise, desher red ochre), a lotus-bud frieze
-- and one slow pigment thread along the header; the app adds the zodiac ring, the winged sun disc and a night mode
-- (dendera-night), which the app wears with this same item's licence. One purchase dresses both sites, the PC and
-- the phone (guideline/themes.md). It sits in the animated tier at that tier's one price (1,000 coins = 200 EGP).
-- The app version that carries it waits disabled until it ships; the owner turns it on (admin_set_app_release).

insert into public.catalog_items (id, type, name, description, price, is_default, tier) values
  ('dendera', 'theme', 'Dendera', 'Temple pigments on aged papyrus, a lotus frieze and a slow pigment thread; the star ceiling by night.',
   (select coalesce(max(price), 1000) from public.catalog_items where type = 'theme' and tier = 'motion' and not is_default and award is null),
   false, 'motion')
on conflict (id) do nothing;

insert into public.bundled_item_versions (item_id, asset_version, enabled) values ('dendera', 1, false)
on conflict do nothing;

commit;
