-- GitHub's own download count of every app file, one snapshot a day (owner console, Analytics; plan item 8X). The daily fetch
-- runs inside Supabase (supabase/ops/github-downloads-cron.sql: pg_cron + http against the public releases API, no key);
-- this file holds what is testable without the network: the table, the parser for one releases answer, and the owner's readout.
-- Public numbers about public files: no visitor data.
begin;

create table public.download_snapshots (
  day date not null default (now() at time zone 'Africa/Cairo')::date,
  tag text not null check (char_length(tag) between 1 and 60),
  file text not null check (char_length(file) between 1 and 160),
  platform text not null check (platform in ('windows', 'android', 'mac', 'linux', 'other')),
  count integer not null check (count >= 0),
  primary key (day, tag, file)
);
alter table public.download_snapshots enable row level security;
revoke all on public.download_snapshots from public, anon, authenticated;
grant all on public.download_snapshots to service_role;

create function private.platform_of(name text) returns text language sql immutable set search_path = '' as $$
  select case
    when lower(name) like '%.apk' then 'android'
    when lower(name) ~ '\.(exe|msi)$' then 'windows'
    when lower(name) like '%.dmg' then 'mac'
    when lower(name) like '%.appimage' then 'linux'
    when lower(name) like '%windows%' then 'windows'
    when lower(name) like '%android%' then 'android'
    when lower(name) like '%mac%' then 'mac'
    when lower(name) like '%linux%' then 'linux'
    else 'other' end;
$$;

-- One answer of GET /repos/<owner>/Lightning-downloads/releases: today's count of each app file (checksums and notes are not
-- downloads of the app). Running it twice in a day replaces that day's rows.
create function private.record_download_snapshot(p jsonb) returns integer language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; a jsonb; n integer := 0; nm text;
begin
  if jsonb_typeof(p) <> 'array' then return 0; end if;
  for r in select value from jsonb_array_elements(p) loop
    if coalesce((r->>'draft')::boolean, false) then continue; end if;
    for a in select value from jsonb_array_elements(coalesce(r->'assets', '[]'::jsonb)) loop
      nm := coalesce(a->>'name', '');
      if nm = '' or lower(nm) ~ '\.(sha256|sha512|txt|md|sig|json|asc)$' then continue; end if;
      insert into public.download_snapshots (tag, file, platform, count)
      values (left(coalesce(r->>'tag_name', ''), 60), left(nm, 160), private.platform_of(nm), greatest(coalesce((a->>'download_count')::integer, 0), 0))
      on conflict (day, tag, file) do update set count = excluded.count;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function private.platform_of(text), private.record_download_snapshot(jsonb) from public, anon, authenticated;

-- The owner's readout, in the shape the Analytics tabs already read: [{date, tag, file, platform, count}].
create function public.admin_downloads(p_days integer default 60) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d integer := least(greatest(coalesce(p_days, 60), 1), 400);
begin
  perform private.require_mfa_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('date', day, 'tag', tag, 'file', file, 'platform', platform, 'count', count) order by day, tag, file)
                     from public.download_snapshots where day >= (now() at time zone 'Africa/Cairo')::date - d), '[]'::jsonb);
end $$;
revoke all on function public.admin_downloads(integer) from public, anon;
grant execute on function public.admin_downloads(integer) to authenticated, service_role;
commit;
