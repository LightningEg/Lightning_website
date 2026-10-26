// The owner's catalogue: tier prices, item prices, retiring items and app releases. Isolated Postgres.
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


const ADMIN = uid(9), MEMBER = uid(10);
await q(`insert into auth.users (id, email) values ($1, 'owner@example.test'), ($2, 'member@example.test')`, [ADMIN, MEMBER]);
await q(`insert into public.admin_roles(user_id, role) values ($1,'admin')`, [ADMIN]);
const owner = (sql, params) => as('authenticated', ADMIN, () => q(sql, params));
const member = (sql, params) => as('authenticated', MEMBER, () => q(sql, params));
const price = async id => (await q(`select price, tier, active from public.catalog_items where id = $1`, [id])).rows[0];

await test('One theme, one purchase on every surface: papyrus and dendera are animated, app themes wait disabled', async () => {
  assert.deepEqual(await price('papyrus'), { price: 1000, tier: 'motion', active: true });
  assert.deepEqual(await price('dendera'), { price: 1000, tier: 'motion', active: true }, 'the animated tier keeps one price');
  assert.equal((await price('cotton')).price, 600);
  assert.equal((await price('nile')).price, 300);
  const app = (await q(`select item_id, asset_version, enabled from public.bundled_item_versions order by item_id`)).rows;
  assert.deepEqual(app.map(r => [r.item_id, r.asset_version, r.enabled]), [['cotton', 1, false], ['dendera', 1, false], ['nile', 1, false], ['papyrus', 1, false]]);
});

await test('Only an MFA owner reads or changes the catalogue', async () => {
  for (const sql of [`select public.admin_catalog()`, `select public.admin_set_tier_price('palette', 350)`,
                     `select public.admin_set_item_price('banner-dusk', 160)`, `select public.admin_set_item_active('nile', false)`,
                     `select public.admin_set_app_release('nile', 1, true)`])
    await assert.rejects(member(sql));
  await db.exec(`select set_config('request.jwt.claims','{"aal":"aal1"}',false)`);
  await assert.rejects(owner(`select public.admin_catalog()`));
  await db.exec(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
  const c = (await owner(`select public.admin_catalog() as c`)).rows[0].c;
  assert.deepEqual(c.tiers, { palette: 300, texture: 600, motion: 1000 });
  assert.equal(c.coins_per_egp, 5);
  const papyrus = c.items.find(i => i.id === 'papyrus');
  assert.deepEqual(papyrus.app, [{ version: 1, enabled: false }]);
  assert.equal(c.items[0].type, 'set', 'sets first, then themes');
  assert.ok(c.items.find(i => i.type === 'set').parts.length >= 4);
});

await test('A tier keeps one price; sets follow their parts; themes cannot be priced alone', async () => {
  const n = (await owner(`select public.admin_set_tier_price('palette', 350) as n`)).rows[0].n;
  assert.ok(n >= 5, 'every paid palette moved');
  const palettes = (await q(`select distinct price from public.catalog_items where type='theme' and tier='palette' and not is_default`)).rows;
  assert.deepEqual(palettes, [{ price: 350 }]);
  assert.equal((await price('mono')).price, 0, 'the free default stays free');
  const set = (await q(`select s.price, (select ((sum(c.price)*8+9)/10)::int from public.set_parts p join public.catalog_items c on c.id=p.item_id where p.set_id=s.id and not c.is_default) as parts from public.catalog_items s where s.id='set-nile'`)).rows[0];
  assert.equal(set.price, set.parts);
  await assert.rejects(owner(`select public.admin_set_item_price('nile', 999)`), /tier/);
  await assert.rejects(owner(`select public.admin_set_item_price('set-nile', 999)`), /parts/);
  await assert.rejects(owner(`select public.admin_set_item_price('badge-founding', 50)`), /free and earned/);
  await assert.rejects(owner(`select public.admin_set_tier_price('palette', 0)`));
  await owner(`select public.admin_set_item_price('banner-dusk', 160)`);
  assert.equal((await price('banner-dusk')).price, 160);
  const audit = (await q(`select action from public.audit_log where action like 'catalog.%' order by id`)).rows.map(r => r.action);
  assert.deepEqual(audit, ['catalog.tier_price', 'catalog.price']);
  await owner(`select public.admin_set_tier_price('palette', 300)`);
});

await test('Retiring hides an item from sale but never from its owners; the default stays', async () => {
  await owner(`select public.admin_set_item_active('banner-dusk', false)`);
  const anon = await as('anon', null, () => q(`select id from public.market_catalog()`));
  assert.ok(!anon.rows.some(r => r.id === 'banner-dusk'));
  await assert.rejects(owner(`select public.admin_set_item_active('mono', false)`), /default/);
  await owner(`select public.admin_set_item_active('banner-dusk', true)`);
});

await test('An app theme unlocks only after the owner turns its release on', async () => {
  await q(`insert into public.wallets(user_id, balance) values ($1, 2000) on conflict (user_id) do update set balance = 2000`, [MEMBER]).catch(() => {});
  await q(`insert into public.inventory(user_id, item_id) values ($1, 'cotton') on conflict do nothing`, [MEMBER]);
  await assert.rejects(member(`select public.issue_activation_code('cotton', 1)`), /not available/);
  await owner(`select public.admin_set_app_release('cotton', 1, true)`);
  const code = (await member(`select public.issue_activation_code('cotton', 1) as c`)).rows[0].c;
  assert.match(code.code, /^[0-9A-F]{8}(-[0-9A-F]{8}){3}$/);
  await assert.rejects(owner(`select public.admin_set_app_release('banner-dusk', 1, true)`), /app themes only/);
  await owner(`select public.admin_set_app_release('cotton', 1, false)`);
  await assert.rejects(member(`select public.issue_activation_code('cotton', 1)`), /not available/);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
