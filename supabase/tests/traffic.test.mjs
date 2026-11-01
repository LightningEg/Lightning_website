// Site-wide traffic (supabase/migrations/20261101100000_admin_traffic.sql): site_track keeps a main-page view, and the owner's
// admin_traffic counts arrivals, sources, downloads and new members, owner only.
//
//   PGLITE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/traffic.test.mjs

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
const traffic = async (days = 30) => (await as('authenticated', ADMIN, () => q(`select public.admin_traffic($1) t`, [days]))).rows[0].t;
const view = (o) => track({ pv: pv(), lang: 'en', device: 'phone', consent: 'essential', scroll: 0, act: 0, tl: [], ...o });

await test('every main page is kept, a made-up name is not, and the table stays unreadable', async () => {
  await view({ page: 'index' }); await view({ page: 'ar/features' }); await view({ page: '../secret' }); await view({ page: 'Bad Page' });
  assert.equal(Number((await q(`select count(*) n from public.site_views`)).rows[0].n), 2);
  await assert.rejects(as('anon', null, () => q(`select * from public.site_views`)), /permission denied/);
});

await test('only an MFA administrator reads the traffic', async () => {
  const M = await newUser();
  await assert.rejects(rpc(M, `select public.admin_traffic(30) t`), /administrator/);
  await assert.rejects(as('anon', null, () => q(`select public.admin_traffic(30)`)), /permission denied/);
  await db.exec(`select set_config('request.jwt.claims','{"aal":"aal1"}',false)`);
  await assert.rejects(as('authenticated', ADMIN, () => q(`select public.admin_traffic(30)`)));
  await db.exec(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
});

await test('arrivals leave out pages reached from inside the site; sources fold small groups; downloads are counted', async () => {
  for (let i = 0; i < 6; i++) await view({ page: 'index', ref: 'www.google.com', device: 'desktop' });
  await view({ page: 'index', ref: 'reddit.com' });
  await view({ page: 'index', ref: 'reddit.com', us: 'launch' });
  await view({ page: 'features', from: 'index', scroll: 90 });                                   // inside the site: not an arrival
  await view({ page: 'current-status', from: 'outside', ref: 'x.example', tl: [['download-app-v1.5.1-windows', 12]], act: 30, scroll: 80 });
  await view({ page: 'index', from: 'outside', tl: [['js-error-ab12', 3]] });
  const t = await traffic();
  assert.equal(t.totals.page_views, 2 + 6 + 2 + 1 + 1 + 1);
  assert.equal(t.totals.arrivals, 2 + 6 + 2 + 1 + 1);
  assert.equal(t.totals.download_presses, 1);
  assert.equal(t.totals.engaged, 1);
  assert.equal(t.errors, 1);
  const google = t.sources.find(s => s.source === 'google.com');
  assert.equal(google.arrivals, 6, 'www. is folded away');
  assert.ok(t.sources.some(s => s.source === 'smaller groups'));
  assert.ok(!t.sources.some(s => s.source === 'reddit.com' || s.source === 'launch'), 'groups under 5 never stand alone');
  assert.equal(t.pages[0].page, 'index');
  assert.deepEqual(t.devices.map(x => x.device).sort(), ['desktop', 'phone']);
  assert.equal(t.daily.at(-1).arrivals, t.totals.arrivals);
  assert.equal(t.daily.at(-1).downloads, 1);
});

await test('new members per day leave administrators out, and nobody is named', async () => {
  const before = (await traffic()).totals.new_members;
  await newUser(); await newUser();
  const t = await traffic();
  assert.equal(t.totals.new_members, before + 2);
  assert.equal(t.daily.at(-1).members, t.totals.new_members);
  const text = JSON.stringify(t);
  assert.ok(!/@example\.test|owner|member-/.test(text), 'no email or name in the readout');
});

await test('admin_page_views hands the records over a page at a time, owner only, with the timeline as an object', async () => {
  const M = await newUser();
  await assert.rejects(rpc(M, `select public.admin_page_views(28, 0, 10) t`), /administrator/);
  await assert.rejects(as('anon', null, () => q(`select public.admin_page_views(28, 0, 10)`)), /permission denied/);
  const page = async (o, l) => (await as('authenticated', ADMIN, () => q(`select public.admin_page_views(28, $1, $2) t`, [o, l]))).rows[0].t;
  const a = await page(0, 5), b = await page(5, 5);
  assert.equal(a.rows.length, 5); assert.ok(a.total >= 10); assert.ok(b.rows.length > 0);
  assert.notDeepEqual(a.rows[0], b.rows[0]);
  const one = a.rows[0];
  assert.deepEqual(Object.keys(one).sort(), ['at', 'browser', 'consent', 'day', 'device', 'from', 'lang', 'lcp', 'os', 'page', 'ref', 'scroll', 'active', 'tl', 'us', 'ux'].sort());
  assert.equal(typeof one.tl, 'object');
  assert.ok(!('pv' in one), 'the random page-view id never leaves the database');
  assert.equal((await page(0, 5000)).rows.length <= 1000, true);
});

await test('the period is capped at ninety days', async () => {
  assert.equal((await traffic(1000)).days, 90);
  assert.equal((await traffic(0)).days, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
