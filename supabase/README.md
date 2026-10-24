# Supabase (For Geeks accounts and Lightning Coins)

Design and status: [docs/proposals/forgeeks-accounts-lightning-coins.md](../docs/proposals/forgeeks-accounts-lightning-coins.md). The only page that uses this database is `forgeeks-account.html` (sign in and profile); it is not linked or indexed yet.

## Apply the migrations

Supabase dashboard → SQL Editor → New query → paste one file from `migrations/` → Run. Apply the files in date order, each once. Already ran the first one? Run only the files after it. Later changes go in new, later-dated files; never edit an applied migration.

1. `20261024190000_forgeeks_core.sql`: tables, ledger, wallet, purchases, rules.
2. `20261024210000_forgeeks_minors_guard.sql`: a birth date under 18 keeps the profile private.

## Make yourself the administrator

Sign in once on the site (or create your user in Authentication → Users), then run this in the SQL Editor with your own address:

```sql
insert into public.admin_roles (user_id, role)
select id, 'admin' from auth.users where email = 'YOUR-EMAIL-HERE';
```

Do not commit your address. Administrators publish rewards (`publish_reward`), correct the ledger (`admin_correct_entry`) and moderate profiles (`admin_suspend_profile`).

## Sign-in settings

Authentication → URL Configuration. Site URL: `https://lightningeg.com`. Redirect URLs: add `https://lightningeg.com/forgeeks-account.html` (and `http://localhost:8000/forgeeks-account.html` to test on your computer). Google sign-in uses the callback URL Supabase shows in its Google provider settings.

## Keys

- The publishable (`anon`) key may sit in site JavaScript. It can only do what the row-level security rules allow.
- The secret (`service_role`) key stays in Supabase or GitHub Secrets. It is the only role that can call `award_coins`.

## Tests

```
npm i --no-save @electric-sql/pglite jsdom
node supabase/tests/schema.test.mjs    # the database rules
node supabase/tests/account.test.mjs   # the account page, with a fake Supabase client
```

The tests run the migration on a real Postgres engine with Supabase's roles stubbed and check the access rules as each role. They cannot run truly parallel purchases (one connection); overspend protection rests on the wallet row lock plus `CHECK (balance >= 0)`.
