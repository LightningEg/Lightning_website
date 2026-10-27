// Tests for supabase/migrations/20261025100000_forgeeks_rewards.sql (all migrations applied in order)
//
// GitHub identity links, claims, merge awards, pending awards, feedback, the task board and the admin helpers,
// on PGlite with Supabase's roles, auth.uid() and auth.identities stubbed.
//
//   node supabase/tests/rewards.test.mjs        (PGLITE_PATH=… if the package is not installed here)

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

// ------------------------------------------------------------ GitHub identity

await test('linking GitHub in Supabase Auth creates the active link from the numeric id', async () => {
  await identity(B, 1001, 'bee');
  assert.deepEqual(await activeLink(B), { github_id: 1001, github_login: 'bee' });
  // Another provider's identity is ignored.
  await q(`insert into auth.identities (user_id, provider, provider_id, identity_data) values ($1, 'google', '1001', '{}')`, [C]);
  assert.equal(await count(`select 1 from public.github_links where user_id = '${C}'`), 0);
  const r = await as('authenticated', B, () => one(`select public.sync_github_link() r`));
  assert.equal(r.r.github_id, 1001);
  assert.equal(r.r.github_login, 'bee');
});

await test('sync_github_link is the fallback when the trigger did not run, and only for the caller', async () => {
  await q(`alter table auth.identities disable trigger on_auth_github_identity_changed`);
  await identity(C, 1002, 'cee');
  await q(`alter table auth.identities enable trigger on_auth_github_identity_changed`);
  assert.equal(await activeLink(C), undefined);
  // B syncing does nothing for C.
  await as('authenticated', B, () => q(`select public.sync_github_link()`));
  assert.equal(await activeLink(C), undefined);
  const r = await as('authenticated', C, () => one(`select public.sync_github_link() r`));
  assert.equal(r.r.github_login, 'cee');
  assert.deepEqual(await activeLink(C), { github_id: 1002, github_login: 'cee' });
  // Running it again changes nothing.
  await as('authenticated', C, () => q(`select public.sync_github_link()`));
  assert.equal(await count(`select 1 from public.github_links where user_id = '${C}'`), 1);
});

await test('sync_github_link needs a signed-in member and a member without GitHub gets null', async () => {
  await as('anon', null, async () => assert.rejects(q(`select public.sync_github_link()`), /permission denied/));
  const r = await as('authenticated', E, () => one(`select public.sync_github_link() r`));
  assert.equal(r.r, null);
});

await test('a login change in GitHub updates the link; the id never changes', async () => {
  await q(`update auth.identities set identity_data = '{"user_name":"bee2"}'::jsonb where user_id = $1 and provider = 'github'`, [B]);
  assert.deepEqual(await activeLink(B), { github_id: 1001, github_login: 'bee2' });
  await q(`update auth.identities set identity_data = '{"user_name":"bee"}'::jsonb where user_id = $1 and provider = 'github'`, [B]);
});

await test('a GitHub id still linked to another member is refused, clearly, and nothing is taken over', async () => {
  // D links GitHub 1003. Its identity row then disappears without the removal trigger (an old, stale link).
  await identity(D, 1003, 'dee');
  await q(`alter table auth.identities disable trigger on_auth_github_identity_removed`);
  await q(`delete from auth.identities where user_id = $1 and provider = 'github'`, [D]);
  await q(`alter table auth.identities enable trigger on_auth_github_identity_removed`);
  assert.deepEqual(await activeLink(D), { github_id: 1003, github_login: 'dee' });
  // E now proves ownership of the same GitHub account.
  await identity(E, 1003, 'dee');
  assert.equal(await activeLink(E), undefined, 'the trigger must not steal the link');
  assert.deepEqual(await activeLink(D), { github_id: 1003, github_login: 'dee' });
  await as('authenticated', E, async () => {
    await assert.rejects(q(`select public.sync_github_link()`), /already linked to another member/);
  });
  // D's own sync finds no GitHub identity and releases the stale link; then E can link.
  const r = await as('authenticated', D, () => one(`select public.sync_github_link() r`));
  assert.equal(r.r, null);
  assert.equal(await activeLink(D), undefined);
  const e = await as('authenticated', E, () => one(`select public.sync_github_link() r`));
  assert.equal(e.r.github_id, 1003);
  // Put it back for the later tests: E drops the identity.
  await q(`delete from auth.identities where user_id = $1`, [E]);
  assert.equal(await activeLink(E), undefined);
});

await test('a member with a linked GitHub account cannot link a second one without unlinking', async () => {
  await identity(B, 1099, 'bee-other');
  assert.deepEqual(await activeLink(B), { github_id: 1001, github_login: 'bee' });
  await as('authenticated', B, async () => {
    await assert.rejects(q(`select public.sync_github_link()`), /unlink your current GitHub account/);
  });
  await q(`delete from auth.identities where user_id = $1 and provider_id = '1099'`, [B]);
  assert.deepEqual(await activeLink(B), { github_id: 1001, github_login: 'bee' }, 'removing the other identity must not unlink 1001');
});

await test('unlinking keeps history; the same id can be linked again', async () => {
  await q(`delete from auth.identities where user_id = $1 and provider = 'github'`, [B]);
  assert.equal(await activeLink(B), undefined);
  const rows = (await q(`select github_id, unlinked_at is not null as closed from public.github_links where user_id = $1 order by id`, [B])).rows;
  assert.deepEqual(rows.map(r => r.closed), [true]);
  await identity(B, 1001, 'bee');
  const again = (await q(`select unlinked_at is null as active from public.github_links where user_id = $1 order by id`, [B])).rows;
  assert.deepEqual(again.map(r => r.active), [false, true]);
});

await test('members can read only their own link; they cannot write links', async () => {
  await as('authenticated', B, async () => {
    const own = (await q(`select user_id, unlinked_at from public.github_links`)).rows;
    assert.ok(own.length >= 1 && own.every(r => r.user_id === B), 'own rows only (history included)');
    await assert.rejects(q(`insert into public.github_links (user_id, github_id, github_login) values ($1, 5, 'x')`, [B]), /permission denied/);
    await assert.rejects(q(`update public.github_links set github_id = 7`), /permission denied/);
  });
});

// ------------------------------------------------------------ claims

await publish(10, 50, 'Round money to whole EGP.', 'Round money');
await publish(11, 0, 'Explicitly unpaid.');
await publish(12, 80, 'Locked amount test.', 'Locked');
await publish(20, 60, 'Pays once.', 'Once');
await publish(21, 40, 'Pending then settled.', 'Pending');
await publish(22, 30, 'Close without paying.', 'Owner work');
await publish(30, 25, 'Start date test.', 'Dated');
await publish(31, 25, 'Start date test, after.', 'Dated 2');
await publish(40, 10, 'Board test.', 'Board');

await test('record_claim locks the version and amount; it is idempotent; another person gets a no-op', async () => {
  const first = await claim(10, 2001, 'cat');
  assert.equal(first.status, 'claimed');
  assert.equal(first.amount, 50);
  assert.equal(first.version, 1);
  const c = await one(`select user_id, github_id, github_login, amount_locked, offer_version, status from public.reward_claims`);
  assert.equal(c.user_id, null, 'claimant has no account yet');
  assert.equal(c.github_id, 2001);
  assert.equal((await claim(10, 2001, 'cat')).status, 'already_yours');
  const other = await claim(10, 2002, 'dog');
  assert.equal(other.status, 'taken');
  assert.equal(await count(`select 1 from public.reward_claims where status = 'active'`), 1);
  assert.equal((await one(`select github_id from public.reward_claims where status = 'active'`)).github_id, 2001);
});

await test('record_claim ignores ineligible repositories, issues without an offer and closed offers', async () => {
  assert.equal((await claim(10, 2003, 'x', 'LightningEg/Lightning_market')).status, 'ineligible_repository');
  assert.equal((await claim(10, 2003, 'x', 'Someone/Else')).status, 'ineligible_repository');
  assert.equal((await claim(999, 2003, 'x')).status, 'no_offer');
  await assert.rejects(claim(10, null, 'x'), /github id required/);
});

await test('release_claim drops only the releasing person claim; then someone else can take it', async () => {
  assert.equal((await release(10, 2002)).status, 'none');
  assert.equal((await release(10, 2001)).status, 'released');
  assert.equal((await one(`select status from public.reward_claims where github_id = 2001`)).status, 'dropped');
  assert.equal((await release(10, 2001)).status, 'none');
  assert.equal((await claim(10, 2002, 'dog')).status, 'claimed');
  assert.equal((await release(10, 2002)).status, 'released');
});

await test('a claim made before the account exists gets its member when GitHub is linked', async () => {
  assert.equal((await claim(10, 1002, 'cee')).status, 'claimed');   // C is linked: user_id is filled at once
  assert.equal((await one(`select user_id from public.reward_claims where github_id = 1002 and status = 'active'`)).user_id, C);
  await release(10, 1002);
  assert.equal((await claim(10, 3555, 'late')).status, 'claimed');   // nobody yet
  assert.equal((await one(`select user_id from public.reward_claims where github_id = 3555`)).user_id, null);
  await identity(E, 3555, 'late');
  assert.equal((await one(`select user_id from public.reward_claims where github_id = 3555`)).user_id, E);
  await q(`delete from auth.identities where user_id = $1`, [E]);
  await release(10, 3555);
});

await test('a claim needs a member or a GitHub id', async () => {
  const off = await one(`select id from public.reward_offers where issue_number = 10`);
  await assert.rejects(q(`insert into public.reward_claims (offer_id, offer_version, amount_locked) values ($1, 1, 5)`, [off.id]), /reward_claims_has_claimant/);
});

await test('the locked amount survives the owner raising the reward; a stranger is paid the current amount', async () => {
  assert.equal((await claim(12, 1001, 'bee')).amount, 80);
  const v2 = await publish(12, 120, 'Raised.');
  assert.equal(v2.version, 2);
  const board = await as('authenticated', B, () => q(`select amount, version, locked_amount, mine from public.task_board() where issue_number = 12`));
  assert.deepEqual(board.rows[0], { amount: 120, version: 2, locked_amount: 80, mine: true });
  const before = await wallet(B);
  const r = await merge({ pr: 200, gh: 1001, login: 'bee', issues: [12] });
  assert.equal(r.results[0].status, 'awarded');
  assert.equal(r.results[0].amount, 80);
  assert.equal((await wallet(B)).balance, before.balance + 80);
  assert.equal((await one(`select status from public.reward_claims where github_id = 1001 and offer_id = (select id from public.reward_offers where issue_number = 12)`)).status, 'completed');
  // Someone with no claim gets the current amount.
  await publish(13, 100, 'Current amount.');
  await publish(13, 90, 'Lowered.');
  const r2 = await merge({ pr: 201, gh: 1002, login: 'cee', issues: [13] });
  assert.equal(r2.results[0].amount, 90);
});

// ------------------------------------------------------------ merge awards

await test('a merge pays the issue once: replays and a second pull request add nothing', async () => {
  const startB = await wallet(B);
  const r = await merge({ pr: 100, gh: 1001, login: 'bee', issues: [20], title: 'Round all money' });
  assert.equal(r.status, 'ok');
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].status, 'awarded');
  assert.equal(r.results[0].amount, 60);
  const e = await one(`select * from public.ledger_entries where source_type = 'issue' and source_id = 'LightningEg/Lightning#20'`);
  assert.equal(e.user_id, B);
  assert.equal(e.kind, 'contribution_award');
  assert.equal(e.wallet_delta, 60);
  assert.equal(new Date(e.earned_at).toISOString(), '2026-09-15T10:00:00.000Z');
  const ct = await one(`select * from public.contributions where ledger_entry_id = $1`, [e.id]);
  assert.deepEqual([ct.repository, ct.issue_number, ct.pr_number, ct.title, ct.url],
    [REPO, 20, 100, 'Round all money', `https://github.com/${REPO}/pull/100`]);
  assert.equal((await wallet(B)).balance, startB.balance + 60);
  assert.equal((await wallet(B)).contribution_score, startB.contribution_score + 60);
  // The offer and claims are closed.
  assert.equal((await one(`select status from public.reward_offers where issue_number = 20`)).status, 'closed');
  // Replay of the same pull request.
  assert.equal((await merge({ pr: 100, gh: 1001, issues: [20] })).results[0].status, 'already_awarded');
  // A second pull request, by someone else, for the same issue.
  const startC = await wallet(C);
  assert.equal((await merge({ pr: 101, gh: 1002, login: 'cee', issues: [20] })).results[0].status, 'already_awarded');
  assert.deepEqual(await wallet(C), startC);
  assert.equal((await wallet(B)).balance, startB.balance + 60);
  assert.equal(await count(`select 1 from public.ledger_entries where source_id = 'LightningEg/Lightning#20'`), 1);
  assert.equal(await count(`select 1 from public.contributions where issue_number = 20`), 1);
});

await test('one pull request can pay several issues; the same list twice pays each once', async () => {
  await publish(23, 15, 'Multi A.');
  await publish(24, 20, 'Multi B.');
  const r = await merge({ pr: 110, gh: 1001, login: 'bee', issues: [23, 24, 23, 0, 777] });
  assert.deepEqual(r.results.map(x => [x.issue, x.status]), [[23, 'awarded'], [24, 'awarded'], [777, 'no_offer']]);
  const again = await merge({ pr: 110, gh: 1001, login: 'bee', issues: [23, 24] });
  assert.deepEqual(again.results.map(x => x.status), ['already_awarded', 'already_awarded']);
  assert.equal(await count(`select 1 from public.ledger_entries where source_id in ('LightningEg/Lightning#23','LightningEg/Lightning#24')`), 2);
});

await test('repository names are matched without regard to case and paid under the canonical name', async () => {
  await publish(25, 5, 'Case.');
  const r = await merge({ repo: 'lightningeg/LIGHTNING', pr: 120, gh: 1001, login: 'bee', issues: [25] });
  assert.equal(r.repository, REPO);
  assert.equal(r.results[0].status, 'awarded');
  assert.equal(await count(`select 1 from public.ledger_entries where source_id = 'LightningEg/Lightning#25'`), 1);
});

await test('an author without a linked account gets a pending award, settled once when GitHub is linked', async () => {
  const r = await merge({ pr: 130, gh: 3001, login: 'newbie', issues: [21], title: 'Pending work', at: '2026-09-20T08:30:00Z' });
  assert.equal(r.results[0].status, 'pending');
  const p = await one(`select * from public.pending_awards where github_id = 3001`);
  assert.deepEqual([p.amount, p.source_id, p.pr_number, p.issue_number, p.github_login, p.settled_at], [40, 'LightningEg/Lightning#21', 130, 21, 'newbie', null]);
  assert.equal(await count(`select 1 from public.ledger_entries where source_id = 'LightningEg/Lightning#21'`), 0);
  assert.equal((await one(`select status from public.reward_offers where issue_number = 21`)).status, 'closed');
  // Replays and another pull request for the same issue add nothing.
  assert.equal((await merge({ pr: 130, gh: 3001, issues: [21] })).results[0].status, 'already_pending');
  assert.equal((await merge({ pr: 131, gh: 1001, issues: [21] })).results[0].status, 'already_pending');
  assert.equal(await count(`select 1 from public.pending_awards`), 1);

  // The author creates an account and links GitHub.
  const F = '00000000-0000-4000-8000-00000000000f';
  await q(`insert into auth.users (id, email) values ($1, 'f@example.test')`, [F]);
  await identity(F, 3001, 'newbie');
  assert.deepEqual(await wallet(F), { balance: 40, contribution_score: 40 });
  const e = await one(`select * from public.ledger_entries where user_id = $1`, [F]);
  assert.equal(e.kind, 'contribution_award');
  assert.equal(new Date(e.earned_at).toISOString(), '2026-09-20T08:30:00.000Z', 'earned when it was merged, not when linked');
  const ct = await one(`select * from public.contributions where user_id = $1`, [F]);
  assert.deepEqual([ct.pr_number, ct.issue_number, ct.title], [130, 21, 'Pending work']);
  const settled = await one(`select settled_at is not null as done, user_id, ledger_entry_id from public.pending_awards where github_id = 3001`);
  assert.equal(settled.done, true);
  assert.equal(settled.user_id, F);
  assert.equal(settled.ledger_entry_id, e.id);
  // Settling again (sync, unlink and link again) pays nothing more.
  await as('authenticated', F, () => q(`select public.sync_github_link()`));
  await q(`delete from auth.identities where user_id = $1`, [F]);
  await identity(F, 3001, 'newbie');
  await as('authenticated', F, () => q(`select public.sync_github_link()`));
  assert.deepEqual(await wallet(F), { balance: 40, contribution_score: 40 });
  assert.equal(await count(`select 1 from public.ledger_entries where user_id = '${F}'`), 1);
  // Cleanup so that the later tests have a fresh F.
  await q(`delete from auth.identities where user_id = $1`, [F]);
});

await test('a pending award can be settled through the sync fallback when the trigger was off', async () => {
  await publish(26, 35, 'Pending via sync.');
  await merge({ pr: 140, gh: 3002, login: 'syncer', issues: [26] });
  const G = '00000000-0000-4000-8000-000000000010';
  await q(`insert into auth.users (id, email) values ($1, 'g@example.test')`, [G]);
  await q(`alter table auth.identities disable trigger on_auth_github_identity_changed`);
  await identity(G, 3002, 'syncer');
  await q(`alter table auth.identities enable trigger on_auth_github_identity_changed`);
  assert.deepEqual(await wallet(G), { balance: 0, contribution_score: 0 });
  await as('authenticated', G, () => q(`select public.sync_github_link()`));
  assert.deepEqual(await wallet(G), { balance: 35, contribution_score: 35 });
  await as('authenticated', G, () => q(`select public.sync_github_link()`));
  assert.deepEqual(await wallet(G), { balance: 35, contribution_score: 35 });
});

await test('if settling a pending award fails, the GitHub link still stands and a later sync settles it', async () => {
  const H = '00000000-0000-4000-8000-000000000011';
  await q(`insert into auth.users (id, email) values ($1, 'h@example.test')`, [H]);
  await q(`insert into public.pending_awards (github_id, github_login, repository, issue_number, pr_number, pr_title, pr_url, amount, source_id, merged_at)
           values (3003, 'boom', $1, 901, 901, 'Boom', 'https://github.com/x/y/pull/901', 7, 'LightningEg/Lightning#901', now())`, [REPO]);
  await db.exec(`create function public.test_boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
           create trigger test_boom before insert on public.ledger_entries
             for each row when (new.source_id = 'LightningEg/Lightning#901') execute function public.test_boom()`);
  await identity(H, 3003, 'boom');
  assert.deepEqual(await activeLink(H), { github_id: 3003, github_login: 'boom' }, 'linking must not fail');
  assert.equal((await one(`select settled_at from public.pending_awards where github_id = 3003`)).settled_at, null);
  assert.deepEqual(await wallet(H), { balance: 0, contribution_score: 0 });
  await as('authenticated', H, () => assert.rejects(q(`select public.sync_github_link()`), /boom/));
  await db.exec(`drop trigger test_boom on public.ledger_entries; drop function public.test_boom()`);
  await as('authenticated', H, () => q(`select public.sync_github_link()`));
  assert.deepEqual(await wallet(H), { balance: 7, contribution_score: 7 });
});

await test('a zero-coin task pays nothing, writes no ledger row and closes the offer', async () => {
  const before = await count(`select 1 from public.ledger_entries`);
  const r = await merge({ pr: 150, gh: 1001, login: 'bee', issues: [11] });
  assert.equal(r.results[0].status, 'zero_reward');
  assert.equal(await count(`select 1 from public.ledger_entries`), before);
  assert.equal(await count(`select 1 from public.pending_awards where issue_number = 11`), 0);
  assert.equal((await one(`select status from public.reward_offers where issue_number = 11`)).status, 'closed');
});

await test('other repositories, unknown issues and bad input pay nothing', async () => {
  const before = await count(`select 1 from public.ledger_entries`);
  const r = await merge({ repo: 'LightningEg/Lightning_market', pr: 160, gh: 1001, issues: [10] });
  assert.equal(r.status, 'ineligible_repository');
  assert.equal((await merge({ repo: 'Someone/Else', pr: 161, gh: 1001, issues: [10] })).status, 'ineligible_repository');
  assert.equal((await merge({ pr: 162, gh: 1001, issues: [4040] })).results[0].status, 'no_offer');
  assert.equal((await merge({ pr: 163, gh: 1001, issues: [] })).results.length, 0);
  await assert.rejects(merge({ pr: 164, gh: null, issues: [10] }), /author github id required/);
  await assert.rejects(merge({ pr: 0, gh: 1001, issues: [10] }), /pull request number required/);
  await assert.rejects(merge({ pr: 165, gh: 1001, issues: [10], url: 'http://insecure.test/x' }), /https/);
  assert.equal(await count(`select 1 from public.ledger_entries`), before);
  assert.equal((await one(`select status from public.reward_offers where issue_number = 10`)).status, 'open');
});

await test('rewards_start_at: merges before the start date earn nothing, later ones do', async () => {
  await q(`update public.repositories set rewards_start_at = '2026-10-01T00:00:00Z' where full_name = 'LightningEg/Lightning'`);
  const early = await merge({ pr: 170, gh: 1001, login: 'bee', issues: [30], at: '2026-09-30T23:59:59Z' });
  assert.equal(early.status, 'before_rewards_start');
  assert.equal(await count(`select 1 from public.ledger_entries where source_id = 'LightningEg/Lightning#30'`), 0);
  assert.equal((await one(`select status from public.reward_offers where issue_number = 30`)).status, 'open');
  const late = await merge({ pr: 171, gh: 1001, login: 'bee', issues: [31], at: '2026-10-01T00:00:00Z' });
  assert.equal(late.results[0].status, 'awarded');
  await q(`update public.repositories set rewards_start_at = null where full_name = 'LightningEg/Lightning'`);
  assert.equal((await merge({ pr: 170, gh: 1001, login: 'bee', issues: [30], at: '2026-09-30T23:59:59Z' })).results[0].status, 'awarded');
});

await test('a closed offer pays nothing; closing for an owner merge expires claims and pays nothing', async () => {
  assert.equal((await claim(22, 2050, 'tester')).status, 'claimed');
  const r = await as('service_role', null, async () => (await one(`select public.close_rewarded_issues($1, 180, '{22, 22, 555}') r`, [REPO])).r);
  assert.deepEqual(r.closed, [22]);
  assert.equal((await one(`select status from public.reward_offers where issue_number = 22`)).status, 'closed');
  assert.equal((await one(`select status from public.reward_claims where github_id = 2050`)).status, 'expired');
  assert.equal((await merge({ pr: 181, gh: 1001, issues: [22] })).results[0].status, 'closed');
  assert.equal(await count(`select 1 from public.ledger_entries where source_id = 'LightningEg/Lightning#22'`), 0);
  assert.equal(await count(`select 1 from public.pending_awards where issue_number = 22`), 0);
});

await test('a claim by someone else is expired, and the author is still paid, when another person merges', async () => {
  await publish(27, 45, 'Not the claimant.');
  await claim(27, 2060, 'claimant');
  const r = await merge({ pr: 190, gh: 1002, login: 'cee', issues: [27] });
  assert.equal(r.results[0].status, 'awarded');
  assert.equal(r.results[0].amount, 45);
  assert.equal((await one(`select status from public.reward_claims where github_id = 2060`)).status, 'expired');
});

await test('awards are audited without personal details', async () => {
  const rows = (await q(`select action, detail from public.audit_log where action in ('reward.award', 'reward.pending', 'reward.settle', 'reward.skip')`)).rows;
  const kinds = new Set(rows.map(r => r.action));
  for (const k of ['reward.award', 'reward.pending', 'reward.settle', 'reward.skip']) assert.ok(kinds.has(k), k);
  assert.ok(rows.every(r => !/github_login|email|login/.test(JSON.stringify(r.detail))));
});

// ------------------------------------------------------------ privileges

await test('only the service role can claim, release, award or close; members, anonymous and the admin cannot', async () => {
  const calls = [
    `select public.record_claim('${REPO}', 10, 5, 'x')`,
    `select public.release_claim('${REPO}', 10, 5)`,
    `select public.award_merge('${REPO}', 1, 't', 'https://x.test/1', now(), 5, 'x', '{10}')`,
    `select public.close_rewarded_issues('${REPO}', 1, '{10}')`
  ];
  for (const [role, uid] of [['anon', null], ['authenticated', B], ['authenticated', ADMIN]]) {
    for (const sql of calls) await as(role, uid, () => assert.rejects(q(sql), /permission denied/, `${role} ${sql}`));
  }
  await as('authenticated', B, async () => {
    await assert.rejects(q(`select * from public.pending_awards`), /permission denied/);
    await assert.rejects(q(`insert into public.pending_awards (github_id, github_login, repository, issue_number, pr_number, pr_title, pr_url, amount, source_id, merged_at)
      values (1, 'x', 'a/b', 1, 1, 't', 'https://x.test', 5, 'a/b#1', now())`), /permission denied/);
  });
  // Pending awards are server data: a member cannot read them even through a policy.
  await as('anon', null, async () => assert.rejects(q(`select * from public.pending_awards`), /permission denied/));
});

await test('a member cannot mint coins by calling award_coins or editing claims', async () => {
  await as('authenticated', B, async () => {
    await assert.rejects(q(`select * from public.award_coins($1, 'contribution_award', 5, 'issue', 'x#1', 'forged')`, [B]), /permission denied/);
    await assert.rejects(q(`update public.reward_claims set amount_locked = 9999`), /permission denied/);
    await assert.rejects(q(`insert into public.reward_claims (offer_id, offer_version, user_id, amount_locked) values (1, 1, $1, 5)`, [B]), /permission denied/);
  });
});

// ------------------------------------------------------------ feedback

await test('feedback: members submit their own, see only their own, and cannot write the table', async () => {
  const r = await as('authenticated', B, () => one(`select public.submit_feedback('  The chart is unclear.  ', 'budget page') r`));
  assert.equal(r.r.status, 'pending');
  await as('authenticated', C, () => q(`select public.submit_feedback('From C', null)`));
  await as('authenticated', B, async () => {
    const rows = (await q(`select id, body, context, status, amount, note, created_at, reviewed_at from public.feedback_submissions`)).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].body, 'The chart is unclear.');
    assert.equal(rows[0].context, 'budget page');
    await assert.rejects(q(`select reviewed_by from public.feedback_submissions`), /permission denied/);
    await assert.rejects(q(`insert into public.feedback_submissions (user_id, body) values ($1, 'direct')`, [B]), /permission denied/);
    await assert.rejects(q(`update public.feedback_submissions set status = 'accepted', amount = 500`), /permission denied/);
    await assert.rejects(q(`delete from public.feedback_submissions`), /permission denied/);
  });
  await as('anon', null, async () => {
    await assert.rejects(q(`select public.submit_feedback('anon')`), /permission denied/);
    await assert.rejects(q(`select id from public.feedback_submissions`), /permission denied/);
  });
});

await test('feedback: empty, too long and bad context are refused', async () => {
  await as('authenticated', D, async () => {
    await assert.rejects(q(`select public.submit_feedback('   ')`), /1 to 4000/);
    await assert.rejects(q(`select public.submit_feedback($1)`, ['x'.repeat(4001)]), /1 to 4000/);
    await assert.rejects(q(`select public.submit_feedback('ok', $1)`, ['c'.repeat(201)]), /context/);
    await q(`select public.submit_feedback($1, $2)`, ['x'.repeat(4000), 'c'.repeat(200)]);
  });
});

await test('feedback: at most 5 per member per day; other members are not affected', async () => {
  await as('authenticated', E, async () => {
    for (let i = 1; i <= 5; i++) await q(`select public.submit_feedback($1)`, ['message ' + i]);
    await assert.rejects(q(`select public.submit_feedback('message 6')`), /at most 5 feedback messages per day/);
  });
  await as('authenticated', C, () => q(`select public.submit_feedback('C is fine')`));
  // Older than a day does not count.
  await q(`update public.feedback_submissions set created_at = now() - interval '25 hours' where user_id = $1 and body = 'message 1'`, [E]);
  await as('authenticated', E, () => q(`select public.submit_feedback('message 7')`));
});

await test('feedback award: accepted with coins posts one feedback_award; repeats and changes cannot pay again', async () => {
  const id = (await one(`select id from public.feedback_submissions where user_id = $1`, [B])).id;
  const before = await wallet(B);
  const a = await as('authenticated', ADMIN, () => one(`select public.admin_review_feedback($1, 'accepted', 25, 'Thank you, fixed in 0.6.') r`, [id]));
  assert.equal(a.r.status, 'accepted');
  assert.equal(a.r.amount, 25);
  assert.ok(a.r.ledger_entry_id);
  assert.equal((await wallet(B)).balance, before.balance + 25);
  assert.equal((await wallet(B)).contribution_score, before.contribution_score + 25);
  const e = await one(`select kind, source_type, source_id, wallet_delta from public.ledger_entries where id = $1`, [a.r.ledger_entry_id]);
  assert.deepEqual(e, { kind: 'feedback_award', source_type: 'feedback', source_id: String(id), wallet_delta: 25 });
  // Same decision again: nothing new.
  const again = await as('authenticated', ADMIN, () => one(`select public.admin_review_feedback($1, 'accepted', 25, 'Thank you, fixed in 0.6.') r`, [id]));
  assert.equal(again.r.ledger_entry_id, a.r.ledger_entry_id);
  assert.equal((await wallet(B)).balance, before.balance + 25);
  assert.equal(await count(`select 1 from public.ledger_entries where kind = 'feedback_award' and source_id = '${id}'`), 1);
  assert.equal(await count(`select 1 from public.audit_log where action = 'feedback.review' and target_id = '${id}'`), 1);
  // A different decision after paying is refused.
  await as('authenticated', ADMIN, async () => {
    await assert.rejects(q(`select public.admin_review_feedback($1, 'accepted', 100, null)`, [id]), /already awarded/);
    await assert.rejects(q(`select public.admin_review_feedback($1, 'rejected', 0, null)`, [id]), /already awarded/);
  });
  // The member sees the decision and the note, and still not the reviewer.
  await as('authenticated', B, async () => {
    const m = (await q(`select status, amount, note from public.feedback_submissions where id = $1`, [id])).rows[0];
    assert.deepEqual(m, { status: 'accepted', amount: 25, note: 'Thank you, fixed in 0.6.' });
  });
});

await test('feedback review: reject and duplicate pay nothing; a rejection can later become an accepted award once', async () => {
  const c = (await one(`select id from public.feedback_submissions where user_id = $1 order by id limit 1`, [C])).id;
  const before = await wallet(C);
  const rej = await as('authenticated', ADMIN, () => one(`select public.admin_review_feedback($1, 'rejected', 500, 'Not actionable.') r`, [c]));
  assert.equal(rej.r.amount, 0, 'coins are ignored for a rejection');
  assert.equal(rej.r.ledger_entry_id, null);
  assert.deepEqual(await wallet(C), before);
  const dup = await as('authenticated', ADMIN, () => one(`select public.admin_review_feedback($1, 'duplicate', 0, 'Same as #4.') r`, [c]));
  assert.equal(dup.r.status, 'duplicate');
  const acc = await as('authenticated', ADMIN, () => one(`select public.admin_review_feedback($1, 'accepted', 10, null) r`, [c]));
  assert.equal(acc.r.amount, 10);
  assert.equal((await wallet(C)).balance, before.balance + 10);
  // Accepted with zero coins is a thank-you with no award.
  const z = (await one(`select id from public.feedback_submissions where user_id = $1 and body = 'C is fine'`, [C])).id;
  const zr = await as('authenticated', ADMIN, () => one(`select public.admin_review_feedback($1, 'accepted', 0, 'Thanks.') r`, [z]));
  assert.equal(zr.r.ledger_entry_id, null);
  assert.equal((await wallet(C)).balance, before.balance + 10);
});

await test('feedback review validates its input', async () => {
  const id = (await one(`select id from public.feedback_submissions where user_id = $1 limit 1`, [D])).id;
  await as('authenticated', ADMIN, async () => {
    await assert.rejects(q(`select public.admin_review_feedback($1, 'pending', 0, null)`, [id]), /status must be/);
    await assert.rejects(q(`select public.admin_review_feedback($1, 'accepted', -5, null)`, [id]), /between 0 and 10000/);
    await assert.rejects(q(`select public.admin_review_feedback($1, 'accepted', 10001, null)`, [id]), /between 0 and 10000/);
    await assert.rejects(q(`select public.admin_review_feedback($1, 'accepted', 5, $2)`, [id, 'n'.repeat(501)]), /note/);
    await assert.rejects(q(`select public.admin_review_feedback(999999, 'accepted', 5, null)`), /not found/);
  });
  assert.equal((await one(`select status from public.feedback_submissions where id = $1`, [id])).status, 'pending');
});

// ------------------------------------------------------------ admin only

await test('admin helpers refuse members with 42501 and anonymous callers outright', async () => {
  const calls = [
    `select * from public.admin_review_feedback(1, 'accepted', 5, null)`,
    `select * from public.admin_task_overview()`,
    `select * from public.admin_pending_awards()`,
    `select * from public.admin_feedback_queue()`,
    `select public.admin_set_offer_status(1, 'closed')`
  ];
  for (const sql of calls) {
    await as('authenticated', B, async () => {
      await assert.rejects(q(sql), e => e.code === '42501' && /administrator/.test(e.message), sql);
    });
    await as('anon', null, () => assert.rejects(q(sql), /permission denied/, sql));
  }
});

await test('admin queue, overview and pending list show what the owner needs', async () => {
  await as('authenticated', ADMIN, async () => {
    const queue = (await q(`select * from public.admin_feedback_queue('pending')`)).rows;
    assert.ok(queue.length >= 1);
    assert.ok(queue.every(r => r.status === 'pending' && /^geek-/.test(r.display_name)));
    assert.equal((await q(`select * from public.admin_feedback_queue('all')`)).rows.length > queue.length, true);
    await assert.rejects(q(`select * from public.admin_feedback_queue('nope')`), /status must be/);
    const ov = (await q(`select * from public.admin_task_overview()`)).rows;
    const by = n => ov.find(r => r.issue_number === n);
    assert.equal(by(20).award, 'paid');
    assert.equal(by(20).award_amount, 60);
    assert.equal(by(20).status, 'closed');
    assert.equal(by(21).award, 'paid', 'settled when its author linked');
    assert.equal(by(21).award_amount, 40);
    assert.equal(by(40).status, 'open');
    assert.equal(by(40).award, null);
    assert.equal(by(12).version, 2);
    assert.equal(by(12).claim_status, 'completed');
    assert.equal(by(12).claim_login, 'bee');
    assert.equal(ov[0].status, 'open', 'open offers first');
    // 3002 was settled, 3001 was settled; make one fresh pending to list.
  });
  await publish(41, 12, 'Pending list.');
  await merge({ pr: 300, gh: 4001, login: 'ghost', issues: [41], title: 'Ghost work' });
  await as('authenticated', ADMIN, async () => {
    const p = (await q(`select * from public.admin_pending_awards()`)).rows;
    assert.deepEqual(p.map(r => [r.github_login, r.amount, r.pr_number, r.issue_number]), [['ghost', 12, 300, 41]]);
  });
});

await test('the owner can close an offer nobody will merge, and reopen it; each change is audited once', async () => {
  const off = (await one(`select id from public.reward_offers where issue_number = 40`)).id;
  await claim(40, 5001, 'stuck');
  await as('authenticated', ADMIN, async () => {
    await q(`select public.admin_set_offer_status($1, 'closed')`, [off]);
    await q(`select public.admin_set_offer_status($1, 'closed')`, [off]);
    assert.equal((await q(`select issue_number from public.task_board() where issue_number = 40`)).rows.length, 0);
    await assert.rejects(q(`select public.admin_set_offer_status($1, 'archived')`, [off]), /open or closed/);
    await assert.rejects(q(`select public.admin_set_offer_status(424242, 'open')`), /not found/);
    await q(`select public.admin_set_offer_status($1, 'open')`, [off]);
    assert.equal((await q(`select issue_number from public.task_board() where issue_number = 40`)).rows.length, 1);
  });
  assert.equal((await one(`select status from public.reward_claims where github_id = 5001`)).status, 'expired');
  assert.equal(await count(`select 1 from public.audit_log where action = 'reward.offer_status' and target_id = '${off}'`), 2);
});

// ------------------------------------------------------------ task board

await test('task_board lists open paid tasks, says taken or yours, and never names the claimant', async () => {
  await publish(50, 70, 'Board criteria text.', 'Board title');
  await claim(50, 1001, 'bee');                 // B (linked)
  const cols = ['repository', 'issue_number', 'title', 'amount', 'acceptance_criteria', 'version', 'claimed', 'mine', 'locked_amount'];
  const asC = await as('authenticated', C, () => q(`select * from public.task_board()`));
  assert.deepEqual(asC.fields.map(f => f.name), cols);
  const row = asC.rows.find(r => r.issue_number === 50);
  assert.deepEqual(row, { repository: REPO, issue_number: 50, title: 'Board title', amount: 70, acceptance_criteria: 'Board criteria text.',
    version: 1, claimed: true, mine: false, locked_amount: null });
  assert.ok(!JSON.stringify(asC.rows).includes('bee'), 'the claimant login must not appear');
  assert.ok(!JSON.stringify(asC.rows).includes('1001'));
  const asB = await as('authenticated', B, () => q(`select * from public.task_board() where issue_number = 50`));
  assert.deepEqual([asB.rows[0].claimed, asB.rows[0].mine, asB.rows[0].locked_amount], [true, true, 70]);
  // A member without a linked GitHub account never sees a claim as theirs.
  const asE = await as('authenticated', E, () => q(`select * from public.task_board() where issue_number = 50`));
  assert.deepEqual([asE.rows[0].claimed, asE.rows[0].mine], [true, false]);
  // Closed offers and zero-coin tasks are not on the board; an unclaimed one reads claimed = false.
  const all = (await as('authenticated', C, () => q(`select issue_number, claimed from public.task_board()`))).rows;
  assert.ok(!all.some(r => r.issue_number === 20 || r.issue_number === 11));
  await publish(51, 5, 'Free task.');
  const free = (await as('authenticated', C, () => q(`select claimed from public.task_board() where issue_number = 51`))).rows[0];
  assert.equal(free.claimed, false);
  await as('anon', null, () => assert.rejects(q(`select * from public.task_board()`), /permission denied/));
});

await test('releasing a claim shows the task as open again on the board', async () => {
  await release(50, 1001);
  const r = (await as('authenticated', B, () => q(`select claimed, mine from public.task_board() where issue_number = 50`))).rows[0];
  assert.deepEqual(r, { claimed: false, mine: false });
});

// ------------------------------------------------------------ account deletion

await test('deleting an account removes its GitHub link and feedback, keeps anonymized ledger history', async () => {
  const before = await count(`select 1 from public.ledger_entries where user_id = '${B}'`);
  assert.ok(before >= 3);
  await q(`delete from auth.users where id = $1`, [B]);
  assert.equal(await count(`select 1 from public.github_links where user_id = '${B}'`), 0);
  assert.equal(await count(`select 1 from public.feedback_submissions where user_id = '${B}'`), 0);
  assert.equal(await count(`select 1 from public.reward_claims where user_id = '${B}'`), 0);
  assert.ok(await count(`select 1 from public.ledger_entries where user_id is null`) >= before);
  // The freed GitHub id can be linked by someone else.
  await identity(E, 1001, 'bee');
  assert.deepEqual(await activeLink(E), { github_id: 1001, github_login: 'bee' });
});

await test('the website repository pays like the app repository: offer, merge, one award per issue', async () => {
  const WEB = 'LightningEg/Lightning_website';
  assert.deepEqual((await q(`select full_name from public.repositories where eligible order by full_name`)).rows.map(r => r.full_name), [REPO, WEB], 'the website is eligible, a third repository is not');
  const F = '00000000-0000-4000-8000-0000000000f2';
  await q(`insert into auth.users (id, email) values ($1, 'f@example.test')`, [F]);
  await identity(F, 7007, 'webdev');
  await as('authenticated', ADMIN, () => one(`select * from public.publish_reward($1, $2, $3, $4, $5)`, [WEB, 41, 120, 'Done when the page is fixed.', 'Fix the footer link']));
  const paid = await merge({ repo: WEB, pr: 77, gh: 7007, login: 'webdev', issues: [41] });
  assert.ok(paid, 'the merge is answered');
  assert.equal((await wallet(F)).balance, 120, 'the author is paid the offer');
  await merge({ repo: WEB, pr: 78, gh: 7007, login: 'webdev', issues: [41] });
  assert.equal((await wallet(F)).balance, 120, 'a second pull request for the same issue pays nothing more');
  // a repository that is not listed is still refused
  assert.equal((await merge({ repo: 'SomeoneElse/Other', pr: 1, gh: 7007, login: 'webdev', issues: [1] })).status, 'ineligible_repository');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
