begin;
-- 8R: one form for a story. The member pastes the link to a LinkedIn or Reddit post, says in one line how they use
-- Lightning and consents; share_story saves and submits in one step (through save_story and submit_story, so every
-- earlier protection stays: public profile, the submission limit, the rules version, one reviewed source per story).
-- The member's verification code exists before the first story, so the page can show it and the link to put in the post.
-- The owner approves with one press at a ladder of coins and points they set; asking for a change sends the story back.

create table private.story_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null default substr(md5(random()::text || clock_timestamp()::text || gen_random_uuid()::text), 1, 8)
);
revoke all on private.story_codes from public, anon, authenticated, service_role;

create function public.story_kit() returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c text;
begin
  if uid is null then raise exception 'sign in required'; end if;
  insert into private.story_codes (user_id) values (uid) on conflict do nothing;
  select code into c from private.story_codes where user_id = uid;
  return jsonb_build_object('code', c, 'link', 'https://lightningeg.com/', 'text', 'Lightning verification: ' || c || E'\nhttps://lightningeg.com/');
end $$;

create function public.share_story(p_url text, p_line text, p_consent boolean, p_id uuid default null)
returns public.community_stories language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  line text := btrim(coalesce(p_line, ''));
  clean text := regexp_replace(rtrim(split_part(split_part(btrim(coalesce(p_url, '')), '?', 1), '#', 1), '/'), '^https://(old[.]|www[.]|m[.])?', 'https://');
  link text; red text; who text; r public.community_stories; kit jsonb;
begin
  if uid is null then raise exception 'sign in required'; end if;
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
  r := public.save_story(p_id, 'How ' || coalesce(who, 'a member') || ' uses Lightning', line, link, red);
  kit := public.story_kit();
  update public.community_stories set verify_code = kit ->> 'code' where id = r.id;
  return public.submit_story(r.id, true);
end $$;

-- Sends a pending story back to its author with a note. The author edits it and shares it again.
create function public.admin_request_story_change(p_id uuid, p_note text) returns public.community_stories
language plpgsql security definer set search_path = '' as $$
declare r public.community_stories;
begin
  perform private.require_mfa_admin();
  if p_note is null or char_length(btrim(p_note)) not between 5 and 500 then raise exception 'say what to change, in 5 to 500 characters'; end if;
  select * into r from public.community_stories where id = p_id for update;
  if not found then raise exception 'story not found'; end if;
  if r.status <> 'pending' then raise exception 'story not awaiting review'; end if;
  update public.community_stories set status = 'draft', consent_at = null, review_note = btrim(p_note), updated_at = now()
   where id = p_id returning * into r;
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (auth.uid(), 'story.change_requested', 'story', p_id::text, jsonb_build_object('note', btrim(p_note)));
  return r;
end $$;

-- The reward ladder the owner sets: what one press of Approve pays.
create table public.story_reward_ladder (
  id boolean primary key default true check (id),
  coins integer not null default 100 check (coins between 0 and 500),
  points integer not null default 50 check (points between 0 and 500),
  updated_by uuid, updated_at timestamptz not null default now()
);
insert into public.story_reward_ladder default values;
alter table public.story_reward_ladder enable row level security;
revoke all on public.story_reward_ladder from public, anon, authenticated;
grant all on public.story_reward_ladder to service_role;

create function public.admin_story_ladder() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_mfa_admin();
  return (select jsonb_build_object('coins', coins, 'points', points) from public.story_reward_ladder);
end $$;

create function public.admin_set_story_ladder(p_coins integer, p_points integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_mfa_admin();
  if p_coins is null or p_points is null or p_coins not between 0 and 500 or p_points not between 0 and 500 then
    raise exception 'coins and points must be 0 to 500'; end if;
  update public.story_reward_ladder set coins = p_coins, points = p_points, updated_by = auth.uid(), updated_at = now();
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (auth.uid(), 'story.ladder', 'settings', 'story_reward_ladder', jsonb_build_object('coins', p_coins, 'points', p_points));
  return jsonb_build_object('coins', p_coins, 'points', p_points);
end $$;

-- One press: approve at the ladder. The owner's three checks (code seen in the post, link back to Lightning, general money
-- content) are the one confirmation the page asks for; the moderation function still refuses without all three.
create function public.admin_approve_story(p_id uuid, p_expected_revision bigint, p_note text default null) returns public.community_stories
language plpgsql security definer set search_path = '' as $$
declare l public.story_reward_ladder;
begin
  perform private.require_mfa_admin();
  select * into l from public.story_reward_ladder;
  return public.admin_moderate_story(p_id, true, l.points, l.coins, coalesce(nullif(btrim(p_note), ''), 'Approved'), true, true, p_expected_revision, true);
end $$;

revoke all on function public.story_kit(), public.share_story(text, text, boolean, uuid), public.admin_request_story_change(uuid, text),
  public.admin_story_ladder(), public.admin_set_story_ladder(integer, integer), public.admin_approve_story(uuid, bigint, text) from public, anon;
grant execute on function public.story_kit(), public.share_story(text, text, boolean, uuid), public.admin_request_story_change(uuid, text),
  public.admin_story_ladder(), public.admin_set_story_ladder(integer, integer), public.admin_approve_story(uuid, bigint, text) to authenticated;
commit;
