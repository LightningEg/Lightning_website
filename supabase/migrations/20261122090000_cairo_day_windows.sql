-- The owner's 30-day windows start on a Cairo calendar day, whatever the clock did in between.
-- admin_sales and admin_dashboard took Cairo midnight back to an instant and then subtracted days as 24-hour
-- blocks; across the end of summer time (Egypt, last Thursday of October) the window started at 01:00 Cairo, so
-- between 00:00 and 01:00 for 30 days its daily series lost a day (29 rows, not 30). The days are now subtracted in
-- Cairo local time before converting. Only that line changes: each function is edited in place, as
-- 20261026100000_instapay_details_checkout.sql does, so later edits to either function are kept.
begin;

do $$
declare
  d text;
begin
  d := pg_get_functiondef('public.admin_sales(integer)'::regprocedure);
  if position('date_trunc(''day'', now() at time zone ''Africa/Cairo'') at time zone ''Africa/Cairo'' - make_interval(days => d - 1)' in d) = 0 then
    raise exception 'admin_sales changed; update this migration'; end if;
  d := replace(d, 'date_trunc(''day'', now() at time zone ''Africa/Cairo'') at time zone ''Africa/Cairo'' - make_interval(days => d - 1)',
                  '(date_trunc(''day'', now() at time zone ''Africa/Cairo'') - make_interval(days => d - 1)) at time zone ''Africa/Cairo''');
  execute d;

  d := pg_get_functiondef('public.admin_dashboard()'::regprocedure);
  if position('date_trunc(''day'', now() at time zone ''Africa/Cairo'') at time zone ''Africa/Cairo'' - interval ''29 days''' in d) = 0 then
    raise exception 'admin_dashboard changed; update this migration'; end if;
  d := replace(d, 'date_trunc(''day'', now() at time zone ''Africa/Cairo'') at time zone ''Africa/Cairo'' - interval ''29 days''',
                  '(date_trunc(''day'', now() at time zone ''Africa/Cairo'') - interval ''29 days'') at time zone ''Africa/Cairo''');
  execute d;
end $$;

revoke all on function public.admin_sales(integer), public.admin_dashboard() from public, anon;
grant execute on function public.admin_sales(integer), public.admin_dashboard() to authenticated, service_role;
commit;
