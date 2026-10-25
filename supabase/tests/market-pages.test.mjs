// Tests for the For Geeks market page (forgeeks-market.html + js/forgeeks-market.js) and the theme picker's
// paid-theme rule (js/forgeeks.js), in jsdom with the real js/forgeeks-auth.js and a fake Supabase client.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/market-pages.test.mjs
//
// The fake client keeps a small catalog in memory and records every call; nothing here talks to the real project.
// What the database itself enforces (prices, ownership, slots) is tested in market.test.mjs.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { JSDOM, VirtualConsole } = process.env.JSDOM_PATH ? await import(pathToFileURL(process.env.JSDOM_PATH).href).then(m => m.default ?? m) : await import('jsdom');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const strip = h => h.replace(/<script[\s\S]*?<\/script>/g, '');
const marketHtml = strip(read('forgeeks-market.html'));
const roadmapHtml = strip(read('forgeeks-roadmap.html')); // any For Geeks page carries the theme picker
const authCode = read('js/forgeeks-auth.js');
const marketCode = read('js/forgeeks-market.js');
const pickerCode = read('js/forgeeks.js');
const plain = v => JSON.parse(JSON.stringify(v)); // objects made inside the simulated browser have their own prototypes
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const UID = '11111111-1111-4111-8111-111111111111';
const session = { user: { id: UID, email: 'ada@example.test' } };

const FREE = ['mono'];
const baseCatalog = () => [
  ...['paper','meadow','nile'].map(id=>({id,type:'theme',name:id,description:'Paid palette',price:100,is_default:false,asset_version:1})),
  ...FREE.map(id => ({ id, type: 'theme', name: id[0].toUpperCase() + id.slice(1), description: 'free ' + id, price: 0, is_default: true, asset_version: 1 })),
  { id: 'moss', type: 'theme', name: 'Moss', description: 'Dark olive and lime', price: 150, is_default: false, asset_version: 1 },
  { id: 'frost', type: 'theme', name: 'Frost', description: 'Cool light, slate and indigo', price: 250, is_default: false, asset_version: 1 },
  { id: 'banner-halo', type: 'banner', name: 'Halo', description: 'A soft glow.', price: 40, is_default: false, asset_version: 1 },
  { id: 'banner-dusk', type: 'banner', name: 'Dusk', description: 'Indigo sky.', price: 70, is_default: false, asset_version: 1 }
];

/* A fake Supabase client over a tiny in-memory "server". `opts.rpc(name, args, ctx)` may return a response to override. */
function fakeClient(w, opts, calls) {
  const srv = { balance: opts.balance ?? 200, owned: new Set(opts.owned ?? []), equipped: { ...(opts.equipped ?? {}) }, catalog: opts.catalog ?? baseCatalog() };
  const cbs = [];
  const thenable = v => ({ then: (a, b) => Promise.resolve(v).then(a, b) });
  const signedIn = () => !!srv.session;
  srv.session = opts.signedIn === false ? null : session;
  const builder = table => {
    const q = { table, filters: {} };
    const b = {
      select() { return b; }, maybeSingle() { return b; },
      eq(k, v) { q.filters[k] = v; return b; },
      then(res, rej) {
        calls.push({ table, filters: q.filters });
        let v = { data: null, error: null };
        if (table === 'wallets') v = opts.walletError ? { data: null, error: opts.walletError } : { data: { balance: srv.balance, contribution_score: 0 }, error: null };
        if (table === 'member_profiles') v = { data: { user_id: UID, display_name: 'ada', avatar_url: null }, error: null };
        return Promise.resolve(v).then(res, rej);
      }
    };
    return b;
  };
  const rpc = (name, args) => {
    calls.push({ fn: name, args });
    const over = opts.rpc && opts.rpc(name, args, srv);
    if (over) return thenable(over);
    const item = srv.catalog.find(i => i.id === args?.p_item_id);
    if (name === 'market_catalog') {
      return thenable({ data: srv.catalog.map(i => ({ ...i, owned: signedIn() && (i.is_default || srv.owned.has(i.id)), equipped: signedIn() && srv.equipped[i.type] === i.id })), error: null });
    }
    if (name === 'purchase_item_at_price') {
      if (!item || srv.balance < item.price) return thenable({ data: null, error: { message: 'insufficient coins', code: 'P0001' } });
      if (srv.owned.has(item.id)) return thenable({ data: null, error: { message: 'already owned', code: 'P0001' } });
      srv.balance -= item.price; srv.owned.add(item.id);
      return thenable({ data: { id: 1, item_id: item.id, price_paid: item.price }, error: null });
    }
    if (name === 'equip_item') {
      if (!item || !(item.is_default || srv.owned.has(item.id))) return thenable({ data: null, error: { message: 'item is not owned', code: '42501' } });
      srv.equipped[item.type] = item.id;
      return thenable({ data: { slot: item.type, item_id: item.id }, error: null });
    }
    if (name === 'unequip_slot') { delete srv.equipped[args.p_slot]; return thenable({ data: null, error: null }); }
    return thenable({ data: null, error: { message: 'unknown function' } });
  };
  const auth = {
    onAuthStateChange(f) { cbs.push(f); setTimeout(() => f('INITIAL_SESSION', srv.session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
    signOut: async () => { srv.session = null; cbs.forEach(f => f('SIGNED_OUT', null)); return { error: null }; }
  };
  return { client: { auth, from: builder, rpc }, srv, cbs };
}

/* Load a page the way the browser does: html, then (picker, supabase, auth, page script) in the shell's order. */
async function boot({ html = marketHtml, page = marketCode, picker = false, noFG = false, storedTheme, url = 'https://lightningeg.com/forgeeks-market.html', ...opts } = {}) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, { runScripts: 'outside-only', url, virtualConsole: vc, pretendToBeVisual: true });
  const w = dom.window;
  const calls = [];
  if (storedTheme) { w.localStorage.setItem('lightning-geeks-theme', storedTheme); w.document.documentElement.dataset.theme = storedTheme; }
  w.Element.prototype.scrollIntoView = function () {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const fake = fakeClient(w, opts, calls);
  if (picker) w.eval(pickerCode);
  if (!noFG) {
    w.supabase = { createClient: () => fake.client };
    w.FORGEEKS = { supabaseUrl: 'https://x.supabase.co', anonKey: 'anon' };
    w.eval(authCode);
  }
  if (page) w.eval(page);
  await tick(60);
  const $ = id => w.document.getElementById(id);
  const click = async (el, init = {}) => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, ...init })); await tick(30); };
  const key = async (el, k, extra = {}) => { el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })); await tick(10); };
  const cell = id => w.document.querySelector(`.mkt-cell[data-item="${id}"]`);
  const btn = (act, id) => w.document.querySelector(`button[data-act="${act}"][data-item="${id}"]`);
  const rpcs = name => calls.filter(c => c.fn === name);
  return { w, $, calls, fake, click, key, cell, btn, rpcs };
}

// ------------------------------------------------------------ market page
await test('market: signed out shows the whole catalog, no buy or equip buttons, and a sign-in link that comes back here', async () => {
  const p = await boot({ signedIn: false });
  assert.equal(p.$('mkt-body').hidden, false);
  assert.equal(p.w.document.querySelectorAll('.mkt-cell').length, 8);
  assert.equal(p.w.document.querySelectorAll('.mkt-cell button').length, 0);
  assert.equal(p.w.document.querySelectorAll('button[data-act]').length, 0);
  assert.equal(p.$('wallet').hidden, true);
  const si = p.$('mkt-signin');
  assert.equal(si.hidden, false);
  assert.equal(si.textContent, 'sign in to buy');
  assert.equal(si.getAttribute('href'), 'forgeeks-account.html?next=forgeeks-market.html');
  assert.equal(p.cell('moss').querySelector('.mkt-tag').textContent, '150 coins');
  assert.equal(p.cell('mono').querySelector('.mkt-tag').textContent, 'free');
  assert.ok(!p.calls.some(c => c.table === 'wallets'), 'no wallet read when signed out');
  assert.equal(p.rpcs('purchase_item_at_price').length, 0);
});

await test('market: signed in shows the wallet and one action per item: buy, equip or equipped', async () => {
  const p = await boot({ balance: 210, owned: ['frost', 'banner-dusk'], equipped: { theme: 'frost', banner: 'banner-dusk' } });
  assert.equal(p.$('wallet').hidden, false);
  assert.equal(p.$('wallet').textContent, 'coins 210');
  assert.equal(p.$('mkt-signin').hidden, true);
  assert.deepEqual(p.calls.filter(c => c.table === 'wallets').map(c => c.filters), [{ user_id: UID }]);
  assert.equal(p.cell('moss').dataset.state, 'for-sale');
  assert.deepEqual([...p.cell('moss').querySelectorAll('button')].map(b => b.textContent), ['buy']);
  assert.equal(p.cell('frost').dataset.state, 'equipped');
  assert.match(p.cell('frost').querySelector('.mkt-acts').textContent, /equipped/);
  assert.equal(p.cell('frost').querySelector('.mkt-tag').textContent, 'owned');
  assert.deepEqual([...p.cell('banner-dusk').querySelectorAll('button')].map(b => b.textContent), ['remove banner']);
  assert.deepEqual([...p.cell('banner-halo').querySelectorAll('button')].map(b => b.textContent), ['buy']);
  assert.deepEqual([...p.cell('mono').querySelectorAll('button')].map(b => b.textContent), ['equip']); // free themes: equip only
  assert.ok(!p.btn('buy', 'mono'), 'a free item is never bought');
  assert.equal(p.w.document.querySelectorAll('#list-banners .fg-banner').length, 2);
  assert.equal(p.cell('banner-halo').querySelector('.fg-banner').dataset.item, 'banner-halo');
  assert.equal(p.w.document.querySelectorAll('#list-themes .mkt-cell').length, 5);
  assert.equal(p.w.document.querySelectorAll('#list-free .mkt-cell').length, 1);
});

await test('market: the buy dialog shows price, balance now and balance after, and Esc closes it and returns focus', async () => {
  const p = await boot({ balance: 210 });
  await p.click(p.btn('buy', 'moss'));
  const dlg = p.$('buy');
  assert.equal(dlg.hidden, false);
  assert.equal(p.$('buy-title').textContent, 'buy moss');
  assert.equal(p.$('buy-price').textContent, '150 coins');
  assert.equal(p.$('buy-now').textContent, '210 coins');
  assert.equal(p.$('buy-after').textContent, '60 coins');
  assert.equal(p.rpcs('purchase_item_at_price').length, 0, 'opening the dialog buys nothing');
  assert.equal(p.w.document.activeElement, p.$('buy-ok'));
  await p.key(p.$('buy'), 'Escape');
  assert.equal(dlg.hidden, true);
  assert.equal(p.w.document.activeElement, p.btn('buy', 'moss'));
  assert.equal(p.rpcs('purchase_item_at_price').length, 0);
});

await test('market: the dialog traps Tab and Shift+Tab inside itself', async () => {
  const p = await boot({ balance: 500 });
  await p.click(p.btn('buy', 'frost'));
  const ok = p.$('buy-ok'), cancel = p.$('buy-cancel');
  assert.equal(p.w.document.activeElement, ok);
  cancel.focus();
  await p.key(p.$('buy'), 'Tab');
  assert.equal(p.w.document.activeElement, ok, 'Tab from the last button wraps to the first');
  await p.key(p.$('buy'), 'Tab', { shiftKey: true });
  assert.equal(p.w.document.activeElement, cancel, 'Shift+Tab from the first wraps to the last');
  p.w.document.body.focus();
  await p.key(p.$('buy'), 'Tab');
  assert.ok(p.$('buy').contains(p.w.document.activeElement), 'focus outside the dialog is pulled back in');
});

await test('market: confirm sends purchase_item once, with the item id and a key; the wallet drops, the item is owned, equip now is offered', async () => {
  const p = await boot({ balance: 210 });
  await p.click(p.btn('buy', 'moss'));
  await p.click(p.$('buy-ok'));
  await p.click(p.$('buy-ok')); // a second click after success does nothing
  const r = p.rpcs('purchase_item_at_price');
  assert.equal(r.length, 1);
  assert.equal(r[0].args.p_item_id, 'moss');
  assert.match(r[0].args.p_idempotency_key, /^[0-9a-f-]{8,100}$/);
  assert.deepEqual(Object.keys(r[0].args).sort(), ['p_expected_price', 'p_idempotency_key', 'p_item_id'], 'the displayed price is asserted; no balance is sent');
  assert.equal(p.$('coins').textContent, '60');
  assert.equal(p.cell('moss').dataset.state, 'owned');
  assert.equal(p.$('buy-title').textContent, 'moss is yours');
  assert.equal(p.$('buy-equip').hidden, false);
  assert.equal(p.$('buy-ok').hidden, true);
  assert.equal(p.$('buy-now').textContent, '60 coins');
  assert.equal(p.w.document.activeElement, p.$('buy-equip'));
  await p.click(p.$('buy-equip'));
  assert.equal(p.$('buy').hidden, true);
  assert.equal(p.rpcs('equip_item').length, 1);
  assert.equal(p.rpcs('equip_item')[0].args.p_item_id, 'moss');
  assert.equal(p.w.document.documentElement.dataset.theme, 'moss');
  assert.equal(p.w.localStorage.getItem('lightning-geeks-theme'), 'moss');
  assert.equal(p.cell('moss').dataset.state, 'equipped');
});

await test('market: a retry in the same dialog reuses the same key; a new dialog makes a new one', async () => {
  let fail = true;
  const p = await boot({ balance: 500, rpc: (name) => (name === 'purchase_item_at_price' && fail ? { data: null, error: { message: 'Failed to fetch' } } : null) });
  await p.click(p.btn('buy', 'frost'));
  await p.click(p.$('buy-ok'));
  assert.match(p.$('buy-status').textContent, /Cannot reach the server/);
  assert.equal(p.$('buy').hidden, false, 'the dialog stays open for a retry');
  assert.equal(p.$('buy-ok').disabled, false);
  fail = false;
  await p.click(p.$('buy-ok'));
  const r = p.rpcs('purchase_item_at_price');
  assert.equal(r.length, 2);
  assert.equal(r[0].args.p_idempotency_key, r[1].args.p_idempotency_key);
  assert.equal(p.cell('frost').dataset.state, 'owned');
  // another dialog, another key
  await p.click(p.$('buy-cancel'));
  await p.click(p.btn('buy', 'banner-halo'));
  await p.click(p.$('buy-ok'));
  const keys = p.rpcs('purchase_item_at_price').map(c => c.args.p_idempotency_key);
  assert.equal(new Set(keys).size, 2);
  // the same item in a reopened dialog also gets a fresh key
  const q = await boot({ balance: 10 });
  await q.click(q.btn('buy', 'moss')); await q.click(q.$('buy-ok'));
  await q.click(q.$('buy-cancel'));
  await q.click(q.btn('buy', 'moss')); await q.click(q.$('buy-ok'));
  const k2 = q.rpcs('purchase_item_at_price').map(c => c.args.p_idempotency_key);
  assert.equal(k2.length, 2);
  assert.notEqual(k2[0], k2[1]);
});

await test('market: not enough coins is said in plain words, charges nothing and keeps the dialog open', async () => {
  const p = await boot({ balance: 100 });
  await p.click(p.btn('buy', 'moss'));
  assert.equal(p.$('buy-after').textContent, '−50 coins');
  assert.match(p.$('buy-status').textContent, /100 coins/);
  await p.click(p.$('buy-ok'));
  assert.equal(p.rpcs('purchase_item_at_price').length, 1, 'the server is asked and decides');
  assert.equal(p.$('buy-status').textContent, 'Not enough coins for that yet.');
  assert.match(p.$('buy-status').className, /bad/);
  assert.equal(p.$('buy').hidden, false);
  assert.equal(p.$('coins').textContent, '100');
  assert.equal(p.cell('moss').dataset.state, 'for-sale');
});

await test('market: "already owned" from the server marks the item owned and closes the dialog', async () => {
  const p = await boot({ balance: 500, rpc: (name, args, srv) => { if (name === 'purchase_item_at_price') { srv.owned.add('moss'); return { data: null, error: { message: 'already owned', code: 'P0001' } }; } return null; } });
  await p.click(p.btn('buy', 'moss'));
  await p.click(p.$('buy-ok'));
  assert.equal(p.$('buy').hidden, true);
  assert.equal(p.$('mkt-msg').textContent, 'You already own that.');
  assert.equal(p.cell('moss').dataset.state, 'owned');
});

await test('market: a double click on confirm is one request', async () => {
  const p = await boot({ balance: 500 });
  await p.click(p.btn('buy', 'moss'));
  await p.click(p.$('buy-ok'), { detail: 1 });
  await p.click(p.$('buy-ok'), { detail: 2 });
  assert.equal(p.rpcs('purchase_item_at_price').length, 1);
});

await test('market: an in-flight purchase cannot be replaced by another item dialog',async()=>{
 let done;const delayed=new Promise(r=>done=r);
 const p=await boot({balance:500,rpc:name=>name==='purchase_item_at_price'?delayed:null});
 await p.click(p.btn('buy','moss'));await p.click(p.$('buy-ok'));await p.click(p.$('buy-cancel'));await p.click(p.btn('buy','frost'));
 assert.match(p.$('buy-title').textContent,/moss/);assert.match(p.$('mkt-msg').textContent,/still processing/);
 done({data:{price_paid:150},error:null});await tick(30);assert.equal(p.cell('moss').dataset.state,'owned');assert.equal(p.cell('frost').dataset.state,'for-sale');p.w.close();
});

await test('market: returning to a tab refreshes coins credited on another page',async()=>{
 const p=await boot({balance:0});p.fake.srv.balance=525;p.w.dispatchEvent(new p.w.Event('focus'));await tick(30);assert.equal(p.$('coins').textContent,'525');p.w.close();
});

await test('market: equipping a theme calls equip_item, applies the theme now and remembers it', async () => {
  const p = await boot({ owned: ['frost'] });
  await p.click(p.btn('equip', 'frost'));
  assert.deepEqual(plain(p.rpcs('equip_item').map(c => c.args)), [{ p_item_id: 'frost' }]);
  assert.equal(p.w.document.documentElement.dataset.theme, 'frost');
  assert.equal(p.w.localStorage.getItem('lightning-geeks-theme'), 'frost');
  assert.equal(p.cell('frost').dataset.state, 'equipped');
  assert.equal(p.$('mkt-msg').textContent, 'Frost is equipped.');
  await p.click(p.btn('equip', 'mono'));
  assert.equal(p.w.document.documentElement.dataset.theme, undefined, 'mono is the default: no attribute');
  assert.equal(p.w.localStorage.getItem('lightning-geeks-theme'), 'mono');
  assert.equal(p.cell('frost').dataset.state, 'owned');
});

await test('market: a refused equip changes nothing on the page and says why', async () => {
  const p = await boot({ owned: ['frost'], rpc: (name) => (name === 'equip_item' ? { data: null, error: { message: 'item is not owned', code: '42501' } } : null) });
  await p.click(p.btn('equip', 'frost'));
  assert.equal(p.w.document.documentElement.dataset.theme, undefined);
  assert.equal(p.w.localStorage.getItem('lightning-geeks-theme'), null);
  assert.equal(p.$('mkt-msg').textContent, 'That is not allowed for your account.');
});

await test('market: equipping a banner calls equip_item without touching the theme; remove banner calls unequip_slot', async () => {
  const p = await boot({ owned: ['banner-halo', 'banner-dusk'], equipped: { banner: 'banner-dusk' } });
  await p.click(p.btn('equip', 'banner-halo'));
  assert.deepEqual(plain(p.rpcs('equip_item').map(c => c.args)), [{ p_item_id: 'banner-halo' }]);
  assert.equal(p.w.document.documentElement.dataset.theme, undefined);
  assert.equal(p.w.localStorage.getItem('lightning-geeks-theme'), null);
  assert.equal(p.cell('banner-halo').dataset.state, 'equipped');
  assert.equal(p.cell('banner-dusk').dataset.state, 'owned');
  await p.click(p.btn('remove', 'banner-halo'));
  assert.deepEqual(plain(p.rpcs('unequip_slot').map(c => c.args)), [{ p_slot: 'banner' }]);
  assert.equal(p.w.document.querySelectorAll('.mkt-cell.banner.equipped').length, 0);
  assert.equal(p.w.document.querySelectorAll('button[data-act="remove"]').length, 0);
  assert.equal(p.$('mkt-msg').textContent, 'Banner removed.');
});

await test('market: catalog text is shown as text only', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const catalog = baseCatalog(); catalog[4] = { ...catalog[4], name: evil, description: evil };
  const p = await boot({ catalog });
  assert.equal(p.w.document.querySelectorAll('.mkt-cell img').length, 0);
  assert.equal(p.cell('moss').querySelector('.mkt-name').textContent, evil);
  await p.click(p.btn('buy', 'moss'));
  assert.equal(p.w.document.querySelectorAll('#buy img').length, 0);
  assert.equal(p.$('buy-title').textContent, 'buy ' + evil.toLowerCase());
});

await test('market: signing out reloads the catalog without the member flags and without buy buttons', async () => {
  const p = await boot({ owned: ['frost'] });
  assert.equal(p.cell('frost').dataset.state, 'owned');
  await p.w.FG.sb.auth.signOut(); await tick(60);
  assert.equal(p.cell('frost').dataset.state, 'for-sale');
  assert.equal(p.w.document.querySelectorAll('.mkt-cell button').length, 0);
  assert.equal(p.$('wallet').hidden, true);
  assert.equal(p.$('mkt-signin').hidden, false);
});

await test('market: if the catalog cannot be read the page says so; if the client is missing it says that instead of going blank', async () => {
  const p = await boot({ rpc: (name) => (name === 'market_catalog' ? { data: null, error: { message: 'Failed to fetch' } } : null) });
  assert.match(p.$('mkt-msg').textContent, /Cannot reach the server/);
  assert.equal(p.$('mkt-loading').hidden, true);
  const q = await boot({ noFG: true });
  assert.equal(q.$('mkt-msg').textContent, 'Sign-in is not available right now.');
  assert.equal(q.$('mkt-loading').hidden, true);
});

// ------------------------------------------------------------ theme picker
const pickerPage = (o = {}) => boot({ html: roadmapHtml, page: null, picker: true, url: 'https://lightningeg.com/forgeeks-roadmap.html', ...o });
const card = (p, id) => p.w.document.getElementById('th-' + id);

await test('picker: paid themes show a lock and their price; free themes show neither', async () => {
  const p = await pickerPage({ signedIn: false });
  const moss = card(p, 'moss');
  assert.ok(moss.classList.contains('lk'));
  assert.match(moss.querySelector('.tm-price').textContent, /locked, 150 coins/);
  assert.ok(moss.querySelector('.tm-price svg'));
  assert.match(card(p, 'garnet').querySelector('.tm-price').textContent, /200 coins/);
  assert.match(card(p, 'frost').querySelector('.tm-price').textContent, /250 coins/);
  assert.equal(card(p, 'mono').querySelector('.tm-price'), null);
  assert.equal(p.w.LG.THEMES.length, 15);
});

await test('picker: signed out, keeping a paid theme keeps nothing, restores the saved theme and points to the market', async () => {
  const p = await pickerPage({ signedIn: false, storedTheme: 'nile' });
  p.w.LG.open();
  await p.click(card(p, 'moss'));
  assert.equal(p.w.LG.current(), 'mono');
  assert.equal(p.w.document.documentElement.dataset.theme, undefined);
  assert.equal(p.w.localStorage.getItem('lightning-geeks-theme'), 'mono');
  assert.equal(p.w.document.getElementById('themes').hidden, true);
  const toast = p.w.document.getElementById('toast');
  assert.ok(toast.classList.contains('on'));
  assert.match(toast.textContent, /moss is a paid theme, 150 coins\./);
  const a = toast.querySelector('a');
  assert.equal(a.getAttribute('href'), 'forgeeks-market.html');
  assert.equal(p.rpcs('equip_item').length, 0);
  // the same through the keyboard: arrows preview, Enter keeps
  p.w.LG.open();
  const grid = p.w.document.getElementById('theme-list');
  await p.key(grid, 'End');
  assert.equal(p.w.document.documentElement.dataset.theme, 'frost', 'preview is allowed for everyone');
  await p.key(grid, 'Enter');
  assert.equal(p.w.document.documentElement.dataset.theme, undefined, 'but keeping is not');
  assert.equal(p.w.LG.current(), 'mono');
  assert.match(toast.textContent, /frost is a paid theme, 250 coins\./);
});

await test('picker: a free theme keeps with no account, no network call and no toast link', async () => {
  const p = await pickerPage({ signedIn: false });
  p.w.LG.open();
  await p.click(card(p, 'mono'));
  assert.equal(p.w.LG.current(), 'mono');
  assert.equal(p.w.document.documentElement.dataset.theme, undefined);
  assert.equal(p.w.localStorage.getItem('lightning-geeks-theme'), 'mono');
  assert.equal(p.rpcs('equip_item').length, 0);
  assert.equal(p.w.document.getElementById('toast').querySelector('a'), null);
});

await test('picker: archived themes are hidden unless owned; arrow keys walk only the shown ones', async () => {
  const p = await pickerPage({ signedIn: false });
  const shown = [...p.w.document.querySelectorAll('.tm-card')].filter(c => !c.hidden).map(c => c.dataset.id);
  assert.deepEqual(shown, ['mono', 'paper', 'meadow', 'nile', 'garnet', 'frost']);
  p.w.LG.open();
  const grid = p.w.document.getElementById('theme-list');
  grid.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(grid.getAttribute('aria-activedescendant'), 'th-frost');
  const q = await pickerPage({ owned: ['moss'] });
  await tick(60);
  assert.equal(card(q, 'moss').hidden, false, 'an archived theme you own stays in your picker');
  assert.equal(card(q, 'ocean').hidden, true);
});

await test('picker: signed in, owned paid themes keep and follow the account; unowned ones are still refused', async () => {
  const p = await pickerPage({ owned: ['moss'], equipped: {} });
  assert.deepEqual(p.rpcs('market_catalog').length, 1, 'the catalog is read once');
  assert.ok(!card(p, 'moss').classList.contains('lk'));
  assert.equal(card(p, 'moss').querySelector('.tm-price').textContent, 'owned');
  assert.ok(card(p, 'frost').classList.contains('lk'));
  p.w.LG.open();
  await p.click(card(p, 'moss'));
  assert.equal(p.w.LG.current(), 'moss');
  assert.equal(p.w.localStorage.getItem('lightning-geeks-theme'), 'moss');
  assert.deepEqual(plain(p.rpcs('equip_item').map(c => c.args)), [{ p_item_id: 'moss' }]);
  p.w.LG.open();
  await p.click(card(p, 'frost'));
  assert.equal(p.w.LG.current(), 'moss');
  assert.equal(p.rpcs('equip_item').length, 1, 'a refused theme is never sent');
  p.w.LG.open();
  await p.click(card(p, 'mono')); // free themes follow the account too
  assert.deepEqual(p.rpcs('equip_item').map(c => c.args.p_item_id), ['moss', 'mono']);
});

await test('picker: on load the theme equipped on the account replaces the local one and is stored', async () => {
  const p = await pickerPage({ owned: ['frost'], equipped: { theme: 'frost' }, storedTheme: 'ocean' });
  assert.equal(p.w.document.documentElement.dataset.theme, 'frost');
  assert.equal(p.w.localStorage.getItem('lightning-geeks-theme'), 'frost');
  assert.equal(p.w.LG.current(), 'frost');
  assert.equal(p.w.document.getElementById('theme-name').textContent, 'frost');
  assert.equal(p.rpcs('equip_item').length, 0, 'loading writes nothing');
  // nothing equipped on the account: the local theme stays
  const q = await pickerPage({ equipped: {}, storedTheme: 'ocean' });
  assert.equal(q.w.document.documentElement.dataset.theme, undefined);
  // an equipped id this page does not know is ignored
  const r = await pickerPage({ owned: ['zebra'], equipped: { theme: 'zebra' }, storedTheme: 'ocean', catalog: [...baseCatalog(), { id: 'zebra', type: 'theme', name: 'Zebra', description: 'x', price: 10, is_default: false, asset_version: 1 }] });
  assert.equal(r.w.document.documentElement.dataset.theme, undefined);
});

await test('picker: signing out locks paid themes again and restores Mono', async () => {
  const p = await pickerPage({ owned: ['moss'], equipped: { theme: 'moss' } });
  assert.equal(p.w.document.documentElement.dataset.theme, 'moss');
  await p.w.FG.sb.auth.signOut(); await tick(60);
  assert.ok(card(p, 'moss').classList.contains('lk'));
  assert.equal(p.w.document.documentElement.dataset.theme, undefined, 'signed-out sessions return to the free palette');
  p.w.LG.open();
  await p.click(card(p, 'garnet'));
  assert.equal(p.w.LG.current(), 'mono');
  assert.equal(p.rpcs('equip_item').length, 0);
});

await test('picker: bought on the market page, a theme unlocks in the picker without a reload', async () => {
  const p = await boot({ picker: true, balance: 300 });
  assert.ok(card(p, 'moss').classList.contains('lk'));
  await p.click(p.btn('buy', 'moss')); await p.click(p.$('buy-ok'));
  assert.ok(!card(p, 'moss').classList.contains('lk'));
  assert.equal(p.rpcs('market_catalog').length, 2, 'the picker and the page each read the catalog once');
  p.w.LG.open();
  await p.click(card(p, 'moss'));
  assert.equal(p.w.LG.current(), 'moss');
});

await test('picker: without the account scripts it works exactly as before for free themes and refuses paid ones', async () => {
  const p = await pickerPage({ noFG: true });
  p.w.LG.open();
  await p.click(card(p, 'mono'));
  assert.equal(p.w.LG.current(), 'mono');
  p.w.LG.open();
  await p.click(card(p, 'moss'));
  assert.equal(p.w.LG.current(), 'mono');
  assert.equal(p.w.LG.keep('frost'), false);
  assert.equal(p.w.LG.keep('mono'), true);
  assert.equal(p.w.document.documentElement.dataset.theme, undefined);
});

await test('picker: the theme list, the head boot script and the stylesheet know the same themes', async () => {
  const p = await pickerPage({ signedIn: false });
  const ids = plain(p.w.LG.THEMES.map(t => t.id)).sort();
  const css = read('css/forgeeks.css');
  for (const id of ids) if (id !== 'mono') assert.ok(css.includes(`:root[data-theme="${id}"]{`), id);
  for (const f of ['forgeeks.html', 'forgeeks-guide.html', 'forgeeks-roadmap.html', 'forgeeks-account.html', 'forgeeks-market.html']) {
    const boot_ = read(f).match(/getItem\('lightning-geeks-theme'\);if\(\/\^\(([a-z0-9|-]+)\)\$\//)[1].split('|').sort();
    assert.deepEqual(boot_, ids, f);
  }
  // light themes are marked, so the logo and the field switch
  assert.deepEqual(plain(p.w.LG.THEMES.filter(t => t.light).map(t => t.id)), ['paper', 'frost']);
  assert.ok(css.includes('[data-theme="frost"] .geeks-mark-light'));
});

await test('market: a purchase response arriving after sign-out cannot restore the previous account UI',async()=>{
 let finish;const pending=new Promise(r=>finish=r);
 const p=await boot({balance:500,rpc:name=>name==='purchase_item_at_price'?pending:null});
 await p.click(p.btn('buy','moss'));
 p.$('buy-ok').click();await tick(10);
 await p.w.FG.sb.auth.signOut();await tick(60);
 finish({data:{price_paid:150},error:null});await tick(60);
 assert.equal(p.$('buy').hidden,true);assert.equal(p.cell('moss').dataset.state,'for-sale');
 assert.equal(p.$('wallet').hidden,true);
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
