-- Manual InstaPay top-ups. No prices/payment destination are seeded: checkout stays closed
-- until the owner configures them. Every credit uses the existing wallet/ledger.
begin;
alter table public.ledger_entries drop constraint ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check check (kind in
 ('contribution_award','feedback_award','admin_gift','purchase','refund','correction','paid_topup'));
alter table public.ledger_entries drop constraint ledger_kind_shape;
alter table public.ledger_entries add constraint ledger_kind_shape check (
 case kind
 when 'contribution_award' then contribution_delta > 0 and wallet_delta = contribution_delta
 when 'feedback_award' then contribution_delta > 0 and wallet_delta = contribution_delta
 when 'admin_gift' then contribution_delta = 0 and wallet_delta > 0
 when 'paid_topup' then contribution_delta = 0 and wallet_delta > 0 and source_type = 'instapay'
 when 'purchase' then contribution_delta = 0 and wallet_delta < 0
 when 'refund' then contribution_delta = 0 and wallet_delta > 0 and reverses_entry_id is not null
 when 'correction' then reverses_entry_id is not null end);

create table public.coin_packages (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(name) between 1 and 80),
 coins integer not null check (coins > 0),
 price_piastres integer not null check (price_piastres > 0),
 active boolean not null default false,
 created_at timestamptz not null default now()
);
comment on table public.coin_packages is 'Create a new row for new prices. Requests snapshot the agreed price. No example packages in production.';

create table public.topup_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references auth.users(id) on delete set null,
 package_id uuid not null references public.coin_packages(id),
 request_key uuid not null,
 coins integer not null check (coins > 0),
 price_piastres integer not null check (price_piastres > 0),
 status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
 received_piastres integer,
 payment_reference text unique check (payment_reference ~ '^[A-Z0-9-]{6,100}$'),
 ledger_entry_id bigint unique references public.ledger_entries(id),
 reviewed_by uuid,
 review_note text check (char_length(review_note) <= 500),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 unique (user_id, request_key),
 constraint topup_approval_shape check (
  (status = 'approved' and received_piastres is not null and received_piastres = price_piastres and payment_reference is not null
   and ledger_entry_id is not null and reviewed_by is not null and reviewed_at is not null)
  or (status <> 'approved' and received_piastres is null and payment_reference is null and ledger_entry_id is null))
);
create index topups_user_created on public.topup_requests(user_id, created_at);
create index topups_pending on public.topup_requests(created_at) where status = 'pending';
comment on table public.topup_requests is 'Private payment history, retained with user_id anonymized on account deletion. Receipt images stay in private support handling.';
alter table public.coin_packages enable row level security;
alter table public.topup_requests enable row level security;
revoke all on public.coin_packages, public.topup_requests from public, anon, authenticated;
grant select on public.coin_packages, public.topup_requests to authenticated;
grant all on public.coin_packages, public.topup_requests to service_role;
create policy packages_read on public.coin_packages for select to authenticated using (active or public.is_admin());
create policy topups_read on public.topup_requests for select to authenticated using (user_id = auth.uid() or public.is_admin());

create function public.request_topup(p_package_id uuid, p_request_key uuid)
returns public.topup_requests language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r public.topup_requests; p public.coin_packages;
begin
 if uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
 if p_request_key is null then raise exception 'request key required'; end if;
 -- Serialize creation per wallet to enforce the pending-request limit even during retries.
 perform 1 from public.wallets where user_id = uid for update;
 if not found then raise exception 'account not found'; end if;
 select * into r from public.topup_requests where user_id = uid and request_key = p_request_key;
 if found then
  if r.package_id is distinct from p_package_id then raise exception 'request key used for another package'; end if;
  return r;
 end if;
 select * into p from public.coin_packages where id = p_package_id and active;
 if not found then raise exception 'package not available'; end if;
 if (select count(*) from public.topup_requests where user_id = uid and status = 'pending') >= 20 then
  raise exception 'too many pending top-ups'; end if;
 insert into public.topup_requests(user_id, package_id, request_key, coins, price_piastres)
 values (uid, p.id, p_request_key, p.coins, p.price_piastres) returning * into r;
 return r;
end $$;

create function public.cancel_topup(p_request_id uuid)
returns public.topup_requests language plpgsql security definer set search_path = '' as $$
declare r public.topup_requests;
begin
 if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
 select * into r from public.topup_requests where id = p_request_id and user_id = auth.uid() for update;
 if not found then raise exception 'request not found'; end if;
 if r.status = 'cancelled' then return r; end if;
 if r.status <> 'pending' then raise exception 'request already reviewed'; end if;
 update public.topup_requests set status = 'cancelled' where id = r.id returning * into r;
 return r;
end $$;

create function public.admin_review_topup(p_request_id uuid, p_decision text,
 p_received_piastres integer default null, p_payment_reference text default null, p_note text default null)
returns public.topup_requests language plpgsql security definer set search_path = '' as $$
declare r public.topup_requests; e public.ledger_entries; ref text := upper(btrim(p_payment_reference));
begin
 if not public.is_admin() then raise exception 'administrator required' using errcode = '42501'; end if;
 -- Use the validated JWT claims supplied by Supabase, never a browser-supplied MFA flag.
 if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') <> 'aal2' then
  raise exception 'MFA verification required' using errcode = '42501'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'invalid decision'; end if;
 if p_note is null or char_length(btrim(p_note)) not between 1 and 500 then raise exception 'verification note required'; end if;
 select * into r from public.topup_requests where id = p_request_id for update;
 if not found then raise exception 'request not found'; end if;
 if r.status = 'approved' and p_decision = 'approved'
    and r.received_piastres is not distinct from p_received_piastres
    and r.payment_reference is not distinct from ref then return r; end if;
 if r.status = 'rejected' and p_decision = 'rejected' then return r; end if;
 if r.status <> 'pending' then raise exception 'request already reviewed'; end if;
 if r.user_id is null then raise exception 'account no longer exists'; end if;
 if p_decision = 'approved' then
  if p_received_piastres is distinct from r.price_piastres then raise exception 'payment amount mismatch'; end if;
  if ref is null or ref !~ '^[A-Z0-9-]{6,100}$' then raise exception 'payment reference required'; end if;
  -- The unique provider reference and ledger posting commit together. A duplicate rolls both back.
  e := private.post_ledger(r.user_id, 'paid_topup', 0, r.coins, 'instapay', r.id::text, 'primary',
   'Verified InstaPay top-up', 'instapay:' || r.id::text, now(), null, auth.uid());
  update public.topup_requests set status = 'approved', received_piastres = p_received_piastres,
   payment_reference = ref, ledger_entry_id = e.id, reviewed_by = auth.uid(),
   review_note = btrim(p_note), reviewed_at = now() where id = r.id returning * into r;
 else
  update public.topup_requests set status = 'rejected', reviewed_by = auth.uid(),
   review_note = btrim(p_note), reviewed_at = now() where id = r.id returning * into r;
 end if;
 insert into public.audit_log(actor, action, target_type, target_id, detail)
 values (auth.uid(), 'topup.' || p_decision, 'topup', r.id::text,
  jsonb_build_object('ledger_entry_id', r.ledger_entry_id));
 return r;
end $$;

-- Account inventory, independent of device identity or activation limits.
create function public.restore_store_inventory() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
 return jsonb_build_object('schema_version', 1, 'account_id', auth.uid(), 'items',
  (select coalesce(jsonb_agg(jsonb_build_object('item_id', i.item_id, 'asset_version', c.asset_version,
   'deliveries', (select coalesce(jsonb_agg(to_jsonb(d) order by d.platform, d.asset_version), '[]'::jsonb)
    from public.item_deliveries d where d.item_id = i.item_id)) order by i.item_id), '[]'::jsonb)
   from public.inventory i join public.catalog_items c on c.id = i.item_id where i.user_id = auth.uid()));
end $$;

revoke all on function public.request_topup(uuid,uuid), public.cancel_topup(uuid),
 public.admin_review_topup(uuid,text,integer,text,text), public.restore_store_inventory() from public, anon;
grant execute on function public.request_topup(uuid,uuid), public.cancel_topup(uuid),
 public.admin_review_topup(uuid,text,integer,text,text), public.restore_store_inventory() to authenticated;

-- Include the customer payment history in the existing privacy export.
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  out jsonb;
  t text;
  col text;
  rows jsonb;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  out := jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
                                          'sign_in_methods', coalesce((select jsonb_agg(distinct i.provider) from auth.identities i where i.user_id = u.id), '[]'::jsonb))
                from auth.users u where u.id = uid));
  -- table and the column that holds the member's id; tables from later migrations are included when present
  foreach t in array array[
    'profiles:user_id', 'member_profiles:user_id', 'profile_links:user_id', 'github_links:user_id', 'wallets:user_id',
    'ledger_entries:user_id', 'contributions:user_id', 'reward_claims:user_id', 'purchases:user_id', 'inventory:user_id',
    'equipped_items:user_id', 'topup_requests:user_id', 'feedback_submissions:user_id', 'profile_reports:reporter'] loop
    col := split_part(t, ':', 2);
    t := split_part(t, ':', 1);
    if to_regclass('public.' || t) is not null then
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x where x.%I = $1', t, col)
        into rows using uid;
      out := out || jsonb_build_object(t, rows);
    end if;
  end loop;
  return out;
end $$;


-- Asset registry stays empty until the owner supplies real, tested deliveries.
create table public.item_deliveries (
 item_id text not null references public.catalog_items(id),
 platform text not null check (platform in ('windows','android','website')),
 asset_version integer not null check (asset_version > 0),
 minimum_app_version text not null check (minimum_app_version ~ '^[0-9]+[.][0-9]+[.][0-9]+$'),
 asset_url text not null check (asset_url ~ '^https://' and char_length(asset_url) <= 2000),
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
 primary key (item_id, platform, asset_version)
);
alter table public.item_deliveries enable row level security;
revoke all on public.item_deliveries from public, anon, authenticated;
grant select on public.item_deliveries to authenticated;
grant all on public.item_deliveries to service_role;
create policy deliveries_owned on public.item_deliveries for select to authenticated using (
 exists (select 1 from public.inventory i where i.user_id = auth.uid() and i.item_id = item_deliveries.item_id));

create function public.admin_wallet_reconciliation()
returns table (user_id uuid, balance integer, ledger_balance bigint, difference bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
 if not public.is_admin() then raise exception 'administrator required' using errcode = '42501'; end if;
 return query select w.user_id, w.balance, coalesce(sum(e.wallet_delta),0),
  w.balance::bigint - coalesce(sum(e.wallet_delta),0)
 from public.wallets w left join public.ledger_entries e on e.user_id = w.user_id
 group by w.user_id, w.balance;
end $$;
revoke all on function public.admin_wallet_reconciliation() from public, anon;
grant execute on function public.admin_wallet_reconciliation() to authenticated;
commit;
