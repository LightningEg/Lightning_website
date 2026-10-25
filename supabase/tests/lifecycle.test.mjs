// Tests for supabase/migrations/20261025090000_forgeeks_account_lifecycle.sql: download your data, delete your account.
//
//   npm i --no-save @electric-sql/pglite
//   node supabase/tests/lifecycle.test.mjs

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const mod = process.env.PGLITE_PATH
  ? await import(pathToFileURL(process.env.PGLITE_PATH).href)
  : await import('@electric-sql/pglite');
const db = new mod.PGlite();

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const ADMIN = '00000000-0000-4000-8000-0000000000ad';

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now(), last_sign_in_at timestamptz);
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
    provider text not null, provider_id text not null, identity_data jsonb not null default '{}', created_at timestamptz not null default now(),
    unique (provider, provider_id));
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`);
for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  await db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
}

await db.exec(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);

async function as(role, uid, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
const q = (sql, params) => db.query(sql, params);
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}

await q(`insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test'), ($3, 'owner@example.test')`, [A, B, ADMIN]);
await q(`insert into auth.identities (user_id, provider, provider_id) values ($1, 'google', 'g-1'), ($1, 'email', $1::text)`, [A]);
await q(`insert into public.admin_roles (user_id, role) values ($1, 'admin')`, [ADMIN]);
await q(`insert into public.catalog_items (id, type, name, price) values ('banner-test', 'banner', 'Test', 50)`);
await as('authenticated', A, async () => {
  await q(`update public.profiles set full_name = 'Ada L', phone = '+20 100 000 0000' where user_id = $1`, [A]);
  await q(`update public.member_profiles set display_name = 'Ada', bio = 'hi' where user_id = $1`, [A]);
  await q(`insert into public.profile_links (user_id, label, url) values ($1, 'CLI', 'https://example.test/cli')`, [A]);
});
await as('service_role', null, () => q(`select public.award_coins($1, 'contribution_award', 120, 'issue', 'LightningEg/Lightning#5', 'Merged PR')`, [A]));
await as('authenticated', A, () => q(`select public.purchase_item_at_price('banner-test',coalesce((select price from public.catalog_items where id='banner-test'),0),'lifecycle-key-1')`));
await as('authenticated', A, () => q(`select public.equip_item('banner-test')`));

await test('export: only signed-in members, and only their own rows', async () => {
  await as('anon', null, async () => assert.rejects(q(`select public.export_my_data()`), /permission denied/));
  const out = (await as('authenticated', A, () => q(`select public.export_my_data() as d`))).rows[0].d;
  assert.equal(out.account.email, 'a@example.test');
  assert.deepEqual(out.account.sign_in_methods.sort(), ['email', 'google']);
  assert.equal(out.profiles[0].full_name, 'Ada L');
  assert.equal(out.member_profiles[0].display_name, 'Ada');
  assert.equal(out.profile_links.length, 1);
  assert.equal(out.wallets[0].balance, 70);
  assert.deepEqual(out.ledger_entries.map(e => e.kind).sort(), ['contribution_award', 'purchase']);
  assert.equal(out.purchases.length, 1);
  assert.equal(out.inventory.length, 1);
  assert.equal(out.equipped_items[0].item_id, 'banner-test');
  const all = JSON.stringify(out);
  assert.ok(!all.includes(B) && !all.includes('b@example.test'), 'nothing about another member');
  const other = (await as('authenticated', B, () => q(`select public.export_my_data() as d`))).rows[0].d;
  assert.equal(other.profile_links.length, 0);
  assert.equal(other.ledger_entries.length, 0);
});

await test('delete: needs sign-in and the exact phrase', async () => {
  await as('anon', null, async () => assert.rejects(q(`select public.delete_my_account('delete my account')`), /permission denied/));
  await as('authenticated', A, async () => {
    await assert.rejects(q(`select public.delete_my_account('yes')`), /delete my account/);
    await assert.rejects(q(`select public.delete_my_account(null)`), /delete my account/);
  });
  assert.equal((await q(`select count(*)::int c from auth.users where id = $1`, [A])).rows[0].c, 1);
});

await test('delete: an administrator cannot delete their own account here', async () => {
  await as('authenticated', ADMIN, async () => assert.rejects(q(`select public.delete_my_account('delete my account')`), /administrator/));
  assert.equal((await q(`select count(*)::int c from auth.users where id = $1`, [ADMIN])).rows[0].c, 1);
});

await test('delete: removes the sign-in and every personal row, keeps the coin history without a name', async () => {
  const ledgerBefore = (await q(`select count(*)::int c from public.ledger_entries where user_id = $1`, [A])).rows[0].c;
  await as('authenticated', A, () => q(`select public.delete_my_account('delete my account')`));
  for (const [t, col] of [['auth.users', 'id'], ['auth.identities', 'user_id'], ['public.profiles', 'user_id'], ['public.member_profiles', 'user_id'],
    ['public.profile_links', 'user_id'], ['public.wallets', 'user_id'], ['public.purchases', 'user_id'], ['public.inventory', 'user_id'],
    ['public.equipped_items', 'user_id'], ['public.contributions', 'user_id']]) {
    assert.equal((await q(`select count(*)::int c from ${t} where ${col} = $1`, [A])).rows[0].c, 0, t);
  }
  assert.equal((await q(`select count(*)::int c from public.ledger_entries where user_id is null`)).rows[0].c, ledgerBefore);
  const audit = (await q(`select actor, target_id, detail from public.audit_log where action = 'account.delete'`)).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor, null);
  assert.ok(!JSON.stringify(audit).includes('example.test'));
  assert.equal((await q(`select count(*)::int c from auth.users where id = $1`, [B])).rows[0].c, 1, 'other members untouched');
});

await test('after deletion the same session can do nothing', async () => {
  const out = (await as('authenticated', A, () => q(`select public.export_my_data() as d`))).rows[0].d;
  assert.equal(out.account, null);
  assert.equal(out.profiles.length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
