begin;
-- Owner, 2026-10-26: "This is the simple setup that I want: a screen with information they can copy for InstaPay, and
-- what to put in additional notes (their email), then confirmation with their InstaPay address."
--
-- A member now sees our InstaPay details and their email for the transfer note, pays, then sends back three things:
-- the date they paid, the amount, and the InstaPay address (or wallet phone) they paid from. No receipt image. That
-- opens the ticket. The owner finds the money in their own InstaPay or bank app and confirms the ticket; the rules
-- are unchanged: coins are credited only when the money recorded on the ticket equals the quote for the amount.
-- Tickets that already carry a receipt keep the receipt checks.

alter table public.topup_requests add column member_sent_on date;
alter table public.topup_requests add column details_submitted_at timestamptz;

-- The InstaPay address or Egyptian wallet phone a member paid from, written any common way; null when it is neither.
create function private.normalize_payer(p_payer text) returns text
language plpgsql immutable set search_path = '' as $$
declare raw text := lower(btrim(coalesce(p_payer, ''))); digits text := regexp_replace(coalesce(p_payer, ''), '[^0-9]', '', 'g');
begin
  if position('@' in raw) > 0 then
    return case when raw ~ '^[a-z0-9._+-]{1,100}@[a-z0-9.-]{1,99}$' then raw end;
  end if;
  if digits ~ '^20' and char_length(digits) = 12 then digits := '0' || substr(digits, 3);
  elsif digits ~ '^0020' and char_length(digits) = 14 then digits := '0' || substr(digits, 5);
  elsif digits ~ '^1' and char_length(digits) = 10 then digits := '0' || digits;
  end if;
  return case when digits ~ '^01[0125][0-9]{8}$' and raw !~ '[a-z]' then digits end;
end $$;
revoke all on function private.normalize_payer(text) from public, anon, authenticated, service_role;

-- What a signed-in member copies into InstaPay: our address and name, and their own email for the note.
create function public.topup_payment_details() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cfg public.payment_settings; p public.coin_pricing;
begin
  perform private.require_active_session();
  select * into cfg from public.payment_settings where id = 1;
  select * into p from public.coin_pricing where id = 1;
  if cfg.id is null or not cfg.enabled or not p.enabled then return jsonb_build_object('enabled', false); end if;
  return jsonb_build_object('enabled', true,
    'instapay_address', cfg.instapay_address, 'recipient_name', cfg.recipient_name,
    'note_email', (select email from auth.users where id = auth.uid()),
    'coins_per_egp', p.coins_per_egp, 'minimum_egp', p.minimum_egp, 'maximum_egp', p.maximum_egp, 'pricing_version', p.version,
    'tiers', (select coalesce(jsonb_agg(jsonb_build_object('minimum_egp', minimum_egp, 'bonus_percent', bonus_percent) order by minimum_egp), '[]'::jsonb) from public.coin_bonus_tiers));
end $$;

-- "I paid": opens the ticket with the date, amount and where they paid from. Retrying with the same key is safe.
create function public.submit_instapay_topup(p_amount_piastres integer, p_request_key uuid, p_accept_terms boolean,
  p_expected_coins integer, p_pricing_version bigint, p_payer text, p_sent_on date)
returns public.topup_requests language plpgsql security definer set search_path = '' as $$
declare r public.topup_requests; payer text := private.normalize_payer(p_payer);
  today date := (now() at time zone 'Africa/Cairo')::date;
begin
  if payer is null then raise exception 'enter the InstaPay address or wallet phone number you paid from'; end if;
  if p_sent_on is null or p_sent_on > today + 1 or p_sent_on < today - 30 then raise exception 'enter the date you paid, within the last 30 days'; end if;
  r := public.create_amount_checkout(p_amount_piastres, p_request_key, p_accept_terms, p_expected_coins, p_pricing_version);
  if r.status <> 'pending' or r.receipt_object_key is not null then return r; end if;
  update public.topup_requests set payer_instapay_address = payer, member_sent_on = p_sent_on,
    customer_payment_reference = coalesce(customer_payment_reference, 'WEB-' || upper(substr(replace(id::text, '-', ''), 1, 10))),
    details_submitted_at = coalesce(details_submitted_at, now())
  where id = r.id and user_id = auth.uid() returning * into r;
  insert into public.audit_log(actor, action, target_type, target_id, detail)
  values (auth.uid(), 'topup.details_sent', 'topup', r.id::text, jsonb_build_object('sent_on', p_sent_on, 'amount_piastres', p_amount_piastres));
  return r;
end $$;

-- Credit a details-only ticket from the money recorded on it. Same checks as a receipt ticket, without the image.
create function private.settle_details_ticket(p_request_id uuid, p_note text) returns public.topup_requests
language plpgsql security definer set search_path = '' as $$
declare r public.topup_requests; total bigint; ref text;
begin
  perform private.require_mfa_admin();
  perform 1 from public.wallets where user_id = (select user_id from public.topup_requests where id = p_request_id) for update;
  select * into r from public.topup_requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  if r.status = 'approved' then return r; end if;
  if r.status <> 'pending' or r.receipt_object_key is not null or r.details_submitted_at is null or r.terms_accepted_at is null
     or r.payer_instapay_address is null or r.customer_payment_reference is null then
    raise exception 'the member has not sent their payment details for this ticket'; end if;
  perform 1 from public.bank_transfers where request_id = r.id and not voided order by reference for update;
  select coalesce(sum(amount_piastres), 0), min(reference) into total, ref from public.bank_transfers where request_id = r.id and not voided and credit_entry_id is null;
  if total <> r.price_piastres then raise exception 'the money on this ticket does not equal the quote'; end if;
  return private.review_topup_with_credit(r.id, 'approved', total::integer, ref, p_note);
end $$;
revoke all on function private.settle_details_ticket(uuid, text) from public, anon, authenticated, service_role;

-- The ticket confirm (20261026090000) now also takes a details-only ticket.
do $$ declare d text; begin
  d := pg_get_functiondef('public.admin_confirm_topup(uuid,integer,text,text,bigint,timestamptz,text,text)'::regprocedure);
  if position('  if r.receipt_object_key is null or r.receipt_object_key is distinct from p_receipt_key' in d) = 0
     or position('  r := public.admin_settle_topup_from_transfers(r.id, p_receipt_key, p_receipt_revision, note);' in d) = 0 then
    raise exception 'ticket confirm changed; update this migration'; end if;
  d := replace(d, '  if r.receipt_object_key is null or r.receipt_object_key is distinct from p_receipt_key',
    '  if r.receipt_object_key is null and r.details_submitted_at is null then raise exception ''the member has not sent their payment details yet''; end if;
  if r.receipt_object_key is not null and r.receipt_object_key is distinct from p_receipt_key');
  d := replace(d, '  r := public.admin_settle_topup_from_transfers(r.id, p_receipt_key, p_receipt_revision, note);',
    '  r := case when r.receipt_object_key is null then private.settle_details_ticket(r.id, note)
    else public.admin_settle_topup_from_transfers(r.id, p_receipt_key, p_receipt_revision, note) end;');
  execute d;

  d := pg_get_functiondef('public.admin_attach_transfer(uuid,text,text,text,bigint)'::regprocedure);
  if position('  if r.receipt_object_key is null then' in d) = 0 or position('  r := public.admin_settle_topup_from_transfers(r.id, p_receipt_key, p_receipt_revision, note);' in d) = 0 then
    raise exception 'attach transfer changed; update this migration'; end if;
  d := replace(d, '  if r.receipt_object_key is null then', '  if r.receipt_object_key is null and r.details_submitted_at is null then');
  d := replace(d, '  if r.receipt_object_key is distinct from p_receipt_key', '  if r.receipt_object_key is not null and r.receipt_object_key is distinct from p_receipt_key');
  d := replace(d, '  r := public.admin_settle_topup_from_transfers(r.id, p_receipt_key, p_receipt_revision, note);',
    '  r := case when r.receipt_object_key is null then private.settle_details_ticket(r.id, note)
    else public.admin_settle_topup_from_transfers(r.id, p_receipt_key, p_receipt_revision, note) end;');
  execute d;

  -- Today counts a ticket with details as ready to confirm, like one with a receipt.
  d := pg_get_functiondef('public.admin_dashboard()'::regprocedure);
  if position('status = ''pending'' and receipt_object_key is not null)' in d) = 0 or position('status = ''pending'' and receipt_object_key is null)' in d) = 0 then
    raise exception 'dashboard changed; update this migration'; end if;
  d := replace(d, 'select min(receipt_uploaded_at) from', 'select min(coalesce(receipt_uploaded_at, details_submitted_at)) from');
  d := replace(d, 'status = ''pending'' and receipt_object_key is not null)', 'status = ''pending'' and (receipt_object_key is not null or details_submitted_at is not null))');
  d := replace(d, 'status = ''pending'' and receipt_object_key is null)', 'status = ''pending'' and receipt_object_key is null and details_submitted_at is null)');
  execute d;
end $$;

revoke all on function public.topup_payment_details(), public.submit_instapay_topup(integer, uuid, boolean, integer, bigint, text, date) from public, anon;
grant execute on function public.topup_payment_details(), public.submit_instapay_topup(integer, uuid, boolean, integer, bigint, text, date) to authenticated;
commit;
