// The owner console's Catalogue view (admin.html #catalogue, js/owner-catalog.js) in jsdom with a fake admin_catalog().
// What the database allows is tested in catalogue.test.mjs.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/owner-catalog-pages.test.mjs

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
const item = (o) => ({ type: 'theme', tier: null, price: 0, active: true, is_default: false, award: null, sold: 0, sold_month: 0, coins: 0, owners: 0, app: [], ...o });
const sample = () => ({ coins_per_egp: 5, tiers: { palette: 300, texture: 600, motion: 1000 }, items: [
  item({ id: 'set-nile', type: 'set', name: 'Nile set', price: 880, parts: ['frame-nile', 'nile'] }),
  item({ id: 'mono', tier: 'palette', name: 'Mono', is_default: true, owners: 600 }),
  item({ id: 'nile', tier: 'palette', name: 'Nile', price: 300, sold: 14, sold_month: 5, owners: 16, app: [{ version: 1, enabled: false }] }),
  item({ id: 'cotton', tier: 'texture', name: 'Cotton', price: 600, owners: 9, app: [{ version: 1, enabled: true }] }),
  item({ id: 'papyrus', tier: 'motion', name: 'Papyrus', price: 1000 }),
  item({ id: 'banner-dusk', type: 'banner', name: 'Dusk', price: 150, owners: 11 }),
  item({ id: 'badge-founding', type: 'badge', name: 'Founding supporter', award: 'founding' })] });

async function boot({ data = sample(), confirm = true, verified = true, unlocks = null } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lightningeg.com/admin.html#catalogue', virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const w = dom.window, calls = [];
  w.confirm = () => confirm;
  w.FG = { say: e => e.message, sb: { rpc: async (name, args) => { calls.push({ name, args: args && JSON.parse(JSON.stringify(args)) }); if (name === 'admin_app_unlocks') return unlocks ? { data: JSON.parse(JSON.stringify(unlocks)), error: null } : { data: null, error: { message: 'MFA administrator required' } }; return { data: name === 'admin_catalog' ? JSON.parse(JSON.stringify(data)) : 3, error: null }; } } };
  w.eval(read('js/owner-catalog.js'));
  if (verified) w.document.getElementById('store-tools').disabled = false; // js/store-admin.js does this once verified
  w.dispatchEvent(new w.CustomEvent('lightning:owner-access', { detail: { verified } }));
  await tick();
  const $ = id => w.document.getElementById(id), qa = s => [...w.document.querySelectorAll(s)];
  const button = (root, text) => [...root.querySelectorAll('button')].find(b => b.textContent === text);
  return { w, $, qa, calls, button };
}

await test('nothing loads before the owner session is verified', async () => {
  const p = await boot({ verified: false });
  assert.equal(p.calls.length, 0);
  assert.match(p.$('ops-catalogue').textContent, /Verify your session/);
});

await test('tier prices: three tiers with coins, EGP and the themes in each', async () => {
  const p = await boot();
  const tiers = p.qa('.oc-tier');
  assert.deepEqual(tiers.map(t => t.querySelector('h4').textContent), ['Palette', 'Textured', 'Animated']);
  assert.match(tiers[0].textContent, /300\s*coins/);
  assert.match(tiers[0].textContent, /60 EGP each/);
  assert.match(tiers[0].textContent, /Nile/);
  assert.doesNotMatch(tiers[0].textContent, /Mono/, 'the free default is not priced');
  assert.match(tiers[2].textContent, /1,000\s*coins/);
});

await test('a tier price moves every theme in it, after a confirmation, then reloads', async () => {
  const p = await boot();
  const t = p.qa('.oc-tier')[1];
  t.querySelector('input').value = '700';
  p.button(t, 'Save').click(); await tick();
  const c = p.calls.find(x => x.name === 'admin_set_tier_price');
  assert.deepEqual(c.args, { p_tier: 'texture', p_price: 700 });
  assert.equal(p.calls.filter(x => x.name === 'admin_catalog').length, 2, 'reloaded after the change');
  const q = await boot({ confirm: false });
  q.qa('.oc-tier')[1].querySelector('input').value = '700';
  q.button(q.qa('.oc-tier')[1], 'Save').click(); await tick();
  assert.equal(q.calls.some(x => x.name === 'admin_set_tier_price'), false, 'cancelled: nothing changes');
});

await test('items: only priced, non-theme, non-set items take their own price; free and earned have none', async () => {
  const p = await boot();
  const rows = p.qa('.oc-table tbody tr');
  const row = name => rows.find(r => r.querySelector('.oc-item b').textContent === name);
  assert.ok(row('Dusk').querySelector('.oc-edit'), 'a banner is priced alone');
  for (const n of ['Nile', 'Nile set', 'Mono', 'Founding supporter']) assert.equal(row(n).querySelector('.oc-edit'), null, n);
  assert.match(row('Mono').textContent, /Free default/);
  assert.match(row('Founding supporter').textContent, /Earned/);
  assert.equal(p.button(row('Mono'), 'Retire'), undefined, 'the default never retires');
  const dusk = row('Dusk');
  dusk.querySelector('.oc-edit input').value = '175';
  p.button(dusk, 'Save').click(); await tick();
  assert.deepEqual(p.calls.find(x => x.name === 'admin_set_item_price').args, { p_item_id: 'banner-dusk', p_price: 175 });
  p.button(row('Nile'), 'Retire').click(); await tick();
  assert.deepEqual(p.calls.find(x => x.name === 'admin_set_item_active').args, { p_item_id: 'nile', p_active: false });
});

await test('filters show one kind at a time', async () => {
  const p = await boot();
  const seg = p.$('ops-catalogue').querySelector('.oc-seg');
  [...seg.querySelectorAll('button')].find(b => /^Themes/.test(b.textContent)).click();
  assert.deepEqual(p.qa('.oc-table tbody .oc-item b').map(b => b.textContent), ['Mono', 'Nile', 'Cotton', 'Papyrus']);
});

await test('app themes: turned on only after a confirmation, and paused the same way', async () => {
  const p = await boot();
  const rel = p.qa('.oc-rel-list li');
  assert.equal(rel.length, 2);
  assert.match(rel[0].textContent, /Nile.*Waiting for the app release/);
  assert.match(rel[1].textContent, /Cotton.*Unlock on/);
  p.button(rel[0], 'Turn on unlock').click(); await tick();
  assert.deepEqual(p.calls.find(x => x.name === 'admin_set_app_release').args, { p_item_id: 'nile', p_version: 1, p_enabled: true });
  p.button(p.qa('.oc-rel-list li')[1], 'Pause new unlocks').click(); await tick();
  assert.deepEqual(p.calls.filter(x => x.name === 'admin_set_app_release')[1].args, { p_item_id: 'cotton', p_version: 1, p_enabled: false });
});

// 8S: seats and app unlocks live in App themes.
const UNLOCKS = [{ item_id: 'nile', name: 'Nile', codes_issued: 9, codes_redeemed: 6, profiles_claimed: 4, extra_seats_sold: 2, extra_coins: 150, members_with_seats: 3 },
  { item_id: 'cotton', name: 'Cotton', codes_issued: 1, codes_redeemed: 1, profiles_claimed: 1, extra_seats_sold: 0, extra_coins: 0, members_with_seats: 1 }];
await test('app themes: each theme shows profiles claimed, extra profiles sold (coins) and codes issued, beside its button', async () => {
  const p = await boot({ unlocks: UNLOCKS });
  const rel = p.qa('.oc-rel-list li');
  assert.equal(rel[0].querySelector('.oc-unlock-stats').textContent, '4 profiles claimed · 2 extra profiles sold (150 coins) · 9 codes issued');
  assert.equal(rel[1].querySelector('.oc-unlock-stats').textContent, '1 profile claimed · 0 extra profiles sold (0 coins) · 1 code issued');
  assert.ok(p.calls.some(c => c.name === 'admin_app_unlocks'));
  assert.ok(p.button(rel[0], 'Turn on unlock'), 'the button is still beside it');
  const silent = await boot();
  assert.equal(silent.qa('.oc-unlock-stats').length, 0, 'if the counts cannot load, the rows still show');
  assert.equal(silent.qa('.oc-rel-list li').length, 2);
});

await test('Free a profile is in the App themes panel, not on Members: one home for seats', async () => {
  const p = await boot({ unlocks: UNLOCKS });
  const form = p.$('admin-claims-form');
  assert.ok(form.closest('.oc-releases'), 'inside the App themes panel');
  assert.equal(form.hidden, false);
  assert.equal(form.closest('#members'), null);
  assert.equal(p.$('members').querySelector('#admin-claims-form'), null, 'removed from Members');
  assert.equal(form.querySelector('h4').textContent, 'Free a profile');
  assert.deepEqual([...form.elements].map(e => e.name).filter(Boolean), ['email', 'reason']);
  assert.ok(!form.classList.contains('panel'), 'no card inside a card');
  await p.button(p.qa('.oc-rel-list li')[0], 'Turn on unlock').click(); await tick();
  assert.ok(p.$('admin-claims-form').closest('.oc-releases'), 'still there after the panel redraws');
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
