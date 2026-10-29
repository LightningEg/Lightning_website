// The profile-seat controls on an owned app theme (js/activation-codes.js): how many profiles are unlocked, and adding
// another for a quarter of the price after a plain confirmation. What the database enforces is tested in seats.test.mjs.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/seat-pages.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { JSDOM, VirtualConsole } = process.env.JSDOM_PATH ? await import(pathToFileURL(process.env.JSDOM_PATH).href).then(m => m.default ?? m) : await import('jsdom');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}
const code = readFileSync(new URL('../../js/activation-codes.js', import.meta.url), 'utf8');
const tick = (ms = 10) => new Promise(r => setTimeout(r, ms));

async function boot({ seats = { seats: 1, used: 1, next_price: 25, can_buy: true }, buy } = {}) {
  const dom = new JSDOM('<html><body><div id="mkt-body"><div class="mkt-cell" data-state="owned" data-item="nile"></div></div></body></html>', { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const w = dom.window, calls = [];
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  const state = { ...seats, item_id: 'nile', name: 'Nile' };
  w.FG = { ready: Promise.resolve(), session: () => ({ user: { id: 'u' } }), onAuth() {}, say: e => e.message,
    sb: { from: () => ({ select: () => ({ eq: async () => ({ data: [{ item_id: 'nile', asset_version: 1 }], error: null }) }) }),
      rpc: async (name, args) => {
        calls.push({ name, args: JSON.parse(JSON.stringify(args ?? {})) });
        if (name === 'my_theme_seats') return { data: [{ ...state }], error: null };
        if (name === 'purchase_theme_seat') { const r = buy ? buy(args, state) : null; if (r) return r; state.seats += 1; return { data: { seats: state.seats, price_paid: args.p_expected_price, balance: 100 }, error: null }; }
        return { data: null, error: { message: 'unknown' } };
      } } };
  w.eval(code);
  await tick(30);
  const cell = w.document.querySelector('.mkt-cell');
  return { w, cell, calls, dialog: () => w.document.querySelector('dialog'), button: t => [...w.document.querySelectorAll('button')].find(b => b.textContent.startsWith(t)) };
}

await test('an owned app theme says how many profiles are unlocked and offers another at a quarter of the price', async () => {
  const p = await boot();
  assert.equal(p.cell.querySelector('[data-seat-note]').textContent, '1 of 1 profile unlocked');
  assert.equal(p.cell.querySelector('[data-seat-add]').textContent, 'Add another profile · 25');
  assert.ok(p.cell.querySelector('[data-seat-add] img.coin-i[src$="cotton-coin.svg"]'), 'the cotton icon, not the word coins');
  assert.ok(p.cell.querySelector('[data-activation-code]'));
});

await test('buying it asks first, then spends once at the price shown and updates the card', async () => {
  const p = await boot();
  p.cell.querySelector('[data-seat-add]').click(); await tick();
  assert.match(p.dialog().textContent, /25% of the price: 25, 75% off/);
  assert.equal(p.calls.some(c => c.name === 'purchase_theme_seat'), false, 'nothing is spent by opening it');
  p.button('Add a profile for 25').click(); await tick(40);
  const sent = p.calls.filter(c => c.name === 'purchase_theme_seat');
  assert.equal(sent.length, 1); assert.equal(sent[0].args.p_expected_price, 25);
  assert.ok(sent[0].args.p_idempotency_key.length >= 8);
  assert.match(p.dialog().textContent, /can now be unlocked on 2 profiles/);
  assert.equal(p.cell.querySelector('[data-seat-note]').textContent, '1 of 2 profiles unlocked', 'the card is read again');
});

await test('a refusal is said plainly and a retry in the same dialog uses the same key', async () => {
  let first = true;
  const p = await boot({ buy: () => { if (first) { first = false; return { data: null, error: { message: 'insufficient coins' } }; } return null; } });
  p.cell.querySelector('[data-seat-add]').click(); await tick();
  p.button('Add a profile for 25').click(); await tick(40);
  assert.match(p.dialog().textContent, /insufficient coins/);
  p.button('Add a profile for 25').click(); await tick(40);
  const keys = p.calls.filter(c => c.name === 'purchase_theme_seat').map(c => c.args.p_idempotency_key);
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1], 'one key per dialog, so a retry can never charge twice');
  assert.match(p.dialog().textContent, /unlocked on 2 profiles/);
});

await test('a changed price asks to start again; at ten profiles there is no add button', async () => {
  const p = await boot({ buy: () => ({ data: null, error: { message: 'price changed; reload before buying' } }) });
  p.cell.querySelector('[data-seat-add]').click(); await tick();
  p.button('Add a profile for 25').click(); await tick(40);
  assert.match(p.dialog().textContent, /The price changed/);
  const full = await boot({ seats: { seats: 10, used: 4, next_price: 25, can_buy: false } });
  assert.equal(full.cell.querySelector('[data-seat-add]'), null);
  assert.equal(full.cell.querySelector('[data-seat-note]').textContent, '4 of 10 profiles unlocked');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
