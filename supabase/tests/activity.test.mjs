// The audit timeline (supabase/migrations/20261027100000_activity_audit.sql): admin_activity() lists coins, scores, sales and
// the owner's own actions from the records that already exist, newest first, for MFA administrators only.
//
//   PGLITE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/activity.test.mjs

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
const price = async id => Number((await q(`select price from public.catalog_items where id=$1`, [id])).rows[0].price);
const act = (args) => as('authenticated', ADMIN, () => q(`select public.admin_activity($1,$2,$3,$4,$5) a`, args)).then(r => r.rows[0].a);
const key2 = () => 'ord-' + Math.random().toString(36).slice(2, 14);
const N = await newUser('reader'), M = await newUser('buyer');
const mail = async u => (await q(`select email from auth.users where id=$1`, [u])).rows[0].email;

await test('only an MFA administrator can read the timeline, and bad input is refused', async () => {
  await assert.rejects(as('anon', null, () => q(`select public.admin_activity()`)), /permission denied/);
  await assert.rejects(as('authenticated', M, () => q(`select public.admin_activity()`)), /administrator/);
  await assert.rejects(act(['nonsense', null, null, 50, 30]), /unknown category/);
  await assert.rejects(act(['all', 'x'.repeat(81), null, 50, 30]), /too long/);
});

await test('coins, scores, sales and the owner\'s actions all appear, each once, newest first', async () => {
  await topUp(M, 1000);
  await as('service_role', null, () => q(`select * from public.award_coins($1,'contribution_award',300,'pr','x1','Merged a pull request')`, [N]));
  await gift(M, 50);
  await rpc(M, `select * from public.purchase_item_at_price('name-gold',$1,$2)`, [await price('name-gold'), key()]);
  await rpc(M, `select public.cart_add('name-nile')`); await rpc(M, `select public.cart_add('banner-halo')`);
  const total = (await rpc(M, `select public.cart_view() v`)).v.total;
  await rpc(M, `select public.checkout_cart($1,$2)`, [total, key2()]);
  await q(`insert into public.audit_log(actor,action,target_type,target_id,detail) values ($1,'wallet.manual_credit','member',$2,'{"coins":50}')`, [ADMIN, M]);
  const all = await act(['all', null, null, 200, 30]);
  const ev = all.rows.map(r => r.event);
  for (const e of ['paid_topup', 'contribution_award', 'admin_gift', 'purchase', 'wallet.manual_credit']) assert.ok(ev.includes(e), e);
  assert.equal(all.rows.filter(r => r.event === 'purchase').length, 3, 'one per item bought, not twice');
  assert.deepEqual(all.rows.map(r => r.at), [...all.rows.map(r => r.at)].sort().reverse(), 'newest first');
  assert.equal(all.rows.find(r => r.event === 'contribution_award').category, 'score');
  assert.equal(all.rows.find(r => r.event === 'paid_topup').category, 'coins');
  assert.equal(all.rows.find(r => r.event === 'wallet.manual_credit').category, 'admin');
  const nile = all.rows.find(r => r.item === 'Nile name');
  assert.equal(nile.category, 'sale'); assert.equal(nile.coins, -(await price('name-nile'))); assert.equal(nile.order.length, 8, 'a cart purchase names its order');
  assert.equal(all.rows.find(r => r.item === 'Gold name').order, null, 'a direct purchase has none');
});

await test('each filter keeps only its kind of record', async () => {
  const kinds = async c => [...new Set((await act([c, null, null, 200, 30])).rows.map(r => r.category))].sort();
  assert.deepEqual(await kinds('admin'), ['admin']);
  assert.deepEqual(await kinds('sales'), ['sale']);
  assert.deepEqual(await kinds('score'), ['score']);
  assert.deepEqual(await kinds('coins'), ['coins', 'sale', 'score'], 'every coin movement, whatever it was for');
  assert.ok((await act(['coins', null, null, 200, 30])).rows.every(r => r.coins !== 0 && r.coins !== null));
});

await test('search finds a member by email or name, an item, or a reference; wildcards are literal', async () => {
  const byMail = await act(['all', await mail(M), null, 200, 30]);
  assert.ok(byMail.rows.length >= 5 && byMail.rows.every(r => r.email === null || r.email === byMail.rows[0].email));
  assert.ok((await act(['all', 'reader', null, 200, 30])).rows.some(r => r.event === 'contribution_award'));
  assert.ok((await act(['sales', 'halo', null, 200, 30])).rows.every(r => r.item === 'Halo'));
  assert.equal((await act(['all', '%', null, 200, 30])).rows.length, 0, 'a lone percent sign matches nothing');
  assert.equal((await act(['all', 'no-such-thing-anywhere', null, 200, 30])).rows.length, 0);
});

await test('paging: a page says if more exist and the next page starts after it', async () => {
  const first = await act(['all', null, null, 3, 30]);
  assert.equal(first.rows.length, 3); assert.equal(first.has_more, true);
  const second = await act(['all', null, first.rows[2].at, 3, 30]);
  assert.ok(second.rows.length >= 1 && second.rows[0].at <= first.rows[2].at);
  const rest = await act(['all', null, null, 200, 30]);
  assert.equal(rest.has_more, false);
});

await test('the summary adds up what moved in the period', async () => {
  const s = (await act(['all', null, null, 1, 30])).summary;
  assert.equal(s.paid_in, 1000); assert.equal(s.given, 350); assert.equal(s.score_awarded, 300);
  assert.equal(s.spent, (await price('name-gold')) + (await price('name-nile')) + (await price('banner-halo')));
  assert.equal(s.manual_credits, 1); assert.ok(s.admin_actions >= 1);
  assert.equal(s.days, 30);
});

await test('the records it reads cannot be changed afterwards', async () => {
  await assert.rejects(q(`update public.audit_log set action='x'`), /append|not allowed|immutable|cannot/i);
  await assert.rejects(q(`delete from public.ledger_entries`), /append|not allowed|immutable|cannot|only/i);
});

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exitCode = failed ? 1 : 0;
