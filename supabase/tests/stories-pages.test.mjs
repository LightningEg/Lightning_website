// The stories page (8R): one form, the code before the post, my posts, the owner's one-row review and ladder, and the
// "How people use Lightning" strip on Guides and the topic pages in English and Arabic. jsdom with the real scripts and a
// fake Supabase client.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/stories-pages.test.mjs

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
const plain = v => JSON.parse(JSON.stringify(v));
const UID = '33333333-3333-4333-8333-333333333333';
const CODE = 'a1b2c3d4';
const KIT = { code: CODE, link: 'https://lightningeg.com/', text: 'Lightning verification: ' + CODE + '\nhttps://lightningeg.com/' };
const FEED = [{ id: 's1', title: 'How Mona uses Lightning', summary: 'Envelopes every Friday.', author: 'Mona', avatar_url: null, linkedin_url: 'https://www.linkedin.com/posts/mona-1', reddit_url: null, rewarded: true, published_at: '2026-10-20T10:00:00Z', frame_item_id: null, badge_item_id: null }];
const authCode = read('js/forgeeks-auth.js');
const scripts = ['js/forgeeks-showcase.js', 'js/story-card.js', 'js/story-moderation.js', 'js/community-stories.js'].map(read);

async function boot({ signedIn = true, admin = false, mine = [], pending = [], ladder = { coins: 100, points: 50 }, failShare = null } = {}) {
  const dom = new JSDOM(strip(read('stories.html')), { runScripts: 'outside-only', url: 'https://lightningeg.com/stories.html', virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const w = dom.window, calls = [];
  w.Element.prototype.scrollIntoView = function () {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const session = signedIn ? { user: { id: UID, email: 'mona@example.test' } } : null;
  const thenable = v => ({ then: (a, b) => Promise.resolve(v).then(a, b) });
  const rpc = (name, args) => {
    calls.push({ fn: name, args });
    if (name === 'stories_feed') return thenable({ data: FEED, error: null });
    if (name === 'story_kit') return thenable({ data: KIT, error: null });
    if (name === 'is_admin') return thenable({ data: admin, error: null });
    if (name === 'admin_story_ladder') return thenable({ data: ladder, error: null });
    if (name === 'share_story' && failShare) return thenable({ data: null, error: { message: failShare } });
    return thenable({ data: {}, error: null });
  };
  const from = table => {
    const q = { eqs: {} };
    const b = { select() { return b; }, eq(k, v) { q.eqs[k] = v; return b; }, order() { return b; },
      then(res, rej) { return Promise.resolve({ data: table === 'community_stories' ? (q.eqs.status === 'pending' ? pending : mine) : [], error: null }).then(res, rej); } };
    return b;
  };
  const client = { rpc, from, auth: { onAuthStateChange(f) { setTimeout(() => f('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => ({ error: null }) } };
  w.supabase = { createClient: () => client };
  w.FORGEEKS = { supabaseUrl: 'https://x.supabase.co', anonKey: 'anon' };
  w.eval(authCode); scripts.forEach(c => w.eval(c));
  await tick(80);
  const $ = id => w.document.getElementById(id);
  const click = async el => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(40); };
  const submit = async f => { f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(60); };
  const rpcs = n => calls.filter(c => c.fn === n);
  const button = (root, text) => [...root.querySelectorAll('button')].find(b => b.textContent.startsWith(text));
  return { w, $, click, submit, rpcs, calls, button };
}

await test('signed out: the stories are shown, the share form is not', async () => {
  const p = await boot({ signedIn: false });
  assert.equal(p.$('story-feed').querySelectorAll('.story-card').length, 1);
  assert.equal(p.$('story-member').hidden, true);
  assert.equal(p.rpcs('story_kit').length, 0);
});

await test('one story form sends link, title, excerpt and author without asking for post additions',async()=>{
 const p=await boot();const f=p.$('story-form');
 assert.equal(p.rpcs('story_kit').length,0);
 assert.deepEqual([...f.elements].map(e=>e.name).filter(Boolean),['id','title','author','url','line','consent']);
 f.elements.title.value='My Friday budget';f.elements.author.value='Mona';f.elements.url.value='https://www.linkedin.com/posts/mona-2';f.elements.line.value='I keep a budget in envelopes and check it each Friday.';f.elements.consent.checked=true;
 await p.submit(f);
 assert.deepEqual(plain(p.rpcs('share_story')[0].args),{p_url:'https://www.linkedin.com/posts/mona-2',p_line:'I keep a budget in envelopes and check it each Friday.',p_consent:true,p_id:null,p_title:'My Friday budget',p_author:'Mona'});
 assert.equal(f.elements.url.value,'');
});
await test('invalid story source returns the server refusal without claiming verification',async()=>{
 const p=await boot({failShare:'paste the link to your own LinkedIn or Reddit post'});const f=p.$('story-form');
 f.elements.title.value='My Friday budget';f.elements.author.value='Mona';f.elements.url.value='https://evil.example/x';f.elements.line.value='I keep a budget in envelopes and check it each Friday.';f.elements.consent.checked=true;await p.submit(f);
 assert.equal(p.$('story-status').textContent,'Paste the link to your own LinkedIn or Reddit post.');
});
await test('my posts: status, the reviewer\'s note, edit and share again with the same story, withdraw', async () => {
  const mine = [
    { id: 'm1', status: 'draft', title:'My envelopes',submitted_author_name:'Mona',review_note: 'Please clarify your excerpt.', body: 'Envelopes.', linkedin_url: 'https://www.linkedin.com/posts/m1', reddit_url: null, awarded_coins: 0, awarded_points: 0 },
    { id: 'm2', status: 'pending', review_note: null, body: 'Waiting.', linkedin_url: null, reddit_url: 'https://www.reddit.com/r/Egypt/comments/abc/x', awarded_coins: 0, awarded_points: 0 },
    { id: 'm3', status: 'published', review_note: null, body: 'Live.', linkedin_url: 'https://www.linkedin.com/posts/m3', reddit_url: null, awarded_coins: 100, awarded_points: 50 },
    { id: 'm4', status: 'draft', review_note: null, body: 'Internal old draft.', linkedin_url: null, reddit_url: null, awarded_coins: 0, awarded_points: 0 }
  ];
  const p = await boot({ mine });
  const cards = [...p.$('story-mine').querySelectorAll('article')];
  assert.equal(cards.length, 3, 'an internal draft with no note is not listed');
  assert.deepEqual(cards.map(c => c.querySelector('h3').textContent), ['Needs a change', 'Waiting for review', 'Published']);
  assert.match(cards[0].textContent, /Note from the reviewer: Please clarify your excerpt\./);
  assert.match(cards[2].textContent, /Earned 100 coins and 50 points/);
  await p.click(p.button(cards[0], 'Edit and share again'));
  const f = p.$('story-form');
  assert.equal(f.elements.id.value, 'm1');
  assert.equal(f.elements.url.value, 'https://www.linkedin.com/posts/m1');
  assert.equal(f.elements.line.value, 'Envelopes.');
  f.elements.consent.checked = true;
  await p.submit(f);
  assert.equal(p.rpcs('share_story')[0].args.p_id, 'm1');
  await p.click(p.button(cards[1], 'Withdraw'));
  assert.equal(p.rpcs('withdraw_story')[0].args.p_id, 'm2');
});

await test('the owner\'s row: Open post, Approve at the ladder, Ask for a change, Decline; links are https only', async () => {
  const pending = [
    { id: 'q1', title: 'How Sam uses Lightning', body: 'Budget by envelope.', author: 'Sam', verify_code: 'deadbeef', submission_revision: 7, linkedin_url: 'https://www.linkedin.com/posts/sam-1', reddit_url: null, user_id: 'u9', member_suspended: false },
    { id: 'q2', title: 'How Eve uses Lightning', body: 'Evil.', author: 'Eve', verify_code: 'cafebabe', submission_revision: 1, linkedin_url: 'javascript:alert(1)', reddit_url: null, user_id: 'u8', member_suspended: false }
  ];
  const p = await boot({ admin: true, pending, ladder: { coins: 120, points: 60 } });
  assert.equal(p.$('story-review').hidden, false);
  assert.equal(p.$('story-ladder'), null, 'the ladder editor moved to the owner console (8S)');
  const rows = [...p.$('story-queue').querySelectorAll('.story-row')];
  assert.equal(rows.length, 2);
  const open = rows[0].querySelector('a');
  assert.equal(open.textContent, 'Open the LinkedIn post');
  assert.equal(open.getAttribute('href'), 'https://www.linkedin.com/posts/sam-1');
  assert.equal(open.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(rows[1].querySelector('a'), null, 'a link that is not a LinkedIn or Reddit post is not made');
  assert.match(rows[0].textContent, /Name on the post: Sam/);
  const approve = p.button(rows[0], 'Approve');
  assert.equal(approve.textContent, 'Approve · 120 coins + 60 points');
  await p.click(approve);
  assert.equal(p.rpcs('admin_approve_story').length, 0, 'not before the post is confirmed');
  assert.match(rows[0].querySelector('[role=status]').textContent, /confirm/);
  rows[0].querySelector('input[type=checkbox]').checked = true;
  await p.click(approve);
  assert.deepEqual(plain(p.rpcs('admin_approve_story')[0].args), { p_id: 'q1', p_expected_revision: 7, p_note: null });
  // ask for a change needs a note; decline too
  const p2 = await boot({ admin: true, pending });
  const r2 = p2.$('story-queue').querySelector('.story-row');
  await p2.click(p2.button(r2, 'Ask for a change'));
  assert.equal(p2.rpcs('admin_request_story_change').length, 0);
  r2.querySelector('textarea').value = 'Add your code to the post.';
  await p2.click(p2.button(r2, 'Ask for a change'));
  assert.deepEqual(plain(p2.rpcs('admin_request_story_change')[0].args), { p_id: 'q1', p_note: 'Add your code to the post.' });
  await p2.click(p2.button(r2, 'Decline'));
  const d = p2.rpcs('admin_moderate_story')[0].args;
  assert.deepEqual([d.p_id, d.p_publish, d.p_points, d.p_coins, d.p_expected_revision], ['q1', false, 0, 0, 7]);
  assert.equal(d.p_note, 'Add your code to the post.');
});

// Changed on purpose (8S): the reward ladder is edited in the owner console's Community view, not on this page.
await test('the stories page has no ladder editor; a member sees no review queue', async () => {
  const p = await boot({ admin: true });
  assert.equal(p.$('story-ladder'), null);
  assert.equal(p.rpcs('admin_set_story_ladder').length, 0);
  const m = await boot({ admin: false });
  assert.equal(m.$('story-review').hidden, true);
  assert.equal(m.rpcs('admin_story_ladder').length, 0);
});

// ---- the strip on Guides and each topic page
const PAGES = ['guides', 'budget-your-salary', 'see-where-your-money-goes', 'know-what-you-own', 'your-data-and-devices'];
for (const lang of ['en', 'ar']) {
  await test(`the How people use Lightning strip is on Guides and every topic page (${lang})`, async () => {
    for (const page of PAGES) {
      const html = read((lang === 'ar' ? 'ar/' : '') + page + '.html');
      assert.match(html, /<section class="d-section story-strip" data-story-strip data-limit="3" hidden/, page);
      const heading = html.match(/<h2 id="strip-title">([^<]*)<\/h2>/)[1];
      if (lang === 'en') assert.equal(heading, 'How people use Lightning', page);
      else assert.match(heading, /^[؀-ۿ ]+$/, page + ': an Arabic heading, no English');
      for (const s of ['story-card.js', 'story-strip.js', 'forgeeks-showcase.js', 'forgeeks-auth.js', 'forgeeks-config.js']) assert.ok(html.includes(s), page + ' ' + s);
      assert.ok(html.includes('site-community.css'), page + ' styles');
    }
  });
}

await test('the strip shows at most 3 approved stories as text, with Arabic labels on an Arabic page, and hides when the call fails', async () => {
  const run = async (lang, feed, fail) => {
    const page = read((lang === 'ar' ? 'ar/' : '') + 'budget-your-salary.html');
    const sec = page.match(/<section class="d-section story-strip"[\s\S]*?<\/section>/)[0];
    const dom = new JSDOM(`<html lang="${lang === 'ar' ? 'ar-EG' : 'en'}"><body>${sec}</body></html>`, { runScripts: 'outside-only', url: 'https://lightningeg.com/budget-your-salary.html' });
    const w = dom.window;
    const calls = [];
    w.FG = { ready: Promise.resolve(), sb: { rpc: (n, a) => { calls.push([n, a]); return fail ? Promise.reject(new Error('x')) : Promise.resolve({ data: feed, error: null }); } } };
    w.eval(read('js/story-card.js')); w.eval(read('js/story-strip.js'));
    await tick(30);
    return { host: w.document.querySelector('[data-story-strip]'), calls };
  };
  const many = Array.from({ length: 5 }, (_, i) => ({ ...FEED[0], id: 's' + i, author: 'A' + i, title: i === 0 ? '<img src=x onerror=alert(1)>' : 'T' + i, summary: 'Summary ' + i }));
  const en = await run('en', many);
  assert.equal(en.calls[0][0], 'stories_feed');
  assert.equal(en.host.querySelectorAll('.story-card').length, 3);
  assert.equal(en.host.hidden, false);
  assert.equal(en.host.querySelector('img'), null, 'member text is text');
  assert.match(en.host.textContent, /Read on LinkedIn/);
  const ar = await run('ar', many.slice(0, 2));
  assert.match(ar.host.textContent, /اقرأ على لينكدإن/);
  assert.doesNotMatch(ar.host.querySelector('.story-foot').textContent, /Read on/);
  const none = await run('en', []);
  assert.equal(none.host.hidden, false);
  assert.equal(none.host.querySelector('[data-story-empty]').hidden, false, 'an invitation instead of an empty box');
  const down = await run('en', [], true);
  assert.equal(down.host.hidden, true, 'the strip hides when stories cannot load');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
