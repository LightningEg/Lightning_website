begin;
-- Owner, 2026-10-26: "I want owner console to appear on one account only, my admin one", and "the ticket to open up
-- and me inputting how much I got and the other info inside of it".
--
-- 1. One owner account. The console, its menu link and every admin function follow admin_roles, which could hold
--    several accounts. From now on it holds at most one: a second account can never be added, and the owner removes
--    any extra one from the console (signed in and MFA-verified as the account they keep).
-- 2. A ticket records everything about the money: the amount that arrived, when, who sent it and the transfer
--    reference from the owner's InstaPay or bank app. A reference makes the same payment unable to pay two tickets
--    (the journal's one-reference rule): typed on a second ticket, it is refused and says so.

create function private.one_owner_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('admin_roles'));
  if exists (select 1 from public.admin_roles where user_id <> new.user_id) then
    raise exception 'Lightning has one owner account; remove the other before adding one' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger one_owner_account before insert or update on public.admin_roles
  for each row execute function private.one_owner_account();
revoke all on function private.one_owner_account() from public, anon, authenticated, service_role;

-- Who can open the console now: this account, and any other one still listed (with its email, so the owner knows it).
create function public.admin_owner_accounts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_mfa_admin();
  return jsonb_build_object(
    'count', (select count(*) from public.admin_roles),
    'others', (select coalesce(jsonb_agg(jsonb_build_object('email', coalesce(u.email, 'Account without email'), 'since', a.granted_at) order by a.granted_at), '[]'::jsonb)
               from public.admin_roles a left join auth.users u on u.id = a.user_id where a.user_id <> auth.uid()));
end $$;

-- Keep this account as the only owner. MFA-verified, so a lost session alone cannot take the console.
create function public.admin_keep_only_me() returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  perform private.require_mfa_admin();
  perform pg_advisory_xact_lock(hashtext('admin_roles'));
  delete from public.admin_roles where user_id <> auth.uid();
  get diagnostics removed = row_count;
  if removed > 0 then
    insert into public.audit_log(actor, action, target_type, target_id, detail)
    values (auth.uid(), 'admin.keep_only_me', 'admin_roles', auth.uid()::text, jsonb_build_object('removed', removed));
  end if;
  return removed;
end $$;

-- The ticket's confirm, now with when the money arrived, who sent it and its reference. Same rules as before: the
-- ticket's own transfer is corrected in place until credited, and coins are credited only when the money on the
-- ticket equals the accepted quote; a different amount credits nothing and says so.
create function public.admin_confirm_topup(p_request_id uuid, p_received_piastres integer, p_note text, p_receipt_key text,
  p_receipt_revision bigint, p_received_at timestamptz, p_sender text, p_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.topup_requests;
  own text := 'TKT-' || upper(substr(replace(p_request_id::text, '-', ''), 1, 20));
  typed text := nullif(upper(regexp_replace(coalesce(p_reference, ''), '\s', '', 'g')), '');
  target text;
  note text := coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Confirmed in the receiving InstaPay or bank app');
  at timestamptz := coalesce(p_received_at, now());
  sender text := nullif(lower(btrim(coalesce(p_sender, ''))), '');
  t public.bank_transfers;
  total bigint;
begin
  perform private.require_mfa_admin();
  if p_received_piastres is null or p_received_piastres <= 0 then raise exception 'enter the amount that arrived'; end if;
  if at > now() + interval '5 minutes' then raise exception 'the money cannot arrive in the future; check the date'; end if;
  if typed is not null and typed !~ '^[A-Z0-9-]{6,100}$' then raise exception 'the reference is 6 to 100 letters, digits or dashes'; end if;
  if typed is not null and typed ~ '^TKT-' then raise exception 'type the reference from your InstaPay or bank app, not the ticket id'; end if;
  if char_length(note) < 5 then note := note || ' (confirmed)'; end if;
  if char_length(note) > 500 then raise exception 'keep the note under 500 characters'; end if;
  select * into r from public.topup_requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  sender := coalesce(sender, r.payer_instapay_address);
  if sender is not null and char_length(sender) > 200 then raise exception 'keep the sender under 200 characters'; end if;
  if r.status = 'approved' then return jsonb_build_object('status', 'approved', 'request', to_jsonb(r)); end if;
  if r.status <> 'pending' then raise exception 'only a pending ticket can be confirmed'; end if;
  if r.receipt_object_key is null or r.receipt_object_key is distinct from p_receipt_key or r.receipt_revision is distinct from p_receipt_revision then
    raise exception 'the receipt changed; open the latest receipt before confirming'; end if;
  target := coalesce(typed, own);
  if typed is not null then
    -- the same payment cannot pay two tickets
    select * into t from public.bank_transfers where reference = typed;
    if found and t.request_id is distinct from r.id and (t.request_id is not null or t.credit_entry_id is not null) then
      raise exception 'reference % is already on another ticket; the same payment cannot pay twice', typed;
    end if;
    if exists (select 1 from public.payment_returns where reference = typed) then
      raise exception 'reference % is a refund you sent, not money that arrived', typed;
    end if;
    -- the reference replaces the ticket's own unreferenced entry
    select * into t from public.bank_transfers where reference = own;
    if found and t.credit_entry_id is null and not t.voided then
      perform public.admin_correct_bank_transfer(own, t.amount_piastres, r.id, true, 'Replaced by reference ' || typed);
    end if;
  end if;
  select * into t from public.bank_transfers where reference = target;
  if found then
    if t.credit_entry_id is null and (t.amount_piastres <> p_received_piastres or t.voided or t.request_id is distinct from r.id) then
      perform public.admin_correct_bank_transfer(target, p_received_piastres, r.id, false, note);
    end if;
  else
    perform public.admin_record_bank_transfer(target, p_received_piastres, at, r.id, sender, r.transfer_note_email, note, true);
  end if;
  select coalesce(sum(amount_piastres), 0) into total from public.bank_transfers where request_id = r.id and not voided and credit_entry_id is null;
  if total <> r.price_piastres then
    return jsonb_build_object('status', 'amount_differs', 'received_piastres', total, 'quote_piastres', r.price_piastres, 'coins', r.coins);
  end if;
  r := public.admin_settle_topup_from_transfers(r.id, p_receipt_key, p_receipt_revision, note);
  return jsonb_build_object('status', 'approved', 'request', to_jsonb(r));
end $$;

revoke all on function public.admin_owner_accounts(), public.admin_keep_only_me(),
  public.admin_confirm_topup(uuid, integer, text, text, bigint, timestamptz, text, text) from public, anon;
grant execute on function public.admin_owner_accounts(), public.admin_keep_only_me(),
  public.admin_confirm_topup(uuid, integer, text, text, bigint, timestamptz, text, text) to authenticated, service_role;
commit;
