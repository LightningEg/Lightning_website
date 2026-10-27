begin;
-- Profile pictures (2026-10-27). A member uploads one small picture; the browser crops it to a square and shrinks it
-- to 256 px first, and the bucket refuses anything larger than 256 KB or not PNG, JPEG or WebP. Each member has exactly
-- one file, <random key>/avatar, which a new upload replaces. The key is private to the member and has nothing to do
-- with their account id, so a public picture address never reveals who the account is. The bucket is public so the picture shows on a public
-- profile, the leaderboard and stories without a sign-in, so only pictures the member chose to show are ever linked.

create table private.avatar_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  key text not null unique default replace(gen_random_uuid()::text, '-', '')
);
-- The member's picture path, or null before the first upload. Storage policies and the account-deletion function use it.
create function public.my_avatar_path() returns text language sql stable security definer set search_path = '' as $$
  select key || '/avatar' from private.avatar_keys where user_id = auth.uid();
$$;
-- The same path, made on first use: the browser asks for it just before uploading.
create function public.ensure_avatar_path() returns text language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_active_session();
  insert into private.avatar_keys (user_id) values (auth.uid()) on conflict do nothing;
  return public.my_avatar_path();
end $$;
revoke all on function public.my_avatar_path(), public.ensure_avatar_path() from public, anon;
grant execute on function public.my_avatar_path(), public.ensure_avatar_path() to authenticated;

-- The picture link can only point at the member's own file from now on. Links entered before this (any https address)
-- stay as they are until the member changes or removes them.
create function private.avatar_url_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if new.avatar_url is not null and new.avatar_url is distinct from old.avatar_url then
    select key into k from private.avatar_keys where user_id = new.user_id;
    if k is null or new.avatar_url !~ ('^https://[^/?#]+/storage/v1/object/public/avatars/' || k || '/avatar(\?v=[0-9]{1,13})?$') then
      raise exception 'upload a picture instead of linking one';
    end if;
  end if;
  return new;
end $$;
create trigger member_profiles_avatar_url before update of avatar_url on public.member_profiles
  for each row execute function private.avatar_url_check();

-- Supabase Storage is provisioned by the provider. Pure Postgres test installs may omit it; uploads then fail closed.
do $$begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('avatars','avatars',true,262144,array['image/png','image/jpeg','image/webp'])
  on conflict(id) do update set public=true,file_size_limit=262144,allowed_mime_types=excluded.allowed_mime_types;
  execute $policy$create policy avatars_insert on storage.objects for insert to authenticated with check(
   bucket_id='avatars' and name=public.my_avatar_path())$policy$;
  execute $policy$create policy avatars_update on storage.objects for update to authenticated using(
   bucket_id='avatars' and name=public.my_avatar_path()) with check(bucket_id='avatars' and name=public.my_avatar_path())$policy$;
  execute $policy$create policy avatars_read_own on storage.objects for select to authenticated using(
   bucket_id='avatars' and (name=public.my_avatar_path() or public.is_admin()))$policy$;
  -- a member removes their own; an administrator removes one that breaks the rules
  execute $policy$create policy avatars_delete on storage.objects for delete to authenticated using(
   bucket_id='avatars' and (name=public.my_avatar_path() or public.is_admin()))$policy$;
 end if;
end $$;

-- The owner can take a picture down. The link is cleared here (so it shows nowhere at once); the console then removes
-- the file through Storage with the returned path. The reason is kept in the audit log.
create function public.admin_remove_avatar(p_email text, p_reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid; path text;
begin
  perform private.require_mfa_admin();
  if p_reason is null or char_length(btrim(p_reason)) not between 5 and 300 then raise exception 'give a reason of 5 to 300 characters'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(coalesce(p_email, '')));
  if uid is null then raise exception 'no member with that email'; end if;
  update public.member_profiles set avatar_url = null where user_id = uid;
  select key || '/avatar' into path from private.avatar_keys where user_id = uid;
  insert into public.audit_log(actor, action, target_type, target_id, detail)
  values (auth.uid(), 'profile.avatar_removed', 'member', uid::text, jsonb_build_object('reason', btrim(p_reason)));
  return path;
end $$;
revoke all on function public.admin_remove_avatar(text, text) from public, anon;
grant execute on function public.admin_remove_avatar(text, text) to authenticated, service_role;
commit;
