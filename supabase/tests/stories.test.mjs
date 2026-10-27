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
const review = async (r,decision='approved',amount=10000,ref='BANK-000001',who=ADMIN,aal='aal2') => {
 await q(`select set_config('request.jwt.claims',$1,false)`,[JSON.stringify({aal})]);
 const row=(await q(`select * from public.topup_requests where id=$1`,[r])).rows[0];
 if(who===ADMIN && aal==='aal2' && row?.status==='pending' && decision==='approved'){
  await as('authenticated',row.user_id,()=>q(`select public.accept_topup_terms($1,'manual-final-v1')`,[r]));
  await as('authenticated',row.user_id,()=>q(`select public.submit_topup_reference($1,'CUSTOMER-REF','manual-final-v1')`,[r]));
  const receipt=row.user_id+'/'+r+'/receipt.png';
  await q(`insert into storage.objects(bucket_id,name) values ('topup-receipts',$1) on conflict do nothing`,[receipt]);
  await as('authenticated',row.user_id,()=>q(`select public.attach_topup_receipt($1,'customer@instapay','CUSTOMER-REF',$2)`,[r,receipt]));
  await as('authenticated',ADMIN,()=>q(`select public.admin_review_uploaded_receipt($1,'Reviewed customer receipt in WhatsApp',(select receipt_object_key from public.topup_requests where id=$1),(select receipt_revision from public.topup_requests where id=$1))`,[r]));
 }
 if(decision==='approved')return as('authenticated',who,async()=>(await q(`select * from public.admin_settle_topup($1,(select receipt_object_key from public.topup_requests where id=$1),(select receipt_revision from public.topup_requests where id=$1),$2,$3,'Checked incoming transfer')`,[r,amount,ref])).rows[0]);
 return as('authenticated',who, async () => (await q(`select * from public.admin_review_topup($1,$2,$3,$4,'Checked incoming transfer')`,[r,decision,amount,ref])).rows[0]);
};
await q(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
const credit=(key,points=200,coins=0,email='owner@example.test')=>as('authenticated',ADMIN,()=>q(`select public.admin_credit_account($1,$2,$3,'Test recognition',$4)`,[email,coins,points,key]));
await test('recognition raises score only, retries are idempotent and only MFA admins can award',async()=>{
 const k=key();await credit(k);await credit(k);assert.deepEqual(await wallet(OWNER),{balance:0,contribution_score:200});
 await assert.rejects(credit(k,201),/already used/);
 await as('authenticated',OWNER,async()=>assert.rejects(q(`select public.admin_credit_account('owner@example.test',0,200,'Forged award',$1)`,[key()]),/administrator/));
});
await test('only Mono is free; locked palettes cannot equip without ownership',async()=>{
 const defaults=(await q(`select id from public.catalog_items where is_default`)).rows;assert.deepEqual(defaults,[{id:'mono'}]);
 await assert.rejects(equip(OTHER,'paper'),/not owned/);await equip(OTHER,'mono');
 await credit(key(),0,300);await buy(OWNER,'paper','new-paper-0001');await equip(OWNER,'paper');
 assert.equal((await wallet(OWNER)).balance,0);
});
let story;
const save=(user,id=null,body='My private money habits. '.repeat(4),linkedin='https://www.linkedin.com/posts/default-'+Math.random().toString(36).slice(2))=>as('authenticated',user,async()=>(await q(`select * from public.save_story($1,'How I budget',$2,$3)`,[id,body,linkedin])).rows[0]);
await test('drafts private and writing/submitting alone awards nothing',async()=>{
 story=await save(OWNER);
 assert.equal((await as('anon',null,()=>q(`select * from public.stories_feed()`))).rows.length,0);
 assert.equal((await as('authenticated',OTHER,()=>q(`select * from public.community_stories`))).rows.length,0);
 await assert.rejects(as('authenticated',OTHER,()=>q(`select public.save_story($1,'Stolen','x',null)`,[story.id])),/not found/);
 await as('authenticated',OWNER,()=>q(`update public.member_profiles set visibility='private',show_on_leaderboard=false where user_id=$1`,[OWNER]));
 await assert.rejects(as('authenticated',OWNER,()=>q(`select public.submit_story($1,true)`,[story.id])),/public adult/);
 await as('authenticated',OWNER,()=>q(`update public.member_profiles set visibility='public' where user_id=$1`,[OWNER]));
 await assert.rejects(as('authenticated',OWNER,()=>q(`select public.submit_story($1,false)`,[story.id])),/consent/);
 await as('authenticated',OWNER,()=>q(`select public.submit_story($1,true)`,[story.id]));
 assert.deepEqual(await wallet(OWNER),{balance:0,contribution_score:200});
});
await test('moderated publication awards once; edits unpublish and cannot farm points',async()=>{
 await as('authenticated',ADMIN,()=>q(`select public.admin_moderate_story($1,true,50,0,'Useful specific budgeting experience',true,true,(select submission_revision from public.community_stories where id=$1),true)`,[story.id]));
 await as('authenticated',ADMIN,()=>q(`select public.admin_moderate_story($1,true,50,0,'Repeated request',true,true,(select submission_revision from public.community_stories where id=$1),true)`,[story.id]));
 let feed=(await as('anon',null,()=>q(`select * from public.stories_feed()`))).rows;assert.equal(feed.length,1);assert.ok(!('user_id'in feed[0]));assert.ok(!('review_note'in feed[0]));
 assert.deepEqual(await wallet(OWNER),{balance:0,contribution_score:250});
 await save(OWNER,story.id,undefined,'https://www.linkedin.com/posts/edited-1');assert.equal((await as('anon',null,()=>q(`select * from public.stories_feed()`))).rows.length,0);
 await as('authenticated',OWNER,()=>q(`select public.submit_story($1,true)`,[story.id]));
 await as('authenticated',ADMIN,()=>q(`select public.admin_moderate_story($1,true,50,0,'Reviewed the revision',true,true,(select submission_revision from public.community_stories where id=$1),true)`,[story.id]));
 assert.equal((await wallet(OWNER)).contribution_score,250);
 await as('authenticated',OWNER,()=>q(`select public.withdraw_story($1)`,[story.id]));
 assert.equal((await as('anon',null,()=>q(`select * from public.stories_feed()`))).rows.length,0);
});
await test('unsafe LinkedIn URLs fail; drafts do not reserve a LinkedIn source',async()=>{
 await assert.rejects(save(OTHER,null,undefined,'javascript:alert(1)'),/check constraint/);
 const link='https://www.linkedin.com/posts/test_story-123';await save(OTHER,null,undefined,link+'?tracking=1');
 await save(OWNER,null,undefined,link); // only an approved story may reserve source credit
});
await test('accepted LinkedIn sources cannot earn another award and AAL1 cannot credit',async()=>{
 const link='https://www.linkedin.com/posts/source_unique-456';
 const a=await save(OWNER,null,undefined,link);
 await as('authenticated',OWNER,()=>q(`select public.submit_story($1,true)`,[a.id]));
 await as('authenticated',ADMIN,()=>q(`select public.admin_moderate_story($1,true,10,0,'Accepted original',true,true,(select submission_revision from public.community_stories where id=$1),true)`,[a.id]));
 const b=await save(OWNER,null,undefined,link+'?tracking=2');
 await as('authenticated',OWNER,()=>q(`select public.submit_story($1,true)`,[b.id]));
 await assert.rejects(as('authenticated',ADMIN,()=>q(`select public.admin_moderate_story($1,true,10,0,'Duplicate source',true,true,(select submission_revision from public.community_stories where id=$1),true)`,[b.id])),/already accepted/);
 assert.equal((await wallet(OWNER)).contribution_score,260);
 await q(`select set_config('request.jwt.claims','{"aal":"aal1"}',false)`);
 await assert.rejects(credit(key()),/MFA/);
 await q(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
});
await test('Reddit sources, spendable story coins, disclosure flag, caps and frames/badges',async()=>{
 const W=await newUser();await as('authenticated',W,()=>q(`update public.member_profiles set adult_confirmed=true,visibility='public' where user_id=$1`,[W]));
 await assert.rejects(as('authenticated',W,()=>q(`select public.save_story(null,'Bad link','x',null,'https://evil.example/r/a/comments/abc')`)),/check constraint/);
 const mk=async(n)=>{const r=(await as('authenticated',W,()=>q(`select * from public.save_story(null,'Habit '||$1::text,$2,null,$3)`,[n,'A real habit I keep. '.repeat(4),`https://old.reddit.com/r/Egypt/comments/abc${n}/my_habit/?utm=1`]))).rows[0];
  await as('authenticated',W,()=>q(`select public.submit_story($1,true)`,[r.id]));return r;};
 await assert.rejects(as('authenticated',W,()=>q(`select public.save_story(null,'Too long',$1)`,['x'.repeat(401)])),/at most 400/);
 const nolink=(await as('authenticated',W,()=>q(`select * from public.save_story(null,'No link yet',$1)`,['A real habit I keep. '.repeat(3)]))).rows[0];
 await assert.rejects(as('authenticated',W,()=>q(`select public.submit_story($1,true)`,[nolink.id])),/link to your LinkedIn or Reddit/);
 assert.match(nolink.verify_code,/^[0-9a-f]{8}$/);
 const a=await mk(1);assert.equal(a.reddit_url,'https://www.reddit.com/r/Egypt/comments/abc1/my_habit');
 await as('authenticated',ADMIN,()=>q(`select public.admin_moderate_story($1,true,0,60,'Specific, useful habit',true,true,(select submission_revision from public.community_stories where id=$1),true)`,[a.id]));
 await as('authenticated',ADMIN,()=>q(`select public.admin_moderate_story($1,true,0,60,'Repeat',true,true,(select submission_revision from public.community_stories where id=$1),true)`,[a.id]));
 assert.deepEqual(await wallet(W),{balance:60,contribution_score:0},'coins spend but never raise rank');
 const dn=(await q(`select display_name from public.member_profiles where user_id=$1`,[W])).rows[0].display_name;
 const f=(await as('anon',null,()=>q(`select * from public.stories_feed(null,$1)`,[dn]))).rows;
 assert.equal(f.length,1);assert.equal(f[0].rewarded,true);
 const dup=await as('authenticated',W,async()=>(await q(`select * from public.save_story(null,'Same again',$1,null,'https://www.reddit.com/r/Egypt/comments/abc1/my_habit/')`,['A real habit I keep. '.repeat(4)])).rows[0]);
 await as('authenticated',W,()=>q(`select public.submit_story($1,true)`,[dup.id]));
 await assert.rejects(as('authenticated',ADMIN,()=>q(`select public.admin_moderate_story($1,true,0,60,'Same source',true,true,(select submission_revision from public.community_stories where id=$1),true)`,[dup.id])),/already accepted/);
 for(const n of [2,3]){const s=await mk(n);await as('authenticated',ADMIN,()=>q(`select public.admin_moderate_story($1,true,0,10,'Good',true,true,(select submission_revision from public.community_stories where id=$1),true)`,[s.id]));}
 const fourth=await mk(4);await assert.rejects(as('authenticated',ADMIN,()=>q(`select public.admin_moderate_story($1,true,0,10,'Good',true,true,(select submission_revision from public.community_stories where id=$1),true)`,[fourth.id])),/3 stories in 30 days/);
 assert.equal((await wallet(W)).balance,80);
 await as('authenticated',W,()=>q(`select * from public.purchase_item_at_price('badge-pen',80,'pen-badge-0001')`));await as('authenticated',W,()=>q(`select public.equip_item('badge-pen')`));
 await assert.rejects(as('authenticated',W,()=>q(`select public.equip_item('frame-gold')`)),/not owned/);
 const pf=(await as('anon',null,()=>q(`select badge_item_id,frame_item_id from public.member_directory(60,0)`))).rows;assert.ok(pf.some(r=>r.badge_item_id==='badge-pen'));
 assert.ok(!(await as('anon',null,()=>q(`select * from public.leaderboard('all',5)`))).fields.every(x=>x.name!=='frame_item_id'));
});
console.log(`\n${passed} passed, ${failed} failed`);await db.close();process.exitCode=failed?1:0;
