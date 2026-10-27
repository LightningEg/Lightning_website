begin;
-- Public by default, the leaderboard as an opt-out, and no age requirement (owner, 2026-10-27: "privacy settings
-- should be public by default, people should opt out of being shown on leaderboard not the other way around, i dont
-- need them to be 18 to participate as well").
-- New profiles start public and on the leaderboard. Existing members keep what they chose: nobody is made public
-- without having seen the switch. adult_confirmed stays as a column (older functions read it) but no longer gates
-- anything: it is true for everyone, and the constraints and the under-18 triggers are gone.

drop trigger if exists member_profiles_minor_guard on public.member_profiles;
drop trigger if exists profiles_minor_birth_date on public.profiles;
drop function if exists private.minor_profile_guard();
drop function if exists private.minor_birth_date_guard();
drop function if exists private.is_minor(uuid);

alter table public.member_profiles drop constraint if exists public_needs_adult;
alter table public.member_profiles drop constraint if exists leaderboard_needs_adult;

alter table public.member_profiles alter column visibility set default 'public';
alter table public.member_profiles alter column show_on_leaderboard set default true;
alter table public.member_profiles alter column adult_confirmed set default true;
update public.member_profiles set adult_confirmed = true where not adult_confirmed;
-- An older page that still sends adult_confirmed=false must not hide anyone.
create function private.adult_always() returns trigger language plpgsql set search_path = '' as $$
begin new.adult_confirmed := true; return new; end $$;
create trigger member_profiles_adult_always before insert or update on public.member_profiles
  for each row execute function private.adult_always();
commit;
