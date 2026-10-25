// Tests for the supporter release in the market (js/forgeeks-market.js, js/market-ui.js): sets, names, earned badges,
// seasonal days left, gifts, the theme vote and gifts received, in jsdom with a fake Supabase.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/supporter-pages.test.mjs
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

const soon = new Date(Date.now() + 2.5 * 864e5).toISOString();
const catalog = () => [
  { id: 'mono', type: 'theme', name: 'Mono', description: 'White on black', price: 0, is_default: true },
  { id: 'nile', type: 'theme', name: 'Nile', description: 'Night blue and gold', price: 300, is_default: false, tier: 'palette' },
  { id: 'banner-dusk', type: 'banner', name: 'Dusk', description: 'Indigo sky.', price: 150, is_default: false },
  { id: 'banner-nile-flow', type: 'banner', name: 'Nile at night', description: 'Gold on dark water.', price: 350, is_default: false, tier: 'motion' },
  { id: 'banner-cotton-harvest', type: 'banner', name: 'Cotton harvest', description: 'Harvest season only.', price: 200, is_default: false, available_until: soon },
  { id: 'frame-nile', type: 'frame', name: 'Nile frame', description: 'Blue ring.', price: 80, is_default: false },
  { id: 'name-nile', type: 'name', name: 'Nile name', description: 'Your name in Nile blue.', price: 150, is_default: false },
  { id: 'name-gold', type: 'name', name: 'Gold name', description: 'Warm gold.', price: 150, is_default: false },
  { id: 'set-nile', type: 'set', name: 'Nile set', description: 'Four parts.', price: 880, is_default: false, parts: ['banner-nile-flow', 'frame-nile', 'name-nile', 'nile'], set_price: 704 },
  { id: 'badge-founding', type: 'badge', name: 'Founding supporter', description: 'First 100.', price: 0, is_default: false, award: 'founding' },
  { id: 'badge-supporter-bronze', type: 'badge', name: 'Bronze supporter', description: '500 coins.', price: 0, is_default: false, award: 'supporter', award_coins: 500 },
  { id: 'badge-supporter-silver', type: 'badge', name: 'Silver supporter', description: '2,500 coins.', price: 0, is_default: false, award: 'supporter', award_coins: 2500 }
];
const STATUS = { topped_up_coins: 1350, tiers: [{ id: 'badge-supporter-bronze', name: 'Bronze supporter', coins: 500, owned: true }, { id: 'badge-supporter-silver', name: 'Silver supporter', coins: 2500, owned: false }], founding_left: 73, founding_owned: false };
const POLL = (vote = null, can = true) => ({ options: [{ id: 'lotus', name: 'Lotus', description: 'Pink lotus.', votes: 3 }, { id: 'khan', name: 'Khan el-Khalili', description: 'Brass.', votes: 1 }], my_vote: vote, can_vote: can });

function fake(opts, calls) {
  const srv = { balance: opts.balance ?? 2000, owned: new Set(opts.owned ?? []), session: opts.signedIn === false ? null : { user: { id: UID, email: 'mohab@example.test' } } };
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
    if (name === 'market_catalog') return thenable({ data: catalog().map(i => ({ ...i, owned: !!srv.session && (i.is_default || srv.owned.has(i.id)), equipped: false })), error: null });
    if (name === 'coin_rate') return thenable({ data: { coins_per_egp: 5, tiers: [] }, error: null });
    if (name === 'supporter_status') return thenable({ data: STATUS, error: null });
    if (name === 'theme_poll') return thenable({ data: POLL(null, opts.supporter !== false), error: null });
    if (name === 'vote_theme') return thenable({ data: POLL(args.p_option), error: null });
    if (name === 'my_gifts') return thenable({ data: { received: [{ item_id: 'banner-dusk', item: 'Dusk', type: 'banner', from: 'Sara', at: '2026-10-24T10:00:00Z' }], sent: [] }, error: null });
    if (name === 'gift_item') return thenable(args.p_recipient === 'nobody' ? { data: null, error: { message: 'no member with that display name' } } : { data: { status: 'sent', item_id: args.p_item_id, to: 'Sara' }, error: null });
    if (name === 'purchase_set') { srv.owned.add('set-nile'); return thenable({ data: { item_id: 'set-nile', price_paid: args.p_expected_price }, error: null }); }
    return thenable({ data: null, error: null });
  };
  return { auth: { onAuthStateChange(f) { setTimeout(() => f('INITIAL_SESSION', srv.session), 0); return { data: { subscription: { unsubscribe() {} } } }; } }, from, rpc };
}

async function boot({ main = true, ...opts } = {}) {
  const file = main ? 'marketplace.html' : 'forgeeks-market.html';
  const dom = new JSDOM(strip(read(file)), { runScripts: 'outside-only', url: 'https://lightningeg.com/' + file, virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const w = dom.window, calls = [];
  w.Element.prototype.scrollIntoView = function () {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (main) { w.eval(code('js/theme.js')); w.eval(code('js/site-theme-previews.js')); } else w.eval(code('js/forgeeks.js'));
  w.supabase = { createClient: () => fake(opts, calls) };
  w.FORGEEKS = { supabaseUrl: 'https://x.supabase.co', anonKey: 'anon' };
  ['js/forgeeks-auth.js', 'js/forgeeks-showcase.js', 'js/theme-preview.js', 'js/cosmetic-parts.js', 'js/market-ui.js', 'js/forgeeks-market.js'].forEach(f => w.eval(code(f)));
  await tick(80);
  const $ = id => w.document.getElementById(id), qa = s => [...w.document.querySelectorAll(s)];
  const cell = id => w.document.querySelector(`.mkt-cell[data-item="${id}"]`);
  const click = async el => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(30); };
  const btn = (id, text) => [...cell(id).querySelectorAll('button')].find(b => b.textContent === text);
  return { w, $, qa, cell, click, btn, calls };
}

await test('sets: 80% of what you do not own, the full price struck through, bought whole with purchase_set', async () => {
  const p = await boot();
  const c = p.cell('set-nile');
  assert.ok(p.$('list-sets').contains(c));
  assert.match(c.querySelector('.mkt-tag').textContent, /704/);
  assert.match(c.textContent, /Instead of 880 coins/);
  assert.ok(c.querySelector('.mkt-pv-set .fg-banner[data-item="banner-nile-flow"]'), 'the set shows its banner');
  assert.equal(p.btn('set-nile', 'Gift'), undefined, 'sets are not gifts');
  await p.click(p.btn('set-nile', 'Buy set'));
  assert.match(p.$('buy-price').textContent, /704 coins/);
  await p.click(p.$('buy-ok'));
  await tick(60);
  const call = p.calls.find(c => c.fn === 'purchase_set');
  assert.equal(call.args.p_set_id, 'set-nile'); assert.equal(call.args.p_expected_price, 704); assert.ok(call.args.p_idempotency_key);
  assert.equal(p.calls.some(c => c.fn === 'purchase_item_at_price'), false);
});

await test('names: their own tab, each previewed in its style; earned badges are not for sale and say how to earn them', async () => {
  const p = await boot({ owned: ['badge-supporter-bronze'] });
  assert.equal(p.cell('name-gold').querySelector('[data-name-style]').getAttribute('data-name-style'), 'name-gold');
  assert.ok(p.$('list-names').contains(p.cell('name-nile')));
  const silver = p.cell('badge-supporter-silver');
  assert.equal(silver.querySelector('[data-act="buy"]'), null);
  assert.equal(silver.querySelector('[data-act="gift"]'), null);
  assert.match(silver.querySelector('.mkt-acts').textContent, /Earned by topping up/);
  assert.match(p.cell('badge-founding').querySelector('.mkt-acts').textContent, /First 100 to top up/);
  assert.ok(p.btn('badge-supporter-bronze', 'Equip'), 'an earned badge you hold is worn like any other');
  const box = p.$('mkt-supporter');
  assert.match(box.textContent, /1,350 coins topped up\. Silver supporter at 2,500 coins: 1,150 coins to go\./);
  assert.match(box.textContent, /73 of 100 places left/);
  assert.equal(box.querySelector('[role=meter]').getAttribute('aria-valuenow'), '1350');
  assert.equal(box.querySelector('.mkt-sup-legend b').textContent, 'Bronze 500', 'the badges you hold are bold');
  assert.match(p.cell('banner-nile-flow').textContent, /Animated/);
});

await test('seasonal: the days left are said, and the last day says so', async () => {
  const p = await boot();
  assert.match(p.cell('banner-cotton-harvest').querySelector('.mkt-season').textContent, /On sale for 3 more days/);
  assert.equal(p.cell('banner-dusk').querySelector('.mkt-season'), null);
});

await test('gifts: by display name, refused without one, the server error shown, and sent says to whom', async () => {
  const p = await boot();
  await p.click(p.btn('banner-dusk', 'Gift'));
  assert.equal(p.$('buy-gift').hidden, false);
  assert.match(p.$('buy-title').textContent, /gift dusk/i);
  assert.equal(p.w.document.activeElement, p.$('buy-gift-name'));
  await p.click(p.$('buy-ok'));
  assert.equal(p.calls.some(c => c.fn === 'gift_item'), false, 'no name, no request');
  assert.match(p.$('buy-status').textContent, /display name/);
  p.$('buy-gift-name').value = 'nobody';
  await p.click(p.$('buy-ok')); await tick(40);
  assert.match(p.$('buy-status').textContent, /No member has that display name/);
  const key = p.calls.find(c => c.fn === 'gift_item').args.p_idempotency_key;
  p.$('buy-gift-name').value = 'sara';
  await p.click(p.$('buy-ok')); await tick(40);
  const sent = p.calls.filter(c => c.fn === 'gift_item').pop();
  assert.deepEqual([sent.args.p_item_id, sent.args.p_recipient, sent.args.p_expected_price, sent.args.p_idempotency_key], ['banner-dusk', 'sara', 150, key], 'a retry in the same window keeps its key');
  assert.match(p.$('buy-title').textContent, /sent to Sara/);
  assert.equal(p.$('buy-ok').hidden, true);
  assert.equal(p.$('buy-equip').hidden, true, 'nothing to equip: it is theirs');
});

await test('the theme vote: supporters vote and see their choice; others see the count and how to get a vote', async () => {
  const p = await boot();
  const lotus = [...p.$('mkt-vote').querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Vote for Lotus');
  await p.click(lotus); await tick(30);
  assert.equal(p.calls.find(c => c.fn === 'vote_theme').args.p_option, 'lotus');
  assert.ok(p.$('mkt-vote').querySelector('.mkt-vote-opt.mine'));
  assert.match(p.$('mkt-vote').textContent, /3 votes/);
  const q = await boot({ supporter: false });
  assert.equal(q.$('mkt-vote').querySelectorAll('button').length, 0);
  assert.match(q.$('mkt-vote').textContent, /top up once to earn a supporter badge and a vote/);
});

await test('Owned: gifts from other members come first; For Geeks keeps its lower-case words', async () => {
  const p = await boot();
  await p.click(p.qa('.mkt-tab').find(b => b.getAttribute('data-view') === 'owned'));
  assert.equal(p.$('mkt-gifts').hidden, false);
  assert.match(p.$('mkt-gifts').textContent, /Gifts for you.*Dusk.*From Sara/);
  const g = await boot({ main: false });
  assert.equal(g.btn('banner-dusk', 'gift').textContent, 'gift');
  assert.match(g.$('mkt-supporter').textContent, /bronze/);
  assert.match(g.$('mkt-supporter').querySelector('.mkt-sup-legend').textContent, /bronze 500.*silver 2,500/, 'the legend is lower case on For Geeks');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
