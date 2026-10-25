begin;
alter table private.activation_tickets enable row level security;
-- Preserve the original wallet transaction, but bind browser purchases to the displayed price.
create function public.purchase_item_at_price(p_item_id text,p_expected_price integer,p_idempotency_key text)
returns public.purchases language plpgsql security definer set search_path='' as $$
declare r public.purchases;c public.catalog_items;
begin
 perform private.require_active_session();
 perform 1 from public.wallets where user_id=auth.uid() for update;
 select * into r from public.purchases where user_id=auth.uid() and idempotency_key=p_idempotency_key;
 if found then
  if r.item_id is distinct from p_item_id then raise exception 'idempotency key already used for a different item';end if;
  if r.price_paid is distinct from p_expected_price then raise exception 'purchase price does not match original request';end if;
  return r;
 end if;
 select * into c from public.catalog_items where id=p_item_id and active for share;
 if not found then raise exception 'item not available';end if;
 if c.price is distinct from p_expected_price then raise exception 'price changed; reload the market before buying';end if;
 return public.purchase_item(p_item_id,p_idempotency_key);
end $$;
-- Legacy endpoint is retired after the new browser deployment (migration 2100).
revoke all on function public.purchase_item_at_price(text,integer,text) from public,anon;
grant execute on function public.purchase_item_at_price(text,integer,text) to authenticated;

create or replace function public.admin_review_topup(p_request_id uuid,p_decision text,p_received_piastres integer default null,
 p_payment_reference text default null,p_note text default null)
returns public.topup_requests language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;
begin
 perform private.require_mfa_admin();
 perform 1 from public.wallets where user_id=(select user_id from public.topup_requests where id=p_request_id) for update;
 select * into r from public.topup_requests where id=p_request_id for update;
 if p_decision='approved' and r.status='pending' and
 (r.terms_accepted_at is null or r.customer_payment_reference is null or r.proof_reviewed_at is null
 or r.payer_instapay_address is null or r.receipt_object_key is null or r.receipt_reviewed_key is distinct from r.receipt_object_key
 or not private.receipt_exists(r.receipt_object_key)) then raise exception 'customer reference, terms and uploaded receipt review required';end if;
 return private.review_topup_with_credit(p_request_id,p_decision,p_received_piastres,p_payment_reference,p_note);
end $$;

-- Compare the complete evidence revision, not only its image filename.
alter table public.topup_requests add column receipt_revision bigint not null default 0;
create function private.bump_receipt_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.receipt_object_key,new.payer_instapay_address,new.customer_payment_reference)
 is distinct from (old.receipt_object_key,old.payer_instapay_address,old.customer_payment_reference) then
  new.receipt_revision:=old.receipt_revision+1;
  new.proof_reviewed_at:=null;new.proof_reviewed_by:=null;new.receipt_reviewed_key:=null;
 end if;
 return new;
end $$;
create trigger topup_evidence_revision before update on public.topup_requests for each row execute function private.bump_receipt_revision();
create function public.admin_review_uploaded_receipt(p_request_id uuid,p_note text,p_object_key text,p_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;
begin
 perform private.require_mfa_admin();
 select * into r from public.topup_requests where id=p_request_id for update;
 if not found or p_object_key is null or r.receipt_object_key is distinct from p_object_key
 or r.receipt_revision is distinct from p_revision then raise exception 'receipt changed; reload and review the current evidence';end if;
 perform public.admin_record_topup_proof(p_request_id,p_note);
end $$;
-- Legacy three-argument review is retired with the browser deployment.
revoke all on function public.admin_review_uploaded_receipt(uuid,text,text,bigint) from public,anon;
grant execute on function public.admin_review_uploaded_receipt(uuid,text,text,bigint) to authenticated;
create function public.admin_settle_topup(p_request_id uuid,p_receipt_key text,p_receipt_revision bigint,
 p_received_piastres integer,p_payment_reference text,p_note text)
returns public.topup_requests language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;
begin
 perform private.require_mfa_admin();
 select * into r from public.topup_requests where id=p_request_id for update;
 if not found then raise exception 'request not found';end if;
 -- A lost successful response may be retried without requiring the image to be re-reviewed.
 if r.status='approved' then
  return public.admin_review_topup(p_request_id,'approved',p_received_piastres,p_payment_reference,p_note);
 end if;
 perform public.admin_review_uploaded_receipt(p_request_id,p_note,p_receipt_key,p_receipt_revision);
 return public.admin_review_topup(p_request_id,'approved',p_received_piastres,p_payment_reference,p_note);
end $$;
revoke all on function public.admin_settle_topup(uuid,text,bigint,integer,text,text) from public,anon;
grant execute on function public.admin_settle_topup(uuid,text,bigint,integer,text,text) to authenticated;

create or replace function public.create_checkout(p_package_id uuid,p_request_key uuid,p_accept_terms boolean)
returns public.topup_requests language plpgsql security definer set search_path='' as $$
declare cfg public.payment_settings;r public.topup_requests;email text;
begin
 perform private.require_active_session();
 if p_accept_terms is distinct from true then raise exception 'accept payment terms before checkout';end if;
 perform 1 from public.wallets where user_id=auth.uid() for update;
 if not found then raise exception 'account not found';end if;
 select * into r from public.topup_requests where user_id=auth.uid() and request_key=p_request_key;
 if found then
  if r.package_id is distinct from p_package_id then raise exception 'request key used for another package';end if;
  if r.destination_address is not null then return r;end if;
  if r.status<>'pending' then raise exception 'request already reviewed';end if;
 end if;
 select * into cfg from public.payment_settings where id=1 and enabled;
 if not found then raise exception 'payment checkout is not configured';end if;
 if (select count(*) from public.audit_log where actor=auth.uid() and action='checkout.create' and created_at>now()-interval '24 hours')>=10 then
  raise exception 'daily checkout limit reached';end if;
 r:=public.request_topup(p_package_id,p_request_key);
 perform public.accept_topup_terms(r.id,'manual-final-v1');
 select u.email into email from auth.users u where u.id=auth.uid();
 if email is null then raise exception 'an account email is required';end if;
 update public.topup_requests set destination_address=cfg.instapay_address,destination_name=cfg.recipient_name,
  destination_qr_url=cfg.qr_url,transfer_note_email=email where id=r.id returning * into r;
 insert into public.audit_log(actor,action,target_type,target_id)values(auth.uid(),'checkout.create','topup',r.id::text);
 return r;
end $$;
create or replace function public.cancel_topup(p_request_id uuid)returns public.topup_requests
language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;
begin
 perform private.require_active_session();
 select * into r from public.topup_requests where id=p_request_id and user_id=auth.uid() for update;
 if not found then raise exception 'request not found';end if;
 if r.status='cancelled' then return r;end if;
 if r.status<>'pending' then raise exception 'request already reviewed';end if;
 if r.receipt_object_key is not null then raise exception 'receipt submitted; contact support for payment review';end if;
 update public.topup_requests set status='cancelled' where id=r.id returning * into r;return r;
end $$;

create or replace function public.admin_configure_payments(p_address text,p_name text,p_qr_url text,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_mfa_admin();
 if p_enabled is true and (p_address is null or lower(btrim(p_address)) !~ '^[a-z0-9._+-]+@[a-z0-9.-]+$'
 or char_length(btrim(p_address))>200 or p_name is null or char_length(btrim(p_name)) not between 2 and 200
 or p_qr_url is null or p_qr_url !~ '^https://[^/[:space:]]+/[^[:space:]]*$' or char_length(p_qr_url)>2000) then
  raise exception 'valid InstaPay address, recipient name and HTTPS QR image required';end if;
 update public.payment_settings set instapay_address=lower(btrim(p_address)),recipient_name=btrim(p_name),qr_url=btrim(p_qr_url),enabled=coalesce(p_enabled,false) where id=1;
 insert into public.audit_log(actor,action,target_type,target_id)values(auth.uid(),'payments.configure','settings','1');
end $$;
create function public.admin_save_coin_package(p_name text,p_coins integer,p_price_piastres integer,p_active boolean,p_key uuid)
returns public.coin_packages language plpgsql security definer set search_path='' as $$
declare r public.coin_packages;prior jsonb;payload jsonb;src text:=auth.uid()::text||':'||p_key::text;
begin
 perform private.require_mfa_admin();if p_key is null then raise exception 'request key required';end if;
 payload:=jsonb_build_object('name',btrim(p_name),'coins',p_coins,'price_piastres',p_price_piastres,'active',coalesce(p_active,false));
 perform pg_advisory_xact_lock(hashtext('package:'||src));
 select detail into prior from public.audit_log where action='package.save' and target_id=src;
 if found then
  if prior->'payload' is distinct from payload then raise exception 'request key already used';end if;
  select * into r from public.coin_packages where id=(prior->>'package_id')::uuid;return r;
 end if;
 r:=public.admin_create_coin_package(p_name,p_coins,p_price_piastres,p_active);
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'package.save','package',src,jsonb_build_object('package_id',r.id,'payload',payload));return r;
end $$;
create function public.admin_set_coin_package_active(p_id uuid,p_active boolean)returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_mfa_admin();
 update public.coin_packages set active=coalesce(p_active,false) where id=p_id;
 if not found then raise exception 'package not found';end if;
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'package.availability','package',p_id::text,jsonb_build_object('active',p_active));
end $$;
revoke all on function public.admin_save_coin_package(text,integer,integer,boolean,uuid),public.admin_set_coin_package_active(uuid,boolean) from public,anon;
grant execute on function public.admin_save_coin_package(text,integer,integer,boolean,uuid),public.admin_set_coin_package_active(uuid,boolean) to authenticated;

-- Bounded upload reservations prevent unlimited files under a pending request.
create table public.receipt_uploads(
 object_key text primary key,user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null references public.topup_requests(id),created_at timestamptz not null default now()
);
create index receipt_uploads_user_time on public.receipt_uploads(user_id,created_at);
create index receipt_uploads_request on public.receipt_uploads(request_id);
alter table public.receipt_uploads enable row level security;
revoke all on public.receipt_uploads from public,anon,authenticated;
grant select on public.receipt_uploads to authenticated;grant all on public.receipt_uploads to service_role;
create policy receipt_uploads_read on public.receipt_uploads for select to authenticated using(user_id=auth.uid());
create function public.reserve_topup_receipt(p_request_id uuid)returns text
language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;path text;
begin
 perform private.require_active_session();
 -- One member's upload reservations serialize across all of their requests.
 perform 1 from public.wallets where user_id=auth.uid() for update;
 if not found then raise exception 'account not found';end if;
 select * into r from public.topup_requests where id=p_request_id and user_id=auth.uid() for update;
 if not found or r.status<>'pending' or r.terms_accepted_at is null or r.destination_address is null then raise exception 'pending checkout required';end if;
 if (select count(*) from public.receipt_uploads where request_id=r.id)>=5 or
 (select count(*) from public.receipt_uploads where user_id=auth.uid() and created_at>now()-interval '24 hours')>=10 then raise exception 'receipt upload limit reached; contact support';end if;
 path:=auth.uid()::text||'/'||r.id::text||'/'||gen_random_uuid()::text;
 insert into public.receipt_uploads(object_key,user_id,request_id)values(path,auth.uid(),r.id);return path;
end $$;
revoke all on function public.reserve_topup_receipt(uuid) from public,anon;
grant execute on function public.reserve_topup_receipt(uuid) to authenticated;
do $$begin if to_regclass('storage.objects') is not null then
 execute 'drop policy topup_receipts_insert on storage.objects';
 execute $p$create policy topup_receipts_insert on storage.objects for insert to authenticated with check(
  bucket_id='topup-receipts' and exists(select 1 from public.receipt_uploads u join public.topup_requests r on r.id=u.request_id
   where u.object_key=name and u.user_id=auth.uid() and r.user_id=auth.uid() and r.status='pending' and r.terms_accepted_at is not null))$p$;
 execute 'drop policy topup_receipts_read on storage.objects';
 execute $p$create policy topup_receipts_read on storage.objects for select to authenticated using(
  bucket_id='topup-receipts' and ((split_part(name,'/',1)=auth.uid()::text and exists(select 1 from public.member_profiles where user_id=auth.uid())) or
  (public.is_admin() and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','')='aal2')))$p$;
end if;end $$;
alter function private.set_updated_at() set search_path='';
alter function private.block_mutation() set search_path='';
alter function private.profiles_validate() set search_path='';
alter function private.profile_links_limit() set search_path='';
alter function private.ledger_guard() set search_path='';
revoke all on function private.bump_receipt_revision() from public,anon,authenticated,service_role;
-- Legacy admin writes must not offer a password-only path around the MFA console.
create function private.require_active_session() returns void language plpgsql security definer set search_path='' as $$
declare claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;live boolean;
begin
 if auth.uid() is null then raise exception 'sign in required' using errcode='42501';end if;
 if to_regclass('auth.sessions') is not null then
  execute 'select exists(select 1 from auth.sessions where id::text=$1 and user_id=$2 and (not_after is null or not_after>now()))'
   into live using claims->>'session_id',auth.uid();
  if not live then raise exception 'session ended; sign in again' using errcode='42501';end if;
 end if;
end $$;
revoke all on function private.require_active_session() from public,anon,authenticated,service_role;
create or replace function private.require_mfa_admin() returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','')<>'aal2' then raise exception 'MFA administrator required' using errcode='42501';end if;
 perform private.require_active_session();
end $$;
do $$declare f record;definition text;begin
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname in
 ('admin_correct_entry','admin_suspend_profile','publish_reward','admin_review_feedback','admin_set_offer_status','admin_resolve_report')loop
  definition:=pg_get_functiondef(f.oid);
  if position('if not public.is_admin() then' in definition)=0 then raise exception 'expected administrator guard missing';end if;
  definition:=replace(definition,'if not public.is_admin() then','perform private.require_mfa_admin(); if not public.is_admin() then');
  execute definition;
 end loop;
end $$;
commit;
