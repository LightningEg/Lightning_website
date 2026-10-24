// Manual payment security and wallet integration; isolated Postgres, no live payments.
import assert from 'node:assert/strict';
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
for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  await db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
}

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
const award = (user, amount, source) => as('service_role', null, () => q(
  `select * from public.award_coins($1, 'contribution_award', $2, 'pr', $3, 'Merged PR')`, [user, amount, source]));
const buy = (user, item, key) => as('authenticated', user, () => q(`select * from public.purchase_item($1, $2)`, [item, key]));
const equip = (user, item) => as('authenticated', user, () => q(`select * from public.equip_item($1)`, [item]));
const catalog = (role, user) => as(role, user, async () => (await q(`select * from public.market_catalog()`)).rows);
const wallet = async user => (await q(`select balance, contribution_score from public.wallets where user_id = $1`, [user])).rows[0];

await q(`insert into auth.users (id, email) values ($1, 'owner@example.test'), ($2, 'other@example.test')`, [OWNER, OTHER]);

const ADMIN = await newUser();
await q(`insert into public.admin_roles(user_id, role) values ($1,'admin')`, [ADMIN]);
const pkg = async (coins = 500, active = true) => (await q(`insert into public.coin_packages(name,coins,price_piastres,active) values ('Test only',$1,10000,$2) returning id`, [coins,active])).rows[0].id;
const key = () => crypto.randomUUID();
const request = (u,p,k=key()) => as('authenticated',u,async () => (await q(`select * from public.request_topup($1,$2)`,[p,k])).rows[0]);
const review = async (r,decision='approved',amount=10000,ref='BANK-000001',who=ADMIN,aal='aal2') => {
 await q(`select set_config('request.jwt.claims',$1,false)`,[JSON.stringify({aal})]);
 return as('authenticated',who, async () => (await q(`select * from public.admin_review_topup($1,$2,$3,$4,'Checked incoming transfer')`,[r,decision,amount,ref])).rows[0]);
};
const P = await pkg();
await test('requests are private, do not credit coins, and retry returns the same reference',async () => {
 const k=key(),r=await request(OWNER,P,k);
 assert.equal((await request(OWNER,P,k)).id,r.id);
 assert.deepEqual(await wallet(OWNER),{balance:0,contribution_score:0});
 await as('authenticated',OTHER,async () => assert.equal((await q(`select * from public.topup_requests`)).rows.length,0));
 await as('anon',null,async () => {
  await assert.rejects(q(`select * from public.topup_requests`),/permission denied/);
  await assert.rejects(q(`select public.request_topup($1,$2)`,[P,key()]),/permission denied/);
 });
 await as('authenticated',OWNER,async () => {
  await assert.rejects(q(`update public.topup_requests set status='approved'`),/permission denied/);
  await assert.rejects(q(`insert into public.coin_packages(name,coins,price_piastres) values ('Forged',1000,1)`),/permission denied/);
 });
 await assert.rejects(request(OWNER,await pkg(100),k),/another package/);
});
await test('inactive packages are closed and prices/coins are snapshotted',async () => {
 await assert.rejects(request(OTHER,await pkg(20,false)),/not available/);
 const p=await pkg(), r=await request(OTHER,p);
 await q(`update public.coin_packages set coins=999,price_piastres=20000,active=false where id=$1`,[p]);
 const old=await request(OTHER,p,r.request_key);
 assert.equal(old.coins,500); assert.equal(old.price_piastres,10000);
 await review(r.id,'approved',10000,'SNAPSHOT-01');
 assert.deepEqual(await wallet(OTHER),{balance:500,contribution_score:0});
});
await test('only an MFA-verified administrator can credit a payment',async () => {
 const u=await newUser(),r=await request(u,P);
 await assert.rejects(review(r.id,'approved',10000,'AUTH-00001',u),/administrator/);
 await assert.rejects(review(r.id,'approved',10000,'AUTH-00001',ADMIN,'aal1'),/MFA/);
 await assert.rejects(review(r.id,'approved',9999,'AUTH-00001'),/amount mismatch/);
 await assert.rejects(review(r.id,'approved',null,'AUTH-00001'),/amount mismatch/);
 await assert.rejects(review(r.id,'approved',10000,''),/reference required/);
 assert.equal((await wallet(u)).balance,0);
});
await test('verified approval posts once, normalizes bank reference, and never increases rank',async () => {
 const u=await newUser(),r=await request(u,P);
 const a=await review(r.id,'approved',10000,' bank-00002 ');
 const b=await review(r.id,'approved',10000,'BANK-00002');
 assert.equal(a.ledger_entry_id,b.ledger_entry_id);
 assert.deepEqual(await wallet(u),{balance:500,contribution_score:0});
 assert.equal((await q(`select count(*)::int c from public.audit_log where target_id=$1`,[r.id])).rows[0].c,1);
 await assert.rejects(review(r.id,'approved',10000,'BANK-CHANGED'),/already reviewed/);
 await assert.rejects(review(r.id,'rejected'),/already reviewed/);
});
await test('reusing a bank transfer on another request rolls back the whole credit',async () => {
 const u=await newUser(),r=await request(u,P);
 await assert.rejects(review(r.id,'approved',10000,'bank-00002'),/unique/);
 assert.equal((await wallet(u)).balance,0);
 assert.equal((await q(`select status from public.topup_requests where id=$1`,[r.id])).rows[0].status,'pending');
 assert.equal((await q(`select count(*)::int c from public.ledger_entries where user_id=$1`,[u])).rows[0].c,0);
});
await test('coins buy existing marketplace items; repeat restores never debit or expire ownership',async () => {
 const u=await newUser(),r=await request(u,P);
 await review(r.id,'approved',10000,'SPEND-00001');
 await buy(u,'moss','topup-purchase-001');
 assert.deepEqual(await wallet(u),{balance:350,contribution_score:0});
 await q(`update public.catalog_items set active=false where id='moss'`);
 for(let i=0;i<4;i++) {
  const data=(await as('authenticated',u,() => q(`select public.restore_store_inventory() d`))).rows[0].d;
  assert.equal(data.account_id,u); assert.deepEqual(data.items,[{item_id:'moss',asset_version:1,deliveries:[]}]);
 }
 const other=(await as('authenticated',OWNER,() => q(`select public.restore_store_inventory() d`))).rows[0].d;
 assert.deepEqual(other.items,[]);
 assert.deepEqual(await wallet(u),{balance:350,contribution_score:0});
 await q(`update public.catalog_items set active=true where id='moss'`);
});
await test('cancellation and rejection cannot mint coins or later be approved',async () => {
 const u=await newUser(),r=await request(u,P);
 await assert.rejects(as('authenticated',OTHER,() => q(`select public.cancel_topup($1)`,[r.id])),/not found/);
 await as('authenticated',u,() => q(`select public.cancel_topup($1)`,[r.id]));
 await assert.rejects(review(r.id),/already reviewed/);
 const s=await request(u,P);
 await review(s.id,'rejected'); await review(s.id,'rejected');
 await assert.rejects(review(s.id),/already reviewed/);
 assert.equal((await wallet(u)).balance,0);
});
await test('pending limit is enforced; cancellation makes room and retries still work',async () => {
 const u=await newUser();let first;
 for(let i=0;i<20;i++){const r=await request(u,P);first??=r;}
 assert.equal((await request(u,P,first.request_key)).id,first.id);
 await assert.rejects(request(u,P),/too many pending/);
 await as('authenticated',u,() => q(`select public.cancel_topup($1)`,[first.id]));
 await request(u,P);
});
await test('payment history follows account export and is retained anonymously after deletion',async () => {
 const u=await newUser(),r=await request(u,P);
 await review(r.id,'approved',10000,'DELETE-00001');
 // Add full auth metadata used by the existing export function to this test stub.
 await q(`alter table auth.users add column created_at timestamptz default now(), add column last_sign_in_at timestamptz`);
 const data=(await as('authenticated',u,() => q(`select public.export_my_data() d`))).rows[0].d;
 assert.equal(data.topup_requests[0].id,r.id);
 await as('authenticated',u,() => q(`select public.delete_my_account('delete my account')`));
 assert.equal((await q(`select user_id from public.topup_requests where id=$1`,[r.id])).rows[0].user_id,null);
 assert.equal((await q(`select user_id from public.ledger_entries where source_id=$1`,[r.id])).rows[0].user_id,null);
});
await test('reconciliation is admin-only and reports zero drift',async () => {
 await assert.rejects(as('authenticated',OWNER,() => q(`select * from public.admin_wallet_reconciliation()`)),/administrator/);
 const rows=(await as('authenticated',ADMIN,() => q(`select * from public.admin_wallet_reconciliation()`))).rows;
 assert.ok(rows.every(r=>Number(r.difference)===0));
});
console.log(`\n${passed} passed, ${failed} failed`);
await db.close();process.exitCode=failed?1:0;
