// Tests for the For Geeks leaderboard and member profile pages, with the real js/forgeeks-auth.js and a fake
// Supabase client that records what the pages ask for. Nothing here talks to the real project.
//
//   npm i --no-save jsdom
//   node supabase/tests/showcase-pages.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const S = require('../../js/forgeeks-showcase.js');
const { JSDOM } = process.env.JSDOM_PATH ? await import(pathToFileURL(process.env.JSDOM_PATH).href).then(m => m.default ?? m) : await import('jsdom');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}
const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const authCode = read('js/forgeeks-auth.js');
const showCode = read('js/forgeeks-showcase.js');
const PAGES = {
  leaderboard: { html: read('forgeeks-leaderboard.html').replace(/<script[\s\S]*?<\/script>/g, ''), code: read('js/forgeeks-leaderboard.js') },
  profile: { html: read('forgeeks-profile.html').replace(/<script[\s\S]*?<\/script>/g, ''), code: read('js/forgeeks-profile.js') }
};
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const UID = '11111111-1111-4111-8111-111111111111';
const session = { user: { id: UID, email: 'ada@example.test' } };
const TASKS = 'https://github.com/LightningEg/Lightning/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee';

// ------------------------------------------------------------ the browser harness
// rpc(name, args) answers {data, error}; me is the signed-in member's own row (what FG.me() reads).
async function boot(page, { rpc = () => ({ data: [], error: null }), me = { user_id: UID, display_name: 'Me', avatar_url: null },
  search = '', signedIn = false, noLibrary = false } = {}) {
  const dom = new JSDOM(PAGES[page].html, { runScripts: 'outside-only', url: `https://lightningeg.com/forgeeks-${page}.html${search}` });
  const w = dom.window;
  const calls = [];
  const cbs = [];
  const builder = table => {
    const b = { select() { return b; }, eq() { return b; }, maybeSingle() { return b; },
      then(res, rej) { calls.push({ table }); return Promise.resolve({ data: me, error: null }).then(res, rej); } };
    return b;
  };
  const auth = {
    onAuthStateChange(f) { cbs.push(f); return { data: { subscription: { unsubscribe() {} } } }; },
    signOut: async () => ({ error: null })
  };
  if (!noLibrary) {
    w.supabase = { createClient: () => ({ auth, from: builder,
      rpc: (name, args) => { calls.push({ rpc: name, args }); return Promise.resolve(rpc(name, args)); } }) };
  }
  w.FORGEEKS = { supabaseUrl: 'https://x.supabase.co', anonKey: 'anon' };
  w.eval(authCode);
  w.eval(showCode);
  w.eval(PAGES[page].code);
  const $ = id => w.document.getElementById(id);
  const fire = async (event, s) => { cbs.forEach(f => f(event, s)); await tick(25); };
  const click = async el => { (typeof el === 'string' ? $(el) : el).dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(15); };
  const rpcs = name => calls.filter(c => c.rpc === name);
  await tick(20);
  await fire('INITIAL_SESSION', signedIn ? session : null);
  await tick(20);
  return { w, $, calls, rpcs, fire, click, doc: w.document };
}
const plain = v => JSON.parse(JSON.stringify(v));
const EVIL = '<img src=x onerror=alert(1)>';

// ------------------------------------------------------------ pure helpers
await test('httpsUrl keeps https links and drops everything else', () => {
  assert.equal(S.httpsUrl('https://example.test/a?b=1#c'), 'https://example.test/a?b=1#c');
  for (const bad of ['http://example.test', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', '//example.test', 'ftp://example.test',
    'https://user:pw@example.test', 'https://example.test/a b', 'https://example.test/"onmouseover="x', 'https://', '', null, undefined, 42, {},
    'https://example.test/' + 'a'.repeat(2000), ' https://example.test']) assert.equal(S.httpsUrl(bad), null, String(bad));
});

await test('helpers: initial, profile address, dates, issue address, tags', () => {
  assert.equal(S.initial(' ada'), 'A');
  assert.equal(S.initial(''), '?');
  assert.equal(S.profileHref('Ada L & Co/é'), 'forgeeks-profile.html?u=Ada%20L%20%26%20Co%2F%C3%A9');
  assert.equal(S.num(1234567), '1,234,567');
  assert.equal(S.num('x'), '0');
  assert.equal(S.ymd('2026-10-20T10:00:00+00:00'), '2026-10-20');
  assert.equal(S.ymd(null), '');
  assert.equal(S.issueUrl('LightningEg/Lightning', 12), 'https://github.com/LightningEg/Lightning/issues/12');
  for (const [r, n] of [['LightningEg/Lightning', 0], ['LightningEg/Lightning', 1.5], ['LightningEg/Lightning', null], ['a b/c', 1], ['../x', 1], ['x/..', 1], ['x/.', 1], ['x/y/z', 1], [null, 1]])
    assert.equal(S.issueUrl(r, n), null, `${r} ${n}`);
  const t = S.tags({ setup_editor: 'Neovim', setup_os: 'neovim', setup_languages: ['Python', ' ', 'SQL', 'Rust'], setup_tools: ['git', 'tmux'] }, 4);
  assert.deepEqual(t, ['Neovim', 'Python', 'SQL', 'Rust']);
  assert.deepEqual(S.tags({}, 4), []);
  assert.deepEqual(S.tags({ setup_languages: 'Python', setup_tools: [5, null, 'git'] }, 4), ['git']);
  assert.equal(S.itemId('banner-aurora'), 'banner-aurora');
  for (const bad of ['', 'A', 'x"y', '"><script>', 'a b', 'x'.repeat(61), null]) assert.equal(S.itemId(bad), '', String(bad));
});

// ------------------------------------------------------------ leaderboard
const board = {
  month: [
    { rank: 1, display_name: 'Ada', avatar_url: 'https://example.test/ada.png', contribution_count: 3, score: 1450 },
    { rank: 1, display_name: 'Bo & Co', avatar_url: null, contribution_count: 1, score: 1450 },
    { rank: 3, display_name: 'Cy', avatar_url: null, contribution_count: 2, score: 90 }
  ],
  all: [{ rank: 1, display_name: 'Ada', avatar_url: null, contribution_count: 40, score: 12345 }]
};
const member = (name, extra = {}) => ({ display_name: name, avatar_url: null, bio: null, setup_editor: null, setup_os: null,
  setup_languages: null, setup_tools: null, contribution_score: null, banner_item_id: null, ...extra });
const lbRpc = ({ boards = board, members = [member('Ada')] } = {}) => (name, args) => {
  if (name === 'leaderboard') return { data: boards[args.p_period] ?? [], error: null };
  if (name === 'member_directory') return { data: members.slice(args.p_offset, args.p_offset + args.p_limit), error: null };
  return { data: null, error: { message: 'unexpected ' + name } };
};

await test('leaderboard: signed out, it asks for this month and shows ranked rows with links, shared ranks and figures', async () => {
  const p = await boot('leaderboard', { rpc: lbRpc() });
  assert.deepEqual(plain(p.rpcs('leaderboard').map(c => c.args)), [{ p_period: 'month', p_limit: 50 }]);
  assert.equal(p.w.FG.session(), null);
  const rows = [...p.doc.querySelectorAll('#lb-list .lb-row')];
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.querySelector('.rk').textContent), ['1', '1', '3']);
  assert.deepEqual(rows.map(r => r.querySelector('.nm').textContent), ['Ada', 'Bo & Co', 'Cy']);
  assert.deepEqual(rows.map(r => r.querySelector('.nm').getAttribute('href')),
    ['forgeeks-profile.html?u=Ada', 'forgeeks-profile.html?u=Bo%20%26%20Co', 'forgeeks-profile.html?u=Cy']);
  assert.equal(rows[0].querySelector('.sc').textContent, '1,450');
  assert.equal(rows[0].querySelector('.ct').textContent, '3');
  assert.equal(rows[1].querySelector('.ct').textContent, '1');
  assert.deepEqual([...p.doc.querySelectorAll('#lb-list thead th')].map(t => t.textContent), ['rank', 'member', 'contributions', 'score']);
  assert.equal(p.doc.querySelectorAll('#lb-list .av, #lb-list img, #lb-list .fg-badge').length, 0, 'only the display name: no avatar or badge');
  assert.equal(p.doc.querySelectorAll('#lb-list .lb-bg').length, 0, 'no banner, no background');
  assert.equal(p.$('lb-sample').hidden, true);
  assert.equal(p.$('lb-list').hidden, false);
  assert.equal(p.$('lb-empty').hidden, true);
  assert.equal(p.$('lb-status').hidden, true);
  assert.match(p.doc.querySelector('.lb-note').textContent, /Cairo time/);
  assert.equal(p.$('tab-month').getAttribute('aria-selected'), 'true');
});

await test('leaderboard: a coder advertises their GitHub, last merge, merges this month and portfolio, with checked links and text only', async () => {
  const boards = { month: [
    { rank: 1, display_name: 'Ada', contribution_count: 3, score: 1450, github_login: 'ada-codes', last_merge_title: 'Round money once <b>bold</b>',
      last_merge_url: 'https://github.com/LightningEg/Lightning/pull/12', merges_month: 3, portfolio_url: 'https://ada.example.test/' },
    { rank: 2, display_name: 'One', contribution_count: 1, score: 20, github_login: 'one', last_merge_title: 'Single', last_merge_url: 'https://github.com/x/y/pull/1', merges_month: 1, portfolio_url: null },
    { rank: 3, display_name: 'Evil', contribution_count: 1, score: 10, github_login: 'bad login"><img>', last_merge_title: 'Click me', last_merge_url: 'javascript:alert(1)', merges_month: 0, portfolio_url: 'http://insecure.test' },
    { rank: 4, display_name: 'Plain', contribution_count: 1, score: 5, github_login: null, last_merge_title: null, last_merge_url: null, merges_month: 0, portfolio_url: null }
  ], all: [] };
  const p = await boot('leaderboard', { rpc: lbRpc({ boards }) });
  const rows = [...p.doc.querySelectorAll('#lb-list .lb-row')];
  const ada = rows[0].querySelector('.lb-coder');
  const links = [...ada.querySelectorAll('a')];
  assert.deepEqual(links.map(a => a.getAttribute('href')), ['https://github.com/ada-codes', 'https://github.com/LightningEg/Lightning/pull/12', 'https://ada.example.test/']);
  assert.ok(links.every(a => a.getAttribute('rel') === 'noopener nofollow ugc'));
  assert.equal(links[0].textContent, '@ada-codes');
  assert.equal(links[1].textContent, 'Round money once <b>bold</b>', 'member text is text, never markup');
  assert.equal(ada.querySelector('b'), null);
  assert.match(ada.textContent, /3 merges this month/);
  assert.match(rows[1].querySelector('.lb-coder').textContent, /1 merge this month/);
  assert.doesNotMatch(rows[1].querySelector('.lb-coder').textContent, /merges/);
  const evil = rows[2].querySelector('.lb-coder');
  assert.equal(evil, null, 'a login that is not a GitHub login, a non-https link and no merges this month: nothing is shown');
  assert.equal(rows[2].querySelector('img'), null);
  assert.equal(rows[3].querySelector('.lb-coder'), null, 'a member with nothing to advertise gets no empty line');
  // the main site's own leaderboard page carries the same table the script fills
  const main = read('leaderboard.html');
  for (const id of ['lb-list', 'lb-body', 'lb-panel', 'tab-month']) assert.ok(main.includes('id="' + id + '"'), id);
  assert.ok(main.includes('js/forgeeks-leaderboard.js'));
});

await test('leaderboard: ?sample fills the table with made-up people, says so, and never asks the server for the board', async () => {
  const p = await boot('leaderboard', { rpc: lbRpc(), search: '?sample' });
  assert.equal(p.rpcs('leaderboard').length, 0);
  assert.equal(p.$('lb-sample').hidden, false);
  assert.match(p.$('lb-sample').textContent, /Nobody here is real/);
  const rows = [...p.doc.querySelectorAll('#lb-list .lb-row')];
  assert.equal(rows.length, 14);
  assert.equal(rows[0].querySelector('.lb-bg').getAttribute('data-item'), 'banner-dusk', 'each row carries its banner behind it');
  assert.ok(rows[0].classList.contains('has-banner') && rows[0].querySelector('.lb-veil'));
  assert.equal(rows[2].querySelector('.lb-bg'), null);
  assert.equal(p.doc.querySelectorAll('#lb-list a').length, 0, 'sample names link nowhere');
  const scores = rows.map(r => Number(r.querySelector('.sc').textContent.replace(/,/g, '')));
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  rows.forEach((r, i) => { if (i && scores[i] === scores[i - 1]) assert.equal(r.querySelector('.rk').textContent, rows[i - 1].querySelector('.rk').textContent); });
  await p.click('tab-all');
  assert.equal(p.doc.querySelectorAll('#lb-list .lb-row').length, 24);
  assert.equal(p.rpcs('leaderboard').length, 0);
});

await test('leaderboard: the tabs call leaderboard for month and all, keep state, and work by keyboard', async () => {
  const p = await boot('leaderboard', { rpc: lbRpc() });
  await p.click('tab-all');
  assert.deepEqual(plain(p.rpcs('leaderboard').map(c => c.args.p_period)), ['month', 'all']);
  assert.equal(p.$('tab-all').getAttribute('aria-selected'), 'true');
  assert.equal(p.$('tab-month').getAttribute('aria-selected'), 'false');
  assert.equal(p.$('tab-all').tabIndex, 0);
  assert.equal(p.$('tab-month').tabIndex, -1);
  assert.equal(p.$('lb-panel').getAttribute('aria-labelledby'), 'tab-all');
  assert.deepEqual([...p.doc.querySelectorAll('.lb-row .sc')].map(e => e.textContent), ['12,345']);
  await p.click('tab-month');
  assert.equal(p.doc.querySelectorAll('.lb-row').length, 3);
  p.$('lb-tabs').dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  await tick(15);
  assert.equal(p.$('tab-all').getAttribute('aria-selected'), 'true');
  assert.equal(p.w.document.activeElement, p.$('tab-all'));
  p.$('lb-tabs').dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
  await tick(15);
  assert.equal(p.$('tab-month').getAttribute('aria-selected'), 'true');
});

await test('leaderboard: empty state sends people to pick a task, and says which period is empty', async () => {
  const p = await boot('leaderboard', { rpc: lbRpc({ boards: {}, members: [] }) });
  assert.equal(p.$('lb-empty').hidden, false);
  assert.equal(p.$('lb-list').hidden, true);
  assert.match(p.$('lb-empty-title').textContent, /this month/);
  const hrefs = [...p.$('lb-empty').querySelectorAll('a')].map(a => a.getAttribute('href'));
  assert.deepEqual(hrefs, [TASKS, 'forgeeks-guide.html']);
  assert.equal(p.$('lb-empty').querySelector('a').rel, 'noopener');
  await p.click('tab-all');
  assert.doesNotMatch(p.$('lb-empty-title').textContent, /this month/);
  assert.equal(p.$('lb-empty').hidden, false);
  assert.equal(p.$('mem-status').textContent, 'No profiles are shown yet.');
});

await test('leaderboard: a failed load says so and the retry asks again', async () => {
  let fail = true;
  const p = await boot('leaderboard', { rpc: (n, a) => n === 'leaderboard' && fail ? { data: null, error: { message: 'boom internals' } } : lbRpc()(n, a) });
  assert.equal(p.$('lb-status').textContent, 'The leaderboard did not load. Try again.');
  assert.doesNotMatch(p.doc.body.textContent, /boom internals/);
  assert.equal(p.$('lb-retry').hidden, false);
  fail = false;
  await p.click('lb-retry');
  assert.equal(p.doc.querySelectorAll('.lb-row').length, 3);
  assert.equal(p.$('lb-retry').hidden, true);
});

await test('leaderboard: member text, avatar links and banner ids cannot inject markup', async () => {
  const members = [
    member(EVIL, { bio: EVIL, setup_editor: EVIL, setup_os: '<script>alert(1)</script>', avatar_url: 'javascript:alert(1)', banner_item_id: '"><script>alert(1)</script>' }),
    member('Plain', { avatar_url: 'http://example.test/a.png', banner_item_id: 'banner-aurora' }),
    member('Pic', { avatar_url: 'https://example.test/pic.png' })
  ];
  const boards = { month: [{ rank: 1, display_name: EVIL, avatar_url: 'javascript:alert(1)', contribution_count: 1, score: 5, banner_item_id: '"><script>alert(1)</script>' }] };
  const p = await boot('leaderboard', { rpc: lbRpc({ boards, members }) });
  const main = p.doc.getElementById('main');
  assert.equal(main.querySelectorAll('script').length, 0);
  assert.equal(main.querySelectorAll('[onerror]').length, 0);
  assert.equal(p.doc.querySelector('.lb-row .nm').textContent, EVIL);
  assert.equal(p.doc.querySelector('.lb-row .lb-bg'), null, 'a malformed banner id draws nothing');
  const cards = [...p.doc.querySelectorAll('.mc')];
  assert.equal(cards.length, 3);
  assert.equal(cards[0].querySelector('.mc-name a').textContent, EVIL);
  assert.equal(cards[0].querySelector('.mc-bio').textContent, EVIL);
  assert.equal(cards[0].querySelector('img'), null);
  assert.equal(cards[0].querySelector('.fg-banner').hasAttribute('data-item'), false);
  assert.equal(cards[1].querySelector('img'), null, 'http avatar dropped');
  assert.equal(cards[1].querySelector('.av').textContent, 'P');
  assert.equal(cards[1].querySelector('.fg-banner').getAttribute('data-item'), 'banner-aurora');
  assert.equal(cards[1].querySelector('.fg-banner').getAttribute('aria-hidden'), 'true');
  const img = cards[2].querySelector('.av img');
  assert.equal(img.getAttribute('src'), 'https://example.test/pic.png');
  assert.equal(img.getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(img.getAttribute('loading'), 'lazy');
  img.dispatchEvent(new p.w.Event('error'));
  assert.equal(cards[2].querySelector('.av img'), null);
  assert.equal(cards[2].querySelector('.av').textContent, 'P');
});

await test('leaderboard: member cards show banner, avatar, name, one-line bio, up to 4 setup tags and score, linked to the profile', async () => {
  const members = [member('Ada', { bio: 'I build budgets.', setup_editor: 'Neovim', setup_os: 'Arch Linux', setup_languages: ['Python', 'SQL'], setup_tools: ['git'],
    contribution_score: 1450, banner_item_id: 'banner-aurora' }), member('Quiet')];
  const p = await boot('leaderboard', { rpc: lbRpc({ members }) });
  const [a, q] = [...p.doc.querySelectorAll('.mc')];
  assert.deepEqual([...a.querySelectorAll('.mc-tags li')].map(l => l.textContent), ['Neovim', 'Arch Linux', 'Python', 'SQL']);
  assert.equal(a.querySelector('.mc-sc').textContent, '1,450 score');
  assert.equal(a.querySelector('.mc-bio').textContent, 'I build budgets.');
  assert.equal(a.querySelector('.mc-name a').getAttribute('href'), 'forgeeks-profile.html?u=Ada');
  assert.equal(a.querySelector('.fg-banner').getAttribute('data-item'), 'banner-aurora');
  assert.equal(a.querySelector('.av').textContent, 'A');
  assert.equal(q.querySelector('.mc-sc'), null);
  assert.equal(q.querySelector('.mc-bio'), null);
  assert.equal(q.querySelector('.mc-tags'), null);
  assert.deepEqual(plain(p.rpcs('member_directory').map(c => c.args)), [{ p_limit: 24, p_offset: 0 }]);
  assert.match(p.$('members').textContent, /account/);
  assert.equal(p.$('members').querySelector('.lb-how a').getAttribute('href'), 'forgeeks-account.html');
  assert.equal(p.$('mem-more').hidden, true);
});

await test('leaderboard: show more asks for the next page; signing in or out asks for the directory again', async () => {
  const many = Array.from({ length: 30 }, (_, i) => member('Member ' + String(i).padStart(2, '0')));
  const p = await boot('leaderboard', { rpc: lbRpc({ members: many }) });
  assert.equal(p.doc.querySelectorAll('.mc').length, 24);
  assert.equal(p.$('mem-more').hidden, false);
  await p.click('mem-more');
  assert.deepEqual(plain(p.rpcs('member_directory').map(c => c.args.p_offset)), [0, 24]);
  assert.equal(p.doc.querySelectorAll('.mc').length, 30);
  assert.equal(p.$('mem-more').hidden, true);
  await p.fire('SIGNED_IN', session);
  assert.equal(p.rpcs('member_directory').length, 3);
  assert.equal(p.doc.querySelectorAll('.mc').length, 24);
  await p.fire('TOKEN_REFRESHED', session);
  assert.equal(p.rpcs('member_directory').length, 3);
  assert.equal(p.rpcs('leaderboard').length, 1, 'the public board is not asked again');
});

await test('leaderboard: if the client library is missing the page says so', async () => {
  const p = await boot('leaderboard', { noLibrary: true });
  assert.match(p.$('lb-status').textContent, /not available/);
  assert.match(p.$('mem-status').textContent, /not available/);
});

// ------------------------------------------------------------ profile
const full = {
  display_name: 'Ada', avatar_url: 'https://example.test/ada.png', bio: 'I build budgets.\nAnd tests.', visibility: 'public',
  setup_editor: 'Neovim', setup_os: 'Arch Linux', setup_languages: ['Python', 'SQL'], setup_tools: ['git', 'tmux'], setup_notes: 'Dotfiles are boring.',
  dotfiles_url: 'https://example.test/dots', portfolio_url: 'https://ada.example.test/', contribution_score: 1450, banner_item_id: 'banner-aurora',
  rank_all: 2, rank_month: 1
};
const workRows = [
  { display_name: 'Ada', repository: 'LightningEg/Lightning', issue_number: 12, pr_number: 112, title: 'Round money once',
    url: 'https://github.com/LightningEg/Lightning/pull/112', merged_at: '2026-10-20T10:00:00+00:00', verified: true },
  { display_name: 'Ada', repository: null, issue_number: null, pr_number: null, title: 'My CLI tool', url: 'https://tools.example.test/cli', merged_at: null, verified: false }
];
const pfRpc = ({ profile = full, work = workRows, extra = () => null } = {}) => (name, args) => {
  const x = extra(name, args);
  if (x) return x;
  if (name === 'get_profile') return { data: profile ? [profile] : [], error: null };
  if (name === 'get_profile_work') return { data: work, error: null };
  if (name === 'report_profile') return { data: null, error: null };
  return { data: null, error: { message: 'unexpected ' + name } };
};

await test('profile: renders banner, avatar, name, bio, rank chips, work (verified and self-reported) and setup; the title follows the name', async () => {
  const p = await boot('profile', { rpc: pfRpc(), search: '?u=ada' });
  assert.deepEqual(plain(p.rpcs('get_profile').map(c => c.args)), [{ p_name: 'ada' }]);
  assert.deepEqual(plain(p.rpcs('get_profile_work').map(c => c.args)), [{ p_name: 'Ada' }], 'asks with the stored spelling');
  assert.equal(p.doc.title, 'Ada · For Geeks · Lightning');
  assert.equal(p.doc.querySelector('h1').textContent, 'Ada');
  assert.equal(p.$('pf-bio').textContent, 'I build budgets.\nAnd tests.');
  assert.equal(p.$('pf-banner').hidden, false);
  assert.equal(p.$('pf-banner').getAttribute('data-item'), 'banner-aurora');
  assert.equal(p.$('pf-banner').className, 'fg-banner');
  assert.equal(p.$('pf-av').querySelector('img').getAttribute('src'), 'https://example.test/ada.png');
  assert.deepEqual([...p.$('pf-ranks').children].map(l => l.textContent), ['rank 1 this month', 'rank 2 all time', '1,450 score']);

  const [v, s] = [...p.$('pf-work').children];
  assert.equal(v.querySelector('.tag').textContent, 'verified');
  const links = [...v.querySelectorAll('a')];
  assert.deepEqual(links.map(a => [a.textContent, a.getAttribute('href')]), [
    ['Round money once', 'https://github.com/LightningEg/Lightning/pull/112'],
    ['pr #112', 'https://github.com/LightningEg/Lightning/pull/112'],
    ['issue #12', 'https://github.com/LightningEg/Lightning/issues/12']]);
  assert.ok(links.every(a => a.rel === 'noopener noreferrer' && a.target === '_blank'));
  assert.match(v.querySelector('.m').textContent, /LightningEg\/Lightning · pr #112 · issue #12 · merged 2026-10-20/);
  assert.equal(s.querySelector('.tag').textContent, 'self-reported');
  assert.equal(s.querySelector('a').textContent, 'My CLI tool');
  assert.equal(s.querySelector('.m').textContent, 'tools.example.test');

  const dl = p.$('pf-setup');
  assert.deepEqual([...dl.querySelectorAll('dt')].map(e => e.textContent), ['editor', 'system', 'languages', 'tools', 'notes', 'dotfiles', 'portfolio']);
  assert.deepEqual([...dl.querySelectorAll('dd')].map(e => e.textContent),
    ['Neovim', 'Arch Linux', 'Python, SQL', 'git, tmux', 'Dotfiles are boring.', 'example.test ↗', 'ada.example.test ↗']);
  const dd = [...dl.querySelectorAll('dd a')];
  assert.deepEqual(dd.map(a => a.getAttribute('href')), ['https://example.test/dots', 'https://ada.example.test/']);
  assert.ok(dd.every(a => a.rel === 'noopener noreferrer' && a.target === '_blank'));
  assert.equal(p.$('pf-status').hidden, true);
  assert.equal(p.$('pf-missing').hidden, true);
});

await test('profile: sections with nothing to show stay hidden; a members-only profile says so', async () => {
  const p = await boot('profile', { rpc: pfRpc({ profile: { ...full, visibility: 'members', setup_editor: null, setup_os: null, setup_languages: null, setup_tools: null,
    setup_notes: null, dotfiles_url: null, portfolio_url: null, bio: null, avatar_url: null, banner_item_id: null, rank_all: null, rank_month: null, contribution_score: null }, work: [] }),
    search: '?u=Ada' });
  assert.equal(p.$('pf-work-sec').hidden, true);
  assert.equal(p.$('pf-setup-sec').hidden, true);
  assert.equal(p.$('pf-bio').hidden, true);
  assert.deepEqual([...p.$('pf-ranks').children].map(l => l.textContent), ['signed-in members only']);
  assert.equal(p.$('pf-banner').hasAttribute('data-item'), false);
  assert.equal(p.$('pf-av').textContent, 'A');
  assert.equal(p.$('pf-av').querySelector('img'), null);
});

await test('profile: member text and links cannot inject markup; javascript:, http: and credentialed links are dropped', async () => {
  const bad = { ...full, display_name: EVIL, bio: EVIL, avatar_url: 'javascript:alert(1)', setup_editor: EVIL, setup_os: '<script>alert(1)</script>',
    setup_languages: [EVIL], setup_tools: ['<b>x</b>'], setup_notes: EVIL, dotfiles_url: 'javascript:alert(1)', portfolio_url: 'http://insecure.test/',
    banner_item_id: '"><script>alert(1)</script>' };
  const work = [
    { display_name: EVIL, repository: 'a b/<script>', issue_number: 5, pr_number: 6, title: EVIL, url: 'javascript:alert(1)', merged_at: '2026-10-01T00:00:00Z', verified: true },
    { display_name: EVIL, repository: null, issue_number: null, pr_number: null, title: EVIL, url: 'https://user:pw@evil.test/x', merged_at: null, verified: false },
    { display_name: EVIL, repository: null, issue_number: null, pr_number: null, title: 'Insecure', url: 'http://insecure.test/', merged_at: null, verified: false },
    { display_name: EVIL, repository: null, issue_number: null, pr_number: null, title: EVIL, url: 'https://ok.example.test/x', merged_at: null, verified: false }
  ];
  const p = await boot('profile', { rpc: pfRpc({ profile: bad, work }), search: '?u=' + encodeURIComponent(EVIL.slice(0, 40)) });
  const main = p.doc.getElementById('main');
  assert.equal(main.querySelectorAll('script').length, 0);
  assert.equal(main.querySelectorAll('[onerror]').length, 0);
  assert.equal(main.querySelectorAll('img').length, 0);
  assert.equal(p.doc.querySelector('h1').textContent, EVIL);
  assert.equal(p.doc.title, EVIL + ' · For Geeks · Lightning');
  assert.equal(p.$('pf-bio').textContent, EVIL);
  assert.equal(p.$('pf-banner').hasAttribute('data-item'), false);
  assert.equal(p.$('pf-av').textContent, '<');
  const dl = p.$('pf-setup');
  assert.deepEqual([...dl.querySelectorAll('dt')].map(e => e.textContent), ['editor', 'system', 'languages', 'tools', 'notes'], 'no dotfiles or portfolio row');
  assert.equal(dl.querySelectorAll('a').length, 0);
  assert.equal(dl.querySelector('dd').textContent, EVIL);
  const rows = [...p.$('pf-work').children];
  assert.equal(rows.length, 4);
  assert.equal(rows[0].querySelector('a'), null, 'javascript: link dropped, title kept as text');
  assert.equal(rows[0].querySelector('.t').textContent, EVIL);
  assert.equal(rows[1].querySelector('a'), null, 'credentialed link dropped');
  assert.equal(rows[2].querySelector('a'), null, 'http link dropped');
  assert.equal(rows[2].querySelector('.t').textContent, 'Insecure');
  assert.equal(rows[3].querySelector('a').textContent, EVIL);
  assert.equal(rows[3].querySelector('a').getAttribute('href'), 'https://ok.example.test/x');
  assert.ok(![...main.querySelectorAll('a')].some(a => /^(javascript|http):/i.test(a.getAttribute('href'))));
});

await test('profile: nothing to show looks the same for missing, private and hidden profiles, and asks for no work', async () => {
  const p = await boot('profile', { rpc: pfRpc({ profile: null }), search: '?u=Nobody' });
  assert.equal(p.doc.querySelector('h1').textContent, 'There is no profile to show here.');
  assert.equal(p.doc.title, 'Profile · For Geeks · Lightning');
  assert.equal(p.$('pf-missing').hidden, false);
  assert.equal(p.$('pf-missing').querySelector('a').getAttribute('href'), 'forgeeks-leaderboard.html');
  assert.equal(p.$('pf-banner').hidden, true);
  assert.equal(p.$('pf-work-sec').hidden, true);
  assert.equal(p.$('pf-actions').hidden, true);
  assert.equal(p.rpcs('get_profile_work').length, 0);
  const same = p.doc.getElementById('main').textContent.replace(/\s+/g, ' ');
  const again = await boot('profile', { rpc: pfRpc({ profile: null }), search: '?u=Private%20Person' });
  assert.equal(again.doc.getElementById('main').textContent.replace(/\s+/g, ' '), same);
});

await test('profile: a missing, too short or too long name asks nothing and shows the same line', async () => {
  for (const search of ['', '?u=', '?u=A', '?u=' + 'x'.repeat(41), '?x=Ada', '?u=%20%20']) {
    const p = await boot('profile', { rpc: pfRpc(), search });
    assert.equal(p.calls.filter(c => c.rpc).length, 0, search);
    assert.equal(p.doc.querySelector('h1').textContent, 'There is no profile to show here.', search);
    assert.equal(p.$('pf-missing').hidden, false);
  }
  const p = await boot('profile', { rpc: pfRpc(), search: '?u=' + 'x'.repeat(40) });
  assert.equal(p.rpcs('get_profile').length, 1, '40 characters is allowed');
});

await test('profile: the name in the address is decoded once and sent as given', async () => {
  const p = await boot('profile', { rpc: pfRpc({ profile: { ...full, display_name: 'Ada L & Co' } }), search: '?u=Ada%20L%20%26%20Co' });
  assert.deepEqual(plain(p.rpcs('get_profile').map(c => c.args)), [{ p_name: 'Ada L & Co' }]);
  assert.equal(p.doc.title, 'Ada L & Co · For Geeks · Lightning');
});

await test('profile: a failed load is not "no profile", and retry asks again', async () => {
  let fail = true;
  const p = await boot('profile', { rpc: (n, a) => fail ? { data: null, error: { message: 'boom internals' } } : pfRpc()(n, a), search: '?u=Ada' });
  assert.equal(p.$('pf-status').textContent, 'The profile did not load. Try again.');
  assert.doesNotMatch(p.doc.body.textContent, /boom internals/);
  assert.equal(p.$('pf-missing').hidden, true);
  fail = false;
  await p.click('pf-retry');
  assert.equal(p.doc.querySelector('h1').textContent, 'Ada');
});

await test('profile: signed out there is no report button and no edit link', async () => {
  const p = await boot('profile', { rpc: pfRpc(), search: '?u=Ada' });
  assert.equal(p.$('pf-report').hidden, true);
  assert.equal(p.$('pf-edit').hidden, true);
  assert.equal(p.$('pf-actions').hidden, true);
});

await test('profile: a signed-in visitor who is not the owner gets the report button, not the edit link', async () => {
  const p = await boot('profile', { rpc: pfRpc(), search: '?u=Ada', signedIn: true });
  assert.equal(p.$('pf-report').hidden, false);
  assert.equal(p.$('pf-edit').hidden, true);
});

await test('profile: the owner gets the edit link, whatever the case of the address, and no report button', async () => {
  const p = await boot('profile', { rpc: pfRpc(), search: '?u=ADA', signedIn: true, me: { user_id: UID, display_name: 'ada', avatar_url: null } });
  assert.equal(p.$('pf-edit').hidden, false);
  assert.equal(p.$('pf-edit').getAttribute('href'), 'forgeeks-account.html');
  assert.equal(p.$('pf-report').hidden, true);
});

await test('profile: signing in on the page brings the report button without a reload', async () => {
  const p = await boot('profile', { rpc: pfRpc(), search: '?u=Ada' });
  assert.equal(p.$('pf-report').hidden, true);
  await p.fire('SIGNED_IN', session);
  await tick(20);
  assert.equal(p.$('pf-report').hidden, false);
  assert.equal(p.rpcs('get_profile').length, 2);
});

await test('profile: report opens a dialog, checks the reason, sends report_profile with the stored name, and thanks the visitor', async () => {
  const p = await boot('profile', { rpc: pfRpc(), search: '?u=ada', signedIn: true });
  await p.click('pf-report');
  assert.ok(p.$('rp').hasAttribute('open'));
  await p.click('rp-send');
  p.$('rp-form').dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(15);
  assert.match(p.$('rp-status').textContent, /1 to 500/);
  assert.equal(p.rpcs('report_profile').length, 0);
  p.$('rp-reason').value = '  Pretends to be staff.  ';
  p.$('rp-reason').dispatchEvent(new p.w.Event('input', { bubbles: true }));
  assert.equal(p.$('rp-count').textContent, '25 / 500');
  p.$('rp-form').dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(20);
  assert.deepEqual(plain(p.rpcs('report_profile').map(c => c.args)), [{ p_name: 'Ada', p_reason: 'Pretends to be staff.' }]);
  assert.equal(p.$('rp-status').textContent, 'Thanks. A moderator will look at it.');
  assert.equal(p.$('rp-send').hidden, true);
  assert.equal(p.$('rp-cancel').textContent, 'close');
  await p.click('rp-cancel');
  assert.equal(p.$('rp').hasAttribute('open'), false);
});

await test('profile: report errors are said in plain words and the visitor can try again', async () => {
  const answers = [{ message: 'you already have an open report for this profile' }, { message: 'too many reports today: at most 10 a day' },
    { message: 'profile not found', code: 'P0002' }, { message: 'secret internal detail xyz', code: 'XX000' }, null];
  let i = 0;
  const p = await boot('profile', { search: '?u=Ada', signedIn: true,
    rpc: pfRpc({ extra: n => n === 'report_profile' ? { data: null, error: answers[i++] } : null }) });
  await p.click('pf-report');
  const say = [];
  for (let k = 0; k < 5; k++) {
    p.$('rp-reason').value = 'Spam links';
    p.$('rp-form').dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
    await tick(20);
    say.push(p.$('rp-status').textContent);
    if (k < 4) assert.equal(p.$('rp-send').disabled, false);
  }
  assert.match(say[0], /already reported/);
  assert.match(say[1], /limit of 10/);
  assert.match(say[2], /no longer shown/);
  assert.equal(say[3], 'Something went wrong. Try again.');
  assert.doesNotMatch(say.join(' '), /xyz/);
  assert.match(say[4], /Thanks/);
});

await test('profile: reopening the report dialog starts empty', async () => {
  const p = await boot('profile', { rpc: pfRpc(), search: '?u=Ada', signedIn: true });
  await p.click('pf-report');
  p.$('rp-reason').value = 'first';
  await p.click('rp-cancel');
  await p.click('pf-report');
  assert.equal(p.$('rp-reason').value, '');
  assert.equal(p.$('rp-status').textContent, '');
});

await test('profile: if the client library is missing the page says so', async () => {
  const p = await boot('profile', { noLibrary: true, search: '?u=Ada' });
  assert.match(p.$('pf-status').textContent, /not available/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
