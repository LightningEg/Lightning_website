// Tests for the owner dashboard's Today view and its tabs (admin.html + js/owner-dashboard.js), in jsdom with a fake
// admin_dashboard(). What the database returns, and who may call it, is tested in topups.test.mjs.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/owner-dashboard-pages.test.mjs

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
const tick = (ms = 10) => new Promise(r => setTimeout(r, ms));

const sample = (over = {}) => ({
  fixed_cost_egp: 3000, coins_per_egp: 5, avg_topup_90d: 15000,
  revenue_month: 120000, revenue_prev: 80000, topups_month: 8, topups_prev: 5,
  payers_month: 6, payers_all: 14, repeat_payers: 3, members_all: 120, members_month: 22,
  coins_sold_month: 6000, coins_given_month: 400, coins_spent_month: 4200, coins_outstanding: 9100,
  top_items: [{ id: 'papyrus', name: 'Papyrus', type: 'theme', tier: 'texture', sold: 4, coins: 2400 }, { id: 'banner-dusk', name: 'Dusk', type: 'banner', tier: null, sold: 2, coins: 300 }],
  daily: Array.from({ length: 30 }, (_, i) => ({ day: '2026-10-' + String(i + 1).padStart(2, '0'), piastres: i % 5 ? 0 : 15000 })),
  needs: { receipts: 2, awaiting_receipt: 1, unmatched: 0, stories: 3, mismatches: 0, oldest_receipt_at: new Date(Date.now() - 5 * 36e5).toISOString() },
  ...over
});

async function boot({ data = sample(), hash = '', fail = false } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lightningeg.com/admin.html' + hash, virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const w = dom.window, calls = [];
  w.FG = { say: () => 'Try again.', sb: { rpc: async (name, args) => { calls.push({ name, args }); if (fail) return { data: null, error: { message: 'MFA required' } }; return { data: name === 'admin_dashboard' ? JSON.parse(JSON.stringify(data)) : null, error: null }; } } };
  w.eval(read('js/owner-dashboard.js'));
  w.dispatchEvent(new w.CustomEvent('lightning:owner-changed'));
  await tick(30);
  const $ = id => w.document.getElementById(id), qa = s => [...w.document.querySelectorAll(s)];
  return { w, $, qa, calls };
}

await test('Today: what needs the owner first, each linking to its tab, with a badge on the tab', async () => {
  const p = await boot();
  const needs = p.qa('.ops-need');
  assert.deepEqual(needs.map(a => a.getAttribute('href')), ['#requests', '#requests', '#social', '#today']);
  assert.deepEqual(needs.map(a => a.querySelector('b').textContent), ['Tickets to confirm', 'Waiting for a receipt', 'Stories to review', 'Ledger mismatches']);
  assert.deepEqual(needs.map(a => a.querySelector('strong').textContent), ['2', '1', '3', '0']);
  assert.ok(needs[0].classList.contains('on') && !needs[3].classList.contains('on'));
  assert.equal(p.$('ops-dash').querySelector('a[href="#bank"]'), null, 'no older transfers, no link to them');
  assert.match(needs[0].textContent, /oldest 5 h ago/);
  assert.equal(p.w.document.querySelector('[data-badge="receipts"]').textContent, '2');
  assert.equal(p.w.document.querySelector('[data-badge="stories"]').textContent, '3');
  const loose = await boot({ data: sample({ needs: { ...sample().needs, unmatched: 2 } }) });
  assert.match(loose.$('ops-dash').textContent, /2 older transfers with no ticket/);
});

await test('Today: the month in four figures, each compared, with break-even against the fixed cost', async () => {
  const p = await boot();
  const k = p.qa('.ops-kpi');
  assert.equal(k.length, 4);
  assert.match(k[0].textContent, /1,200\s*EGP/);
  assert.match(k[0].textContent, /↑ 400 EGP vs 800 EGP last month/);
  assert.match(k[1].textContent, /40%/);
  assert.match(k[1].textContent, /1,800 EGP to go, about 12 top-ups at your average 150 EGP/);
  assert.equal(k[1].querySelector('[role=meter]').getAttribute('aria-valuenow'), '40');
  assert.match(k[2].textContent, /14 all time · 3 came back · 22 new members/);
  assert.match(k[3].textContent, /9,100\s*coins/);
});

await test('Today: thirty days of revenue as bars, and what sells with its tier and EGP', async () => {
  const p = await boot();
  assert.equal(p.qa('.ops-chart rect').length, 30);
  assert.match(p.w.document.querySelector('.ops-chart').getAttribute('aria-label'), /900 EGP in total/);
  const rows = p.qa('.ops-sells li');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Papyrus.*Textured.*4 sold.*2,400 coins · 480 EGP/);
  const covered = await boot({ data: sample({ revenue_month: 350000 }) });
  assert.match(covered.qa('.ops-kpi')[1].textContent, /Covered, 500 EGP above/);
});

await test('views: one at a time, Overview by default, old section links land where they now live', async () => {
  const p = await boot();
  assert.equal(p.$('today').hidden, false);
  assert.equal(p.$('requests').hidden, true);
  assert.equal(p.w.document.querySelector('.ops-nav a[aria-current=page]').getAttribute('data-view'), 'today');
  assert.deepEqual(p.qa('.ops-nav a').map(a => a.getAttribute('data-view')), ['today', 'requests', 'catalogue', 'members', 'social', 'bank', 'settings']);
  const s = await boot({ hash: '#pricing' });
  assert.equal(s.$('settings').hidden, false);
  assert.ok(s.$('settings').contains(s.$('pricing')), 'checkout, pricing and retention live in Settings');
  assert.ok(s.$('settings').contains(s.$('setup')) && s.$('settings').contains(s.$('retention')));
  s.w.location.hash = '#requests';
  s.w.dispatchEvent(new s.w.HashChangeEvent('hashchange'));
  assert.equal(s.$('requests').hidden, false);
  assert.equal(s.$('settings').hidden, true);
  s.w.location.hash = '#bank';
  s.w.dispatchEvent(new s.w.HashChangeEvent('hashchange'));
  assert.equal(s.$('bank').hidden, false, 'the money journal is its own view');
  assert.ok(s.$('bank').contains(s.$('store-bank-record')) && s.$('bank').contains(s.$('store-bank-list')));
  s.w.location.hash = '#credits';
  s.w.dispatchEvent(new s.w.HashChangeEvent('hashchange'));
  assert.equal(s.$('members').hidden, false, 'manual credits live under Members');
  assert.ok(s.$('members').contains(s.$('admin-credit-form')));
});

await test('segmented filters drive the select the store script listens to', async () => {
  const p = await boot();
  p.$('store-tools').disabled = false; // verified
  const seg = p.w.document.querySelector('.oc-seg[data-for="store-request-filter"]');
  let changed = 0;
  p.$('store-request-filter').addEventListener('change', () => changed++);
  seg.querySelector('[data-value="approved"]').click();
  assert.equal(p.$('store-request-filter').value, 'approved');
  assert.equal(changed, 1);
  assert.deepEqual([...seg.querySelectorAll('button')].map(b => b.getAttribute('aria-pressed')), ['false', 'true', 'false', 'false']);
});

await test('Ready to sell: each step the store needs, ticked from its settings, and where to fix it', async () => {
  const p = await boot({ data: sample({ payers_all: 0 }) });
  const steps = p.qa('.oc-ready-step');
  assert.deepEqual(steps.map(a => a.querySelector('b').textContent), ['Receiving details and QR', 'Checkout open', 'Top-up quotes allowed', 'Fixed cost set', 'A real payment credited', 'App themes released']);
  assert.ok(steps[3].classList.contains('done'), 'the fixed cost is set');
  assert.ok(!steps[4].classList.contains('done'), 'nobody has paid yet');
  assert.equal(steps[5].getAttribute('href'), '#catalogue');
});

await test('Settings: the fixed cost is shown, saved through the server and Today reloads', async () => {
  const p = await boot();
  const f = p.$('ops-fixed-cost');
  assert.equal(f.elements.egp.value, '3000');
  f.elements.egp.value = '3500';
  f.dispatchEvent(new p.w.Event('submit', { cancelable: true }));
  await tick(30);
  assert.equal(p.calls.find(c => c.name === 'admin_set_fixed_cost').args.p_egp, 3500);
  assert.match(p.$('ops-fixed-status').textContent, /3,500 EGP a month/);
  assert.ok(p.calls.filter(c => c.name === 'admin_dashboard').length >= 2);
});

await test('a failed load says so instead of showing stale figures', async () => {
  const p = await boot({ fail: true });
  assert.match(p.$('ops-dash').textContent, /did not load/);
  assert.equal(p.qa('.ops-kpi').length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
