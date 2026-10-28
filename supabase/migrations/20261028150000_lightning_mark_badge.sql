begin;
-- The Bolt badge becomes Lightning's own two-leaf mark (owner, 2026-10-28: a generic bolt is not our logo).
-- Same id, price and owners; js/forgeeks-showcase.js draws it. Buyers keep it.
update public.catalog_items
   set name = 'Lightning mark', description = 'Lightning''s two-leaf mark next to your name.'
 where id = 'badge-bolt';
commit;
