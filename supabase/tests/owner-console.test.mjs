// The owner console (8S, supabase/migrations/20261027210000_owner_console_seats_and_community.sql): app unlocks per theme,
// extra profiles in the month's sales, merges held for unlinked accounts, the story ladder with its blog bonus. Isolated Postgres.
import assert from 'node:assert/strict';
import {setupStorage} from './helpers/storage.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const mod = process.env.PGLITE_PATH
  ? await import(pathToFileURL(process.env.PGLITE_PATH).href)
  : await import('@electric-sql/pglite');
const db = new mod.PGlite();

const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = uid(1), OTHER = uid(2);

// ---- stub the parts of Supabase the migrations depend on
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade, provider text not null, provider_id text not null, identity_data jsonb not null default '{}', created_at timestamptz not null default now(), unique (provider, provider_id));
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`);
await setupStorage(db);
for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  await db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
}

await db.exec(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);

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

let n = 100;
const newUser = async (name) => { const id = uid(++n); await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `u${n}@example.test`]);
  if (name) await q(`update public.member_profiles set display_name=$2 where user_id=$1`, [id, name]); return id; };
const ADMIN = await newUser('owner-admin');
await q(`insert into public.admin_roles(user_id, role) values ($1,'admin')`, [ADMIN]);
const plain = v => JSON.parse(JSON.stringify(v));
const rpcAs = (role, user, sql, params) => as(role, user, async () => (await q(sql, params)).rows[0]);
const asAdmin = (sql, params) => rpcAs('authenticated', ADMIN, sql, params);
let plainMember = null;
const denied = async (sql, params = []) => {
  const M = plainMember ??= await newUser('plain-member');
  await as('authenticated', M, () => assert.rejects(q(sql, params), /MFA administrator/));
  await as('anon', null, () => assert.rejects(q(sql, params), /permission denied/));
  await q(`select set_config('request.jwt.claims','{"aal":"aal1"}',false)`);
  await as('authenticated', ADMIN, () => assert.rejects(q(sql, params), /MFA administrator/));
  await q(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
};
let ref = 0;
const spend = (u, coins) => q(`select (private.post_ledger($1,'purchase',0,$2,'seat',$3,'primary','Seat','seat:'||$3,now(),null,null)).id id`, [u, -coins, 'SEATREF' + (++ref)]).then(r => ({ id: r.rows[0].id }));

// ---- fixtures: Nile's app unlock is on, Cotton's is not
await q(`update public.catalog_items set price = 300 where id = 'nile'`);
await q(`insert into public.bundled_item_versions (item_id, asset_version, enabled) values ('nile', 1, true), ('cotton', 1, false) on conflict (item_id, asset_version) do update set enabled = excluded.enabled`);
const A = await newUser('seat-a'), B = await newUser('seat-b'), C = await newUser('seat-c');
for (const u of [A, B]) await q(`insert into public.inventory (user_id, item_id) values ($1,'nile') on conflict do nothing`, [u]);
for (let i = 0; i < 4; i++) await q(`insert into private.activation_tickets (user_id, item_id, asset_version, code_hash, redeemed_at) values ($1,'nile',1,$2,$3)`, [A, 'h' + i, i < 3 ? new Date().toISOString() : null]);
await q(`insert into private.activation_tickets (user_id, item_id, asset_version, code_hash) values ($1,'nile',1,'h-other')`, [B]);
await q(`insert into public.profile_claims (user_id, item_id, profile_id) values ($1,'nile',gen_random_uuid()), ($1,'nile',gen_random_uuid()), ($2,'nile',gen_random_uuid())`, [A, B]);
await q(`insert into public.theme_seats (user_id, item_id, extra) values ($1,'nile',2)`, [A]);
await q(`select private.post_ledger($1,'paid_topup',0,500,'instapay','TOPUP-A-1','primary','Top-up','topup:TOPUP-A-1',now(),null,null)`, [A]);
const e1 = await spend(A, 75), e2 = await spend(A, 75);
await q(`insert into public.seat_purchases (user_id, item_id, price_paid, ledger_entry_id, idempotency_key) values ($1,'nile',75,$2,'seat-key-0001'), ($1,'nile',75,$3,'seat-key-0002')`, [A, e1.id, e2.id]);

await test('admin_app_unlocks: one row per theme whose unlock is on, with codes, claims, extra profiles and coins', async () => {
  const r = plain((await asAdmin(`select public.admin_app_unlocks() r`)).r);
  assert.deepEqual(r.map(x => x.item_id), ['nile'], 'Cotton is not on, so it has no row');
  assert.deepEqual(r[0], { item_id: 'nile', name: 'Nile', codes_issued: 5, codes_redeemed: 3, profiles_claimed: 3, extra_seats_sold: 2, extra_coins: 150, members_with_seats: 2 });
  await denied(`select public.admin_app_unlocks()`);
});

await test('admin_month_seat_sales: this month\'s extra profiles as a sales row; older ones are left out', async () => {
  const r = plain((await asAdmin(`select public.admin_month_seat_sales() r`)).r);
  assert.deepEqual(r, [{ id: 'seat:nile', name: 'Extra profile · Nile', type: 'seat', tier: null, sold: 2, coins: 150 }]);
  await q(`update public.seat_purchases set created_at = now() - interval '70 days' where idempotency_key = 'seat-key-0001'`);
  assert.equal(plain((await asAdmin(`select public.admin_month_seat_sales() r`)).r)[0].sold, 1);
  await q(`update public.seat_purchases set created_at = now() - interval '70 days'`);
  assert.deepEqual(plain((await asAdmin(`select public.admin_month_seat_sales() r`)).r), []);
  await denied(`select public.admin_month_seat_sales()`);
});

await test('admin_held_awards: points and coins waiting for an unlinked account, nothing already paid', async () => {
  assert.deepEqual(plain((await asAdmin(`select public.admin_held_awards() r`)).r), []);
  await as('service_role', null, () => q(`select public.record_merge('LightningEg/Lightning', 801, 'Fix rounding', 'https://github.com/LightningEg/Lightning/pull/801', '2026-10-20T10:00:00Z', 7001, 'newcomer', 120)`));
  await as('authenticated', ADMIN, () => q(`select * from public.publish_reward('LightningEg/Lightning', 802, 100, 'Done when the tests pass.', null)`));
  await as('service_role', null, () => q(`select public.award_merge('LightningEg/Lightning', 803, 'Fix 802', 'https://github.com/LightningEg/Lightning/pull/803', '2026-10-21T10:00:00Z', 7002, 'solver', '{802}'::int[])`));
  const r = plain((await asAdmin(`select public.admin_held_awards() r`)).r);
  assert.equal(r.length, 2);
  const pts = r.find(x => x.kind === 'points'), coins = r.find(x => x.kind === 'coins');
  assert.deepEqual([pts.github_login, pts.repository, pts.pr_number, pts.amount, pts.issue_number], ['newcomer', 'LightningEg/Lightning', 801, 50, null]);
  assert.deepEqual([coins.github_login, coins.pr_number, coins.amount, coins.issue_number], ['solver', 803, 100, 802]);
  assert.match(pts.merged_at, /2026-10-20/);
  assert.ok(!('user_id' in pts) && !('github_id' in pts));
  await q(`insert into auth.identities (user_id, provider, provider_id, identity_data) values ($1,'github','7001','{"user_name":"newcomer"}')`, [await newUser('linked-now')]);
  assert.equal(plain((await asAdmin(`select public.admin_held_awards() r`)).r).length, 1, 'once linked, the points are paid and leave the list');
  await denied(`select public.admin_held_awards()`);
});

await test('the ladder gains a blog bonus (default 100); the old two-argument call keeps it; limits are 0 to 500', async () => {
  assert.deepEqual(plain((await asAdmin(`select public.admin_story_ladder() l`)).l), { coins: 100, points: 50, blog_coins: 100 });
  assert.deepEqual(plain((await asAdmin(`select public.admin_set_story_ladder(120, 60) l`)).l), { coins: 120, points: 60, blog_coins: 100 });
  assert.deepEqual(plain((await asAdmin(`select public.admin_set_story_ladder(p_coins => 120, p_points => 60, p_blog_coins => 40) l`)).l), { coins: 120, points: 60, blog_coins: 40 });
  await as('authenticated', ADMIN, () => assert.rejects(q(`select public.admin_set_story_ladder(100, 50, 501)`), /0 to 500/));
  await as('authenticated', ADMIN, () => assert.rejects(q(`select public.admin_set_story_ladder(100, 50, -1)`), /0 to 500/));
  await asAdmin(`select public.admin_set_story_ladder(100, 50, 100) l`);
  await denied(`select public.admin_story_ladder()`);
  await denied(`select public.admin_set_story_ladder(1, 1, 1)`);
});

// ---- blog bonus
const LINE = 'I put every salary into envelopes and check them each Friday.';
let post = 0;
const share = (u) => as('authenticated', u, async () => (await q(`select * from public.share_story($1,$2,true,null)`, [`https://www.linkedin.com/posts/s-${++post}-${Math.random().toString(36).slice(2, 7)}`, LINE])).rows[0]);
const approve = id => as('authenticated', ADMIN, () => q(`select * from public.admin_approve_story($1,(select submission_revision from public.community_stories where id=$1))`, [id]));
const wallet = u => q(`select balance, contribution_score from public.wallets where user_id=$1`, [u]).then(r => plain(r.rows[0]));
const BLOG = 'https://lightningeg.com/blog-budget-20000-egp.html';
const bonus = (id, url = BLOG) => as('authenticated', ADMIN, async () => (await q(`select * from public.admin_story_blog_bonus($1,$2)`, [id, url])).rows[0]);

await test('blog bonus: pays the ladder\'s blog coins once to the author of a published story and records the link', async () => {
  const U = await newUser('Blogged');
  const s = await share(U);
  await approve(s.id);
  assert.deepEqual(await wallet(U), { balance: 100, contribution_score: 50 });
  const r = await bonus(s.id);
  assert.deepEqual([r.blog_url, r.blog_coins_paid], [BLOG, 100]);
  assert.ok(r.blog_paid_at);
  assert.deepEqual(await wallet(U), { balance: 200, contribution_score: 50 }, 'coins only: it never raises rank');
  const entry = (await q(`select kind, wallet_delta, contribution_delta, source_type, source_id from public.ledger_entries where user_id=$1 and source_type='story_blog'`, [U])).rows;
  assert.deepEqual(plain(entry), [{ kind: 'admin_gift', wallet_delta: 100, contribution_delta: 0, source_type: 'story_blog', source_id: s.id }]);
  assert.equal((await q(`select count(*)::int c from public.audit_log where action='story.blog_bonus' and target_id=$1`, [s.id])).rows[0].c, 1);
  // again, or with another link, pays nothing more
  await bonus(s.id); await bonus(s.id, 'https://lightningeg.com/guides.html');
  assert.deepEqual(await wallet(U), { balance: 200, contribution_score: 50 });
  assert.equal((await q(`select blog_url from public.community_stories where id=$1`, [s.id])).rows[0].blog_url, BLOG);
});

await test('blog bonus: refused for a story that is not published, a missing story, and an unsafe or foreign link', async () => {
  const U = await newUser('NotYet');
  const s = await share(U);
  await as('authenticated', ADMIN, () => assert.rejects(q(`select * from public.admin_story_blog_bonus($1,$2)`, [s.id, BLOG]), /only a published story/));
  await as('authenticated', ADMIN, () => assert.rejects(q(`select * from public.admin_story_blog_bonus('00000000-0000-4000-8000-0000000000ff',$1)`, [BLOG]), /story not found/));
  await approve(s.id);
  for (const bad of ['http://lightningeg.com/guides.html', 'https://evil.example/guides.html', 'https://lightningeg.com.evil.example/guides.html', 'javascript:alert(1)',
    'https://lightningeg.com/admin.html', 'https://lightningeg.com/guides.html?x=1', 'https://lightningeg.com/blog-a.html#x', '', null, 'https://lightningeg.com/marketplace.html'])
    await as('authenticated', ADMIN, () => assert.rejects(q(`select * from public.admin_story_blog_bonus($1,$2)`, [s.id, bad]), /blog post or guide/));
  assert.deepEqual(await wallet(U), { balance: 100, contribution_score: 50 }, 'nothing was paid');
  await as('authenticated', ADMIN, () => q(`select public.admin_set_story_ladder(100, 50, 0)`));
  const free = await bonus(s.id, 'https://lightningeg.com/ar/guides.html');
  assert.deepEqual([free.blog_url, free.blog_coins_paid], ['https://lightningeg.com/ar/guides.html', 0]);
  assert.deepEqual(await wallet(U), { balance: 100, contribution_score: 50 }, 'a zero bonus pays nothing and still counts as done');
  await as('authenticated', ADMIN, () => q(`select public.admin_set_story_ladder(100, 50, 100)`));
  await bonus(s.id, BLOG);
  assert.deepEqual(await wallet(U), { balance: 100, contribution_score: 50 }, 'once decided, a later ladder change does not pay it');
  await denied(`select * from public.admin_story_blog_bonus('00000000-0000-4000-8000-0000000000ff', 'https://lightningeg.com/guides.html')`);
});

await test('the bonus does not count toward the three story rewards in 30 days', async () => {
  const U = await newUser('Cap');
  const ids = [];
  for (let i = 0; i < 3; i++) { const s = await share(U); await approve(s.id); ids.push(s.id); await bonus(s.id, `https://lightningeg.com/blog-post-${i}.html`); }
  assert.equal((await wallet(U)).balance, 600);
  const s4 = await share(U);
  await as('authenticated', ADMIN, () => assert.rejects(q(`select * from public.admin_approve_story($1,(select submission_revision from public.community_stories where id=$1))`, [s4.id]), /3 stories in 30 days/));
});

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exitCode = failed ? 1 : 0;
