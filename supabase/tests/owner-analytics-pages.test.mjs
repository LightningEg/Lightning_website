// The owner console's Analytics view (admin.html #analytics): tabs inside one page, the decision tabs computed in the browser from
// the page-view records of admin_page_views (js/owner-decisions.js, analytics/insights.js, analytics/rules.js).
// Sample records come from analytics/tests/gen-data.js:   node analytics/tests/gen-data.js /tmp/d.json
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js ANALYTICS_DATA=/tmp/d.json node supabase/tests/owner-analytics-pages.test.mjs

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const { JSDOM, VirtualConsole } = process.env.JSDOM_PATH ? await import(pathToFileURL(process.env.JSDOM_PATH).href).then(m => m.default ?? m) : await import('jsdom');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const html = read('admin.html').replace(/<script[\s\S]*?<\/script>/g, '');
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
let dataFile = process.env.ANALYTICS_DATA;
if (!dataFile || !existsSync(dataFile)) { dataFile = '/tmp/analytics-sample.json'; execFileSync('node', [new URL('../../analytics/tests/gen-data.js', import.meta.url).pathname, dataFile]); }
const sample = JSON.parse(readFileSync(dataFile, 'utf8')).rows;

async function boot({ rows = sample, verified = true, fail = false, hash = '#analytics' } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lightningeg.com/admin.html' + hash, virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const w = dom.window, calls = [];
  w.FG = { say: e => e.message, sb: { rpc: async (name, args) => {
    calls.push({ name, args: JSON.parse(JSON.stringify(args || {})) });
    if (fail) return { data: null, error: { message: 'MFA administrator required' } };
    if (name === 'admin_page_views') { const o = args.p_offset, l = args.p_limit; return { data: { total: rows.length, live_from: '2026-10-14', rows: rows.slice(o, o + l) }, error: null }; }
    return { data: {}, error: null };
  } } };
  w.eval(read('analytics/rules.js')); w.eval(read('analytics/insights.js'));
  w.eval(read('js/owner-decisions.js')); w.eval(read('js/owner-dashboard.js'));
  w.document.getElementById('store-tools').disabled = false;
  w.dispatchEvent(new w.CustomEvent('lightning:owner-access', { detail: { verified } }));
  await tick(80);
  const $ = id => w.document.getElementById(id), qa = s => [...w.document.querySelectorAll(s)];
  return { w, $, qa, calls };
}

await test('Analytics is one console view whose tabs hold each analysis, and the old two entries are gone', async () => {
  const p = await boot();
  const names = p.qa('#an-tabs [role=tab]').map(b => b.textContent);
  assert.deepEqual(names, ['What to act on', 'Visitors', 'Sign-ups', 'Numbers and trends', 'Download path', 'Channels', 'Fix list', 'Readers', 'Releases', 'Details']);
  assert.deepEqual(p.qa('.ops-nav a').map(a => a.getAttribute('data-view')).filter(v => /analytics|traffic|signups/.test(v)), ['analytics']);
  assert.equal(p.qa('#analytics [role=tabpanel]').length, 10);
});

await test('one tab shows at a time, with arrow keys and aria-selected, and the first is What to act on', async () => {
  const p = await boot();
  const visible = () => p.qa('#analytics [role=tabpanel]').filter(x => !x.hidden).map(x => x.id);
  assert.deepEqual(visible(), ['an-act']);
  p.$('an-tab-channels').click();
  assert.deepEqual(visible(), ['an-channels']);
  assert.equal(p.$('an-tab-channels').getAttribute('aria-selected'), 'true'); assert.equal(p.$('an-tab-act').getAttribute('aria-selected'), 'false');
  p.$('an-tab-channels').focus();
  p.$('an-tab-channels').dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.deepEqual(visible(), ['an-fix']);
});

await test('an old #signups or #traffic link lands on its tab inside Analytics', async () => {
  const a = await boot({ hash: '#signups' });
  assert.deepEqual(a.qa('#analytics [role=tabpanel]').filter(x => !x.hidden).map(x => x.id), ['signups']);
  assert.equal(a.$('analytics').hidden, false);
  const b = await boot({ hash: '#traffic' });
  assert.deepEqual(b.qa('#analytics [role=tabpanel]').filter(x => !x.hidden).map(x => x.id), ['traffic']);
});

await test('nothing is read before the session is verified', async () => {
  const p = await boot({ verified: false });
  assert.equal(p.calls.filter(c => c.name === 'admin_page_views').length, 0);
  assert.match(p.$('dx-status').textContent, /Verify your session/);
});

await test('the records are read a page at a time for twice the period, and the decision tabs fill in', async () => {
  const p = await boot();
  const calls = p.calls.filter(c => c.name === 'admin_page_views');
  assert.ok(calls.length >= 1); assert.equal(calls[0].args.p_days, 56); assert.equal(calls[0].args.p_offset, 0);
  assert.match(p.$('dx-health').textContent, /Page views kept in Supabase\.\s*\d+ in the last 28 days/);
  assert.ok(p.qa('#dx-verdicts .dash-verdict').length >= 1, 'at least one finding card');
  assert.ok(p.qa('#dx-tiles .dash-tile').length >= 4, 'key numbers');
  assert.ok(p.qa('#dx-channels-box table').length >= 1, 'channels table');
  assert.ok(p.$('dx-path-box').textContent.length > 50);
  assert.equal(p.qa('#dx-verdicts a').length, 0, 'evidence links are buttons that open a tab, never a #hash that would leave the page');
});

await test('See the evidence opens the tab that holds it', async () => {
  const p = await boot();
  const btn = p.qa('#dx-verdicts .dash-link')[0];
  assert.ok(btn);
  btn.click();
  assert.equal(p.qa('#analytics [role=tabpanel]').filter(x => !x.hidden).length, 1);
  assert.notEqual(p.qa('#analytics [role=tabpanel]').filter(x => !x.hidden)[0].id, 'an-act');
});

await test('the period buttons read again for a longer window, and a refusal is said plainly', async () => {
  const p = await boot();
  p.qa('#dx-period button').find(b => b.textContent === 'Last 7 days').click(); await tick(80);
  assert.equal(p.calls.filter(c => c.name === 'admin_page_views').pop().args.p_days, 14);
  const bad = await boot({ fail: true });
  assert.match(bad.$('dx-status').textContent, /The analytics did not load\. MFA administrator required/);
});

await test('no page views yet reads as nothing to show, not as an error', async () => {
  const p = await boot({ rows: [] });
  assert.match(p.$('dx-health').textContent, /No page views in this period yet/);
  assert.equal(p.$('dx-status').hidden, true);
});

await test('the page code writes no markup, and the old key flow is gone', async () => {
  const js = read('js/owner-decisions.js');
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|script\.google\.com|readKey|ANALYTICS_READ_KEY/);
  assert.match(read('analytics/dashboard.html'), /admin\.html#analytics/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
