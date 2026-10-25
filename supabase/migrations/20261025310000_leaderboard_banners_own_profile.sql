begin;
-- Owner feedback (2026-10-25): the leaderboard shows each member's banner behind their row, a row counts every
-- entry that raised the score (a rewarded story counted 0 contributions beside a score of 200), and a member always
-- sees their own profile, even while it is private or members-only, so Profile is never blank for its owner.

drop function public.leaderboard(text,integer);
create function public.leaderboard(p_period text default 'all',p_limit integer default 50)
returns table(rank bigint,display_name text,avatar_url text,contribution_count bigint,score bigint,frame_item_id text,badge_item_id text,banner_item_id text)
language plpgsql stable security definer set search_path='' as $$
declare since timestamptz;
begin
 if p_period not in('all','month') then raise exception 'period must be all or month';end if;
 since:=case when p_period='month' then date_trunc('month',now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' else '-infinity'::timestamptz end;
 return query
 with scores as(
  select m.user_id as uid,m.display_name as dn,m.avatar_url as av,
   count(*) filter(where l.contribution_delta>0) as cnt,sum(l.contribution_delta)::bigint as sc
  from public.ledger_entries l join public.member_profiles m on m.user_id=l.user_id
  where m.show_on_leaderboard and m.adult_confirmed and not m.suspended and l.earned_at>=since
  group by m.user_id,m.display_name,m.avatar_url having sum(l.contribution_delta)>0)
 select(rank() over(order by s.sc desc))::bigint,s.dn,s.av,s.cnt,s.sc,
  (select e.item_id from public.equipped_items e where e.user_id=s.uid and e.slot='frame'),
  (select e.item_id from public.equipped_items e where e.user_id=s.uid and e.slot='badge'),
  (select e.item_id from public.equipped_items e where e.user_id=s.uid and e.slot='banner')
 from scores s order by 1,s.dn limit least(greatest(p_limit,1),100);
end $$;

-- The same row as profile_directory, plus the owner's own row whatever its visibility (never a suspended one).
create or replace function public.get_profile(p_name text)
returns table(display_name text,avatar_url text,bio text,visibility text,setup_editor text,setup_os text,setup_languages text[],setup_tools text[],setup_notes text,
 dotfiles_url text,portfolio_url text,contribution_score integer,banner_item_id text,rank_all bigint,rank_month bigint,frame_item_id text,badge_item_id text)
language sql stable security definer set search_path='' as $$
 with d as(
  select d.* from public.profile_directory d where lower(d.display_name)=lower(p_name)
  union all
  select m.display_name,m.avatar_url,m.bio,m.visibility,m.setup_editor,m.setup_os,m.setup_languages,m.setup_tools,m.setup_notes,m.dotfiles_url,m.portfolio_url,
   case when m.show_on_leaderboard then w.contribution_score end,
   (select e.item_id from public.equipped_items e where e.user_id=m.user_id and e.slot='banner'),
   (select e.item_id from public.equipped_items e where e.user_id=m.user_id and e.slot='frame'),
   (select e.item_id from public.equipped_items e where e.user_id=m.user_id and e.slot='badge')
  from public.member_profiles m left join public.wallets w on w.user_id=m.user_id
  where m.user_id=auth.uid() and not m.suspended and lower(m.display_name)=lower(p_name))
 select d.display_name,d.avatar_url,d.bio,d.visibility,d.setup_editor,d.setup_os,d.setup_languages,d.setup_tools,d.setup_notes,d.dotfiles_url,d.portfolio_url,
  d.contribution_score,d.banner_item_id,
  case when d.contribution_score is not null then(select r.rank from private.leaderboard_ranks('all') r where lower(r.display_name)=lower(d.display_name))end,
  case when d.contribution_score is not null then(select r.rank from private.leaderboard_ranks('month') r where lower(r.display_name)=lower(d.display_name))end,
  d.frame_item_id,d.badge_item_id
 from d limit 1;
$$;
revoke all on function public.leaderboard(text,integer),public.get_profile(text) from public;
grant execute on function public.leaderboard(text,integer),public.get_profile(text) to anon,authenticated,service_role;
commit;
