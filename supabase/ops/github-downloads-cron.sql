-- Applied by hand once to the live project (not a migration: pglite, which runs the tests, has neither extension).
-- Every day at 02:10 Cairo time, read GitHub's public releases answer for the downloads repository and record today's counts.
-- No key: the endpoint is public (60 requests an hour per address is far above one a day). A failed fetch records nothing.
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

create or replace function private.fetch_download_snapshot() returns integer language plpgsql security definer set search_path = '' as $$
declare res extensions.http_response; n integer := 0;
begin
  select * into res from extensions.http((
    'GET', 'https://api.github.com/repos/elfekimuhammed/Lightning-downloads/releases?per_page=30',
    array[extensions.http_header('Accept', 'application/vnd.github+json'), extensions.http_header('User-Agent', 'lightning-site')], null, null)::extensions.http_request);
  if res.status = 200 then n := private.record_download_snapshot(res.content::jsonb); end if;
  return n;
exception when others then
  return 0;
end $$;
revoke all on function private.fetch_download_snapshot() from public, anon, authenticated;

select cron.unschedule('github-download-snapshot') where exists (select 1 from cron.job where jobname = 'github-download-snapshot');
select cron.schedule('github-download-snapshot', '10 0 * * *', $$select private.fetch_download_snapshot()$$); -- 00:10 UTC = 02:10 Cairo (03:10 in summer)
