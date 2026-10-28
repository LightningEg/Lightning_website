begin;
-- Two new animated banners (owner, 2026-10-28: option b, keep the tiers and add motion to sell). Drawn in
-- css/forgeeks-cosmetics.css; one slow motion each, still under reduced motion. Motion-tier banner prices: 300-350.
insert into public.catalog_items (id, type, name, description, price, tier) values
 ('banner-felucca','banner','Felucca','A white sail crossing the Nile at sunset, once every forty seconds. Still when your device asks for less motion.',350,'motion'),
 ('banner-sandwind','banner','Sand wind','Gusts of light running over the dunes. Still when your device asks for less motion.',300,'motion')
on conflict (id) do nothing;
commit;
