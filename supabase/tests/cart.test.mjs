// Cart and sales tracking (supabase/migrations/20261027090000_cart_and_sales_tracking.sql): a server-side cart, an
// all-or-nothing checkout through the existing purchase functions, the cart event log and the owner's admin_sales().
//
//   PGLITE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/cart.test.mjs

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
const view = u => rpc(u, `select public.cart_view() v`).then(r => r.v);
const add = (u, id) => rpc(u, `select public.cart_add($1) v`, [id]).then(r => r.v);
const checkout = (u, total, k) => rpc(u, `select public.checkout_cart($1,$2) r`, [total, k || key()]).then(r => r.r);

await test('a cart is private, server-side, and priced from the catalogue', async () => {
  const M = await newUser(); const O = await newUser();
  await assert.rejects(as('anon', null, () => q(`select public.cart_view()`)), /permission denied/);
  await assert.rejects(as('authenticated', M, () => q(`select * from public.cart_items`)), /permission denied/);
  const v = await add(M, 'name-gold');
  assert.deepEqual(v.lines.map(l => [l.item_id, l.price, l.status]), [['name-gold', await price('name-gold'), 'ok']]);
  assert.equal(v.total, await price('name-gold'));
  assert.equal((await view(O)).lines.length, 0, 'nobody else sees it');
  assert.equal((await add(M, 'name-gold')).lines.length, 1, 'adding twice keeps one line');
  const r = await rpc(M, `select public.cart_remove('name-gold') v`);
  assert.equal(r.v.lines.length, 0);
});

await test('only things that are for sale can be added', async () => {
  const M = await newUser(); await topUp(M, 5000);
  await assert.rejects(add(M, 'mono'), /free|not available/);
  await assert.rejects(add(M, 'badge-supporter-gold'), /earned/);
  await assert.rejects(add(M, 'no-such-item'), /not available/);
  await rpc(M, `select * from public.purchase_item_at_price('name-gold',$1,$2)`, [await price('name-gold'), key()]);
  await assert.rejects(add(M, 'name-gold'), /already owned/);
});

await test('checkout buys every line, once, with one order and a ledger entry per line', async () => {
  const M = await newUser(); await topUp(M, 2000);
  const a = await price('name-gold'), b = await price('name-nile');
  await add(M, 'name-gold'); const v = await add(M, 'name-nile');
  assert.equal(v.total, a + b);
  const k = key();
  const o = await checkout(M, a + b, k);
  assert.equal(o.total, a + b); assert.equal(o.lines.length, 2); assert.equal(o.balance, 2000 - a - b);
  assert.equal(await balance(M), 2000 - a - b);
  assert.ok(await owns(M, 'name-gold') && await owns(M, 'name-nile'));
  assert.equal((await view(M)).lines.length, 0, 'the cart is empty afterwards');
  const again = await checkout(M, a + b, k);
  assert.equal(again.order_id, o.order_id, 'a retry returns the same order');
  assert.equal(await balance(M), 2000 - a - b, 'and never charges twice');
  assert.equal(Number((await q(`select count(*) c from public.purchases where user_id=$1`, [M])).rows[0].c), 2);
  assert.equal(Number((await q(`select count(*) c from public.order_lines where order_id=$1`, [o.order_id])).rows[0].c), 2);
});

await test('checkout is all or nothing: a short wallet or a changed price buys nothing', async () => {
  const M = await newUser(); await topUp(M, await price('name-gold'));
  await add(M, 'name-gold'); await add(M, 'name-nile');
  const total = (await view(M)).total;
  await assert.rejects(checkout(M, total), /insufficient coins/);
  assert.equal(await owns(M, 'name-gold'), false);
  assert.equal(await balance(M), await price('name-gold'));
  await topUp(M, 1000);
  await assert.rejects(checkout(M, total - 1), /price changed/);
  assert.equal((await view(M)).lines.length, 2, 'the cart is kept after a refusal');
  await assert.rejects(checkout(await newUser(), 1), /empty/);
});

await test('a set in the cart covers its parts, and the order charges the set price once', async () => {
  const M = await newUser(); await topUp(M, 5000);
  await add(M, 'name-nile'); const v = await add(M, 'set-nile');
  const set = v.lines.find(l => l.item_id === 'set-nile'), part = v.lines.find(l => l.item_id === 'name-nile');
  assert.equal(set.status, 'ok'); assert.equal(part.status, 'covered'); assert.equal(part.price, 0);
  assert.equal(v.total, set.price);
  const o = await checkout(M, set.price);
  assert.equal(o.total, set.price); assert.equal(o.lines.length, 1);
  assert.ok(await owns(M, 'set-nile') && await owns(M, 'name-nile') && await owns(M, 'frame-nile'));
  assert.equal(await balance(M), 5000 - set.price);
});

await test('an item that is switched off after it was added blocks checkout until it is removed', async () => {
  const M = await newUser(); await topUp(M, 2000);
  await add(M, 'name-gold'); await add(M, 'name-nile');
  await q(`update public.catalog_items set active=false where id='name-nile'`);
  const v = await view(M);
  assert.equal(v.lines.find(l => l.item_id === 'name-nile').status, 'unavailable');
  await assert.rejects(checkout(M, v.total), /cart changed/);
  await rpc(M, `select public.cart_remove('name-nile')`);
  const o = await checkout(M, await price('name-gold'));
  assert.equal(o.lines.length, 1);
  await q(`update public.catalog_items set active=true where id='name-nile'`);
});

await test('the owner sees what sold, how it was bought and where carts stall; members cannot', async () => {
  const S = await newUser(); await topUp(S, 3000);
  await add(S, 'name-sunset');                 // left in a cart
  await q(`update public.cart_items set added_at = now() - interval '2 days' where user_id=$1`, [S]);
  const B = await newUser(); await topUp(B, 3000);
  await rpc(B, `select * from public.purchase_item_at_price('name-shimmer',$1,$2)`, [await price('name-shimmer'), key()]); // direct
  await assert.rejects(rpc(B, `select public.admin_sales(30) s`), /administrator/);
  const s = (await as('authenticated', ADMIN, () => q(`select public.admin_sales(30) s`))).rows[0].s;
  assert.ok(s.sales.units >= 5 && s.sales.coins > 0);
  assert.ok(s.sales.by_channel.cart.units >= 4 && s.sales.by_channel.direct.units >= 1);
  assert.ok(s.orders.count >= 3 && s.orders.avg_lines >= 1);
  assert.ok(s.funnel.adds >= 8 && s.funnel.checkouts === s.orders.count);
  assert.ok(s.funnel.open_carts >= 1 && s.funnel.stale_carts >= 1);
  const sunset = s.by_item.find(i => i.id === 'name-sunset');
  assert.equal(sunset.in_carts, 1); assert.equal(sunset.units, 0);
  const gold = s.by_item.find(i => i.id === 'name-gold');
  assert.ok(gold.units >= 2 && gold.adds >= 2);
  assert.equal(s.daily.length, 30);
  assert.ok(s.recent_orders[0].items.length >= 1 && s.recent_orders[0].id.length === 8);
  assert.ok(!JSON.stringify(s).includes('@'), 'no email addresses in the sales view');
});

await test('deleting an account removes its cart and orders but keeps anonymous events', async () => {
  const M = await newUser(); await topUp(M, 1000);
  await add(M, 'name-gold'); await checkout(M, await price('name-gold'));
  await add(M, 'name-nile');
  const before = Number((await q(`select count(*) c from public.cart_events`)).rows[0].c);
  await q(`delete from auth.users where id=$1`, [M]);
  for (const t of ['cart_items', 'orders']) assert.equal(Number((await q(`select count(*) c from public.${t} where user_id=$1`, [M])).rows[0].c), 0);
  assert.equal(Number((await q(`select count(*) c from public.cart_events`)).rows[0].c), before, 'the events stay');
  assert.equal(Number((await q(`select count(*) c from public.cart_events where user_id=$1`, [M])).rows[0].c), 0, 'but no longer name anyone');
});

// ---------------------------------------------------------------- 8N: the cart offers the cheaper set
const sugg = u => view(u).then(v => v.suggestions);
const swap = (u, id) => rpc(u, `select public.cart_swap_for_set($1) v`, [id]).then(r => r.v);
const NILE = ['nile', 'banner-nile-flow', 'frame-nile', 'name-nile'];
await test('suggestions: a set appears once the cart and the inventory cover half of its parts, with the saving and the extra cost', async () => {
  const U = await newUser('suggest');
  assert.deepEqual(await sugg(U), []);
  await add(U, 'nile');
  assert.deepEqual(await sugg(U), [], 'one of four parts is under half');
  await add(U, 'banner-nile-flow');
  const [s] = await sugg(U);
  assert.equal(s.set_id, 'set-nile');
  assert.equal(s.name, 'Nile set');
  assert.deepEqual([s.parts_in_cart, s.parts_total], [2, 4]);
  const prices = await Promise.all(NILE.map(price));
  const listed = prices.reduce((a, b) => a + b, 0);
  assert.equal(s.price, (await q(`select private.set_price('set-nile', $1) p`, [U])).rows[0].p, 'the price checkout uses');
  assert.equal(s.saving, listed - s.price, 'the saving is what the parts cost one by one minus the set price');
  assert.ok(s.saving > 0);
  assert.equal(s.extra, s.price - prices[0] - prices[1], 'what the set adds to today\'s cart total');
  // the same price the cart then charges for the set
  const after = await add(U, 'set-nile');
  assert.equal(after.lines.find(l => l.item_id === 'set-nile').price, s.price);
  assert.deepEqual(after.suggestions, [], 'in the cart already: nothing to suggest');
});

await test('suggestions: owned parts count toward the half, a set you own or cannot buy is never offered', async () => {
  const U = await newUser('owned-half');
  await topUp(U, 5000);
  await rpc(U, `select * from public.purchase_item_at_price('frame-nile',$1,$2)`, [await price('frame-nile'), key()]);
  await add(U, 'name-nile');
  const [s] = await sugg(U);
  assert.equal(s.set_id, 'set-nile', 'one owned plus one in the cart is half');
  const unowned = await Promise.all(['nile', 'banner-nile-flow', 'name-nile'].map(price));
  assert.equal(s.saving, unowned.reduce((a, b) => a + b, 0) - s.price, 'owned parts are not counted in the saving');
  await q(`update public.catalog_items set active=false where id='banner-nile-flow'`);
  assert.deepEqual(await sugg(U), [], 'a part that is not on sale: the swap would fail, so it is not offered');
  await q(`update public.catalog_items set active=true where id='banner-nile-flow'`);
  assert.equal((await sugg(U)).length, 1);
});
await test('suggestions: a set you own is never offered', async () => {
  const W = await newUser('owns-set');
  await q(`insert into public.inventory (user_id, item_id) values ($1,'set-nile'), ($1,'nile'), ($1,'banner-nile-flow')`, [W]);
  await add(W, 'name-nile');
  assert.deepEqual(await sugg(W), []);
});

await test('cart_swap_for_set: the parts leave, the set comes in, in one step, and the saving is real', async () => {
  const U = await newUser('swapper');
  await add(U, 'nile'); await add(U, 'banner-nile-flow'); await add(U, 'banner-dusk');
  const before = await view(U);
  const [s] = before.suggestions;
  const v = await swap(U, 'set-nile');
  assert.deepEqual(v.lines.map(l => l.item_id).sort(), ['banner-dusk', 'set-nile']);
  assert.equal(v.lines.find(l => l.item_id === 'set-nile').price, s.price);
  assert.equal(v.total, s.price + await price('banner-dusk'));
  assert.deepEqual(v.suggestions, []);
  const log = (await q(`select item_id, event from public.cart_events where user_id=$1 order by id`, [U])).rows.map(r => r.item_id + ':' + r.event);
  assert.ok(log.includes('nile:remove') && log.includes('banner-nile-flow:remove') && log.includes('set-nile:add'));
  // buying it charges exactly what the cart said
  await topUp(U, 5000);
  const bought = await checkout(U, v.total);
  assert.equal(bought.total, v.total);
  assert.ok(await owns(U, 'set-nile') && await owns(U, 'frame-nile'));
});

await test('cart_swap_for_set: a refusal changes nothing (all or nothing)', async () => {
  const U = await newUser('refused');
  // a set that shares a part with a set already in the cart: cart_add refuses it, and the parts must stay in the cart
  await q(`insert into public.catalog_items (id, type, name, description, price) values ('set-clash','set','Clash set','Shares the gold ring with Dusk.',500)`);
  await q(`insert into public.set_parts (set_id, item_id) values ('set-clash','frame-gold'), ('set-clash','banner-halo')`);
  await add(U, 'set-dusk'); await add(U, 'frame-gold');
  const before = (await view(U)).lines.map(l => l.item_id).sort();
  await assert.rejects(swap(U, 'set-clash'), /shares parts/);
  assert.deepEqual((await view(U)).lines.map(l => l.item_id).sort(), before, 'frame-gold is still in the cart');
  // every part owned: nothing to switch to
  const O = await newUser('owns-all');
  await q(`insert into public.inventory (user_id, item_id) select $1, item_id from public.set_parts where set_id = 'set-cotton'`, [O]);
  await assert.rejects(swap(O, 'set-cotton'), /already own every part/);
  // a part that is not on sale, and things that are not sets
  const P = await newUser('offsale');
  await add(P, 'nile'); await add(P, 'banner-nile-flow');
  await q(`update public.catalog_items set active=false where id='frame-nile'`);
  await assert.rejects(swap(P, 'set-nile'), /not on sale/);
  assert.deepEqual((await view(P)).lines.map(l => l.item_id).sort(), ['banner-nile-flow', 'nile']);
  await q(`update public.catalog_items set active=true where id='frame-nile'`);
  await assert.rejects(swap(P, 'nile'), /not available/);
  await assert.rejects(swap(P, 'nope'), /not available/);
});

await test('cart_swap_for_set: signed-in members only, and one member cannot touch another\'s cart', async () => {
  const A = await newUser('member-a'), B = await newUser('member-b');
  await add(A, 'nile'); await add(A, 'banner-nile-flow');
  await as('anon', null, () => assert.rejects(q(`select public.cart_swap_for_set('set-nile')`), /permission denied/));
  await swap(B, 'set-nile'); // B's own cart only
  assert.deepEqual((await view(A)).lines.map(l => l.item_id).sort(), ['banner-nile-flow', 'nile']);
  assert.deepEqual((await view(B)).lines.map(l => l.item_id), ['set-nile']);
});

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exitCode = failed ? 1 : 0;
