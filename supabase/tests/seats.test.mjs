// One purchase, one profile (supabase/migrations/20261027130000_profile_seats.sql): a theme comes with one seat, a code claims it
// for one app profile and is burned, that profile's other devices stay free, another profile needs a seat at 25% of the price.
//
//   PGLITE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/seats.test.mjs

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
const PA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', PB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', PC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
await q(`insert into public.bundled_item_versions(item_id,asset_version,enabled) values ('nile',1,true),('name-gold',1,false) on conflict (item_id,asset_version) do update set enabled=excluded.enabled`);
const issue = (u, item = 'nile') => rpc(u, `select public.issue_activation_code($1,1) d`, [item]).then(r => r.d);
const redeem = (code, profile, item = 'nile') => as('service_role', null, async () => (await q(`select public.redeem_activation_code($1,$2,1,$3) d`, [code, item, profile])).rows[0].d);
const seats = u => rpc(u, `select public.my_theme_seats() s`).then(r => r.s);
const buySeat = (u, expected, k = key()) => rpc(u, `select public.purchase_theme_seat('nile',$1,$2) r`, [expected, k]).then(r => r.r);
const claims = async u => Number((await q(`select count(*) c from public.profile_claims where user_id=$1`, [u])).rows[0].c);
const nile = await price('nile');
const seatPrice = Math.max(1, Math.ceil(nile / 4));
const M = await newUser('buyer'); await topUp(M, 5000);
await rpc(M, `select * from public.purchase_item_at_price('nile',$1,$2)`, [nile, key()]);

await test('the first profile takes the seat that came with the theme; its code is burned', async () => {
  const a = await issue(M);
  const lic = await redeem(a.code, PA);
  assert.equal(lic.profile_id, PA); assert.equal(lic.account_id, M);
  assert.equal(await claims(M), 1);
  await assert.rejects(redeem(a.code, PA), /invalid or expired/, 'a burned code opens nothing');
  const s = (await seats(M))[0];
  assert.deepEqual([s.item_id, s.seats, s.used, s.next_price, s.can_buy], ['nile', 1, 1, seatPrice, true]);
});

await test('the same profile on another device uses a new code and no second seat', async () => {
  const lic = await redeem((await issue(M)).code, PA);
  assert.equal(lic.profile_id, PA); assert.equal(await claims(M), 1);
});

await test('another profile is refused without a seat, and the refused code is not burned', async () => {
  const a = await issue(M);
  await assert.rejects(redeem(a.code, PB), /every profile seat/);
  assert.equal(await claims(M), 1);
  assert.equal((await redeem(a.code, PA)).profile_id, PA, 'the same code still serves the profile that holds the seat');
});

await test('an extra seat costs 25% of the price (75% off), once per purchase key', async () => {
  const before = await balance(M), k = key();
  await assert.rejects(buySeat(M, seatPrice + 1), /price changed/);
  const r = await buySeat(M, seatPrice, k);
  assert.equal(r.price_paid, seatPrice); assert.equal(r.seats, 2); assert.equal(r.balance, before - seatPrice);
  assert.equal(await balance(M), before - seatPrice);
  assert.equal((await buySeat(M, seatPrice, k)).seats, 2, 'a retry returns the same seat');
  assert.equal(await balance(M), before - seatPrice, 'and never charges twice');
  assert.ok(seatPrice * 4 >= nile && seatPrice <= Math.ceil(nile * 0.25), 'a quarter, rounded up');
});

await test('with the seat bought, a second profile can claim, and a third is refused', async () => {
  assert.equal((await redeem((await issue(M)).code, PB)).profile_id, PB);
  assert.equal(await claims(M), 2);
  await assert.rejects(redeem((await issue(M)).code, PC), /every profile seat/);
  assert.equal((await redeem((await issue(M)).code, PB)).profile_id, PB, 'each profile keeps its own devices');
});

await test('only the owner of the theme can add a profile, and only with enough coins', async () => {
  const other = await newUser('nobody'); await topUp(other, 1);
  await assert.rejects(buySeat(other, seatPrice), /only add profiles to a theme you own/);
  const poor = await newUser('poor'); await topUp(poor, nile);
  await rpc(poor, `select * from public.purchase_item_at_price('nile',$1,$2)`, [nile, key()]);
  await assert.rejects(buySeat(poor, seatPrice), /insufficient coins/);
  assert.equal((await seats(poor))[0].seats, 1);
  await assert.rejects(as('anon', null, () => q(`select public.purchase_theme_seat('nile',1,'abcdefgh')`)), /permission denied/);
});

await test('ten profiles is the most, and a theme that is not in the app has no seats to sell', async () => {
  const rich = await newUser('rich'); await topUp(rich, 20000);
  await rpc(rich, `select * from public.purchase_item_at_price('nile',$1,$2)`, [nile, key()]);
  for (let i = 0; i < 9; i++) await buySeat(rich, seatPrice);
  assert.equal((await seats(rich))[0].can_buy, false);
  await assert.rejects(buySeat(rich, seatPrice), /ten profiles/);
  await rpc(rich, `select * from public.purchase_item_at_price('name-gold',$1,$2)`, [await price('name-gold'), key()]);
  await assert.rejects(rpc(rich, `select public.purchase_theme_seat('name-gold',1,$1)`, [key()]), /not available/);
  assert.deepEqual((await seats(rich)).map(s => s.item_id), ['nile'], 'only app themes show seats');
});

await test('a profile id must be a real one, and a code needs its theme version', async () => {
  const a = await issue(M);
  for (const bad of [null, '', 'not-a-uuid', 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA ']) {
    await assert.rejects(redeem(a.code, bad), /did not say which profile/, String(bad));
  }
  await assert.rejects(as('service_role', null, () => q(`select public.redeem_activation_code($1,'nile',2,$2)`, [a.code, PA])), /unsupported/);
  assert.equal((await redeem(a.code, PA)).profile_id, PA);
});

await test('the code names its theme: the app sends what it carries, nothing is spent when it cannot wear it', async () => {
  const byList = (code, items, profile = PA) => as('service_role', null, async () =>
    (await q(`select public.redeem_activation_code($1,$2::jsonb,$3) d`, [code, JSON.stringify(items), profile])).rows[0].d);
  const a = await issue(M);
  await assert.rejects(byList(a.code, [{ item_id: 'cotton', asset_version: 1 }]), /unsupported/, 'an app without Nile');
  await assert.rejects(byList(a.code, [{ item_id: 'nile', asset_version: 2 }]), /unsupported/, 'an app with another version');
  await assert.rejects(byList(a.code, []), /unsupported/);
  const d = await byList(a.code, [{ item_id: 'cotton', asset_version: 1 }, { item_id: 'nile', asset_version: 1 }]);
  assert.equal(d.items[0].item_id, 'nile'); assert.equal(d.profile_id, PA);
  await assert.rejects(byList(a.code, [{ item_id: 'nile', asset_version: 1 }]), /invalid or expired/, 'burned once used');
  await assert.rejects(byList('zz', [{ item_id: 'nile', asset_version: 1 }]), /invalid or expired/);
});

await test('support can see a member\'s claims and free one, with a reason in the audit log', async () => {
  const asAdmin = fn => as('authenticated', ADMIN, fn);
  await assert.rejects(rpc(M, `select public.admin_profile_claims('u101@example.test')`), /administrator/);
  const email = (await q(`select email from auth.users where id=$1`, [M])).rows[0].email;
  const list = (await asAdmin(() => q(`select public.admin_profile_claims($1) c`, [email]))).rows[0].c;
  assert.equal(list.length, 2); assert.equal(list[0].name, 'Nile'); assert.equal(list[0].seats, 2);
  await assert.rejects(asAdmin(() => q(`select public.admin_release_profile_claim($1,'no')`, [list[1].id])), /reason/);
  await asAdmin(() => q(`select public.admin_release_profile_claim($1,'Member lost that profile')`, [list[1].id]));
  assert.equal(await claims(M), 1);
  assert.equal((await redeem((await issue(M)).code, PC)).profile_id, PC, 'the freed seat can be claimed by another profile');
  const log = (await q(`select actor, detail from public.audit_log where action='activation.claim_released' and target_id=$1`, [M])).rows[0];
  assert.equal(log.actor, ADMIN); assert.equal(log.detail.reason, 'Member lost that profile');
  await assert.rejects(asAdmin(() => q(`select public.admin_release_profile_claim(999999,'does not exist')`)), /not found/);
});

await test('seat purchases show as sales and coin movements in the owner\'s views, and in the member\'s export', async () => {
  const sales = (await as('authenticated', ADMIN, () => q(`select public.admin_sales(30) s`))).rows[0].s;
  assert.ok(sales.sales.by_channel.seat.units >= 2 && sales.sales.by_channel.seat.coins >= seatPrice * 2);
  const act = (await as('authenticated', ADMIN, () => q(`select public.admin_activity('sales',null,null,100,30) a`))).rows[0].a;
  const seat = act.rows.find(r => r.ref === 'seat:nile');
  assert.ok(seat && seat.item === 'Nile' && seat.coins === -seatPrice, 'named by its theme');
  const x = (await rpc(M, `select public.export_my_data() x`)).x;
  assert.equal(x.theme_seats[0].extra_seats, 1); assert.equal(x.profile_claims.length, 2); assert.equal(x.seat_purchases.length, 1);
  assert.ok('bank_transfers' in x, 'the rest of the export is still there');
});

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exitCode = failed ? 1 : 0;
