// The owner console's Sign-ups view (admin.html #signups, js/owner-signups.js) in jsdom with a fake admin_signups(),
// and the migration's privacy and access rules read from its SQL.
// What the database computes against real rows is checked by running the function in Supabase.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/owner-signups-pages.test.mjs

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
  days: 90, since: '2026-08-03',
  totals: { accounts: 5, members: 4, administrators: 1, anonymous: 0, first_signup: '2026-10-24', latest_signup: '2026-10-26' },
  period: { members: 4 },
  steps: { signed_up: 4, confirmed_email: 4, signed_in: 3, linked_github: 1, asked_topup: 2, bought: 2, contributed: 1, did_something: 2 },
  providers: [{ provider: 'email', members: 2 }, { provider: 'google', members: 1 }, { provider: '<img src=x onerror=alert(1)>', members: 1 }],
  daily: Array.from({ length: 90 }, (_, i) => ({ day: '2026-10-' + String(i % 28 + 1).padStart(2, '0'), signups: i === 80 ? 2 : i === 82 ? 2 : 0 })),
  recent: [{ day: '2026-10-26', providers: ['email'], confirmed: true, signed_in: true, did_something: true },
    { day: '2026-10-24', providers: ['github', 'google'], confirmed: true, signed_in: false, did_something: false }]
});

async function boot({ data = sample(), verified = true, fail = false } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lightningeg.com/admin.html#signups', virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const w = dom.window, calls = [];
  w.FG = { say: e => e.message, sb: { rpc: async (name, args) => { calls.push({ name, args: args && JSON.parse(JSON.stringify(args)) });
    if (fail) return { data: null, error: { message: 'MFA administrator required' } };
    return { data: JSON.parse(JSON.stringify(data)), error: null }; } } };
  w.eval(read('js/owner-signups.js'));
  if (verified) w.document.getElementById('store-tools').disabled = false; // js/store-admin.js does this once verified
  w.dispatchEvent(new w.CustomEvent('lightning:owner-access', { detail: { verified } }));
  await tick();
  const $ = id => w.document.getElementById(id), qa = s => [...w.document.querySelectorAll(s)];
  return { w, $, qa, calls };
}

await test('Sign-ups is a console view with its own menu entry, and the dashboard knows it', async () => {
  const p = await boot();
  assert.ok(p.$('signups') && p.$('ops-signups'));
  assert.ok(p.qa('.ops-nav a').some(a => a.getAttribute('data-view') === 'signups' && /Sign-ups/.test(a.textContent)));
  assert.match(read('js/owner-dashboard.js'), /VIEWS = \[[^\]]*'signups'/);
  assert.match(read('admin.html'), /owner-signups\.js\?v=/);
});

await test('nothing loads before the owner session is verified', async () => {
  const p = await boot({ verified: false });
  assert.equal(p.calls.length, 0);
  assert.match(p.$('ops-signups').textContent, /Verify your session/);
});

await test('it asks for ninety days first, and the figures answer how many signed up and what they did', async () => {
  const p = await boot();
  assert.deepEqual(p.calls.map(c => [c.name, c.args]), [['admin_signups', { p_days: 90 }]]);
  const t = p.$('ops-signups').textContent;
  assert.match(t, /Members\s*4/);
  assert.match(t, /first 2026-10-24 · latest 2026-10-26/);
  assert.match(t, /Confirmed their email\s*100%\s*4 of 4/);
  assert.match(t, /Did something\s*50%\s*2 asked for a top-up, bought or contributed/);
  assert.match(t, /1 administrator account is counted apart/);
  assert.match(t, /Signed in\s*3\s*75% of the step before/);
  assert.match(t, /Asked for a top-up 2 · bought 2 · contributed 1 · linked GitHub 1/);
  assert.match(t, /Email\s*2\s*50%/);
  assert.match(t, /Google, GitHub|GitHub, Google/);
  assert.equal(p.qa('.ops-chart rect').length, 90);
});

await test('the period buttons ask again for thirty days or a year', async () => {
  const p = await boot();
  [...p.$('ops-signups').querySelectorAll('.oc-seg button')].find(x => x.textContent === '1 year').click(); await tick();
  assert.deepEqual(p.calls.map(c => c.args.p_days), [90, 365]);
  assert.equal([...p.$('ops-signups').querySelectorAll('.oc-seg button')].find(x => x.getAttribute('aria-pressed') === 'true').textContent, '1 year');
});

await test('a refusal is said plainly, and provider text is only ever text', async () => {
  const bad = await boot({ fail: true });
  assert.match(bad.$('ops-signups').textContent, /Sign-ups did not load\. MFA administrator required/);
  const p = await boot();
  assert.equal(p.qa('#ops-signups img').length, 0);
  assert.match(p.$('ops-signups').textContent, /<img src=x/);
});

await test('an empty database reads as no sign-ups yet, not as an error', async () => {
  const p = await boot({ data: { days: 90, totals: { members: 0, administrators: 1 }, period: { members: 0 }, steps: {}, providers: [], daily: [], recent: [] } });
  assert.match(p.$('ops-signups').textContent, /no one has signed up yet/);
  assert.match(p.$('ops-signups').textContent, /No sign-ups yet\./);
});

await test('the view names no one: the page code reads no email, id or name field', async () => {
  const js = read('js/owner-signups.js');
  assert.doesNotMatch(js, /\.email|user_id|\.id\b|innerHTML|insertAdjacentHTML/);
});

await test('the function is admin-only and returns counts, never emails or ids', async () => {
  const sql = read('supabase/migrations/20261031120000_admin_signups.sql');
  assert.match(sql, /perform private\.require_mfa_admin\(\)/);
  assert.match(sql, /security definer set search_path = ''/);
  assert.match(sql, /revoke all on function public\.admin_signups\(integer\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.admin_signups\(integer\) to authenticated, service_role;/);
  const out = sql.slice(sql.indexOf('select jsonb_build_object'));
  assert.doesNotMatch(out, /\bemail\b(?!_confirmed)|raw_user_meta|encrypted_password|\bphone\b|user_id|github_login|\bid\b\s*,\s*day/);
  assert.match(out, /limit 15/, 'the list of latest sign-ups is bounded');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
