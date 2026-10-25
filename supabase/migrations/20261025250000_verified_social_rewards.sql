begin;
alter table public.community_stories add column rules_version text;
alter table public.community_stories add column rules_accepted_at timestamptz;
alter table public.community_stories add column submission_revision bigint not null default 0;
alter table public.community_stories add column ownership_verified_at timestamptz;
alter table public.community_stories add column backlink_verified_at timestamptz;
alter table public.community_stories add column verified_by uuid;
alter table public.community_stories add column rules_verified_at timestamptz;
create function private.story_submission_revision()returns trigger language plpgsql set search_path='' as $$
begin
 if(new.title,new.body,new.linkedin_url,new.reddit_url,new.consent_at)is distinct from(old.title,old.body,old.linkedin_url,old.reddit_url,old.consent_at)then
  new.submission_revision:=old.submission_revision+1;new.rules_version:=null;new.rules_accepted_at:=null;new.rules_verified_at:=null;new.ownership_verified_at:=null;new.backlink_verified_at:=null;new.verified_by:=null;
 end if;return new;
end $$;
create trigger story_submission_revision before update on public.community_stories for each row execute function private.story_submission_revision();
create function public.admin_moderate_story(p_id uuid,p_publish boolean,p_points integer,p_coins integer,p_note text,p_ownership_verified boolean,p_backlink_verified boolean,p_expected_revision bigint,p_rules_verified boolean default false)
returns public.community_stories language plpgsql security definer set search_path='' as $$
declare r public.community_stories;
begin
 perform private.require_mfa_admin();
 perform 1 from public.wallets where user_id=(select user_id from public.community_stories where id=p_id)for update;
 select * into r from public.community_stories where id=p_id for update;
 if not found then raise exception 'story not found';end if;
 if r.submission_revision is distinct from p_expected_revision then raise exception 'post changed; reload and review its current links and verification code';end if;
 if r.status='published' and p_publish is true then
  if r.awarded_coins is distinct from p_coins or r.awarded_points is distinct from p_points then raise exception 'post already approved with a different award';end if;return r;
 end if;
 if p_publish is true and(r.rules_version is distinct from 'community-v1' or r.rules_accepted_at is null)then raise exception 'member must accept the community rules and resubmit';end if;
 if p_publish is true and(p_ownership_verified is distinct from true or p_backlink_verified is distinct from true or p_rules_verified is distinct from true or(r.linkedin_url is null and r.reddit_url is null))then raise exception 'verify the post belongs to this member using its code and that it links back to Lightning';end if;
 r:=public.admin_review_story(p_id,p_publish,p_points,p_coins,p_note);
 if p_publish then update public.community_stories set ownership_verified_at=now(),backlink_verified_at=now(),verified_by=auth.uid(),rules_verified_at=now()where id=r.id returning * into r;end if;
 return r;
end $$;
revoke all on function public.admin_review_story(uuid,boolean,integer,integer,text)from public,anon,authenticated,service_role;
revoke all on function public.admin_moderate_story(uuid,boolean,integer,integer,text,boolean,boolean,bigint,boolean)from public,anon;
grant execute on function public.admin_moderate_story(uuid,boolean,integer,integer,text,boolean,boolean,bigint,boolean)to authenticated;
create function public.admin_social_queue(p_status text default 'pending',p_offset integer default 0)returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_mfa_admin();
 if p_status not in('pending','published','rejected')then raise exception 'valid queue status required';end if;
 return(select coalesce(jsonb_agg(x.item order by x.submitted_at,x.id),'[]'::jsonb)from(
 select s.id,s.submitted_at,to_jsonb(s)||jsonb_build_object('author',m.display_name,'member_suspended',m.suspended)as item from public.community_stories s join public.member_profiles m on m.user_id=s.user_id where s.status=p_status order by s.submitted_at,s.id limit 50 offset greatest(coalesce(p_offset,0),0))x);
end $$;
revoke all on function private.story_submission_revision()from public,anon,authenticated,service_role;
revoke all on function public.admin_social_queue(text,integer)from public,anon;
grant execute on function public.admin_social_queue(text,integer)to authenticated;
create function public.admin_ban_community_member(p_user uuid,p_reason text)returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_mfa_admin();
 if p_reason is null or char_length(btrim(p_reason))not between 5 and 500 then raise exception 'clear community-rule violation and reason required';end if;
 perform public.admin_suspend_profile(p_user,true,btrim(p_reason));
 update public.community_stories set status='rejected',published_at=null,review_note='Removed for a community-rule violation.',updated_at=now()where user_id=p_user and status in('pending','published');
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'community.ban','user',p_user::text,jsonb_build_object('reason',btrim(p_reason)));
end $$;
revoke all on function public.admin_ban_community_member(uuid,text)from public,anon;
grant execute on function public.admin_ban_community_member(uuid,text)to authenticated;
create function public.admin_restore_community_member(p_user uuid,p_reason text)returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_mfa_admin();if p_reason is null or char_length(btrim(p_reason))not between 5 and 500 then raise exception 'restoration reason required';end if;
 perform public.admin_suspend_profile(p_user,false,btrim(p_reason));
end $$;
alter function public.submit_story(uuid,boolean)set schema private;
alter function private.submit_story(uuid,boolean)rename to submit_verified_story_impl;
revoke all on function private.submit_verified_story_impl(uuid,boolean)from public,anon,authenticated,service_role;
create function public.submit_story(p_id uuid,p_consent boolean)returns public.community_stories language plpgsql security definer set search_path='' as $$
declare r public.community_stories;
begin
 perform private.require_active_session();if exists(select 1 from public.member_profiles where user_id=auth.uid()and suspended)then raise exception 'community access is restricted; contact hello@lightningeg.com';end if;
 r:=private.submit_verified_story_impl(p_id,p_consent);
 if p_consent is true and r.status='pending' then update public.community_stories set rules_version='community-v1',rules_accepted_at=now()where id=r.id returning * into r;end if;return r;
end $$;
revoke all on function public.admin_restore_community_member(uuid,text),public.submit_story(uuid,boolean)from public,anon;
grant execute on function public.admin_restore_community_member(uuid,text),public.submit_story(uuid,boolean)to authenticated;
commit;
