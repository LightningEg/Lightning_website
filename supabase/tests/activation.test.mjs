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
 const row=(await q(`select * from public.topup_requests where id=$1`,[r])).rows[0];
 if(who===ADMIN && aal==='aal2' && row?.status==='pending' && decision==='approved'){
  await as('authenticated',row.user_id,()=>q(`select public.accept_topup_terms($1,'manual-final-v1')`,[r]));
  await as('authenticated',row.user_id,()=>q(`select public.submit_topup_reference($1,'CUSTOMER-REF','manual-final-v1')`,[r]));
  await as('authenticated',ADMIN,()=>q(`select public.admin_record_topup_proof($1,'Reviewed customer receipt in WhatsApp')`,[r]));
 }
 return as('authenticated',who, async () => (await q(`select * from public.admin_review_topup($1,$2,$3,$4,'Checked incoming transfer')`,[r,decision,amount,ref])).rows[0]);
};
const P=await pkg();
const issue=(u,item='moss',version=1)=>as('authenticated',u,async()=>(await q(`select public.issue_activation_code($1,$2) d`,[item,version])).rows[0].d);
const redeem=(code,item='moss',version=1,role='service_role')=>as(role,null,async()=>(await q(`select public.redeem_activation_code($1,$2,$3) d`,[code,item,version])).rows[0].d);
await award(OWNER,1000,'claim-test');await buy(OWNER,'moss','claim-buy-0001');
await test('unshipped theme cannot issue codes; buying does not create a device limit',async()=>{
 await assert.rejects(issue(OWNER),/not available/);
 await q(`insert into public.bundled_item_versions(item_id,asset_version,enabled) values ('moss',1,true)`);
 await assert.rejects(issue(OTHER),/not owned/);
});
await test('strong one-time code, private hashed storage, no browser redemption',async()=>{
 const a=await issue(OWNER);assert.match(a.code,/^[A-F0-9]{8}(-[A-F0-9]{8}){3}$/);
 await as('authenticated',OWNER,async()=>{
  await assert.rejects(q(`select * from private.activation_tickets`),/permission denied/);
  await assert.rejects(q(`select public.redeem_activation_code($1,'moss',1)`,[a.code]),/permission denied/);
 });
 const row=(await q(`select * from private.activation_tickets`)).rows[0];
 assert.equal(row.code_hash.length,64);assert.ok(!JSON.stringify(row).includes(a.code));
 const inv=await redeem(a.code.toLowerCase());assert.equal(inv.account_id,OWNER);assert.deepEqual(inv.items,[{item_id:'moss',asset_version:1,deliveries:[]}]);
 await assert.rejects(redeem(a.code),/invalid or expired/);
});
await test('another device gets a fresh code without repurchase or wallet debit',async()=>{
 const before=await wallet(OWNER);const a=await issue(OWNER),b=await issue(OWNER);
 assert.notEqual(a.code,b.code);assert.deepEqual(await redeem(a.code),await redeem(b.code));
 assert.deepEqual(await wallet(OWNER),before);
});
await test('old app does not spend a code; expiry and disabled bundles fail closed',async()=>{
 const a=await issue(OWNER);await assert.rejects(redeem(a.code,'moss',2),/unsupported/);
 await redeem(a.code);
 const b=await issue(OWNER);await q(`update private.activation_tickets set expires_at=now()-interval '1 second' where redeemed_at is null`);
 await assert.rejects(redeem(b.code),/invalid or expired/);
 const c=await issue(OWNER);await q(`update public.bundled_item_versions set enabled=false`);
 await assert.rejects(redeem(c.code),/no longer available/);
 await q(`update public.bundled_item_versions set enabled=true`);
});
await test('payment proof needs explicit terms and owner screenshot acknowledgment before credit',async()=>{
 const r=await request(OTHER,P);
 await as('authenticated',OTHER,async()=>{
  await assert.rejects(q(`select public.submit_topup_reference($1,'BANK-001','manual-final-v1')`,[r.id]),/accept payment terms/);
  await q(`select public.accept_topup_terms($1,'manual-final-v1')`,[r.id]);
  await q(`select public.submit_topup_reference($1,'BANK-001','manual-final-v1')`,[r.id]);
  await assert.rejects(q(`select public.admin_record_topup_proof($1,'Saw receipt')`,[r.id]),/administrator/);
 });
 await q(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
 await as('authenticated',ADMIN,async()=>{
  await assert.rejects(q(`select public.admin_review_topup($1,'approved',10000,'BANK-001','Bank checked')`,[r.id]),/screenshot review/);
  await q(`select public.admin_record_topup_proof($1,'Saw image sent by customer in WhatsApp')`,[r.id]);
  await q(`select public.admin_review_topup($1,'approved',10000,'BANK-001','Actual incoming transfer checked')`,[r.id]);
 });
 assert.deepEqual(await wallet(OTHER),{balance:500,contribution_score:0});
});
console.log(`\n${passed} passed, ${failed} failed`);await db.close();process.exitCode=failed?1:0;
