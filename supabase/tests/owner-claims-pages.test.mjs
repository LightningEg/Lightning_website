// The owner's "Unlocked app profiles" tool (admin.html, js/owner-claims.js) in jsdom with a fake client.
// What the database allows is tested in seats.test.mjs.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/owner-claims-pages.test.mjs

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

async function boot({ claims = [{ id: 7, item_id: 'nile', name: 'Nile', claimed_at: '2026-10-20T10:00:00Z', seats: 1 }], fail = null } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lightningeg.com/admin.html#members', virtualConsole: new VirtualConsole() });
  const w = dom.window, calls = [];
  let rows = claims;
  w.FG = { say: e => e.message, sb: { rpc: async (name, args) => {
    calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
    if (fail && fail(name)) return { data: null, error: { message: fail(name) } };
    if (name === 'admin_release_profile_claim') { rows = rows.filter(c => c.id !== args.p_claim_id); return { data: null, error: null }; }
    return { data: JSON.parse(JSON.stringify(rows)), error: null };
  } } };
  w.eval(read('js/owner-claims.js'));
  w.document.getElementById('store-tools').disabled = false;
  const f = w.document.getElementById('admin-claims-form');
  f.elements.email.value = 'ada@example.test';
  f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  const $ = id => w.document.getElementById(id);
  return { w, f, calls, $, free: () => w.document.querySelector('#admin-claims-list button') };
}

await test('it lists the profiles that hold a theme', async () => {
  const p = await boot();
  assert.deepEqual(p.calls, [{ name: 'admin_profile_claims', args: { p_email: 'ada@example.test' } }]);
  assert.match(p.$('admin-claims-list').textContent, /Nile · claimed 2026-10-20 · 1 seat/);
});

await test('freeing a seat needs a reason, sends it, and shows the list again', async () => {
  const p = await boot();
  p.free().click(); await tick();
  assert.match(p.$('admin-claims-status').textContent, /reason of at least 5/);
  assert.equal(p.calls.some(c => c.name === 'admin_release_profile_claim'), false);
  p.f.elements.reason.value = 'Lost the laptop';
  p.free().click(); await tick(40);
  assert.deepEqual(p.calls.find(c => c.name === 'admin_release_profile_claim').args, { p_claim_id: 7, p_reason: 'Lost the laptop' });
  assert.match(p.$('admin-claims-status').textContent, /Seat freed/);
  assert.match(p.$('admin-claims-list').textContent, /No profile has claimed/);
});

await test('a refusal is said plainly; a member with no claims says so; names are only text', async () => {
  const bad = await boot({ fail: n => (n === 'admin_profile_claims' ? 'no member with that email' : null) });
  assert.match(bad.$('admin-claims-status').textContent, /no member with that email/);
  const none = await boot({ claims: [] });
  assert.match(none.$('admin-claims-list').textContent, /No profile has claimed/);
  const xss = await boot({ claims: [{ id: 1, item_id: 'x', name: '<img src=x onerror=alert(1)>', claimed_at: '2026-10-20', seats: 2 }] });
  assert.equal(xss.w.document.querySelectorAll('#admin-claims-list img').length, 0);
  assert.match(xss.$('admin-claims-list').textContent, /<img src=x/);
  assert.match(xss.$('admin-claims-list').textContent, /2 seats/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
