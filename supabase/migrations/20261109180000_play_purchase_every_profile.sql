begin;
-- NF-10H1 (app repo): one purchase per person (owner, 2026-11-09). Google Play sells a theme once per Google account, so
-- one purchase token now unlocks every app profile opened in the Play build with that account, up to 10 (the cap only
-- stops a token being shared). play_purchases keeps one row per token (the first profile and the order); each profile
-- the token unlocked is a row here. A refunded, cancelled or voided purchase never reaches this function: redeem-play
-- asks Google first. Licences already issued stay, as they work offline.
create table private.play_purchase_profiles (
 token_sha256 text not null references private.play_purchases(token_sha256) on delete cascade,
 profile_id uuid not null,
 created_at timestamptz not null default now(),
 primary key (token_sha256, profile_id)
);
comment on table private.play_purchase_profiles is 'Each app profile a Google Play purchase unlocked (NF-10H1): at most 10 per purchase token.';
revoke all on private.play_purchase_profiles from public, anon, authenticated;
insert into private.play_purchase_profiles (token_sha256, profile_id, created_at)
select token_sha256, profile_id, created_at from private.play_purchases on conflict do nothing;

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
      if used >= 10 then raise exception 'this purchase already unlocks 10 profiles'; end if;
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
commit;
