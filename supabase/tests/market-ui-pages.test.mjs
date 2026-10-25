// Tests for the market's shop floor (js/market-ui.js) on the main-site Marketplace and the For Geeks market, the
// previews it draws (js/theme-preview.js) and the website skin it wears (js/theme.js), in jsdom with a fake Supabase.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/market-ui-pages.test.mjs
//
// Nothing here talks to the real project; prices, ownership and slots are the server's (market.test.mjs).

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
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const UID = '22222222-2222-4222-8222-222222222222';
const code = f => read(f);

const catalog = () => [
  { id: 'mono', type: 'theme', name: 'Mono', description: 'White on black', price: 0, is_default: true },
  { id: 'paper', type: 'theme', name: 'Paper', description: 'Light, for daylight reading', price: 100, is_default: false },
  { id: 'meadow', type: 'theme', name: 'Meadow', description: 'Night blue and green', price: 100, is_default: false },
  { id: 'moss', type: 'theme', name: 'Moss', description: 'Dark olive and lime', price: 150, is_default: false },
  { id: 'banner-halo', type: 'banner', name: 'Halo', description: 'A soft glow.', price: 40, is_default: false },
  { id: 'banner-dusk', type: 'banner', name: 'Dusk', description: 'Indigo sky.', price: 70, is_default: false },
  { id: 'frame-gold', type: 'frame', name: 'Gold ring', description: 'Warm gold.', price: 50, is_default: false }
];

function fake(opts, calls) {
  const srv = { balance: opts.balance ?? 200, owned: new Set(opts.owned ?? []), equipped: { ...(opts.equipped ?? {}) }, session: opts.signedIn === false ? null : { user: { id: UID, email: 'mohab@example.test' } } };
  const thenable = v => ({ then: (a, b) => Promise.resolve(v).then(a, b) });
  const from = table => {
    const b = { select: () => b, eq: () => b, maybeSingle: () => b, then(res, rej) {
      let v = { data: null, error: null };
      if (table === 'wallets') v = { data: { balance: srv.balance, contribution_score: 3 }, error: null };
      if (table === 'member_profiles') v = { data: { user_id: UID, display_name: 'Mohab', avatar_url: null }, error: null };
      return Promise.resolve(v).then(res, rej);
    } };
    return b;
  };
  const rpc = (name, args) => {
    calls.push({ fn: name, args });
    const item = catalog().find(i => i.id === args?.p_item_id);
    if (name === 'market_catalog') return thenable({ data: catalog().map(i => ({ ...i, owned: !!srv.session && (i.is_default || srv.owned.has(i.id)), equipped: !!srv.session && srv.equipped[i.type] === i.id })), error: null });
    if (name === 'equip_item') { srv.equipped[item.type] = item.id; return thenable({ data: { slot: item.type, item_id: item.id }, error: null }); }
    if (name === 'purchase_item_at_price') return thenable({ data: null, error: { message: 'insufficient coins' } });
    return thenable({ data: null, error: null });
  };
  return { auth: { onAuthStateChange(f) { setTimeout(() => f('INITIAL_SESSION', srv.session), 0); return { data: { subscription: { unsubscribe() {} } } }; } }, from, rpc };
}

async function boot({ main = true, withFetch = false, stored = {}, ...opts } = {}) {
  const file = main ? 'marketplace.html' : 'forgeeks-market.html';
  const dom = new JSDOM(strip(read(file)), { runScripts: 'outside-only', url: 'https://lightningeg.com/' + file, virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const w = dom.window, calls = [];
  Object.entries(stored).forEach(([k, v]) => w.localStorage.setItem(k, v));
  w.Element.prototype.scrollIntoView = function () {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (withFetch) w.fetch = async p => { try { const t = read(p); return { ok: true, json: async () => JSON.parse(t) }; } catch { return { ok: false }; } };
  if (main) { w.eval(code('js/theme.js')); w.eval(code('js/site-theme-previews.js')); }
  else w.eval(code('js/forgeeks.js'));
  w.supabase = { createClient: () => fake(opts, calls) };
  w.FORGEEKS = { supabaseUrl: 'https://x.supabase.co', anonKey: 'anon' };
  ['js/forgeeks-auth.js', 'js/forgeeks-showcase.js', 'js/theme-preview.js', 'js/cosmetic-parts.js', 'js/market-ui.js', 'js/forgeeks-market.js'].forEach(f => w.eval(code(f)));
  await tick(80);
  const $ = id => w.document.getElementById(id);
  const q = s => w.document.querySelector(s);
  const qa = s => [...w.document.querySelectorAll(s)];
  const click = async el => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(30); };
  const byLabel = l => qa('button').find(b => b.getAttribute('aria-label') === l || b.textContent === l);
  return { w, $, q, qa, click, byLabel, calls, root: w.document.documentElement };
}

await test('main: Your look pairs with the wallet, and five tabs switch the sections', async () => {
  const p = await boot({ owned: ['meadow', 'banner-dusk'], equipped: { theme: 'meadow', banner: 'banner-dusk' } });
  assert.ok(p.q('.mkt-top .mkt-look') && p.q('.mkt-top .mkt-wallet #wallet'));
  assert.equal(p.q('.mkt-look .fg-banner').getAttribute('data-item'), 'banner-dusk');
  assert.deepEqual(p.qa('.mkt-tab').map(b => b.textContent), ['Themes', 'Banners', 'Frames', 'Badges', 'Owned']);
  assert.equal(p.q('#list-banners').closest('.mkt-sec').hidden, true);
  await p.click(p.q('.mkt-tab[data-view="banners"]'));
  assert.equal(p.q('#list-banners').closest('.mkt-sec').hidden, false);
  assert.equal(p.q('#list-themes').closest('.mkt-sec').hidden, true);
  await p.click(p.q('.mkt-tab[data-view="owned"]'));
  assert.equal(p.q('.mkt-cell[data-item="paper"]').hidden, true, 'for-sale items leave Owned');
  assert.equal(p.q('.mkt-cell[data-item="meadow"]').hidden, false);
  assert.equal(p.q('#sec-frames').hidden, true, 'a section with nothing owned is hidden');
  assert.ok(p.q('.mkt-wallet img.coin-i[src$="cotton-coin.svg"]'), 'the coin is the cotton boll');
});

await test('main: Try it wears a theme on the page without saving, and Cancel takes it off', async () => {
  const p = await boot({ owned: [], balance: 300 });
  await p.click(p.byLabel('Try Paper'));
  assert.equal(p.root.dataset.skin, 'paper');
  assert.equal(p.w.localStorage.getItem('lightning-site-skin'), null, 'Try it saves nothing');
  assert.equal(p.q('.mkt-trybar').hidden, false);
  assert.match(p.q('.mkt-trybar-text').textContent, /Previewing Paper/);
  await p.click(p.q('.mkt-trybar-cancel'));
  assert.equal(p.root.dataset.skin, undefined);
  assert.equal(p.q('.mkt-trybar').hidden, true);
});

await test('main: a banner tried on shows in Your look, then goes back to the equipped one', async () => {
  const p = await boot({ owned: ['banner-halo'], equipped: { banner: 'banner-halo' } });
  await p.click(p.byLabel('Try Dusk'));
  assert.equal(p.q('.mkt-look .fg-banner').getAttribute('data-item'), 'banner-dusk');
  await p.click(p.q('.mkt-trybar-cancel'));
  assert.equal(p.q('.mkt-look .fg-banner').getAttribute('data-item'), 'banner-halo');
});

await test('main: too few coins says exactly how many are missing, links ways to earn and never sends a purchase', async () => {
  const p = await boot({ balance: 60 });
  await p.click(p.q('button[data-act="buy"][data-item="moss"]'));
  assert.equal(p.$('buy').hidden, false);
  assert.equal(p.$('buy-short').hidden, false);
  assert.match(p.$('buy-short').textContent, /You need 90 coins more/);
  assert.ok(p.$('buy-short').querySelector('a[href="topup.html"]'));
  assert.equal(p.$('buy-ok').hidden, true);
  assert.equal(p.calls.filter(c => c.fn === 'purchase_item_at_price').length, 0);
});

await test('main: equipping a theme wears it across the website, and the switch takes it off', async () => {
  const p = await boot({ owned: ['paper'], equipped: { theme: 'mono' } });
  assert.equal(p.root.dataset.skin, undefined);
  await p.click(p.q('button[data-act="equip"][data-item="paper"]'));
  assert.equal(p.root.dataset.skin, 'paper');
  assert.equal(JSON.parse(p.w.localStorage.getItem('lightning-site-skin')).id, 'paper');
  assert.equal(p.root.dataset.theme, 'light', 'a light palette keeps the light page rules');
  const box = p.$('wear-theme');
  box.checked = false; box.dispatchEvent(new p.w.Event('change'));
  assert.equal(p.root.dataset.skin, undefined);
  assert.equal(p.w.localStorage.getItem('lightning-site-skin'), null);
});

await test('main: a worn theme the member no longer owns comes off', async () => {
  const p = await boot({ owned: [], stored: { 'lightning-site-skin': JSON.stringify({ id: 'moss', name: 'Moss', c: ['#0b0e08', '#eef3dc', '#bcc7a0', '#b9d94a'] }) } });
  assert.equal(p.root.dataset.skin, undefined);
  assert.equal(p.w.localStorage.getItem('lightning-site-skin'), null);
});

await test('main: Details shows the theme on the website, the computer and the phone, with its ten parts', async () => {
  const p = await boot({ balance: 300 });
  await p.click(p.byLabel('Paper details'));
  assert.equal(p.$('mkt-detail').hidden, false);
  assert.deepEqual(p.qa('.mkt-view').map(b => b.textContent), ['Website', 'Computer', 'Phone']);
  assert.ok(p.q('.mkt-stage .pv-site'));
  await p.click(p.q('.mkt-view[data-mode="phone"]'));
  assert.ok(p.q('.mkt-stage .pv-phone .pv-tabs'));
  assert.deepEqual(p.qa('.mkt-stage .pv-tabs span').map(s => s.textContent), ['Overview', 'Budget', '+', 'Transactions', 'More'], 'the phone keeps its five slots (C03.1)');
  assert.equal(p.qa('.mkt-parts-list > div').length, 10);
  await p.click(p.qa('.mkt-detail-acts button').find(b => b.textContent === 'Close'));
  assert.equal(p.$('mkt-detail').hidden, true);
});

await test('main: the app themes in testing are featured, tried and shown without a price', async () => {
  const p = await boot({ withFetch: true });
  await tick(80);
  assert.deepEqual(p.qa('.mkt-feat-card').map(c => c.getAttribute('data-app')), ['nile-nocturne', 'royal-obsidian-gold']);
  assert.ok(p.qa('.mkt-feat-card .pv-pc').length === 2 && p.qa('.mkt-feat-card .pv-phone').length === 2);
  await p.click(p.byLabel('Try Nile Nocturne on this page'));
  assert.equal(p.root.dataset.skin, 'nile-nocturne');
  await p.click(p.q('.mkt-trybar-cancel'));
  await p.click(p.byLabel('Royal Obsidian & Gold details'));
  assert.deepEqual(p.qa('.mkt-view').map(b => b.textContent), ['Computer', 'Phone']);
  assert.match(p.q('.mkt-detail-acts').textContent, /Price not set yet/);
  assert.ok(!p.qa('.mkt-detail-acts button').some(b => /Buy/.test(b.textContent)));
});

await test('For Geeks: the same structure in its own look; Try it switches the page theme and puts it back', async () => {
  const p = await boot({ main: false, owned: [], stored: { 'lightning-geeks-theme': 'mono' } });
  assert.equal(p.qa('.mkt-tab').length, 5);
  assert.ok(p.q('.mkt-look'));
  assert.equal(p.q('.mkt-wear'), null, 'the website switch is the main site\'s');
  await p.click(p.byLabel('Try Paper'));
  assert.equal(p.root.dataset.theme, 'paper');
  assert.equal(p.w.localStorage.getItem('lightning-geeks-theme'), 'mono', 'Try it saves nothing');
  await p.click(p.q('.mkt-trybar-cancel'));
  assert.notEqual(p.root.dataset.theme, 'paper');
});

await test('previews: every website theme mixed for the app keeps text and buttons readable', async () => {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(code('js/site-theme-previews.js')); w.eval(code('js/theme-preview.js'));
  const PV = w.LightningPreview;
  for (const t of w.LG.THEMES) {
    const p = PV.fromWebsite(t);
    for (const s of ['background', 'surface', 'raised']) assert.ok(PV.contrast(p.text, p[s]) >= 4.5, t.id + ' text on ' + s);
    assert.ok(PV.contrast(p.accent, p.onAccent) >= 3, t.id + ' button label');
  }
  const bad = PV.clean({ background: 'url(x)', text: '#FFFFFF' });
  assert.equal(bad.background, PV.DEFAULT.background);
  assert.equal(bad.text, '#FFFFFF');
});

await test('skin: theme.js refuses anything but four hex colours and an id', async () => {
  const dom = new JSDOM('<html><head></head><body></body></html>', { runScripts: 'outside-only', url: 'https://lightningeg.com/' });
  const w = dom.window;
  w.eval(code('js/theme.js'));
  w.LightningTheme.skin({ id: 'x', c: ['#000000', '#ffffff', '#cccccc', 'red;}body{display:none'] });
  assert.equal(w.document.documentElement.dataset.skin, undefined);
  assert.equal(w.document.getElementById('site-skin'), null);
  w.LightningTheme.skin({ id: 'nile', c: ['#070b16', '#e9edf7', '#b7c0d8', '#e6b450'] });
  assert.equal(w.document.documentElement.dataset.theme, 'dark');
  assert.match(w.document.getElementById('site-skin').textContent, /--paper:#070b16/);
  const toggle = w.document.createElement('button');
  toggle.setAttribute('data-theme-toggle', '');
  w.document.body.appendChild(toggle);
  toggle.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(w.document.getElementById('site-skin'), null, 'the light/dark switch goes back to the standard look');
  assert.equal(w.localStorage.getItem('lightning-site-skin'), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
