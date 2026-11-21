begin;
-- NF-10H6 (app repo): a Google Play purchase reaches the buyer's website account through the profile id (owner,
-- 2026-11-11: link by the profile id, never by Google sign-in; Play never tells us the buyer's Google account).
--
-- 1. The account page's "Link the app" issues a link code (issue_profile_link_code): ten minutes, single use, only its
--    hash kept, the activation-ticket pattern in reverse.
-- 2. The app (PC or GitHub APK; the Play build never names the website) sends the code with its profile id to the
--    link-profile function, which calls link_app_profile.
-- 3. The profile is recorded under that account (private.profile_accounts; one account per profile), and every Play
--    purchase that unlocked the profile and was not refunded adds its theme to the account's inventory as owned through
--    Play (inventory.source = 'play') with a profile claim, inside the same cap of 5 as website purchases. The site
--    wears it, the marketplace says Owned, Get app code works for it. A later Play purchase on a linked profile reaches
--    the account the same way (redeem_play_purchase).
-- 4. A refund or void found later by redeem-play (void_play_purchase) marks the purchase refunded and removes the
--    inventory row it gave, unless a website purchase or another live Play purchase still owns that theme. Licences
--    already issued stay: they work offline.

alter table public.inventory add column source text not null default 'website' check (source in ('website', 'play'));
comment on column public.inventory.source is 'How the member owns the item: bought on this website, or through Google Play on a linked app profile (NF-10H6).';

alter table private.play_purchases add column refunded_at timestamptz;

create table private.profile_link_tickets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 code_hash text not null unique,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now() + interval '10 minutes',
 redeemed_at timestamptz
);
comment on table private.profile_link_tickets is 'One-time codes that link an app profile to a website account (NF-10H6). Only the hash is kept.';
revoke all on private.profile_link_tickets from public, anon, authenticated, service_role;

create table private.profile_accounts (
 profile_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 linked_at timestamptz not null default now()
);
create index profile_accounts_user on private.profile_accounts (user_id);
comment on table private.profile_accounts is 'App profiles linked to a website account (NF-10H6): one account per profile.';
revoke all on private.profile_accounts from public, anon, authenticated, service_role;

-- Give the account every theme a live Play purchase unlocked on this profile. Returns the item ids added or confirmed.
create function private.grant_play_themes(p_user uuid, p_profile uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare r record; used integer; given text[] := '{}';
begin
  for r in select distinct p.item_id from private.play_purchase_profiles pp
             join private.play_purchases p on p.token_sha256 = pp.token_sha256
            where pp.profile_id = p_profile and p.refunded_at is null order by p.item_id loop
    insert into public.inventory (user_id, item_id, source) values (p_user, r.item_id, 'play') on conflict do nothing;
    perform pg_advisory_xact_lock(hashtextextended('seat:' || p_user::text || ':' || r.item_id, 0));
    if not exists (select 1 from public.profile_claims where user_id = p_user and item_id = r.item_id and profile_id = p_profile) then
      select count(*) into used from public.profile_claims where user_id = p_user and item_id = r.item_id;
      -- The profile already wears its Play licence; past the cap it is simply not counted again.
      if used < private.profile_cap() then
        insert into public.profile_claims (user_id, item_id, profile_id) values (p_user, r.item_id, p_profile);
      end if;
    end if;
    given := given || r.item_id;
  end loop;
  return given;
end $$;
revoke all on function private.grant_play_themes(uuid, uuid) from public, anon, authenticated, service_role;

create function public.issue_profile_link_code() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); code text := replace(gen_random_uuid()::text, '-', ''); t private.profile_link_tickets;
begin
  if uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if (select count(*) from private.profile_link_tickets where user_id = uid and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too many link requests'; end if;
  insert into private.profile_link_tickets (user_id, code_hash) values (uid, encode(sha256(convert_to(code, 'UTF8')), 'hex'))
  returning * into t;
  -- Only this response holds the plaintext code; it never enters the audit log.
  return jsonb_build_object('code', upper(substr(code, 1, 8) || '-' || substr(code, 9, 8) || '-' || substr(code, 17, 8) || '-' || substr(code, 25, 8)),
    'expires_at', t.expires_at);
end $$;
revoke all on function public.issue_profile_link_code() from public, anon, service_role;
grant execute on function public.issue_profile_link_code() to authenticated;

create function public.link_app_profile(p_code text, p_profile_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  code text := lower(replace(btrim(coalesce(p_code, '')), '-', ''));
  t private.profile_link_tickets; prof uuid; owner_id uuid; given text[];
begin
  if code !~ '^[0-9a-f]{32}$' then raise exception 'invalid or expired link code'; end if;
  if p_profile_id is null or p_profile_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'the app did not say which profile this is'; end if;
  prof := p_profile_id::uuid;
  select * into t from private.profile_link_tickets where code_hash = encode(sha256(convert_to(code, 'UTF8')), 'hex') for update;
  if not found or t.expires_at <= now() or t.redeemed_at is not null then raise exception 'invalid or expired link code'; end if;
  perform pg_advisory_xact_lock(hashtextextended('profile-link:' || prof::text, 0));
  select user_id into owner_id from private.profile_accounts where profile_id = prof;
  if (owner_id is not null and owner_id <> t.user_id)
     or exists (select 1 from public.profile_claims where profile_id = prof and user_id <> t.user_id) then
    raise exception 'this profile belongs to another account'; end if;
  insert into private.profile_accounts (profile_id, user_id) values (prof, t.user_id) on conflict (profile_id) do nothing;
  update private.profile_link_tickets set redeemed_at = now() where id = t.id;
  given := private.grant_play_themes(t.user_id, prof);
  insert into public.audit_log(actor, action, target_type, target_id, detail)
  values (t.user_id, 'profile.link', 'profile_link', t.id::text, jsonb_build_object('play_items', to_jsonb(given)));
  return jsonb_build_object('linked', true, 'items', to_jsonb(given));
end $$;
revoke all on function public.link_app_profile(text, text) from public, anon, authenticated;
grant execute on function public.link_app_profile(text, text) to service_role;

-- A refunded or voided Play purchase (found by redeem-play) mints no more licences and leaves the accounts it reached.
create function public.void_play_purchase(p_token_sha256 text) returns void
language plpgsql security definer set search_path = '' as $$
declare rec private.play_purchases; a record;
begin
  if p_token_sha256 is null or p_token_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid purchase'; end if;
  update private.play_purchases set refunded_at = coalesce(refunded_at, now()) where token_sha256 = p_token_sha256 returning * into rec;
  if not found then return; end if;
  for a in select distinct pa.user_id from private.play_purchase_profiles pp
             join private.profile_accounts pa on pa.profile_id = pp.profile_id
            where pp.token_sha256 = p_token_sha256 loop
    -- Still owned through another live Play purchase on one of this account's linked profiles: keep it.
    continue when exists (select 1 from private.play_purchases p
                            join private.play_purchase_profiles pp on pp.token_sha256 = p.token_sha256
                            join private.profile_accounts pa on pa.profile_id = pp.profile_id
                           where pa.user_id = a.user_id and p.item_id = rec.item_id and p.refunded_at is null);
    delete from public.inventory where user_id = a.user_id and item_id = rec.item_id and source = 'play';
    if found then
      delete from public.equipped_items where user_id = a.user_id and item_id = rec.item_id;
      insert into public.audit_log(actor, action, target_type, target_id, detail)
      values (null, 'play.void', 'play_purchase', left(p_token_sha256, 16), jsonb_build_object('item_id', rec.item_id));
    end if;
  end loop;
end $$;
revoke all on function public.void_play_purchase(text) from public, anon, authenticated;
grant execute on function public.void_play_purchase(text) to service_role;

-- As 20261113140000, plus: a refunded purchase mints nothing, and a linked profile's purchase reaches its account.
create or replace function public.redeem_play_purchase(p_token_sha256 text, p_order_id text, p_item_id text, p_profile_id text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  prof uuid; v integer; rec private.play_purchases; used integer; linked uuid;
begin
  if p_token_sha256 is null or p_token_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid purchase'; end if;
  if p_order_id is null or char_length(p_order_id) not between 1 and 80 then raise exception 'invalid purchase'; end if;
  if p_profile_id is null or p_profile_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'the app did not say which profile this is'; end if;
  prof := p_profile_id::uuid;
  select (i->>'asset_version')::integer into v from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
   where i->>'item_id' = p_item_id limit 1;
  if v is null or not exists (select 1 from public.bundled_item_versions where item_id = p_item_id and asset_version = v and enabled) then
    raise exception 'unsupported bundled item version'; end if;
  select * into rec from private.play_purchases where token_sha256 = p_token_sha256 for update;
  if found then
    if rec.item_id <> p_item_id then raise exception 'invalid purchase'; end if;
    if rec.refunded_at is not null then raise exception 'this purchase was refunded'; end if;
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
  select user_id into linked from private.profile_accounts where profile_id = prof;
  if linked is not null then perform private.grant_play_themes(linked, prof); end if;
  return jsonb_build_object('schema_version', 1, 'account_id', md5('play:' || coalesce(rec.order_id, p_order_id))::uuid,
    'profile_id', prof, 'items',
    jsonb_build_array(jsonb_build_object('item_id', p_item_id, 'asset_version', v, 'deliveries', '[]'::jsonb)));
end $$;
revoke all on function public.redeem_play_purchase(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.redeem_play_purchase(text, text, text, text, jsonb) to service_role;
commit;
