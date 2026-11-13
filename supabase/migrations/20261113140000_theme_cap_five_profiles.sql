begin;
-- Owner, 2026-11-11 (app NF-10H): one theme purchase unlocks up to 5 profiles, not 10, on the website and on Google Play
-- alike. Five covers a person's real books (their own, a spouse's, a parent's they manage, a side business, a test
-- profile); ten let one website code dress ten friends. Profiles already past five keep their licences (they work
-- offline and are never taken back); only a sixth new profile is refused. The owner can still free a profile in
-- Catalogue > Free a profile. Play purchases now read the same cap instead of their own literal 10.
create or replace function private.profile_cap() returns integer language sql immutable set search_path = '' as $$ select 5 $$;
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
    if used >= private.profile_cap() then raise exception 'this purchase already unlocks % profiles', private.profile_cap(); end if;
    insert into public.profile_claims (user_id, item_id, profile_id) values (t.user_id, t.item_id, prof);
    fresh := true;
  end if;
  update private.activation_tickets set redeemed_at = now() where id = t.id;
  insert into public.audit_log(actor, action, target_type, target_id, detail)
  values (t.user_id, 'activation.redeem', 'activation', t.id::text, jsonb_build_object('item_id', t.item_id, 'new_profile', fresh));
  return jsonb_build_object('schema_version', 1, 'account_id', t.user_id, 'profile_id', prof, 'items',
    jsonb_build_array(jsonb_build_object('item_id', t.item_id, 'asset_version', t.asset_version, 'deliveries', '[]'::jsonb)));
end $$;

create or replace function public.redeem_play_purchase(p_token_sha256 text, p_order_id text, p_item_id text, p_profile_id text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  prof uuid; v integer; rec private.play_purchases; used integer;
begin
  if p_token_sha256 is null or p_token_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid purchase'; end if;
  if p_order_id is null or char_length(p_order_id) not between 1 and 80 then raise exception 'invalid purchase'; end if;
  if p_profile_id is null or p_profile_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'the app did not say which profile this is'; end if;
  prof := p_profile_id::uuid;
  -- The version the app carries for this theme; an app that does not carry it cannot wear it.
  select (i->>'asset_version')::integer into v from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
   where i->>'item_id' = p_item_id limit 1;
  if v is null or not exists (select 1 from public.bundled_item_versions where item_id = p_item_id and asset_version = v and enabled) then
    raise exception 'unsupported bundled item version'; end if;
  select * into rec from private.play_purchases where token_sha256 = p_token_sha256 for update;
  if found then
    if rec.item_id <> p_item_id then raise exception 'invalid purchase'; end if;
    if not exists (select 1 from private.play_purchase_profiles where token_sha256 = p_token_sha256 and profile_id = prof) then
      select count(*) into used from private.play_purchase_profiles where token_sha256 = p_token_sha256;
      if used >= private.profile_cap() then raise exception 'this purchase already unlocks % profiles', private.profile_cap(); end if;
      insert into private.play_purchase_profiles (token_sha256, profile_id) values (p_token_sha256, prof);
      insert into public.audit_log(actor, action, target_type, target_id, detail)
      values (null, 'play.redeem_profile', 'play_purchase', left(p_token_sha256, 16), jsonb_build_object('item_id', p_item_id, 'profiles', used + 1));
    end if;
  else
    insert into private.play_purchases (token_sha256, order_id, item_id, asset_version, profile_id)
    values (p_token_sha256, p_order_id, p_item_id, v, prof);
    insert into private.play_purchase_profiles (token_sha256, profile_id) values (p_token_sha256, prof);
    insert into public.audit_log(actor, action, target_type, target_id, detail)
    values (null, 'play.redeem', 'play_purchase', left(p_token_sha256, 16), jsonb_build_object('item_id', p_item_id));
  end if;
  return jsonb_build_object('schema_version', 1, 'account_id', md5('play:' || coalesce(rec.order_id, p_order_id))::uuid,
    'profile_id', prof, 'items',
    jsonb_build_array(jsonb_build_object('item_id', p_item_id, 'asset_version', v, 'deliveries', '[]'::jsonb)));
end $$;
revoke all on function public.redeem_play_purchase(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.redeem_play_purchase(text, text, text, text, jsonb) to service_role;

create or replace function public.purchase_theme_seat(p_item_id text, p_expected_price integer, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'another profile needs no purchase: one theme unlocks up to 5 profiles';
end $$;
commit;
