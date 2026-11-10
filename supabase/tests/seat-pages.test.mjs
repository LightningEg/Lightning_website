// The profile note on an owned app theme (js/activation-codes.js): how many of the ten free profiles are unlocked, and
// nothing to buy (one purchase covers every profile, app NF-10H). What the database enforces is tested in seats.test.mjs.
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

async function boot({ seats = { seats: 10, used: 1, next_price: null, can_buy: false }, lang = 'en' } = {}) {
  const dom = new JSDOM('<html lang="' + lang + '"><body><div id="mkt-body"><div class="mkt-cell" data-state="owned" data-item="nile"></div></div></body></html>', { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const w = dom.window, calls = [];
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  const state = { ...seats, item_id: 'nile', name: 'Nile' };
  w.FG = { ready: Promise.resolve(), session: () => ({ user: { id: 'u' } }), onAuth() {}, say: e => e.message,
    sb: { from: () => ({ select: () => ({ eq: async () => ({ data: [{ item_id: 'nile', asset_version: 1 }], error: null }) }) }),
      rpc: async (name, args) => {
        calls.push({ name, args: JSON.parse(JSON.stringify(args ?? {})) });
        if (name === 'my_theme_seats') return { data: [{ ...state }], error: null };
        return { data: null, error: { message: 'unknown' } };
      } } };
  w.eval(code);
  await tick(30);
  const cell = w.document.querySelector('.mkt-cell');
  return { w, cell, calls, dialog: () => w.document.querySelector('dialog'), button: t => [...w.document.querySelectorAll('button')].find(b => b.textContent.startsWith(t)) };
}

await test('an owned app theme says how many of its ten profiles are unlocked, at no extra cost', async () => {
  const p = await boot();
  assert.equal(p.cell.querySelector('[data-seat-note]').textContent, '1 of 10 profiles unlocked, at no extra cost');
  assert.ok(p.cell.querySelector('[data-activation-code]'));
});

await test('there is nothing to buy: no add button, even for an old answer that still says can_buy', async () => {
  const p = await boot({ seats: { seats: 1, used: 1, next_price: 25, can_buy: true } });
  assert.equal(p.cell.querySelector('[data-seat-add]'), null);
  assert.equal(p.calls.some(c => c.name === 'purchase_theme_seat'), false);
  assert.doesNotMatch(p.cell.textContent, /quarter|25%|Add another profile/);
});

await test('the note is Arabic on the Arabic pages, with Arabic digits', async () => {
  const p = await boot({ lang: 'ar', seats: { seats: 10, used: 4, next_price: null, can_buy: false } });
  assert.equal(p.cell.querySelector('[data-seat-note]').textContent, 'اتفعّل على ٤ من ١٠ ملفات، من غير فلوس زيادة');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
