begin;
create table public.account_deletion_requests(
 user_id uuid primary key references auth.users(id) on delete cascade,started_at timestamptz not null default now()
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public,anon,authenticated;
grant select on public.account_deletion_requests to authenticated;
grant all on public.account_deletion_requests to service_role;
create policy deletion_request_own on public.account_deletion_requests for select to authenticated using(user_id=auth.uid());
create function private.block_deleting_account() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.account_deletion_requests where user_id=new.user_id) then raise exception 'account deletion in progress; finish or cancel deletion first';end if;
 return new;
end $$;
create trigger receipt_reserve_account_active before insert on public.receipt_uploads for each row execute function private.block_deleting_account();
create trigger checkout_account_active before insert on public.topup_requests for each row execute function private.block_deleting_account();
create trigger purchase_account_active before insert on public.purchases for each row execute function private.block_deleting_account();

create function private.account_receipt_keys(p_user uuid)returns setof text
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regclass('storage.objects') is not null then
  return query execute 'select name from storage.objects where bucket_id=$1 and split_part(name,''/'',1)=$2 order by name limit 100'
   using 'topup-receipts',p_user::text;
 end if;
end $$;
revoke all on function private.account_receipt_keys(uuid) from public,anon,authenticated,service_role;
create function public.prepare_account_deletion(p_confirm text)returns table(object_key text)
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_active_session();
 if not exists(select 1 from auth.users where id=auth.uid())then raise exception 'sign in required';end if;
 if p_confirm is distinct from 'delete my account' then raise exception 'type "delete my account" to confirm';end if;
 if public.is_admin()then raise exception 'administrator account cannot be deleted here';end if;
 perform 1 from public.wallets where user_id=auth.uid() for update;
 perform 1 from public.topup_requests where user_id=auth.uid() for update;
 if exists(select 1 from public.topup_requests where user_id=auth.uid() and status='pending' and receipt_object_key is not null) then
  raise exception 'resolve pending payments with support before deleting your account';end if;
 insert into public.account_deletion_requests(user_id)values(auth.uid())on conflict do nothing;
 return query select * from private.account_receipt_keys(auth.uid());
end $$;
create function public.cancel_account_deletion()returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_active_session();
 perform 1 from public.wallets where user_id=auth.uid() for update;
 delete from public.account_deletion_requests where user_id=auth.uid();
end $$;
revoke all on function public.prepare_account_deletion(text),public.cancel_account_deletion() from public,anon;
grant execute on function public.prepare_account_deletion(text),public.cancel_account_deletion() to authenticated;

-- Attachments serialize against deletion preparation; files cannot be added mid-cleanup.
alter function public.attach_topup_receipt(uuid,text,text,text) set schema private;
alter function private.attach_topup_receipt(uuid,text,text,text) rename to attach_receipt_impl;
revoke all on function private.attach_receipt_impl(uuid,text,text,text) from public,anon,authenticated,service_role;
create function public.attach_topup_receipt(p_request_id uuid,p_payer_address text,p_reference text,p_object_key text)
returns public.topup_requests language plpgsql security definer set search_path='' as $$
begin
 perform private.require_active_session();
 perform 1 from public.wallets where user_id=auth.uid() for update;
 if exists(select 1 from public.account_deletion_requests where user_id=auth.uid()) then raise exception 'account deletion in progress';end if;
 return private.attach_receipt_impl(p_request_id,p_payer_address,p_reference,p_object_key);
end $$;
revoke all on function public.attach_topup_receipt(uuid,text,text,text) from public,anon;
grant execute on function public.attach_topup_receipt(uuid,text,text,text) to authenticated;

alter function public.delete_my_account(text) set schema private;
alter function private.delete_my_account(text) rename to delete_account_rows;
revoke all on function private.delete_account_rows(text) from public,anon,authenticated,service_role;
create function public.delete_my_account(p_confirm text)returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_active_session();
 if p_confirm is distinct from 'delete my account' then raise exception 'type "delete my account" to confirm';end if;
 if public.is_admin()then raise exception 'administrator account cannot be deleted here';end if;
 perform 1 from public.wallets where user_id=auth.uid() for update;
 perform 1 from public.topup_requests where user_id=auth.uid() for update;
 if exists(select 1 from public.topup_requests where user_id=auth.uid() and status='pending' and receipt_object_key is not null) then
  raise exception 'resolve pending payments with support before deleting your account';end if;
 if exists(select 1 from private.account_receipt_keys(auth.uid()))then raise exception 'remove receipt files through the account deletion service first';end if;
 -- Retain financial totals/reference uniqueness, remove sender identity and image locators.
 update public.topup_requests set status=case when status='pending' then 'cancelled' else status end,transfer_note_email=null,payer_instapay_address=null,customer_payment_reference=null,
  receipt_object_key=null,receipt_reviewed_key=null,review_note=null where user_id=auth.uid();
 if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id=$1' using auth.uid();end if;
 perform private.delete_account_rows(p_confirm);
end $$;
revoke all on function public.delete_my_account(text) from public,anon;
grant execute on function public.delete_my_account(text) to authenticated;

do $$declare view_name text;definition text;begin
 if to_regclass('storage.objects') is not null then
  execute 'drop policy topup_receipts_insert on storage.objects';
  execute $p$create policy topup_receipts_insert on storage.objects for insert to authenticated with check(
   bucket_id='topup-receipts' and not exists(select 1 from public.account_deletion_requests where user_id=auth.uid())
   and exists(select 1 from public.receipt_uploads u join public.topup_requests r on r.id=u.request_id
   where u.object_key=name and u.user_id=auth.uid() and r.user_id=auth.uid() and r.status='pending' and r.terms_accepted_at is not null))$p$;
  execute $p$create policy topup_receipts_delete on storage.objects for delete to authenticated using(
   bucket_id='topup-receipts' and (
    (split_part(name,'/',1)=auth.uid()::text and exists(select 1 from public.account_deletion_requests where user_id=auth.uid()))
    or (public.is_admin() and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','')='aal2'
     and created_at<now()-interval '90 days'
     and not exists(select 1 from public.topup_requests r where r.receipt_object_key=name and r.status='pending'))))$p$;
 end if;
 -- Intentional projection views keep their visibility rules; a deleted JWT is not a member.
 foreach view_name in array array['profile_directory','profile_work']loop
  definition:=pg_get_viewdef(('public.'||view_name)::regclass,true);
  definition:=regexp_replace(definition,'auth[.]uid\(\) IS NOT NULL','(EXISTS (SELECT 1 FROM auth.users current_member WHERE current_member.id = auth.uid()))','gi');
  execute 'create or replace view public.'||quote_ident(view_name)||' as '||definition;
 end loop;
end $$;
create function public.admin_receipt_cleanup_candidates()returns table(object_key text)
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_mfa_admin();
 if to_regclass('storage.objects') is not null then
  return query execute 'select name from storage.objects o where bucket_id=$1 and created_at<now()-interval ''90 days''
   and not exists(select 1 from public.topup_requests r where r.receipt_object_key=o.name and r.status=''pending'')order by created_at limit 100'
   using 'topup-receipts';
 end if;
end $$;
revoke all on function public.admin_receipt_cleanup_candidates() from public,anon;
grant execute on function public.admin_receipt_cleanup_candidates() to authenticated;
-- Serialize provider metadata insertion against the deletion barrier too.
create function private.lock_receipt_upload()returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.bucket_id='topup-receipts' and auth.uid() is not null then
  perform 1 from public.wallets where user_id=auth.uid() for update;
  if not found or exists(select 1 from public.account_deletion_requests where user_id=auth.uid())then
   raise exception 'account deletion in progress or account missing';end if;
 end if;
 return new;
end $$;
do $$begin if to_regclass('storage.objects') is not null then
 execute 'create trigger receipt_upload_account_barrier before insert on storage.objects for each row execute function private.lock_receipt_upload()';
end if;end $$;
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  out jsonb;
  t text;
  col text;
  rows jsonb;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  out := jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
                                          'sign_in_methods', coalesce((select jsonb_agg(distinct i.provider) from auth.identities i where i.user_id = u.id), '[]'::jsonb))
                from auth.users u where u.id = uid));
  -- table and the column that holds the member's id; tables from later migrations are included when present
  foreach t in array array[
    'profiles:user_id', 'member_profiles:user_id', 'profile_links:user_id', 'github_links:user_id', 'wallets:user_id',
    'ledger_entries:user_id', 'contributions:user_id', 'reward_claims:user_id', 'purchases:user_id', 'inventory:user_id',
    'equipped_items:user_id', 'topup_requests:user_id', 'community_stories:user_id', 'receipt_uploads:user_id', 'account_deletion_requests:user_id', 'feedback_submissions:user_id', 'profile_reports:reporter'] loop
    col := split_part(t, ':', 2);
    t := split_part(t, ':', 1);
    if to_regclass('public.' || t) is not null then
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x where x.%I = $1', t, col)
        into rows using uid;
      out := out || jsonb_build_object(t, rows);
    end if;
  end loop;
  return out;
end $$;

revoke all on function private.block_deleting_account(),private.lock_receipt_upload() from public,anon,authenticated,service_role;
commit;
