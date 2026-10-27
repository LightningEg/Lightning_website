// Tests for supabase/migrations/20261027170000_coders_on_the_leaderboard.sql: the leaderboard advertises who built what (8Q part 2).
// Same fixtures as rewards.test.mjs: PGlite with Supabase roles, auth.uid() and auth.identities stubbed.
//
//   node supabase/tests/coders.test.mjs        (PGLITE_PATH=… if the package is not installed here)

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
const record = (o) => as('service_role', null, async () => (await one(
  `select public.record_merge($1, $2, $3, $4, $5::timestamptz, $6, $7, $8) r`,
  [REPO, o.pr, o.title, `https://github.com/${REPO}/pull/${o.pr}`, o.at, o.gh, o.login ?? 'dev', o.lines ?? 10])).r);
const board = (p = 'all') => as('anon', null, async () => (await q(`select * from public.leaderboard($1, 50)`, [p])).rows.map(plain));
const mine = async (name, p) => (await board(p)).find(r => r.display_name === name);
const now = new Date();
const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() > 1 ? 1 : 1, 12)).toISOString();
const longAgo = '2026-01-10T10:00:00Z';

await q(`update public.member_profiles set display_name = 'Bee' where user_id = $1`, [B]);
await q(`update public.member_profiles set display_name = 'Cee' where user_id = $1`, [C]);
await identity(B, 2001, 'bee-codes');

await test('the old columns keep their names and order; a member with no merges shows empty new ones', async () => {
  await as('service_role', null, () => q(`select public.award_coins($1, 'admin_gift', 5, 't', 'g1', 'x')`, [C])); // coins only: not on the board
  await as('service_role', null, () => q(`select public.award_coins($1, 'contribution_award', 30, 'pr', 'LightningEg/Lightning#1', 'Merged')`, [C]));
  const r = await mine('Cee', 'all');
  assert.deepEqual(Object.keys(r), ['rank', 'display_name', 'avatar_url', 'contribution_count', 'score', 'frame_item_id', 'badge_item_id', 'banner_item_id', 'name_item_id',
    'github_login', 'last_merge_title', 'last_merge_url', 'merges_month', 'portfolio_url']);
  assert.deepEqual([r.github_login, r.last_merge_title, r.last_merge_url, r.merges_month, r.portfolio_url], [null, null, null, 0, null]);
});

await test('GitHub login, the last merge with its link, and merges this month', async () => {
  await record({ pr: 1, title: 'Old fix', at: longAgo, gh: 2001, lines: 10 });
  await record({ pr: 2, title: 'Newest fix', at: thisMonth, gh: 2001, lines: 100 });
  await record({ pr: 3, title: 'Second this month', at: new Date(new Date(thisMonth).getTime() - 3600e3).toISOString(), gh: 2001, lines: 10 });
  const r = await mine('Bee', 'all');
  assert.equal(r.github_login, 'bee-codes');
  assert.equal(r.last_merge_title, 'Newest fix');
  assert.equal(r.last_merge_url, `https://github.com/${REPO}/pull/2`);
  assert.equal(r.merges_month, 2, 'the January merge is not this month');
  assert.equal(r.score, 20 + 50 + 20);
  const month = await mine('Bee', 'month');
  assert.equal(month.merges_month, 2);
  assert.equal(month.score, 70, 'the month board counts only this month');
});

await test('a coin award with a paid issue is the last merge too', async () => {
  await as('service_role', null, () => q(`select public.award_coins($1, 'contribution_award', 100, 'issue', 'LightningEg/Lightning#77', 'Merged', now() + interval '1 hour', 'primary', $2::jsonb)`,
    [B, JSON.stringify({ repository: REPO, issue_number: 77, pr_number: 9, title: 'Paid fix', url: `https://github.com/${REPO}/pull/9`, merged_at: new Date(Date.now() + 3600e3).toISOString() })]));
  const r = await mine('Bee', 'all');
  assert.deepEqual([r.last_merge_title, r.last_merge_url], ['Paid fix', `https://github.com/${REPO}/pull/9`]);
});

await test('a held merge appears with its title once the author links GitHub', async () => {
  await record({ pr: 20, title: 'Held then paid', at: thisMonth, gh: 5001, login: 'late' });
  assert.equal(await count(`select 1 from public.contributions where title = 'Held then paid'`), 0);
  await identity(D, 5001, 'late-dev');
  await q(`update public.member_profiles set display_name = 'Dee' where user_id = $1`, [D]);
  const r = await mine('Dee', 'all');
  assert.deepEqual([r.github_login, r.last_merge_title, r.merges_month], ['late-dev', 'Held then paid', 1]);
});

await test('the portfolio link shows only on a public profile with the work section on; nobody off the board is listed', async () => {
  await q(`update public.member_profiles set portfolio_url = 'https://bee.example.test', visibility = 'public', show_work = true where user_id = $1`, [B]);
  assert.equal((await mine('Bee', 'all')).portfolio_url, 'https://bee.example.test');
  await q(`update public.member_profiles set show_work = false where user_id = $1`, [B]);
  assert.equal((await mine('Bee', 'all')).portfolio_url, null);
  await q(`update public.member_profiles set show_work = true, visibility = 'members' where user_id = $1`, [B]);
  assert.equal((await mine('Bee', 'all')).portfolio_url, null);
  await q(`update public.member_profiles set show_on_leaderboard = false where user_id = $1`, [B]);
  assert.equal(await mine('Bee', 'all'), undefined, 'off the board: nothing about them is returned');
  await q(`update public.member_profiles set show_on_leaderboard = true where user_id = $1`, [B]);
  // an unlinked account shows no login
  await q(`update public.github_links set unlinked_at = now() where user_id = $1`, [B]);
  assert.equal((await mine('Bee', 'all')).github_login, null);
});

await test('anyone may read the board, and the argument is still checked', async () => {
  assert.ok((await board('all')).length > 0);
  await as('anon', null, () => assert.rejects(q(`select * from public.leaderboard('week', 5)`), /period must be all or month/));
});

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exitCode = failed ? 1 : 0;
