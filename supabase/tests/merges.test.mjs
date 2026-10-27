// Tests for supabase/migrations/20261027170000_record_merge.sql: every merged pull request counts (8Q part 1).
// Same fixtures as rewards.test.mjs: PGlite with Supabase roles, auth.uid() and auth.identities stubbed.
//
//   node supabase/tests/merges.test.mjs        (PGLITE_PATH=… if the package is not installed here)

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


const REPO_W = 'LightningEg/Lightning_website';
const record = (o) => as('service_role', null, async () => (await one(
  `select public.record_merge($1, $2, $3, $4, $5::timestamptz, $6, $7, $8) r`,
  [o.repo ?? REPO, o.pr, o.title ?? 'A change', o.url ?? `https://github.com/${o.repo ?? REPO}/pull/${o.pr}`,
   o.at ?? '2026-10-20T10:00:00Z', o.gh, o.login ?? 'someone', o.lines])).r);
const entries = (uid) => q(`select kind, contribution_delta, wallet_delta, source_type, source_id, allocation_slot, idempotency_key from public.ledger_entries where user_id = $1 order by id`, [uid]).then(r => r.rows);
const plain = v => JSON.parse(JSON.stringify(v));

await test('size bands: small 20, medium 50, large 100, at the edges', async () => {
  await identity(B, 2001, 'bee');
  const got = [];
  let pr = 100;
  for (const lines of [0, 1, 49, 50, 399, 400, 5000]) {
    const r = await record({ pr: ++pr, gh: 2001, lines });
    assert.equal(r.status, 'recorded');
    got.push(r.points);
  }
  assert.deepEqual(got, [20, 20, 20, 50, 50, 100, 100]);
  const w = await wallet(B);
  assert.deepEqual([w.balance, w.contribution_score], [0, 20 + 20 + 20 + 50 + 50 + 100 + 100], 'points score but never pay coins');
});

await test('a recognition entry: kind recognition, points only, source pull_request, once per pull request', async () => {
  const r = await record({ pr: 201, gh: 2001, lines: 10 });
  assert.equal(r.status, 'recorded');
  const e = plain((await entries(B)).find(x => x.source_id === `${REPO}#201`));
  assert.deepEqual(e, { kind: 'recognition', contribution_delta: 20, wallet_delta: 0, source_type: 'pull_request', source_id: `${REPO}#201`, allocation_slot: 'primary', idempotency_key: `merge:${REPO}#201` });
  const again = await record({ pr: 201, gh: 2001, lines: 900 });
  assert.equal(again.status, 'already_recorded');
  assert.equal(again.points, 20, 'a rerun with another size changes nothing');
  assert.equal(await count(`select 1 from public.ledger_entries where source_id = '${REPO}#201'`), 1);
  // Case does not matter for the repository name; the canonical name is the key
  assert.equal((await record({ repo: REPO.toUpperCase(), pr: 201, gh: 2001, lines: 10 })).status, 'already_recorded');
});

await test('an unlinked author is held, once, and paid with the link, exactly like coins', async () => {
  const r = await record({ pr: 301, gh: 3001, login: 'newcomer', lines: 120, title: 'Fix the thing' });
  assert.deepEqual([r.status, r.points], ['pending', 50]);
  assert.equal((await record({ pr: 301, gh: 3001, lines: 120 })).status, 'already_pending');
  const held = await one(`select points, amount, issue_number, source_type, source_id, github_login, settled_at from public.pending_awards where github_id = 3001`);
  assert.deepEqual(plain(held), { points: 50, amount: null, issue_number: null, source_type: 'pull_request', source_id: `${REPO}#301`, github_login: 'newcomer', settled_at: null });
  await record({ pr: 302, gh: 3001, lines: 5 });
  assert.equal(await count(`select 1 from public.pending_awards where github_id = 3001 and settled_at is null`), 2);
  // the owner's console lists coin awards only
  assert.equal((await as('authenticated', ADMIN, () => q(`select * from public.admin_pending_awards()`))).rows.length, 0, 'the console still lists coin awards only');
  await identity(C, 3001, 'newcomer');
  const w = await wallet(C);
  assert.deepEqual([w.balance, w.contribution_score], [0, 70], 'both held merges settled on link');
  const es = plain(await entries(C));
  assert.deepEqual(es.map(e => [e.kind, e.contribution_delta, e.wallet_delta, e.source_id]).sort(),
    [['recognition', 20, 0, `${REPO}#302`], ['recognition', 50, 0, `${REPO}#301`]].sort());
  assert.equal(await count(`select 1 from public.pending_awards where github_id = 3001 and settled_at is null`), 0);
  // a later rerun does not pay twice
  assert.equal((await record({ pr: 301, gh: 3001, lines: 120 })).status, 'already_recorded');
  assert.equal((await wallet(C)).contribution_score, 70);
});

await test('held points and held coins settle side by side', async () => {
  await as('authenticated', ADMIN, () => one(`select * from public.publish_reward($1, $2, $3, $4, $5)`, [REPO, 777, 100, 'Done when the tests pass.', null]));
  const m = await merge({ pr: 401, gh: 4001, issues: [777], login: 'both' });
  assert.equal(m.results[0].status, 'pending');
  const r = await record({ pr: 401, gh: 4001, lines: 60, login: 'both' });
  assert.equal(r.status, 'pending');
  await identity(D, 4001, 'both');
  const w = await wallet(D);
  assert.deepEqual([w.balance, w.contribution_score], [100, 150], '100 coins from the offer, 100 score from it and 50 points from the merge');
});

await test('ineligible repository, before rewards_start, the owner, bad input', async () => {
  assert.equal((await record({ repo: 'LightningEg/Lightning_market', pr: 501, gh: 2001, lines: 10 })).status, 'ineligible_repository');
  assert.equal((await record({ repo: 'someone/else', pr: 502, gh: 2001, lines: 10 })).status, 'ineligible_repository');
  await q(`update public.repositories set eligible = true, rewards_start_at = '2026-10-25T00:00:00Z' where full_name = $1`, [REPO_W]);
  assert.equal((await record({ repo: REPO_W, pr: 503, gh: 2001, lines: 10, at: '2026-10-24T23:59:59Z' })).status, 'before_rewards_start');
  assert.equal((await record({ repo: REPO_W, pr: 504, gh: 2001, lines: 10, at: '2026-10-25T00:00:00Z' })).status, 'recorded');
  assert.equal(await count(`select 1 from public.ledger_entries where source_id in ('${REPO_W}#503', '${REPO}#501', '${REPO}#502')`), 0);
  assert.equal(await count(`select 1 from public.pending_awards where source_id in ('${REPO_W}#503', '${REPO}#501')`), 0);
  // an administrator's linked GitHub account never earns it
  await identity(ADMIN, 9001, 'owner');
  assert.equal((await record({ pr: 505, gh: 9001, lines: 500 })).status, 'owner');
  assert.equal(await count(`select 1 from public.ledger_entries where user_id = '${ADMIN}'`), 0);
  await assert.rejects(record({ pr: 506, gh: 2001, lines: -1 }), /changed lines/);
  await assert.rejects(record({ pr: 0, gh: 2001, lines: 1 }), /pull request number/);
  await assert.rejects(record({ pr: 507, gh: 0, lines: 1 }), /author github id/);
  await assert.rejects(record({ pr: 508, gh: 2001, lines: 1, url: 'http://x' }), /https/);
});

await test('only the service role may call it', async () => {
  for (const role of ['anon', 'authenticated']) {
    await as(role, B, () => assert.rejects(q(`select public.record_merge($1, 1, 't', 'https://x.test', now(), 2001, 'bee', 10)`, [REPO]), /permission denied/));
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exitCode = failed ? 1 : 0;
