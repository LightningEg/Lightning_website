// The owner console's Roadmap view (admin.html #roadmap, js/owner-roadmap.js) in jsdom with a fake GitHub.
// The state of every issue must equal what tools/board.py in the app repository works out: fixtures/roadmap-board.json is a
// real snapshot of the board's input and fixtures/roadmap-expected.json is board.derive()'s answer on it.
// To refresh the three fixtures from the live board: python tools/roadmap_fixtures.py
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/owner-roadmap-pages.test.mjs

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
const json = f => JSON.parse(read('supabase/tests/fixtures/' + f));
const html = read('admin.html').replace(/<script[\s\S]*?<\/script>/g, '');
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const board = json('roadmap-board.json'), expected = json('roadmap-expected.json'), rawIssues = json('roadmap-raw-issues.json');

function fakeGitHub(calls, { limited = false } = {}) {
  const blockers = Object.fromEntries(board.issues.filter(i => i.blocked_by.length).map(i => [i.n, i.blocked_by]));
  return async url => {
    calls.push(url.replace('https://api.github.com/repos/LightningEg/Lightning', ''));
    const reply = (status, body) => ({ status, ok: status < 400, json: async () => body });
    if (limited) return reply(403, { message: 'rate limit exceeded' });
    if (url.includes('/issues?state=open')) return reply(200, rawIssues);
    if (url.includes('/pulls?state=open')) return reply(200, board.prs.map(p => ({ number: p.n, title: p.title, body: p.body, head: { ref: p.branch }, draft: p.draft, updated_at: p.updated })));
    if (url.includes('/pulls?state=closed')) return reply(200, board.merged.map(p => ({ number: p.n, title: p.title, merged_at: p.merged })));
    const m = /issues\/(\d+)\/dependencies/.exec(url);
    if (m) return reply(200, (blockers[m[1]] || []).map(n => ({ number: n, state: 'open' })));
    return reply(404, {});
  };
}

async function boot({ verified = true, hash = '#roadmap', limited = false, stored = null } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lightningeg.com/admin.html' + hash, virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const w = dom.window, calls = [];
  w.fetch = fakeGitHub(calls, { limited });
  if (stored) w.sessionStorage.setItem('lightning-owner-roadmap-v1', JSON.stringify(stored));
  w.eval(read('js/owner-roadmap.js'));
  const roadmap = w.document.getElementById('roadmap');
  roadmap.hidden = hash !== '#roadmap';
  if (verified) w.document.getElementById('store-tools').disabled = false; // js/store-admin.js does this once verified
  w.dispatchEvent(new w.CustomEvent('lightning:owner-access', { detail: { verified } }));
  await tick(60);
  return { w, calls, $: id => w.document.getElementById(id), q: s => [...w.document.querySelectorAll(s)] };
}

await test('the console has a Roadmap view in its menu, behind verification', async () => {
  const p = await boot({ verified: false });
  assert.ok(p.q('.ops-nav a').some(a => a.getAttribute('data-view') === 'roadmap'));
  assert.equal(p.calls.length, 0, 'nothing is read from GitHub before the session is verified');
  assert.match(p.$('ops-roadmap').textContent, /Verify your session/);
  assert.ok(p.$('store-tools').contains(p.$('roadmap')), 'inside the disabled-until-verified tools');
});

await test('the states equal what tools/board.py works out on the same board', async () => {
  const p = await boot();
  const rows = p.w.FGOwnerRoadmap.derive(JSON.parse(JSON.stringify(board)));
  assert.equal(rows.length, expected.length);
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map(r => ({ n: r.n, state: r.state, when: r.when, can: r.can, why: r.why, parent: r.parent })))), expected);
});

await test('GitHub\'s own answer becomes the same board (parents from parent_issue_url, blockers read once each)', async () => {
  const p = await boot();
  const got = p.w.FGOwnerRoadmap.derive(p.w.FGOwnerRoadmap.normalize(rawIssues, board.prs.map(x => ({ number: x.n, title: x.title, body: x.body, head: { ref: x.branch }, draft: x.draft, updated_at: x.updated })),
    [], Object.fromEntries(board.issues.filter(i => i.blocked_by.length).map(i => [i.n, i.blocked_by])), board.now));
  assert.deepEqual(JSON.parse(JSON.stringify(got.map(r => [r.n, r.state]))), expected.map(r => [r.n, r.state]));
});

await test('the view shows what needs you, what runs, what is ready and what shipped', async () => {
  const p = await boot();
  const text = p.$('ops-roadmap').textContent;
  assert.equal(p.q('#ops-roadmap .ops-kpi').length, 4);
  assert.match(p.q('#ops-roadmap .ops-kpi')[0].textContent, /Needs you/);
  assert.match(text, /Running now/); assert.match(text, /Ready next/); assert.match(text, /Blocked or held/); assert.match(text, /Shipped lately/);
  const running = expected.filter(r => r.state === 'running').map(r => '#' + r.n);
  for (const n of running) assert.ok(text.includes(n), n + ' is shown as running');
  assert.ok(p.q('#ops-roadmap a').every(a => a.href.startsWith('https://github.com/LightningEg/Lightning/') && a.rel === 'noopener'));
});

await test('one load is a handful of reads, and a second open within five minutes reads nothing', async () => {
  const p = await boot();
  assert.ok(p.calls.length <= 14, p.calls.length + ' reads');
  assert.ok(p.calls.some(c => c.startsWith('/issues?state=open')) && p.calls.some(c => c.startsWith('/pulls?state=open')));
  const stored = JSON.parse(p.w.sessionStorage.getItem('lightning-owner-roadmap-v1'));
  const again = await boot({ stored });
  assert.equal(again.calls.length, 0);
  assert.match(again.$('ops-roadmap').textContent, /Running now/);
});

await test('Refresh asks GitHub again', async () => {
  const p = await boot();
  const before = p.calls.length;
  p.q('#ops-roadmap button').find(b => b.textContent === 'Refresh').click();
  await tick(60);
  assert.ok(p.calls.length > before);
});

await test('when GitHub limits the address, the owner is told and nothing breaks', async () => {
  const p = await boot({ limited: true });
  assert.match(p.$('ops-roadmap').textContent, /did not load.*limiting reads/);
});

await test('issue titles are text, never markup', async () => {
  const p = await boot();
  const w = p.w, data = JSON.parse(JSON.stringify(board));
  data.issues[0].title = '<img src=x onerror=alert(1)> [IT-1]';
  data.issues[0].children = []; data.issues[0].blocked_by = []; data.issues[0].labels = ['when:launch', 'can:owner'];
  data.issues[0].body = '';
  const again = await boot({ stored: { at: Date.now(), data } });
  assert.equal(again.q('#ops-roadmap img').length, 0);
  assert.ok(again.$('ops-roadmap').textContent.includes('<img src=x'));
});

await test('every issue row has a Copy prompt button, and the wording fits the issue\'s state', async () => {
  const p = await boot();
  const copies = [];
  Object.defineProperty(p.w.navigator, 'clipboard', { value: { writeText: async t => { copies.push(t); } }, configurable: true });
  const leaves = expected.filter(r => !['group'].includes(r.state));
  const buttons = p.q('#ops-roadmap button').filter(b => b.textContent === 'Copy prompt');
  assert.equal(buttons.length, leaves.length, 'one button per open issue, parents apart, none twice');
  const rows = p.q('#ops-roadmap tbody tr');
  const prompts = {};
  for (const tr of rows) {
    const btn = [...tr.querySelectorAll('button')].find(b => b.textContent === 'Copy prompt');
    const m = btn && /#(\d+)/.exec(tr.querySelector('a').textContent);
    if (!btn) continue;
    btn.click(); await tick(5);
    prompts[m[1]] = copies[copies.length - 1];
  }
  const by = state => expected.find(r => r.state === state && prompts[r.n]);
  const ready = by('ready'), running = by('running'), blocked = by('blocked'), person = by('person');
  assert.match(prompts[ready.n], /Take this issue/); assert.ok(prompts[ready.n].includes('Closes #' + ready.n));
  assert.match(prompts[running.n], /Do not open a second pull request/); assert.ok(!prompts[running.n].includes('Closes #'));
  assert.match(prompts[blocked.n], /lists this as blocked because of: /); assert.match(prompts[blocked.n], /do not start/);
  assert.match(prompts[person.n], /needs me/); assert.match(prompts[person.n], /\(Recommended\)/);
  for (const t of Object.values(prompts)) for (const must of ['AGENTS.md', 'https://github.com/LightningEg/Lightning/issues/']) assert.ok(t.includes(must));
  const w = p.w.FGOwnerRoadmap;
  assert.match(w.prompt({ n: 7, title: '[X-1] t', areas: ['lightning/ui', 'tests/x'] }), /Stay inside its Area: lightning\/ui, tests\/x\./);
  assert.ok(!/Area/.test(w.prompt({ n: 7, title: 't', areas: [] })));
  assert.match(w.prompt({ n: 7, title: 't', state: 'stale', prs: [{ n: 9, branch: 'claude/x' }], areas: [] }), /no activity for 48 hours/);
  assert.match(w.prompt({ n: 7, title: 't', state: 'group', areas: [] }), /parent item/);
});

await test('ready issues that are not for launch sit in a fold, each with a copy button', async () => {
  const p = await boot();
  const fold = p.q('#ops-roadmap details.oc-fold')[0];
  assert.ok(fold, 'a fold');
  const later = expected.filter(r => r.when !== 'launch' && r.state === 'ready');
  assert.match(fold.querySelector('summary').textContent, new RegExp('Ready, but not for launch: ' + later.length + ' issues'));
  assert.equal(fold.querySelectorAll('tbody tr').length, later.length);
  assert.equal([...fold.querySelectorAll('button')].filter(b => b.textContent === 'Copy prompt').length, later.length);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
