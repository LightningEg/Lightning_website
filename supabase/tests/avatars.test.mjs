// Profile pictures (supabase/migrations/20261027110000_profile_pictures.sql): the bucket, who may write which file,
// the rule that a picture link can only point at the member's own file, and the owner taking one down.
//
//   PGLITE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/avatars.test.mjs

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setupStorage } from './helpers/storage.mjs';

const mod = process.env.PGLITE_PATH ? await import(pathToFileURL(process.env.PGLITE_PATH).href) : await import('@electric-sql/pglite');
const db = new mod.PGlite();
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

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
const newUser = async () => { const id = uid(++n); await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `u${n}@example.test`]); return id; };
const A = await newUser(), B = await newUser(), ADMIN = await newUser();
await q(`insert into public.admin_roles(user_id, role) values ($1,'admin')`, [ADMIN]);
const keyOf = async u => (await as('authenticated', u, () => q(`select public.ensure_avatar_path() p`))).rows[0].p.split('/')[0];
const KA = await keyOf(A), KB = await keyOf(B);
const link = (k, v = 1) => `https://x.supabase.co/storage/v1/object/public/avatars/${k}/avatar?v=${v}`;
const setAvatar = (u, url) => as('authenticated', u, () => q(`update public.member_profiles set avatar_url=$2 where user_id=$1`, [u, url]));
const put = (u, name) => as('authenticated', u, () => q(`insert into storage.objects(bucket_id,name) values ('avatars',$1)`, [name]));

await test('the avatars bucket is public, small, and image-only', async () => {
  const b = (await q(`select public, file_size_limit, allowed_mime_types from storage.buckets where id='avatars'`)).rows[0];
  assert.equal(b.public, true); assert.equal(Number(b.file_size_limit), 262144);
  assert.deepEqual([...b.allowed_mime_types].sort(), ['image/jpeg', 'image/png', 'image/webp']);
});

await test('a member writes only their own single file, and replaces it', async () => {
  await put(A, `${KA}/avatar`);
  await assert.rejects(put(A, `${KB}/avatar`), /row-level security/i);
  await assert.rejects(put(A, `${A}/avatar`), /row-level security/i, 'the account id is not a path');
  await assert.rejects(put(A, `${KA}/other.png`), /row-level security/i);
  await assert.rejects(put(A, `${KA}/nested/avatar`), /row-level security/i);
  assert.equal((await as('authenticated', A, () => q(`update storage.objects set name=name where bucket_id='avatars' and name=$1`, [`${KA}/avatar`]))).affectedRows, 1);
  assert.equal((await as('authenticated', B, () => q(`update storage.objects set name=name where bucket_id='avatars' and name=$1`, [`${KA}/avatar`]))).affectedRows, 0, 'not someone else\'s');
});

await test('delete: a member removes their own; nobody else may, except an administrator', async () => {
  assert.equal((await as('authenticated', B, () => q(`delete from storage.objects where name=$1`, [`${KA}/avatar`]))).affectedRows, 0);
  assert.equal((await as('authenticated', ADMIN, () => q(`delete from storage.objects where name=$1`, [`${KA}/avatar`]))).affectedRows, 1);
  await put(A, `${KA}/avatar`);
  assert.equal((await as('authenticated', A, () => q(`delete from storage.objects where name=$1`, [`${KA}/avatar`]))).affectedRows, 1);
});

await test('the picture link can only be the member\'s own file, a new version of it, or empty', async () => {
  await setAvatar(A, link(KA, 1));
  await setAvatar(A, link(KA, 1700000000000));
  await assert.rejects(setAvatar(A, link(KB)), /upload a picture/);
  await assert.rejects(setAvatar(A, link(A)), /upload a picture/, 'the account id is not the key');
  await assert.rejects(setAvatar(A, 'https://tracker.example/pixel.png'), /upload a picture/);
  await assert.rejects(setAvatar(A, link(KA) + '/../x'), /upload a picture/);
  await assert.rejects(setAvatar(A, `https://x.supabase.co/storage/v1/object/public/avatars/${KA}/avatar.png`), /upload a picture/);
  await setAvatar(A, null);
  assert.equal((await q(`select avatar_url from public.member_profiles where user_id=$1`, [A])).rows[0].avatar_url, null);
});

await test('the path is private to the member, stable, and unrelated to the account id', async () => {
  assert.match(KA, /^[0-9a-f]{32}$/); assert.notEqual(KA, KB);
  assert.equal(await keyOf(A), KA, 'asking again gives the same one');
  assert.ok(!KA.includes(A.replace(/-/g, '')), 'not derived from the account id');
  assert.equal((await as('authenticated', B, () => q(`select public.my_avatar_path() p`))).rows[0].p, `${KB}/avatar`);
  const C = await newUser();
  assert.equal((await as('authenticated', C, () => q(`select public.my_avatar_path() p`))).rows[0].p, null, 'no key before the first upload');
  await assert.rejects(setAvatar(C, `https://x.supabase.co/storage/v1/object/public/avatars/no-key/avatar`), /upload a picture/);
  await assert.rejects(as('anon', null, () => q(`select public.ensure_avatar_path()`)), /permission denied/);
  await assert.rejects(as('authenticated', A, () => q(`select * from private.avatar_keys`)), /permission denied/);
});

await test('an older picture link is kept until the member changes it, but cannot be set again', async () => {
  // a link saved before the rule existed: set while the trigger is off, as it was then
  await q(`alter table public.member_profiles disable trigger member_profiles_avatar_url`);
  await q(`update public.member_profiles set avatar_url='https://old.example/me.png' where user_id=$1`, [B]);
  await q(`alter table public.member_profiles enable trigger member_profiles_avatar_url`);
  await setAvatar(B, 'https://old.example/me.png');   // unchanged: allowed
  await assert.rejects(setAvatar(B, 'https://old.example/other.png'), /upload a picture/);
});

await test('the owner clears a picture with a reason, and it is in the audit log', async () => {
  await setAvatar(A, link(KA, 5));
  await assert.rejects(as('authenticated', B, () => q(`select public.admin_remove_avatar('u101@example.test','not allowed here')`)), /administrator/);
  await assert.rejects(as('authenticated', ADMIN, () => q(`select public.admin_remove_avatar('u101@example.test','no')`)), /reason/);
  await assert.rejects(as('authenticated', ADMIN, () => q(`select public.admin_remove_avatar('nobody@example.test','offensive picture')`)), /no member/);
  const path = (await as('authenticated', ADMIN, () => q(`select public.admin_remove_avatar('U101@EXAMPLE.TEST','offensive picture') p`))).rows[0].p;
  assert.equal(path, `${KA}/avatar`, 'the file to delete, by its private path');
  assert.equal((await q(`select avatar_url from public.member_profiles where user_id=$1`, [A])).rows[0].avatar_url, null);
  const log = (await q(`select actor, detail from public.audit_log where action='profile.avatar_removed' and target_id=$1`, [A])).rows[0];
  assert.equal(log.actor, ADMIN); assert.equal(log.detail.reason, 'offensive picture');
});

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exitCode = failed ? 1 : 0;
