-- For Geeks: download your data and delete your account (FG-09, members' side).
--
-- delete_my_account removes the sign-in and everything personal at once (the core tables cascade).
-- Coin history stays without a name: ledger rows set user_id to null, so rankings and totals stay correct.
-- export_my_data returns every row the member owns, including tables added by later migrations.

create function public.delete_my_account(p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  if p_confirm is distinct from 'delete my account' then
    raise exception 'type "delete my account" to confirm' using errcode = '22023';
  end if;
  if exists (select 1 from public.admin_roles where user_id = uid) then
    raise exception 'an administrator account cannot be deleted here' using errcode = '42501';
  end if;
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (null, 'account.delete', 'user', null, jsonb_build_object('at', now()));
  delete from auth.users where id = uid;
end $$;
comment on function public.delete_my_account(text) is
  'Deletes the caller''s account. Personal rows cascade; ledger rows are kept anonymized.';

create function public.export_my_data() returns jsonb
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
    'equipped_items:user_id', 'feedback_submissions:user_id', 'profile_reports:reporter'] loop
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

revoke all on function public.delete_my_account(text) from public, anon;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;
grant execute on function public.export_my_data() to authenticated;
