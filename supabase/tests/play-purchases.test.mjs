// Play purchases (supabase/migrations/20261109150000_play_purchases.sql, app repo NF-11B3): one token licenses one app
// profile and up to 5 profiles of the same buyer (NF-10H1), and only the service role may call it.
//
//   PGLITE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/play-purchases.test.mjs

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
const PA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', PB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T1 = 'a'.repeat(64), T2 = 'b'.repeat(64), T3 = 'c'.repeat(64);
const ITEMS = JSON.stringify([{item_id: 'nile', asset_version: 1}]);
await q(`insert into public.bundled_item_versions(item_id,asset_version,enabled) values ('nile',1,true),('name-gold',1,false) on conflict (item_id,asset_version) do update set enabled=excluded.enabled`);
const redeem = (token, profile, item = 'nile', items = ITEMS, order = 'GPA.1') => as('service_role', null, async () =>
  (await q(`select public.redeem_play_purchase($1,$2,$3,$4,$5::jsonb) d`, [token, order, item, profile, items])).rows[0].d);

await test('a Play purchase licenses its profile, with the theme version the app carries', async () => {
  const lic = await redeem(T1, PA);
  assert.equal(lic.profile_id, PA); assert.equal(lic.schema_version, 1);
  assert.deepEqual(lic.items, [{item_id: 'nile', asset_version: 1, deliveries: []}]);
  assert.match(lic.account_id, /^[0-9a-f-]{36}$/);
});

await test('the same token and profile again is answered (another device), and keeps one row', async () => {
  assert.equal((await redeem(T1, PA)).profile_id, PA);
  assert.equal(Number((await q(`select count(*) c from private.play_purchases`)).rows[0].c), 1);
});

await test('one purchase per person: another profile of the buyer is licensed, without a second payment (NF-10H1)', async () => {
  const lic = await redeem(T1, PB);
  assert.equal(lic.profile_id, PB);
  assert.equal(lic.account_id, (await redeem(T1, PA)).account_id, 'the same purchase names the same account');
  assert.equal(Number((await q(`select count(*) c from private.play_purchase_profiles where token_sha256=$1`, [T1])).rows[0].c), 2);
  assert.equal(Number((await q(`select count(*) c from private.play_purchases`)).rows[0].c), 1, 'still one purchase');
});

await test('the sixth profile on one purchase is refused with the cap named', async () => {
  const p = n => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`;
  for (let n = 3; n <= 5; n++) await redeem(T1, p(n));
  await assert.rejects(redeem(T1, p(6)), /unlocks 5 profiles/);
  assert.equal((await redeem(T1, PA)).profile_id, PA, 'a profile already on it still gets its licence');
});

await test('a token for one theme cannot mint another', async () => {
  await assert.rejects(redeem(T1, PA, 'name-gold', JSON.stringify([{item_id: 'name-gold', asset_version: 1}])), /unsupported|invalid purchase/);
});

await test('a theme the app does not carry, or not enabled, is refused and nothing is kept', async () => {
  await assert.rejects(redeem(T2, PA, 'nile', JSON.stringify([{item_id: 'nile', asset_version: 2}])), /unsupported/);
  await assert.rejects(redeem(T3, PA, 'name-gold', JSON.stringify([{item_id: 'name-gold', asset_version: 1}])), /unsupported/);
  assert.equal(Number((await q(`select count(*) c from private.play_purchases`)).rows[0].c), 1);
});

await test('only the service role may call it, and only the hash is kept', async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(as(role, null, () => q(`select public.redeem_play_purchase($1,'o','nile',$2,$3::jsonb)`, [T2, PA, ITEMS])), /permission denied/);
  }
  await assert.rejects(redeem('not-a-hash', PA), /invalid purchase/);
  await assert.rejects(redeem(T2, 'nope'), /which profile/);
  const cols = (await q(`select column_name from information_schema.columns where table_schema='private' and table_name='play_purchases'`)).rows.map(r => r.column_name);
  assert.ok(!cols.includes('token') && cols.includes('token_sha256'));
});

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exitCode = failed ? 1 : 0;
