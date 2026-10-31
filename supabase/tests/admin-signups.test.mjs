// The owner's sign-up count (supabase/migrations/20261031120000_admin_signups.sql): admin_signups() counts members,
// separates administrators, follows sign-up to doing something, refuses everyone else, and names no one.
// The page that shows it: owner-signups-pages.test.mjs.
//
//   PGLITE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/admin-signups.test.mjs

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const mod = process.env.PGLITE_PATH
  ? await import(pathToFileURL(process.env.PGLITE_PATH).href)
  : await import('@electric-sql/pglite');
const db = new mod.PGlite();
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// The parts of Supabase the migrations depend on, with the auth.users columns this function reads.
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now(),
    last_sign_in_at timestamptz, email_confirmed_at timestamptz, is_anonymous boolean not null default false);
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
const aal = level => db.exec(`select set_config('request.jwt.claims','{"aal":"${level}"}',false)`);
await aal('aal2');
async function as(role, user, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${role};`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
const q = (sql, params) => db.query(sql, params);
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}

// Five accounts: the owner, and four members with different histories.
const [ADMIN, U1, U2, U3, U4] = [1, 2, 3, 4, 5].map(uid);
const emails = {};
const make = async (id, { confirmed = true, signedIn = true, providers = ['email'] } = {}) => {
  emails[id] = `secret-${id.slice(-2)}@example.test`;
  await q(`insert into auth.users (id, email, email_confirmed_at, last_sign_in_at) values ($1, $2, $3, $4)`,
    [id, emails[id], confirmed ? new Date().toISOString() : null, signedIn ? new Date().toISOString() : null]);
  for (const p of providers) await q(`insert into auth.identities (user_id, provider, provider_id) values ($1, $2, $3)`, [id, p, p + id]);
};
await make(ADMIN);
await make(U1);                                                    // email; asked for a top-up and bought
await make(U2, { signedIn: false, providers: ['google'] });        // confirmed, never came back
await make(U3, { providers: ['github', 'google'] });               // two ways in; linked GitHub; contributed
await make(U4, { confirmed: false, signedIn: false });            // never confirmed
await q(`insert into public.admin_roles (user_id, role) values ($1, 'admin')`, [ADMIN]);
// Rows that belong to other tables are inserted with foreign keys off: only their user matters here.
await db.exec(`set session_replication_role = replica`);
await q(`insert into public.topup_requests (user_id, package_id, request_key, coins, price_piastres) values ($1, gen_random_uuid(), gen_random_uuid(), 100, 5000)`, [U1]);
await q(`insert into public.purchases (user_id, item_id, price_paid, ledger_entry_id, idempotency_key) values ($1, 'nile', 300, 1, 'k1')`, [U1]);
await q(`insert into public.contributions (user_id, ledger_entry_id, repository, title, url) values ($1, 2, 'LightningEg/Lightning', 't', 'https://example.test/1')`, [U3]);
await q(`insert into public.github_links (user_id, github_id, github_login) values ($1, 42, 'someone')`, [U3]);
await db.exec(`set session_replication_role = origin`);

const signups = (user, days) => as('authenticated', user, async () => (await q(`select public.admin_signups($1) as r`, [days])).rows[0].r);

await test('the owner sees members counted apart from administrators', async () => {
  const r = await signups(ADMIN, 7);
  assert.equal(r.totals.accounts, 5);
  assert.equal(r.totals.members, 4);
  assert.equal(r.totals.administrators, 1);
  assert.equal(r.period.members, 4);
});

await test('sign-up to doing something: each step counts the members who reached it', async () => {
  const s = (await signups(ADMIN, 7)).steps;
  assert.deepEqual(s, { signed_up: 4, confirmed_email: 3, signed_in: 2, linked_github: 1, asked_topup: 1, bought: 1, contributed: 1, did_something: 2 });
});

await test('how they sign in counts a member once per way in', async () => {
  const p = Object.fromEntries((await signups(ADMIN, 7)).providers.map(x => [x.provider, x.members]));
  assert.deepEqual(p, { email: 2, google: 2, github: 1 });
});

await test('the period is one entry per day and adds up to the members who joined in it', async () => {
  const r = await signups(ADMIN, 7);
  assert.equal(r.daily.length, 7);
  assert.equal(r.daily.reduce((a, d) => a + d.signups, 0), 4);
  assert.ok(r.daily.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d.day)), 'each day is a plain date');
});

await test('a member, an anonymous caller and a weaker session are all refused', async () => {
  await assert.rejects(() => signups(U1, 7), /administrator/i);
  await assert.rejects(() => as('anon', null, () => q(`select public.admin_signups(7)`)), /permission denied/i);
  await aal('aal1');
  try { await assert.rejects(() => signups(ADMIN, 7), /administrator|MFA/i); } finally { await aal('aal2'); }
});

await test('the answer names no one: no email, id or name appears in it, and the latest list is bounded', async () => {
  const r = await signups(ADMIN, 365);
  const text = JSON.stringify(r);
  for (const e of Object.values(emails)) assert.ok(!text.includes(e), 'an email leaked');
  for (const id of [ADMIN, U1, U2, U3, U4]) assert.ok(!text.includes(id), 'an id leaked');
  assert.ok(!/someone/.test(text), 'a GitHub login leaked');
  assert.ok(r.recent.length <= 15 && r.recent.every(x => Object.keys(x).sort().join() === 'confirmed,day,did_something,providers,signed_in'));
});

await test('the days asked for are kept within one to 365', async () => {
  assert.equal((await signups(ADMIN, 0)).days, 1);
  assert.equal((await signups(ADMIN, 100000)).days, 365);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
