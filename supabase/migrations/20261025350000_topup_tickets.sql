begin;
-- Owner revision (2026-10-25): each top-up is one ticket. The owner opens the member's receipt, checks the money in
-- their own InstaPay or bank app, types the amount that arrived (and any note or reference) on the ticket, and confirms.
-- No separate bank journal step: this records the ticket's transfer itself (reference TKT-…, one per request,
-- corrected in place until credited) through the same checked functions, then credits the coins when the amount
-- equals the accepted quote. A different amount credits nothing and says so; the ticket then offers the member a
-- revised quote they must accept (admin_propose_topup_adjustment), as before.
create function public.admin_confirm_topup(p_request_id uuid,p_received_piastres integer,p_note text,p_receipt_key text,p_receipt_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;
 ref text:='TKT-'||upper(substr(replace(p_request_id::text,'-',''),1,20));
 note text:=coalesce(nullif(btrim(coalesce(p_note,'')),''),'Confirmed in the receiving InstaPay or bank app');
 t public.bank_transfers;
 total bigint;
begin
 perform private.require_mfa_admin();
 if p_received_piastres is null or p_received_piastres<=0 then raise exception 'enter the amount that arrived';end if;
 if char_length(note)<5 then note:=note||' (confirmed)';end if;
 if char_length(note)>500 then raise exception 'keep the note under 500 characters';end if;
 select * into r from public.topup_requests where id=p_request_id for update;
 if not found then raise exception 'request not found';end if;
 if r.status='approved' then return jsonb_build_object('status','approved','request',to_jsonb(r));end if;
 if r.status<>'pending' then raise exception 'only a pending ticket can be confirmed';end if;
 if r.receipt_object_key is null or r.receipt_object_key is distinct from p_receipt_key or r.receipt_revision is distinct from p_receipt_revision then
  raise exception 'the receipt changed; open the latest receipt before confirming';end if;
 select * into t from public.bank_transfers where reference=ref;
 if found then
  if t.credit_entry_id is null and (t.amount_piastres<>p_received_piastres or t.voided or t.request_id is distinct from r.id) then
   perform public.admin_correct_bank_transfer(ref,p_received_piastres,r.id,false,note);
  end if;
 else
  perform public.admin_record_bank_transfer(ref,p_received_piastres,now(),r.id,r.payer_instapay_address,r.transfer_note_email,note,true);
 end if;
 select coalesce(sum(amount_piastres),0) into total from public.bank_transfers where request_id=r.id and not voided and credit_entry_id is null;
 if total<>r.price_piastres then
  return jsonb_build_object('status','amount_differs','received_piastres',total,'quote_piastres',r.price_piastres,'coins',r.coins);
 end if;
 r:=public.admin_settle_topup_from_transfers(r.id,p_receipt_key,p_receipt_revision,note);
 return jsonb_build_object('status','approved','request',to_jsonb(r));
end $$;
revoke all on function public.admin_confirm_topup(uuid,integer,text,text,bigint) from public,anon;
grant execute on function public.admin_confirm_topup(uuid,integer,text,text,bigint) to authenticated,service_role;
commit;
