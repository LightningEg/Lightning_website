begin;
-- Payment QR bytes are private runtime configuration, never a public website asset.
create table private.payment_qr_assets(id uuid primary key default gen_random_uuid(),mime text not null check(mime in('image/png','image/jpeg','image/webp')),image bytea not null check(octet_length(image) between 1 and 5242880),created_at timestamptz not null default now());
alter table private.payment_qr_assets enable row level security;
revoke all on private.payment_qr_assets from public,anon,authenticated,service_role;
alter table public.payment_settings add column qr_asset_id uuid references private.payment_qr_assets(id);
alter table public.payment_settings add column support_email text not null default 'hello@lightningeg.com';
alter table public.payment_settings add column processing_message text not null default 'Payments are checked manually. Do not send another transfer while your receipt is being reviewed.' check(char_length(processing_message) between 20 and 400);
alter table public.topup_requests add column destination_qr_asset_id uuid references private.payment_qr_assets(id);
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.payment_settings'::regclass and contype='c' and pg_get_constraintdef(oid) like '%qr_url%'loop execute format('alter table public.payment_settings drop constraint %I',c.conname);end loop;
end $$;
alter table public.payment_settings add constraint payment_checkout_ready check(not enabled or(instapay_address is not null and recipient_name is not null and char_length(instapay_address) between 3 and 200 and char_length(recipient_name) between 2 and 200 and(qr_asset_id is not null or(qr_url is not null and qr_url ~ '^https://'))));
drop policy payment_settings_read on public.payment_settings;
create policy payment_settings_read on public.payment_settings for select to authenticated using(public.is_admin());
create function public.admin_upload_payment_qr(p_image text,p_mime text)returns uuid language plpgsql security definer set search_path='' as $$
declare bytes bytea;asset uuid;
begin
 perform private.require_mfa_admin();
 if p_image is null or char_length(p_image)>7000000 or p_mime is null or p_mime not in('image/png','image/jpeg','image/webp')then raise exception 'PNG, JPEG or WebP up to 5 MB required';end if;
 bytes:=decode(p_image,'base64');
 if octet_length(bytes)<12 or(p_mime='image/png' and encode(substring(bytes from 1 for 8),'hex')<>'89504e470d0a1a0a')or(p_mime='image/jpeg' and encode(substring(bytes from 1 for 2),'hex')<>'ffd8')or(p_mime='image/webp' and(encode(substring(bytes from 1 for 4),'hex')<>'52494646' or encode(substring(bytes from 9 for 4),'hex')<>'57454250'))then raise exception 'image type does not match file';end if;
 insert into private.payment_qr_assets(mime,image)values(p_mime,bytes)returning id into asset;
 insert into public.audit_log(actor,action,target_type,target_id)values(auth.uid(),'payments.qr_upload','asset',asset::text);return asset;
end $$;
create function public.admin_configure_checkout(p_address text,p_name text,p_asset_id uuid,p_enabled boolean,p_processing text)returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_mfa_admin();
 if p_enabled is true and(p_address is null or lower(btrim(p_address))!~'^[a-z0-9._+-]+@[a-z0-9.-]+$' or char_length(p_address)>200 or p_name is null or char_length(btrim(p_name))not between 2 and 200 or not exists(select 1 from private.payment_qr_assets where id=p_asset_id))then raise exception 'receiving address, exact recipient name and private QR required';end if;
 update public.payment_settings set instapay_address=lower(btrim(p_address)),recipient_name=btrim(p_name),qr_asset_id=p_asset_id,qr_url=null,enabled=coalesce(p_enabled,false),processing_message=btrim(p_processing),support_email='hello@lightningeg.com' where id=1;
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'payments.configure','settings','1',jsonb_build_object('enabled',p_enabled));
end $$;
create function public.checkout_availability()returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',coalesce((select enabled from public.payment_settings where id=1),false),'support_email','hello@lightningeg.com','processing_message',(select processing_message from public.payment_settings where id=1));
$$;
-- Preserve the audited terms, retry key and quote logic, then snapshot the private image identity.
alter function public.create_checkout(uuid,uuid,boolean) set schema private;
alter function private.create_checkout(uuid,uuid,boolean)rename to create_checkout_impl;
revoke all on function private.create_checkout_impl(uuid,uuid,boolean)from public,anon,authenticated,service_role;
do $$declare definition text;begin
 definition:=pg_get_functiondef('private.create_checkout_impl(uuid,uuid,boolean)'::regprocedure);
 if position('destination_qr_url=cfg.qr_url,transfer_note_email=email' in definition)=0 then raise exception 'checkout snapshot contract changed';end if;
 definition:=replace(definition,'destination_qr_url=cfg.qr_url,transfer_note_email=email','destination_qr_url=cfg.qr_url,destination_qr_asset_id=cfg.qr_asset_id,transfer_note_email=email');execute definition;
end $$;
create function public.create_checkout(p_package_id uuid,p_request_key uuid,p_accept_terms boolean)returns public.topup_requests language plpgsql security definer set search_path='' as $$
begin return private.create_checkout_impl(p_package_id,p_request_key,p_accept_terms);end $$;
create function public.checkout_qr(p_request_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare asset private.payment_qr_assets;
begin
 perform private.require_active_session();
 select a.* into asset from private.payment_qr_assets a join public.topup_requests r on r.destination_qr_asset_id=a.id
 where r.id=p_request_id and r.user_id=auth.uid() and r.status='pending' and r.terms_accepted_at is not null;
 if not found then raise exception 'QR is available only inside your accepted pending checkout';end if;
 return jsonb_build_object('data_url','data:'||asset.mime||';base64,'||replace(encode(asset.image,'base64'),E'\n',''));
end $$;

-- Amount-based top-ups: the customer buys any whole EGP amount, not a bundle.
create table public.coin_pricing(id integer primary key check(id=1),coins_per_egp integer not null check(coins_per_egp between 1 and 1000),minimum_egp integer not null check(minimum_egp>=1),maximum_egp integer not null check(maximum_egp>=minimum_egp and maximum_egp<=100000),enabled boolean not null default true,version bigint not null default 1);
insert into public.coin_pricing(id,coins_per_egp,minimum_egp,maximum_egp)values(1,5,10,10000);
create table public.coin_bonus_tiers(minimum_egp integer primary key check(minimum_egp>0),bonus_percent integer not null check(bonus_percent between 0 and 30));
insert into public.coin_bonus_tiers values(100,5),(500,10),(1000,15);
alter table public.coin_pricing enable row level security;alter table public.coin_bonus_tiers enable row level security;
revoke all on public.coin_pricing,public.coin_bonus_tiers from public,anon,authenticated;
grant select on public.coin_pricing,public.coin_bonus_tiers to anon,authenticated;grant all on public.coin_pricing,public.coin_bonus_tiers to service_role;
create policy pricing_read on public.coin_pricing for select to anon,authenticated using(true);
create policy bonus_read on public.coin_bonus_tiers for select to anon,authenticated using(true);
alter table public.coin_packages add column is_custom_quote boolean not null default false;
alter table public.topup_requests add column original_amount_piastres integer;
alter table public.topup_requests add column pricing_version bigint;
alter table public.topup_requests add column quote_base_coins integer;
alter table public.topup_requests add column quote_bonus_coins integer;
alter table public.topup_requests add column quote_bonus_percent integer;
create function public.quote_topup_amount(p_amount_piastres integer)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cfg public.coin_pricing;bonus integer;base bigint;extra bigint;
begin
 select * into cfg from public.coin_pricing where id=1;
 if p_amount_piastres is null or p_amount_piastres%100<>0 or p_amount_piastres::bigint<cfg.minimum_egp::bigint*100 or p_amount_piastres::bigint>cfg.maximum_egp::bigint*100 then raise exception 'enter a whole EGP amount within the displayed minimum and maximum';end if;
 select coalesce(max(bonus_percent),0)into bonus from public.coin_bonus_tiers where minimum_egp::bigint*100<=p_amount_piastres;
 base:=p_amount_piastres::bigint*cfg.coins_per_egp/100;extra:=base*bonus/100;
 if base+extra>1000000000 then raise exception 'amount exceeds coin limit';end if;
 return jsonb_build_object('amount_piastres',p_amount_piastres,'base_coins',base,'bonus_percent',bonus,'bonus_coins',extra,'coins',base+extra,'pricing_version',cfg.version,'coins_per_egp',cfg.coins_per_egp,'minimum_egp',cfg.minimum_egp,'maximum_egp',cfg.maximum_egp,'enabled',cfg.enabled);
end $$;
create function public.create_amount_checkout(p_amount_piastres integer,p_request_key uuid,p_accept_terms boolean,p_expected_coins integer,p_pricing_version bigint)returns public.topup_requests language plpgsql security definer set search_path='' as $$
declare cfg public.coin_pricing;r public.topup_requests;quote jsonb;package_id uuid;
begin
 perform private.require_active_session();
 if p_accept_terms is distinct from true or p_request_key is null then raise exception 'accept payment terms and provide a request key';end if;
 perform 1 from public.wallets where user_id=auth.uid()for update;
 select * into r from public.topup_requests where user_id=auth.uid()and request_key=p_request_key;
 if found then
  if r.original_amount_piastres is distinct from p_amount_piastres then raise exception 'request key already used for another amount';end if;return r;
 end if;
 select * into cfg from public.coin_pricing where id=1 for share;
 if not cfg.enabled then raise exception 'new top-ups are currently paused';end if;
 quote:=public.quote_topup_amount(p_amount_piastres);
 if (quote->>'coins')::integer is distinct from p_expected_coins or cfg.version is distinct from p_pricing_version then raise exception 'coin quote changed; refresh the amount before paying';end if;
 insert into public.coin_packages(name,coins,price_piastres,active,is_custom_quote)values('Amount checkout',(quote->>'coins')::integer,p_amount_piastres,true,true)returning id into package_id;
 r:=public.create_checkout(package_id,p_request_key,true);
 update public.coin_packages set active=false where id=package_id;
 update public.topup_requests set original_amount_piastres=p_amount_piastres,pricing_version=cfg.version,quote_base_coins=(quote->>'base_coins')::integer,quote_bonus_coins=(quote->>'bonus_coins')::integer,quote_bonus_percent=(quote->>'bonus_percent')::integer where id=r.id returning * into r;return r;
end $$;
create function public.admin_set_coin_pricing(p_rate integer,p_minimum_egp integer,p_maximum_egp integer,p_enabled boolean,p_tiers jsonb)returns void language plpgsql security definer set search_path='' as $$
declare tier jsonb;
begin
 perform private.require_mfa_admin();
 if p_tiers is null or jsonb_typeof(p_tiers)<>'array' or jsonb_array_length(p_tiers)>8 then raise exception 'up to eight bonus thresholds required';end if;
 update public.coin_pricing set coins_per_egp=p_rate,minimum_egp=p_minimum_egp,maximum_egp=p_maximum_egp,enabled=coalesce(p_enabled,false),version=version+1 where id=1;
 delete from public.coin_bonus_tiers;
 for tier in select * from jsonb_array_elements(p_tiers)loop insert into public.coin_bonus_tiers(minimum_egp,bonus_percent)values((tier->>'minimum_egp')::integer,(tier->>'bonus_percent')::integer);end loop;
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'payments.pricing','settings','1',jsonb_build_object('rate',p_rate,'minimum_egp',p_minimum_egp,'maximum_egp',p_maximum_egp,'enabled',p_enabled,'tiers',p_tiers));
end $$;
revoke all on function public.quote_topup_amount(integer)from public;
grant execute on function public.quote_topup_amount(integer)to anon,authenticated;
revoke all on function public.create_amount_checkout(integer,uuid,boolean,integer,bigint),public.admin_set_coin_pricing(integer,integer,integer,boolean,jsonb)from public,anon;
grant execute on function public.create_amount_checkout(integer,uuid,boolean,integer,bigint),public.admin_set_coin_pricing(integer,integer,integer,boolean,jsonb)to authenticated;

-- Owner-entered incoming bank transfers are a separate reconciliation journal.
create table public.bank_transfers(
 reference text primary key check(reference~'^[A-Z0-9-]{6,100}$'),amount_piastres integer not null check(amount_piastres>0),
 received_at timestamptz not null,request_id uuid references public.topup_requests(id),sender_address text check(char_length(sender_address)<=200),email_note text check(char_length(email_note)<=254),
 recorded_by uuid not null,recorded_at timestamptz not null default now(),note text not null check(char_length(note)between 5 and 500),voided boolean not null default false,
 returned_at timestamptz,credit_entry_id bigint references public.ledger_entries(id),check(credit_entry_id is null or(request_id is not null and not voided))
);
create index bank_transfers_request on public.bank_transfers(request_id);
create index bank_transfers_credit on public.bank_transfers(credit_entry_id);
create index bank_transfers_unmatched on public.bank_transfers(received_at)where request_id is null and not voided;
alter table public.bank_transfers enable row level security;
revoke all on public.bank_transfers from public,anon,authenticated;
grant select on public.bank_transfers to authenticated;grant all on public.bank_transfers to service_role;
create policy bank_transfers_admin on public.bank_transfers for select to authenticated using(public.is_admin() and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','')='aal2');
insert into public.bank_transfers(reference,amount_piastres,received_at,request_id,recorded_by,note,credit_entry_id)
 select payment_reference,received_piastres,reviewed_at,id,reviewed_by,'Historical approved top-up',ledger_entry_id from public.topup_requests where status='approved' on conflict do nothing;
create function public.admin_record_bank_transfer(p_reference text,p_amount_piastres integer,p_received_at timestamptz,p_request_id uuid,p_sender_address text,p_email_note text,p_note text,p_confirmed boolean)
returns public.bank_transfers language plpgsql security definer set search_path='' as $$
declare r public.bank_transfers;ref text:=upper(btrim(p_reference));
begin
 perform private.require_mfa_admin();
 if p_confirmed is distinct from true or p_received_at is null or p_received_at>now()+interval '5 minutes' or p_amount_piastres is null or p_amount_piastres<=0 or p_note is null or char_length(btrim(p_note))not between 5 and 500 then raise exception 'confirm actual incoming funds and enter amount, date and reconciliation note';end if;
 if p_request_id is not null then
  perform 1 from public.topup_requests where id=p_request_id and status='pending' and user_id is not null for update;
  if not found then raise exception 'pending member request required';end if;
 end if;
 if exists(select 1 from public.payment_returns where reference=ref)then raise exception 'bank reference already used for an outgoing return';end if;
 perform pg_advisory_xact_lock(hashtext('bank:'||coalesce(ref,'')));
 select * into r from public.bank_transfers where reference=ref for update;
 if found then
  if r.amount_piastres is distinct from p_amount_piastres or r.request_id is distinct from p_request_id or r.voided then raise exception 'bank reference already recorded; review the journal instead of adding it again';end if;return r;
 end if;
 insert into public.bank_transfers(reference,amount_piastres,received_at,request_id,sender_address,email_note,recorded_by,note)
 values(ref,p_amount_piastres,p_received_at,p_request_id,nullif(lower(btrim(p_sender_address)),''),nullif(lower(btrim(p_email_note)),''),auth.uid(),btrim(p_note))returning * into r;
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'bank.record','bank_transfer',ref,jsonb_build_object('amount_piastres',p_amount_piastres,'request_id',p_request_id));return r;
end $$;
create function public.admin_correct_bank_transfer(p_reference text,p_amount_piastres integer,p_request_id uuid,p_voided boolean,p_note text)
returns public.bank_transfers language plpgsql security definer set search_path='' as $$
declare r public.bank_transfers;old_request uuid;ref text:=upper(btrim(p_reference));prior jsonb;
begin
 perform private.require_mfa_admin();
 if p_note is null or char_length(btrim(p_note))not between 5 and 500 or p_amount_piastres is null or p_amount_piastres<=0 or p_voided is null then raise exception 'correction amount and clear reason required';end if;
 select request_id into old_request from public.bank_transfers where reference=ref;
 perform 1 from public.topup_requests where id in(old_request,p_request_id)order by id for update;
 select * into r from public.bank_transfers where reference=ref for update;
 if not found then raise exception 'bank transfer not found';end if;
 if r.request_id is distinct from old_request then raise exception 'assignment changed; reload journal';end if;
 if exists(select 1 from public.payment_returns where request_id=r.request_id)then raise exception 'returned transfer cannot be changed or reused';end if;
 if r.credit_entry_id is not null or exists(select 1 from public.topup_requests where id=r.request_id and status='approved')then raise exception 'credited transfer cannot be changed';end if;
 if p_request_id is not null and not exists(select 1 from public.topup_requests where id=p_request_id and status='pending' and user_id is not null)then raise exception 'pending member request required';end if;
 prior:=jsonb_build_object('amount_piastres',r.amount_piastres,'request_id',r.request_id,'voided',r.voided);
 update public.bank_transfers set amount_piastres=p_amount_piastres,request_id=p_request_id,voided=p_voided,note=btrim(p_note)where reference=ref returning * into r;
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'bank.correct','bank_transfer',ref,jsonb_build_object('before',prior,'after',jsonb_build_object('amount_piastres',r.amount_piastres,'request_id',r.request_id,'voided',r.voided),'reason',btrim(p_note)));return r;
end $$;
create function private.enforce_bank_settlement()returns trigger language plpgsql security definer set search_path='' as $$
declare total bigint;
begin
 if new.status='approved' and old.status is distinct from 'approved' then
  perform 1 from public.bank_transfers where request_id=new.id and not voided order by reference for update;
  select coalesce(sum(amount_piastres),0) into total from public.bank_transfers where request_id=new.id and not voided and credit_entry_id is null;
  if total<>new.price_piastres or total<>new.received_piastres or not exists(select 1 from public.bank_transfers where request_id=new.id and reference=new.payment_reference and not voided and credit_entry_id is null)then raise exception 'record and match actual bank transfers before approving; total must equal the accepted quote';end if;
  update public.bank_transfers set credit_entry_id=new.ledger_entry_id where request_id=new.id and not voided and credit_entry_id is null;
 end if;return new;
end $$;
create trigger topup_bank_settlement before update on public.topup_requests for each row execute function private.enforce_bank_settlement();
-- Use the existing transactional receipt review + wallet transaction as the internal settlement primitive.
alter function public.admin_settle_topup(uuid,text,bigint,integer,text,text)set schema private;
alter function private.admin_settle_topup(uuid,text,bigint,integer,text,text)rename to settle_topup_impl;
revoke all on function private.settle_topup_impl(uuid,text,bigint,integer,text,text)from public,anon,authenticated,service_role;
create function public.admin_settle_topup_from_transfers(p_request_id uuid,p_receipt_key text,p_receipt_revision bigint,p_note text)
returns public.topup_requests language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;total bigint;ref text;
begin
 perform private.require_mfa_admin();
 perform 1 from public.wallets where user_id=(select user_id from public.topup_requests where id=p_request_id)for update;
 select * into r from public.topup_requests where id=p_request_id for update;
 if not found then raise exception 'request not found';end if;
 if r.status='approved' then return r;end if;
 perform 1 from public.bank_transfers where request_id=r.id and not voided order by reference for update;
 select coalesce(sum(amount_piastres),0),min(reference)into total,ref from public.bank_transfers where request_id=r.id and not voided and credit_entry_id is null;
 if total<>r.price_piastres then raise exception 'bank total does not match accepted quote; collect the missing transfer or propose a member-approved adjustment';end if;
 return private.settle_topup_impl(r.id,p_receipt_key,p_receipt_revision,total::integer,ref,p_note);
end $$;
create function public.admin_settle_topup(p_request_id uuid,p_receipt_key text,p_receipt_revision bigint,p_received_piastres integer,p_payment_reference text,p_note text)
returns public.topup_requests language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;ref text:=upper(btrim(p_payment_reference));
begin
 perform private.require_mfa_admin();
 perform 1 from public.wallets where user_id=(select user_id from public.topup_requests where id=p_request_id)for update;
 select * into r from public.topup_requests where id=p_request_id for update;
 if r.status='approved' then
  if r.received_piastres is distinct from p_received_piastres or r.payment_reference is distinct from ref then raise exception 'approved request already settled with different details';end if;return r;
 end if;
 perform public.admin_record_bank_transfer(p_payment_reference,p_received_piastres,now(),p_request_id,null,null,p_note,true);
 return public.admin_settle_topup_from_transfers(p_request_id,p_receipt_key,p_receipt_revision,p_note);
end $$;

-- Quote corrections require the member's explicit acceptance before any coin credit.
create table public.topup_adjustments(
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.topup_requests(id),
 original_coins integer not null,original_piastres integer not null,proposed_coins integer not null check(proposed_coins>0),proposed_piastres integer not null check(proposed_piastres>0),
 status text not null default 'pending' check(status in('pending','accepted','declined','superseded')),note text not null check(char_length(note)between 5 and 500),
 proposed_by uuid not null,created_at timestamptz not null default now(),decided_at timestamptz
);
create index topup_adjustments_request on public.topup_adjustments(request_id);
alter table public.topup_adjustments enable row level security;
revoke all on public.topup_adjustments from public,anon,authenticated;
grant select on public.topup_adjustments to authenticated;grant all on public.topup_adjustments to service_role;
create policy topup_adjustments_read on public.topup_adjustments for select to authenticated using(public.is_admin()or exists(select 1 from public.topup_requests where id=request_id and user_id=auth.uid()));
create function public.admin_propose_topup_adjustment(p_request_id uuid,p_coins integer,p_note text)returns public.topup_adjustments language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;a public.topup_adjustments;total bigint;
begin
 perform private.require_mfa_admin();
 select * into r from public.topup_requests where id=p_request_id and status='pending' and user_id is not null for update;
 if not found or p_coins is null or p_coins<1 or p_coins>1000000 or p_note is null or char_length(btrim(p_note))not between 5 and 500 then raise exception 'pending request, coin quote and reason required';end if;
 select coalesce(sum(amount_piastres),0)into total from public.bank_transfers where request_id=r.id and not voided and credit_entry_id is null;
 if total<1 or total>2147483647 then raise exception 'record the actual bank transfer first';end if;
 update public.topup_adjustments set status='superseded',decided_at=now()where request_id=r.id and status='pending';
 insert into public.topup_adjustments(request_id,original_coins,original_piastres,proposed_coins,proposed_piastres,note,proposed_by)
 values(r.id,r.coins,r.price_piastres,p_coins,total::integer,btrim(p_note),auth.uid())returning * into a;
 insert into public.audit_log(actor,action,target_type,target_id)values(auth.uid(),'topup.adjustment_proposed','topup',r.id::text);return a;
end $$;
create function public.accept_topup_adjustment(p_adjustment_id uuid,p_accept boolean)returns public.topup_adjustments language plpgsql security definer set search_path='' as $$
declare a public.topup_adjustments;r public.topup_requests;rid uuid;total bigint;
begin
 perform private.require_active_session();
 select request_id into rid from public.topup_adjustments where id=p_adjustment_id;
 perform 1 from public.wallets where user_id=auth.uid()for update;
 select * into r from public.topup_requests where id=rid and user_id=auth.uid()for update;
 if not found or p_accept is null then raise exception 'your pending quote adjustment required';end if;
 select * into a from public.topup_adjustments where id=p_adjustment_id for update;
 if a.status=(case when p_accept then 'accepted' else 'declined' end) then return a;end if;
 if r.status<>'pending' or a.status<>'pending' then raise exception 'adjustment is no longer pending';end if;
 if p_accept then
  select coalesce(sum(amount_piastres),0)into total from public.bank_transfers where request_id=r.id and not voided and credit_entry_id is null;
  if total<>a.proposed_piastres or r.coins<>a.original_coins or r.price_piastres<>a.original_piastres then raise exception 'funding or quote changed; request an updated proposal';end if;
  update public.topup_requests set coins=a.proposed_coins,price_piastres=a.proposed_piastres,receipt_revision=receipt_revision+1,proof_reviewed_at=null,proof_reviewed_by=null,receipt_reviewed_key=null where id=r.id;
 end if;
 update public.topup_adjustments set status=case when p_accept then 'accepted' else 'declined' end,decided_at=now()where id=a.id returning * into a;
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'topup.adjustment_decided','topup',r.id::text,jsonb_build_object('adjustment_id',a.id,'accepted',p_accept));return a;
end $$;
create table public.payment_returns(reference text primary key check(reference~'^[A-Z0-9-]{6,100}$'),request_id uuid not null unique references public.topup_requests(id),amount_piastres integer not null check(amount_piastres>0),recorded_by uuid not null,recorded_at timestamptz not null default now(),note text not null check(char_length(note)between 5 and 500));
alter table public.payment_returns enable row level security;
revoke all on public.payment_returns from public,anon,authenticated;grant select on public.payment_returns to authenticated;grant all on public.payment_returns to service_role;
create policy payment_returns_read on public.payment_returns for select to authenticated using(public.is_admin()or exists(select 1 from public.topup_requests where id=request_id and user_id=auth.uid()));
create function public.admin_record_payment_return(p_request_id uuid,p_reference text,p_note text,p_confirmed boolean)returns void language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;total bigint;ref text:=upper(btrim(p_reference));prior public.payment_returns;
begin
 perform private.require_mfa_admin();
 select * into r from public.topup_requests where id=p_request_id for update;
 if not found or p_confirmed is distinct from true or p_note is null or char_length(btrim(p_note))not between 5 and 500 then raise exception 'confirm the external bank return and add its reference and reason';end if;
 select * into prior from public.payment_returns where request_id=r.id;
 if found then if prior.reference is distinct from ref then raise exception 'a different return is already recorded';end if;return;end if;
 if r.status='approved' then raise exception 'credited top-ups require separate ledger reconciliation; this is only for uncredited payments';end if;
 if exists(select 1 from public.bank_transfers where reference=ref)then raise exception 'return reference cannot reuse an incoming transfer reference';end if;
 select coalesce(sum(amount_piastres),0)into total from public.bank_transfers where request_id=r.id and not voided and credit_entry_id is null;
 if total<1 or total>2147483647 then raise exception 'no uncredited received funds to return';end if;
 insert into public.payment_returns(reference,request_id,amount_piastres,recorded_by,note)values(ref,r.id,total::integer,auth.uid(),btrim(p_note));
 update public.bank_transfers set returned_at=now()where request_id=r.id and not voided;
 update public.topup_requests set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),review_note=left('Uncredited payment returned externally. '||btrim(p_note),500)where id=r.id;
 update public.topup_adjustments set status='superseded',decided_at=now()where request_id=r.id and status='pending';
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'topup.external_return_recorded','topup',r.id::text,jsonb_build_object('reference',ref,'amount_piastres',total));
end $$;
create function public.topup_funding_status(p_request_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.topup_requests;total bigint;
begin
 perform private.require_active_session();
 select * into r from public.topup_requests where id=p_request_id and user_id=auth.uid();if not found then raise exception 'request not found';end if;
 select coalesce(sum(amount_piastres),0)into total from public.bank_transfers where request_id=r.id and not voided;
 return jsonb_build_object('received_piastres',total,'quote_piastres',r.price_piastres,'remaining_piastres',greatest(r.price_piastres-total,0),'overpaid_piastres',greatest(total-r.price_piastres,0),'status',r.status,'returned',exists(select 1 from public.payment_returns where request_id=r.id));
end $$;
create function public.admin_store_overview()returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_mfa_admin();
 return jsonb_build_object('payments_enabled',(select enabled from public.payment_settings),'packages',(select count(*)from public.coin_packages where active),'pending_requests',(select count(*)from public.topup_requests where status='pending'),'unmatched_transfers',(select count(*)from public.bank_transfers where request_id is null and not voided),'pending_social',(select count(*)from public.community_stories where status='pending'),'wallet_mismatches',(select count(*)from(select w.user_id from public.wallets w left join public.ledger_entries e using(user_id)group by w.user_id,w.balance having w.balance<>coalesce(sum(e.wallet_delta),0))x));
end $$;
-- A rejected image must not hide received funds or let deletion discard reconciliation identity.
alter function public.admin_review_topup(uuid,text,integer,text,text)set schema private;
alter function private.admin_review_topup(uuid,text,integer,text,text)rename to review_topup_bank_impl;
revoke all on function private.review_topup_bank_impl(uuid,text,integer,text,text)from public,anon,authenticated,service_role;
create function public.admin_review_topup(p_request_id uuid,p_decision text,p_received_piastres integer default null,p_payment_reference text default null,p_note text default null)returns public.topup_requests language plpgsql security definer set search_path='' as $$
begin
 perform private.require_mfa_admin();
 perform 1 from public.wallets where user_id=(select user_id from public.topup_requests where id=p_request_id)for update;
 perform 1 from public.topup_requests where id=p_request_id for update;
 if p_decision='rejected' and exists(select 1 from public.bank_transfers where request_id=p_request_id and not voided and credit_entry_id is null)and not exists(select 1 from public.payment_returns where request_id=p_request_id)then raise exception 'received funds must be reconciled or returned before closing this request';end if;
 return private.review_topup_bank_impl(p_request_id,p_decision,p_received_piastres,p_payment_reference,p_note);
end $$;
revoke all on function public.admin_review_topup(uuid,text,integer,text,text)from public,anon;
grant execute on function public.admin_review_topup(uuid,text,integer,text,text)to authenticated;
create function private.assert_no_unresolved_bank_funds()returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_active_session();
 perform 1 from public.wallets where user_id=auth.uid()for update;
 perform 1 from public.topup_requests where user_id=auth.uid()order by id for update;
 if exists(select 1 from public.bank_transfers b where not b.voided and b.credit_entry_id is null and(
  b.request_id in(select id from public.topup_requests where user_id=auth.uid())or(b.request_id is null and b.email_note=(select lower(email)from auth.users where id=auth.uid())))and not exists(select 1 from public.payment_returns where request_id=b.request_id))then raise exception 'resolve pending payments with support before deleting your account';end if;
end $$;
alter function public.prepare_account_deletion(text)set schema private;
alter function private.prepare_account_deletion(text)rename to prepare_deletion_bank_impl;
revoke all on function private.prepare_deletion_bank_impl(text)from public,anon,authenticated,service_role;
create function public.prepare_account_deletion(p_confirm text)returns table(object_key text)language plpgsql security definer set search_path='' as $$
begin perform private.assert_no_unresolved_bank_funds();return query select * from private.prepare_deletion_bank_impl(p_confirm);end $$;
alter function public.delete_my_account(text)set schema private;
alter function private.delete_my_account(text)rename to delete_account_bank_impl;
revoke all on function private.delete_account_bank_impl(text)from public,anon,authenticated,service_role;
create function public.delete_my_account(p_confirm text)returns void language plpgsql security definer set search_path='' as $$
begin perform private.assert_no_unresolved_bank_funds();perform private.delete_account_bank_impl(p_confirm);end $$;
revoke all on function public.prepare_account_deletion(text),public.delete_my_account(text),private.assert_no_unresolved_bank_funds()from public,anon;
revoke all on function private.assert_no_unresolved_bank_funds()from authenticated,service_role;
grant execute on function public.prepare_account_deletion(text),public.delete_my_account(text)to authenticated;
-- One reference namespace covers incoming transfers, outgoing returns and corrected aliases.
create table private.payment_reference_registry(reference text primary key,kind text not null check(kind in('incoming','return')),canonical_reference text not null,created_at timestamptz not null default now());
alter table private.payment_reference_registry enable row level security;
revoke all on private.payment_reference_registry from public,anon,authenticated,service_role;
insert into private.payment_reference_registry(reference,kind,canonical_reference)select reference,'incoming',reference from public.bank_transfers;
insert into private.payment_reference_registry(reference,kind,canonical_reference)select reference,'return',reference from public.payment_returns;
create function private.claim_bank_reference()returns trigger language plpgsql security definer set search_path='' as $$
declare transfer_kind text:=case when tg_table_name='bank_transfers' then 'incoming' else 'return' end;
begin
 insert into private.payment_reference_registry(reference,kind,canonical_reference)values(new.reference,transfer_kind,new.reference)on conflict do nothing;
 if not exists(select 1 from private.payment_reference_registry r where r.reference=new.reference and r.kind=transfer_kind and r.canonical_reference=new.reference)then raise exception 'bank reference already used for another transfer, return or corrected reference';end if;return new;
end $$;
create trigger bank_reference_unique before insert on public.bank_transfers for each row execute function private.claim_bank_reference();
create trigger return_reference_unique before insert on public.payment_returns for each row execute function private.claim_bank_reference();
create function public.admin_add_bank_reference_alias(p_reference text,p_alias text,p_kind text,p_note text,p_confirmed boolean)returns void language plpgsql security definer set search_path='' as $$
declare canonical text:=upper(btrim(p_reference));alias text:=upper(btrim(p_alias));
begin
 perform private.require_mfa_admin();
 if p_confirmed is distinct from true or alias is null or alias!~'^[A-Z0-9-]{6,100}$' or p_kind is null or p_kind not in('incoming','return')or p_note is null or char_length(btrim(p_note))not between 5 and 500 then raise exception 'confirm the actual corrected bank reference and provide a reason';end if;
 if not exists(select 1 from private.payment_reference_registry r where r.reference=canonical and r.canonical_reference=canonical and r.kind=p_kind)then raise exception 'original bank record not found';end if;
 insert into private.payment_reference_registry(reference,kind,canonical_reference)values(alias,p_kind,canonical)on conflict do nothing;
 if not exists(select 1 from private.payment_reference_registry r where r.reference=alias and r.kind=p_kind and r.canonical_reference=canonical)then raise exception 'corrected reference already belongs to another bank record';end if;
 insert into public.audit_log(actor,action,target_type,target_id,detail)select auth.uid(),'bank.reference_alias','bank_transfer',canonical,jsonb_build_object('alias',alias,'kind',p_kind,'reason',btrim(p_note))where not exists(select 1 from public.audit_log where action='bank.reference_alias' and target_id=canonical and detail->>'alias'=alias);
end $$;
revoke all on function private.claim_bank_reference()from public,anon,authenticated,service_role;
revoke all on function public.admin_add_bank_reference_alias(text,text,text,text,boolean)from public,anon;
grant execute on function public.admin_add_bank_reference_alias(text,text,text,text,boolean)to authenticated;
-- Clear provider-side sender hints on deletion too. The immutable reference and amounts remain for reconciliation.
create function private.scrub_bank_sender_on_user_delete()returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.bank_transfers set sender_address=null,email_note=null where request_id in(select id from public.topup_requests where user_id=old.id);
 return old;
end $$;
create trigger account_bank_sender_cleanup before delete on auth.users for each row execute function private.scrub_bank_sender_on_user_delete();
revoke all on function private.enforce_bank_settlement(),private.scrub_bank_sender_on_user_delete()from public,anon,authenticated,service_role;
revoke all on function public.admin_upload_payment_qr(text,text),public.admin_configure_checkout(text,text,uuid,boolean,text),public.checkout_availability(),public.create_checkout(uuid,uuid,boolean),public.checkout_qr(uuid),public.admin_record_bank_transfer(text,integer,timestamptz,uuid,text,text,text,boolean),public.admin_correct_bank_transfer(text,integer,uuid,boolean,text),public.admin_settle_topup_from_transfers(uuid,text,bigint,text),public.admin_settle_topup(uuid,text,bigint,integer,text,text),public.admin_propose_topup_adjustment(uuid,integer,text),public.accept_topup_adjustment(uuid,boolean),public.admin_record_payment_return(uuid,text,text,boolean),public.topup_funding_status(uuid),public.admin_store_overview()from public,anon;
grant execute on function public.admin_upload_payment_qr(text,text),public.admin_configure_checkout(text,text,uuid,boolean,text),public.checkout_availability(),public.create_checkout(uuid,uuid,boolean),public.checkout_qr(uuid),public.admin_record_bank_transfer(text,integer,timestamptz,uuid,text,text,text,boolean),public.admin_correct_bank_transfer(text,integer,uuid,boolean,text),public.admin_settle_topup_from_transfers(uuid,text,bigint,text),public.admin_settle_topup(uuid,text,bigint,integer,text,text),public.admin_propose_topup_adjustment(uuid,integer,text),public.accept_topup_adjustment(uuid,boolean),public.admin_record_payment_return(uuid,text,text,boolean),public.topup_funding_status(uuid),public.admin_store_overview()to authenticated;
alter function public.export_my_data()set schema private;
alter function private.export_my_data()rename to export_payment_data_impl;
revoke all on function private.export_payment_data_impl()from public,anon,authenticated,service_role;
create function public.export_my_data()returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.export_payment_data_impl();
 return result||jsonb_build_object('bank_transfers',(select coalesce(jsonb_agg(jsonb_build_object('reference',b.reference,'amount_piastres',b.amount_piastres,'received_at',b.received_at,'request_id',b.request_id,'voided',b.voided)),'[]'::jsonb)from public.bank_transfers b join public.topup_requests r on r.id=b.request_id where r.user_id=auth.uid()),'topup_adjustments',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb)from public.topup_adjustments a join public.topup_requests r on r.id=a.request_id where r.user_id=auth.uid()),'payment_returns',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb)from public.payment_returns a join public.topup_requests r on r.id=a.request_id where r.user_id=auth.uid()));
end $$;
revoke all on function public.export_my_data()from public,anon;grant execute on function public.export_my_data()to authenticated;
create or replace function public.checkout_availability()returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',coalesce((select s.enabled and p.enabled from public.payment_settings s cross join public.coin_pricing p where s.id=1 and p.id=1),false),'support_email','hello@lightningeg.com','processing_message',(select processing_message from public.payment_settings where id=1));
$$;
commit;
