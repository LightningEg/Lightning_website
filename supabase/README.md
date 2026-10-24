# Supabase (For Geeks accounts and Lightning Coins)

Design and status: [docs/proposals/forgeeks-accounts-lightning-coins.md](../docs/proposals/forgeeks-accounts-lightning-coins.md). No page uses this database yet.

## Apply the migration

Supabase dashboard → SQL Editor → New query → paste `migrations/20261024190000_forgeeks_core.sql` → Run. Run it once, on an empty project. Later changes go in new, later-dated files; never edit an applied migration.

## Make yourself the administrator

Sign in once on the site (or create your user in Authentication → Users), then run this in the SQL Editor with your own address:

```sql
insert into public.admin_roles (user_id, role)
select id, 'admin' from auth.users where email = 'YOUR-EMAIL-HERE';
```

Do not commit your address. Administrators publish rewards (`publish_reward`), correct the ledger (`admin_correct_entry`) and moderate profiles (`admin_suspend_profile`).

## Keys

- The publishable (`anon`) key may sit in site JavaScript. It can only do what the row-level security rules allow.
- The secret (`service_role`) key stays in Supabase or GitHub Secrets. It is the only role that can call `award_coins`.

## Tests

```
npm i --no-save @electric-sql/pglite
node supabase/tests/schema.test.mjs
```

The tests run the migration on a real Postgres engine with Supabase's roles stubbed and check the access rules as each role. They cannot run truly parallel purchases (one connection); overspend protection rests on the wallet row lock plus `CHECK (balance >= 0)`.
