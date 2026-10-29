// The owner console's Sales view (admin.html #sales, js/owner-sales.js) in jsdom with a fake admin_sales() and
// admin_store_funnel() (the funnel's database side: store-funnel.test.mjs).
// What the database computes and who may ask is tested in cart.test.mjs.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/owner-sales-pages.test.mjs

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
const html = read('admin.html').replace(/<script[\s\S]*?<\/script>/g, '');
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
const sample = () => ({
  days: 30, since: '2026-09-28T00:00:00Z',
  sales: { units: 12, coins: 2400, buyers: 7, by_channel: { cart: { units: 8, coins: 1700 }, direct: { units: 3, coins: 500 }, gift: { units: 1, coins: 200 } } },
  orders: { count: 4, coins: 1700, avg_coins: 425, avg_lines: 2 },
  funnel: { adds: 20, carts_started: 8, removed: 3, checkouts: 4, open_carts: 3, open_listed_coins: 900, stale_carts: 2, stale_listed_coins: 600 },
  daily: Array.from({ length: 30 }, (_, i) => ({ day: '2026-10-' + String(i % 28 + 1).padStart(2, '0'), units: i % 3, coins: (i % 3) * 100 })),
  by_type: [{ type: 'theme', units: 5, coins: 1500 }],
  by_item: [{ id: 'nile', name: 'Nile', type: 'theme', price: 300, units: 5, coins: 1500, adds: 9, in_carts: 1 },
    { id: 'x', name: '<img src=x onerror=alert(1)>', type: 'banner', price: 80, units: 0, coins: 0, adds: 2, in_carts: 2 }],
  recent_orders: [{ id: 'a1b2c3d4', at: '2026-10-26T10:30:00Z', lines: 2, total: 380, items: ['Nile', 'Halo'] }]
});

const funnelSample = () => ({
  days: 30, since: '2026-09-29',
  steps: { store_views: 200, looked_closer: 80, tried_on: 60, started_buy: 20, short_of_coins: 9, members_added_to_cart: 8, orders: 4, buyers: 5 },
  topups: { wallet_views: 30, requests: 10, details_sent: 7, credited: 6, credited_egp: 900, rejected: 1, cancelled: 2, waiting: 1, median_hours_to_credit: 3.5 },
  items: [{ id: 'nile', name: 'Nile', type: 'theme', price: 300, tried: 40, opened: 25, added: 9, sold: 5 },
    { id: 'y', name: '<img src=y onerror=alert(2)>', type: 'banner', price: 80, tried: 3, opened: 1, added: 0, sold: 0 }]
});

async function boot({ data = sample(), verified = true, fail = false, funnel = funnelSample() } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lightningeg.com/admin.html#sales', virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const w = dom.window, calls = [];
  w.FG = { say: e => e.message, sb: { rpc: async (name, args) => { calls.push({ name, args: args && JSON.parse(JSON.stringify(args)) }); if (fail) return { data: null, error: { message: 'MFA administrator required' } };
    if (name === 'admin_store_funnel') return funnel ? { data: JSON.parse(JSON.stringify(funnel)), error: null } : { data: null, error: { message: 'function not found' } };
    return { data: JSON.parse(JSON.stringify(data)), error: null }; } } };
  w.eval(read('js/owner-sales.js'));
  if (verified) w.document.getElementById('store-tools').disabled = false; // js/store-admin.js does this once verified
  w.dispatchEvent(new w.CustomEvent('lightning:owner-access', { detail: { verified } }));
  await tick();
  const $ = id => w.document.getElementById(id), qa = s => [...w.document.querySelectorAll(s)];
  return { w, $, qa, calls };
}

await test('Sales is a console view with its own menu entry', async () => {
  const p = await boot();
  assert.ok(p.$('sales') && p.$('ops-sales'));
  assert.ok(p.qa('.ops-nav a').some(a => a.getAttribute('data-view') === 'sales' && /Sales/.test(a.textContent)));
});

await test('nothing loads before the owner session is verified', async () => {
  const p = await boot({ verified: false });
  assert.equal(p.calls.length, 0);
  assert.match(p.$('ops-sales').textContent, /Verify your session/);
});

await test('it asks for thirty days first, and the figures answer what sold, how, and where carts stall', async () => {
  const p = await boot();
  assert.deepEqual(p.calls.map(c => [c.name, c.args]), [['admin_store_funnel', { p_days: 30 }], ['admin_sales', { p_days: 30 }]]);
  const t = p.$('ops-sales').textContent;
  assert.match(t, /Sold\s*12\s*items/);
  assert.match(t, /2,400\s*Cotton/);
  assert.match(t, /67%/, 'eight of twelve sales came from the cart');
  assert.match(t, /Stalled over a day\s*2\s*carts/);
  assert.match(t, /600 Cotton not yet spent/);
  assert.match(t, /50% of members who started a cart/);
  assert.match(t, /Nile · Theme/);
  assert.match(t, /56%/, 'five sold of nine added');
  assert.match(t, /a1b2c3d4/);
  assert.match(t, /Nile, Halo/);
  assert.equal(p.qa('.ops-chart rect').length, 30);
});

await test('the period buttons ask again for seven or ninety days', async () => {
  const p = await boot();
  const b = [...p.$('ops-sales').querySelectorAll('.oc-seg button')].find(x => x.textContent === '7 days');
  b.click(); await tick();
  assert.deepEqual(p.calls.filter(c => c.name === 'admin_sales').map(c => c.args && c.args.p_days), [30, 7]);
  assert.equal([...p.$('ops-sales').querySelectorAll('.oc-seg button')].find(x => x.getAttribute('aria-pressed') === 'true').textContent, '7 days');
});

await test('a refusal is said plainly, and item names are only ever text', async () => {
  const bad = await boot({ fail: true });
  assert.match(bad.$('ops-sales').textContent, /Sales did not load\. MFA administrator required/);
  const p = await boot();
  assert.equal(p.qa('#ops-sales img').length, 0);
  assert.match(p.$('ops-sales').textContent, /<img src=x/);
});

await test('the store funnel follows a look from browsing to buying, and top-ups from wallet to credit', async () => {
  const p = await boot();
  const t = p.$('ops-sales').textContent;
  assert.match(t, /From browsing to buying/);
  assert.match(t, /Visited the store\s*200/);
  assert.match(t, /Opened Details or tried a look\s*80\s*40% of the step before/);
  assert.match(t, /9 times a buy stopped because the wallet was short/);
  assert.match(t, /Credited\s*6\s*86% of the step before/);
  assert.match(t, /900 EGP credited/);
  assert.match(t, /half are credited within 3.5 hours/);
  assert.match(t, /Nile · Theme\s*40\s*25\s*9\s*5\s*13%/);
  assert.equal(p.qa('#ops-sales img').length, 0, 'a look name is only ever text');
});

await test('when the funnel cannot load, sales still show', async () => {
  const p = await boot({ funnel: null });
  const t = p.$('ops-sales').textContent;
  assert.match(t, /Sold\s*12\s*items/);
  assert.doesNotMatch(t, /From browsing to buying/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
