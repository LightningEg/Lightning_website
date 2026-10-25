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
const checkoutFor=(u,p=P,k=key())=>as('authenticated',u,async()=>(await q(`select * from public.create_checkout($1,$2,true)`,[p,k])).rows[0]);
const reserve=(u,r)=>as('authenticated',u,async()=>(await q(`select public.reserve_topup_receipt($1) p`,[r])).rows[0].p);
const upload=(u,path)=>as('authenticated',u,()=>q(`insert into storage.objects(bucket_id,name)values('topup-receipts',$1)`,[path]));
const attach=(u,r,path,ref='PAYMENT-123')=>as('authenticated',u,async()=>(await q(`select * from public.attach_topup_receipt($1,'payer@instapay',$2,$3)`,[r,ref,path])).rows[0]);
const settle=(r,revision=r.receipt_revision,amount=10000,ref='BANK-'+key())=>as('authenticated',ADMIN,async()=>(await q(`select * from public.admin_settle_topup($1,$2,$3,$4,$5,'Verified actual incoming transfer')`,[r.id,r.receipt_object_key,revision,amount,ref])).rows[0]);
await test('purchase quotes fail closed when price changes; retries restore the original purchase',async()=>{
 const u=await newUser();await as('authenticated',ADMIN,()=>q(`select public.admin_credit_account($1,300,0,'Test wallet funding',$2)`,[`u${n}@example.test`,key()]));
 await q(`update public.catalog_items set price=125 where id='paper'`);
 await assert.rejects(as('authenticated',u,()=>q(`select public.purchase_item_at_price('paper',100,'quote-test-0001')`)),/price changed/);
 assert.equal((await wallet(u)).balance,300);
 await assert.rejects(as('authenticated',u,()=>q(`select public.purchase_item('paper','unsafe-client-0001')`)),/permission denied/);
 const first=(await as('authenticated',u,()=>q(`select * from public.purchase_item_at_price('paper',125,'quote-test-0001')`))).rows[0];
 await q(`update public.catalog_items set price=200 where id='paper'`);
 const replay=(await as('authenticated',u,()=>q(`select * from public.purchase_item_at_price('paper',125,'quote-test-0001')`))).rows[0];
 assert.equal(first.id,replay.id);assert.equal((await wallet(u)).balance,175);
 const inv=(await as('authenticated',u,()=>q(`select public.restore_store_inventory() d`))).rows[0].d;assert.equal(inv.items[0].item_id,'paper');
});
await test('package creation retries cannot duplicate rows; retiring a package preserves existing quotes',async()=>{
 const k=key();const save=(coins=600)=>as('authenticated',ADMIN,()=>q(`select * from public.admin_save_coin_package('Test package',$1,15000,true,$2)`,[coins,k]));
 const a=(await save()).rows[0],b=(await save()).rows[0];assert.equal(a.id,b.id);await assert.rejects(save(601),/already used/);
 const u=await newUser(),r=await checkoutFor(u,a.id);
 await as('authenticated',ADMIN,()=>q(`select public.admin_set_coin_package_active($1,false)`,[a.id]));
 assert.equal((await checkoutFor(u,a.id,r.request_key)).price_piastres,15000);
 await assert.rejects(checkoutFor(u,a.id),/not available/);
});
await test('checkout retry works after cancellation or pausing payments; a new request gets a fresh ID',async()=>{
 const u=await newUser(),r=await checkoutFor(u);await as('authenticated',u,()=>q(`select public.cancel_topup($1)`,[r.id]));
 await as('authenticated',ADMIN,()=>q(`select public.admin_configure_payments('project@instapay','Test recipient','https://example.test/qr.png',false)`));
 assert.equal((await checkoutFor(u,P,r.request_key)).status,'cancelled');await assert.rejects(checkoutFor(u),/not configured/);
 await as('authenticated',ADMIN,()=>q(`select public.admin_configure_payments('project@instapay','Test recipient','https://example.test/qr.png',true)`));
 assert.notEqual((await checkoutFor(u)).id,r.id);
 await assert.rejects(as('authenticated',ADMIN,()=>q(`select public.admin_configure_payments('bad@@address','Test recipient','https://example.test/qr.png',true)`)),/valid InstaPay/);
});
await test('receipt reservations enforce ownership and bounded uploads',async()=>{
 const u=await newUser(),other=await newUser(),r=await checkoutFor(u);
 await assert.rejects(upload(u,u+'/'+r.id+'/unreserved.png'),/row-level security/);
 const path=await reserve(u,r.id);await assert.rejects(upload(other,path),/row-level security/);await upload(u,path);
 for(let i=0;i<4;i++)await reserve(u,r.id);
 await assert.rejects(reserve(u,r.id),/upload limit/);
 assert.equal((await as('authenticated',other,()=>q(`select * from public.receipt_uploads`))).rows.length,0);
});
await test('reference changes invalidate an opened image; settlement and review roll back together on failure',async()=>{
 const u=await newUser(),r=await checkoutFor(u),path=await reserve(u,r.id);await upload(u,path);const original=await attach(u,r.id,path);
 const edited=await attach(u,r.id,path,'EDITED-REFERENCE');assert.ok(Number(edited.receipt_revision)>Number(original.receipt_revision));
 await assert.rejects(settle(edited,original.receipt_revision),/receipt changed/);
 await assert.rejects(settle(edited,edited.receipt_revision,9999),/amount mismatch|bank total/);
 assert.equal((await q(`select proof_reviewed_at from public.topup_requests where id=$1`,[r.id])).rows[0].proof_reviewed_at,null);
 await assert.rejects(as('authenticated',u,()=>q(`select public.cancel_topup($1)`,[r.id])),/receipt submitted/);
 await assert.rejects(as('authenticated',u,()=>q(`select * from public.prepare_account_deletion('delete my account')`)),/pending payments/);
 const bankRef='BANK-'+key();await settle(edited,edited.receipt_revision,10000,bankRef);await settle(edited,edited.receipt_revision,10000,bankRef);
 assert.deepEqual(await wallet(u),{balance:500,contribution_score:0});
 const other=await checkoutFor(u),path2=await reserve(u,other.id);await upload(u,path2);const proof=await attach(u,other.id,path2);
 await assert.rejects(settle(proof,proof.receipt_revision,10000,bankRef),/unique constraint|already recorded/);assert.equal((await wallet(u)).balance,500);
});
await test('deletion is blocked by receipts until Storage removal; deletion barriers prevent new files and scrub sender identity',async()=>{
 const u=await newUser(),r=await checkoutFor(u),path=await reserve(u,r.id);await upload(u,path);await attach(u,r.id,path);
 await as('authenticated',ADMIN,()=>q(`select public.admin_review_topup($1,'rejected',null,null,'Unable to reconcile this receipt')`,[r.id]));
 await assert.rejects(as('authenticated',u,()=>q(`select public.delete_my_account('delete my account')`)),/remove receipt files/);
 const paths=(await as('authenticated',u,()=>q(`select * from public.prepare_account_deletion('delete my account')`))).rows;assert.deepEqual(paths,[{object_key:path}]);
 await assert.rejects(checkoutFor(u),/deletion in progress/);
 await assert.rejects(upload(u,path+'new'),/deletion in progress/);
 const another=await newUser();assert.equal((await as('authenticated',another,()=>q(`delete from storage.objects where name=$1 returning name`,[path]))).rows.length,0);
 // Local Storage fixture simulates the API's authorized object removal; production never SQL-deletes files.
 assert.equal((await as('authenticated',u,()=>q(`delete from storage.objects where name=$1 returning name`,[path]))).rows.length,1);
 await as('authenticated',u,()=>q(`select public.delete_my_account('delete my account')`));
 const kept=(await q(`select user_id,transfer_note_email,payer_instapay_address,customer_payment_reference,receipt_object_key from public.topup_requests where id=$1`,[r.id])).rows[0];assert.ok(Object.values(kept).every(v=>v===null));
 await q(`update public.member_profiles set visibility='members',adult_confirmed=true where user_id=$1`,[another]);
 assert.equal((await as('authenticated',u,()=>q(`select * from public.profile_directory`))).rows.length,0,'deleted JWT is not a current member');
 assert.equal((await as('authenticated',u,()=>q(`select * from storage.objects`))).rows.length,0);
});
await test('receipt retention requires MFA and cannot remove fresh or pending evidence',async()=>{
 const u=await newUser(),r=await checkoutFor(u),path=await reserve(u,r.id);await upload(u,path);const proof=await attach(u,r.id,path);await settle(proof);
 await q(`update storage.objects set created_at=now()-interval '91 days' where name=$1`,[path]);
 const r2=await checkoutFor(u),pending=await reserve(u,r2.id);await upload(u,pending);await attach(u,r2.id,pending);await q(`update storage.objects set created_at=now()-interval '91 days' where name=$1`,[pending]);
 await q(`select set_config('request.jwt.claims','{"aal":"aal1"}',false)`);
 await assert.rejects(as('authenticated',ADMIN,()=>q(`select * from public.admin_receipt_cleanup_candidates()`)),/MFA/);
 assert.equal((await as('authenticated',ADMIN,()=>q(`delete from storage.objects where name=$1 returning name`,[path]))).rows.length,0);
 await q(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
 const candidates=(await as('authenticated',ADMIN,()=>q(`select * from public.admin_receipt_cleanup_candidates()`))).rows.map(x=>x.object_key);assert.ok(candidates.includes(path));assert.ok(!candidates.includes(pending));
 assert.equal((await as('authenticated',ADMIN,()=>q(`delete from storage.objects where name=$1 returning name`,[pending]))).rows.length,0);
 assert.equal((await as('authenticated',ADMIN,()=>q(`delete from storage.objects where name=$1 returning name`,[path]))).rows.length,1);
});
await test('deleting an account cancels its unpaid requests instead of leaving unreviewable pending rows',async()=>{
 const u=await newUser(),r=await checkoutFor(u);
 await as('authenticated',u,()=>q(`select public.delete_my_account('delete my account')`));
 const kept=(await q(`select user_id,status from public.topup_requests where id=$1`,[r.id])).rows[0];
 assert.deepEqual(kept,{user_id:null,status:'cancelled'});
});
await test('public profile views have no dependency on the Auth users table',async()=>{
 const dependency=(await q(`select count(*)::int n from pg_depend d join pg_rewrite r on r.oid=d.objid where d.classid='pg_rewrite'::regclass and d.refobjid='auth.users'::regclass and r.ev_class in ('public.profile_directory'::regclass,'public.profile_work'::regclass)`)).rows[0];
 assert.equal(dependency.n,0);
});
await test('legacy financial mutations require MFA and revoked administrator sessions fail closed',async()=>{
 await q(`select set_config('request.jwt.claims','{"aal":"aal1"}',false)`);
 await assert.rejects(as('authenticated',ADMIN,()=>q(`select public.admin_correct_entry(0,'Test correction')`)),/MFA/);
 await assert.rejects(as('authenticated',ADMIN,()=>q(`select public.admin_review_feedback(0,'accepted',1,'Test feedback')`)),/MFA/);
 await q(`create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz)`);
 await q(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
 await assert.rejects(as('authenticated',ADMIN,()=>q(`select public.admin_credit_account('owner@example.test',0,1,'Session test',$1)`,[key()])),/session ended/);
 const sid=key();await q(`insert into auth.sessions(id,user_id)values($1,$2)`,[sid,ADMIN]);
 await q(`select set_config('request.jwt.claims',$1,false)`,[JSON.stringify({aal:'aal2',session_id:sid})]);
 await as('authenticated',ADMIN,()=>q(`select public.admin_credit_account('owner@example.test',0,1,'Session test',$1)`,[key()]));
 await q(`delete from auth.sessions where id=$1`,[sid]);
 await assert.rejects(as('authenticated',ADMIN,()=>q(`select public.admin_credit_account('owner@example.test',0,1,'Revoked session',$1)`,[key()])),/session ended/);
});
console.log(`\n${passed} passed, ${failed} failed`);await db.close();process.exitCode=failed?1:0;
