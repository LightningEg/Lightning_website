begin;
-- NF-10H3 (app repo): one purchase per person (owner, 2026-11-09), the website side. A theme bought here unlocks every
-- Lightning profile of that member at no charge, up to 10 (the cap only stops a code being shared; the owner can free a
-- profile in Members). Extra-profile seats at 25% are no longer sold: purchase_theme_seat refuses, and the seats a member
-- already bought stay in theme_seats and seat_purchases as history (10H5 decides on crediting them back).
create or replace function private.profile_cap() returns integer language sql immutable set search_path = '' as $$ select 10 $$;
revoke all on function private.profile_cap() from public, anon, authenticated;

create or replace function public.redeem_activation_code(p_code text, p_item_id text, p_asset_version integer, p_profile_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  code text := lower(replace(btrim(p_code), '-', ''));
  t private.activation_tickets; prof uuid; used integer; fresh boolean := false;
begin
  if code is null or code !~ '^[0-9a-f]{32}$' then raise exception 'invalid or expired activation code'; end if;
  if p_profile_id is null or p_profile_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'the app did not say which profile this is'; end if;
  prof := p_profile_id::uuid;
  select * into t from private.activation_tickets where code_hash = encode(sha256(convert_to(code, 'UTF8')), 'hex') for update;
  if not found or t.expires_at <= now() or t.redeemed_at is not null then raise exception 'invalid or expired activation code'; end if;
  if t.item_id is distinct from p_item_id or t.asset_version is distinct from p_asset_version then
    raise exception 'unsupported bundled item version'; end if;
  if not exists (select 1 from public.bundled_item_versions where item_id = t.item_id and asset_version = t.asset_version and enabled)
     or not exists (select 1 from public.inventory where user_id = t.user_id and item_id = t.item_id) then
    raise exception 'item no longer available for activation'; end if;
  -- A profile that already holds the theme (another device of it) costs nothing; a new one is free up to the cap.
  perform pg_advisory_xact_lock(hashtextextended('seat:' || t.user_id::text || ':' || t.item_id, 0));
  if not exists (select 1 from public.profile_claims where user_id = t.user_id and item_id = t.item_id and profile_id = prof) then
    select count(*) into used from public.profile_claims where user_id = t.user_id and item_id = t.item_id;
    if used >= private.profile_cap() then raise exception 'this purchase already unlocks 10 profiles'; end if;
    insert into public.profile_claims (user_id, item_id, profile_id) values (t.user_id, t.item_id, prof);
    fresh := true;
  end if;
  update private.activation_tickets set redeemed_at = now() where id = t.id;
  insert into public.audit_log(actor, action, target_type, target_id, detail)
  values (t.user_id, 'activation.redeem', 'activation', t.id::text, jsonb_build_object('item_id', t.item_id, 'new_profile', fresh));
  return jsonb_build_object('schema_version', 1, 'account_id', t.user_id, 'profile_id', prof, 'items',
    jsonb_build_array(jsonb_build_object('item_id', t.item_id, 'asset_version', t.asset_version, 'deliveries', '[]'::jsonb)));
end $$;

-- What the member sees: how many profiles wear the theme, out of the cap. Nothing to buy (can_buy and next_price stay for
-- pages cached before this release, always false and null).
create or replace function public.my_theme_seats() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'item_id', i.item_id, 'name', c.name,
        'seats', private.profile_cap(),
        'used', (select count(*) from public.profile_claims pc where pc.user_id = uid and pc.item_id = i.item_id),
        'claimed_at', (select coalesce(jsonb_agg(pc.claimed_at order by pc.claimed_at), '[]'::jsonb) from public.profile_claims pc where pc.user_id = uid and pc.item_id = i.item_id),
        'next_price', null, 'can_buy', false) order by c.name)
      from public.inventory i
      join public.catalog_items c on c.id = i.item_id
     where i.user_id = uid
       and exists (select 1 from public.bundled_item_versions b where b.item_id = i.item_id and b.enabled)), '[]'::jsonb);
end $$;

create or replace function public.purchase_theme_seat(p_item_id text, p_expected_price integer, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'another profile needs no purchase: one theme unlocks up to 10 profiles';
end $$;

create or replace function public.admin_profile_claims(p_email text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid;
begin
  perform private.require_mfa_admin();
  select id into uid from auth.users where lower(email) = lower(btrim(coalesce(p_email, '')));
  if uid is null then raise exception 'no member with that email'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', pc.id, 'item_id', pc.item_id, 'name', c.name, 'claimed_at', pc.claimed_at,
                     'seats', private.profile_cap()) order by pc.claimed_at)
                   from public.profile_claims pc join public.catalog_items c on c.id = pc.item_id where pc.user_id = uid), '[]'::jsonb);
end $$;
commit;
