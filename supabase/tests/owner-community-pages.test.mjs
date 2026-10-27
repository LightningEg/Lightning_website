// The owner console's Community view (8S, admin.html #social): the nav item, merges held for unlinked accounts, the story
// reward settings with the blog bonus, and the story row that pays the blog bonus. jsdom with a fake client.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/owner-community-pages.test.mjs

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
const plain = v => JSON.parse(JSON.stringify(v));

const HELD = [
  { kind: 'points', github_login: 'newcomer', repository: 'LightningEg/Lightning', pr_number: 801, pr_url: 'https://github.com/LightningEg/Lightning/pull/801', pr_title: 'Fix', issue_number: null, amount: 50, merged_at: '2026-10-20T10:00:00Z' },
  { kind: 'coins', github_login: 'solver', repository: 'LightningEg/Lightning', pr_number: 803, pr_url: 'javascript:alert(1)', pr_title: 'Fix 802', issue_number: 802, amount: 100, merged_at: '2026-10-21T10:00:00Z' }
];

async function boot({ held = HELD, ladder = { coins: 120, points: 60, blog_coins: 80 }, view = 'social', heldFails = false } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lightningeg.com/admin.html#' + view, virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const w = dom.window, calls = [];
  w.FG = { say: e => e.message, sb: { rpc: async (name, args) => {
    calls.push({ name, args: args && plain(args) });
    if (name === 'admin_held_awards') return heldFails ? { data: null, error: { message: 'MFA administrator required' } } : { data: plain(held), error: null };
    if (name === 'admin_story_ladder') return { data: plain(ladder), error: null };
    if (name === 'admin_set_story_ladder') { ladder = { coins: args.p_coins, points: args.p_points, blog_coins: args.p_blog_coins }; return { data: plain(ladder), error: null }; }
    return { data: null, error: null };
  } } };
  w.eval(read('js/story-moderation.js'));
  w.eval(read('js/owner-community.js'));
  let refreshed = 0;
  w.document.getElementById('store-tools').disabled = false; // js/store-admin.js does this once verified
  w.document.getElementById('store-social-refresh').addEventListener('click', () => { refreshed++; });
  w.dispatchEvent(new w.CustomEvent('lightning:owner-access', { detail: { verified: true } }));
  await tick();
  const $ = id => w.document.getElementById(id), qa = s => [...w.document.querySelectorAll(s)];
  return { w, $, qa, calls, refreshed: () => refreshed };
}

await test('the menu item is Community (same #social anchor and badge); Stories is gone', async () => {
  const p = await boot();
  const nav = p.qa('.ops-nav a').find(a => a.getAttribute('data-view') === 'social');
  assert.equal(nav.querySelector('.oc-nav-l').textContent, 'Community');
  assert.equal(nav.getAttribute('href'), '#social');
  assert.ok(nav.querySelector('[data-badge="stories"]'), 'the badge of stories to review stays');
  assert.ok(!p.qa('.ops-nav .oc-nav-l').some(l => l.textContent === 'Stories'));
  assert.equal(p.$('social-h').textContent, 'Community');
  assert.ok(p.$('store-social-list') && p.$('store-social-filter'), 'the story review queue is in this view');
  assert.ok(p.$('ops-held').closest('#social') && p.$('ops-rewards').closest('#social'));
  assert.equal(p.$('ops-held').closest('.oc-grid'), p.$('ops-rewards').closest('.oc-grid'), 'the two panels are a pair');
});

await test('Held for linking: points and coins waiting for an unlinked GitHub account, with a plain sentence on what happens', async () => {
  const p = await boot();
  assert.match(p.$('ops-held').textContent, /when the author links GitHub/i);
  const rows = p.qa('#ops-held-list li');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.querySelector('b').textContent), ['@newcomer', '@solver']);
  assert.match(rows[0].textContent, /LightningEg\/Lightning #801/);
  assert.match(rows[0].textContent, /50 points/);
  assert.match(rows[1].textContent, /100 coins/);
  assert.match(rows[0].textContent, /merged 2026-10-20/);
  assert.equal(rows[0].querySelector('a').getAttribute('href'), 'https://github.com/LightningEg/Lightning/pull/801');
  assert.equal(rows[1].querySelector('a'), null, 'a link that is not github.com https is not made');
  const none = await boot({ held: [] });
  assert.match(none.$('ops-held-list').textContent, /Nothing is waiting/);
  const bad = await boot({ heldFails: true });
  assert.match(bad.$('ops-held-list').textContent, /did not load/);
});

await test('Story rewards: coins, points and the blog bonus are shown, saved with one call, and the queue refreshes', async () => {
  const p = await boot();
  const f = p.$('ops-rewards');
  assert.deepEqual([f.elements.coins.value, f.elements.points.value, f.elements.blog_coins.value], ['120', '60', '80']);
  f.elements.blog_coins.value = '150';
  f.dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(40);
  assert.deepEqual(p.calls.find(c => c.name === 'admin_set_story_ladder').args, { p_coins: 120, p_points: 60, p_blog_coins: 150 });
  assert.match(p.$('ops-rewards-status').textContent, /Saved/);
  assert.equal(p.refreshed(), 1, 'the review queue is drawn again with the new amounts');
  assert.equal(f.elements.blog_coins.value, '150');
});

await test('a published story: Linked from the blog · pay N coins asks for the link, pays through the server, and a paid one says so', async () => {
  const p = await boot();
  const story = { id: 'st1', status: 'published', title: 'How Sam uses Lightning', body: 'Envelopes.', author: 'Sam', verify_code: 'deadbeef', submission_revision: 3, linkedin_url: 'https://www.linkedin.com/posts/sam', reddit_url: null, user_id: 'u1', blog_url: null };
  let done = 0;
  const card = p.w.FGStoryModeration.card(story, async () => { done++; }, { coins: 100, points: 50, blog_coins: 80 });
  p.w.document.body.appendChild(card);
  const bonus = [...card.querySelectorAll('button')].find(b => b.textContent.startsWith('Linked from the blog'));
  assert.equal(bonus.textContent, 'Linked from the blog · pay 80 coins');
  assert.ok(![...card.querySelectorAll('button')].some(b => /^(Approve|Ask for a change|Decline)/.test(b.textContent)), 'a published story is not approved again');
  assert.ok(card.querySelector('input[type=url]'));
  card.querySelector('input[type=url]').value = 'https://lightningeg.com/blog-budget-20000-egp.html';
  bonus.click(); await tick();
  assert.deepEqual(p.calls.find(c => c.name === 'admin_story_blog_bonus').args, { p_id: 'st1', p_blog_url: 'https://lightningeg.com/blog-budget-20000-egp.html' });
  assert.equal(done, 1, 'the row reloads');
  const paid = p.w.FGStoryModeration.card({ ...story, blog_url: 'https://lightningeg.com/guides.html', blog_coins_paid: 80 }, async () => {}, { blog_coins: 80 });
  assert.match(paid.textContent, /Blog bonus paid: 80 coins/);
  assert.ok(![...paid.querySelectorAll('button')].some(b => b.textContent.startsWith('Linked from the blog')), 'never offered twice');
  const pending = p.w.FGStoryModeration.card({ ...story, status: 'pending' }, async () => {}, { coins: 120, points: 60, blog_coins: 80 });
  assert.ok([...pending.querySelectorAll('button')].some(b => b.textContent === 'Approve · 120 coins + 60 points'), 'a pending story still shows Approve at the ladder');
  assert.ok(![...pending.querySelectorAll('button')].some(b => b.textContent.startsWith('Linked from the blog')));
});

await test('Members no longer carries the seats tool, and the Settings-style panels stay sentence case', async () => {
  const p = await boot({ view: 'members' });
  assert.equal(p.$('members').querySelector('#admin-claims-form'), null);
  assert.ok(p.$('members').querySelector('#admin-credit-form'));
  for (const h of p.qa('#social h3')) assert.doesNotMatch(h.textContent, /^[A-Z ]{4,}$/, h.textContent + ' is not all caps');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
