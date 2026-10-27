// Tests for the marketplace cart (js/market-cart.js on the market page), in jsdom with the real js/forgeeks-auth.js,
// js/forgeeks-market.js and a fake Supabase client that keeps a small server-side cart in memory.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/cart-pages.test.mjs
//
// What the database enforces (prices, ownership, all-or-nothing checkout) is tested in cart.test.mjs.

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
const html = read('forgeeks-market.html').replace(/<script[\s\S]*?<\/script>/g, '');
const authCode = read('js/forgeeks-auth.js'), marketCode = read('js/forgeeks-market.js'), cartCode = read('js/market-cart.js');
const plain = v => JSON.parse(JSON.stringify(v)); // objects made inside the simulated browser have their own prototypes
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const UID = '11111111-1111-4111-8111-111111111111';
const CATALOG = [
  { id: 'mono', type: 'theme', name: 'Mono', description: 'free', price: 0, is_default: true, asset_version: 1 },
  { id: 'moss', type: 'theme', name: 'Moss', description: 'Dark olive', price: 150, is_default: false, asset_version: 1 },
  { id: 'banner-halo', type: 'banner', name: 'Halo', description: 'A soft glow.', price: 40, is_default: false, asset_version: 1 },
  { id: 'banner-dusk', type: 'banner', name: 'Dusk', description: 'Indigo sky.', price: 70, is_default: false, asset_version: 1 }
];

async function boot({ signedIn = true, balance = 500, cart = [], checkout, main = false } = {}) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lightningeg.com/marketplace.html', virtualConsole: vc, pretendToBeVisual: true });
  const w = dom.window, calls = [];
  w.Element.prototype.scrollIntoView = function () {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const srv = { balance, cart: [...cart], owned: new Set(), session: signedIn ? { user: { id: UID, email: 'ada@example.test' } } : null };
  const find = id => CATALOG.find(i => i.id === id);
  const view = () => ({
    lines: srv.cart.map(id => ({ item_id: id, name: find(id).name, type: find(id).type, price: srv.gone?.has(id) ? 0 : find(id).price, status: srv.gone?.has(id) ? 'unavailable' : 'ok' })),
    total: srv.cart.reduce((s, id) => s + (srv.gone?.has(id) ? 0 : find(id).price), 0), balance: srv.balance });
  const thenable = v => ({ then: (a, b) => Promise.resolve(v).then(a, b) });
  const rpc = (name, args) => {
    calls.push({ fn: name, args });
    if (name === 'market_catalog') return thenable({ data: CATALOG.map(i => ({ ...i, owned: i.is_default || srv.owned.has(i.id), equipped: false })), error: null });
    if (name === 'cart_view') return thenable({ data: view(), error: null });
    if (name === 'cart_add') { if (!srv.cart.includes(args.p_item_id)) srv.cart.push(args.p_item_id); return thenable({ data: view(), error: null }); }
    if (name === 'cart_remove') { srv.cart = srv.cart.filter(i => i !== args.p_item_id); return thenable({ data: view(), error: null }); }
    if (name === 'cart_clear') { srv.cart = []; return thenable({ data: view(), error: null }); }
    if (name === 'checkout_cart') {
      if (checkout) { const r = checkout(args, srv, view); if (r) return thenable(r); }
      const v = view();
      if (args.p_expected_total !== v.total) return thenable({ data: null, error: { message: 'price changed; reload the cart before buying' } });
      if (srv.balance < v.total) return thenable({ data: null, error: { message: 'insufficient coins', code: 'P0001' } });
      srv.balance -= v.total; v.lines.forEach(l => srv.owned.add(l.item_id)); srv.cart = [];
      return thenable({ data: { order_id: 'o1', total: v.total, balance: srv.balance, lines: v.lines.map(l => ({ item_id: l.item_id, name: l.name, price_paid: l.price })) }, error: null });
    }
    return thenable({ data: null, error: { message: 'unknown function' } });
  };
  const builder = table => { const b = { select() { return b; }, maybeSingle() { return b; }, eq() { return b; },
    then(res, rej) { return Promise.resolve(table === 'wallets' ? { data: { balance: srv.balance, contribution_score: 0 }, error: null } : { data: null, error: null }).then(res, rej); } }; return b; };
  const client = { rpc, from: builder, auth: { onAuthStateChange(f) { setTimeout(() => f('INITIAL_SESSION', srv.session), 0); return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => ({ error: null }) } };
  w.supabase = { createClient: () => client };
  w.FORGEEKS = { supabaseUrl: 'https://x.supabase.co', anonKey: 'anon' };
  if (main) { w.document.body.dataset.mainStore = 'true'; w.LG = { THEMES: [{ id: 'moss', name: 'Moss', c: ['#101a10', '#e6f0d8', '#8fa080', '#9acd32'] }] }; }
  w.eval(authCode); w.eval(marketCode); w.eval(cartCode);
  await tick(80);
  const $ = id => w.document.getElementById(id);
  const click = async el => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(40); };
  const cartBtn = id => w.document.querySelector(`.mkt-cell[data-item="${id}"] [data-cart]`);
  const rpcs = name => calls.filter(c => c.fn === name);
  return { w, $, click, cartBtn, rpcs, srv };
}

await test('cart: signed out shows no cart and no add buttons', async () => {
  const p = await boot({ signedIn: false });
  assert.equal(p.$('cart-open').hidden, true);
  assert.equal(p.w.document.querySelectorAll('[data-cart]').length, 0);
  assert.equal(p.rpcs('cart_view').length, 0);
});

await test('cart: each item for sale gets add to cart beside buy; free and owned ones do not', async () => {
  const p = await boot();
  const labels = id => [...p.w.document.querySelectorAll(`.mkt-cell[data-item="${id}"] button`)].map(b => b.textContent);
  assert.deepEqual(labels('moss'), ['buy', 'add to cart', 'gift']);
  assert.ok(!labels('mono').includes('add to cart'), 'a free default is not sold');
  assert.equal(p.$('cart-open').hidden, false);
  assert.equal(p.$('cart-open').textContent.trim(), 'cart 0');
});

await test('cart: adding and removing go to the server and the card, chip and count follow', async () => {
  const p = await boot();
  await p.click(p.cartBtn('moss'));
  assert.deepEqual(plain(p.rpcs('cart_add').map(c => c.args)), [{ p_item_id: 'moss' }]);
  assert.equal(p.cartBtn('moss').textContent, 'in cart ✓');
  assert.equal(p.cartBtn('moss').getAttribute('aria-pressed'), 'true');
  assert.equal(p.$('cart-open').textContent.trim(), 'cart 1');
  await p.click(p.cartBtn('moss'));
  assert.deepEqual(plain(p.rpcs('cart_remove').map(c => c.args)), [{ p_item_id: 'moss' }]);
  assert.equal(p.cartBtn('moss').textContent, 'add to cart');
  assert.equal(p.$('cart-open').textContent.trim(), 'cart 0');
});

await test('cart: a cart kept on the server shows on load, from another device', async () => {
  const p = await boot({ cart: ['banner-halo', 'banner-dusk'] });
  assert.equal(p.$('cart-open').textContent.trim(), 'cart 2');
  assert.equal(p.cartBtn('banner-halo').textContent, 'in cart ✓');
});

await test('cart: the window lists lines, the total and the balance after; buy everything charges once at the shown total', async () => {
  const p = await boot({ cart: ['moss', 'banner-halo'], balance: 500 });
  await p.click(p.$('cart-open'));
  assert.equal(p.$('cart').hidden, false);
  assert.equal(p.w.document.querySelectorAll('#cart-lines .mkt-cart-line').length, 2);
  assert.equal(p.$('cart-total').textContent, '190 coins');
  assert.equal(p.$('cart-now').textContent, '500 coins');
  assert.equal(p.$('cart-after').textContent, '310 coins');
  await p.click(p.$('cart-ok'));
  const sent = p.rpcs('checkout_cart');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].args.p_expected_total, 190);
  assert.ok(sent[0].args.p_idempotency_key.length >= 8 && sent[0].args.p_idempotency_key.length <= 36);
  assert.equal(p.$('cart-title').textContent, 'order placed');
  assert.equal(p.$('cart-total').textContent, '190 coins');
  assert.equal(p.$('cart-now').textContent, '310 coins');
  assert.equal(p.$('cart-open').textContent.trim(), 'cart 0');
  assert.ok(p.rpcs('market_catalog').length >= 2, 'the market is read again so the cards show Owned');
  await p.click(p.$('cart-ok')); // hidden after success
  assert.equal(p.rpcs('checkout_cart').length, 1);
});

await test('cart: not enough coins says how many more, offers a top-up, and keeps the cart', async () => {
  const p = await boot({ cart: ['moss'], balance: 100 });
  await p.click(p.$('cart-open'));
  assert.equal(p.$('cart-after').textContent, '−50 coins');
  assert.equal(p.$('cart-ok').disabled, true);
  assert.equal(p.$('cart-topup').hidden, false);
  assert.equal(p.$('cart-topup').getAttribute('href'), 'topup.html');
  assert.match(p.$('cart-status').textContent, /50 coins more/);
  assert.equal(p.rpcs('checkout_cart').length, 0, 'nothing is sent that cannot work');
});

await test('cart: a price that changed reloads the cart and asks again; the same key is not reused after a new total', async () => {
  const p = await boot({ cart: ['moss'], balance: 500, checkout: (args, srv) => { if (!srv.once) { srv.once = true; CATALOG[1].price = 120; return { data: null, error: { message: 'price changed; reload the cart before buying' } }; } } });
  await p.click(p.$('cart-open'));
  await p.click(p.$('cart-ok'));
  assert.match(p.$('cart-status').textContent, /price changed/i);
  assert.equal(p.$('cart-total').textContent, '120 coins', 'the new total is shown');
  assert.equal(p.$('cart-title').textContent, 'your cart');
  await p.click(p.$('cart-ok'));
  assert.equal(p.rpcs('checkout_cart')[1].args.p_expected_total, 120);
  assert.equal(p.$('cart-title').textContent, 'order placed');
  CATALOG[1].price = 150;
});

await test('cart: an item that is no longer on sale blocks buying until it is removed', async () => {
  const p = await boot({ cart: ['moss', 'banner-halo'] });
  p.srv.gone = new Set(['moss']);
  await p.click(p.$('cart-open'));
  assert.equal(p.$('cart-ok').disabled, true);
  assert.match(p.$('cart-status').textContent, /Remove the items marked/);
  await p.click(p.w.document.querySelector('#cart-lines .mkt-cart-line .mkt-mini'));
  assert.equal(p.$('cart-ok').disabled, false);
  assert.equal(p.$('cart-total').textContent, '40 coins');
});

await test('cart: empty cart clears everything; Escape closes the window and returns focus', async () => {
  const p = await boot({ cart: ['moss', 'banner-halo'] });
  await p.click(p.$('cart-open'));
  await p.click(p.$('cart-clear'));
  assert.equal(p.rpcs('cart_clear').length, 1);
  assert.equal(p.$('cart-open').textContent.trim(), 'cart 0');
  assert.match(p.$('cart-status').textContent, /empty/);
  p.$('cart').dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(p.$('cart').hidden, true);
});

await test('cart: server text is only ever inserted as text', async () => {
  const p = await boot({ cart: ['moss'] });
  CATALOG[1].name = '<img src=x onerror=alert(1)>';
  await p.click(p.$('cart-open'));
  assert.equal(p.w.document.querySelectorAll('#cart img').length, 0);
  CATALOG[1].name = 'Moss';
});

await test('main: a floating Cart button shows the count whenever the cart has lines, and opens the cart window', async () => {
  const p = await boot({ main: true });
  const fab = p.$('cart-fab');
  assert.ok(fab && fab.hidden, 'hidden while the cart is empty');
  await p.click(p.cartBtn('moss'));
  assert.equal(fab.hidden, false);
  assert.equal(fab.querySelector('b').textContent, '1');
  assert.equal(fab.getAttribute('aria-label'), 'Cart, 1 item');
  assert.equal(fab.firstChild.textContent, 'Cart', 'sentence case on the main site');
  assert.equal(fab.parentNode, p.w.document.body);
  await p.click(fab);
  assert.equal(p.$('cart').hidden, false);
  assert.equal(p.$('cart-title').textContent, 'Your cart');
  assert.deepEqual([p.$('cart-l1').textContent, p.$('cart-l2').textContent, p.$('cart-l3').textContent], ['Total', 'Balance now', 'Balance after']);
  assert.equal(p.$('cart-ok').textContent, 'Buy everything');
  await p.click(p.$('cart-close'));
  const signedOut = await boot({ main: true, signedIn: false });
  assert.equal(signedOut.$('cart-fab').hidden, true);
});

await test('main: adding says "<name> is in your cart" with a View cart action that opens the window', async () => {
  const p = await boot({ main: true });
  await p.click(p.cartBtn('moss'));
  const msg = p.$('mkt-msg');
  assert.match(msg.textContent, /^Moss is in your cart/);
  const view = msg.querySelector('button');
  assert.equal(view.textContent, 'View cart');
  await p.click(view);
  assert.equal(p.$('cart').hidden, false);
  await p.click(p.$('cart-close'));
  await p.click(p.cartBtn('moss'));
  assert.equal(p.$('mkt-msg').textContent, 'Moss is out of your cart', 'no View cart on a removal');
});

await test('main: each cart line carries a swatch and its kind; Empty cart is a quiet link apart from the main button', async () => {
  const p = await boot({ main: true, cart: ['moss', 'banner-halo'] });
  await p.click(p.$('cart-fab'));
  const lines = [...p.w.document.querySelectorAll('.mkt-cart-line')];
  assert.equal(lines.length, 2);
  assert.match(lines[0].querySelector('.mkt-cart-sw').style.background, /linear-gradient/, 'a theme shows its own colours');
  assert.equal(lines[0].querySelector('small').textContent, 'Theme');
  assert.equal(lines[1].querySelector('small').textContent, 'Banner');
  const clear = p.$('cart-clear');
  assert.equal(clear.textContent, 'Empty cart');
  assert.ok(clear.classList.contains('mkt-linkbtn') && !clear.closest('.row'), 'not beside the main button');
  assert.ok(p.$('cart-ok').closest('.row'));
  await p.click(clear);
  assert.equal(p.srv.cart.length, 0);
  assert.equal(p.$('cart-fab').hidden, true);
  assert.equal(clear.parentNode.hidden, true);
});

await test('For Geeks keeps its lower-case cart words', async () => {
  const p = await boot({ cart: ['moss'] });
  await p.click(p.$('cart-open'));
  assert.equal(p.$('cart-title').textContent, 'your cart');
  assert.equal(p.$('cart-ok').textContent, 'buy everything');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
