// Tests for supabase/migrations/20261030120000_no_rewards_for_admins.sql: administrators are never paid for merged work,
// on the pending path too (owner, 2026-10-30). Same fixtures as coders.test.mjs.
//
//   node supabase/tests/admin-rewards.test.mjs        (PGLITE_PATH=… if the package is not installed here)

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const mod = process.env.PGLITE_PATH
  ? await import(pathToFileURL(process.env.PGLITE_PATH).href)
  : await import('@electric-sql/pglite');
const db = new mod.PGlite();

const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';
const E = '00000000-0000-4000-8000-00000000000e';

// ---- stub the parts of Supabase the migrations depend on (auth.identities has GoTrue's unique key)
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create table auth.identities (id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade, provider text not null, provider_id text not null,
    identity_data jsonb not null default '{}', created_at timestamptz not null default now(), unique (provider, provider_id));
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
const one = async (sql, params) => (await q(sql, params)).rows[0];
const count = async (sql, params) => (await q(`select count(*)::int c from (${sql}) s`, params)).rows[0].c;

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}

const REPO = 'LightningEg/Lightning';
const identity = (uid, ghid, login) => q(
  `insert into auth.identities (user_id, provider, provider_id, identity_data) values ($1, 'github', $2, $3::jsonb)`,
  [uid, String(ghid), JSON.stringify({ user_name: login, provider_id: String(ghid) })]);
const activeLink = uid => one(`select github_id, github_login from public.github_links where user_id = $1 and unlinked_at is null`, [uid]);
const publish = (issue, amount, criteria = 'Done when the tests pass.', title = null) =>
  as('authenticated', ADMIN, () => one(`select * from public.publish_reward($1, $2, $3, $4, $5)`, [REPO, issue, amount, criteria, title]));
const claim = (issue, ghid, login, repo = REPO) =>
  as('service_role', null, async () => (await one(`select public.record_claim($1, $2, $3, $4) r`, [repo, issue, ghid, login])).r);
const release = (issue, ghid) =>
  as('service_role', null, async () => (await one(`select public.release_claim($1, $2, $3) r`, [REPO, issue, ghid])).r);
const merge = (o) =>
  as('service_role', null, async () => (await one(
    `select public.award_merge($1, $2, $3, $4, $5::timestamptz, $6, $7, $8::int[]) r`,
    [o.repo ?? REPO, o.pr, o.title ?? 'Fix rounding', o.url ?? `https://github.com/${REPO}/pull/${o.pr}`,
     o.at ?? '2026-09-15T10:00:00Z', o.gh, o.login ?? 'someone', `{${o.issues.join(',')}}`])).r);
const wallet = uid => one(`select balance, contribution_score from public.wallets where user_id = $1`, [uid]);

await q(`insert into auth.users (id, email) values
  ($1, 'admin@example.test'), ($2, 'b@example.test'), ($3, 'c@example.test'), ($4, 'd@example.test'), ($5, 'e@example.test')`,
  [ADMIN, B, C, D, E]);
await q(`insert into public.admin_roles (user_id, role) values ($1, 'admin')`, [ADMIN]);




const record = (o) => as('service_role', null, async () => (await one(
  `select public.record_merge($1, $2, $3, $4, $5::timestamptz, $6, $7, $8) r`,
  [REPO, o.pr, o.title ?? 'Fix', `https://github.com/${REPO}/pull/${o.pr}`, o.at ?? '2026-10-20T10:00:00Z', o.gh, o.login ?? 'dev', 10])).r);
const recognition = uid => count(`select 1 from public.ledger_entries where user_id = $1 and kind = 'recognition'`, [uid]);
const score = async uid => Number((await wallet(uid))?.contribution_score ?? 0);

await test('an administrator who signs in with GitHub is not paid the pull requests held for that id', async () => {
  assert.equal((await record({ pr: 501, gh: 9001, login: 'owner-account' })).status, 'pending');
  assert.equal((await record({ pr: 502, gh: 9001, login: 'owner-account' })).status, 'pending');
  await identity(ADMIN, 9001, 'owner-account');
  assert.equal(await recognition(ADMIN), 0);
  assert.equal(await score(ADMIN), 0);
  assert.equal(await count(`select 1 from public.pending_awards where github_id = 9001 and settled_at is null`), 0, 'closed, not left pending');
  assert.equal(await count(`select 1 from public.audit_log where action = 'reward.void_admin'`), 2);
});

await test('a member who links GitHub is still paid what was held for them', async () => {
  assert.equal((await record({ pr: 503, gh: 9002, login: 'dee' })).status, 'pending');
  await identity(D, 9002, 'dee');
  assert.equal(await recognition(D), 1);
  assert.ok(await score(D) > 0);
});

await test('what an administrator was already paid stays; the migration can run again', async () => {
  await as('service_role', null, () => q(`select public.award_coins($1, 'contribution_award', 30, 'issue', 'LightningEg/Lightning#77', 'Merged')`, [ADMIN]));
  const migration = readFileSync(new URL('../migrations/20261030120000_no_rewards_for_admins.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  assert.equal(await score(ADMIN), 30, 'owner, 2026-10-30: keep my credits');
  assert.equal(await count(`select 1 from public.ledger_entries where kind = 'correction'`), 0);
  assert.ok(await score(D) > 0, 'members keep theirs');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
