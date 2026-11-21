// Linking an app profile to a website account (20261121120000_link_app_profile.sql, app NF-10H6): a Play purchase reaches
// the buyer's website account through the profile id, inside the same cap of 5; a refund later takes it back out.
//
//   PGLITE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/link-profile.test.mjs

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const mod = process.env.PGLITE_PATH
  ? await import(pathToFileURL(process.env.PGLITE_PATH).href)
  : await import('@electric-sql/pglite');
const db = new mod.PGlite();

const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ---- stub the parts of Supabase the migrations depend on
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now(), last_sign_in_at timestamptz);
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade, provider text not null, provider_id text not null, identity_data jsonb not null default '{}', created_at timestamptz not null default now(), unique (provider, provider_id));
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`);
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
const newUser = async name => { const id = uid(++n); await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `u${n}@example.test`]);
  await q(`update public.member_profiles set display_name=$2, adult_confirmed=true where user_id=$1`, [id, name || 'member-' + n]); return id; };
let topups = 0;
const topUp = (user, coins) => q(`select private.post_ledger($1,'paid_topup',0,$2,'instapay',$3,'primary','Top-up','topup:'||$3,now(),null,null)`, [user, coins, 'T' + (++topups)]);
const rpc = (user, sql, params) => as('authenticated', user, async () => (await q(sql, params)).rows[0]);
const svc = (sql, params) => as('service_role', null, async () => (await q(sql, params)).rows[0]);
const owned = async (user, item = 'nile') => (await q(`select source from public.inventory where user_id=$1 and item_id=$2`, [user, item])).rows[0]?.source;
const claims = async (user, item = 'nile') => Number((await q(`select count(*) c from public.profile_claims where user_id=$1 and item_id=$2`, [user, item])).rows[0].c);
const key = () => 'key-' + Math.random().toString(36).slice(2, 12);

await q(`insert into public.bundled_item_versions(item_id,asset_version,enabled) values ('nile',1,true),('cotton',1,true) on conflict (item_id,asset_version) do update set enabled=excluded.enabled`);
const ITEMS = JSON.stringify([{item_id: 'nile', asset_version: 1}, {item_id: 'cotton', asset_version: 1}]);
const play = (token, profile, item = 'nile') => svc(`select public.redeem_play_purchase($1,'GPA.1',$2,$3,$4::jsonb) d`, [token, item, profile, ITEMS]).then(r => r.d);
const linkCode = u => rpc(u, `select public.issue_profile_link_code() d`).then(r => r.d);
const link = (code, profile) => svc(`select public.link_app_profile($1,$2) d`, [code, profile]).then(r => r.d);
const voidIt = token => svc(`select public.void_play_purchase($1)`, [token]);
const appCode = (u, item = 'nile') => rpc(u, `select public.issue_activation_code($1,1) d`, [item]).then(r => r.d);
const profile = i => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`;
const T1 = '1'.repeat(64), T2 = '2'.repeat(64), T3 = '3'.repeat(64);

const A = await newUser('play-buyer'), B = await newUser('someone-else');

await test('a link code is issued only to a member, in the activation-code shape, and only its hash is kept', async () => {
  const c = await linkCode(A);
  assert.match(c.code, /^[A-F0-9]{8}(-[A-F0-9]{8}){3}$/);
  await assert.rejects(as('anon', null, () => q(`select public.issue_profile_link_code()`)), /permission denied|sign in/);
  const cols = (await q(`select column_name from information_schema.columns where table_schema='private' and table_name='profile_link_tickets'`)).rows.map(r => r.column_name);
  assert.ok(cols.includes('code_hash') && !cols.includes('code'));
});

await test('a Play buyer links once: the theme is Owned through Play, claims that profile, and gives app codes (NF-10H6)', async () => {
  await play(T1, profile(1));
  assert.equal(await owned(A), undefined, 'nothing reaches the website before the link');
  const r = await link((await linkCode(A)).code, profile(1));
  assert.deepEqual(r, {linked: true, items: ['nile']});
  assert.equal(await owned(A), 'play');
  assert.equal(await claims(A), 1);
  const code = await appCode(A);
  assert.match(code.code, /^[A-F0-9]{8}(-[A-F0-9]{8}){3}$/, 'Get app code works for a theme owned through Play');
  const lic = await svc(`select public.redeem_activation_code($1,'nile',1,$2) d`, [code.code, profile(2)]).then(x => x.d);
  assert.equal(lic.profile_id, profile(2), 'a new PC-only profile is unlocked from the website');
  assert.equal(await claims(A), 2, 'inside the same cap');
});

await test('a link code works once and expires', async () => {
  const c = (await linkCode(A)).code;
  await link(c, profile(1));
  await assert.rejects(link(c, profile(1)), /invalid or expired link code/);
  const late = (await linkCode(A)).code;
  await q(`update private.profile_link_tickets set expires_at = now() - interval '1 second' where redeemed_at is null`);
  await assert.rejects(link(late, profile(1)), /invalid or expired link code/);
  await assert.rejects(link('nonsense', profile(1)), /invalid or expired link code/);
  await assert.rejects(link((await linkCode(A)).code, 'not-a-profile'), /which profile/);
});

await test('a profile another account linked or claimed is refused', async () => {
  await assert.rejects(link((await linkCode(B)).code, profile(1)), /belongs to another account/);
  await assert.rejects(link((await linkCode(B)).code, profile(2)), /belongs to another account/, 'claimed through a website code');
  assert.equal(await owned(B), undefined);
});

await test('a later Play purchase on a linked profile reaches the account by itself', async () => {
  await play(T2, profile(1), 'cotton');
  assert.equal(await owned(A, 'cotton'), 'play');
  assert.equal(await claims(A, 'cotton'), 1);
});

await test('a website purchase stays a website purchase when the same theme comes through Play', async () => {
  const W = await newUser('both'); await topUp(W, 5000);
  const price = Number((await q(`select price from public.catalog_items where id='nile'`)).rows[0].price);
  await rpc(W, `select * from public.purchase_item_at_price('nile',$1,$2)`, [price, key()]);
  await play(T3, profile(9));
  await link((await linkCode(W)).code, profile(9));
  assert.equal(await owned(W), 'website');
  await voidIt(T3);
  assert.equal(await owned(W), 'website', 'a Play refund never takes a website purchase');
  await assert.rejects(play(T3, profile(10)), /refunded/);
});

await test('the cap is shared: past 5 profiles the link still gives the theme but claims nothing more', async () => {
  const C = await newUser('capped'); await topUp(C, 5000);
  const price = Number((await q(`select price from public.catalog_items where id='nile'`)).rows[0].price);
  await rpc(C, `select * from public.purchase_item_at_price('nile',$1,$2)`, [price, key()]);
  for (let i = 20; i < 25; i++) await svc(`select public.redeem_activation_code($1,'nile',1,$2) d`, [(await appCode(C)).code, profile(i)]);
  const T4 = '4'.repeat(64);
  await play(T4, profile(30));
  await link((await linkCode(C)).code, profile(30));
  assert.equal(await claims(C), 5);
});

await test('a refund removes the Play theme from the account, and an unlinked refunded purchase links nothing', async () => {
  await q(`insert into public.equipped_items(user_id, slot, item_id) values ($1,'theme','nile') on conflict (user_id, slot) do update set item_id=excluded.item_id`, [A]);
  await voidIt(T1);
  assert.equal(await owned(A), undefined);
  assert.equal(Number((await q(`select count(*) c from public.equipped_items where user_id=$1 and item_id='nile'`, [A])).rows[0].c), 0, 'not worn any more');
  assert.equal(await owned(A, 'cotton'), 'play', 'the other purchase stays');
  await assert.rejects(play(T1, profile(3)), /refunded/, 'no new profile on a refunded purchase');
  const D = await newUser('late-linker'), T5 = '5'.repeat(64);
  await play(T5, profile(40)); await voidIt(T5);
  assert.deepEqual(await link((await linkCode(D)).code, profile(40)), {linked: true, items: []});
  assert.equal(await owned(D), undefined);
  await voidIt('6'.repeat(64)); // unknown token: nothing to do
});

await test('only the service role may link, void or redeem', async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(as(role, A, () => q(`select public.link_app_profile('x',$1)`, [profile(1)])), /permission denied/);
    await assert.rejects(as(role, A, () => q(`select public.void_play_purchase($1)`, [T2])), /permission denied/);
  }
  for (const t of ['profile_link_tickets', 'profile_accounts']) {
    await assert.rejects(as('authenticated', A, () => q(`select * from private.${t}`)), /permission denied/);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exitCode = failed ? 1 : 0;
