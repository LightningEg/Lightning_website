// GitHub download snapshots (supabase/migrations/20261101140000_download_snapshots.sql): the parser for one releases answer
// and the owner's readout. The daily fetch itself (supabase/ops/github-downloads-cron.sql) needs the network and is checked live.
//
//   PGLITE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/download-snapshots.test.mjs

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const mod = process.env.PGLITE_PATH ? await import(pathToFileURL(process.env.PGLITE_PATH).href) : await import('@electric-sql/pglite');
const db = new mod.PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now(), last_sign_in_at timestamptz);
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade, provider text not null, provider_id text not null, identity_data jsonb not null default '{}', created_at timestamptz not null default now(), unique (provider, provider_id));
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`);
for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) await db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
await db.exec(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
const q = (sql, params) => db.query(sql, params);
async function as(role, user, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${role};`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}
const ADMIN = '00000000-0000-4000-8000-000000000001', MEMBER = '00000000-0000-4000-8000-000000000002';
for (const id of [ADMIN, MEMBER]) await q(`insert into auth.users (id, email) values ($1, $2)`, [id, id + '@example.test']);
await q(`insert into public.admin_roles(user_id, role) values ($1,'admin')`, [ADMIN]);

const releases = [
  { tag_name: 'v1.5.1', draft: false, assets: [
    { name: 'Lightning-1.5.1-windows.zip', download_count: 40 }, { name: 'Lightning-1.5.1.apk', download_count: 12 },
    { name: 'Lightning-1.5.1-windows.zip.sha256', download_count: 99 }, { name: 'notes.md', download_count: 5 }] },
  { tag_name: 'v1.6.0', draft: true, assets: [{ name: 'Lightning-1.6.0.exe', download_count: 1 }] },
  { tag_name: 'v1.0.0-beta.1', assets: [{ name: 'Lightning.AppImage', download_count: 3 }, { name: 'Lightning.dmg', download_count: 2 }, { name: 'Lightning-misc.bin', download_count: 1 }] },
];
const record = p => q(`select private.record_download_snapshot($1::jsonb) n`, [JSON.stringify(p)]);

await test('only app files of published releases are kept, with their platform', async () => {
  assert.equal((await record(releases)).rows[0].n, 5);
  const rows = (await q(`select tag, file, platform, count from public.download_snapshots order by tag, platform`)).rows;
  assert.deepEqual(rows.map(r => [r.tag, r.platform, r.count]), [['v1.0.0-beta.1', 'linux', 3], ['v1.0.0-beta.1', 'mac', 2], ['v1.0.0-beta.1', 'other', 1], ['v1.5.1', 'android', 12], ['v1.5.1', 'windows', 40]]);
});

await test('running again the same day replaces the counts instead of adding rows', async () => {
  releases[0].assets[0].download_count = 55;
  await record(releases);
  assert.equal(Number((await q(`select count(*) n from public.download_snapshots`)).rows[0].n), 5);
  assert.equal((await q(`select count from public.download_snapshots where file = 'Lightning-1.5.1-windows.zip'`)).rows[0].count, 55);
});

await test('anything that is not a releases list records nothing and raises nothing', async () => {
  for (const p of [{}, 'text', null, 3]) assert.equal((await record(p)).rows[0].n, 0);
});

await test('only an MFA administrator reads the snapshots; the table and the parser stay closed', async () => {
  const read = (user, role = 'authenticated') => as(role, user, () => q(`select public.admin_downloads(60) r`));
  const r = (await read(ADMIN)).rows[0].r;
  assert.equal(r.length, 5); assert.deepEqual(Object.keys(r[0]).sort(), ['count', 'date', 'file', 'platform', 'tag']);
  await assert.rejects(read(MEMBER), /administrator/);
  await assert.rejects(read(null, 'anon'), /permission denied/);
  await assert.rejects(as('authenticated', ADMIN, () => q(`select * from public.download_snapshots`)), /permission denied/);
  await assert.rejects(as('authenticated', ADMIN, () => q(`select private.record_download_snapshot('[]'::jsonb)`)), /permission denied/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
