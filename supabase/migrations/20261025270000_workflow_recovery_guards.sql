begin;
alter table public.topup_requests add column reopened_at timestamptz;
-- Late transfers need a recoverable checkout, without creating a second purchase quote.
create function public.admin_reopen_topup(p_request_id uuid,p_note text)returns public.topup_requests language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;
begin
 perform private.require_mfa_admin();
 if p_note is null or char_length(btrim(p_note))not between 5 and 500 then raise exception 'clear reason for reopening required';end if;
 perform 1 from public.wallets where user_id=(select user_id from public.topup_requests where id=p_request_id)for update;
 select * into r from public.topup_requests where id=p_request_id for update;
 if not found or r.user_id is null then raise exception 'member request required';end if;
 if r.status='approved' or r.ledger_entry_id is not null then raise exception 'credited request cannot be reopened';end if;
 if exists(select 1 from public.payment_returns where request_id=r.id)then raise exception 'returned payment cannot be reopened';end if;
 if r.status='pending' then return r;end if;
 if r.status not in('cancelled','rejected') or r.terms_accepted_at is null or r.destination_address is null then raise exception 'accepted cancelled or rejected checkout required';end if;
 if exists(select 1 from public.account_deletion_requests where user_id=r.user_id)then raise exception 'account deletion in progress';end if;
 if(select count(*)from public.topup_requests where user_id=r.user_id and status='pending')>=20 then raise exception 'too many pending requests; resolve an existing request first';end if;
 update public.topup_requests set status='pending',reviewed_by=null,reviewed_at=null,reopened_at=now(),review_note='Reopened to review a payment already sent. Do not pay again; upload your receipt or contact support.',
  receipt_revision=receipt_revision+1,proof_reviewed_at=null,proof_reviewed_by=null,receipt_reviewed_key=null where id=r.id returning * into r;
 update public.topup_adjustments set status='superseded',decided_at=now()where request_id=r.id and status='pending';
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'topup.reopened','topup',r.id::text,jsonb_build_object('reason',btrim(p_note)));
 return r;
end $$;
revoke all on function public.admin_reopen_topup(uuid,text)from public,anon;
grant execute on function public.admin_reopen_topup(uuid,text)to authenticated;
-- A transfer from an unknown/deleted account must be resolvable without a fabricated checkout.
alter table public.payment_returns alter column request_id drop not null;
alter table public.payment_returns add column incoming_references text[] not null default '{}';
alter table public.bank_transfers add column return_reference text references public.payment_returns(reference);
create index bank_transfers_return_reference on public.bank_transfers(return_reference);
update public.bank_transfers b set return_reference=p.reference from public.payment_returns p where p.request_id=b.request_id and b.returned_at is not null;
create function private.protect_returned_bank_transfer()returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.returned_at is not null and(new.amount_piastres,new.request_id,new.voided,new.credit_entry_id,new.returned_at,new.return_reference)is distinct from(old.amount_piastres,old.request_id,old.voided,old.credit_entry_id,old.returned_at,old.return_reference)then raise exception 'returned transfer cannot be changed or reused';end if;
 if new.returned_at is not null and new.return_reference is null and new.request_id is not null then
  select reference into new.return_reference from public.payment_returns where request_id=new.request_id;
 end if;return new;
end $$;
revoke all on function private.protect_returned_bank_transfer()from public,anon,authenticated,service_role;
create trigger protect_returned_bank_transfer before update on public.bank_transfers for each row execute function private.protect_returned_bank_transfer();
create function public.admin_record_unmatched_payment_return(p_incoming_reference text,p_outgoing_reference text,p_note text,p_confirmed boolean)returns void language plpgsql security definer set search_path='' as $$
declare b public.bank_transfers;incoming text:=upper(btrim(p_incoming_reference));outgoing text:=upper(btrim(p_outgoing_reference));
begin
 perform private.require_mfa_admin();
 if p_confirmed is distinct from true or p_note is null or char_length(btrim(p_note))not between 5 and 500 or outgoing is null or outgoing!~'^[A-Z0-9-]{6,100}$'then raise exception 'confirm the actual external return and provide its outgoing reference and reason';end if;
 select * into b from public.bank_transfers where reference=incoming for update;
 if not found or b.request_id is not null or b.voided or b.credit_entry_id is not null then raise exception 'an unmatched uncredited transfer is required';end if;
 if b.returned_at is not null then
  if b.return_reference=outgoing then return;end if;raise exception 'a different return is already recorded';
 end if;
 insert into public.payment_returns(reference,request_id,amount_piastres,recorded_by,note,incoming_references)values(outgoing,null,b.amount_piastres,auth.uid(),btrim(p_note),array[incoming]);
 update public.bank_transfers set returned_at=now(),return_reference=outgoing where reference=incoming;
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'bank.unmatched_return','bank_transfer',incoming,jsonb_build_object('outgoing_reference',outgoing,'amount_piastres',b.amount_piastres));
end $$;
revoke all on function public.admin_record_unmatched_payment_return(text,text,text,boolean)from public,anon;
grant execute on function public.admin_record_unmatched_payment_return(text,text,text,boolean)to authenticated;
do $$declare definition text;begin
 definition:=pg_get_functiondef('private.assert_no_unresolved_bank_funds()'::regprocedure);
 if position('not b.voided and b.credit_entry_id is null' in definition)=0 then raise exception 'unresolved bank guard contract changed';end if;
 definition:=replace(definition,'not b.voided and b.credit_entry_id is null','not b.voided and b.returned_at is null and b.credit_entry_id is null');execute definition;
 definition:=pg_get_functiondef('public.admin_store_overview()'::regprocedure);
 definition:=replace(definition,'request_id is null and not voided','request_id is null and not voided and returned_at is null');execute definition;
end $$;
commit;
