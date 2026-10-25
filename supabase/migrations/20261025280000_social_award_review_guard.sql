begin;
-- Existing awards cannot silently be changed when an edited post is republished.
create function private.protect_story_award_review()returns trigger language plpgsql set search_path='' as $$
begin
 if old.award_entry_id is not null and(new.awarded_points,new.award_entry_id)is distinct from(old.awarded_points,old.award_entry_id)then raise exception 'existing story point award is immutable';end if;
 if old.coin_entry_id is not null and(new.awarded_coins,new.coin_entry_id)is distinct from(old.awarded_coins,old.coin_entry_id)then raise exception 'existing story coin award is immutable';end if;
 return new;
end $$;
-- The moderator wrapper validates requested awards before its idempotent core call.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.admin_moderate_story(uuid,boolean,integer,integer,text,boolean,boolean,bigint,boolean)'::regprocedure);
 definition:=replace(definition,'if r.status=''published'' and p_publish is true then',
 'if p_publish is true and((r.coin_entry_id is not null and r.awarded_coins is distinct from p_coins)or(r.award_entry_id is not null and r.awarded_points is distinct from p_points))then raise exception ''post already rewarded; retain its original awards'';end if;
 if r.status=''published'' and p_publish is true then');
 execute definition;
end $$;
revoke all on function private.protect_story_award_review()from public,anon,authenticated,service_role;
create trigger protect_story_award_review before update on public.community_stories for each row execute function private.protect_story_award_review();
commit;
