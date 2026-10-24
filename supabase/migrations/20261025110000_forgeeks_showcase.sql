-- For Geeks public showcase: profile page, member directory, reports (FG-07 leaderboard part, FG-11)
-- Proposal: docs/proposals/forgeeks-accounts-lightning-coins.md ("Public member showcase")
--
-- Rules this migration enforces in the database itself:
--   * A profile is readable only through the same rules as public.profile_directory:
--     public for everyone, members-only for a signed-in visitor, never private, never suspended.
--   * The functions below return only opted-in display columns. They never return user_id,
--     email, phone, birth date, real name, wallet balance or purchases.
--   * A rank appears only for a member who switched the leaderboard on (and is 18+ confirmed).
--   * Reports go to administrators only; a reporter cannot read them back.
--
-- Depends only on the core migration (member_profiles, wallets, ledger_entries, profile_directory,
-- profile_work, audit_log, is_admin).

-- ---------------------------------------------------------------- ranks (private helper)

-- Same rules as public.leaderboard(): opted in, adult confirmed, not suspended, score above zero,
-- ties share a rank, "month" starts at midnight on the 1st in Cairo. No row limit: a profile needs
-- its rank even when it is outside the top 100.
create function private.leaderboard_ranks(p_period text)
returns table (display_name text, rank bigint)
language sql stable security definer set search_path = '' as $$
  with since as (
    select case when p_period = 'month'
      then date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo'
      else '-infinity'::timestamptz end as t
  ), scores as (
    select m.display_name as dn, sum(l.contribution_delta)::bigint as sc
    from public.ledger_entries l
    join public.member_profiles m on m.user_id = l.user_id
    cross join since
    where m.show_on_leaderboard and m.adult_confirmed and not m.suspended
      and l.earned_at >= since.t
    group by m.user_id, m.display_name
    having sum(l.contribution_delta) > 0
  )
  select s.dn, rank() over (order by s.sc desc) from scores s;
$$;
revoke all on function private.leaderboard_ranks(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- public read side

-- One visible profile by exact display name (case-insensitive). No row means "nothing to show":
-- missing, private, members-only for a signed-out visitor and suspended look the same.
create function public.get_profile(p_name text)
returns table (
  display_name text, avatar_url text, bio text, visibility text,
  setup_editor text, setup_os text, setup_languages text[], setup_tools text[], setup_notes text,
  dotfiles_url text, portfolio_url text,
  contribution_score integer, banner_item_id text,
  rank_all bigint, rank_month bigint
)
language sql stable security definer set search_path = '' as $$
  select d.display_name, d.avatar_url, d.bio, d.visibility,
         d.setup_editor, d.setup_os, d.setup_languages, d.setup_tools, d.setup_notes,
         d.dotfiles_url, d.portfolio_url,
         d.contribution_score, d.banner_item_id,
         case when d.contribution_score is not null then
           (select r.rank from private.leaderboard_ranks('all') r where lower(r.display_name) = lower(d.display_name))
         end,
         case when d.contribution_score is not null then
           (select r.rank from private.leaderboard_ranks('month') r where lower(r.display_name) = lower(d.display_name))
         end
  from public.profile_directory d
  where lower(d.display_name) = lower(p_name)
  limit 1;
$$;

-- The work shown on that profile: verified ledger work first (newest merged first), then
-- self-reported links. Empty unless the member switched "show my work" on and the profile is visible.
create function public.get_profile_work(p_name text)
returns table (
  display_name text, repository text, issue_number integer, pr_number integer,
  title text, url text, merged_at timestamptz, verified boolean
)
language sql stable security definer set search_path = '' as $$
  select w.display_name, w.repository, w.issue_number, w.pr_number, w.title, w.url, w.merged_at, w.verified
  from public.profile_work w
  where lower(w.display_name) = lower(p_name)
  order by w.verified desc, w.merged_at desc nulls last, w.title
  limit 200;
$$;

-- The members directory: visible profiles, highest score first, then by name. Cards need only these
-- columns. At most 60 rows per call.
create function public.member_directory(p_limit integer default 24, p_offset integer default 0)
returns table (
  display_name text, avatar_url text, bio text,
  setup_editor text, setup_os text, setup_languages text[], setup_tools text[],
  contribution_score integer, banner_item_id text
)
language sql stable security definer set search_path = '' as $$
  select d.display_name, d.avatar_url, d.bio,
         d.setup_editor, d.setup_os, d.setup_languages, d.setup_tools,
         d.contribution_score, d.banner_item_id
  from public.profile_directory d
  order by d.contribution_score desc nulls last, lower(d.display_name), d.display_name
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ---------------------------------------------------------------- reports

create table public.profile_reports (
  id bigint generated always as identity primary key,
  target_user uuid not null references auth.users (id) on delete cascade,
  reporter uuid references auth.users (id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);
create index profile_reports_status on public.profile_reports (status, created_at);
create index profile_reports_reporter on public.profile_reports (reporter, created_at);
-- One open report per reporter and profile, enforced even when two requests arrive together.
create unique index profile_reports_one_open
  on public.profile_reports (reporter, target_user) where status = 'open';
comment on table public.profile_reports is
  'Reports about public profiles. Read by administrators only; the reporter cannot read them back.';

alter table public.profile_reports enable row level security;
create policy profile_reports_admin_select on public.profile_reports for select to authenticated
  using (public.is_admin());

-- A signed-in member reports a profile they can see, other than their own.
-- Same message for a missing, private and suspended profile, so a report never reveals which exists.
create function public.report_profile(p_name text, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  target uuid;
  reason text := btrim(coalesce(p_reason, ''));
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  if char_length(reason) not between 1 and 500 then
    raise exception 'reason must be 1 to 500 characters';
  end if;
  -- Concurrent requests from one member run one at a time, so the daily limit holds.
  perform pg_advisory_xact_lock(hashtextextended('report_profile:' || uid::text, 0));

  select m.user_id into target
  from public.member_profiles m
  where lower(m.display_name) = lower(p_name)
    and not m.suspended
    and m.visibility in ('public', 'members');
  if target is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if target = uid then
    raise exception 'you cannot report your own profile';
  end if;
  if (select count(*) from public.profile_reports
      where reporter = uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'too many reports today: at most 10 a day';
  end if;
  if exists (select 1 from public.profile_reports
             where reporter = uid and target_user = target and status = 'open') then
    raise exception 'you already have an open report for this profile';
  end if;
  insert into public.profile_reports (target_user, reporter, reason) values (target, uid, reason);
end $$;

-- Administrator only: close a report as actioned (we acted, for example with admin_suspend_profile)
-- or dismissed. A resolved report is final; repeating the same call changes nothing and adds no audit row.
create function public.admin_resolve_report(p_id bigint, p_status text)
returns public.profile_reports
language plpgsql security definer set search_path = '' as $$
declare
  r public.profile_reports;
begin
  if not public.is_admin() then
    raise exception 'administrator only' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('actioned', 'dismissed') then
    raise exception 'status must be actioned or dismissed';
  end if;
  select * into r from public.profile_reports where id = p_id for update;
  if not found then raise exception 'report not found'; end if;
  if r.status = p_status then
    return r;
  end if;
  if r.status <> 'open' then
    raise exception 'report is already resolved';
  end if;
  update public.profile_reports
     set status = p_status, resolved_at = now(), resolved_by = auth.uid()
   where id = p_id
   returning * into r;
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (auth.uid(), 'report.resolve', 'profile_report', r.id::text,
          jsonb_build_object('status', p_status, 'target_user', r.target_user));
  return r;
end $$;

-- ---------------------------------------------------------------- privileges

revoke all on function public.get_profile(text) from public, anon, authenticated;
revoke all on function public.get_profile_work(text) from public, anon, authenticated;
revoke all on function public.member_directory(integer, integer) from public, anon, authenticated;
revoke all on function public.report_profile(text, text) from public, anon, authenticated;
revoke all on function public.admin_resolve_report(bigint, text) from public, anon, authenticated;
revoke all on public.profile_reports from public, anon, authenticated;

grant execute on function public.get_profile(text) to anon, authenticated;
grant execute on function public.get_profile_work(text) to anon, authenticated;
grant execute on function public.member_directory(integer, integer) to anon, authenticated;
grant execute on function public.report_profile(text, text) to authenticated;
grant execute on function public.admin_resolve_report(bigint, text) to authenticated;

grant select on public.profile_reports to authenticated;
grant all on public.profile_reports to service_role;
