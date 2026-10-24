begin;
-- A bundled item is registered only after that app version has actually shipped.
create table public.bundled_item_versions (
 item_id text not null references public.catalog_items(id),
 asset_version integer not null check (asset_version > 0),
 enabled boolean not null default false,
 primary key(item_id,asset_version)
);
alter table public.bundled_item_versions enable row level security;
revoke all on public.bundled_item_versions from public, anon, authenticated;
grant select on public.bundled_item_versions to authenticated;
grant all on public.bundled_item_versions to service_role;
create policy bundled_read on public.bundled_item_versions for select to authenticated using(enabled);
create table private.activation_tickets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 item_id text not null,
 asset_version integer not null,
 code_hash text not null unique,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '10 minutes',
 redeemed_at timestamptz,
 foreign key(item_id,asset_version) references public.bundled_item_versions(item_id,asset_version)
);
revoke all on private.activation_tickets from public, anon, authenticated, service_role;
create function public.issue_activation_code(p_item_id text,p_asset_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); code text:=replace(gen_random_uuid()::text,'-',''); t private.activation_tickets;
begin
 if uid is null then raise exception 'sign in required' using errcode='28000'; end if;
 perform 1 from public.wallets where user_id=uid for update;
 if not exists(select 1 from public.inventory where user_id=uid and item_id=p_item_id) then
  raise exception 'item not owned' using errcode='42501'; end if;
 if not exists(select 1 from public.bundled_item_versions where item_id=p_item_id and asset_version=p_asset_version and enabled) then
  raise exception 'app unlock is not available for this item version'; end if;
 if (select count(*) from private.activation_tickets where user_id=uid and created_at>now()-interval '1 hour')>=20 then
  raise exception 'too many activation requests'; end if;
 insert into private.activation_tickets(user_id,item_id,asset_version,code_hash)
 values(uid,p_item_id,p_asset_version,encode(sha256(convert_to(code,'UTF8')),'hex')) returning * into t;
 -- Only the initial response contains the plaintext code. It never enters audit logs.
 return jsonb_build_object('code',upper(substr(code,1,8)||'-'||substr(code,9,8)||'-'||substr(code,17,8)||'-'||substr(code,25,8)),
  'expires_at',t.expires_at,'item_id',t.item_id,'asset_version',t.asset_version);
end $$;
create function public.redeem_activation_code(p_code text,p_item_id text,p_asset_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare code text:=lower(replace(btrim(p_code),'-',''));t private.activation_tickets;
begin
 if code is null or code !~ '^[0-9a-f]{32}$' then raise exception 'invalid or expired activation code'; end if;
 select * into t from private.activation_tickets where code_hash=encode(sha256(convert_to(code,'UTF8')),'hex') for update;
 if not found or t.expires_at<=now() or t.redeemed_at is not null then raise exception 'invalid or expired activation code'; end if;
 -- An old app must not consume a ticket for a theme/version it cannot apply.
 if t.item_id is distinct from p_item_id or t.asset_version is distinct from p_asset_version then
  raise exception 'unsupported bundled item version'; end if;
 if not exists(select 1 from public.bundled_item_versions where item_id=t.item_id and asset_version=t.asset_version and enabled)
 or not exists(select 1 from public.inventory where user_id=t.user_id and item_id=t.item_id) then
  raise exception 'item no longer available for activation'; end if;
 update private.activation_tickets set redeemed_at=now() where id=t.id;
 insert into public.audit_log(actor,action,target_type,target_id,detail)
 values(t.user_id,'activation.redeem','activation',t.id::text,jsonb_build_object('item_id',t.item_id));
 return jsonb_build_object('schema_version',1,'account_id',t.user_id,'items',
  jsonb_build_array(jsonb_build_object('item_id',t.item_id,'asset_version',t.asset_version,'deliveries','[]'::jsonb)));
end $$;
revoke all on function public.issue_activation_code(text,integer) from public, anon, service_role;
grant execute on function public.issue_activation_code(text,integer) to authenticated;
revoke all on function public.redeem_activation_code(text,text,integer) from public, anon, authenticated;
grant execute on function public.redeem_activation_code(text,text,integer) to service_role;

alter table public.topup_requests add column customer_payment_reference text
 check (char_length(customer_payment_reference) between 6 and 100);
alter table public.topup_requests add column terms_version text;
alter table public.topup_requests add column terms_accepted_at timestamptz;
alter table public.topup_requests add column proof_reviewed_at timestamptz;
alter table public.topup_requests add column proof_reviewed_by uuid;
create function public.accept_topup_terms(p_request_id uuid,p_terms_version text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
 if p_terms_version is distinct from 'manual-final-v1' then raise exception 'accept the current payment terms'; end if;
 update public.topup_requests set terms_version=p_terms_version,terms_accepted_at=coalesce(terms_accepted_at,now())
 where id=p_request_id and user_id=auth.uid() and status='pending';
 if not found then raise exception 'pending request not found'; end if;
end $$;
revoke all on function public.accept_topup_terms(uuid,text) from public,anon;
grant execute on function public.accept_topup_terms(uuid,text) to authenticated;
create function public.submit_topup_reference(p_request_id uuid,p_reference text,p_terms_version text)
returns public.topup_requests language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;ref text:=upper(btrim(p_reference));
begin
 if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
 if p_terms_version is distinct from 'manual-final-v1' then raise exception 'accept the current payment terms'; end if;
 if ref is null or ref !~ '^[A-Z0-9-]{6,100}$' then raise exception 'customer payment reference required'; end if;
 select * into r from public.topup_requests where id=p_request_id and user_id=auth.uid() for update;
 if not found then raise exception 'request not found'; end if;
 if r.terms_accepted_at is null or r.terms_version is distinct from p_terms_version then raise exception 'accept payment terms before submitting proof'; end if;
 if r.customer_payment_reference=ref and r.terms_version=p_terms_version then return r; end if;
 if r.status<>'pending' or r.customer_payment_reference is not null then raise exception 'reference already submitted; contact support'; end if;
 update public.topup_requests set customer_payment_reference=ref,terms_version=p_terms_version,terms_accepted_at=now()
 where id=r.id returning * into r;
 return r;
end $$;
create function public.admin_record_topup_proof(p_request_id uuid,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;
begin
 if not public.is_admin() or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','')<>'aal2' then
  raise exception 'MFA administrator required' using errcode='42501'; end if;
 if p_note is null or char_length(btrim(p_note)) not between 1 and 500 then raise exception 'screenshot review note required'; end if;
 select * into r from public.topup_requests where id=p_request_id for update;
 if not found or r.status<>'pending' or r.terms_accepted_at is null or r.customer_payment_reference is null then
  raise exception 'pending request with customer reference and accepted terms required'; end if;
 update public.topup_requests set proof_reviewed_at=now(),proof_reviewed_by=auth.uid() where id=r.id;
 insert into public.audit_log(actor,action,target_type,target_id,detail)
 values(auth.uid(),'topup.proof_reviewed','topup',r.id::text,jsonb_build_object('note',btrim(p_note),'channel','whatsapp'));
end $$;
-- Preserve the audited credit transaction; add proof and terms preconditions around it.
alter function public.admin_review_topup(uuid,text,integer,text,text) set schema private;
alter function private.admin_review_topup(uuid,text,integer,text,text) rename to review_topup_with_credit;
revoke all on function private.review_topup_with_credit(uuid,text,integer,text,text) from public,anon,authenticated,service_role;
create function public.admin_review_topup(p_request_id uuid,p_decision text,p_received_piastres integer default null,
 p_payment_reference text default null,p_note text default null)
returns public.topup_requests language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'administrator required' using errcode='42501'; end if;
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','')<>'aal2' then raise exception 'MFA verification required' using errcode='42501'; end if;
 if p_decision='approved' and not exists(select 1 from public.topup_requests where id=p_request_id
  and (status <> 'pending' or (proof_reviewed_at is not null and terms_accepted_at is not null and customer_payment_reference is not null))) then
  raise exception 'customer reference, accepted terms and screenshot review required'; end if;
 return private.review_topup_with_credit(p_request_id,p_decision,p_received_piastres,p_payment_reference,p_note);
end $$;
revoke all on function public.admin_review_topup(uuid,text,integer,text,text), public.submit_topup_reference(uuid,text,text),
 public.admin_record_topup_proof(uuid,text) from public,anon;
grant execute on function public.admin_review_topup(uuid,text,integer,text,text), public.submit_topup_reference(uuid,text,text),
 public.admin_record_topup_proof(uuid,text) to authenticated;
commit;
