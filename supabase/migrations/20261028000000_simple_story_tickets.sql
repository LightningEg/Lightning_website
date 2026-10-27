begin;
-- An author's entered name is review context, not verified identity. No external post edits required.
alter table public.community_stories add column submitted_author_name text check(char_length(submitted_author_name) between 2 and 80);
drop function public.share_story(text,text,boolean,uuid);
create or replace function public.share_story(p_url text, p_line text, p_consent boolean, p_id uuid default null,p_title text default null,p_author text default null)
returns public.community_stories language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  line text := btrim(coalesce(p_line, ''));
  clean text := regexp_replace(rtrim(split_part(split_part(btrim(coalesce(p_url, '')), '?', 1), '#', 1), '/'), '^https://(old[.]|www[.]|m[.])?', 'https://');
  link text; red text; who text; r public.community_stories; kit jsonb;
begin
  if uid is null then raise exception 'sign in required'; end if;
  if p_title is not null and char_length(btrim(p_title)) not between 5 and 140 then raise exception 'title must be 5 to 140 characters'; end if;
  if p_author is not null and char_length(btrim(p_author)) not between 2 and 80 then raise exception 'author name must be 2 to 80 characters'; end if;
  if p_consent is distinct from true then raise exception 'tick the box to agree to share your post under your display name'; end if;
  if char_length(line) not between 20 and 400 then raise exception 'say in 20 to 400 characters how you use Lightning'; end if;
  if clean ~ '^https://linkedin[.]com/' then link := regexp_replace(clean, '^https://linkedin[.]com/', 'https://www.linkedin.com/');
  elsif clean ~ '^https://reddit[.]com/' then red := regexp_replace(clean, '^https://reddit[.]com/', 'https://www.reddit.com/'); end if;
  if link is not null and link !~ '^https://www[.]linkedin[.]com/(posts/|feed/update/)[^[:space:]<>"'']+$' then link := null; end if;
  if red is not null and red !~ '^https://www[.]reddit[.]com/r/[A-Za-z0-9_]{2,21}/comments/[A-Za-z0-9]+(/[^[:space:]<>"'']*)?$' then red := null; end if;
  if link is null and red is null then raise exception 'paste the link to your own LinkedIn or Reddit post'; end if;
  perform pg_advisory_xact_lock(hashtext('story-share:' || uid::text));
  if p_id is null then
    select * into r from public.community_stories
     where user_id = uid and status in ('pending', 'published') and coalesce(linkedin_url, reddit_url) = coalesce(link, red);
    if found then return r; end if;
  else
    if not exists (select 1 from public.community_stories where id = p_id and user_id = uid and status in ('draft', 'rejected', 'withdrawn')) then
      raise exception 'that story cannot be edited now'; end if;
  end if;
  select display_name into who from public.member_profiles where user_id = uid;
  r := public.save_story(p_id, coalesce(nullif(btrim(p_title),''),'How ' || coalesce(who, 'a member') || ' uses Lightning'), line, link, red);
  update public.community_stories set submitted_author_name = coalesce(nullif(btrim(p_author),''),who) where id=r.id;
  return public.submit_story(r.id, true);
end $$;

create or replace function public.admin_moderate_story(p_id uuid,p_publish boolean,p_points integer,p_coins integer,p_note text,p_ownership_verified boolean,p_backlink_verified boolean,p_expected_revision bigint,p_rules_verified boolean default false)
returns public.community_stories language plpgsql security definer set search_path='' as $$
declare r public.community_stories;
begin
 perform private.require_mfa_admin();
 perform 1 from public.wallets where user_id=(select user_id from public.community_stories where id=p_id)for update;
 select * into r from public.community_stories where id=p_id for update;
 if not found then raise exception 'story not found';end if;
 if r.submission_revision is distinct from p_expected_revision then raise exception 'post changed; reload and review its current title, excerpt and links';end if;
 if p_publish is true and((r.coin_entry_id is not null and r.awarded_coins is distinct from p_coins)or(r.award_entry_id is not null and r.awarded_points is distinct from p_points))then raise exception 'post already rewarded; retain its original awards';end if;
 if r.status='published' and p_publish is true then
  if r.awarded_coins is distinct from p_coins or r.awarded_points is distinct from p_points then raise exception 'post already approved with a different award';end if;return r;
 end if;
 if p_publish is true and(r.rules_version is distinct from 'community-v1' or r.rules_accepted_at is null)then raise exception 'member must accept the community rules and resubmit';end if;
 if p_publish is true and(p_rules_verified is distinct from true or(r.linkedin_url is null and r.reddit_url is null))then raise exception 'review the linked post against community rules';end if;
 r:=public.admin_review_story(p_id,p_publish,p_points,p_coins,p_note);
 if p_publish then update public.community_stories set ownership_verified_at=null,backlink_verified_at=null,verified_by=null,rules_verified_at=now()where id=r.id returning * into r;end if;
 return r;
end $$;
revoke all on function public.share_story(text,text,boolean,uuid,text,text) from public,anon;
grant execute on function public.share_story(text,text,boolean,uuid,text,text) to authenticated;
commit;
