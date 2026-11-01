// The owner console's Visitors view (admin.html #traffic, js/owner-traffic.js) in jsdom with a fake admin_traffic(),
// and the migration's access rules read from its SQL. What the database computes is checked in traffic.test.mjs.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/owner-traffic-pages.test.mjs

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
const sample = () => ({
  days: 30, since: '2026-10-03', live_from: '2026-10-14',
  totals: { page_views: 400, arrivals: 250, engaged: 100, reached_downloads: 50, download_presses: 10, new_members: 5 },
  daily: Array.from({ length: 30 }, (_, i) => ({ day: '2026-10-' + String(i + 1).padStart(2, '0'), arrivals: i % 7, downloads: i === 5 ? 2 : 0, members: i === 9 ? 1 : 0 })),
  sources: [{ source: 'google.com', arrivals: 120 }, { source: '<img src=x onerror=alert(1)>', arrivals: 60 }, { source: 'smaller groups', arrivals: 70 }],
  pages: [{ page: 'index', arrivals: 200, engaged: 80 }, { page: 'current-status', arrivals: 50, engaged: 20 }],
  devices: [{ device: 'phone', arrivals: 170 }, { device: 'desktop', arrivals: 80 }],
  languages: [{ lang: 'en', arrivals: 200 }, { lang: 'ar', arrivals: 50 }],
  errors: 3, slow: 7
});

async function boot({ data = sample(), verified = true, fail = false } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lightningeg.com/admin.html#traffic', virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const w = dom.window, calls = [];
  w.FG = { say: e => e.message, sb: { rpc: async (name, args) => { calls.push({ name, args: args && JSON.parse(JSON.stringify(args)) });
    if (fail) return { data: null, error: { message: 'MFA administrator required' } };
    return { data: JSON.parse(JSON.stringify(data)), error: null }; } } };
  w.eval(read('js/owner-traffic.js'));
  if (verified) w.document.getElementById('store-tools').disabled = false;
  w.dispatchEvent(new w.CustomEvent('lightning:owner-access', { detail: { verified } }));
  await tick();
  const $ = id => w.document.getElementById(id), qa = s => [...w.document.querySelectorAll(s)];
  return { w, $, qa, calls };
}

await test('Visitors is a tab inside the Analytics view, and the dashboard knows it', async () => {
  const p = await boot();
  assert.ok(p.$('traffic') && p.$('ops-traffic'));
  assert.ok(p.$('analytics').contains(p.$('traffic')), 'Visitors is a tab inside Analytics');
  assert.ok(p.qa('#an-tabs [data-tab]').some(b => b.getAttribute('data-tab') === 'traffic' && /Visitors/.test(b.textContent)));
  assert.match(read('js/owner-dashboard.js'), /VIEWS = \[[^\]]*'analytics'/);
  assert.match(read('admin.html'), /owner-traffic\.js\?v=/);
});

await test('nothing loads before the owner session is verified', async () => {
  const p = await boot({ verified: false });
  assert.equal(p.calls.length, 0);
  assert.match(p.$('ops-traffic').textContent, /Verify your session/);
});

await test('it asks for thirty days and answers where people came from and how many made an account', async () => {
  const p = await boot();
  assert.deepEqual(p.calls.map(c => [c.name, c.args]), [['admin_traffic', { p_days: 30 }]]);
  const t = p.$('ops-traffic').textContent;
  assert.match(t, /Arrivals\s*250/);
  assert.match(t, /Read something\s*40%/);
  assert.match(t, /Reached Downloads\s*20%\s*10 pressed an app download/);
  assert.match(t, /Made an account\s*2%\s*5 new members/);
  assert.match(t, /Pressed an app download\s*10\s*20% of the step before/);
  assert.match(t, /google\.com\s*120\s*48%/);
  assert.match(t, /Arabic pages\s*50\s*20%/);
  assert.match(t, /3 page views hit a script or file error and 7 were slow/);
  assert.match(t, /Records start 2026-10-14/);
  assert.doesNotMatch(t, /Under 100 arrivals/);
  assert.equal(p.qa('.ops-chart rect').length, 30);
});

await test('under a hundred arrivals it says the rates are hints, not results', async () => {
  const d = sample(); d.totals.arrivals = 40;
  const p = await boot({ data: d });
  assert.match(p.$('ops-traffic').textContent, /Under 100 arrivals: read these as hints/);
});

await test('the period buttons ask again, and a refusal or a source name is only ever text', async () => {
  const p = await boot();
  [...p.$('ops-traffic').querySelectorAll('.oc-seg button')].find(x => x.textContent === '90 days').click(); await tick();
  assert.deepEqual(p.calls.map(c => c.args.p_days), [30, 90]);
  assert.equal(p.qa('#ops-traffic img').length, 0);
  assert.match(p.$('ops-traffic').textContent, /<img src=x/);
  const bad = await boot({ fail: true });
  assert.match(bad.$('ops-traffic').textContent, /Visitors did not load\. MFA administrator required/);
});

await test('an empty database reads as nothing yet, not as an error', async () => {
  const p = await boot({ data: { days: 30, totals: {}, daily: [], sources: [], pages: [], devices: [], languages: [] } });
  assert.match(p.$('ops-traffic').textContent, /No records yet/);
  assert.match(p.$('ops-traffic').textContent, /No arrivals yet\./);
});

await test('the page code never writes markup, and the function is admin-only', async () => {
  assert.doesNotMatch(read('js/owner-traffic.js'), /innerHTML|insertAdjacentHTML|\.email|user_id/);
  const sql = read('supabase/migrations/20261101100000_admin_traffic.sql');
  assert.match(sql, /perform private\.require_mfa_admin\(\)/);
  assert.match(sql, /revoke all on function public\.site_track\(jsonb\), public\.admin_traffic\(integer\) from public;/);
  assert.match(sql, /revoke all on function public\.admin_traffic\(integer\) from anon;/);
  assert.match(sql, /grant execute on function public\.admin_traffic\(integer\) to authenticated, service_role;/);
});

await test('every main page sends its record to the database, and the privacy pages say so in both languages', async () => {
  assert.doesNotMatch(read('js/analytics.js'), /STORE\.has/);
  assert.match(read('privacy.html'), /On every page of the main site/);
  assert.match(read('ar/privacy.html'), /في كل صفحات الموقع الرئيسي/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
