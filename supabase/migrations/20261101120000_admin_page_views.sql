-- The decision dashboard moves into the owner console (plan item 8X). The console computes its verdicts in the browser
-- (analytics/insights.js, rules.js) from the same anonymous page-view records it already counts in admin_traffic, so this
-- hands them over a page at a time. Records hold no IP address, account or typed text (privacy.html); MFA administrators only.
begin;

create function public.admin_page_views(p_days integer default 28, p_offset integer default 0, p_limit integer default 1000) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d integer := least(greatest(coalesce(p_days, 28), 1), 90);
  t0 date := (now() at time zone 'Africa/Cairo')::date - (d - 1);
begin
  perform private.require_mfa_admin();
  return jsonb_build_object(
    'live_from', (select min(day) from public.site_views),
    'total', (select count(*) from public.site_views where day >= t0),
    'rows', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
      select created_at as at, day, consent, ux, page, lang, device, os, browser as browser, coalesce(ref, '') as ref,
             coalesce(from_page, '') as "from", coalesce(utm_source, '') as us, scroll, active, coalesce(lcp_s, 0) as lcp, tl
        from public.site_views where day >= t0
       order by created_at, pv
      offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 1000), 1), 1000)) x));
end $$;

revoke all on function public.admin_page_views(integer, integer, integer) from public, anon;
grant execute on function public.admin_page_views(integer, integer, integer) to authenticated, service_role;
commit;
