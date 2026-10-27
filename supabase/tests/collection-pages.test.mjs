// The collection page (collection.html): the market drawn with only what the member owns, with Equip and the app
// unlock code on each owned theme, and a way back to the marketplace. jsdom, the real js/forgeeks-auth.js,
// js/forgeeks-market.js and js/activation-codes.js, and a fake Supabase client.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/collection-pages.test.mjs

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
const collectionHtml = strip(read('collection.html')), marketHtml = strip(read('marketplace.html'));
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const UID = '11111111-1111-4111-8111-111111111111';
const CATALOG = [
  { id: 'mono', type: 'theme', name: 'Mono', description: 'free', price: 0, is_default: true, asset_version: 1 },
  { id: 'moss', type: 'theme', name: 'Moss', description: 'Dark olive', price: 150, is_default: false, asset_version: 1 },
  { id: 'frost', type: 'theme', name: 'Frost', description: 'Cool light', price: 250, is_default: false, asset_version: 1 },
  { id: 'banner-halo', type: 'banner', name: 'Halo', description: 'A soft glow.', price: 40, is_default: false, asset_version: 1 },
  { id: 'banner-dusk', type: 'banner', name: 'Dusk', description: 'Indigo sky.', price: 70, is_default: false, asset_version: 1 },
  { id: 'set-moss', type: 'set', name: 'Moss set', description: 'all', price: 300, set_price: 240, is_default: false, asset_version: 1, parts: ['moss'] }
];

async function boot({ html = collectionHtml, owned = [], signedIn = true } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lightningeg.com/collection.html', virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const w = dom.window;
  w.Element.prototype.scrollIntoView = function () {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const thenable = v => ({ then: (a, b) => Promise.resolve(v).then(a, b) });
  const session = signedIn ? { user: { id: UID, email: 'ada@example.test' } } : null;
  const rpc = name => {
    if (name === 'market_catalog') return thenable({ data: CATALOG.map(i => ({ ...i, owned: i.is_default || owned.includes(i.id), equipped: false })), error: null });
    if (name === 'issue_activation_code') return thenable({ data: { code: 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD' }, error: null });
    return thenable({ data: null, error: { message: 'unknown function' } });
  };
  const builder = table => { const b = { select() { return b; }, maybeSingle() { return b; }, eq() { return b; },
    then(res, rej) { const v = table === 'wallets' ? { data: { balance: 100, contribution_score: 0 }, error: null }
      : table === 'bundled_item_versions' ? { data: [{ item_id: 'moss', asset_version: 1 }], error: null } : { data: null, error: null };
      return Promise.resolve(v).then(res, rej); } }; return b; };
  const client = { rpc, from: builder, auth: { onAuthStateChange(f) { setTimeout(() => f('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => ({ error: null }) } };
  w.supabase = { createClient: () => client };
  w.FORGEEKS = { supabaseUrl: 'https://x.supabase.co', anonKey: 'anon' };
  w.eval(read('js/forgeeks-auth.js')); w.eval(read('js/forgeeks-market.js')); w.eval(read('js/activation-codes.js'));
  await tick(100);
  const $ = id => w.document.getElementById(id);
  const ids = sel => [...w.document.querySelectorAll(sel + ' .mkt-cell')].map(c => c.dataset.item);
  return { w, $, ids };
}

await test('collection: only what you own is shown, with free themes always', async () => {
  const p = await boot({ owned: ['moss', 'banner-dusk'] });
  assert.deepEqual(p.ids('#list-themes'), ['moss']);
  assert.deepEqual(p.ids('#list-free'), ['mono']);
  assert.deepEqual(p.ids('#list-banners'), ['banner-dusk']);
  assert.equal(p.w.document.querySelectorAll('.mkt-cell').length, 3);
  assert.equal(p.$('col-empty').hidden, true);
  assert.equal(p.w.document.querySelector('.mkt-cell[data-item="frost"]'), null, 'not owned: not here');
  assert.equal(p.w.document.querySelector('.mkt-cell[data-item="set-moss"]'), null, 'sets are for the marketplace');
});

await test('collection: an owned theme can be equipped and unlocked in the app with a one-time code', async () => {
  const p = await boot({ owned: ['moss'] });
  const labels = [...p.w.document.querySelectorAll('.mkt-cell[data-item="moss"] button')].map(b => b.textContent);
  assert.ok(labels.includes('equip'));
  assert.ok(labels.includes('Get app unlock code'));
  assert.ok(!labels.includes('add to cart') && !labels.includes('buy'));
  p.w.document.querySelector('[data-activation-code]').click();
  await tick(40);
  assert.equal(p.w.document.querySelector('dialog input').value, 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD');
});

await test('collection: with nothing bought it says so and points to the marketplace', async () => {
  const p = await boot();
  assert.equal(p.$('col-empty').hidden, false);
  assert.match(p.$('col-empty').textContent, /do not own a paid look/);
  assert.ok(p.w.document.querySelector('a[href="marketplace.html"]'));
  assert.equal(p.w.document.querySelectorAll('.mkt-cell').length, 1, 'only the free palette');
});

await test('collection: it is a destination in the community bar and the marketplace links to it', async () => {
  assert.match(read('collection.html'), /<a href="collection\.html" aria-current="page">Collection<\/a>/);
  for (const f of ['marketplace', 'account', 'stories', 'leaderboard', 'topup']) assert.match(read(f + '.html'), /<a href="collection\.html"[^>]*>Collection<\/a>/, f);
  const m = await boot({ html: marketHtml, owned: ['moss'] });
  assert.equal(m.$('mkt-collection').hidden, false);
  assert.equal(m.$('mkt-collection').getAttribute('href'), 'collection.html');
  assert.equal(m.w.document.querySelectorAll('.mkt-cell').length >= 5, true, 'the marketplace still shows everything');
});

await test('collection: signed out sees how to sign in, not an empty promise', async () => {
  const p = await boot({ signedIn: false });
  assert.equal(p.$('mkt-signin').hidden, false);
  assert.match(p.$('mkt-signin').textContent, /sign in to see your collection/);
  assert.equal(p.$('col-empty').hidden, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
