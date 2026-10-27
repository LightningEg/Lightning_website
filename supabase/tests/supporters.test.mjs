// Supporter release (supabase/migrations/20261025370000_supporter_release.sql): earned supporter and founding badges,
// name styles, seasonal windows, sets at 80% of what you do not own, gifts and the supporters' theme vote.
//
//   PGLITE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/supporters.test.mjs

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
const topUp = async (user, coins) => {
  const ref='TEST-'+(++topups), amount=coins*20;
  const pack=(await q(`insert into public.coin_packages(name,coins,price_piastres) values('Test', $1,$2) returning id`,[coins,amount])).rows[0].id;
  const request=(await q(`insert into public.topup_requests(user_id,package_id,request_key,coins,price_piastres) values($1,$2,gen_random_uuid(),$3,$4) returning id`,[user,pack,coins,amount])).rows[0].id;
  const entry=(await q(`select (private.post_ledger($1,'paid_topup',0,$2,'instapay',$3,'primary','Top-up','topup:'||$3,now(),null,null)).id id`,[user,coins,request])).rows[0].id;
  await q(`insert into public.bank_transfers(reference,amount_piastres,received_at,request_id,recorded_by,note) values($1,$2,now(),$3,$4,'Test transfer')`,[ref,amount,request,user]);
  await q(`update public.topup_requests set status='approved',received_piastres=price_piastres,payment_reference=$2,ledger_entry_id=$3,reviewed_by=$4,reviewed_at=now() where id=$1`,[request,ref,entry,user]);
};
const gift = (user, coins) => as('service_role', null, () => q(`select * from public.award_coins($1,'admin_gift',$2,'test',$3,'Coins for the test')`, [user, coins, 'G' + (++topups)]));
const owns = async (user, item) => (await q(`select 1 from public.inventory where user_id=$1 and item_id=$2`, [user, item])).rows.length === 1;
const balance = async user => (await q(`select balance from public.wallets where user_id=$1`, [user])).rows[0].balance;
const rpc = (user, sql, params) => as('authenticated', user, async () => (await q(sql, params)).rows[0]);
const key = () => 'key-' + Math.random().toString(36).slice(2, 12);

await test('supporter badges are earned by coins topped up, kept, and never sold', async () => {
  const M = await newUser();
  await topUp(M, 300);
  assert.equal(await owns(M, 'badge-supporter-bronze'), false);
  await topUp(M, 250);
  assert.equal(await owns(M, 'badge-supporter-bronze'), true, '550 coins: bronze');
  assert.equal(await owns(M, 'badge-supporter-silver'), false);
  await topUp(M, 700);
  assert.equal(await owns(M, 'badge-supporter-silver'), true, '1,250 Cotton: silver');
  await gift(M, 50000);
  assert.equal(await owns(M, 'badge-supporter-gold'), false, 'coins given by the owner are not top-ups');
  await assert.rejects(rpc(M, `select * from public.purchase_item_at_price('badge-supporter-gold',0,$1)`, [key()]), /earned, not sold|not available|price/);
  const s = await rpc(M, `select public.supporter_status() s`);
  assert.equal(Number(s.s.support_equivalent_egp), 250);
  assert.deepEqual(s.s.tiers.map(t => [t.id, t.owned]), [['badge-supporter-bronze', true], ['badge-supporter-silver', true], ['badge-supporter-gold', false], ['badge-supporter-true',false]]);
  const e = await rpc(M, `select * from public.equip_item('badge-supporter-silver')`);
  assert.equal(e.slot, 'badge');
});

await test('founding supporter: the first 100 payers only, in order, and it never comes back', async () => {
  const before = Number((await q(`select count(*) c from public.inventory where item_id='badge-founding'`)).rows[0].c);
  const users = [];
  for (let i = before; i < 100; i++) { const u = await newUser(); users.push(u); await topUp(u, 100); }
  assert.equal(Number((await q(`select count(*) c from public.inventory where item_id='badge-founding'`)).rows[0].c), 100);
  const late = await newUser(); await topUp(late, 100000);
  assert.equal(await owns(late, 'badge-founding'), false, 'the 101st payer does not get it');
  assert.equal(await owns(late, 'badge-supporter-gold'), true);
  const s = await rpc(late, `select public.supporter_status() s`);
  assert.equal(s.s.founding_left, 0);
  assert.equal(s.s.founding_owned, false);
});

await test('name styles: bought, worn in the name slot, and read back on the leaderboard, profiles and members', async () => {
  const M = await newUser('shimmerer');
  await q(`update public.member_profiles set show_on_leaderboard=true, visibility='public' where user_id=$1`, [M]);
  await as('service_role', null, () => q(`select * from public.award_coins($1,'contribution_award',600,'pr','name-pr','Merged PR')`, [M]));
  await rpc(M, `select * from public.purchase_item_at_price('name-shimmer',500,$1)`, [key()]);
  const e = await rpc(M, `select * from public.equip_item('name-shimmer')`);
  assert.equal(e.slot, 'name');
  const lb = (await as('anon', null, () => q(`select * from public.leaderboard('all',50)`))).rows.find(r => r.display_name === 'shimmerer');
  assert.equal(lb.name_item_id, 'name-shimmer');
  const pf = (await as('anon', null, () => q(`select * from public.get_profile('shimmerer')`))).rows[0];
  assert.equal(pf.name_item_id, 'name-shimmer');
  const dir = (await as('anon', null, () => q(`select * from public.member_directory(60,0)`))).rows.find(r => r.display_name === 'shimmerer');
  assert.equal(dir.name_item_id, 'name-shimmer');
  const cat = (await as('authenticated', M, () => q(`select * from public.market_catalog()`))).rows.find(r => r.id === 'name-shimmer');
  assert.deepEqual([cat.type, cat.tier, cat.owned, cat.equipped], ['name', 'motion', true, true]);
});

await test('seasonal drops: on sale only inside the window, shown only then, and owners keep them after', async () => {
  const M = await newUser();
  await gift(M, 5000);
  const now = (await q(`select now() t`)).rows[0].t;
  await q(`update public.catalog_items set available_from=now()-interval '1 day', available_until=now()+interval '1 day' where id='banner-cotton-harvest'`);
  await q(`update public.catalog_items set available_from=now()+interval '30 days', available_until=now()+interval '40 days' where id='banner-ramadan-2027'`);
  let cat = (await as('authenticated', M, () => q(`select id, available_until from public.market_catalog()`))).rows;
  assert.ok(cat.some(r => r.id === 'banner-cotton-harvest' && r.available_until), 'on sale now, with its end');
  assert.ok(!cat.some(r => r.id === 'banner-ramadan-2027'), 'not shown before it opens');
  await assert.rejects(rpc(M, `select * from public.purchase_item_at_price('banner-ramadan-2027',250,$1)`, [key()]), /not on sale now/);
  await rpc(M, `select * from public.purchase_item_at_price('banner-cotton-harvest',200,$1)`, [key()]);
  await q(`update public.catalog_items set available_from=now()-interval '10 days', available_until=now()-interval '1 day' where id='banner-cotton-harvest'`);
  const N = await newUser(); await gift(N, 5000);
  await assert.rejects(rpc(N, `select * from public.purchase_item_at_price('banner-cotton-harvest',200,$1)`, [key()]), /not on sale now/);
  assert.ok(!(await as('authenticated', N, () => q(`select id from public.market_catalog()`))).rows.some(r => r.id === 'banner-cotton-harvest'), 'gone from the market');
  assert.ok((await as('authenticated', M, () => q(`select id from public.market_catalog()`))).rows.some(r => r.id === 'banner-cotton-harvest'), 'its owner still sees it');
  assert.ok(now);
});

await test('sets: 80% of the parts you do not own, every part delivered, once', async () => {
  const M = await newUser();
  await gift(M, 5000);
  const price = async () => (await as('authenticated', M, () => q(`select set_price from public.market_catalog() where id='set-nile'`))).rows[0].set_price;
  assert.equal(await price(), 704, '880 at 80%');
  await assert.rejects(rpc(M, `select * from public.purchase_item_at_price('set-nile',880,$1)`, [key()]), /set/);
  await rpc(M, `select * from public.purchase_item_at_price('frame-nile',80,$1)`, [key()]);
  assert.equal(await price(), 640, 'the frame you own is taken off: 800 at 80%');
  const b = await balance(M);
  await assert.rejects(rpc(M, `select * from public.purchase_set('set-nile',704,$1)`, [key()]), /price changed/);
  const k = key();
  await rpc(M, `select * from public.purchase_set('set-nile',640,$1)`, [k]);
  assert.equal(await balance(M), b - 640);
  for (const part of ['nile', 'banner-nile-flow', 'frame-nile', 'name-nile', 'set-nile']) assert.equal(await owns(M, part), true, part);
  await rpc(M, `select * from public.purchase_set('set-nile',640,$1)`, [k]);
  assert.equal(await balance(M), b - 640, 'the same request twice charges once');
  await assert.rejects(rpc(M, `select * from public.purchase_set('set-nile',0,$1)`, [key()]), /already own every part/);
});

await test('gifts: bought for another member by display name, delivered to them, listed for both; limits hold', async () => {
  const A = await newUser('giver'), B = await newUser('Receiver');
  await gift(A, 2000);
  await assert.rejects(rpc(A, `select public.gift_item('banner-dusk','nobody-here',150,$1)`, [key()]), /no member/);
  await assert.rejects(rpc(A, `select public.gift_item('banner-dusk','giver',150,$1)`, [key()]), /yourself/);
  await assert.rejects(rpc(A, `select public.gift_item('badge-supporter-bronze','receiver',0,$1)`, [key()]), /cannot be given/);
  await assert.rejects(rpc(A, `select public.gift_item('set-dusk','receiver',850,$1)`, [key()]), /cannot be given/);
  const k = key();
  const r = await rpc(A, `select public.gift_item('banner-dusk','receiver',150,$1) g`, [k]);
  assert.equal(r.g.to, 'Receiver');
  assert.equal(await owns(B, 'banner-dusk'), true);
  assert.equal(await owns(A, 'banner-dusk'), false, 'the giver can still buy one for themselves');
  assert.equal(await balance(A), 1850);
  await rpc(A, `select public.gift_item('banner-dusk','receiver',150,$1) g`, [k]);
  assert.equal(await balance(A), 1850, 'retrying the same gift charges once');
  await assert.rejects(rpc(A, `select public.gift_item('banner-dusk','receiver',150,$1)`, [key()]), /already have it/);
  const got = await rpc(B, `select public.my_gifts() g`);
  assert.deepEqual(got.g.received.map(x => [x.item_id, x.from]), [['banner-dusk', 'giver']]);
  const sent = await rpc(A, `select public.my_gifts() g`);
  assert.deepEqual(sent.g.sent.map(x => [x.item_id, x.to, x.coins]), [['banner-dusk', 'Receiver', 150]]);
  await assert.rejects(as('authenticated', B, () => q(`select * from public.gifts`)), /permission/);
  // No age requirement: a member under 18 can receive a gift; a suspended one cannot.
  const young = await newUser('young'); await q(`update public.profiles set birth_date = current_date - interval '15 years' where user_id=$1`, [young]);
  assert.equal((await rpc(A, `select public.gift_item('frame-halo','young',80,$1) g`, [key()])).g.to, 'young');
  const banned = await newUser('banned'); await q(`update public.member_profiles set suspended=true where user_id=$1`, [banned]);
  await assert.rejects(rpc(A, `select public.gift_item('frame-halo','banned',80,$1)`, [key()]), /no member/);
});

await test('the next theme: supporters vote once each and can change it; others see the count', async () => {
  const S = await newUser(), N = await newUser();
  await topUp(S, 500);
  await assert.rejects(rpc(N, `select public.vote_theme('lotus')`), /supporters vote/);
  await assert.rejects(rpc(S, `select public.vote_theme('nope')`), /not a choice/);
  await rpc(S, `select public.vote_theme('lotus')`);
  let p = (await rpc(S, `select public.theme_poll() p`)).p;
  assert.equal(p.my_vote, 'lotus'); assert.equal(p.can_vote, true);
  await rpc(S, `select public.vote_theme('khan')`);
  p = (await as('anon', null, async () => (await q(`select public.theme_poll() p`)).rows[0].p));
  assert.equal(p.can_vote, false);
  assert.deepEqual(p.options.map(o => [o.id, Number(o.votes)]), [['lotus', 0], ['sinai', 0], ['alexandria', 0], ['khan', 1]]);
  await assert.rejects(as('authenticated', S, () => q(`select * from public.theme_votes`)), /permission/);
});

await test('the export includes gifts and the vote', async () => {
  const A = await newUser('exporter'); await topUp(A, 600);
  await rpc(A, `select public.vote_theme('sinai')`);
  const x = (await rpc(A, `select public.export_my_data() x`)).x;
  assert.equal(x.theme_vote.option_id, 'sinai');
  assert.ok(Array.isArray(x.gifts.received));
});

await test('combined support: 500 EGP plus 2,500 score earns True supporter at 1,000 EGP equivalent', async () => {
  const M=await newUser(); await topUp(M,2500);
  assert.equal(await owns(M,'badge-supporter-true'),false);
  await as('service_role',null,()=>q(`select public.award_coins($1,'contribution_award',2499,'pr','combined-below','Merged work')`,[M]));
  assert.equal(await owns(M,'badge-supporter-true'),false);
  await as('service_role',null,()=>q(`select public.award_coins($1,'feedback_award',1,'feedback','combined-boundary','Accepted work')`,[M]));
  assert.equal(await owns(M,'badge-supporter-true'),true);
  assert.equal(Number((await rpc(M,`select public.supporter_status() s`)).s.support_equivalent_egp),1000);
});
await test('contributions alone reach every tier without buying Cotton; gifts cannot qualify',async()=>{
  const M=await newUser(); await gift(M,50000);
  assert.equal(await owns(M,'badge-supporter-bronze'),false);
  for(const [score,id] of [[500,'bronze'],[1250,'silver'],[2500,'gold'],[5000,'true']]) {
    const before=Number((await q(`select contribution_score from public.wallets where user_id=$1`,[M])).rows[0].contribution_score);
    await as('service_role',null,()=>q(`select public.award_coins($1,'contribution_award',$2,'pr',$3,'Tier boundary')`,[M,score-before,'tier-'+id]));
    assert.equal(await owns(M,'badge-supporter-'+id),true);
  }
});
await test('public supporter output contains earned level only, not money or private progress',async()=>{
 const M=await newUser('public-supporter'); await q(`update public.member_profiles set visibility='public' where user_id=$1`,[M]); await topUp(M,5000);
 const rows=(await as('anon',null,()=>q(`select * from public.supporter_levels() where display_name='public-supporter'`))).rows;
 assert.deepEqual(Object.keys(rows[0]).sort(),['display_name','supporter_badge','supporter_level']);
 assert.equal(rows[0].supporter_level,'True supporter');
 const status=(await as('anon',null,()=>q(`select public.supporter_status() s`))).rows[0].s;
 assert.equal(status.support_equivalent_egp,null);
});
await test('bonus Cotton does not inflate confirmed EGP support and corrected contributions reduce progress',async()=>{
 const M=await newUser(); await topUp(M,500);
 const entry=(await q(`select id from public.ledger_entries where user_id=$1 and kind='paid_topup'`,[M])).rows[0].id;
 // Additional bonus-only wallet credit is not confirmed financial support.
 await as('service_role',null,()=>q(`select public.award_coins($1,'admin_gift',5000,'test','bonus-test','Promotional Cotton')`,[M]));
 assert.equal(Number((await rpc(M,`select public.supporter_status() s`)).s.support_equivalent_egp),100);
 const award=(await as('service_role',null,()=>q(`select (public.award_coins($1,'contribution_award',500,'pr','reversed-support','Work')).id id`,[M]))).rows[0].id;
 assert.equal(Number((await rpc(M,`select public.supporter_status() s`)).s.support_equivalent_egp),200);
 await q(`select private.post_ledger($1,'correction',-500,-500,'correction',$2::text,'primary','Reversed work','support-correction',now(),$2::bigint,null)`,[M,award]);
 assert.equal(Number((await rpc(M,`select public.supporter_status() s`)).s.support_equivalent_egp),100);
 assert.equal(Number((await q(`select contribution_score from public.wallets where user_id=$1`,[M])).rows[0].contribution_score),0);
});
console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exitCode = failed ? 1 : 0;
