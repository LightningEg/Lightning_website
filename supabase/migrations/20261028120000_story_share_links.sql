begin;
-- Phone share links (owner report 2026-10-28): LinkedIn's Share button gives https://lnkd.in/…, Reddit's app gives
-- https://www.reddit.com/r/<sub>/s/<code> or https://redd.it/<id>; all were refused, so a post from a phone could not be shared.
-- The owner opens every link before approving it, so a short link is as safe as a long one. A link pasted without https:// is accepted.
alter table public.community_stories drop constraint if exists community_stories_linkedin_url_check;
alter table public.community_stories add constraint community_stories_linkedin_url_check
  check(linkedin_url ~ '^https://((www\.)?linkedin\.com/(posts/|feed/update/|pulse/)|lnkd\.in/)[^[:space:]<>"'']+$' and char_length(linkedin_url)<=1000);
alter table public.community_stories drop constraint if exists community_stories_reddit_url_check;
alter table public.community_stories add constraint community_stories_reddit_url_check
  check(reddit_url ~ '^https://(www[.]reddit[.]com/r/[A-Za-z0-9_]{2,21}/(comments|s)/[A-Za-z0-9]+(/[^[:space:]<>"'']*)?|redd[.]it/[A-Za-z0-9]+)$' and char_length(reddit_url)<=1000);
create or replace function public.share_story(p_url text, p_line text, p_consent boolean, p_id uuid default null,p_title text default null,p_author text default null)
returns public.community_stories language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  line text := btrim(coalesce(p_line, ''));
  raw text := btrim(coalesce(p_url, ''));
  clean text;
  link text; red text; who text; r public.community_stories; kit jsonb;
begin
  -- A link pasted without https:// (lnkd.in/p/abc, reddit.com/r/x/s/abc) is read as https.
  if raw ~* '^(www[.]|m[.]|old[.])?(linkedin[.]com|lnkd[.]in|reddit[.]com|redd[.]it)/' then raw := 'https://' || raw; end if;
  clean := regexp_replace(rtrim(split_part(split_part(raw, '?', 1), '#', 1), '/'), '^https://(old[.]|www[.]|m[.])?', 'https://');
  if uid is null then raise exception 'sign in required'; end if;
  if p_title is not null and char_length(btrim(p_title)) not between 5 and 140 then raise exception 'title must be 5 to 140 characters'; end if;
  if p_author is not null and char_length(btrim(p_author)) not between 2 and 80 then raise exception 'author name must be 2 to 80 characters'; end if;
  if p_consent is distinct from true then raise exception 'tick the box to agree to share your post under your display name'; end if;
  if char_length(line) not between 20 and 400 then raise exception 'say in 20 to 400 characters how you use Lightning'; end if;
  if clean ~ '^https://linkedin[.]com/' then link := regexp_replace(clean, '^https://linkedin[.]com/', 'https://www.linkedin.com/');
  elsif clean ~ '^https://lnkd[.]in/' then link := clean;
  elsif clean ~ '^https://(reddit[.]com|redd[.]it)/' then red := regexp_replace(clean, '^https://reddit[.]com/', 'https://www.reddit.com/'); end if;
  if link is not null and link !~ '^https://(www[.]linkedin[.]com/(posts/|feed/update/|pulse/)|lnkd[.]in/)[^[:space:]<>"'']+$' then link := null; end if;
  if red is not null and red !~ '^https://(www[.]reddit[.]com/r/[A-Za-z0-9_]{2,21}/(comments|s)/[A-Za-z0-9]+(/[^[:space:]<>"'']*)?|redd[.]it/[A-Za-z0-9]+)$' then red := null; end if;
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
revoke all on function public.share_story(text,text,boolean,uuid,text,text) from public,anon;
grant execute on function public.share_story(text,text,boolean,uuid,text,text) to authenticated;
commit;
