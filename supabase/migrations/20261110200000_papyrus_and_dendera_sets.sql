begin;
-- NF-10D2 (app repo): a set for each animated theme (owner, 2026-11-08, 10D1 option 1). Three matching pieces each,
-- at their tier prices (guideline/themes.md section 7), drawn in css/forgeeks-cosmetics.css: by code, no images, still
-- under reduced motion. A set's own price is the full price of its parts; the buyer pays private.set_price (80% of
-- the parts not owned yet): Papyrus 1,650 listed, 1,320 new; Dendera 1,600 listed, 1,280 new.
insert into public.catalog_items (id, type, name, description, price, tier) values
 ('banner-papyrus-thread','banner','Gold thread','One gold thread running slowly over lapis and papyrus fibres. Still when your device asks for less motion.',300,'motion'),
 ('name-papyrus-gold','name','Papyrus gold name','Your name in Papyrus gold.',150,null),
 ('banner-dendera-zodiac','banner','Zodiac ceiling','The temple''s star ceiling in pigment blue, its zodiac ring turning very slowly. Still when your device asks for less motion.',350,'motion'),
 ('name-pigment-blue','name','Pigment blue name','Your name in Dendera''s pigment blue.',150,null)
on conflict (id) do nothing;
insert into public.catalog_items (id, type, name, description, price) values
 ('frame-gold-foil','frame','Gold foil','A gold-leaf ring with one slow glint. Still when your device asks for less motion.',200),
 ('frame-lotus','frame','Lotus','Pigment blue in an ochre rim, like the temple''s lotus frieze.',100),
 ('set-papyrus','set','Papyrus set','Papyrus theme, Gold thread banner, Gold foil frame and Papyrus gold name.',1650),
 ('set-dendera','set','Dendera set','Dendera theme, Zodiac ceiling banner, Lotus frame and Pigment blue name.',1600)
on conflict (id) do nothing;
insert into public.set_parts (set_id, item_id) values
 ('set-papyrus','papyrus'),('set-papyrus','banner-papyrus-thread'),('set-papyrus','frame-gold-foil'),('set-papyrus','name-papyrus-gold'),
 ('set-dendera','dendera'),('set-dendera','banner-dendera-zodiac'),('set-dendera','frame-lotus'),('set-dendera','name-pigment-blue')
on conflict do nothing;
commit;
