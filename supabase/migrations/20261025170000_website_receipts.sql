begin;
alter table public.topup_requests add column payer_instapay_address text;
alter table public.topup_requests add column receipt_object_key text;
alter table public.topup_requests add column receipt_uploaded_at timestamptz;
alter table public.topup_requests add column receipt_reviewed_key text;
alter table public.topup_requests add column destination_address text;
alter table public.topup_requests add column destination_name text;
alter table public.topup_requests add column destination_qr_url text;
alter table public.topup_requests add column transfer_note_email text;
create table public.payment_settings(
 id integer primary key default 1 check(id=1),instapay_address text,recipient_name text,qr_url text,
 enabled boolean not null default false,
 check(not enabled or (instapay_address is not null and recipient_name is not null and qr_url is not null and char_length(instapay_address) between 3 and 200 and char_length(recipient_name) between 2 and 200 and qr_url ~ '^https://'))
);
insert into public.payment_settings(id)values(1);
alter table public.payment_settings enable row level security;
revoke all on public.payment_settings from public,anon,authenticated;
grant select on public.payment_settings to authenticated;
grant all on public.payment_settings to service_role;
create policy payment_settings_read on public.payment_settings for select to authenticated using(enabled or public.is_admin());
create function public.admin_configure_payments(p_address text,p_name text,p_qr_url text,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_mfa_admin();
 update public.payment_settings set instapay_address=btrim(p_address),recipient_name=btrim(p_name),qr_url=btrim(p_qr_url),enabled=coalesce(p_enabled,false) where id=1;
 insert into public.audit_log(actor,action,target_type,target_id)values(auth.uid(),'payments.configure','settings','1');
end $$;
create function public.admin_create_coin_package(p_name text,p_coins integer,p_price_piastres integer,p_active boolean default false)
returns public.coin_packages language plpgsql security definer set search_path='' as $$
declare r public.coin_packages;
begin
 perform private.require_mfa_admin();
 insert into public.coin_packages(name,coins,price_piastres,active)values(btrim(p_name),p_coins,p_price_piastres,coalesce(p_active,false))returning * into r;
 insert into public.audit_log(actor,action,target_type,target_id)values(auth.uid(),'package.create','package',r.id::text);return r;
end $$;
create function public.create_checkout(p_package_id uuid,p_request_key uuid,p_accept_terms boolean)
returns public.topup_requests language plpgsql security definer set search_path='' as $$
declare cfg public.payment_settings;r public.topup_requests;email text;
begin
 if p_accept_terms is distinct from true then raise exception 'accept payment terms before checkout';end if;
 select * into cfg from public.payment_settings where id=1 and enabled;
 if not found then raise exception 'payment checkout is not configured';end if;
 r:=public.request_topup(p_package_id,p_request_key);
 perform public.accept_topup_terms(r.id,'manual-final-v1');
 select u.email into email from auth.users u where u.id=auth.uid();
 if r.destination_address is null then
  update public.topup_requests set destination_address=cfg.instapay_address,destination_name=cfg.recipient_name,
   destination_qr_url=cfg.qr_url,transfer_note_email=email where id=r.id returning * into r;
 end if;
 return r;
end $$;
-- Supabase Storage is provisioned by the provider. Pure Postgres test installs may
-- omit it; in that case receipt attachment fails closed until Storage exists.
do $$begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('topup-receipts','topup-receipts',false,5242880,array['image/png','image/jpeg','image/webp'])
  on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
  execute $policy$create policy topup_receipts_insert on storage.objects for insert to authenticated with check(
   bucket_id='topup-receipts' and split_part(name,'/',1)=auth.uid()::text and array_length(string_to_array(name,'/'),1)=3
   and exists(select 1 from public.topup_requests r where r.id::text=split_part(name,'/',2) and r.user_id=auth.uid() and r.status='pending'))$policy$;
  execute $policy$create policy topup_receipts_read on storage.objects for select to authenticated using(
   bucket_id='topup-receipts' and (split_part(name,'/',1)=auth.uid()::text or
   (public.is_admin() and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','')='aal2')))$policy$;
 end if;
end $$;
create function private.receipt_exists(p_key text)returns boolean language plpgsql security definer set search_path='' as $$
declare found_receipt boolean;
begin
 if to_regclass('storage.objects') is null then return false;end if;
 execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)' into found_receipt using 'topup-receipts',p_key;
 return found_receipt;
end $$;
revoke all on function private.receipt_exists(text) from public,anon,authenticated;
create function public.attach_topup_receipt(p_request_id uuid,p_payer_address text,p_reference text,p_object_key text)
returns public.topup_requests language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;payer text:=lower(btrim(p_payer_address));ref text:=upper(btrim(p_reference));
begin
 if auth.uid() is null then raise exception 'sign in required';end if;
 if payer is null or payer !~ '^[a-z0-9._+@-]{3,200}$' or position('@' in payer)=0 then raise exception 'your InstaPay address is required';end if;
 if ref is null or ref !~ '^[A-Z0-9-]{6,100}$' then raise exception 'payment reference required';end if;
 select * into r from public.topup_requests where id=p_request_id and user_id=auth.uid() for update;
 if not found or r.status<>'pending' or r.terms_accepted_at is null then raise exception 'pending checkout with accepted terms required';end if;
 if p_object_key is null or split_part(p_object_key,'/',1)<>auth.uid()::text or split_part(p_object_key,'/',2)<>r.id::text
 or not private.receipt_exists(p_object_key) then raise exception 'upload a private receipt for this checkout first';end if;
 if r.receipt_object_key=p_object_key and r.payer_instapay_address=payer and r.customer_payment_reference=ref then return r;end if;
 update public.topup_requests set payer_instapay_address=payer,customer_payment_reference=ref,receipt_object_key=p_object_key,
 receipt_uploaded_at=now(),proof_reviewed_at=null,proof_reviewed_by=null,receipt_reviewed_key=null where id=r.id returning * into r;
 insert into public.audit_log(actor,action,target_type,target_id)values(auth.uid(),'topup.receipt_uploaded','topup',r.id::text);
 return r;
end $$;
create or replace function public.admin_record_topup_proof(p_request_id uuid,p_note text)returns void
language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;
begin
 perform private.require_mfa_admin();
 if p_note is null or char_length(btrim(p_note)) not between 1 and 500 then raise exception 'receipt review note required';end if;
 select * into r from public.topup_requests where id=p_request_id for update;
 if not found or r.status<>'pending' or r.terms_accepted_at is null or r.customer_payment_reference is null
 or r.payer_instapay_address is null or not private.receipt_exists(r.receipt_object_key) then raise exception 'uploaded receipt, payer address and reference required';end if;
 update public.topup_requests set proof_reviewed_at=now(),proof_reviewed_by=auth.uid(),receipt_reviewed_key=receipt_object_key where id=r.id;
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'topup.proof_reviewed','topup',r.id::text,jsonb_build_object('channel','website','note',btrim(p_note)));
end $$;
create or replace function public.admin_review_topup(p_request_id uuid,p_decision text,p_received_piastres integer default null,
 p_payment_reference text default null,p_note text default null)
returns public.topup_requests language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;
begin
 perform private.require_mfa_admin();
 select * into r from public.topup_requests where id=p_request_id for update;
 if p_decision='approved' and r.status='pending' and
 (r.terms_accepted_at is null or r.customer_payment_reference is null or r.proof_reviewed_at is null
 or r.payer_instapay_address is null or r.receipt_object_key is null or r.receipt_reviewed_key is distinct from r.receipt_object_key
 or not private.receipt_exists(r.receipt_object_key)) then raise exception 'customer reference, terms and uploaded receipt review required';end if;
 return private.review_topup_with_credit(p_request_id,p_decision,p_received_piastres,p_payment_reference,p_note);
end $$;
revoke all on function public.admin_configure_payments(text,text,text,boolean),public.admin_create_coin_package(text,integer,integer,boolean),
 public.create_checkout(uuid,uuid,boolean),public.attach_topup_receipt(uuid,text,text,text) from public,anon;
grant execute on function public.admin_configure_payments(text,text,text,boolean),public.admin_create_coin_package(text,integer,integer,boolean),
 public.create_checkout(uuid,uuid,boolean),public.attach_topup_receipt(uuid,text,text,text) to authenticated;
commit;
