begin;
-- Deploy after the new browser assets. Cached clients must reload before purchasing/reviewing.
revoke all on function public.purchase_item(text,text) from authenticated;
revoke all on function public.admin_review_uploaded_receipt(uuid,text,text) from authenticated,service_role;
commit;
