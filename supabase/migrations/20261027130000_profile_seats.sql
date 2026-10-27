begin;
-- One purchase, one profile (owner rule, 2026-10-27).
-- Buying an app theme gives one seat. A one-time website code claims that seat for one Lightning profile (the app's own
-- stable profile id, the same on every device that profile lives on) and is burned on use. That profile may then be
-- activated on any of its devices with further free codes. Another profile needs another seat, sold to the owner of the
-- theme at 25% of its price (75% off). A refused claim burns nothing. Cosmetics only: no money outside the coin ledger.

create table public.theme_seats (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null references public.catalog_items (id),
  extra integer not null default 0 check (extra between 0 and 9),   -- seats bought beyond the one that came with the theme
  primary key (user_id, item_id)
);
create table public.profile_claims (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null references public.catalog_items (id),
  profile_id uuid not null,
  claimed_at timestamptz not null default now(),
  unique (user_id, item_id, profile_id)
);
create index profile_claims_owner on public.profile_claims (user_id, item_id);
create table public.seat_purchases (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null references public.catalog_items (id),
  price_paid integer not null check (price_paid > 0),
  ledger_entry_id bigint not null unique references public.ledger_entries (id),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
alter table public.theme_seats enable row level security;
alter table public.profile_claims enable row level security;
alter table public.seat_purchases enable row level security;
revoke all on public.theme_seats, public.profile_claims, public.seat_purchases from public, anon, authenticated;
grant all on public.theme_seats, public.profile_claims, public.seat_purchases to service_role;
grant usage, select on sequence public.profile_claims_id_seq, public.seat_purchases_id_seq to service_role;

-- An extra seat costs a quarter of the theme's price, rounded up, never less than one coin.
create function private.seat_price(p_item text) returns integer language sql stable security definer set search_path = '' as $$
  select greatest(1, (price + 3) / 4) from public.catalog_items where id = p_item;
$$;
revoke all on function private.seat_price(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- redeeming: one code, one profile, then burned
drop function public.redeem_activation_code(text, text, integer);
create function public.redeem_activation_code(p_code text, p_item_id text, p_asset_version integer, p_profile_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  code text := lower(replace(btrim(p_code), '-', ''));
  t private.activation_tickets; prof uuid; seats integer; used integer; fresh boolean := false;
begin
  if code is null or code !~ '^[0-9a-f]{32}$' then raise exception 'invalid or expired activation code'; end if;
  if p_profile_id is null or p_profile_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'the app did not say which profile this is'; end if;
  prof := p_profile_id::uuid;
  select * into t from private.activation_tickets where code_hash = encode(sha256(convert_to(code, 'UTF8')), 'hex') for update;
  if not found or t.expires_at <= now() or t.redeemed_at is not null then raise exception 'invalid or expired activation code'; end if;
  -- An old app must not consume a ticket for a theme/version it cannot apply.
  if t.item_id is distinct from p_item_id or t.asset_version is distinct from p_asset_version then
    raise exception 'unsupported bundled item version'; end if;
  if not exists (select 1 from public.bundled_item_versions where item_id = t.item_id and asset_version = t.asset_version and enabled)
     or not exists (select 1 from public.inventory where user_id = t.user_id and item_id = t.item_id) then
    raise exception 'item no longer available for activation'; end if;
  -- The seat: this profile already holds one (another device of it), or a free seat is taken by it now.
  perform pg_advisory_xact_lock(hashtextextended('seat:' || t.user_id::text || ':' || t.item_id, 0));
  if not exists (select 1 from public.profile_claims where user_id = t.user_id and item_id = t.item_id and profile_id = prof) then
    select 1 + coalesce((select extra from public.theme_seats where user_id = t.user_id and item_id = t.item_id), 0) into seats;
    select count(*) into used from public.profile_claims where user_id = t.user_id and item_id = t.item_id;
    if used >= seats then raise exception 'every profile seat for this theme is used'; end if;
    insert into public.profile_claims (user_id, item_id, profile_id) values (t.user_id, t.item_id, prof);
    fresh := true;
  end if;
  update private.activation_tickets set redeemed_at = now() where id = t.id;
  insert into public.audit_log(actor, action, target_type, target_id, detail)
  values (t.user_id, 'activation.redeem', 'activation', t.id::text, jsonb_build_object('item_id', t.item_id, 'new_profile', fresh));
  return jsonb_build_object('schema_version', 1, 'account_id', t.user_id, 'profile_id', prof, 'items',
    jsonb_build_array(jsonb_build_object('item_id', t.item_id, 'asset_version', t.asset_version, 'deliveries', '[]'::jsonb)));
end $$;
revoke all on function public.redeem_activation_code(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.redeem_activation_code(text, text, integer, text) to service_role;

-- ---------------------------------------------------------------- what the member sees, and buying another seat
create function public.my_theme_seats() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'item_id', i.item_id, 'name', c.name,
        'seats', 1 + coalesce(s.extra, 0),
        'used', (select count(*) from public.profile_claims pc where pc.user_id = uid and pc.item_id = i.item_id),
        'claimed_at', (select coalesce(jsonb_agg(pc.claimed_at order by pc.claimed_at), '[]'::jsonb) from public.profile_claims pc where pc.user_id = uid and pc.item_id = i.item_id),
        'next_price', private.seat_price(i.item_id),
        'can_buy', 1 + coalesce(s.extra, 0) < 10) order by c.name)
      from public.inventory i
      join public.catalog_items c on c.id = i.item_id
      left join public.theme_seats s on s.user_id = uid and s.item_id = i.item_id
     where i.user_id = uid
       and exists (select 1 from public.bundled_item_versions b where b.item_id = i.item_id and b.enabled)), '[]'::jsonb);
end $$;

create function public.purchase_theme_seat(p_item_id text, p_expected_price integer, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); w public.wallets; item public.catalog_items; e public.ledger_entries; sp public.seat_purchases; price integer; total integer;
begin
  perform private.require_active_session();
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'idempotency key must be 8 to 100 characters'; end if;
  select * into w from public.wallets where user_id = uid for update;
  select * into sp from public.seat_purchases where user_id = uid and idempotency_key = p_idempotency_key;
  if found then
    if sp.item_id <> p_item_id then raise exception 'idempotency key already used for a different item'; end if;
    return jsonb_build_object('item_id', sp.item_id, 'price_paid', sp.price_paid, 'seats', 1 + coalesce((select extra from public.theme_seats where user_id = uid and item_id = sp.item_id), 0),
                              'balance', coalesce(w.balance, 0));
  end if;
  select * into item from public.catalog_items where id = p_item_id;
  if not found or not exists (select 1 from public.inventory where user_id = uid and item_id = p_item_id) then
    raise exception 'you can only add profiles to a theme you own'; end if;
  if not exists (select 1 from public.bundled_item_versions where item_id = p_item_id and enabled) then
    raise exception 'app unlock is not available for this item'; end if;
  price := private.seat_price(p_item_id);
  if p_expected_price is distinct from price then raise exception 'price changed; reload before buying'; end if;
  if coalesce((select extra from public.theme_seats where user_id = uid and item_id = p_item_id), 0) >= 9 then
    raise exception 'ten profiles is the most one theme can have'; end if;
  if w.user_id is null or w.balance < price then raise exception 'insufficient coins' using errcode = 'P0001'; end if;
  e := private.post_ledger(uid, 'purchase', 0, -price, 'seat', item.id, 'primary', 'Extra profile for ' || item.name,
    'seat:' || uid::text || ':' || p_idempotency_key, now(), null, uid);
  insert into public.seat_purchases (user_id, item_id, price_paid, ledger_entry_id, idempotency_key)
  values (uid, item.id, price, e.id, p_idempotency_key);
  insert into public.theme_seats (user_id, item_id, extra) values (uid, item.id, 1)
  on conflict (user_id, item_id) do update set extra = public.theme_seats.extra + 1 returning 1 + extra into total;
  return jsonb_build_object('item_id', item.id, 'price_paid', price, 'seats', total, 'balance', w.balance - price);
end $$;

-- ---------------------------------------------------------------- support: see a member's claims and free one
create function public.admin_profile_claims(p_email text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid;
begin
  perform private.require_mfa_admin();
  select id into uid from auth.users where lower(email) = lower(btrim(coalesce(p_email, '')));
  if uid is null then raise exception 'no member with that email'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', pc.id, 'item_id', pc.item_id, 'name', c.name, 'claimed_at', pc.claimed_at,
                     'seats', 1 + coalesce((select extra from public.theme_seats s where s.user_id = uid and s.item_id = pc.item_id), 0))
                     order by pc.claimed_at)
                   from public.profile_claims pc join public.catalog_items c on c.id = pc.item_id where pc.user_id = uid), '[]'::jsonb);
end $$;
create function public.admin_release_profile_claim(p_claim_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.profile_claims;
begin
  perform private.require_mfa_admin();
  if p_reason is null or char_length(btrim(p_reason)) not between 5 and 300 then raise exception 'give a reason of 5 to 300 characters'; end if;
  delete from public.profile_claims where id = p_claim_id returning * into c;
  if not found then raise exception 'claim not found'; end if;
  insert into public.audit_log(actor, action, target_type, target_id, detail)
  values (auth.uid(), 'activation.claim_released', 'member', c.user_id::text, jsonb_build_object('item_id', c.item_id, 'reason', btrim(p_reason)));
end $$;

revoke all on function public.my_theme_seats(), public.purchase_theme_seat(text, integer, text),
  public.admin_profile_claims(text), public.admin_release_profile_claim(bigint, text) from public, anon;
grant execute on function public.my_theme_seats(), public.purchase_theme_seat(text, integer, text) to authenticated;
grant execute on function public.admin_profile_claims(text), public.admin_release_profile_claim(bigint, text) to authenticated, service_role;

-- ---------------------------------------------------------------- the data export carries seats and claims
alter function public.export_my_data() set schema private;
alter function private.export_my_data() rename to export_my_data_base;
revoke all on function private.export_my_data_base() from public, anon, authenticated, service_role;
create function public.export_my_data() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return private.export_my_data_base() || jsonb_build_object(
    'theme_seats', (select coalesce(jsonb_agg(jsonb_build_object('item_id', s.item_id, 'extra_seats', s.extra)), '[]'::jsonb) from public.theme_seats s where s.user_id = auth.uid()),
    'profile_claims', (select coalesce(jsonb_agg(jsonb_build_object('item_id', c.item_id, 'profile_id', c.profile_id, 'claimed_at', c.claimed_at) order by c.claimed_at), '[]'::jsonb) from public.profile_claims c where c.user_id = auth.uid()),
    'seat_purchases', (select coalesce(jsonb_agg(jsonb_build_object('item_id', p.item_id, 'price_paid', p.price_paid, 'created_at', p.created_at) order by p.created_at), '[]'::jsonb) from public.seat_purchases p where p.user_id = auth.uid()));
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
commit;
