begin;
-- NF-11B3 (app repo): themes bought inside the Google Play build with Play Billing. The redeem-play edge function asks
-- Google whether a purchase token is a real, paid purchase for this profile, then calls this function, which keeps one
-- row per token and returns the same inventory redeem_activation_code returns, so the app verifies the same signed
-- licence. A token unlocks one app profile (the one Play recorded as obfuscatedExternalProfileId); the same profile may
-- ask again (another device, a reinstall). No website account is involved: the licence's account_id is derived from the
-- Play order id. Only the token's SHA-256 is kept, never the token.
create table private.play_purchases (
 token_sha256 text primary key check (token_sha256 ~ '^[0-9a-f]{64}$'),
 order_id text not null check (char_length(order_id) between 1 and 80),
 item_id text not null references public.catalog_items(id),
 asset_version integer not null,
 profile_id uuid not null,
 created_at timestamptz not null default now()
);
comment on table private.play_purchases is 'Google Play purchases redeemed for a theme licence (NF-11B3): token hash, order, theme and the one profile it unlocks.';
revoke all on private.play_purchases from public, anon, authenticated;

create function public.redeem_play_purchase(p_token_sha256 text, p_order_id text, p_item_id text, p_profile_id text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  prof uuid; v integer; rec private.play_purchases;
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
    if rec.profile_id <> prof or rec.item_id <> p_item_id then raise exception 'purchase already used by another profile'; end if;
  else
    insert into private.play_purchases (token_sha256, order_id, item_id, asset_version, profile_id)
    values (p_token_sha256, p_order_id, p_item_id, v, prof);
    insert into public.audit_log(actor, action, target_type, target_id, detail)
    values (null, 'play.redeem', 'play_purchase', left(p_token_sha256, 16), jsonb_build_object('item_id', p_item_id));
  end if;
  return jsonb_build_object('schema_version', 1, 'account_id', md5('play:' || p_order_id)::uuid, 'profile_id', prof, 'items',
    jsonb_build_array(jsonb_build_object('item_id', p_item_id, 'asset_version', v, 'deliveries', '[]'::jsonb)));
end $$;
revoke all on function public.redeem_play_purchase(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.redeem_play_purchase(text, text, text, text, jsonb) to service_role;
commit;
