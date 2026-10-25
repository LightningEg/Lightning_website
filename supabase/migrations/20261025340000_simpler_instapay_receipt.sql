begin;
-- Owner revision (2026-10-25): a member copies two things (our InstaPay address, and their Lightning email for the
-- transfer note) and sends back two (where they paid from, and the receipt image). The payment reference from the
-- receipt is no longer asked for: nobody types it reliably. Where they paid from may be an InstaPay address or the
-- phone number of a mobile wallet. Without a reference the request keeps a short id of its own (WEB-…), so every check
-- that needs one (review, settlement, the table's own rules) is unchanged.
create or replace function private.attach_receipt_impl(p_request_id uuid,p_payer_address text,p_reference text,p_object_key text)
returns public.topup_requests language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;
 raw text:=lower(btrim(coalesce(p_payer_address,'')));
 digits text:=regexp_replace(coalesce(p_payer_address,''),'[^0-9]','','g');
 payer text;
 ref text:=nullif(upper(btrim(coalesce(p_reference,''))),'');
begin
 if auth.uid() is null then raise exception 'sign in required';end if;
 -- an InstaPay address, or an Egyptian mobile wallet number written any common way (+20, 0020, spaces, dashes)
 if position('@' in raw)>0 then
  if raw !~ '^[a-z0-9._+-]{1,100}@[a-z0-9.-]{1,99}$' then raise exception 'enter the InstaPay address or wallet phone number you paid from';end if;
  payer:=raw;
 else
  if digits ~ '^20' and char_length(digits)=12 then digits:='0'||substr(digits,3);
  elsif digits ~ '^0020' and char_length(digits)=14 then digits:='0'||substr(digits,5);
  elsif digits ~ '^1' and char_length(digits)=10 then digits:='0'||digits;
  end if;
  if digits !~ '^01[0125][0-9]{8}$' or raw ~ '[a-z]' then raise exception 'enter the InstaPay address or wallet phone number you paid from';end if;
  payer:=digits;
 end if;
 if ref is not null and ref !~ '^[A-Z0-9-]{6,100}$' then raise exception 'payment reference must be 6 to 100 letters, digits or dashes';end if;
 select * into r from public.topup_requests where id=p_request_id and user_id=auth.uid() for update;
 if not found or r.status<>'pending' or r.terms_accepted_at is null then raise exception 'pending checkout with accepted terms required';end if;
 if p_object_key is null or split_part(p_object_key,'/',1)<>auth.uid()::text or split_part(p_object_key,'/',2)<>r.id::text
  or not private.receipt_exists(p_object_key) then raise exception 'upload a private receipt for this checkout first';end if;
 ref:=coalesce(ref,r.customer_payment_reference,'WEB-'||upper(substr(replace(r.id::text,'-',''),1,10)));
 if r.receipt_object_key=p_object_key and r.payer_instapay_address=payer and r.customer_payment_reference=ref then return r;end if;
 update public.topup_requests set payer_instapay_address=payer,customer_payment_reference=ref,receipt_object_key=p_object_key,
  receipt_uploaded_at=now(),proof_reviewed_at=null,proof_reviewed_by=null,receipt_reviewed_key=null where id=r.id returning * into r;
 insert into public.audit_log(actor,action,target_type,target_id)values(auth.uid(),'topup.receipt_uploaded','topup',r.id::text);
 return r;
end $$;
revoke all on function private.attach_receipt_impl(uuid,text,text,text) from public,anon,authenticated,service_role;
commit;
