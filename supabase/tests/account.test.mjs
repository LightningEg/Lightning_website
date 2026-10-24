// Tests for the For Geeks account page: its rules, then the page itself with a fake Supabase client.
//
//   npm i --no-save jsdom
//   node supabase/tests/account.test.mjs
//
// The fake client records what the page asks for; nothing here talks to the real project.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const rules = require('../../js/forgeeks-account.js');
const auth = require('../../js/forgeeks-auth.js');
const { JSDOM, VirtualConsole } = process.env.JSDOM_PATH ? await import(pathToFileURL(process.env.JSDOM_PATH).href).then(m => m.default ?? m) : await import('jsdom');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}
const NOW = new Date(Date.UTC(2026, 9, 24));
const base = { display_name: 'Ada', bio: '', avatar_url: '', visibility: 'private', show_work: false, show_setup: false,
  show_on_leaderboard: false, adult_confirmed: false, setup_editor: '', setup_os: '', setup_languages: '', setup_tools: '',
  setup_notes: '', dotfiles_url: '', portfolio_url: '' };

// ------------------------------------------------------------ rules
await test('ageOn counts birthdays exactly and rejects impossible dates', () => {
  assert.equal(rules.ageOn('2008-10-24', NOW), 18);
  assert.equal(rules.ageOn('2008-10-25', NOW), 17);
  assert.equal(rules.ageOn('2010-01-01', NOW), 16);
  assert.equal(rules.ageOn('2026-02-30', NOW), null);
  assert.equal(rules.ageOn('nope', NOW), null);
});

await test('memberUpdate: a private profile with only a name is valid and empty fields become null', () => {
  const r = rules.memberUpdate(base, null, NOW);
  assert.equal(r.error, undefined);
  assert.equal(r.data.bio, null);
  assert.equal(r.data.avatar_url, null);
  assert.equal(r.data.setup_languages, null);
  assert.equal(r.data.visibility, 'private');
});

await test('memberUpdate: names, bio and https-only links are checked', () => {
  assert.match(rules.memberUpdate({ ...base, display_name: 'me@x.test' }, null, NOW).error, /cannot contain/);
  assert.match(rules.memberUpdate({ ...base, display_name: 'A' }, null, NOW).error, /2 to 40/);
  assert.match(rules.memberUpdate({ ...base, bio: 'x'.repeat(501) }, null, NOW).error, /500/);
  assert.match(rules.memberUpdate({ ...base, avatar_url: 'http://x.test/a.png' }, null, NOW).error, /https/);
  assert.match(rules.memberUpdate({ ...base, dotfiles_url: 'javascript:alert(1)' }, null, NOW).error, /https/);
  assert.match(rules.memberUpdate({ ...base, visibility: 'everyone' }, null, NOW).error, /who can see/);
});

await test('memberUpdate: lists are split, trimmed and limited', () => {
  const r = rules.memberUpdate({ ...base, setup_languages: ' Python, SQL ,, Rust ' }, null, NOW);
  assert.deepEqual(r.data.setup_languages, ['Python', 'SQL', 'Rust']);
  const many = Array.from({ length: 21 }, (_, i) => 'x' + i).join(',');
  assert.match(rules.memberUpdate({ ...base, setup_tools: many }, null, NOW).error, /at most 20/);
  assert.match(rules.memberUpdate({ ...base, setup_tools: 'y'.repeat(41) }, null, NOW).error, /40 characters/);
});

await test('memberUpdate: public or leaderboard needs 18+, and under 18 stays private', () => {
  assert.match(rules.memberUpdate({ ...base, visibility: 'public' }, null, NOW).error, /18 or older/);
  assert.match(rules.memberUpdate({ ...base, show_on_leaderboard: true }, null, NOW).error, /18 or older/);
  assert.equal(rules.memberUpdate({ ...base, visibility: 'public', adult_confirmed: true }, null, NOW).error, undefined);
  assert.equal(rules.memberUpdate({ ...base, visibility: 'members' }, null, NOW).error, undefined);
  assert.match(rules.memberUpdate({ ...base, visibility: 'public', adult_confirmed: true }, '2012-05-05', NOW).error, /under 18/);
  assert.match(rules.memberUpdate({ ...base, adult_confirmed: true }, '2012-05-05', NOW).error, /under 18/);
  assert.match(rules.memberUpdate({ ...base, visibility: 'members' }, '2012-05-05', NOW).error, /under 18/);
  assert.equal(rules.memberUpdate(base, '2012-05-05', NOW).error, undefined);
});

await test('privateUpdate: phone and birth date are optional but checked', () => {
  const ok = rules.privateUpdate({ full_name: '', phone: '', birth_date: '', marketing_consent: false }, NOW);
  assert.deepEqual(ok.data, { full_name: null, phone: null, birth_date: null, marketing_consent: false });
  assert.match(rules.privateUpdate({ phone: 'call me' }, NOW).error, /Phone/);
  assert.equal(rules.privateUpdate({ phone: '+20 100 000 0000' }, NOW).error, undefined);
  assert.match(rules.privateUpdate({ birth_date: '31/12/1990' }, NOW).error, /yyyy-mm-dd/);
  assert.match(rules.privateUpdate({ birth_date: '2030-01-01' }, NOW).error, /out of range/);
  assert.match(rules.privateUpdate({ full_name: 'x'.repeat(121) }, NOW).error, /120/);
});

await test('linkUpdate and credentials', () => {
  assert.deepEqual(rules.linkUpdate(' CLI ', 'https://x.test/cli').data, { label: 'CLI', url: 'https://x.test/cli' });
  assert.match(rules.linkUpdate('x', 'http://x.test').error, /https/);
  assert.match(rules.linkUpdate('x', '').error, /https/);
  assert.match(rules.linkUpdate('', 'https://x.test').error, /1 to 60/);
  assert.match(rules.credentials('nope', 'secret123', 'in').error, /valid email/);
  assert.match(rules.credentials('a@b.test', 'short', 'up').error, /8 characters/);
  assert.equal(rules.credentials('a@b.test', '', 'reset').error, undefined);
  assert.equal(rules.credentials('a@b.test', 'x', 'in').error, undefined);
});

await test('say maps database and auth errors to plain words', () => {
  assert.match(rules.say({ message: 'duplicate key value violates unique constraint "member_profiles_display_name_key"' }), /taken/);
  assert.match(rules.say({ message: 'Invalid login credentials' }), /Wrong email or password/);
  assert.match(rules.say({ message: 'Email not confirmed' }), /Confirm your email/);
  assert.match(rules.say({ message: 'new row violates check constraint "public_needs_adult"' }), /18 or older/);
  assert.match(rules.say({ message: 'x', status: 429 }), /Too many/);
  assert.match(rules.say({ message: 'permission denied for table wallets', code: '42501' }), /not allowed/);
  assert.match(rules.say(new Error('Failed to fetch')), /Cannot reach/);
  assert.doesNotMatch(rules.say({ message: 'secret internal detail xyz' }), /xyz/);
  assert.match(rules.say({ message: 'insufficient coins' }), /Not enough coins/);
});

await test('safeNext allows explicit main-site and For Geeks routes, never an account page or another site', () => {
  assert.equal(auth.safeNext('forgeeks-roadmap.html'), 'forgeeks-roadmap.html');
  assert.equal(auth.safeNext('/forgeeks-profile.html?u=Ada%20L#work'), 'forgeeks-profile.html?u=Ada%20L#work');
  for (const bad of ['https://evil.test/forgeeks.html', '//evil.test/x', 'javascript:alert(1)', 'unknown.html', 'account.html', 'forgeeks-account.html',
    'forgeeks-account.html?next=x', 'forgeeks.html"><script>', 'forgeeks.html\nx', '', null, 42]) assert.equal(auth.safeNext(bad), null, String(bad));
  assert.equal(auth.signInHref('/forgeeks-guide.html', '?a=1', '#rules'), 'forgeeks-account.html?next=forgeeks-guide.html%3Fa%3D1%23rules');
  assert.equal(auth.signInHref('/forgeeks-account.html', '', ''), 'forgeeks-account.html');
  assert.equal(auth.safeNext('marketplace.html'), 'marketplace.html');
  assert.equal(auth.signInHref('/index.html', '', ''), 'forgeeks-account.html?next=index.html');
  assert.equal(auth.initial(' ada'), 'A');
  assert.equal(auth.initial(''), '?');
});

// ------------------------------------------------------------ the page, with a fake Supabase client
const html = readFileSync(new URL('../../forgeeks-account.html', import.meta.url), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const code = readFileSync(new URL('../../js/forgeeks-account.js', import.meta.url), 'utf8');
const authCode = readFileSync(new URL('../../js/forgeeks-auth.js', import.meta.url), 'utf8');
const dataCode = readFileSync(new URL('../../js/forgeeks-account-data.js', import.meta.url), 'utf8');
const data = require('../../js/forgeeks-account-data.js');
const UID = '11111111-1111-4111-8111-111111111111';
const plain = v => JSON.parse(JSON.stringify(v)); // objects made inside the simulated browser have their own prototypes
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

async function boot(handle = () => ({ data: null, error: null }), url = 'https://lightningeg.com/forgeeks-account.html') {
  const navs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (/navigation/i.test(e.message)) navs.push(e.message); });
  const dom = new JSDOM(html, { runScripts: 'outside-only', url, virtualConsole: vc });
  const w = dom.window;
  const calls = [];
  const cbs = [];
  const builder = (table) => {
    const q = { table, op: 'select', filters: {}, payload: null };
    const b = {
      select() { return b; }, order() { return b; }, maybeSingle() { return b; },
      eq(k, v) { q.filters[k] = v; return b; },
      update(p) { q.op = 'update'; q.payload = p; return b; },
      insert(p) { q.op = 'insert'; q.payload = p; return b; },
      delete() { q.op = 'delete'; return b; },
      then(res, rej) { calls.push({ ...q }); return Promise.resolve(handle(q)).then(res, rej); }
    };
    return b;
  };
  const auth = {
    onAuthStateChange(f) { cbs.push(f); return { data: { subscription: { unsubscribe() {} } } }; },
    signInWithPassword: async a => { calls.push({ fn: 'signInWithPassword', a }); return auth._in ?? { data: {}, error: null }; },
    signUp: async a => { calls.push({ fn: 'signUp', a }); return { data: { session: null }, error: null }; },
    signInWithOAuth: async a => { calls.push({ fn: 'signInWithOAuth', a }); return { error: null }; },
    resetPasswordForEmail: async (e, o) => { calls.push({ fn: 'reset', e, o }); return { error: null }; },
    updateUser: async a => { calls.push({ fn: 'updateUser', a }); return { error: null }; },
    signOut: async o => { calls.push({ fn: 'signOut', o }); return { error: null }; }
  };
  w.supabase = { createClient: (u, k, o) => { calls.push({ fn: 'createClient', u, k, o }); return { auth, from: builder, rpc: (name, args) => { calls.push({ fn: 'rpc', name, args }); return Promise.resolve(handle({ op: 'rpc', name, args, filters: {} })); } }; } };
  w.FORGEEKS = { supabaseUrl: 'https://x.supabase.co', anonKey: 'anon' };
  w.eval(authCode);
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
  w.eval(code);
  w.eval(dataCode);
  const $ = id => w.document.getElementById(id);
  const fire = async (event, session) => { cbs.forEach(f => f(event, session)); await tick(20); };
  const submit = async id => { $(id).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(20); };
  const click = async id => { $(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await tick(20); };
  const set = (id, v) => { const e = $(id) ?? w.document.querySelector(`[name="${id}"]`); if (e.type === 'checkbox') e.checked = v; else e.value = v; };
  const views = () => ['loading', 'out', 'recover', 'in'].filter(v => !$('view-' + v).hidden);
  await tick(30); // the page starts once the document has finished loading
  return { w, $, calls, fire, submit, click, set, views, navs };
}
const session = { user: { id: UID, email: 'ada@example.test' } };
const account = (extra = {}) => q => {
  const t = {
    profiles: { user_id: UID, full_name: 'Ada L', phone: null, birth_date: null, marketing_consent: false },
    member_profiles: { user_id: UID, display_name: 'geek-1a2b3c4d', bio: null, visibility: 'private', adult_confirmed: false, show_on_leaderboard: false,
      show_work: false, show_setup: false, setup_languages: ['Python', 'SQL'], setup_tools: null },
    profile_links: [{ id: 1, label: 'My CLI', url: 'https://example.test/cli' }],
    wallets: { balance: 90, contribution_score: 150 }
  };
  if (q.op === 'select' && q.table in t) return { data: extra[q.table] ?? t[q.table], error: null };
  return { data: null, error: extra.error?.[q.table + ':' + q.op] ?? null };
};

await test('page: signed out shows only sign in; switching to sign up changes the labels', async () => {
  const p = await boot();
  assert.deepEqual(p.views(), ['loading']);
  await p.fire('INITIAL_SESSION', null);
  assert.deepEqual(p.views(), ['out']);
  assert.equal(p.$('auth-title').textContent, 'sign in');
  await p.click('auth-switch');
  assert.equal(p.$('auth-title').textContent, 'create an account');
  assert.equal(p.$('auth-hint').hidden, false);
  assert.equal(p.$('auth-forgot').hidden, true);
  assert.equal(p.$('auth-password').autocomplete, 'new-password');
  assert.equal(p.calls.filter(c => c.fn === 'createClient').length, 1);
  const cc = p.calls.find(c => c.fn === 'createClient');
  assert.equal(cc.o.auth.persistSession, true);
  assert.equal(cc.o.auth.autoRefreshToken, true);
  assert.equal(cc.o.auth.flowType, 'pkce');
});

await test('page: email sign in validates first, then calls Supabase and explains failures', async () => {
  const p = await boot();
  await p.fire('INITIAL_SESSION', null);
  p.set('auth-email', 'nope'); p.set('auth-password', 'x');
  await p.submit('auth-form');
  assert.match(p.$('acct-msg').textContent, /valid email/);
  assert.equal(p.calls.filter(c => c.fn === 'signInWithPassword').length, 0);
  p.set('auth-email', 'ada@example.test'); p.set('auth-password', 'secret-pass');
  await p.submit('auth-form');
  assert.deepEqual(plain(p.calls.find(c => c.fn === 'signInWithPassword').a), { email: 'ada@example.test', password: 'secret-pass' });
});

await test('page: sign up without a session tells you to check your inbox; Google and reset call the right APIs', async () => {
  const p = await boot();
  await p.fire('INITIAL_SESSION', null);
  await p.click('auth-switch');
  p.set('auth-email', 'new@example.test'); p.set('auth-password', 'longenough1');
  await p.submit('auth-form');
  assert.match(p.$('acct-msg').textContent, /Check your inbox/);
  assert.equal(p.calls.find(c => c.fn === 'signUp').a.options.emailRedirectTo, 'https://lightningeg.com/forgeeks-account.html');
  await p.click('auth-google');
  const g = p.calls.find(c => c.fn === 'signInWithOAuth').a;
  assert.equal(g.provider, 'google');
  assert.equal(g.options.redirectTo, 'https://lightningeg.com/forgeeks-account.html');
  await p.click('auth-switch');
  p.set('auth-email', 'ada@example.test');
  await p.click('auth-forgot');
  assert.equal(p.calls.find(c => c.fn === 'reset').e, 'ada@example.test');
  assert.match(p.$('acct-msg').textContent, /reset link/);
});

await test('page: signed in loads only the member own rows and fills the forms', async () => {
  const p = await boot(account());
  await p.fire('INITIAL_SESSION', session);
  await tick(30);
  assert.deepEqual(p.views(), ['in']);
  const reads = p.calls.filter(c => c.table);
  assert.deepEqual([...new Set(reads.map(c => c.table))].sort(), ['member_profiles', 'profile_links', 'profiles', 'wallets']);
  assert.ok(reads.every(c => c.filters.user_id === UID));
  assert.equal(p.$('display_name').value, 'geek-1a2b3c4d');
  assert.equal(p.$('setup_languages').value, 'Python, SQL');
  assert.equal(p.$('full_name').value, 'Ada L');
  assert.equal(p.$('coins').textContent, '90');
  assert.equal(p.$('score').textContent, '150');
  assert.equal(p.$('who').textContent, 'ada@example.test');
  assert.equal(p.$('links-list').children.length, 1);
});

await test('page: saving the public profile checks the 18+ rule, then sends one update with only the member own columns', async () => {
  const p = await boot(account());
  await p.fire('INITIAL_SESSION', session); await tick(30);
  p.set('visibility', 'public');
  await p.submit('form-public');
  assert.match(p.$('status-public').textContent, /18 or older/);
  assert.equal(p.calls.filter(c => c.op === 'update').length, 0);
  p.set('adult_confirmed', true); p.set('bio', 'I build things'); p.set('setup_editor', 'Neovim'); p.set('show_setup', true);
  await p.submit('form-public');
  const u = p.calls.find(c => c.op === 'update');
  assert.equal(u.table, 'member_profiles');
  assert.equal(u.filters.user_id, UID);
  assert.equal(u.payload.visibility, 'public');
  assert.equal(u.payload.adult_confirmed, true);
  assert.equal(u.payload.setup_editor, 'Neovim');
  assert.equal(u.payload.show_setup, true);
  assert.deepEqual(plain(u.payload.setup_languages), ['Python', 'SQL']);
  assert.ok(!('suspended' in u.payload) && !('user_id' in u.payload));
  assert.equal(p.$('status-public').textContent, 'saved');
});

await test('page: a taken display name is reported in plain words', async () => {
  const err = { message: 'duplicate key value violates unique constraint "member_profiles_display_name_key"', code: '23505' };
  const p = await boot(account({ error: { 'member_profiles:update': err } }));
  await p.fire('INITIAL_SESSION', session); await tick(30);
  p.set('display_name', 'Ada');
  await p.submit('form-public');
  assert.match(p.$('status-public').textContent, /taken/);
  assert.match(p.$('status-public').className, /bad/);
});

await test('page: saving a birth date under 18 then blocks going public', async () => {
  const p = await boot(account());
  await p.fire('INITIAL_SESSION', session); await tick(30);
  p.set('birth_date', '2014-03-03');
  await p.submit('form-private');
  const u = p.calls.find(c => c.table === 'profiles' && c.op === 'update');
  assert.equal(u.payload.birth_date, '2014-03-03');
  p.set('visibility', 'public'); p.set('adult_confirmed', true);
  await p.submit('form-public');
  assert.match(p.$('status-public').textContent, /under 18/);
  assert.equal(p.calls.filter(c => c.table === 'member_profiles' && c.op === 'update').length, 0);
});

await test('page: links reject http, show member text as text only, and can be removed', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const p = await boot(account({ profile_links: [{ id: 7, label: evil, url: 'https://example.test/a' }] }));
  await p.fire('INITIAL_SESSION', session); await tick(30);
  const li = p.$('links-list').children[0];
  assert.equal(li.querySelector('img'), null);
  assert.equal(li.querySelector('a').textContent, evil);
  assert.equal(li.querySelector('a').rel, 'noopener noreferrer');
  p.set('link-label', 'Tool'); p.set('link-url', 'http://insecure.test');
  await p.submit('form-link');
  assert.match(p.$('status-links').textContent, /https/);
  assert.equal(p.calls.filter(c => c.op === 'insert').length, 0);
  p.set('link-url', 'https://example.test/tool');
  await p.submit('form-link');
  const ins = p.calls.find(c => c.op === 'insert');
  assert.deepEqual(plain(ins.payload), { user_id: UID, label: 'Tool', url: 'https://example.test/tool' });
  li.querySelector('button').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true })); await tick(20);
  assert.equal(p.calls.find(c => c.op === 'delete').filters.id, 7);
});

await test('page: coming back to the tab does not reload the form or lose typed text', async () => {
  const p = await boot(account());
  await p.fire('INITIAL_SESSION', session); await tick(30);
  p.set('bio', 'half-written bio');
  const reads = p.calls.length;
  await p.fire('SIGNED_IN', session); await tick(30);
  await p.fire('TOKEN_REFRESHED', session); await tick(30);
  assert.equal(p.$('bio').value, 'half-written bio');
  assert.equal(p.calls.length, reads);
});

await test('page: a reset link shows the new password form and nothing else until it is saved', async () => {
  const p = await boot(account());
  await p.fire('PASSWORD_RECOVERY', session);
  await p.fire('SIGNED_IN', session); await tick(30);
  assert.deepEqual(p.views(), ['recover']);
  p.set('new-password', 'short');
  await p.submit('recover-form');
  assert.match(p.$('acct-msg').textContent, /8 characters/);
  p.set('new-password', 'a-new-long-password');
  await p.submit('recover-form'); await tick(30);
  assert.equal(p.calls.find(c => c.fn === 'updateUser').a.password, 'a-new-long-password');
  assert.deepEqual(p.views(), ['in']);
});

await test('page: sign out returns to the sign in view', async () => {
  const p = await boot(account());
  await p.fire('INITIAL_SESSION', session); await tick(30);
  await p.click('sign-out');
  assert.ok(p.calls.some(c => c.fn === 'signOut'));
  assert.deepEqual(p.views(), ['out']);
});

await test('page: if the client library is missing the page says so instead of failing silently', async () => {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lightningeg.com/forgeeks-account.html' });
  dom.window.FORGEEKS = { supabaseUrl: 'x', anonKey: 'y' };
  dom.window.eval(authCode);
  dom.window.eval(code);
  await tick(30);
  assert.match(dom.window.document.getElementById('acct-msg').textContent, /not available/);
  assert.equal(dom.window.document.getElementById('view-out').hidden, false);
});

await test('top bar: signed out the chip is a sign-in link; signed in it is an account menu that opens, moves and closes by keyboard', async () => {
  const p = await boot(account());
  await p.fire('INITIAL_SESSION', null);
  let me = p.$('me');
  assert.equal(me.tagName, 'A');
  assert.equal(me.textContent, 'sign in');
  assert.equal(me.getAttribute('href'), 'forgeeks-account.html');
  await p.fire('SIGNED_IN', session); await tick(30);
  me = p.$('me');
  const btn = me.querySelector('button.me');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(me.querySelector('.me-name').textContent, 'geek-1a2b3c4d');
  assert.equal(me.querySelector('.me-av').textContent, 'G');
  btn.dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  const menu = p.$('me-menu');
  assert.equal(menu.hidden, false);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  const items = [...menu.querySelectorAll('[role=menuitem]')];
  assert.deepEqual(items.map(i => i.textContent), ['my profile', 'tasks', 'market', 'leaderboard', 'profile settings', 'sign out']);
  assert.equal(items[0].getAttribute('href'), 'forgeeks-profile.html?u=geek-1a2b3c4d');
  assert.equal(items[4].getAttribute('href'), 'forgeeks-account.html');
  assert.equal(p.w.document.activeElement, items[0]);
  menu.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(p.w.document.activeElement, items[1]);
  menu.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(p.w.document.activeElement, items[5]);
  menu.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(menu.hidden, true);
  assert.equal(p.w.document.activeElement, btn);
  btn.dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  p.w.document.body.dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.hidden, true);
});

await test('top bar: member text in the chip is text only; a bad avatar link is ignored', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const p = await boot(account({ member_profiles: { user_id: UID, display_name: evil, avatar_url: 'javascript:alert(1)', visibility: 'private' } }));
  await p.fire('INITIAL_SESSION', session); await tick(30);
  const me = p.$('me');
  assert.equal(me.querySelector('.me-name').textContent, evil);
  assert.equal(me.querySelector('.me-av img'), null);
  assert.equal(me.querySelectorAll('img').length, 0);
});

await test('top bar: sign out from the menu calls Supabase once', async () => {
  const p = await boot(account());
  await p.fire('INITIAL_SESSION', session); await tick(30);
  p.$('me').querySelector('button.me').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  p.$('me-menu').querySelector('.me-out').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  await tick(20);
  assert.equal(p.calls.filter(c => c.fn === 'signOut').length, 1);
});

await test('return to page: ?next is kept, removed from the address bar, and used once after signing in', async () => {
  const p = await boot(account(), 'https://lightningeg.com/forgeeks-account.html?next=forgeeks-roadmap.html%23play');
  assert.equal(p.w.location.search, '');
  assert.equal(p.w.sessionStorage.getItem('lightning-geeks-next'), 'forgeeks-roadmap.html#play');
  await p.fire('INITIAL_SESSION', null);
  assert.equal(p.navs.length, 0);
  await p.fire('SIGNED_IN', session); await tick(30);
  assert.equal(p.w.sessionStorage.getItem('lightning-geeks-next'), null);
  assert.equal(p.navs.length, 1, 'navigated away');
  assert.ok(!p.calls.some(c => c.table === 'profiles'), 'did not load the account it is leaving');
});

await test('return to page: a foreign or account-page next is dropped', async () => {
  for (const bad of ['https%3A%2F%2Fevil.test%2F', 'forgeeks-account.html', 'account.html', 'unknown.html']) {
    const p = await boot(account(), 'https://lightningeg.com/forgeeks-account.html?next=' + bad);
    assert.equal(p.w.sessionStorage.getItem('lightning-geeks-next'), null, bad);
    await p.fire('INITIAL_SESSION', session); await tick(30);
    assert.equal(p.navs.length, 0, bad);
    assert.deepEqual(p.views(), ['in']);
  }
});

await test('saving the profile refreshes the name in the top bar', async () => {
  let name = 'geek-1a2b3c4d';
  const p = await boot(q => {
    if (q.table === 'member_profiles' && q.op === 'select') return { data: { user_id: UID, display_name: name, visibility: 'private' }, error: null };
    if (q.table === 'member_profiles' && q.op === 'update') { name = q.payload.display_name; return { data: null, error: null }; }
    return account()(q);
  });
  await p.fire('INITIAL_SESSION', session); await tick(30);
  p.set('display_name', 'Ada');
  await p.submit('form-public'); await tick(30);
  assert.equal(p.$('me').querySelector('.me-name').textContent, 'Ada');
});

await test('your data: the file name uses the Cairo date and the phrase check is exact', () => {
  assert.equal(data.fileName(Date.UTC(2026, 9, 24, 22, 30)), 'lightning-geeks-data-2026-10-25.json');
  assert.equal(data.confirmed(' Delete my account '), true);
  assert.equal(data.confirmed('delete account'), false);
  assert.equal(data.confirmed(''), false);
});

await test('your data: download asks for your export and says when it is done or why not', async () => {
  const p = await boot(q => q.op === 'rpc' && q.name === 'export_my_data' ? { data: { account: { email: 'ada@example.test' } }, error: null } : account()(q));
  await p.fire('INITIAL_SESSION', session); await tick(30);
  await p.click('data-download');
  assert.equal(p.calls.filter(c => c.fn === 'rpc' && c.name === 'export_my_data').length, 1);
  assert.equal(p.$('status-data').textContent, 'downloaded');
  const q = await boot(r => r.op === 'rpc' ? { data: null, error: { message: 'Failed to fetch' } } : account()(r));
  await q.fire('INITIAL_SESSION', session); await tick(30);
  await q.click('data-download');
  assert.match(q.$('status-data').textContent, /Cannot reach/);
});

await test('your data: delete needs the exact phrase, then deletes, clears this browser and says so', async () => {
  const p = await boot(q => q.op === 'rpc' ? { data: null, error: null } : account()(q));
  await p.fire('INITIAL_SESSION', session); await tick(30);
  p.set('delete-confirm', 'yes please');
  await p.submit('form-delete');
  assert.match(p.$('status-delete').textContent, /delete my account/);
  assert.equal(p.calls.filter(c => c.name === 'delete_my_account').length, 0);
  p.set('delete-confirm', 'delete my account');
  await p.submit('form-delete'); await tick(30);
  const d = p.calls.find(c => c.name === 'delete_my_account');
  assert.deepEqual(plain(d.args), { p_confirm: 'delete my account' });
  assert.deepEqual(plain(p.calls.find(c => c.fn === 'signOut').o), { scope: 'local' });
  assert.match(p.$('acct-msg').textContent, /deleted/);
});

await test('your data: the owner account is refused in plain words', async () => {
  const p = await boot(q => q.op === 'rpc' ? { data: null, error: { message: 'an administrator account cannot be deleted here', code: '42501' } } : account()(q));
  await p.fire('INITIAL_SESSION', session); await tick(30);
  p.set('delete-confirm', 'delete my account');
  await p.submit('form-delete'); await tick(20);
  assert.match(p.$('status-delete').textContent, /owner account/);
  assert.equal(p.calls.filter(c => c.fn === 'signOut').length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
