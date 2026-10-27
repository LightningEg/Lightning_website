// One form for a story (8R, supabase/migrations/20261027200000_share_story.sql): paste the post link, one line, consent;
// the code first; one-press approval at the owner's ladder; ask for a change; the public strip. Isolated Postgres.
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
const LINE = 'I put every salary into envelopes and check them each Friday.';
let post = 0;
const li = () => `https://www.linkedin.com/posts/story-${++post}-${Math.random().toString(36).slice(2, 8)}`;
const share = (u, url, line = LINE, consent = true, id = null) => as('authenticated', u, async () => (await q(`select * from public.share_story($1,$2,$3,$4)`, [url, line, consent, id])).rows[0]);
const kit = u => as('authenticated', u, async () => (await q(`select public.story_kit() k`)).rows[0].k);
const wallet = async u => (await q(`select balance, contribution_score from public.wallets where user_id = $1`, [u])).rows[0];
const feed = (p = {}) => as('anon', null, async () => (await q(`select * from public.stories_feed($1,$2)`, [p.id ?? null, p.author ?? null])).rows);
const approve = (id, note = null) => as('authenticated', ADMIN, async () => (await q(`select * from public.admin_approve_story($1,(select submission_revision from public.community_stories where id=$1),$2)`, [id, note])).rows[0]);

await test('the code and the link exist before the first story, and stay the same', async () => {
  const U = await newUser('Coder');
  const a = await kit(U), b = await kit(U);
  assert.match(a.code, /^[0-9a-f]{8}$/);
  assert.deepEqual(plain(a), plain(b));
  assert.equal(a.link, 'https://lightningeg.com/');
  assert.ok(a.text.includes('Lightning verification: ' + a.code) && a.text.includes('https://lightningeg.com/'));
  assert.notEqual((await kit(await newUser('Other'))).code, a.code, 'one code per member');
  await as('anon', null, () => assert.rejects(q(`select public.story_kit()`), /permission denied/));
});

await test('one form: a LinkedIn or Reddit link, one line and consent make a pending story carrying the member\'s code', async () => {
  const U = await newUser('Sharer');
  const code = (await kit(U)).code;
  const r = await share(U, li() + '?utm=x#frag');
  assert.equal(r.status, 'pending');
  assert.equal(r.verify_code, code, 'the code shown before is the code on the story');
  assert.equal(r.body, LINE);
  assert.match(r.title, /Sharer/);
  assert.ok(r.consent_at && r.rules_version === 'community-v1');
  assert.ok(!r.linkedin_url.includes('?') && !r.linkedin_url.includes('#'), 'tracking is cut');
  const rd = await share(U, 'https://old.reddit.com/r/Egypt/comments/abc123/my_habit/?utm=1');
  assert.equal(rd.reddit_url, 'https://www.reddit.com/r/Egypt/comments/abc123/my_habit');
  assert.equal(rd.verify_code, code);
  assert.deepEqual(plain(await wallet(U)), { balance: 0, contribution_score: 0 }, 'sharing alone pays nothing');
});

await test('refused: other sites, plain http, scripts, a short line, no consent, a private profile, a second pending copy', async () => {
  const U = await newUser('Refused');
  for (const bad of ['https://evil.example/posts/1', 'http://www.linkedin.com/posts/x', 'javascript:alert(1)', 'https://www.linkedin.com/in/someone', 'https://www.reddit.com/user/x', '', null, 'https://linkedin.com.evil.example/posts/1'])
    await assert.rejects(share(U, bad), /LinkedIn or Reddit/);
  await assert.rejects(share(U, li(), 'too short'), /20 to 400/);
  await assert.rejects(share(U, li(), 'x'.repeat(401)), /20 to 400/);
  await assert.rejects(share(U, li(), LINE, false), /tick the box/);
  await as('authenticated', U, () => q(`update public.member_profiles set visibility='private', show_on_leaderboard=false where user_id=$1`, [U]));
  await assert.rejects(share(U, li()), /public adult/);
  await as('authenticated', U, () => q(`update public.member_profiles set visibility='public' where user_id=$1`, [U]));
  const url = li();
  const a = await share(U, url), b = await share(U, url + '?again=1');
  assert.equal(a.id, b.id, 'the same post twice is one story');
  assert.equal((await q(`select count(*)::int c from public.community_stories where user_id=$1`, [U])).rows[0].c, 1);
  await as('anon', null, () => assert.rejects(q(`select * from public.share_story('https://www.linkedin.com/posts/x', $1, true)`, [LINE]), /permission denied/));
});

await test('the owner approves with one press at the default ladder: 100 coins and 50 points, once', async () => {
  const U = await newUser('Paid');
  const s = await share(U, li());
  assert.deepEqual(plain(await as('authenticated', ADMIN, async () => (await q(`select public.admin_story_ladder() l`)).rows[0].l)), { coins: 100, points: 50 });
  const done = await approve(s.id);
  assert.deepEqual([done.status, done.awarded_coins, done.awarded_points], ['published', 100, 50]);
  assert.deepEqual(plain(await wallet(U)), { balance: 100, contribution_score: 50 });
  await approve(s.id);
  assert.deepEqual(plain(await wallet(U)), { balance: 100, contribution_score: 50 }, 'pressing again pays nothing more');
  const out = await feed({ author: 'Paid' });
  assert.equal(out.length, 1);
  assert.equal(out[0].summary, LINE);
  assert.equal(out[0].rewarded, true);
});

await test('only an MFA administrator approves, sets the ladder or sends a story back', async () => {
  const U = await newUser('Guarded'), V = await newUser('Member');
  const s = await share(U, li());
  await as('authenticated', V, () => assert.rejects(q(`select * from public.admin_approve_story($1, 0)`, [s.id]), /MFA administrator/));
  await as('authenticated', V, () => assert.rejects(q(`select public.admin_set_story_ladder(500, 500)`), /MFA administrator/));
  await as('authenticated', V, () => assert.rejects(q(`select public.admin_request_story_change($1, 'Please change it')`, [s.id]), /MFA administrator/));
  await q(`select set_config('request.jwt.claims','{"aal":"aal1"}',false)`);
  await as('authenticated', ADMIN, () => assert.rejects(q(`select * from public.admin_approve_story($1, 0)`, [s.id]), /MFA administrator/));
  await q(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
  await as('anon', null, () => assert.rejects(q(`select public.admin_story_ladder()`), /permission denied/));
  assert.equal((await q(`select status from public.community_stories where id=$1`, [s.id])).rows[0].status, 'pending');
});

await test('the ladder is the owner\'s to set (0 to 500) and the next approval pays it', async () => {
  const U = await newUser('Ladder');
  const s = await share(U, li());
  await as('authenticated', ADMIN, () => assert.rejects(q(`select public.admin_set_story_ladder(501, 10)`), /0 to 500/));
  await as('authenticated', ADMIN, () => assert.rejects(q(`select public.admin_set_story_ladder(-1, 10)`), /0 to 500/));
  await as('authenticated', ADMIN, () => q(`select public.admin_set_story_ladder(250, 0)`));
  await approve(s.id);
  assert.deepEqual(plain(await wallet(U)), { balance: 250, contribution_score: 0 });
  assert.equal((await q(`select count(*)::int c from public.audit_log where action='story.ladder'`)).rows[0].c, 1);
  await as('authenticated', ADMIN, () => q(`select public.admin_set_story_ladder(100, 50)`));
});

await test('asking for a change sends the story back with the note; the member edits and shares again', async () => {
  const U = await newUser('Editor');
  const s = await share(U, li());
  await as('authenticated', ADMIN, () => assert.rejects(q(`select public.admin_request_story_change($1, 'no')`, [s.id]), /5 to 500/));
  const back = (await as('authenticated', ADMIN, () => q(`select * from public.admin_request_story_change($1, 'Please put your code in the post.')`, [s.id]))).rows[0];
  assert.deepEqual([back.status, back.review_note, back.consent_at], ['draft', 'Please put your code in the post.', null]);
  assert.equal((await feed()).filter(x => x.id === s.id).length, 0);
  assert.equal((await as('authenticated', U, async () => (await q(`select review_note from public.community_stories where id=$1`, [s.id])).rows[0])).review_note, 'Please put your code in the post.');
  const again = await share(U, li(), LINE + ' Now with my code.', true, s.id);
  assert.equal(again.id, s.id);
  assert.equal(again.status, 'pending');
  assert.equal(again.verify_code, (await kit(U)).code);
  await as('authenticated', ADMIN, () => assert.rejects(q(`select * from public.admin_request_story_change($1, 'Change something else')`, [(again.id === s.id ? '00000000-0000-4000-8000-0000000000ff' : s.id)]), /not found/));
  const V = await newUser('Intruder');
  await assert.rejects(share(V, li(), LINE, true, s.id), /cannot be edited/);
});

await test('declining ends it with a note and pays nothing; the three-in-30-days cap on story coins still holds', async () => {
  const U = await newUser('Declined');
  const s = await share(U, li());
  const no = (await as('authenticated', ADMIN, () => q(`select * from public.admin_moderate_story($1,false,0,0,'Not general money content',false,false,(select submission_revision from public.community_stories where id=$1),false)`, [s.id]))).rows[0];
  assert.equal(no.status, 'rejected');
  assert.deepEqual(plain(await wallet(U)), { balance: 0, contribution_score: 0 });
  const W = await newUser('Capped');
  for (let i = 0; i < 3; i++) await approve((await share(W, li())).id);
  assert.equal((await wallet(W)).balance, 300);
  const fourth = await share(W, li());
  await as('authenticated', ADMIN, () => assert.rejects(q(`select * from public.admin_approve_story($1,(select submission_revision from public.community_stories where id=$1))`, [fourth.id]), /3 stories in 30 days/));
  assert.equal((await wallet(W)).balance, 300);
});

await test('the public strip: only published stories of public, non-suspended members; no private fields', async () => {
  const A = await newUser('Showable'), B = await newUser('Hidden'), C = await newUser('Banned');
  const sa = await share(A, li()), sb = await share(B, li()), sc = await share(C, li());
  assert.equal((await feed()).filter(x => [sa.id, sb.id, sc.id].includes(x.id)).length, 0, 'pending stories are not shown');
  for (const s of [sa, sb, sc]) await approve(s.id);
  await as('authenticated', B, () => q(`update public.member_profiles set visibility='private', show_on_leaderboard=false where user_id=$1`, [B]));
  await q(`update public.member_profiles set suspended=true where user_id=$1`, [C]);
  const out = await feed();
  const names = out.map(x => x.author);
  assert.ok(names.includes('Showable') && !names.includes('Hidden') && !names.includes('Banned'));
  const row = out.find(x => x.author === 'Showable');
  assert.deepEqual(Object.keys(row).sort(), ['author', 'avatar_url', 'badge_item_id', 'frame_item_id', 'id', 'linkedin_url', 'published_at', 'reddit_url', 'rewarded', 'summary', 'title']);
  assert.equal((await feed({ author: 'showable' })).length, 1, 'by author, case-insensitive: the profile strip');
});

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exitCode = failed ? 1 : 0;
