-- Owner console Roadmap: lets the edge function roadmap-write ask "is this caller the MFA-verified owner?".
create or replace function public.admin_roadmap_access() returns boolean
language sql stable security invoker set search_path = public as $$
  select public.is_admin() and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') = 'aal2'
$$;
revoke all on function public.admin_roadmap_access() from public, anon;
grant execute on function public.admin_roadmap_access() to authenticated;
