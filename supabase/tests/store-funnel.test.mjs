// Store analytics (supabase/migrations/20261028140000_site_analytics.sql): anonymous store page views through
// site_track, and the owner's admin_store_funnel from browsing to an order and a top-up.
//
//   PGLITE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/store-funnel.test.mjs

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
const newUser = async (name) => { const id = uid(++n); await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `u${n}@example.test`]);
  await q(`update public.member_profiles set display_name=$2, adult_confirmed=true where user_id=$1`, [id, name || 'member-' + n]); return id; };
let topups = 0;
const topUp = (user, coins) => q(`select private.post_ledger($1,'paid_topup',0,$2,'instapay',$3,'primary','Top-up','topup:'||$3,now(),null,null)`, [user, coins, 'T' + (++topups)]);
const gift = (user, coins) => as('service_role', null, () => q(`select * from public.award_coins($1,'admin_gift',$2,'test',$3,'Coins for the test')`, [user, coins, 'G' + (++topups)]));
const owns = async (user, item) => (await q(`select 1 from public.inventory where user_id=$1 and item_id=$2`, [user, item])).rows.length === 1;
const balance = async user => (await q(`select balance from public.wallets where user_id=$1`, [user])).rows[0].balance;
const rpc = (user, sql, params) => as('authenticated', user, async () => (await q(sql, params)).rows[0]);
const key = () => 'key-' + Math.random().toString(36).slice(2, 12);

const ADMIN = await newUser('owner');
await q(`insert into public.admin_roles(user_id, role) values ($1,'admin')`, [ADMIN]);
const pv = () => [...Array(16)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const track = (p, role = 'anon') => as(role, null, () => q(`select public.site_track($1::jsonb)`, [JSON.stringify(p)]));
const row = async id => (await q(`select * from public.site_views where pv=$1`, [id])).rows[0];
const funnel = async () => (await as('authenticated', ADMIN, () => q(`select public.admin_store_funnel(30) f`))).rows[0].f;

await test('anyone can send a store page view; nobody can read the table', async () => {
  const id = pv();
  await track({ pv: id, page: 'marketplace', lang: 'en', device: 'phone', os: 'android', br: 'chrome', consent: 'essential',
    ref: 'www.google.com', from: 'index', scroll: 40, act: 12, lcp: 1.8, tl: [['view', 0], ['store-try-nile', 5], ['store-details-nile', 9]] });
  const r = await row(id);
  assert.equal(r.page, 'marketplace'); assert.equal(r.device, 'phone'); assert.equal(r.ref, 'www.google.com');
  assert.deepEqual(r.tl, { view: 0, 'store-try-nile': 5, 'store-details-nile': 9 });
  await assert.rejects(as('anon', null, () => q(`select * from public.site_views`)), /permission denied/);
  await assert.rejects(as('authenticated', ADMIN, () => q(`select * from public.site_views`)), /permission denied/);
});

await test('only the store pages are kept, and bad input is dropped without an error', async () => {
  for (const p of [{ pv: pv(), page: 'index' }, { pv: pv(), page: 'current-status' }, { pv: 'not-hex', page: 'marketplace' },
    { pv: pv(), page: 'marketplace', scroll: 'lots' }, 'just text', [1, 2], { pv: pv() }]) await track(p);
  const n = Number((await q(`select count(*) n from public.site_views`)).rows[0].n);
  assert.equal(n, 1, 'only the first test record exists');
  const id = pv();
  await track({ pv: id, page: 'topup', ref: 'evil.example/path?x=1', us: 'x'.repeat(500), tl: [['Bad Code', 1], ['ok-code', 2], ['x', 'NaN']] });
  const r = await row(id);
  assert.equal(r.ref, null, 'a referrer that is not a host name is dropped');
  assert.equal(r.utm_source.length, 60);
  assert.deepEqual(r.tl, { 'ok-code': 2 });
});

await test('a page view grows as it is sent again, and keeps the first time of each event', async () => {
  const id = pv();
  await track({ pv: id, page: 'marketplace', scroll: 10, act: 3, tl: [['view', 0], ['store-buy', 20]] });
  await track({ pv: id, page: 'marketplace', scroll: 70, act: 30, tl: [['view', 0], ['store-buy', 20], ['store-short', 21]] });
  await track({ pv: id, page: 'marketplace', scroll: 5, act: 1, tl: [['store-buy', 99]] });
  const r = await row(id);
  assert.equal(r.scroll, 70); assert.equal(r.active, 30);
  assert.deepEqual(r.tl, { view: 0, 'store-buy': 20, 'store-short': 21 });
});

await test('the funnel joins store page views with carts, orders and top-ups; owner only', async () => {
  const M = await newUser(); await topUp(M, 5000);
  await rpc(M, `select public.cart_add('name-gold') v`);
  const total = (await rpc(M, `select public.cart_view() v`)).v.total;
  await rpc(M, `select public.checkout_cart($1,$2) r`, [total, key()]);
  await assert.rejects(rpc(M, `select public.admin_store_funnel(30) f`), /administrator/);
  await assert.rejects(as('anon', null, () => q(`select public.admin_store_funnel(30)`)), /permission denied/);
  const f = await funnel();
  assert.equal(f.steps.store_views, 2, 'the first marketplace view and the one that grew');
  assert.equal(f.steps.looked_closer, 1); assert.equal(f.steps.tried_on, 1);
  assert.equal(f.steps.started_buy, 1); assert.equal(f.steps.short_of_coins, 1);
  assert.equal(f.steps.members_added_to_cart, 1); assert.equal(f.steps.orders, 1); assert.equal(f.steps.buyers, 1);
  assert.equal(f.topups.wallet_views, 1);
  const nile = f.items.find(i => i.id === 'nile'); assert.equal(nile.tried, 1); assert.equal(nile.opened, 1); assert.equal(nile.sold, 0);
  const gold = f.items.find(i => i.id === 'name-gold'); assert.equal(gold.added, 1); assert.equal(gold.sold, 1);
});

await test('records older than 90 days are cleared, and a flood is cut off', async () => {
  await q(`insert into public.site_views (pv, page, created_at) values ('00000000000000aa', 'marketplace', now() - interval '100 days')`);
  await q(`select setseed(0.5)`);
  for (let i = 0; i < 400 && (await q(`select 1 from public.site_views where pv='00000000000000aa'`)).rows.length; i++) await track({ pv: pv(), page: 'collection' });
  assert.equal((await q(`select 1 from public.site_views where pv='00000000000000aa'`)).rows.length, 0);
  await q(`insert into public.site_views (pv, page) select '1' || lpad(to_hex(g), 15, '0'), 'marketplace' from generate_series(1, 600) g`);
  const before = Number((await q(`select count(*) n from public.site_views`)).rows[0].n);
  await track({ pv: pv(), page: 'marketplace' });
  assert.equal(Number((await q(`select count(*) n from public.site_views`)).rows[0].n), before);
});

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exitCode = failed ? 1 : 0;
