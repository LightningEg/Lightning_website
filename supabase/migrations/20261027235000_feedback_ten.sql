begin;
-- Accepted feedback: 10 score and Cotton; owner/MFA-only discretionary bonus.
create or replace function public.admin_review_feedback(p_id bigint, p_status text, p_amount integer default 10, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f public.feedback_submissions;
  e public.ledger_entries;
  amt integer := coalesce(p_amount, 10);
  nt text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.require_mfa_admin();
  if not public.is_admin() then
    raise exception 'administrator only' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('accepted', 'rejected', 'duplicate') then
    raise exception 'status must be accepted, rejected or duplicate' using errcode = '22023';
  end if;
  if p_status <> 'accepted' then amt := 0; end if;
  if amt < 0 or amt > 10000 then
    raise exception 'amount must be between 0 and 10000' using errcode = '22023';
  end if;
  if char_length(nt) > 500 then
    raise exception 'note must be at most 500 characters' using errcode = '22023';
  end if;
  if p_status = 'accepted' then amt := greatest(10, amt); end if;
  select * into f from public.feedback_submissions where id = p_id for update;
  if not found then raise exception 'feedback not found'; end if;
  if f.status = p_status and f.amount = amt and f.note is not distinct from nt then
    return jsonb_build_object('id', f.id, 'status', f.status, 'amount', f.amount, 'ledger_entry_id', f.ledger_entry_id);
  end if;
  if f.ledger_entry_id is not null then
    raise exception 'coins were already awarded for this feedback: correct the ledger entry instead';
  end if;
  if amt > 10 and nt is null then raise exception 'note required for discretionary bonus' using errcode = '22023'; end if;
  if amt > 0 then
    e := public.award_coins(f.user_id, 'feedback_award', amt, 'feedback', f.id::text, 'Feedback accepted', now(), 'primary', null);
  end if;
  update public.feedback_submissions
     set status = p_status, amount = amt, note = nt, reviewed_by = auth.uid(), reviewed_at = now(),
         ledger_entry_id = e.id
   where id = f.id
  returning * into f;
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (auth.uid(), 'feedback.review', 'feedback', f.id::text,
          jsonb_build_object('status', f.status, 'amount', f.amount, 'note', f.note, 'ledger_entry_id', f.ledger_entry_id));
  return jsonb_build_object('id', f.id, 'status', f.status, 'amount', f.amount, 'ledger_entry_id', f.ledger_entry_id);
end $$;


revoke all on function public.admin_review_feedback(bigint,text,integer,text) from public, anon;
grant execute on function public.admin_review_feedback(bigint,text,integer,text) to authenticated, service_role;
commit;
