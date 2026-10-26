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
await test('a ticket takes money recorded without one: it lists the likely transfers and attaching the right one credits',async()=>{
 const M=await newUser();
 const c=(await as('authenticated',M,()=>q(`select * from public.create_checkout($1,$2,true)`,[P,key()]))).rows[0];
 const k=(await as('authenticated',M,()=>q(`select public.reserve_topup_receipt($1) as path`,[c.id]))).rows[0].path;
 await as('authenticated',M,()=>q(`insert into storage.objects(bucket_id,name)values('topup-receipts',$1)`,[k]));
 const r=(await as('authenticated',M,()=>q(`select * from public.attach_topup_receipt($1,'01009998887',null,$2)`,[c.id,k]))).rows[0];
 // the owner logged two incoming payments in the older journal before matching anything
 await as('authenticated',ADMIN,()=>q(`select public.admin_record_bank_transfer('IPN-5551',4000,now(),null,'01009998887',null,'Seen in my InstaPay app',true)`));
 await as('authenticated',ADMIN,()=>q(`select public.admin_record_bank_transfer('IPN-5552',6000,now(),null,'01009998887',null,'Seen in my InstaPay app',true)`));
 await as('authenticated',ADMIN,()=>q(`select public.admin_record_bank_transfer('IPN-5553',3000,now(),null,'someone@instapay',null,'Seen in my InstaPay app',true)`));
 await assert.rejects(as('authenticated',M,()=>q(`select public.admin_ticket_money($1)`,[c.id])),/admin|permission|MFA/i,'members cannot read the journal');
 const money=(await as('authenticated',ADMIN,()=>q(`select public.admin_ticket_money($1) d`,[c.id]))).rows[0].d;
 assert.deepEqual(money.candidates.map(x=>x.reference).sort(),['IPN-5551','IPN-5552'],'only money that looks like this ticket');
 assert.ok(money.candidates[0].why.includes('same sender'));
 assert.deepEqual(money.on_ticket,[]);
 const attach=(ref,who=ADMIN)=>as('authenticated',who,async()=>(await q(`select public.admin_attach_transfer($1,$2,null,$3,$4) d`,[c.id,ref,k,r.receipt_revision])).rows[0].d);
 await assert.rejects(attach('IPN-5551',M),/admin|permission|MFA/i);
 const part=await attach('IPN-5551');
 assert.equal(part.status,'amount_differs');assert.equal(Number(part.received_piastres),4000);
 assert.equal((await wallet(M))?.balance??0,0,'part of the money credits nothing');
 await assert.rejects(attach('IPN-5551'),/already on a ticket/);
 const done=await attach('IPN-5552');
 assert.equal(done.status,'approved');
 assert.equal((await wallet(M)).balance,500,'both payments together match the quote: credited once');
 assert.equal((await q(`select count(*)::int c from public.bank_transfers where reference like 'TKT-%' and request_id=$1`,[c.id])).rows[0].c,0,'no second record of the same money');
 const after=(await as('authenticated',ADMIN,()=>q(`select public.admin_ticket_money($1) d`,[c.id]))).rows[0].d;
 assert.deepEqual(after.on_ticket.map(x=>x.reference),['IPN-5551','IPN-5552']);
 assert.deepEqual(after.candidates,[],'a credited ticket offers nothing more');
});
await test('a ticket records when, who and the reference; the same reference can never pay a second ticket',async()=>{
 const open=async()=>{const M=await newUser();const c=(await as('authenticated',M,()=>q(`select * from public.create_checkout($1,$2,true)`,[P,key()]))).rows[0];
  const k=(await as('authenticated',M,()=>q(`select public.reserve_topup_receipt($1) as path`,[c.id]))).rows[0].path;
  await as('authenticated',M,()=>q(`insert into storage.objects(bucket_id,name)values('topup-receipts',$1)`,[k]));
  const r=(await as('authenticated',M,()=>q(`select * from public.attach_topup_receipt($1,'01001234567',null,$2)`,[c.id,k]))).rows[0];return {M,c,k,r};};
 const confirm=(t,amount,ref,at=null,sender=null)=>as('authenticated',ADMIN,async()=>(await q(`select public.admin_confirm_topup($1,$2,$3,$4,$5,$6,$7,$8) d`,[t.c.id,amount,null,t.k,t.r.receipt_revision,at,sender,ref])).rows[0].d);
 const a=await open(),b=await open();
 assert.equal((await confirm(a,8000,null)).status,'amount_differs','first without a reference');
 const ok=await confirm(a,10000,'ipn 7788 1122','2026-10-25T09:30:00Z','sara@instapay');
 assert.equal(ok.status,'approved');assert.equal((await wallet(a.M)).balance,500);
 const rows=(await q(`select reference,amount_piastres,voided,sender_address,received_at from public.bank_transfers where request_id=$1 order by reference`,[a.c.id])).rows;
 assert.deepEqual(rows.map(x=>[x.reference,x.voided]),[['IPN77881122',false],['TKT-'+a.c.id.replace(/-/g,'').slice(0,20).toUpperCase(),true]],'the reference replaces the unreferenced entry');
 assert.equal(rows[0].sender_address,'sara@instapay');assert.equal(new Date(rows[0].received_at).toISOString(),'2026-10-25T09:30:00.000Z');
 await assert.rejects(confirm(b,10000,'IPN77881122'),/already on another ticket/);
 assert.equal((await wallet(b.M))?.balance??0,0,'nothing credited twice');
 await assert.rejects(confirm(b,10000,'IPN-9',null),/6 to 100/);
 await assert.rejects(confirm(b,10000,'IPN-990011',new Date(Date.now()+864e5).toISOString()),/future/);
});
await test('one owner account: a second can never be added, and the owner removes any extra one',async()=>{
 const EXTRA=await newUser();
 await assert.rejects(q(`insert into public.admin_roles(user_id,role) values ($1,'admin')`,[EXTRA]),/one owner account/);
 // an older database may already list two: simulate it, then keep only the verified owner
 await q(`alter table public.admin_roles disable trigger one_owner_account`);await q(`insert into public.admin_roles(user_id,role) values ($1,'admin')`,[EXTRA]);await q(`alter table public.admin_roles enable trigger one_owner_account`);
 const seen=(await as('authenticated',ADMIN,()=>q(`select public.admin_owner_accounts() d`))).rows[0].d;
 assert.equal(Number(seen.count),2);assert.deepEqual(seen.others.map(o=>o.email),[(await q(`select email from auth.users where id=$1`,[EXTRA])).rows[0].email]);
 await assert.rejects(as('authenticated',OTHER,()=>q(`select public.admin_keep_only_me()`)),/MFA|admin/i,'members cannot');
 await q(`select set_config('request.jwt.claims','{"aal":"aal1"}',false)`);
 await assert.rejects(as('authenticated',EXTRA,()=>q(`select public.admin_keep_only_me()`)),/MFA/,'needs a verified session');
 await q(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
 assert.equal((await as('authenticated',ADMIN,()=>q(`select public.admin_keep_only_me() n`))).rows[0].n,1);
 assert.deepEqual((await q(`select user_id from public.admin_roles`)).rows.map(x=>x.user_id),[ADMIN]);
 assert.equal((await as('authenticated',EXTRA,()=>q(`select public.is_admin() a`))).rows[0].a,false,'the other account no longer sees the console');
});
await test('the simple InstaPay checkout: copy our details, pay, send date, amount and where you paid from; the owner confirms without a receipt',async()=>{
 const M=await newUser(),email=(await q(`select email from auth.users where id=$1`,[M])).rows[0].email;
 const d=(await as('authenticated',M,()=>q(`select public.topup_payment_details() d`))).rows[0].d;
 assert.equal(d.enabled,true);assert.equal(d.note_email,email,'their own email for the transfer note');assert.ok(d.instapay_address);assert.ok(d.pricing_version);
 const quote=(await as('authenticated',M,()=>q(`select public.quote_topup_amount(10000) d`))).rows[0].d;
 const k=key(),send=(payer,on,amount=10000,coins=quote.coins,who=M)=>as('authenticated',who,async()=>(await q(`select * from public.submit_instapay_topup($1,$2,true,$3,$4,$5,$6)`,[amount,k,coins,d.pricing_version,payer,on])).rows[0]);
 const today=(await q(`select (now() at time zone 'Africa/Cairo')::date::text d`)).rows[0].d;
 await assert.rejects(send('hello',today),/InstaPay address or wallet phone/);
 await assert.rejects(send('sara@instapay','2020-01-01'),/last 30 days/);
 const r=await send('Sara.M@InstaPay',today);
 assert.equal(r.payer_instapay_address,'sara.m@instapay');assert.equal(r.price_piastres,10000);assert.equal(r.receipt_object_key,null);assert.ok(r.details_submitted_at);
 assert.equal((await send('Sara.M@InstaPay',today)).id,r.id,'sending again opens no second ticket');
 const dash=(await as('authenticated',ADMIN,()=>q(`select public.admin_dashboard() d`))).rows[0].d;
 assert.ok(Number(dash.needs.receipts)>=1,'Today counts it as ready to confirm');
 const fresh=(await q(`select * from public.topup_requests where id=$1`,[r.id])).rows[0];
 const confirm=(amount,ref=null)=>as('authenticated',ADMIN,async()=>(await q(`select public.admin_confirm_topup($1,$2,null,null,$3,null,null,$4) d`,[r.id,amount,fresh.receipt_revision,ref])).rows[0].d);
 assert.equal((await confirm(6000,'IPN-600001')).status,'amount_differs');
 assert.equal((await wallet(M))?.balance??0,0);
 const ok=await confirm(4000,'IPN-400001');
 assert.equal(ok.status,'approved','two parts with their own references add up');
 assert.equal((await wallet(M)).balance,quote.coins);
 // a checkout with no details sent yet cannot be confirmed
 const bare=(await as('authenticated',M,()=>q(`select * from public.create_amount_checkout(10000,$1,true,$2,$3)`,[key(),quote.coins,d.pricing_version]))).rows[0];
 await assert.rejects(as('authenticated',ADMIN,()=>q(`select public.admin_confirm_topup($1,10000,null,null,$2,null,null,'IPN-700001')`,[bare.id,bare.receipt_revision])),/not sent their payment details/);
});
await test('a ticket holds payments: each Record adds one, a retry records nothing new, and the owner can close it for what arrived',async()=>{
 const M=await newUser();
 const d=(await as('authenticated',M,()=>q(`select public.topup_payment_details() d`))).rows[0].d;
 const quote=(await as('authenticated',M,()=>q(`select public.quote_topup_amount(10000) d`))).rows[0].d;
 const today=(await q(`select (now() at time zone 'Africa/Cairo')::date::text d`)).rows[0].d;
 const r=(await as('authenticated',M,()=>q(`select * from public.submit_instapay_topup(10000,$1,true,$2,$3,'sara@instapay',$4)`,[key(),quote.coins,d.pricing_version,today]))).rows[0];
 const record=(amount,entry,ref=null,who=ADMIN)=>as('authenticated',who,async()=>(await q(`select public.admin_record_ticket_payment($1,$2,null,null,$3,$4,null,$5) d`,[r.id,amount,ref,entry,r.receipt_revision])).rows[0].d);
 const close=(coins,msg,who=ADMIN)=>as('authenticated',who,async()=>(await q(`select public.admin_close_ticket_for_received($1,$2,$3,null,$4) d`,[r.id,coins,msg,r.receipt_revision])).rows[0].d);
 const k1=key(),k2=key();
 await assert.rejects(record(4000,k1,null,M),/admin|permission|MFA/i,'members cannot record');
 assert.equal(Number((await record(4000,k1)).received_piastres),4000);
 assert.equal(Number((await record(4000,k1)).received_piastres),4000,'the same payment sent twice is recorded once');
 await assert.rejects(record(5000,k1),/already on this ticket/);
 const two=await record(3000,k2);
 assert.equal(two.status,'amount_differs');assert.equal(Number(two.received_piastres),7000,'a second payment adds, never overwrites');
 assert.equal((await wallet(M))?.balance??0,0);
 const money=(await as('authenticated',ADMIN,()=>q(`select public.admin_ticket_money($1) d`,[r.id]))).rows[0].d;
 assert.deepEqual(money.on_ticket.map(x=>x.amount_piastres).sort(),[3000,4000]);assert.ok(money.on_ticket.every(x=>x.recorded_at&&x.reference.startsWith('TKT-')));
 await assert.rejects(close(350,'Thanks',M),/admin|permission|MFA/i,'members cannot close');
 await assert.rejects(close(350,'Hi'),/short message/);
 await assert.rejects(close(0,'This is all that arrived'),/between 1/);
 const done=await close(350,'We received 70 EGP and credited 350 coins for it.');
 assert.equal(done.status,'approved');assert.equal((await wallet(M)).balance,350);
 const after=(await q(`select status,coins,price_piastres,review_note from public.topup_requests where id=$1`,[r.id])).rows[0];
 assert.deepEqual([after.status,after.coins,after.price_piastres,after.review_note],['approved',350,7000,'We received 70 EGP and credited 350 coins for it.'],'the member reads the message in their history');
 assert.equal((await q(`select count(*)::int c from public.topup_adjustments where request_id=$1 and status='accepted' and original_piastres=10000`,[r.id])).rows[0].c,1,'the first quote is kept');
 assert.equal((await close(350,'Again, by mistake')).status,'approved');assert.equal((await wallet(M)).balance,350,'never credits twice');
 assert.equal((await record(3000,key())).status,'approved','a closed ticket takes no more money');
 assert.equal((await q(`select count(*)::int c from public.bank_transfers where request_id=$1`,[r.id])).rows[0].c,2);
 // the full amount in one payment credits the quote, as before
 const full=(await as('authenticated',M,()=>q(`select * from public.submit_instapay_topup(10000,$1,true,$2,$3,'sara@instapay',$4)`,[key(),quote.coins,d.pricing_version,today]))).rows[0];
 const paid=await as('authenticated',ADMIN,async()=>(await q(`select public.admin_record_ticket_payment($1,10000,null,null,'IPN-880001',$2,null,$3) d`,[full.id,key(),full.receipt_revision])).rows[0].d);
 assert.equal(paid.status,'approved');assert.equal(paid.reference,'IPN-880001');assert.equal((await wallet(M)).balance,350+quote.coins);
});
console.log(`\n${passed} passed, ${failed} failed`);await db.close();process.exitCode=failed?1:0;
