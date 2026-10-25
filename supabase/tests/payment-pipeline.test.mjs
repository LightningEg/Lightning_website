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
const qrBytes=Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64');
const asAdmin=fn=>as('authenticated',ADMIN,fn);
const quote=async amount=>(await q(`select public.quote_topup_amount($1)d`,[amount])).rows[0].d;
const amountCheckout=async(u,amount=10000,k=key(),expected=null)=>{const v=expected||await quote(amount);return as('authenticated',u,async()=>(await q(`select * from public.create_amount_checkout($1,$2,true,$3,$4)`,[amount,k,v.coins,v.pricing_version])).rows[0]);};
const capture=(r,ref,amount,email=null,confirmed=true)=>asAdmin(()=>q(`select * from public.admin_record_bank_transfer($1,$2,now(),$3,'sender@instapay',$4,'Verified actual incoming funds',$5)`,[ref,amount,r,email,confirmed]));
const reserve=u=>async r=>(await as('authenticated',u,()=>q(`select public.reserve_topup_receipt($1)p`,[r]))).rows[0].p;
async function proof(u,r){const path=await reserve(u)(r.id);await as('authenticated',u,()=>q(`insert into storage.objects(bucket_id,name)values('topup-receipts',$1)`,[path]));return(await as('authenticated',u,()=>q(`select * from public.attach_topup_receipt($1,'sender@instapay','CUSTOMER-123',$2)`,[r.id,path]))).rows[0];}
const settle=r=>asAdmin(()=>q(`select * from public.admin_settle_topup_from_transfers($1,$2,$3,'Verified receipt and grouped bank transfers')`,[r.id,r.receipt_object_key,r.receipt_revision]));
let asset;
await test('amount pricing uses the agreed rate and bonuses without bundles',async()=>{
 for(const [amount,coins]of[[1000,50],[2000,100],[5000,250],[9900,495],[10000,525],[50000,2750],[100000,5750],[1000000,57500]])assert.equal((await quote(amount)).coins,coins);
 await assert.rejects(quote(900),/displayed minimum/);await assert.rejects(quote(1050),/whole EGP/);
});
await test('the receiving QR stays private until this member accepts a pending checkout',async()=>{
 asset=(await asAdmin(()=>q(`select public.admin_upload_payment_qr($1,'image/png')id`,[qrBytes]))).rows[0].id;
 await asAdmin(()=>q(`select public.admin_configure_checkout('project@instapay','Test Recipient',$1,true,'Payments are reviewed manually. Do not pay twice.')`,[asset]));
 const u=await newUser(),other=await newUser();
 assert.equal((await as('authenticated',u,()=>q(`select * from public.payment_settings`))).rows.length,0);
 await assert.rejects(as('authenticated',u,()=>q(`select * from private.payment_qr_assets`)),/permission denied/);
 await assert.rejects(as('anon',null,()=>q(`select public.checkout_qr($1)`,[key()])),/permission denied/);
 const available=(await as('authenticated',u,()=>q(`select public.checkout_availability()d`))).rows[0].d;assert.equal(available.enabled,true);assert.equal('qr_asset_id'in available,false);assert.equal('instapay_address'in available,false);
 const r=await amountCheckout(u);assert.equal(r.destination_qr_asset_id,asset);assert.equal(r.destination_qr_url,null);
 const response=(await as('authenticated',u,()=>q(`select public.checkout_qr($1)d,current_setting('response.headers',true) h`,[r.id]))).rows[0];assert.equal(response.d.data_url,'data:image/png;base64,'+qrBytes);assert.match(response.h,/no-store/);
 await assert.rejects(as('authenticated',other,()=>q(`select public.checkout_qr($1)`,[r.id])),/only inside/);
 await as('authenticated',u,()=>q(`select public.cancel_topup($1)`,[r.id]));await assert.rejects(as('authenticated',u,()=>q(`select public.checkout_qr($1)`,[r.id])),/only inside/);
});
await test('a matched payment without an uploaded receipt cannot be cancelled or hidden',async()=>{
 const u=await newUser(),r=await amountCheckout(u);
 await capture(r.id,'NO-RECEIPT-CANCEL',10000);
 await assert.rejects(as('authenticated',u,()=>q(`select public.cancel_topup($1)`,[r.id])),/received funds must be reconciled/);
 assert.equal((await q(`select status from public.topup_requests where id=$1`,[r.id])).rows[0].status,'pending');
});
await test('amount quotes survive retries and pricing changes; a stale fresh quote cannot open payment instructions',async()=>{
 const u=await newUser(),old=await quote(10000),r=await amountCheckout(u,10000,key(),old);
 await asAdmin(()=>q(`select public.admin_set_coin_pricing(6,10,10000,true,'[]'::jsonb)`));
 assert.equal((await amountCheckout(u,10000,r.request_key,old)).coins,525);
 await assert.rejects(amountCheckout(u,10000,key(),old),/quote changed/);
 assert.equal((await quote(10000)).coins,600);
 await asAdmin(()=>q(`select public.admin_set_coin_pricing(5,10,10000,true,'[{"minimum_egp":100,"bonus_percent":5},{"minimum_egp":500,"bonus_percent":10},{"minimum_egp":1000,"bonus_percent":15}]'::jsonb)`));
 assert.equal((await q(`select active,is_custom_quote from public.coin_packages where id=$1`,[r.package_id])).rows[0].active,false);
});
await test('partial payments reconcile to one credit and every incoming reference is consumed once',async()=>{
 const u=await newUser(),r=await amountCheckout(u),ref1='PARTIAL-'+key(),ref2='PARTIAL-'+key();
 await assert.rejects(capture(r.id,ref1,6000,null,false),/confirm actual incoming/);
 await capture(r.id,ref1,6000);await capture(r.id,ref1,6000);
 await assert.rejects(as('authenticated',u,()=>q(`select public.prepare_account_deletion('delete my account')`)),/pending payments/);
 const evidence=await proof(u,r);await assert.rejects(settle(evidence),/bank total/);
 await capture(r.id,ref2,4000);await settle(evidence);await settle(evidence);
 assert.deepEqual(await wallet(u),{balance:525,contribution_score:0});
 const rows=(await q(`select reference,credit_entry_id from public.bank_transfers where request_id=$1`,[r.id])).rows;assert.equal(rows.length,2);assert.ok(rows.every(t=>t.credit_entry_id!==null));assert.equal(rows[0].credit_entry_id,rows[1].credit_entry_id);
 const another=await amountCheckout(u);await assert.rejects(capture(another.id,ref1,6000),/already recorded/);
 const actualRef='CORRECTED-'+key();await asAdmin(()=>q(`select public.admin_add_bank_reference_alias($1,$2,'incoming','Corrected actual bank reference',true)`,[ref1,actualRef]));
 await assert.rejects(capture(null,actualRef,6000),/already used/);
 await assert.rejects(asAdmin(()=>q(`select public.admin_correct_bank_transfer($1,6000,$2,false,'Try to reuse a credited transfer')`,[ref1,another.id])),/credited transfer/);
 assert.equal((await as('authenticated',u,()=>q(`select * from public.bank_transfers`))).rows.length,0);
});
await test('unmatched and overpaid money needs a member-approved revised quote before crediting',async()=>{
 const u=await newUser(),email=`u${n}@example.test`,ref='UNMATCHED-'+key();await capture(null,ref,15000,email);
 await assert.rejects(as('authenticated',u,()=>q(`select public.prepare_account_deletion('delete my account')`)),/pending payments/);
 const r=await amountCheckout(u),evidence=await proof(u,r);
 await asAdmin(()=>q(`select public.admin_correct_bank_transfer($1,15000,$2,false,'Matched the transfer note to this checkout')`,[ref,r.id]));
 await assert.rejects(settle(evidence),/bank total/);
 const a=(await asAdmin(()=>q(`select * from public.admin_propose_topup_adjustment($1,787,'Offer coins for the actual 150 EGP received')`,[r.id]))).rows[0];
 const other=await newUser();await assert.rejects(as('authenticated',other,()=>q(`select public.accept_topup_adjustment($1,true)`,[a.id])),/your pending/);
 await as('authenticated',u,()=>q(`select public.accept_topup_adjustment($1,true)`,[a.id]));
 await assert.rejects(settle(evidence),/receipt changed/);
 const current=(await q(`select * from public.topup_requests where id=$1`,[r.id])).rows[0];assert.equal(current.price_piastres,15000);assert.equal(current.coins,787);
 await settle(current);assert.equal((await wallet(u)).balance,787);
});
await test('declined changes and externally returned payments cannot be credited, reassigned or silently lost',async()=>{
 const u=await newUser(),r=await amountCheckout(u),incoming='UNDERPAID-'+key();await capture(r.id,incoming,5000,`u${n}@example.test`);await proof(u,r);
 const a=(await asAdmin(()=>q(`select * from public.admin_propose_topup_adjustment($1,250,'Offer coins for actual funds received')`,[r.id]))).rows[0];
 await as('authenticated',u,()=>q(`select public.accept_topup_adjustment($1,false)`,[a.id]));assert.equal((await q(`select price_piastres from public.topup_requests where id=$1`,[r.id])).rows[0].price_piastres,10000);
 await assert.rejects(asAdmin(()=>q(`select public.admin_review_topup($1,'rejected',null,null,'Close without reconciling the funds')`,[r.id])),/received funds must be reconciled/);
 const outgoing='RETURNED-'+key();await assert.rejects(asAdmin(()=>q(`select public.admin_record_payment_return($1,$2,'Bank return completed',false)`,[r.id,outgoing])),/confirm the external/);
 await asAdmin(()=>q(`select public.admin_record_payment_return($1,$2,'Bank return completed',true)`,[r.id,outgoing]));
 await asAdmin(()=>q(`select public.admin_record_payment_return($1,$2,'Retry lost response',true)`,[r.id,outgoing]));
 assert.equal((await wallet(u)).balance,0);await assert.rejects(asAdmin(()=>q(`select public.admin_correct_bank_transfer($1,5000,null,false,'Try to reuse returned funds')`,[incoming])),/returned transfer/);
 await assert.rejects(capture(null,outgoing,5000),/outgoing return/);
 await as('authenticated',u,()=>q(`select public.prepare_account_deletion('delete my account')`));
 await as('authenticated',u,()=>q(`delete from storage.objects where split_part(name,'/',1)=$1`,[u]));
 await as('authenticated',u,()=>q(`select public.delete_my_account('delete my account')`));
 const kept=(await q(`select sender_address,email_note,amount_piastres from public.bank_transfers where reference=$1`,[incoming.toUpperCase()])).rows[0];assert.equal(kept.sender_address,null);assert.equal(kept.email_note,null);assert.equal(kept.amount_piastres,5000);
});
await test('social awards require verified ownership, backlink, current consent and a stable post revision',async()=>{
 const u=await newUser();await as('authenticated',u,()=>q(`update public.member_profiles set adult_confirmed=true,visibility='public'where user_id=$1`,[u]));
 const make=async(i)=>{const r=(await as('authenticated',u,()=>q(`select * from public.save_story(null,'Money habit',$1,$2,null)`,['A general budgeting habit I follow every payday.','https://www.linkedin.com/posts/pipeline-'+i+'-'+key()]))).rows[0];return(await as('authenticated',u,()=>q(`select * from public.submit_story($1,true)`,[r.id]))).rows[0];};
 const approve=(r,own=true,back=true)=>asAdmin(()=>q(`select public.admin_moderate_story($1,true,0,50,'Verified the general money-management post',$2,$3,$4,true)`,[r.id,own,back,r.submission_revision]));
 const first=await make(1);await assert.rejects(approve(first,false,true),/verify the post/);await assert.rejects(approve(first,true,false),/verify the post/);assert.equal((await wallet(u)).balance,0);
 await approve(first);await approve(first);assert.deepEqual(await wallet(u),{balance:50,contribution_score:0});
 await as('authenticated',u,()=>q(`select public.withdraw_story($1)`,[first.id]));
 for(let i=2;i<=3;i++){const r=await make(i);await approve(r);await as('authenticated',u,()=>q(`select public.withdraw_story($1)`,[r.id]));}
 assert.equal((await wallet(u)).balance,150);const fourth=await make(4);await assert.rejects(approve(fourth),/3 stories in 30 days/);
 const revised=(await as('authenticated',u,()=>q(`select * from public.save_story($1,'Revised money habit',$2,$3,null)`,[fourth.id,'A clearer summary of a general money-management routine.',fourth.linkedin_url]))).rows[0];
 await assert.rejects(approve(fourth),/post changed/);assert.ok(Number(revised.submission_revision)>Number(fourth.submission_revision));
 await asAdmin(()=>q(`select public.admin_ban_community_member($1,'Solicitation of prohibited financial services')`,[u]));
 await assert.rejects(as('authenticated',u,()=>q(`select public.submit_story($1,true)`,[fourth.id])),/community access is restricted/);
 assert.equal((await as('anon',null,()=>q(`select * from public.stories_feed(null,null)`))).rows.length,0);
 await asAdmin(()=>q(`select public.admin_restore_community_member($1,'Reviewed the appeal and restored community access')`,[u]));
 await as('authenticated',u,()=>q(`select public.submit_story($1,true)`,[fourth.id]));assert.equal((await wallet(u)).balance,150);
});
console.log(`\n${passed} passed, ${failed} failed`);await db.close();process.exitCode=failed?1:0;
