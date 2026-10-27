-- Where a score comes from (owner, 2026-10-27): code, feedback and writing, per ranked member.
-- Reads the ledger the leaderboard already sums, with the same privacy rules (show_on_leaderboard, adult, not suspended).
-- code     = contribution_award from merged pull requests and issues
-- feedback = feedback_award (accepted app feedback)
-- writing  = entries from community stories; today stories pay Cotton only, so this stays 0 until the owner scores them
-- Only score (contribution_delta) is counted, never Cotton or money.
begin;
create or replace function public.score_sources(p_period text, p_limit integer default 25)
returns table(display_name text, code bigint, feedback bigint, writing bigint, other bigint)
language plpgsql stable security definer set search_path = '' as $$
declare since timestamptz;
begin
 if p_period not in('all','month') then raise exception 'period must be all or month';end if;
 since:=case when p_period='month' then date_trunc('month',now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' else '-infinity'::timestamptz end;
 return query
 select m.display_name,
  coalesce(sum(l.contribution_delta) filter(where l.kind='contribution_award' and l.source_type in('pull_request','issue')),0)::bigint,
  coalesce(sum(l.contribution_delta) filter(where l.kind='feedback_award'),0)::bigint,
  coalesce(sum(l.contribution_delta) filter(where l.source_type='community_story'),0)::bigint,
  coalesce(sum(l.contribution_delta) filter(where not(l.kind='contribution_award' and l.source_type in('pull_request','issue'))
    and l.kind<>'feedback_award' and l.source_type<>'community_story'),0)::bigint
 from public.ledger_entries l join public.member_profiles m on m.user_id=l.user_id
 where m.show_on_leaderboard and m.adult_confirmed and not m.suspended and l.earned_at>=since
 group by m.user_id,m.display_name having sum(l.contribution_delta)>0
 order by sum(l.contribution_delta) desc, m.display_name
 limit least(greatest(p_limit,1),100);
end $$;
revoke all on function public.score_sources(text,integer) from public;
grant execute on function public.score_sources(text,integer) to anon, authenticated, service_role;
commit;
