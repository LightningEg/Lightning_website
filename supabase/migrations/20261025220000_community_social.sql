-- Community: Reddit sources, spendable story coins with disclosure, frames and badges everywhere a member appears.
-- Builds on 1500 (stories) and 1100 (showcase). Not deployed: apply after the pending audit migrations (1900, 2000, 2100).
--
-- Rules enforced here:
--   * A story is rewarded for the writing, never for links, likes, votes or comments. A source URL alone earns nothing.
--   * Story coins are spendable but never raise rank: they post as kind 'story_coins' (wallet only). Rank points stay
--     separate ('recognition').
--   * A member can be rewarded for at most 3 stories in any 30 days, and an accepted source (LinkedIn or Reddit)
--     is rewarded once, whichever story it is attached to.
--   * Every published story that earned anything is public as "rewarded", so readers see the relationship.
begin;

alter table public.ledger_entries drop constraint ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check check(kind in
 ('contribution_award','feedback_award','admin_gift','purchase','refund','correction','paid_topup','recognition','story_coins'));
alter table public.ledger_entries drop constraint ledger_kind_shape;
alter table public.ledger_entries add constraint ledger_kind_shape check(case kind
 when 'contribution_award' then contribution_delta>0 and wallet_delta=contribution_delta
 when 'feedback_award' then contribution_delta>0 and wallet_delta=contribution_delta
 when 'admin_gift' then contribution_delta=0 and wallet_delta>0
 when 'recognition' then contribution_delta>0 and wallet_delta=0
 when 'story_coins' then contribution_delta=0 and wallet_delta>0 and source_type='community_story'
 when 'paid_topup' then contribution_delta=0 and wallet_delta>0 and source_type='instapay'
 when 'purchase' then contribution_delta=0 and wallet_delta<0
 when 'refund' then contribution_delta=0 and wallet_delta>0 and reverses_entry_id is not null
 when 'correction' then reverses_entry_id is not null end);

-- ---------------------------------------------------------------- stories: links out, Reddit source, coin reward
-- Owner decision: the site hosts no story text. A story is a title, a short summary and a link to the member's own
-- LinkedIn or Reddit post. The author puts a verification code in that post so a reviewer can tell it is theirs.

alter table public.community_stories
 add column reddit_url text check(reddit_url ~ '^https://www[.]reddit[.]com/r/[A-Za-z0-9_]{2,21}/comments/[A-Za-z0-9]+(/[^[:space:]<>"'']*)?$' and char_length(reddit_url)<=1000),
 add column coin_entry_id bigint references public.ledger_entries(id),
 add column awarded_coins integer not null default 0 check(awarded_coins>=0),
 add column verify_code text not null default substr(md5(random()::text||clock_timestamp()::text),1,8);
create index stories_coin_entry on public.community_stories(coin_entry_id);

drop function public.save_story(uuid,text,text,text);
create function public.save_story(p_id uuid,p_title text,p_body text,p_linkedin_url text default null,p_reddit_url text default null)
returns public.community_stories language plpgsql security definer set search_path='' as $$
declare r public.community_stories;
 link text:=nullif(regexp_replace(rtrim(split_part(split_part(btrim(coalesce(p_linkedin_url,'')),'?',1),'#',1),'/'),'^https://linkedin[.]com/','https://www.linkedin.com/'),'');
 red text:=nullif(regexp_replace(rtrim(split_part(split_part(btrim(coalesce(p_reddit_url,'')),'?',1),'#',1),'/'),'^https://(old[.]|www[.])?reddit[.]com/','https://www.reddit.com/'),'');
begin
 if auth.uid() is null then raise exception 'sign in required';end if;
 if p_title is null or p_body is null or char_length(p_title)>140 or char_length(btrim(p_body))>400 then raise exception 'title or summary too long (summary is at most 400 characters)';end if;
 if p_id is null then
  perform pg_advisory_xact_lock(hashtext('story:'||auth.uid()::text));
  if(select count(*) from public.community_stories where user_id=auth.uid() and status<>'published')>=20 then raise exception 'too many draft stories';end if;
  insert into public.community_stories(user_id,title,body,linkedin_url,reddit_url)values(auth.uid(),btrim(p_title),btrim(p_body),link,red)returning * into r;
 else
  select * into r from public.community_stories where id=p_id and user_id=auth.uid() for update;
  if not found then raise exception 'story not found';end if;
  update public.community_stories set title=btrim(p_title),body=btrim(p_body),linkedin_url=link,reddit_url=red,status='draft',published_at=null,review_note=null,consent_at=null,updated_at=now() where id=r.id returning * into r;
 end if;
 return r;
end $$;

drop function public.admin_review_story(uuid,boolean,integer,text);
create function public.admin_review_story(p_id uuid,p_publish boolean,p_points integer,p_coins integer,p_note text)
returns public.community_stories language plpgsql security definer set search_path='' as $$
declare r public.community_stories;e public.ledger_entries;src text;h text;
begin
 perform private.require_mfa_admin();
 if p_points is null or p_points<0 or p_points>500 or p_coins is null or p_coins<0 or p_coins>500 or p_publish is null or p_note is null
  or char_length(btrim(p_note)) not between 1 and 500 then raise exception 'valid decision, points, coins and review note required';end if;
 select * into r from public.community_stories where id=p_id for update;
 if not found then raise exception 'story not found';end if;
 if r.status='published' and p_publish then return r;end if;
 if r.status not in ('pending','published') then raise exception 'story not awaiting review';end if;
 if p_publish then
  if r.consent_at is null or not exists(select 1 from public.member_profiles where user_id=r.user_id and visibility='public' and adult_confirmed and not suspended)then raise exception 'author consent and public adult profile required';end if;
  -- Each accepted source (LinkedIn or Reddit) belongs to one story; a duplicate cannot be published for credit.
  foreach src in array array[r.linkedin_url,r.reddit_url] loop
   if src is not null then
    h:=encode(sha256(convert_to(lower(src),'UTF8')),'hex');
    insert into private.story_source_claims(source_hash,story_id)values(h,r.id) on conflict do nothing;
    if not exists(select 1 from private.story_source_claims where source_hash=h and story_id=r.id) then raise exception 'source already accepted for another story';end if;
   end if;
  end loop;
  if r.award_entry_id is null and p_points>0 then
   e:=private.post_ledger(r.user_id,'recognition',p_points,0,'community_story',r.id::text,'primary','Accepted community story','story:'||r.id::text,now(),null,auth.uid());
   update public.community_stories set award_entry_id=e.id,awarded_points=p_points where id=r.id;
  end if;
  if r.coin_entry_id is null and p_coins>0 then
   if(select count(*) from public.community_stories where user_id=r.user_id and coin_entry_id is not null and published_at>now()-interval '30 days')>=3 then
    raise exception 'author already earned story coins for 3 stories in 30 days';end if;
   e:=private.post_ledger(r.user_id,'story_coins',0,p_coins,'community_story',r.id::text,'coins','Accepted community story','story-coins:'||r.id::text,now(),null,auth.uid());
   update public.community_stories set coin_entry_id=e.id,awarded_coins=p_coins where id=r.id;
  end if;
 end if;
 update public.community_stories set status=case when p_publish then 'published' else 'rejected' end,
  published_at=case when p_publish then now() else null end,review_note=btrim(p_note),updated_at=now() where id=r.id returning * into r;
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'story.review','story',r.id::text,jsonb_build_object('published',p_publish,'points',r.awarded_points,'coins',r.awarded_coins));
 return r;
end $$;

create or replace function public.submit_story(p_id uuid,p_consent boolean)returns public.community_stories language plpgsql security definer set search_path='' as $$
declare r public.community_stories;
begin
 if auth.uid() is null then raise exception 'sign in required';end if;
 perform pg_advisory_xact_lock(hashtext('story:'||auth.uid()::text));
 select * into r from public.community_stories where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception 'story not found';end if;
 if r.status='pending' then return r;end if;
 if r.status='published' then raise exception 'already published';end if;
 if p_consent is distinct from true or char_length(r.title)<5 or char_length(r.body)<20 then raise exception 'title, a summary of at least 20 characters and explicit sharing consent required';end if;
 if r.linkedin_url is null and r.reddit_url is null then raise exception 'a link to your LinkedIn or Reddit post is required';end if;
 if not exists(select 1 from public.member_profiles where user_id=auth.uid() and visibility='public' and adult_confirmed and not suspended) then raise exception 'a public adult profile is required to publish';end if;
 if(select count(*) from public.audit_log where actor=auth.uid() and action='story.submit' and created_at>now()-interval '24 hours')>=5 then raise exception 'submission limit reached';end if;
 update public.community_stories set status='pending',consent_at=now(),submitted_at=now(),updated_at=now() where id=r.id returning * into r;
 insert into public.audit_log(actor,action,target_type,target_id)values(auth.uid(),'story.submit','story',r.id::text);
 return r;
end $$;

-- ---------------------------------------------------------------- frames and badges

insert into public.catalog_items(id,type,name,description,price)values
 ('frame-halo','frame','Halo ring','A soft green and blue ring around your picture.',30),
 ('frame-gold','frame','Gold ring','A thin warm gold ring.',50),
 ('frame-nile','frame','Nile ring','Deep blue with a bright inner edge.',40),
 ('frame-double','frame','Double line','Two fine lines with a gap.',60),
 ('badge-bolt','badge','Bolt','A small lightning bolt next to your name.',30),
 ('badge-coin','badge','Coin','A small coin next to your name.',40),
 ('badge-pen','badge','Writer','A small pen. For people who share what they learn.',50),
 ('badge-star','badge','Star','A small star next to your name.',80)
on conflict(id) do nothing;

create or replace view public.profile_directory as
select m.display_name,m.avatar_url,m.bio,m.visibility,
  case when m.show_setup then m.setup_editor end as setup_editor,
  case when m.show_setup then m.setup_os end as setup_os,
  case when m.show_setup then m.setup_languages end as setup_languages,
  case when m.show_setup then m.setup_tools end as setup_tools,
  case when m.show_setup then m.setup_notes end as setup_notes,
  case when m.show_setup then m.dotfiles_url end as dotfiles_url,
  case when m.show_setup then m.portfolio_url end as portfolio_url,
  case when m.show_on_leaderboard then w.contribution_score end as contribution_score,
  (select e.item_id from public.equipped_items e where e.user_id=m.user_id and e.slot='banner') as banner_item_id,
  (select e.item_id from public.equipped_items e where e.user_id=m.user_id and e.slot='frame') as frame_item_id,
  (select e.item_id from public.equipped_items e where e.user_id=m.user_id and e.slot='badge') as badge_item_id
from public.member_profiles m left join public.wallets w on w.user_id=m.user_id
where not m.suspended and(m.visibility='public' or(m.visibility='members' and auth.uid() is not null));

drop function public.get_profile(text);
create function public.get_profile(p_name text)
returns table(display_name text,avatar_url text,bio text,visibility text,setup_editor text,setup_os text,setup_languages text[],setup_tools text[],setup_notes text,
 dotfiles_url text,portfolio_url text,contribution_score integer,banner_item_id text,rank_all bigint,rank_month bigint,frame_item_id text,badge_item_id text)
language sql stable security definer set search_path='' as $$
 select d.display_name,d.avatar_url,d.bio,d.visibility,d.setup_editor,d.setup_os,d.setup_languages,d.setup_tools,d.setup_notes,d.dotfiles_url,d.portfolio_url,
  d.contribution_score,d.banner_item_id,
  case when d.contribution_score is not null then(select r.rank from private.leaderboard_ranks('all') r where lower(r.display_name)=lower(d.display_name))end,
  case when d.contribution_score is not null then(select r.rank from private.leaderboard_ranks('month') r where lower(r.display_name)=lower(d.display_name))end,
  d.frame_item_id,d.badge_item_id
 from public.profile_directory d where lower(d.display_name)=lower(p_name) limit 1;
$$;

drop function public.member_directory(integer,integer);
create function public.member_directory(p_limit integer default 24,p_offset integer default 0)
returns table(display_name text,avatar_url text,bio text,setup_editor text,setup_os text,setup_languages text[],setup_tools text[],contribution_score integer,banner_item_id text,
 frame_item_id text,badge_item_id text)
language sql stable security definer set search_path='' as $$
 select d.display_name,d.avatar_url,d.bio,d.setup_editor,d.setup_os,d.setup_languages,d.setup_tools,d.contribution_score,d.banner_item_id,d.frame_item_id,d.badge_item_id
 from public.profile_directory d order by d.contribution_score desc nulls last,lower(d.display_name),d.display_name
 limit least(greatest(coalesce(p_limit,24),1),60) offset greatest(coalesce(p_offset,0),0);
$$;

drop function public.leaderboard(text,integer);
create function public.leaderboard(p_period text default 'all',p_limit integer default 50)
returns table(rank bigint,display_name text,avatar_url text,contribution_count bigint,score bigint,frame_item_id text,badge_item_id text)
language plpgsql stable security definer set search_path='' as $$
declare since timestamptz;
begin
 if p_period not in('all','month') then raise exception 'period must be all or month';end if;
 since:=case when p_period='month' then date_trunc('month',now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' else '-infinity'::timestamptz end;
 return query
 with scores as(
  select m.user_id as uid,m.display_name as dn,m.avatar_url as av,
   count(*) filter(where l.kind in('contribution_award','feedback_award')) as cnt,sum(l.contribution_delta)::bigint as sc
  from public.ledger_entries l join public.member_profiles m on m.user_id=l.user_id
  where m.show_on_leaderboard and m.adult_confirmed and not m.suspended and l.earned_at>=since
  group by m.user_id,m.display_name,m.avatar_url having sum(l.contribution_delta)>0)
 select(rank() over(order by s.sc desc))::bigint,s.dn,s.av,s.cnt,s.sc,
  (select e.item_id from public.equipped_items e where e.user_id=s.uid and e.slot='frame'),
  (select e.item_id from public.equipped_items e where e.user_id=s.uid and e.slot='badge')
 from scores s order by 1,s.dn limit least(greatest(p_limit,1),100);
end $$;

-- ---------------------------------------------------------------- public stories feed (blog)

drop function public.stories_feed(uuid);
create function public.stories_feed(p_id uuid default null,p_author text default null)
returns table(id uuid,title text,summary text,author text,avatar_url text,linkedin_url text,reddit_url text,rewarded boolean,published_at timestamptz,frame_item_id text,badge_item_id text)
language sql stable security definer set search_path='' as $$
 select s.id,s.title,s.body,m.display_name,m.avatar_url,s.linkedin_url,s.reddit_url,(s.awarded_coins>0 or s.awarded_points>0),s.published_at,
  (select e.item_id from public.equipped_items e where e.user_id=s.user_id and e.slot='frame'),
  (select e.item_id from public.equipped_items e where e.user_id=s.user_id and e.slot='badge')
 from public.community_stories s join public.member_profiles m on m.user_id=s.user_id
 where s.status='published' and m.visibility='public' and m.adult_confirmed and not m.suspended
  and(p_id is null or s.id=p_id) and(p_author is null or lower(m.display_name)=lower(p_author))
 order by s.published_at desc,s.id limit 40;
$$;

-- ---------------------------------------------------------------- privileges

revoke all on function public.save_story(uuid,text,text,text,text),public.admin_review_story(uuid,boolean,integer,integer,text),
 public.get_profile(text),public.member_directory(integer,integer),public.leaderboard(text,integer),public.stories_feed(uuid,text) from public,anon,authenticated;
grant execute on function public.save_story(uuid,text,text,text,text),public.admin_review_story(uuid,boolean,integer,integer,text) to authenticated;
grant execute on function public.get_profile(text),public.member_directory(integer,integer),public.leaderboard(text,integer),public.stories_feed(uuid,text) to anon,authenticated;
grant execute on function public.get_profile(text),public.member_directory(integer,integer),public.leaderboard(text,integer),public.stories_feed(uuid,text),
 public.save_story(uuid,text,text,text,text),public.admin_review_story(uuid,boolean,integer,integer,text) to service_role;
commit;
