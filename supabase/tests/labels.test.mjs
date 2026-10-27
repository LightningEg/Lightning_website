// Tests for supabase/migrations/20261027170000_offers_by_label.sql: an issue labelled coins:<n> publishes its offer (8Q part 2).
// Same fixtures as rewards.test.mjs: PGlite with Supabase roles, auth.uid() and auth.identities stubbed.
//
//   node supabase/tests/labels.test.mjs        (PGLITE_PATH=… if the package is not installed here)

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
await q(`insert into public.repositories (full_name, eligible) values ('LightningEg/Lightning_market', false)`);



const plain = v => JSON.parse(JSON.stringify(v));
const url = n => `https://github.com/${REPO}/issues/${n}`;
const label = (issue, amount, o = {}) => as('service_role', null, async () => (await one(
  `select public.publish_offer_from_label($1, $2, $3, $4, $5, $6) r`, [o.repo ?? REPO, issue, amount, o.title ?? `Issue ${issue}`, url(issue), o.by ?? 'maintainer'])).r);
const unlabel = (issue, o = {}) => as('service_role', null, async () => (await one(
  `select public.close_offer_from_label($1, $2, $3) r`, [o.repo ?? REPO, issue, o.by ?? 'maintainer'])).r);
const offerOf = issue => one(`select o.status, o.current_version, v.amount, v.title, v.acceptance_criteria from public.reward_offers o
  join public.reward_offer_versions v on v.offer_id = o.id and v.version = o.current_version
  join public.repositories r on r.id = o.repository_id where r.full_name = $1 and o.issue_number = $2`, [REPO, issue]);

await test('a label publishes the offer through the one versioning path; the same label again changes nothing', async () => {
  assert.deepEqual(plain(await label(901, 100)), { status: 'published', issue: 901, amount: 100, version: 1 });
  const o = plain(await offerOf(901));
  assert.deepEqual([o.status, o.current_version, o.amount, o.title], ['open', 1, 100, 'Issue 901']);
  assert.match(o.acceptance_criteria, /issues\/901/);
  assert.equal((await label(901, 100)).status, 'unchanged');
  assert.equal((await offerOf(901)).current_version, 1, 'no new version for a replayed event');
  assert.deepEqual(plain(await label(901, 150)), { status: 'updated', issue: 901, amount: 150, version: 2 });
  assert.equal((await offerOf(901)).amount, 150);
  assert.equal(await count(`select 1 from public.audit_log where action = 'reward.publish' and target_id = (select id::text from public.reward_offers where issue_number = 901)`), 2);
  assert.equal(await count(`select 1 from public.audit_log where action = 'reward.label' and detail ->> 'by' = 'maintainer'`) >= 2, true);
});

await test('the console path still publishes (publish_reward shares the same versioning)', async () => {
  const v = await as('authenticated', ADMIN, () => one(`select * from public.publish_reward($1, $2, $3, $4, $5)`, [REPO, 902, 40, 'Done when the tests pass.', 'By hand']));
  assert.deepEqual([v.version, v.amount], [1, 40]);
  await as('authenticated', B, () => assert.rejects(q(`select * from public.publish_reward($1, 903, 40, 'x', null)`, [REPO]), /administrator only/));
  assert.equal((await label(902, 40)).status, 'unchanged', 'a label for the same amount leaves the console offer alone');
});

await test('the amount is bounded, the repository must be eligible, the issue and url are checked', async () => {
  for (const bad of [0, -5, 5001, null]) await assert.rejects(label(910, bad), /1 to 5000/);
  assert.equal((await label(911, 5000)).status, 'published');
  assert.equal((await label(912, 1)).status, 'published');
  assert.equal((await label(913, 100, { repo: 'LightningEg/Lightning_market' })).status, 'ineligible_repository');
  assert.equal((await label(914, 100, { repo: 'someone/else' })).status, 'ineligible_repository');
  await assert.rejects(label(0, 100), /issue number/);
  await assert.rejects(as('service_role', null, () => q(`select public.publish_offer_from_label($1, 915, 100, 't', 'http://x', 'm')`, [REPO])), /https/);
  assert.equal(await count(`select 1 from public.reward_offers o join public.repositories r on r.id = o.repository_id where o.issue_number in (910, 913, 914, 915)`), 0);
});

await test('removing the label closes an open, unclaimed offer; a claimed one stays open; relabelling reopens', async () => {
  await label(920, 100);
  assert.equal((await unlabel(920)).status, 'closed');
  assert.equal((await offerOf(920)).status, 'closed');
  assert.equal((await unlabel(920)).status, 'already_closed');
  assert.equal((await unlabel(999)).status, 'no_offer');
  assert.equal((await label(920, 100)).status, 'reopened');
  assert.equal((await offerOf(920)).status, 'open');
  await as('service_role', null, () => one(`select public.record_claim($1, 920, 6001, 'claimer') r`, [REPO]));
  assert.equal((await unlabel(920)).status, 'claimed');
  assert.equal((await offerOf(920)).status, 'open', 'a claimed task is not pulled from under its claimant');
  assert.equal((await unlabel(920, { repo: 'someone/else' })).status, 'ineligible_repository');
});

await test('a paid or held offer cannot be republished by a label', async () => {
  await label(930, 100);
  const m = await as('service_role', null, async () => (await one(`select public.award_merge($1, 5930, 'Fix', $2, now(), 6002, 'solver', '{930}'::int[]) r`, [REPO, `https://github.com/${REPO}/pull/5930`])).r);
  assert.equal(m.results[0].status, 'pending');
  assert.equal((await label(930, 300)).status, 'already_awarded');
  assert.equal((await offerOf(930)).amount, 100);
});

await test('only the service role may call them', async () => {
  for (const role of ['anon', 'authenticated']) {
    await as(role, B, () => assert.rejects(q(`select public.publish_offer_from_label($1, 940, 100, 't', 'https://x.test', 'm')`, [REPO]), /permission denied/));
    await as(role, B, () => assert.rejects(q(`select public.close_offer_from_label($1, 940, 'm')`, [REPO]), /permission denied/));
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exitCode = failed ? 1 : 0;
