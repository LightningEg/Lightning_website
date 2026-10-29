// The owner console's Activity view (admin.html #activity, js/owner-activity.js) in jsdom with a fake admin_activity().
// What the database lists and who may ask is tested in activity.test.mjs.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/owner-activity-pages.test.mjs

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
const row = (i, o = {}) => ({ at: `2026-10-2${i % 9}T10:0${i % 10}:00Z`, id: 'l' + i, category: 'coins', event: 'paid_topup', coins: 100, score: null, member: 'ada', email: 'ada@example.test',
  member_ref: 'abcd1234', by: 'system', item: null, order: null, gift_to: null, ref: 'topup:T' + i, detail: 'Top-up ' + i, ...o });
const summary = { days: 30, paid_in: 1000, given: 350, spent: 480, refunded: 0, corrections: 1, score_awarded: 300, manual_credits: 2, admin_actions: 9 };

async function boot({ pages, fail = false, verified = true } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lightningeg.com/admin.html#activity', virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const w = dom.window, calls = [];
  let n = 0;
  w.FG = { say: e => e.message, sb: { rpc: async (name, args) => {
    calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
    if (fail) return { data: null, error: { message: 'MFA administrator required' } };
    return { data: JSON.parse(JSON.stringify(pages[Math.min(n++, pages.length - 1)])), error: null };
  } } };
  w.eval(read('js/owner-activity.js'));
  if (verified) w.document.getElementById('store-tools').disabled = false; // js/store-admin.js does this once verified
  w.dispatchEvent(new w.CustomEvent('lightning:owner-access', { detail: { verified } }));
  await tick();
  const $ = id => w.document.getElementById(id), qa = s => [...w.document.querySelectorAll(s)];
  const btn = text => qa('#ops-activity button').find(b => b.textContent === text);
  return { w, $, qa, calls, btn };
}
const page1 = () => ({ rows: [row(3), row(2, { category: 'sale', event: 'purchase', coins: -150, item: 'Gold name', order: 'a1b2c3d4', member: 'ben', by: 'member' }), row(1, { category: 'score', event: 'contribution_award', coins: 300, score: 300 })], has_more: true, summary });

await test('Activity is a console view with its own menu entry; nothing loads before verification', async () => {
  const p = await boot({ pages: [page1()], verified: false });
  assert.equal(p.calls.length, 0);
  assert.ok(p.$('activity') && p.qa('.ops-nav a').some(a => a.getAttribute('data-view') === 'activity' && /Activity/.test(a.textContent)));
  assert.match(p.$('ops-activity').textContent, /Verify your session/);
});

await test('it loads the newest fifty first and shows who, what, details, coins and score', async () => {
  const p = await boot({ pages: [page1()] });
  assert.deepEqual(p.calls.map(c => c.args), [{ p_category: 'all', p_search: null, p_before: null, p_limit: 50, p_days: 30 }]);
  const t = p.$('ops-activity').textContent;
  assert.equal(p.qa('#ops-activity tbody tr').length, 3);
  assert.match(t, /paid topup/); assert.match(t, /Gold name · order a1b2c3d4/); assert.match(t, /\+300/); assert.match(t, /−150/);
  assert.match(t, /ben · automatic|ben/);
  assert.match(t, /Cotton in\s*1,350\s*Cotton/); assert.match(t, /Cotton spent\s*480/); assert.match(t, /2 manual credits/);
});

await test('a filter asks again for that kind, and search waits for a pause before asking', async () => {
  const p = await boot({ pages: [page1()] });
  p.btn('Sales').click(); await tick();
  assert.equal(p.calls.at(-1).args.p_category, 'sales');
  assert.equal(p.btn('Sales').getAttribute('aria-pressed'), 'true');
  const input = p.$('ops-activity').querySelector('input[type=search]');
  input.value = 'gold'; input.dispatchEvent(new p.w.Event('input'));
  const before = p.calls.length; await tick(100);
  assert.equal(p.calls.length, before, 'not on every keystroke');
  await tick(300);
  assert.equal(p.calls.at(-1).args.p_search, 'gold');
});

await test('load more continues from the oldest row on screen and appends', async () => {
  const older = { rows: [row(0, { at: '2026-10-01T00:00:00Z', id: 'l0', detail: 'Oldest' })], has_more: false, summary };
  const p = await boot({ pages: [page1(), older] });
  p.btn('Load more').click(); await tick();
  assert.equal(p.calls.at(-1).args.p_before, page1().rows[2].at);
  assert.equal(p.qa('#ops-activity tbody tr').length, 4);
  assert.equal(p.btn('Load more').hidden, true, 'nothing further to load');
});

await test('Save as CSV writes what is on screen, and a cell that starts like a formula is made harmless', async () => {
  const evil = { rows: [row(1, { member: '=HYPERLINK("http://x","y")', detail: '+cmd|calc', item: 'Say "hi", ok' })], has_more: false, summary };
  const p = await boot({ pages: [evil] });
  const csv = p.w.FGOwnerActivity.csv();
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^"when_utc","category","event","member"/);
  assert.ok(lines[1].includes(`"'=HYPERLINK(""http://x"",""y"")"`), 'quoted, with a leading apostrophe');
  assert.ok(lines[1].includes(`"'+cmd|calc"`));
  assert.ok(lines[1].includes('"Say ""hi"", ok"'), 'quotes and commas survive');
});

await test('a refusal is said plainly, an empty period says so, and names are only ever text', async () => {
  const bad = await boot({ pages: [{}], fail: true });
  assert.match(bad.$('ops-activity').textContent, /Activity did not load\. MFA administrator required/);
  const none = await boot({ pages: [{ rows: [], has_more: false, summary }] });
  assert.match(none.$('ops-activity').textContent, /Nothing matches in the last 30 days/);
  const xss = await boot({ pages: [{ rows: [row(1, { member: '<img src=x onerror=alert(1)>' })], has_more: false, summary }] });
  assert.equal(xss.qa('#ops-activity img').length, 0);
  assert.match(xss.$('ops-activity').textContent, /<img src=x/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
