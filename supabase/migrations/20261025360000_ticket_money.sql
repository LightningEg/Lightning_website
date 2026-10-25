-- Owner, 2026-10-25: "The owner dashboard has the ticket but I cannot reconcile on the same page."
-- Money recorded without a ticket (the older bank journal, or a transfer logged before the member opened the ticket)
-- could only be matched in Settings. Each open ticket now lists the money already on it and the unmatched money that
-- looks like it (same sender, note email, reference or amount), and takes one with a click. All checks stay in the
-- existing functions: admin_correct_bank_transfer moves the transfer, admin_settle_topup_from_transfers credits.

create function public.admin_ticket_money(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.topup_requests; payer text; note_email text; their_ref text;
begin
  perform private.require_mfa_admin();
  select * into r from public.topup_requests where id = p_request_id;
  if not found then raise exception 'request not found'; end if;
  payer := nullif(lower(btrim(coalesce(r.payer_instapay_address, ''))), '');
  note_email := nullif(lower(btrim(coalesce(r.transfer_note_email, ''))), '');
  their_ref := case when r.customer_payment_reference ~ '^WEB-' then null else upper(btrim(r.customer_payment_reference)) end;
  return jsonb_build_object(
    'quote_piastres', r.price_piastres,
    'on_ticket', (select coalesce(jsonb_agg(jsonb_build_object('reference', b.reference, 'amount_piastres', b.amount_piastres,
        'received_at', b.received_at, 'sender', b.sender_address, 'credited', b.credit_entry_id is not null) order by b.received_at), '[]'::jsonb)
      from public.bank_transfers b where b.request_id = r.id and not b.voided),
    'candidates', (select coalesce(jsonb_agg(x.j order by x.score desc, x.at desc), '[]'::jsonb) from (
      select jsonb_build_object('reference', b.reference, 'amount_piastres', b.amount_piastres, 'received_at', b.received_at,
               'sender', b.sender_address, 'email_note', b.email_note,
               'why', array_remove(array[
                 case when payer is not null and b.sender_address = payer then 'same sender' end,
                 case when note_email is not null and b.email_note = note_email then 'same email in the note' end,
                 case when their_ref is not null and b.reference = their_ref then 'their reference' end,
                 case when b.amount_piastres = r.price_piastres then 'same amount' end], null)) as j,
             (case when payer is not null and b.sender_address = payer then 4 else 0 end
              + case when note_email is not null and b.email_note = note_email then 4 else 0 end
              + case when their_ref is not null and b.reference = their_ref then 8 else 0 end
              + case when b.amount_piastres = r.price_piastres then 1 else 0 end) as score,
             b.received_at as at
      from public.bank_transfers b
      where r.status = 'pending' and b.request_id is null and not b.voided and b.returned_at is null and b.credit_entry_id is null
        and ((payer is not null and b.sender_address = payer) or (note_email is not null and b.email_note = note_email)
             or (their_ref is not null and b.reference = their_ref)
             or (b.amount_piastres = r.price_piastres and b.received_at >= r.created_at - interval '2 days'))
      order by score desc, b.received_at desc limit 5) x));
end $$;

-- Put an unmatched transfer on this ticket. Credits at once when the ticket's money now equals the accepted quote and
-- the reviewed receipt is the latest one; otherwise says what is missing and credits nothing.
create function public.admin_attach_transfer(p_request_id uuid, p_reference text, p_note text, p_receipt_key text, p_receipt_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.topup_requests; b public.bank_transfers; total bigint;
  note text := coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Matched to its ticket on the owner dashboard');
begin
  perform private.require_mfa_admin();
  if char_length(note) < 5 then note := note || ' (matched)'; end if;
  select * into r from public.topup_requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  if r.status <> 'pending' then raise exception 'only an open ticket can take money'; end if;
  select * into b from public.bank_transfers where reference = upper(btrim(p_reference));
  if not found then raise exception 'bank transfer not found'; end if;
  if b.request_id is not null then raise exception 'that money is already on a ticket; reload'; end if;
  perform public.admin_correct_bank_transfer(b.reference, b.amount_piastres, r.id, false, note);
  select coalesce(sum(amount_piastres), 0) into total from public.bank_transfers where request_id = r.id and not voided and credit_entry_id is null;
  if total <> r.price_piastres then
    return jsonb_build_object('status', 'amount_differs', 'received_piastres', total, 'quote_piastres', r.price_piastres, 'coins', r.coins);
  end if;
  if r.receipt_object_key is null then
    return jsonb_build_object('status', 'waiting_receipt', 'received_piastres', total, 'quote_piastres', r.price_piastres, 'coins', r.coins);
  end if;
  if r.receipt_object_key is distinct from p_receipt_key or r.receipt_revision is distinct from p_receipt_revision then
    raise exception 'the receipt changed; open the latest receipt before confirming';
  end if;
  r := public.admin_settle_topup_from_transfers(r.id, p_receipt_key, p_receipt_revision, note);
  return jsonb_build_object('status', 'approved', 'request', to_jsonb(r));
end $$;

revoke all on function public.admin_ticket_money(uuid), public.admin_attach_transfer(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.admin_ticket_money(uuid), public.admin_attach_transfer(uuid, text, text, text, bigint) to authenticated;
