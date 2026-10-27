begin;
-- The website repository earns Lightning Coins like the app repository (2026-10-27): a merged pull request that closes
-- one of its issues pays its author through the same award_merge() path, once per issue, by the same rules.
-- Add the GitHub Actions secret SUPABASE_SERVICE_ROLE_KEY to LightningEg/Lightning_website for .github/workflows/rewards.yml
-- to report merges; without it that workflow prints a notice and does nothing. The owner still publishes each offer
-- (amount per issue) in the console before anything is paid.
insert into public.repositories (full_name, eligible)
values ('LightningEg/Lightning_website', true)
on conflict (lower(full_name)) do update set eligible = true;
commit;
