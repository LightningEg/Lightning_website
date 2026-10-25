// Manual payment security and wallet integration; isolated Postgres, no live payments.
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

let n = 100;
const newUser = async () => { const id = uid(++n); await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `u${n}@example.test`]); return id; };
const award = (user, amount, source) => as('service_role', null, () => q(
  `select * from public.award_coins($1, 'contribution_award', $2, 'pr', $3, 'Merged PR')`, [user, amount, source]));
const buy = (user, item, key) => as('authenticated', user, () => q(`select * from public.purchase_item_at_price($1, coalesce((select price from public.catalog_items where id=$1),0), $2)`, [item, key]));
const equip = (user, item) => as('authenticated', user, () => q(`select * from public.equip_item($1)`, [item]));
const catalog = (role, user) => as(role, user, async () => (await q(`select * from public.market_catalog()`)).rows);
const wallet = async user => (await q(`select balance, contribution_score from public.wallets where user_id = $1`, [user])).rows[0];

await q(`insert into auth.users (id, email) values ($1, 'owner@example.test'), ($2, 'other@example.test')`, [OWNER, OTHER]);

const ADMIN = await newUser();
await q(`insert into public.admin_roles(user_id, role) values ($1,'admin')`, [ADMIN]);
const pkg = async (coins = 500, active = true) => (await q(`insert into public.coin_packages(name,coins,price_piastres,active) values ('Test only',$1,10000,$2) returning id`, [coins,active])).rows[0].id;
const key = () => crypto.randomUUID();
const request = (u,p,k=key()) => as('authenticated',u,async () => (await q(`select * from public.request_topup($1,$2)`,[p,k])).rows[0]);
 await q(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
const P=await pkg();
await as('authenticated',ADMIN,()=>q(`select public.admin_configure_payments('project@instapay','Test recipient','https://example.test/qr.png',true)`));
let checkout,path;
await test('checkout requires consent and snapshots email, destination and package price',async()=>{
 await assert.rejects(as('authenticated',OWNER,()=>q(`select public.create_checkout($1,$2,false)`,[P,key()])),/terms/);
 checkout=(await as('authenticated',OWNER,()=>q(`select * from public.create_checkout($1,$2,true)`,[P,key()]))).rows[0];
 assert.equal(checkout.transfer_note_email,'owner@example.test');assert.equal(checkout.destination_address,'project@instapay');assert.ok(checkout.terms_accepted_at);
 await q(`update public.payment_settings set instapay_address='changed@instapay'`);
 const again=(await as('authenticated',OWNER,()=>q(`select * from public.create_checkout($1,$2,true)`,[P,checkout.request_key]))).rows[0];assert.equal(again.destination_address,'project@instapay');
});
await test('receipt bucket is private; other members cannot insert into or read my checkout',async()=>{
 const b=(await q(`select * from storage.buckets where id='topup-receipts'`)).rows[0];assert.equal(b.public,false);assert.equal(Number(b.file_size_limit),5242880);
 path=(await as('authenticated',OWNER,()=>q(`select public.reserve_topup_receipt($1) as path`,[checkout.id]))).rows[0].path;
 await assert.rejects(as('authenticated',OTHER,()=>q(`insert into storage.objects(bucket_id,name)values('topup-receipts',$1)`,[path])),/row-level security/);
 await as('authenticated',OWNER,()=>q(`insert into storage.objects(bucket_id,name)values('topup-receipts',$1)`,[path]));
 assert.equal((await as('authenticated',OTHER,()=>q(`select * from storage.objects`))).rows.length,0);
 await as('authenticated',OWNER,()=>q(`select public.attach_topup_receipt($1,'payer@instapay','PAYMENT-123',$2)`,[checkout.id,path]));
 assert.equal((await wallet(OWNER)).balance,0);
});
await test('replacement image invalidates prior review; only actual settlement approval credits coins',async()=>{
 await as('authenticated',ADMIN,()=>q(`select public.admin_review_uploaded_receipt($1,'Checked receipt image',(select receipt_object_key from public.topup_requests where id=$1),(select receipt_revision from public.topup_requests where id=$1))`,[checkout.id]));
 const second=(await as('authenticated',OWNER,()=>q(`select public.reserve_topup_receipt($1) as path`,[checkout.id]))).rows[0].path;await as('authenticated',OWNER,()=>q(`insert into storage.objects(bucket_id,name)values('topup-receipts',$1)`,[second]));
 await as('authenticated',OWNER,()=>q(`select public.attach_topup_receipt($1,'payer@instapay','PAYMENT-123',$2)`,[checkout.id,second]));
 await assert.rejects(as('authenticated',ADMIN,()=>q(`select public.admin_review_uploaded_receipt($1,'Stale image',$2,0)`,[checkout.id,path])),/receipt changed/);
 await assert.rejects(as('authenticated',ADMIN,()=>q(`select public.admin_review_topup($1,'approved',10000,'SETTLED-123','Checked bank')`,[checkout.id])),/receipt review/);
 await as('authenticated',ADMIN,()=>q(`select public.admin_review_uploaded_receipt($1,'Rechecked replacement receipt',(select receipt_object_key from public.topup_requests where id=$1),(select receipt_revision from public.topup_requests where id=$1))`,[checkout.id]));
 await assert.rejects(as('authenticated',ADMIN,()=>q(`select public.admin_review_topup($1,'approved',9999,'SETTLED-123','Checked bank')`,[checkout.id])),/amount mismatch|bank total/);
 for(let n=0;n<2;n++)await as('authenticated',ADMIN,()=>q(`select public.admin_settle_topup($1,(select receipt_object_key from public.topup_requests where id=$1),(select receipt_revision from public.topup_requests where id=$1),10000,'SETTLED-123','Confirmed actual incoming transfer')`,[checkout.id]));
 assert.deepEqual(await wallet(OWNER),{balance:500,contribution_score:0});
});
await test('a receipt needs no payment reference, and the sender may be a wallet phone number written any common way',async()=>{
 const c=(await as('authenticated',OTHER,()=>q(`select * from public.create_checkout($1,$2,true)`,[P,key()]))).rows[0];
 const p2=(await as('authenticated',OTHER,()=>q(`select public.reserve_topup_receipt($1) as path`,[c.id]))).rows[0].path;
 await as('authenticated',OTHER,()=>q(`insert into storage.objects(bucket_id,name)values('topup-receipts',$1)`,[p2]));
 for(const bad of ['hello','01234','abc@','+1 202 555 0100','01x0123456789'])
  await assert.rejects(as('authenticated',OTHER,()=>q(`select public.attach_topup_receipt($1,$2,null,$3)`,[c.id,bad,p2])),/InstaPay address or wallet phone number/,bad);
 const r=(await as('authenticated',OTHER,()=>q(`select * from public.attach_topup_receipt($1,'+20 100-123 4567',null,$2)`,[c.id,p2]))).rows[0];
 assert.equal(r.payer_instapay_address,'01001234567');
 assert.match(r.customer_payment_reference,/^WEB-[0-9A-F]{10}$/,'the request keeps a short id of its own');
 const again=(await as('authenticated',OTHER,()=>q(`select * from public.attach_topup_receipt($1,'Sara.M@InstaPay','',$2)`,[c.id,p2]))).rows[0];
 assert.equal(again.payer_instapay_address,'sara.m@instapay');
 assert.equal(again.customer_payment_reference,r.customer_payment_reference,'the id stays the same when the sender changes');
 await as('authenticated',ADMIN,()=>q(`select public.admin_review_uploaded_receipt($1,'Matched sender and amount in my InstaPay app',$2,(select receipt_revision from public.topup_requests where id=$1))`,[c.id,p2]));
});
await test('a ticket: the owner confirms the amount that arrived; the right amount credits once, a different one credits nothing',async()=>{
 const M=await newUser();
 const c=(await as('authenticated',M,()=>q(`select * from public.create_checkout($1,$2,true)`,[P,key()]))).rows[0];
 const k=(await as('authenticated',M,()=>q(`select public.reserve_topup_receipt($1) as path`,[c.id]))).rows[0].path;
 await as('authenticated',M,()=>q(`insert into storage.objects(bucket_id,name)values('topup-receipts',$1)`,[k]));
 const r=(await as('authenticated',M,()=>q(`select * from public.attach_topup_receipt($1,'01001234567',null,$2)`,[c.id,k]))).rows[0];
 const confirm=(amount,note=null,rev=r.receipt_revision,who=ADMIN)=>as('authenticated',who,async()=>(await q(`select public.admin_confirm_topup($1,$2,$3,$4,$5) d`,[c.id,amount,note,k,rev])).rows[0].d);
 await assert.rejects(confirm(10000,null,r.receipt_revision,M),/admin|permission|MFA|verified/i,'members cannot confirm');
 await assert.rejects(confirm(10000,null,Number(r.receipt_revision)+1),/receipt changed/);
 const short=await confirm(8000,'Only 80 arrived, ref IPN-1');
 assert.equal(short.status,'amount_differs');assert.equal(Number(short.received_piastres),8000);
 assert.equal((await wallet(M))?.balance??0,0,'nothing credited');
 const ok=await confirm(10000,'Checked in my InstaPay app, ref IPN-1');
 assert.equal(ok.status,'approved');
 assert.equal((await wallet(M)).balance,500);
 assert.equal((await q(`select count(*)::int c from public.bank_transfers where request_id=$1`,[c.id])).rows[0].c,1,'one transfer per ticket, corrected in place');
 assert.equal((await confirm(10000)).status,'approved');
 assert.equal((await wallet(M)).balance,500,'confirming again never credits twice');
});
console.log(`\n${passed} passed, ${failed} failed`);await db.close();process.exitCode=failed?1:0;
