-- For Geeks: keep profiles of people under 18 private (FG-03).
--
-- The account page already refuses these combinations; this makes the database refuse them too,
-- so a request that skips the page cannot publish a minor's profile.
--
-- Limit, by design: the birth date is optional, and "I am 18 or older" is the member's own
-- statement. This rule applies whenever a birth date under 18 is on file.

create function private.is_minor(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where user_id = p_user
      and birth_date is not null
      and birth_date > (current_date - interval '18 years')::date);
$$;

-- A minor's display profile stays private: not public, not members-only, not on the leaderboard, not marked adult.
create function private.minor_profile_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.visibility <> 'private' or new.show_on_leaderboard or new.adult_confirmed)
     and private.is_minor(new.user_id) then
    raise exception 'a profile for someone under 18 must stay private'
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger member_profiles_minor_guard before insert or update on public.member_profiles
  for each row execute function private.minor_profile_guard();

-- Entering a birth date under 18 makes the profile private straight away.
create function private.minor_birth_date_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.birth_date is not null and private.is_minor(new.user_id) then
    update public.member_profiles
       set visibility = 'private', show_on_leaderboard = false, adult_confirmed = false
     where user_id = new.user_id
       and (visibility <> 'private' or show_on_leaderboard or adult_confirmed);
  end if;
  return null;
end $$;
create trigger profiles_minor_birth_date after insert or update of birth_date on public.profiles
  for each row execute function private.minor_birth_date_guard();
