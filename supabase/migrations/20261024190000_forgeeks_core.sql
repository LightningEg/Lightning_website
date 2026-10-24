-- For Geeks accounts, Lightning Coins and cosmetics (FG-02)
-- Proposal: docs/proposals/forgeeks-accounts-lightning-coins.md
--
-- Rules this migration enforces in the database itself:
--   * Clients never write balances, awards, roles or inventory. They call
--     the functions below, or write only their own profile columns.
--   * The ledger is append-only. Errors are fixed with linked correction entries.
--   * A wallet can never go below zero, so concurrent purchases cannot overspend.
--   * One award per source; one owner per item; repeated requests do not double-charge.
--   * New profiles are private. Public showcase needs an 18+ confirmation.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers

create function private.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function private.block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% on % is not allowed: this table is append-only', tg_op, tg_table_name
    using errcode = '42501';
end $$;

-- ---------------------------------------------------------------- members

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  phone text check (phone ~ '^\+?[0-9 ()-]{6,24}$'),
  birth_date date check (birth_date >= date '1900-01-01'),
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Private member details. Never exposed publicly.';

create function private.profiles_validate() returns trigger
language plpgsql as $$
begin
  if new.birth_date is not null and new.birth_date > current_date then
    raise exception 'birth_date cannot be in the future';
  end if;
  return new;
end $$;
create trigger profiles_validate before insert or update on public.profiles
  for each row execute function private.profiles_validate();
create trigger profiles_updated before update on public.profiles
  for each row execute function private.set_updated_at();

create table public.member_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (char_length(display_name) between 2 and 40 and display_name !~ '[@<>]'),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  bio text check (char_length(bio) <= 500),
  visibility text not null default 'private'
    check (visibility in ('private', 'members', 'public')),
  show_work boolean not null default false,
  show_setup boolean not null default false,
  show_on_leaderboard boolean not null default false,
  adult_confirmed boolean not null default false,
  setup_editor text check (char_length(setup_editor) <= 80),
  setup_os text check (char_length(setup_os) <= 80),
  setup_languages text[] check (cardinality(setup_languages) <= 20),
  setup_tools text[] check (cardinality(setup_tools) <= 20),
  setup_notes text check (char_length(setup_notes) <= 500),
  dotfiles_url text check (dotfiles_url is null or dotfiles_url ~ '^https://'),
  portfolio_url text check (portfolio_url is null or portfolio_url ~ '^https://'),
  suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_needs_adult check (visibility <> 'public' or adult_confirmed),
  constraint leaderboard_needs_adult check (not show_on_leaderboard or adult_confirmed)
);
create unique index member_profiles_display_name_key on public.member_profiles (lower(display_name));
create trigger member_profiles_updated before update on public.member_profiles
  for each row execute function private.set_updated_at();
comment on table public.member_profiles is
  'Display profile. Private by default; read publicly only through public.profile_directory.';

create table public.profile_links (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  url text not null check (url ~ '^https://' and char_length(url) <= 300),
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
create index profile_links_user on public.profile_links (user_id);

create function private.profile_links_limit() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.profile_links where user_id = new.user_id) >= 12 then
    raise exception 'at most 12 links per profile';
  end if;
  return new;
end $$;
create trigger profile_links_limit before insert on public.profile_links
  for each row execute function private.profile_links_limit();

create table public.github_links (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  github_id bigint not null,
  github_login text not null,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz
);
create unique index github_links_active_github on public.github_links (github_id) where unlinked_at is null;
create unique index github_links_active_user on public.github_links (user_id) where unlinked_at is null;
comment on table public.github_links is
  'Verified GitHub identity (immutable numeric id). Written only by trusted server code after an authenticated provider flow. Unlinked rows are kept as history.';

create table public.admin_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin')),
  granted_at timestamptz not null default now()
);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_roles where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------- rewards

create table public.repositories (
  id bigint generated always as identity primary key,
  full_name text not null check (full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  eligible boolean not null default false,
  rewards_start_at timestamptz
);
create unique index repositories_full_name_key on public.repositories (lower(full_name));

create table public.reward_offers (
  id bigint generated always as identity primary key,
  repository_id bigint not null references public.repositories (id),
  issue_number integer not null check (issue_number > 0),
  current_version integer not null default 1,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  unique (repository_id, issue_number)
);

create table public.reward_offer_versions (
  offer_id bigint not null references public.reward_offers (id),
  version integer not null,
  amount integer not null check (amount >= 0),
  title text check (char_length(title) <= 200),
  acceptance_criteria text not null check (char_length(acceptance_criteria) between 1 and 4000),
  edited_by uuid,
  edited_at timestamptz not null default now(),
  primary key (offer_id, version)
);
comment on column public.reward_offer_versions.amount is
  'Integer coins. 0 means an explicitly unpaid task. No row means not yet reward eligible.';
create trigger reward_offer_versions_immutable before update or delete on public.reward_offer_versions
  for each row execute function private.block_mutation();

create table public.reward_claims (
  id bigint generated always as identity primary key,
  offer_id bigint not null,
  offer_version integer not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount_locked integer not null check (amount_locked >= 0),
  status text not null default 'active' check (status in ('active', 'dropped', 'completed', 'expired')),
  claimed_at timestamptz not null default now(),
  closed_at timestamptz,
  foreign key (offer_id, offer_version) references public.reward_offer_versions (offer_id, version)
);
create unique index reward_claims_one_active on public.reward_claims (offer_id) where status = 'active';
create index reward_claims_user on public.reward_claims (user_id);

-- ---------------------------------------------------------------- ledger and wallet

create table public.ledger_entries (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in
    ('contribution_award', 'feedback_award', 'admin_gift', 'purchase', 'refund', 'correction')),
  contribution_delta integer not null default 0,
  wallet_delta integer not null default 0,
  source_type text not null check (char_length(source_type) between 1 and 40),
  source_id text not null check (char_length(source_id) between 1 and 200),
  allocation_slot text not null default 'primary',
  reason text not null check (char_length(reason) between 1 and 500),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 300),
  reverses_entry_id bigint references public.ledger_entries (id),
  earned_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint ledger_kind_shape check (
    case kind
      when 'contribution_award' then contribution_delta > 0 and wallet_delta = contribution_delta
      when 'feedback_award'     then contribution_delta > 0 and wallet_delta = contribution_delta
      when 'admin_gift'         then contribution_delta = 0 and wallet_delta > 0
      when 'purchase'           then contribution_delta = 0 and wallet_delta < 0
      when 'refund'             then contribution_delta = 0 and wallet_delta > 0 and reverses_entry_id is not null
      when 'correction'         then reverses_entry_id is not null
    end)
);
create unique index ledger_one_award_per_source
  on public.ledger_entries (source_type, source_id, allocation_slot)
  where kind in ('contribution_award', 'feedback_award');
create index ledger_user_earned on public.ledger_entries (user_id, earned_at);
comment on column public.ledger_entries.earned_at is 'When the work was accepted. created_at is when it was posted.';
comment on column public.ledger_entries.user_id is
  'Set to null when the member deletes their account, which anonymizes history.';

-- Append-only. The only permitted change is anonymization: user_id to null.
create function private.ledger_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and old.user_id is not null and new.user_id is null
     and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
    return new;
  end if;
  raise exception '% on ledger_entries is not allowed: post a linked correction entry instead', tg_op
    using errcode = '42501';
end $$;
create trigger ledger_no_update_delete before update or delete on public.ledger_entries
  for each row execute function private.ledger_guard();
create trigger ledger_no_truncate before truncate on public.ledger_entries
  for each statement execute function private.block_mutation();

create table public.wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  contribution_score integer not null default 0 check (contribution_score >= 0),
  updated_at timestamptz not null default now()
);
comment on table public.wallets is
  'Derived from the ledger by trigger. balance = spendable coins; contribution_score drives ranking and never falls when coins are spent.';

create function private.apply_ledger_to_wallet() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null then
    -- The wallet row exists from signup. Update it so the CHECK sees the new total,
    -- not the delta; fall back to insert only for a member who somehow has no row.
    update public.wallets
       set balance = balance + new.wallet_delta,
           contribution_score = contribution_score + new.contribution_delta,
           updated_at = now()
     where user_id = new.user_id;
    if not found then
      insert into public.wallets (user_id, balance, contribution_score)
      values (new.user_id, new.wallet_delta, new.contribution_delta);
    end if;
  end if;
  return new;
end $$;
create trigger ledger_to_wallet after insert on public.ledger_entries
  for each row execute function private.apply_ledger_to_wallet();

create table public.contributions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  ledger_entry_id bigint not null unique references public.ledger_entries (id),
  repository text not null,
  issue_number integer,
  pr_number integer,
  title text not null check (char_length(title) <= 200),
  url text not null check (url ~ '^https://'),
  merged_at timestamptz,
  hidden boolean not null default false
);
create index contributions_user on public.contributions (user_id);

-- ---------------------------------------------------------------- cosmetics

create table public.catalog_items (
  id text primary key check (id ~ '^[a-z0-9-]{2,60}$'),
  type text not null check (type in ('theme', 'banner', 'frame', 'badge')),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  price integer not null default 0 check (price >= 0),
  is_default boolean not null default false,
  active boolean not null default true,
  asset_version integer not null default 1,
  preview_url text check (preview_url is null or preview_url ~ '^(https://|/)'),
  created_at timestamptz not null default now(),
  unique (id, type),
  constraint default_is_free check (is_default = (price = 0))
);
comment on table public.catalog_items is 'Cosmetic items only. Nothing here unlocks functionality, access or ranking.';

create table public.purchases (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null references public.catalog_items (id),
  price_paid integer not null check (price_paid > 0),
  ledger_entry_id bigint not null unique references public.ledger_entries (id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  unique (user_id, item_id)
);

create table public.inventory (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null references public.catalog_items (id),
  purchase_id bigint references public.purchases (id) on delete set null,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table public.equipped_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  slot text not null check (slot in ('theme', 'banner', 'frame', 'badge')),
  item_id text not null,
  equipped_at timestamptz not null default now(),
  primary key (user_id, slot),
  foreign key (item_id, slot) references public.catalog_items (id, type)
);

-- ---------------------------------------------------------------- operations

create table public.webhook_deliveries (
  delivery_id text primary key,
  event text not null,
  status text not null default 'received' check (status in ('received', 'processed', 'failed', 'ignored')),
  attempts integer not null default 0,
  error text check (char_length(error) <= 300),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
comment on table public.webhook_deliveries is 'Deduplicates GitHub deliveries. Never store payloads or personal data here.';

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function private.block_mutation();

-- ---------------------------------------------------------------- new members

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  attempt integer := 0;
begin
  insert into public.profiles (user_id) values (new.id);
  insert into public.wallets (user_id) values (new.id);
  loop
    begin
      insert into public.member_profiles (user_id, display_name)
      values (new.id, 'geek-' || substr(md5(random()::text || clock_timestamp()::text || new.id::text), 1, 8));
      exit;
    exception when unique_violation then
      attempt := attempt + 1;
      if attempt >= 5 then raise; end if;
    end;
  end loop;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------- ledger posting

create function private.post_ledger(
  p_user uuid, p_kind text, p_contribution integer, p_wallet integer,
  p_source_type text, p_source_id text, p_slot text, p_reason text,
  p_key text, p_earned_at timestamptz, p_reverses bigint, p_actor uuid
) returns public.ledger_entries
language plpgsql security definer set search_path = '' as $$
declare r public.ledger_entries;
begin
  insert into public.ledger_entries
    (user_id, kind, contribution_delta, wallet_delta, source_type, source_id,
     allocation_slot, reason, idempotency_key, reverses_entry_id, earned_at, created_by)
  values
    (p_user, p_kind, p_contribution, p_wallet, p_source_type, p_source_id,
     p_slot, p_reason, p_key, p_reverses, p_earned_at, p_actor)
  on conflict (idempotency_key) do nothing
  returning * into r;
  if r.id is null then
    select * into r from public.ledger_entries where idempotency_key = p_key;
  end if;
  return r;
end $$;

-- Trusted server code only (service role): award coins for an accepted source.
create function public.award_coins(
  p_user uuid, p_kind text, p_amount integer,
  p_source_type text, p_source_id text, p_reason text,
  p_earned_at timestamptz default now(), p_slot text default 'primary',
  p_contribution jsonb default null
) returns public.ledger_entries
language plpgsql security definer set search_path = '' as $$
declare
  e public.ledger_entries;
  c integer;
begin
  if p_kind not in ('contribution_award', 'feedback_award', 'admin_gift') then
    raise exception 'award_coins cannot post kind %', p_kind;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be a positive integer';
  end if;
  c := case when p_kind = 'admin_gift' then 0 else p_amount end;
  e := private.post_ledger(
    p_user, p_kind, c, p_amount, p_source_type, p_source_id, p_slot, p_reason,
    'award:' || p_source_type || ':' || p_source_id || ':' || p_slot,
    p_earned_at, null, null);
  if p_kind = 'contribution_award' and p_contribution is not null then
    insert into public.contributions
      (user_id, ledger_entry_id, repository, issue_number, pr_number, title, url, merged_at)
    values
      (p_user, e.id, p_contribution ->> 'repository',
       nullif(p_contribution ->> 'issue_number', '')::integer,
       nullif(p_contribution ->> 'pr_number', '')::integer,
       p_contribution ->> 'title', p_contribution ->> 'url',
       nullif(p_contribution ->> 'merged_at', '')::timestamptz)
    on conflict (ledger_entry_id) do nothing;
  end if;
  return e;
end $$;

-- Administrator only: reverse an entry with a linked correction entry.
create function public.admin_correct_entry(p_entry_id bigint, p_reason text)
returns public.ledger_entries
language plpgsql security definer set search_path = '' as $$
declare
  o public.ledger_entries;
  e public.ledger_entries;
begin
  if not public.is_admin() then
    raise exception 'administrator only' using errcode = '42501';
  end if;
  select * into o from public.ledger_entries where id = p_entry_id;
  if not found then raise exception 'entry not found'; end if;
  if o.user_id is null then raise exception 'entry is anonymized'; end if;
  select * into e from public.ledger_entries where idempotency_key = 'correction:' || o.id::text;
  if found then
    return e; -- already corrected: no new entry and no new audit row
  end if;
  e := private.post_ledger(
    o.user_id, 'correction', -o.contribution_delta, -o.wallet_delta,
    'correction', o.id::text, 'primary', p_reason,
    'correction:' || o.id::text, now(), o.id, auth.uid());
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (auth.uid(), 'ledger.correct', 'ledger_entry', o.id::text,
          jsonb_build_object('reason', p_reason, 'correction_id', e.id));
  return e;
end $$;

-- Administrator only: take down or restore a public profile (moderation).
create function public.admin_suspend_profile(p_user uuid, p_suspended boolean, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'administrator only' using errcode = '42501';
  end if;
  update public.member_profiles set suspended = p_suspended where user_id = p_user;
  if not found then raise exception 'profile not found'; end if;
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (auth.uid(), case when p_suspended then 'profile.suspend' else 'profile.restore' end,
          'member_profile', p_user::text, jsonb_build_object('reason', p_reason));
end $$;

-- Administrator only: publish or change an issue reward. Each change is a new version.
create function public.publish_reward(
  p_repo text, p_issue integer, p_amount integer, p_criteria text, p_title text default null
) returns public.reward_offer_versions
language plpgsql security definer set search_path = '' as $$
declare
  repo_id bigint;
  offer public.reward_offers;
  v public.reward_offer_versions;
begin
  if not public.is_admin() then
    raise exception 'administrator only' using errcode = '42501';
  end if;
  select id into repo_id from public.repositories where lower(full_name) = lower(p_repo) and eligible;
  if repo_id is null then raise exception 'repository is not eligible'; end if;
  insert into public.reward_offers (repository_id, issue_number)
  values (repo_id, p_issue)
  on conflict (repository_id, issue_number)
    do update set current_version = public.reward_offers.current_version + 1
  returning * into offer;
  insert into public.reward_offer_versions
    (offer_id, version, amount, title, acceptance_criteria, edited_by)
  values (offer.id, offer.current_version, p_amount, p_title, p_criteria, auth.uid())
  returning * into v;
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (auth.uid(), 'reward.publish', 'reward_offer', offer.id::text,
          jsonb_build_object('repo', p_repo, 'issue', p_issue, 'amount', p_amount, 'version', v.version));
  return v;
end $$;

-- ---------------------------------------------------------------- member actions

create function public.purchase_item(p_item_id text, p_idempotency_key text)
returns public.purchases
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  item public.catalog_items;
  w public.wallets;
  e public.ledger_entries;
  p public.purchases;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'idempotency key must be 8 to 100 characters';
  end if;
  -- Lock the wallet first: concurrent requests from one member run one at a time.
  select * into w from public.wallets where user_id = uid for update;
  if not found then
    raise exception 'insufficient coins' using errcode = 'P0001';
  end if;
  select * into p from public.purchases where user_id = uid and idempotency_key = p_idempotency_key;
  if found then
    if p.item_id <> p_item_id then
      raise exception 'idempotency key already used for a different item';
    end if;
    return p;
  end if;
  select * into item from public.catalog_items where id = p_item_id and active;
  if not found then raise exception 'item not available'; end if;
  if item.is_default then raise exception 'item is free and always available'; end if;
  if exists (select 1 from public.inventory where user_id = uid and item_id = item.id) then
    raise exception 'already owned';
  end if;
  if w.balance < item.price then
    raise exception 'insufficient coins' using errcode = 'P0001';
  end if;
  e := private.post_ledger(
    uid, 'purchase', 0, -item.price, 'purchase', item.id, 'primary',
    'Purchased ' || item.name, 'purchase:' || uid::text || ':' || p_idempotency_key,
    now(), null, uid);
  insert into public.purchases (user_id, item_id, price_paid, ledger_entry_id, idempotency_key)
  values (uid, item.id, item.price, e.id, p_idempotency_key)
  returning * into p;
  insert into public.inventory (user_id, item_id, purchase_id) values (uid, item.id, p.id);
  return p;
end $$;

create function public.equip_item(p_item_id text)
returns public.equipped_items
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  item public.catalog_items;
  r public.equipped_items;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  select * into item from public.catalog_items where id = p_item_id;
  if not found then raise exception 'item not found'; end if;
  if not ((item.is_default and item.active)
          or exists (select 1 from public.inventory where user_id = uid and item_id = item.id)) then
    raise exception 'item is not owned' using errcode = '42501';
  end if;
  insert into public.equipped_items (user_id, slot, item_id)
  values (uid, item.type, item.id)
  on conflict (user_id, slot) do update set item_id = excluded.item_id, equipped_at = now()
  returning * into r;
  return r;
end $$;

create function public.unequip_slot(p_slot text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  delete from public.equipped_items where user_id = auth.uid() and slot = p_slot;
end $$;

-- ---------------------------------------------------------------- public read side

-- Visible profile rows: public ones for everyone, "members" ones for signed-in members.
-- These views run with the owner's rights on purpose and expose only opted-in columns.
create view public.profile_directory as
select
  m.display_name,
  m.avatar_url,
  m.bio,
  m.visibility,
  case when m.show_setup then m.setup_editor end as setup_editor,
  case when m.show_setup then m.setup_os end as setup_os,
  case when m.show_setup then m.setup_languages end as setup_languages,
  case when m.show_setup then m.setup_tools end as setup_tools,
  case when m.show_setup then m.setup_notes end as setup_notes,
  case when m.show_setup then m.dotfiles_url end as dotfiles_url,
  case when m.show_setup then m.portfolio_url end as portfolio_url,
  case when m.show_on_leaderboard then w.contribution_score end as contribution_score,
  (select e.item_id from public.equipped_items e where e.user_id = m.user_id and e.slot = 'banner') as banner_item_id
from public.member_profiles m
left join public.wallets w on w.user_id = m.user_id
where not m.suspended
  and (m.visibility = 'public' or (m.visibility = 'members' and auth.uid() is not null));

create view public.profile_work as
select
  m.display_name,
  c.repository, c.issue_number, c.pr_number, c.title, c.url, c.merged_at,
  true as verified
from public.contributions c
join public.member_profiles m on m.user_id = c.user_id
where m.show_work and not c.hidden and not m.suspended
  and (m.visibility = 'public' or (m.visibility = 'members' and auth.uid() is not null))
union all
select
  m.display_name,
  null, null, null, l.label, l.url, null,
  false
from public.profile_links l
join public.member_profiles m on m.user_id = l.user_id
where m.show_work and not m.suspended
  and (m.visibility = 'public' or (m.visibility = 'members' and auth.uid() is not null));
comment on view public.profile_work is
  'verified = true rows come from the ledger; verified = false rows are self-reported links.';

create function public.leaderboard(p_period text default 'all', p_limit integer default 50)
returns table (rank bigint, display_name text, avatar_url text, contribution_count bigint, score bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  since timestamptz;
begin
  if p_period not in ('all', 'month') then
    raise exception 'period must be all or month';
  end if;
  since := case when p_period = 'month'
    then date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo'
    else '-infinity'::timestamptz end;
  return query
  with scores as (
    select m.display_name as dn, m.avatar_url as av,
           count(*) filter (where l.kind in ('contribution_award', 'feedback_award')) as cnt,
           sum(l.contribution_delta)::bigint as sc
    from public.ledger_entries l
    join public.member_profiles m on m.user_id = l.user_id
    where m.show_on_leaderboard and m.adult_confirmed and not m.suspended
      and l.earned_at >= since
    group by m.user_id, m.display_name, m.avatar_url
    having sum(l.contribution_delta) > 0
  )
  select (rank() over (order by s.sc desc))::bigint, s.dn, s.av, s.cnt, s.sc
  from scores s
  order by 1, s.dn
  limit least(greatest(p_limit, 1), 100);
end $$;

-- ---------------------------------------------------------------- row level security

alter table public.profiles enable row level security;
alter table public.member_profiles enable row level security;
alter table public.profile_links enable row level security;
alter table public.github_links enable row level security;
alter table public.admin_roles enable row level security;
alter table public.repositories enable row level security;
alter table public.reward_offers enable row level security;
alter table public.reward_offer_versions enable row level security;
alter table public.reward_claims enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.wallets enable row level security;
alter table public.contributions enable row level security;
alter table public.catalog_items enable row level security;
alter table public.purchases enable row level security;
alter table public.inventory enable row level security;
alter table public.equipped_items enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_own_select on public.profiles for select to authenticated
  using (user_id = auth.uid());
create policy profiles_own_update on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy member_profiles_own_select on public.member_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy member_profiles_own_update on public.member_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy profile_links_own on public.profile_links for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy github_links_own_select on public.github_links for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy repositories_select on public.repositories for select to authenticated using (true);
create policy repositories_admin_write on public.repositories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy reward_offers_select on public.reward_offers for select to authenticated using (true);
create policy reward_offer_versions_select on public.reward_offer_versions for select to authenticated using (true);

create policy reward_claims_own_select on public.reward_claims for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy ledger_own_select on public.ledger_entries for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy wallets_own_select on public.wallets for select to authenticated
  using (user_id = auth.uid());

create policy contributions_own_select on public.contributions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy contributions_own_update on public.contributions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create function public.owns_item(p_item_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.inventory where user_id = auth.uid() and item_id = p_item_id);
$$;

create policy catalog_select on public.catalog_items for select to anon, authenticated
  using (active or public.owns_item(id));
create policy catalog_admin_write on public.catalog_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy purchases_own_select on public.purchases for select to authenticated
  using (user_id = auth.uid());
create policy inventory_own_select on public.inventory for select to authenticated
  using (user_id = auth.uid());
create policy equipped_own_select on public.equipped_items for select to authenticated
  using (user_id = auth.uid());

create policy audit_admin_select on public.audit_log for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------- privileges
-- Start from nothing, then grant exactly what each role needs.

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;

-- Members write only their own profile columns.
grant select on public.profiles, public.member_profiles, public.profile_links, public.github_links,
  public.repositories, public.reward_offers, public.reward_offer_versions, public.reward_claims,
  public.ledger_entries, public.wallets, public.contributions, public.purchases,
  public.inventory, public.equipped_items, public.audit_log to authenticated;
grant update (full_name, phone, birth_date, marketing_consent) on public.profiles to authenticated;
grant update (display_name, avatar_url, bio, visibility, show_work, show_setup, show_on_leaderboard,
  adult_confirmed, setup_editor, setup_os, setup_languages, setup_tools, setup_notes,
  dotfiles_url, portfolio_url) on public.member_profiles to authenticated;
grant select, insert, update, delete on public.profile_links to authenticated;
grant update (hidden) on public.contributions to authenticated;
grant insert, update, delete on public.repositories, public.catalog_items to authenticated;
grant select on public.catalog_items to anon, authenticated;
grant select on public.profile_directory, public.profile_work to anon, authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.owns_item(text) to anon, authenticated;
grant execute on function public.purchase_item(text, text) to authenticated;
grant execute on function public.equip_item(text) to authenticated;
grant execute on function public.unequip_slot(text) to authenticated;
grant execute on function public.admin_correct_entry(bigint, text) to authenticated;
grant execute on function public.publish_reward(text, integer, integer, text, text) to authenticated;
grant execute on function public.admin_suspend_profile(uuid, boolean, text) to authenticated;
grant execute on function public.leaderboard(text, integer) to anon, authenticated;
grant execute on all functions in schema public to service_role;
grant execute on function public.award_coins(uuid, text, integer, text, text, text, timestamptz, text, jsonb) to service_role;

-- ---------------------------------------------------------------- seed

insert into public.repositories (full_name, eligible) values ('LightningEg/Lightning', true);

insert into public.catalog_items (id, type, name, description, price, is_default) values
  ('mono', 'theme', 'Mono', 'White on black, the default', 0, true),
  ('paper', 'theme', 'Paper', 'Light, for daylight reading', 0, true),
  ('meadow', 'theme', 'Meadow', 'Night blue and green', 0, true),
  ('nile', 'theme', 'Nile', 'Night blue and gold', 0, true),
  ('ocean', 'theme', 'Ocean', 'Deep sea, cyan and mint', 0, true),
  ('tokyo', 'theme', 'Tokyo', 'Cool blue and violet', 0, true),
  ('dracula', 'theme', 'Dracula', 'Purple and pink', 0, true),
  ('rose', 'theme', 'Rose', 'Dusk pink and peach', 0, true),
  ('synthwave', 'theme', 'Synthwave', 'Neon magenta and cyan', 0, true),
  ('phosphor', 'theme', 'Phosphor', 'Green CRT glow', 0, true),
  ('amber', 'theme', 'Amber', 'Old terminal, warm', 0, true),
  ('solarized', 'theme', 'Solarized', 'The classic, gold and teal', 0, true);
