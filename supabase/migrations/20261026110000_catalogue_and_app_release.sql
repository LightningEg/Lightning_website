begin;
-- Ready to sell (owner, 2026-10-26: "fix the entire thing, i want us to be ready for selling it, figure out the
-- pricing and improve the owner console").
--   1. One theme is one purchase on every surface (guideline/themes.md): the app's themes take the website's ids.
--      nile (palette), cotton (texture) and papyrus (now animated: the app's travelling gold-foil edge) are each
--      one item; buying it dresses both sites, the PC and the phone.
--   2. Prices stay one per tier: palette 300, texture 600, motion 1,000 coins (60, 120, 200 EGP at 5 coins a pound).
--      docs/payment-operations.md holds the reasoning. Nobody has paid yet, so Papyrus moves tier freely.
--   3. Each app theme waits, disabled, in bundled_item_versions until the app version that carries it has shipped;
--      the owner turns it on from the console (admin_set_app_release). Until then no unlock code can be issued.
--   4. The owner console reads and changes the catalogue through MFA-checked functions only.

update public.catalog_items
   set tier = 'motion', price = 1000,
       description = 'Lapis lacquer and gold foil whose light travels the edge, over papyrus fibres.'
 where id = 'papyrus';
update public.catalog_items set description = 'Warm paper and linen, embossed terracotta, ink tabs.' where id = 'cotton';

insert into public.bundled_item_versions (item_id, asset_version, enabled) values
  ('nile', 1, false), ('cotton', 1, false), ('papyrus', 1, false)
on conflict do nothing;

-- ---------------------------------------------------------------- what the owner sees
create function public.admin_catalog() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m0 timestamptz := date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo';
begin
  perform private.require_mfa_admin();
  return jsonb_build_object(
    'coins_per_egp', (select coins_per_egp from public.coin_pricing where id = 1),
    'tiers', (select coalesce(jsonb_object_agg(tier, price), '{}'::jsonb) from (
       select tier, max(price) as price from public.catalog_items
        where type = 'theme' and not is_default and award is null group by tier) t),
    'items', (select coalesce(jsonb_agg(row_to_json(x) order by x.sort, x.price, x.name), '[]'::jsonb) from (
       select c.id, c.type, c.tier, c.name, c.description, c.price, c.active, c.is_default, c.award,
              c.available_from, c.available_until, c.asset_version,
              case c.type when 'set' then 0 when 'theme' then 1 when 'banner' then 2 when 'frame' then 3 when 'name' then 4 else 5 end as sort,
              (select count(*) from public.purchases p where p.item_id = c.id) as sold,
              (select count(*) from public.purchases p where p.item_id = c.id and p.created_at >= m0) as sold_month,
              (select coalesce(sum(p.price_paid), 0) from public.purchases p where p.item_id = c.id) as coins,
              (select count(*) from public.inventory i where i.item_id = c.id) as owners,
              (select coalesce(jsonb_agg(jsonb_build_object('version', b.asset_version, 'enabled', b.enabled) order by b.asset_version), '[]'::jsonb)
                 from public.bundled_item_versions b where b.item_id = c.id) as app,
              case when c.type = 'set' then (select array_agg(sp.item_id order by sp.item_id) from public.set_parts sp where sp.set_id = c.id) end as parts
         from public.catalog_items c) x));
end $$;

-- ---------------------------------------------------------------- changing it
-- A set's listed price follows its parts (80%, rounded up, as private.set_price charges a new buyer).
create function private.refresh_set_prices() returns void language sql security definer set search_path = '' as $$
  update public.catalog_items s
     set price = greatest(1, (select ((coalesce(sum(c.price), 0) * 8 + 9) / 10)::integer
                                from public.set_parts p join public.catalog_items c on c.id = p.item_id
                               where p.set_id = s.id and not c.is_default))
   where s.type = 'set';
$$;

-- A tier keeps one price (themes.md section 7): every paid theme in the tier moves together.
create function public.admin_set_tier_price(p_tier text, p_price integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.require_mfa_admin();
  if p_tier is null or p_tier not in ('palette', 'texture', 'motion') then raise exception 'unknown tier'; end if;
  if p_price is null or p_price < 1 or p_price > 1000000 then raise exception 'a tier price is a positive number of coins'; end if;
  update public.catalog_items set price = p_price
   where type = 'theme' and tier = p_tier and not is_default and award is null;
  get diagnostics n = row_count;
  perform private.refresh_set_prices();
  insert into public.audit_log(actor, action, target_type, target_id, detail)
  values (auth.uid(), 'catalog.tier_price', 'tier', p_tier, jsonb_build_object('price', p_price, 'items', n));
  return n;
end $$;

-- Everything else that is sold is priced one item at a time. Themes follow their tier; sets follow their parts;
-- free defaults and earned badges are never priced.
create function public.admin_set_item_price(p_item_id text, p_price integer) returns void
language plpgsql security definer set search_path = '' as $$
declare item public.catalog_items;
begin
  perform private.require_mfa_admin();
  select * into item from public.catalog_items where id = p_item_id for update;
  if not found then raise exception 'item not found'; end if;
  if item.type = 'theme' then raise exception 'a theme takes its tier price; change the tier'; end if;
  if item.type = 'set' then raise exception 'a set is priced from its parts'; end if;
  if item.is_default or item.award is not null then raise exception 'free and earned items have no price'; end if;
  if p_price is null or p_price < 1 or p_price > 1000000 then raise exception 'a price is a positive number of coins'; end if;
  update public.catalog_items set price = p_price where id = p_item_id;
  perform private.refresh_set_prices();
  insert into public.audit_log(actor, action, target_type, target_id, detail)
  values (auth.uid(), 'catalog.price', 'item', p_item_id, jsonb_build_object('from', item.price, 'price', p_price));
end $$;

-- Retire an item from sale, or offer it again. Owners keep what they bought either way; the free default stays.
create function public.admin_set_item_active(p_item_id text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare item public.catalog_items;
begin
  perform private.require_mfa_admin();
  select * into item from public.catalog_items where id = p_item_id for update;
  if not found then raise exception 'item not found'; end if;
  if item.is_default and not p_active then raise exception 'the free default always stays'; end if;
  update public.catalog_items set active = coalesce(p_active, false) where id = p_item_id;
  insert into public.audit_log(actor, action, target_type, target_id, detail)
  values (auth.uid(), 'catalog.active', 'item', p_item_id, jsonb_build_object('active', coalesce(p_active, false)));
end $$;

-- Turn an app theme's unlock on once the app version that carries it has shipped (or off, to pause new codes).
-- Codes already redeemed keep working: the licence is signed and lives in the app.
create function public.admin_set_app_release(p_item_id text, p_version integer, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_mfa_admin();
  if not exists (select 1 from public.catalog_items where id = p_item_id and type = 'theme') then raise exception 'app themes only'; end if;
  if p_version is null or p_version < 1 then raise exception 'a version is a positive number'; end if;
  insert into public.bundled_item_versions (item_id, asset_version, enabled) values (p_item_id, p_version, coalesce(p_enabled, false))
  on conflict (item_id, asset_version) do update set enabled = excluded.enabled;
  insert into public.audit_log(actor, action, target_type, target_id, detail)
  values (auth.uid(), 'catalog.app_release', 'item', p_item_id, jsonb_build_object('version', p_version, 'enabled', coalesce(p_enabled, false)));
end $$;

revoke all on function public.admin_catalog(), public.admin_set_tier_price(text, integer), public.admin_set_item_price(text, integer),
  public.admin_set_item_active(text, boolean), public.admin_set_app_release(text, integer, boolean) from public, anon;
grant execute on function public.admin_catalog(), public.admin_set_tier_price(text, integer), public.admin_set_item_price(text, integer),
  public.admin_set_item_active(text, boolean), public.admin_set_app_release(text, integer, boolean) to authenticated;
revoke all on function private.refresh_set_prices() from public, anon, authenticated;
commit;
