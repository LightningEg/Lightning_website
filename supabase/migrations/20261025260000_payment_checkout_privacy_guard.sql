begin;
-- Cancellation and moderation must not hide matched funds awaiting reconciliation.
-- Writers lock the request before matching a bank transfer, serializing this check.
create function private.protect_uncredited_checkout()returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in('cancelled','rejected') and old.status='pending'
 and exists(select 1 from public.bank_transfers where request_id=new.id and not voided and credit_entry_id is null and returned_at is null)
 and not exists(select 1 from public.payment_returns where request_id=new.id)then
  raise exception 'received funds must be reconciled or returned before closing this request';
 end if;return new;
end $$;
revoke all on function private.protect_uncredited_checkout()from public,anon,authenticated,service_role;
create trigger protect_uncredited_checkout before update on public.topup_requests for each row execute function private.protect_uncredited_checkout();
-- Private QR responses must never be retained by shared HTTP caches.
create or replace function public.checkout_qr(p_request_id uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare asset private.payment_qr_assets;
begin
 perform private.require_active_session();
 select a.* into asset from private.payment_qr_assets a join public.topup_requests r on r.destination_qr_asset_id=a.id
 where r.id=p_request_id and r.user_id=auth.uid()and r.status='pending'and r.terms_accepted_at is not null;
 if not found then raise exception 'QR is available only inside your accepted pending checkout';end if;
 perform set_config('response.headers','[{"Cache-Control":"no-store, private"},{"Pragma":"no-cache"}]',true);
 return jsonb_build_object('data_url','data:'||asset.mime||';base64,'||replace(encode(asset.image,'base64'),E'\n',''));
end $$;
commit;
