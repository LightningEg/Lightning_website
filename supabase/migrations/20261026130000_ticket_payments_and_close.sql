begin;
-- Owner, 2026-10-26: "If I record an amount, it should tell me how much I recognised and when, and a way to just close
-- it and send a message to the user that this is it."
--
-- 1. A ticket holds payments. Each "Record" adds one payment (amount, when it arrived, sender, reference) and never
--    overwrites an earlier one, so 15,000 EGP now and 15,000 EGP next week are two lines that add up to 30,000 EGP.
--    A payment typed without a reference gets its own TKT-…-xxxxxxxx reference from a key the console sends once per
--    payment: pressing Record twice after a dropped connection records it once. Coins are still credited only when the
--    money on the ticket equals the quote.
-- 2. The owner can close a ticket for the money that arrived: they set the coins (the console proposes the quote's
--    rate), write the member a message, and the ticket is credited and closed at once. The message is the ticket's
--    review note, which the member reads in their wallet history; the console drafts the same in an email.
-- 3. The ticket's money lists when each payment was recorded, beside when it arrived.

create function public.admin_record_ticket_payment(p_request_id uuid, p_amount_piastres integer, p_received_at timestamptz,
  p_sender text, p_reference text, p_entry_key uuid, p_receipt_key text, p_receipt_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.topup_requests; t public.bank_transfers; total bigint; target text;
  typed text := nullif(upper(regexp_replace(coalesce(p_reference, ''), '\s', '', 'g')), '');
  at timestamptz := coalesce(p_received_at, now());
  sender text := nullif(lower(btrim(coalesce(p_sender, ''))), '');
  note text := 'Payment recorded on its ticket in the owner console';
begin
  perform private.require_mfa_admin();
  if p_entry_key is null then raise exception 'reload the page and record the payment again'; end if;
  if p_amount_piastres is null or p_amount_piastres <= 0 then raise exception 'enter the amount that arrived'; end if;
  if at > now() + interval '5 minutes' then raise exception 'the money cannot arrive in the future; check the date'; end if;
  if typed is not null and typed !~ '^[A-Z0-9-]{6,100}$' then raise exception 'the reference is 6 to 100 letters, digits or dashes'; end if;
  if typed is not null and typed ~ '^TKT-' then raise exception 'type the reference from your InstaPay or bank app, not the ticket id'; end if;
  select * into r from public.topup_requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  sender := coalesce(sender, r.payer_instapay_address);
  if sender is not null and char_length(sender) > 200 then raise exception 'keep the sender under 200 characters'; end if;
  if r.status = 'approved' then return jsonb_build_object('status', 'approved', 'request', to_jsonb(r)); end if;
  if r.status <> 'pending' then raise exception 'only an open ticket takes payments'; end if;
  if r.receipt_object_key is null and r.details_submitted_at is null then raise exception 'the member has not sent their payment details yet'; end if;
  if r.receipt_object_key is not null and (r.receipt_object_key is distinct from p_receipt_key or r.receipt_revision is distinct from p_receipt_revision) then
    raise exception 'the receipt changed; open the latest receipt before confirming'; end if;
  target := coalesce(typed, 'TKT-' || upper(substr(replace(r.id::text, '-', ''), 1, 20)) || '-' || upper(substr(replace(p_entry_key::text, '-', ''), 1, 8)));
  if exists (select 1 from public.payment_returns where reference = target) then
    raise exception 'reference % is a refund you sent, not money that arrived', target; end if;
  select * into t from public.bank_transfers where reference = target;
  if found then
    if t.request_id = r.id and not t.voided then
      -- the same payment again (Record pressed twice, or a retry): already on the ticket
      if t.amount_piastres <> p_amount_piastres then
        raise exception 'reference % is already on this ticket as % EGP; remove it first to change it', target, t.amount_piastres / 100.0; end if;
    elsif t.request_id is not null or t.credit_entry_id is not null then
      raise exception 'reference % is already on another ticket; the same payment cannot pay twice', target;
    elsif t.voided then
      raise exception 'reference % was voided in the money journal; check the reference', target;
    else
      -- money already in the journal under this reference: it moves onto the ticket, at the amount the owner saw
      perform public.admin_correct_bank_transfer(target, p_amount_piastres, r.id, false, note);
    end if;
  else
    perform public.admin_record_bank_transfer(target, p_amount_piastres, at, r.id, sender, r.transfer_note_email, note, true);
  end if;
  select coalesce(sum(amount_piastres), 0) into total from public.bank_transfers where request_id = r.id and not voided and credit_entry_id is null;
  if total <> r.price_piastres then
    return jsonb_build_object('status', 'amount_differs', 'received_piastres', total, 'quote_piastres', r.price_piastres, 'coins', r.coins, 'reference', target);
  end if;
  -- the settle note is the review note the member reads in their wallet history
  r := case when r.receipt_object_key is null then private.settle_details_ticket(r.id, 'Received in full. Your coins are in your wallet.')
    else public.admin_settle_topup_from_transfers(r.id, p_receipt_key, p_receipt_revision, 'Received in full. Your coins are in your wallet.') end;
  return jsonb_build_object('status', 'approved', 'request', to_jsonb(r), 'reference', target);
end $$;

-- Close a ticket for what arrived: the owner's own decision, so no member acceptance. The quote becomes the money on
-- the ticket and the coins the owner set; the earlier quote stays in topup_adjustments as an accepted change.
create function public.admin_close_ticket_for_received(p_request_id uuid, p_coins integer, p_message text,
  p_receipt_key text, p_receipt_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.topup_requests; total bigint; msg text := btrim(coalesce(p_message, ''));
  was_coins integer; was_piastres integer;
begin
  perform private.require_mfa_admin();
  perform 1 from public.wallets where user_id = (select user_id from public.topup_requests where id = p_request_id) for update;
  select * into r from public.topup_requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  if r.status = 'approved' then return jsonb_build_object('status', 'approved', 'request', to_jsonb(r)); end if;
  if r.status <> 'pending' or r.user_id is null then raise exception 'only an open ticket can be closed this way'; end if;
  if p_coins is null or p_coins < 1 or p_coins > 1000000 then raise exception 'credit between 1 and 1,000,000 coins'; end if;
  if char_length(msg) not between 5 and 500 then raise exception 'write the member a short message (5 to 500 characters)'; end if;
  if r.receipt_object_key is not null and (r.receipt_object_key is distinct from p_receipt_key or r.receipt_revision is distinct from p_receipt_revision) then
    raise exception 'the receipt changed; open the latest receipt before confirming'; end if;
  perform 1 from public.bank_transfers where request_id = r.id and not voided order by reference for update;
  select coalesce(sum(amount_piastres), 0) into total from public.bank_transfers where request_id = r.id and not voided and credit_entry_id is null;
  if total < 1 then raise exception 'record the money that arrived first'; end if;
  if total > 2147483647 then raise exception 'the money on this ticket is too large'; end if;
  was_coins := r.coins; was_piastres := r.price_piastres;
  if was_coins <> p_coins or was_piastres <> total then
    update public.topup_adjustments set status = 'superseded', decided_at = now() where request_id = r.id and status = 'pending';
    insert into public.topup_adjustments(request_id, original_coins, original_piastres, proposed_coins, proposed_piastres, status, note, proposed_by, decided_at)
    values (r.id, was_coins, was_piastres, p_coins, total::integer, 'accepted', msg, auth.uid(), now());
    update public.topup_requests set coins = p_coins, price_piastres = total::integer where id = r.id;
  end if;
  r := case when r.receipt_object_key is null then private.settle_details_ticket(r.id, msg)
    else public.admin_settle_topup_from_transfers(r.id, p_receipt_key, p_receipt_revision, msg) end;
  insert into public.audit_log(actor, action, target_type, target_id, detail)
  values (auth.uid(), 'topup.closed_for_received', 'topup', r.id::text, jsonb_build_object('quote_piastres', was_piastres,
    'quote_coins', was_coins, 'received_piastres', total, 'coins', p_coins));
  return jsonb_build_object('status', 'approved', 'request', to_jsonb(r), 'received_piastres', total, 'coins', p_coins);
end $$;

-- The ticket's money also says when each payment was recorded.
do $$ declare d text; begin
  d := pg_get_functiondef('public.admin_ticket_money(uuid)'::regprocedure);
  if position('''sender'', b.sender_address, ''credited'', b.credit_entry_id is not null)' in d) = 0 then
    raise exception 'ticket money changed; update this migration'; end if;
  d := replace(d, '''sender'', b.sender_address, ''credited'', b.credit_entry_id is not null)',
    '''sender'', b.sender_address, ''credited'', b.credit_entry_id is not null, ''recorded_at'', b.recorded_at, ''returned'', b.returned_at is not null)');
  execute d;
end $$;

revoke all on function public.admin_record_ticket_payment(uuid, integer, timestamptz, text, text, uuid, text, bigint),
  public.admin_close_ticket_for_received(uuid, integer, text, text, bigint) from public, anon;
grant execute on function public.admin_record_ticket_payment(uuid, integer, timestamptz, text, text, uuid, text, bigint),
  public.admin_close_ticket_for_received(uuid, integer, text, text, bigint) to authenticated;
commit;
