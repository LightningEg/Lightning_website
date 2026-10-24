begin;
-- Review the exact object the administrator opened, under the same request lock.
create function public.admin_review_uploaded_receipt(p_request_id uuid,p_note text,p_object_key text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.topup_requests;
begin
 perform private.require_mfa_admin();
 select * into r from public.topup_requests where id=p_request_id for update;
 if not found or p_object_key is null or r.receipt_object_key is distinct from p_object_key then
  raise exception 'receipt changed; reload and review the current image';
 end if;
 perform public.admin_record_topup_proof(p_request_id,p_note);
end $$;
-- The original primitive remains internal to the snapshot-checked wrapper.
revoke all on function public.admin_record_topup_proof(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_review_uploaded_receipt(uuid,text,text) from public,anon;
grant execute on function public.admin_review_uploaded_receipt(uuid,text,text) to authenticated;
commit;
