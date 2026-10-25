// Tests for the cosmetics marketplace (supabase/migrations/20261025120000_forgeeks_market.sql)
//
// Runs every migration, in order, on PGlite with Supabase's roles and auth.uid() stubbed, then checks the
// seeded paid items, buying, equipping and what market_catalog() shows to anon, the owner and another member.
//
//   PGLITE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/market.test.mjs
//
// The theme ids and prices in js/forgeeks.js (the picker shows them before the catalog loads) are checked
// against the seed here, so the two lists cannot drift apart.

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

const paid = (await q(`select id, type, price from public.catalog_items where not is_default order by type, price`)).rows;

// ------------------------------------------------------------ the seed
await test('seed: 14 paid themes, 6 paid banners, 4 frames and 4 badges, each active, priced in whole coins, with a note', async () => {
  assert.deepEqual(paid.filter(p => p.type === 'theme').map(p => p.id).sort(), ['amber','dracula','frost','garnet','meadow','moss','nile','ocean','paper','phosphor','rose','solarized','synthwave','tokyo']);
  assert.equal(paid.filter(p => p.type === 'banner').length, 6);
  assert.equal(paid.filter(p => p.type === 'frame').length, 4);
  assert.equal(paid.filter(p => p.type === 'badge').length, 4);
  assert.equal(paid.length, 28);
  for (const p of paid) {
    assert.match(p.id, p.type === 'theme' ? /^[a-z]+$/ : /^(banner|frame|badge)-[a-z]+$/, p.id);
    assert.ok(p.price > 0 && Number.isInteger(p.price), p.id);
    if (p.type === 'theme') assert.ok(p.price >= 100 && p.price <= 250, p.id);
    else assert.ok(p.price >= 30 && p.price <= 120, p.id);
  }
  const rows = (await q(`select * from public.catalog_items where not is_default`)).rows;
  assert.ok(rows.every(r => r.active && r.description.length > 0 && r.description.length <= 300 && r.name.length > 0), 'active, with a note');
  assert.equal(new Set(rows.map(r => r.name)).size, rows.length, 'names are distinct');
});

await test('seed: Mono alone is free, default and active', async () => {
  const r = (await q(`select id, price, is_default, active from public.catalog_items where is_default order by id`)).rows;
  assert.deepEqual(r.map(x => x.id), ['mono']);
  assert.ok(r.every(x => x.price === 0 && x.active));
});

await test('seed: the theme list in js/forgeeks.js matches the catalog (ids, paid flag, price)', async () => {
  const js = readFileSync(new URL('../../js/forgeeks.js', import.meta.url), 'utf8');
  const entries = [...js.matchAll(/\{id:'([a-z0-9-]+)',name:'[^']*',note:'(?:[^'\\]|\\.)*',c:\[[^\]]*\](?:,light:true)?(?:,paid:true,price:(\d+))?\}/g)]
    .map(m => ({ id: m[1], price: m[2] ? +m[2] : 0 }));
  const db_ = (await q(`select id, price from public.catalog_items where type = 'theme' order by id`)).rows;
  assert.deepEqual(entries.sort((a, b) => a.id.localeCompare(b.id)), db_.map(r => ({ id: r.id, price: r.price })));
});

// ------------------------------------------------------------ buying
await test('every seeded paid item can be bought with exactly enough coins, and spending keeps the contribution score', async () => {
  for (const p of paid) {
    const u = await newUser();
    await award(u, p.price, 'buy-' + p.id);
    assert.deepEqual(await wallet(u), { balance: p.price, contribution_score: p.price }, p.id);
    const r = await buy(u, p.id, 'key-' + p.id + '-0001');
    assert.equal(r.rows[0].item_id, p.id);
    assert.equal(r.rows[0].price_paid, p.price, 'the price comes from the catalog');
    assert.deepEqual(await wallet(u), { balance: 0, contribution_score: p.price }, p.id);
    assert.equal((await q(`select count(*)::int c from public.inventory where user_id = $1 and item_id = $2`, [u, p.id])).rows[0].c, 1);
    const led = (await q(`select kind, wallet_delta, contribution_delta from public.ledger_entries where user_id = $1 and kind = 'purchase'`, [u])).rows;
    assert.deepEqual(led, [{ kind: 'purchase', wallet_delta: -p.price, contribution_delta: 0 }]);
  }
});

await test('one coin short is refused and charges nothing', async () => {
  for (const p of paid) {
    const u = await newUser();
    await award(u, p.price - 1, 'short-' + p.id);
    await assert.rejects(buy(u, p.id, 'key-short-' + p.id), /insufficient coins/);
    assert.deepEqual(await wallet(u), { balance: p.price - 1, contribution_score: p.price - 1 });
    assert.equal((await q(`select count(*)::int c from public.inventory where user_id = $1`, [u])).rows[0].c, 0);
  }
});

await test('the same request twice buys once; a second item with the same key is refused', async () => {
  const u = await newUser();
  await award(u, 500, 'idem');
  const a = await buy(u, 'banner-dusk', 'same-dialog-key');
  const b = await buy(u, 'banner-dusk', 'same-dialog-key');
  assert.equal(a.rows[0].id, b.rows[0].id);
  assert.equal((await wallet(u)).balance, 430);
  await assert.rejects(buy(u, 'banner-dunes', 'same-dialog-key'), /different item/);
  await assert.rejects(buy(u, 'banner-dusk', 'another-key-0002'), /already owned/);
  assert.equal((await wallet(u)).balance, 430);
});

await test('anonymous visitors cannot buy or equip; members cannot buy free or unknown items', async () => {
  await as('anon', null, async () => {
    await assert.rejects(q(`select * from public.purchase_item('moss', 'anon-key-0001')`), /permission denied/);
    await assert.rejects(q(`select * from public.equip_item('mono')`), /permission denied/);
    await assert.rejects(q(`select public.unequip_slot('banner')`), /permission denied/);
  });
  const u = await newUser();
  await award(u, 100, 'free-try');
  await assert.rejects(buy(u, 'mono', 'free-key-0001'), /free/);
  await assert.rejects(buy(u, 'banner-nope', 'free-key-0002'), /not available/);
});

await test('price constraints: a free item must be default, a default item must be free, no negative prices', async () => {
  await assert.rejects(q(`insert into public.catalog_items (id, type, name, price) values ('banner-free', 'banner', 'Free', 0)`), /default_is_free/);
  await assert.rejects(q(`insert into public.catalog_items (id, type, name, price, is_default) values ('banner-paid-default', 'banner', 'X', 10, true)`), /default_is_free/);
  await assert.rejects(q(`insert into public.catalog_items (id, type, name, price) values ('banner-neg', 'banner', 'X', -5)`), /price|default_is_free/);
  await assert.rejects(q(`insert into public.catalog_items (id, type, name, price) values ('Bad_Id', 'banner', 'X', 10)`), /catalog_items_id_check/);
  await assert.rejects(q(`update public.catalog_items set price = 0 where id = 'moss'`), /default_is_free/);
});

await test('members cannot change prices, catalog rows or their own inventory', async () => {
  await as('authenticated', OWNER, async () => {
    assert.equal((await q(`update public.catalog_items set price = 1 where id = 'moss'`)).affectedRows, 0);
    await assert.rejects(q(`insert into public.catalog_items (id, type, name, price) values ('banner-mine', 'banner', 'Mine', 5)`), /row-level security/);
    await assert.rejects(q(`insert into public.inventory (user_id, item_id) values ($1, 'frost')`, [OWNER]), /permission denied/);
  });
  assert.equal((await q(`select price from public.catalog_items where id = 'moss'`)).rows[0].price, 150);
});

// ------------------------------------------------------------ equipping
await test('a bought theme and a bought banner can be equipped, swapped and removed', async () => {
  const u = await newUser();
  await award(u, 400, 'equip');
  await buy(u, 'garnet', 'equip-key-0001');
  await buy(u, 'banner-circuit', 'equip-key-0002');
  const t = (await equip(u, 'garnet')).rows[0];
  assert.deepEqual([t.slot, t.item_id], ['theme', 'garnet']);
  const b = (await equip(u, 'banner-circuit')).rows[0];
  assert.deepEqual([b.slot, b.item_id], ['banner', 'banner-circuit']);
  const slots = () => as('authenticated', u, async () => (await q(`select slot, item_id from public.equipped_items order by slot`)).rows);
  assert.deepEqual(await slots(), [{ slot: 'banner', item_id: 'banner-circuit' }, { slot: 'theme', item_id: 'garnet' }]);
  await equip(u, 'mono'); // free themes swap in without a purchase
  assert.deepEqual(await slots(), [{ slot: 'banner', item_id: 'banner-circuit' }, { slot: 'theme', item_id: 'mono' }]);
  await as('authenticated', u, () => q(`select public.unequip_slot('banner')`));
  assert.deepEqual(await slots(), [{ slot: 'theme', item_id: 'mono' }]);
  await as('authenticated', u, () => q(`select public.unequip_slot('banner')`)); // removing twice is fine
  assert.deepEqual(await slots(), [{ slot: 'theme', item_id: 'mono' }]);
});

await test('free themes equip with no purchase and no coins', async () => {
  const u = await newUser();
  for (const id of ['mono']) {
    assert.equal((await equip(u, id)).rows[0].item_id, id);
  }
  assert.equal((await q(`select count(*)::int c from public.purchases where user_id = $1`, [u])).rows[0].c, 0);
  assert.deepEqual(await wallet(u), { balance: 0, contribution_score: 0 });
});

await test('paid items cannot be equipped without owning them, whatever the coins', async () => {
  const u = await newUser();
  await award(u, 1000, 'rich');
  for (const p of paid) await assert.rejects(equip(u, p.id), /not owned/, p.id);
  await assert.rejects(equip(u, 'no-such-item'), /not found/);
});

await test('a theme can only sit in the theme slot and a banner in the banner slot', async () => {
  // equip_item takes the slot from the item, so the browser cannot pick one
  const u = await newUser();
  await award(u, 400, 'slots');
  await buy(u, 'moss', 'slot-key-0001');
  await buy(u, 'banner-halo', 'slot-key-0002');
  await equip(u, 'moss'); await equip(u, 'banner-halo');
  const rows = (await q(`select slot, item_id from public.equipped_items where user_id = $1 order by slot`, [u])).rows;
  assert.deepEqual(rows, [{ slot: 'banner', item_id: 'banner-halo' }, { slot: 'theme', item_id: 'moss' }]);
  // and the table itself refuses a mismatch, even for the service role (a member with empty slots, so only the slot rule can fail)
  const w = await newUser();
  await assert.rejects(as('service_role', null, () => q(`insert into public.equipped_items (user_id, slot, item_id) values ($1, 'banner', 'moss')`, [w])), /equipped_items_item_id_slot_fkey/);
  await assert.rejects(as('service_role', null, () => q(`insert into public.equipped_items (user_id, slot, item_id) values ($1, 'theme', 'banner-halo')`, [w])), /equipped_items_item_id_slot_fkey/);
  // members cannot write the table at all
  await assert.rejects(as('authenticated', u, () => q(`insert into public.equipped_items (user_id, slot, item_id) values ($1, 'banner', 'moss')`, [u])), /permission denied/);
});

await test('another member cannot equip, unequip or read what I own', async () => {
  const u = await newUser(), v = await newUser();
  await award(u, 100, 'mine');
  await buy(u, 'banner-blueprint', 'mine-key-0001');
  await equip(u, 'banner-blueprint');
  await assert.rejects(equip(v, 'banner-blueprint'), /not owned/);
  await as('authenticated', v, () => q(`select public.unequip_slot('banner')`)); // only touches v's own rows
  assert.equal((await as('authenticated', u, async () => (await q(`select * from public.equipped_items`)).rows)).length, 1);
  assert.equal((await as('authenticated', v, async () => (await q(`select * from public.equipped_items`)).rows)).length, 0);
  assert.equal((await as('authenticated', v, async () => (await q(`select * from public.inventory`)).rows)).length, 0);
});

// ------------------------------------------------------------ market_catalog()
await test('market_catalog: anon sees every active item, nothing owned or equipped, themes first, then banners, frames and badges by price', async () => {
  const rows = await catalog('anon', null);
  assert.equal(rows.length, 12 + 9 + 8);
  assert.ok(rows.every(r => r.owned === false && r.equipped === false));
  assert.deepEqual(Object.keys(rows[0]).sort(), ['asset_version', 'description', 'equipped', 'id', 'is_default', 'name', 'owned', 'price', 'type']);
  const types = rows.map(r => r.type);
  assert.deepEqual(types, [...types].sort((a, b) => (a === 'theme' ? 0 : 1) - (b === 'theme' ? 0 : 1)));
  for (const t of ['theme', 'banner', 'frame', 'badge']) {
    const prices = rows.filter(r => r.type === t).map(r => r.price);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b), t + ' cheapest first');
  }
  assert.deepEqual(rows.filter(r => r.type === 'banner').map(r => r.id),
    ['banner-halo', 'banner-blueprint', 'banner-dusk', 'banner-circuit', 'banner-dunes', 'banner-borealis']);
  assert.deepEqual(rows.filter(r => r.type === 'theme' && !r.is_default).map(r => r.id).sort(), ['amber','dracula','frost','garnet','meadow','moss','nile','ocean','paper','phosphor','rose','solarized','synthwave','tokyo']);
});

await test('market_catalog: the owner sees what they own (free items count) and what is equipped; another member sees none of it', async () => {
  const rows = await catalog('authenticated', OWNER); // owns nothing yet
  assert.ok(rows.filter(r => r.is_default).every(r => r.owned));
  assert.ok(rows.filter(r => !r.is_default).every(r => !r.owned && !r.equipped));
  await award(OWNER, 450, 'owner-1');
  await buy(OWNER, 'frost', 'owner-key-0001');
  await buy(OWNER, 'banner-dunes', 'owner-key-0002');
  await equip(OWNER, 'frost');
  await equip(OWNER, 'banner-dunes');
  const mine = Object.fromEntries((await catalog('authenticated', OWNER)).map(r => [r.id, r]));
  assert.deepEqual([mine.frost.owned, mine.frost.equipped], [true, true]);
  assert.deepEqual([mine['banner-dunes'].owned, mine['banner-dunes'].equipped], [true, true]);
  assert.deepEqual([mine.moss.owned, mine.moss.equipped], [false, false]);
  assert.deepEqual([mine.mono.owned, mine.mono.equipped], [true, false]);
  await buy(OWNER, 'nile', 'owner-key-0003');
  await equip(OWNER, 'nile');
  const after = Object.fromEntries((await catalog('authenticated', OWNER)).map(r => [r.id, r]));
  assert.deepEqual([after.nile.equipped, after.frost.equipped, after.frost.owned], [true, false, true]);
  // another member: the same catalog, none of the owner's flags
  const theirs = Object.fromEntries((await catalog('authenticated', OTHER)).map(r => [r.id, r]));
  assert.deepEqual([theirs.frost.owned, theirs.frost.equipped, theirs['banner-dunes'].owned, theirs['banner-dunes'].equipped], [false, false, false, false]);
  assert.ok(Object.values(theirs).every(r => !r.equipped));
  // and anonymous visitors still see none
  assert.ok((await catalog('anon', null)).every(r => !r.owned && !r.equipped));
});

await test('market_catalog: a retired item is hidden from everyone but its owners, who keep it and can still equip it', async () => {
  const u = await newUser(), v = await newUser();
  await award(u, 100, 'retire');
  await buy(u, 'banner-halo', 'retire-key-0001');
  await q(`update public.catalog_items set active = false where id = 'banner-halo'`);
  try {
    assert.ok(!(await catalog('anon', null)).some(r => r.id === 'banner-halo'));
    assert.ok(!(await catalog('authenticated', v)).some(r => r.id === 'banner-halo'));
    const mine = (await catalog('authenticated', u)).find(r => r.id === 'banner-halo');
    assert.ok(mine && mine.owned);
    assert.equal((await equip(u, 'banner-halo')).rows[0].item_id, 'banner-halo');
    assert.equal((await catalog('authenticated', u)).find(r => r.id === 'banner-halo').equipped, true);
    await award(v, 500, 'retire-2');
    await assert.rejects(buy(v, 'banner-halo', 'retire-key-0002'), /not available/);
  } finally {
    await q(`update public.catalog_items set active = true where id = 'banner-halo'`);
  }
});

await test('market_catalog: only anon, authenticated and service_role may call it; the function runs without a session', async () => {
  const g = (await q(`select grantee from information_schema.routine_privileges
                      where routine_schema = 'public' and routine_name = 'market_catalog' order by grantee`)).rows.map(r => r.grantee);
  assert.deepEqual(g.filter(x => x !== 'postgres'), ['anon', 'authenticated', 'service_role']);
  assert.equal((await catalog('service_role', null)).length, 29);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
