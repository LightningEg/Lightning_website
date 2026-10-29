// Tests for the rewards pages: the account page's github, activity and feedback panels, the task board and the
// owner's console. Each page runs in jsdom with the real js/forgeeks-auth.js (window.FG) on top of a fake Supabase
// client that records every call; nothing here talks to the real project.
//
//   node supabase/tests/rewards-pages.test.mjs      (JSDOM_PATH=… if jsdom is not installed here)

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = process.env.JSDOM_PATH ? await import(pathToFileURL(process.env.JSDOM_PATH).href).then(m => m.default ?? m) : await import('jsdom');
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 5).join('\n     ')); }
}
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));
const plain = v => JSON.parse(JSON.stringify(v));

const UID = '11111111-1111-4111-8111-111111111111';
const session = { user: { id: UID, email: 'ada@example.test' } };
const XSS = '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>';

const authCode = read('js/forgeeks-auth.js');
const rewardsRules = require('../../js/forgeeks-account-rewards.js');
const tasksRules = require('../../js/forgeeks-tasks.js');
const adminRules = require('../../js/forgeeks-admin.js');

/* A fake Supabase client. `routes` maps 'rpc:name' or 'table:op' to a result or a function of the recorded call. */
async function boot(page, scripts, { routes = {}, url, identities = [], supabase = true } = {}) {
  const html = read(page).replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: url ?? 'https://lightningeg.com/' + page });
  const w = dom.window;
  const calls = [];
  const cbs = [];
  const run = q => {
    calls.push(q);
    const r = routes[q.kind === 'rpc' ? 'rpc:' + q.fn : q.table + ':' + q.op];
    return Promise.resolve(typeof r === 'function' ? r(q) : (r ?? { data: null, error: null }));
  };
  const builder = table => {
    const q = { kind: 'from', table, op: 'select', parts: [], payload: null };
    const b = new Proxy({}, {
      get(_, name) {
        if (name === 'then') return (res, rej) => run(q).then(res, rej);
        if (name === 'update' || name === 'insert') return p => { q.op = name; q.payload = p; return b; };
        if (name === 'delete') return () => { q.op = 'delete'; return b; };
        return (...a) => { q.parts.push([name, ...a]); return b; };
      }
    });
    return b;
  };
  const client = {
    from: builder,
    rpc: (fn, args) => ({ then: (res, rej) => run({ kind: 'rpc', fn, args: args ?? null }).then(res, rej) }),
    auth: {
      onAuthStateChange(f) { cbs.push(f); return { data: { subscription: { unsubscribe() {} } } }; },
      getUserIdentities: async () => ({ data: { identities }, error: null }),
      linkIdentity: async a => { calls.push({ kind: 'auth', fn: 'linkIdentity', a }); return routes['auth:linkIdentity'] ?? { data: {}, error: null }; },
      unlinkIdentity: async i => { calls.push({ kind: 'auth', fn: 'unlinkIdentity', i }); return routes['auth:unlinkIdentity'] ?? { data: {}, error: null }; },
      signOut: async () => ({ error: null })
    }
  };
  if (supabase) w.supabase = { createClient: () => client };
  w.FORGEEKS = { supabaseUrl: 'https://x.supabase.co', anonKey: 'anon' };
  w.eval(authCode);
  for (const s of scripts) w.eval(read(s));
  const $ = id => w.document.getElementById(id);
  await tick(30); // the pages start once the document has finished loading
  return {
    w, $, calls,
    fire: async (event, s) => { cbs.forEach(f => f(event, s)); await tick(); },
    click: async el => { (typeof el === 'string' ? $(el) : el).dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(); },
    submit: async id => { $(id).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(); },
    set: (id, v) => { $(id).value = v; $(id).dispatchEvent(new w.Event('input', { bubbles: true })); },
    rpcs: fn => calls.filter(c => c.kind === 'rpc' && (!fn || c.fn === fn)),
    visible: id => !$(id).hidden,
    text: id => $(id).textContent
  };
}
const filt = (q, name) => q.parts.filter(p => p[0] === name).map(p => p.slice(1));
const hasFilter = (q, name, ...args) => filt(q, name).some(f => JSON.stringify(f) === JSON.stringify(args));

/* ===================================================================== rules */

await test('rules: Cairo dates, signed coins, github links', () => {
  assert.equal(rewardsRules.cairoDate('2026-01-10T22:30:00Z'), '2026-01-11');   // UTC+2 in winter
  assert.equal(rewardsRules.cairoDate('2026-07-10T20:30:00Z'), '2026-07-10');   // UTC+3 in summer: 23:30 the same day
  assert.equal(rewardsRules.cairoDate('2026-07-10T21:30:00Z'), '2026-07-11');
  assert.equal(rewardsRules.cairoDate('nope'), '');
  assert.deepEqual([60, -40, 0, '25', null].map(rewardsRules.signed), ['+60', '-40', '0', '+25', '0']);
  assert.equal(rewardsRules.githubHref('bee-1'), 'https://github.com/bee-1');
  for (const bad of ['', '-x', 'a b', 'a/b', '<x>', 'x'.repeat(40), null, 7]) assert.equal(rewardsRules.githubHref(bad), null, String(bad));
});

await test('rules: feedback input is trimmed and bounded', () => {
  assert.deepEqual(rewardsRules.feedbackInput('  hello  ', '  '), { data: { p_body: 'hello', p_context: null } });
  assert.deepEqual(rewardsRules.feedbackInput('hi', ' budget page '), { data: { p_body: 'hi', p_context: 'budget page' } });
  assert.match(rewardsRules.feedbackInput('   ', '').error, /Write your message/);
  assert.match(rewardsRules.feedbackInput('x'.repeat(4001), '').error, /4000/);
  assert.equal(rewardsRules.feedbackInput('x'.repeat(4000), 'c'.repeat(200)).error, undefined);
  assert.match(rewardsRules.feedbackInput('hi', 'c'.repeat(201)).error, /200/);
});

await test('rules: errors are said in plain words and never leak internals', () => {
  const say = rewardsRules.sayReward;
  assert.match(say({ message: 'this GitHub account is already linked to another member', code: '23505' }), /already linked to another member/);
  assert.match(say({ message: 'Identity is already linked to another user' }), /already linked to another member/);
  assert.match(say({ message: 'unlink your current GitHub account before linking another' }), /Unlink it first/);
  assert.match(say({ message: 'Manual linking is disabled' }), /not switched on/);
  assert.match(say({ message: 'at most 5 feedback messages per day', code: '54000' }), /5 messages today/);
  assert.match(say({ message: 'feedback must be 1 to 4000 characters' }), /1 to 4000/);
  assert.doesNotMatch(say({ message: 'secret internal detail xyz' }), /xyz/);
});

await test('rules: task links, states and lock notes', () => {
  assert.equal(tasksRules.issueHref('LightningEg/Lightning', 12), 'https://github.com/LightningEg/Lightning/issues/12');
  for (const [r, n] of [['LightningEg/Lightning', 0], ['LightningEg/Lightning', 1.5], ['a b/c', 1], ['javascript:x/y', 1], ['a/b/c', 1], [null, 1]]) assert.equal(tasksRules.issueHref(r, n), null, `${r} ${n}`);
  assert.deepEqual([{ mine: true }, { claimed: true }, {}].map(tasksRules.stateOf), ['yours', 'taken', 'open']);
  assert.equal(tasksRules.coinsText(1), '1 Cotton');
  assert.equal(tasksRules.coinsText(75), '75 Cotton');
  assert.equal(tasksRules.lockNote({ mine: false, locked_amount: 5, amount: 9 }), '');
  assert.match(tasksRules.lockNote({ mine: true, locked_amount: 80, amount: 80 }), /locked at 80 Cotton\.$/);
  assert.match(tasksRules.lockNote({ mine: true, locked_amount: 80, amount: 120 }), /locked at 80 Cotton.*now offers 120 Cotton/);
});

await test('rules: owner inputs are checked before anything is sent', () => {
  const ok = adminRules.rewardInput({ issue: '7', amount: '75', title: ' Round money ', criteria: ' Whole EGP everywhere. ' });
  assert.deepEqual(ok.data, { p_repo: 'LightningEg/Lightning', p_issue: 7, p_amount: 75, p_criteria: 'Whole EGP everywhere.', p_title: 'Round money' });
  assert.equal(adminRules.rewardInput({ issue: '7', amount: '0', title: '', criteria: 'x' }).data.p_title, null);
  for (const bad of [{ issue: '0' }, { issue: '1.5' }, { issue: 'abc' }, { issue: '7', amount: '-1' }, { issue: '7', amount: '2.5' }, { issue: '7', amount: '100001' },
    { issue: '7', amount: '5', criteria: '' }, { issue: '7', amount: '5', criteria: 'x'.repeat(4001) }, { issue: '7', amount: '5', criteria: 'x', title: 'y'.repeat(201) }]) {
    assert.ok(adminRules.rewardInput({ title: '', criteria: 'ok', amount: '5', ...bad }).error, JSON.stringify(bad));
  }
  assert.deepEqual(adminRules.reviewInput(5, 'accepted', '25', ' thanks ').data, { p_id: 5, p_status: 'accepted', p_amount: 25, p_note: 'thanks' });
  assert.deepEqual(adminRules.reviewInput(5, 'rejected', '999', '').data, { p_id: 5, p_status: 'rejected', p_amount: 0, p_note: null });
  assert.ok(adminRules.reviewInput(5, 'accepted', '10001', '').error);
  assert.ok(adminRules.reviewInput(5, 'accepted', '-3', '').error);
  assert.ok(adminRules.reviewInput(5, 'pending', '0', '').error);
  assert.ok(adminRules.reviewInput(5, 'accepted', '5', 'n'.repeat(501)).error);
  assert.deepEqual(adminRules.correctionInput('12', ' typo ').data, { p_entry_id: 12, p_reason: 'typo' });
  assert.ok(adminRules.correctionInput('0', 'x').error);
  assert.ok(adminRules.correctionInput('3', ' ').error);
  assert.equal(adminRules.likeExact('50%_off\\'), '50\\%\\_off\\\\');
  assert.equal(adminRules.missingTable({ code: 'PGRST205' }), true);
  assert.equal(adminRules.missingTable({ code: '42P01' }), true);
  assert.equal(adminRules.missingTable({ message: 'relation "public.profile_reports" does not exist' }), true);
  assert.equal(adminRules.missingTable({ code: '42501', message: 'permission denied' }), false);
});

/* ===================================================================== account page panels */

const ACCOUNT_SCRIPTS = ['js/forgeeks-account-rewards.js'];

await test('account page: the three panels come before the private details form, and the script line follows the account script', () => {
  const html = read('forgeeks-account.html');
  const at = s => html.indexOf(s);
  assert.ok(at('id="rw-github"') > 0 && at('id="rw-github"') < at('id="rw-activity"') && at('id="rw-activity"') < at('id="rw-feedback"') && at('id="rw-feedback"') < at('id="form-private"'));
  assert.ok(at('id="rw-github"') > at('id="links-list"'), 'inside the signed-in view, after the links');
  const lines = html.split('\n');
  const i = lines.findIndex(l => l.includes('js/forgeeks-account.js'));
  assert.match(lines[i + 1], /^<script src="js\/forgeeks-account-rewards\.js\?v=[\w-]+"><\/script>$/);
  assert.ok(html.includes('css/forgeeks-rewards.css'));
});

const linkRoutes = (extra = {}) => ({
  'rpc:sync_github_link': { data: { github_id: 1001, github_login: 'bee', linked_at: '2026-10-25T10:00:00Z' }, error: null },
  'github_links:select': { data: { github_login: 'bee', github_id: 1001, linked_at: '2026-10-25T10:00:00Z' }, error: null },
  'ledger_entries:select': { data: [], error: null },
  'contributions:select': { data: [], error: null },
  'feedback_submissions:select': { data: [], error: null },
  ...extra
});

await test('account page: signed out makes no database call', async () => {
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, { routes: linkRoutes() });
  await p.fire('INITIAL_SESSION', null);
  assert.equal(p.calls.length, 0);
});

await test('account page: signed in syncs the GitHub link first and shows who is linked', async () => {
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, {
    routes: linkRoutes(), identities: [{ provider: 'email' }, { provider: 'github', id: 'g1' }] });
  await p.fire('INITIAL_SESSION', session);
  assert.equal(p.rpcs('sync_github_link').length, 1);
  assert.equal(p.calls.filter(c => c.table === 'github_links').length, 0, 'the synced link is used; no second read');
  assert.equal(p.text('gh-status'), 'linked as @bee');
  const a = p.$('gh-status').querySelector('a');
  assert.equal(a.href, 'https://github.com/bee');
  assert.equal(a.target, '_blank');
  assert.equal(a.rel, 'noopener noreferrer');
  assert.equal(p.visible('gh-connect'), false);
  assert.equal(p.visible('gh-unlink'), true);
  assert.equal(p.$('gh-unlink').disabled, false);
  // Nothing else runs twice for the same member when the page repeats the event.
  await p.fire('SIGNED_IN', session);
  assert.equal(p.rpcs('sync_github_link').length, 1);
});

await test('account page: every read of private rows names the member (an owner would otherwise see everyone)', async () => {
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, { routes: linkRoutes(), identities: [{ provider: 'email' }] });
  await p.fire('INITIAL_SESSION', session);
  for (const t of ['ledger_entries', 'contributions']) {
    const q = p.calls.find(c => c.table === t);
    assert.ok(q && hasFilter(q, 'eq', 'user_id', UID), t);
  }
});

await test('account page: connect github starts the provider flow and returns to this page', async () => {
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, {
    routes: linkRoutes({ 'rpc:sync_github_link': { data: null, error: null }, 'github_links:select': { data: null, error: null } }),
    identities: [{ provider: 'google' }] });
  await p.fire('INITIAL_SESSION', session);
  assert.equal(p.text('gh-status'), 'not linked');
  assert.equal(p.visible('gh-connect'), true);
  assert.equal(p.visible('gh-unlink'), false);
  await p.click('gh-connect');
  const link = p.calls.find(c => c.fn === 'linkIdentity');
  assert.deepEqual(plain(link.a), { provider: 'github', options: { redirectTo: 'https://lightningeg.com/forgeeks-account.html' } });
});

await test('account page: a refused link is explained and the button comes back', async () => {
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, {
    routes: linkRoutes({ 'rpc:sync_github_link': { data: null, error: null }, 'github_links:select': { data: null, error: null },
      'auth:linkIdentity': { data: null, error: { message: 'Manual linking is disabled', code: 'manual_linking_disabled' } } }),
    identities: [{ provider: 'google' }] });
  await p.fire('INITIAL_SESSION', session);
  await p.click('gh-connect');
  assert.match(p.text('status-github'), /not switched on/);
  assert.equal(p.$('gh-connect').disabled, false);
});

await test('account page: a GitHub account owned by another member is refused in plain words', async () => {
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, {
    routes: linkRoutes({ 'rpc:sync_github_link': { data: null, error: { message: 'this GitHub account is already linked to another member', code: '23505' } },
      'github_links:select': { data: null, error: null } }),
    identities: [{ provider: 'email' }, { provider: 'github', id: 'g1' }] });
  await p.fire('INITIAL_SESSION', session);
  assert.equal(p.text('gh-status'), 'not linked');
  assert.match(p.text('gh-hint'), /already linked to another member/);
  assert.equal(p.visible('gh-unlink'), true, 'the member can remove the stray sign-in');
  assert.equal(p.text('gh-unlink'), 'remove this github sign-in');
});

await test('account page: coming back from a failed GitHub link shows why', async () => {
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, {
    url: 'https://lightningeg.com/forgeeks-account.html?error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user',
    routes: linkRoutes({ 'rpc:sync_github_link': { data: null, error: null }, 'github_links:select': { data: null, error: null } }),
    identities: [{ provider: 'email' }] });
  await p.fire('INITIAL_SESSION', session);
  assert.match(p.text('gh-hint'), /already linked to another member/);
});

await test('account page: unlink removes the GitHub identity, then syncs; the last sign-in method cannot be removed', async () => {
  const both = [{ provider: 'email' }, { provider: 'github', id: 'g1', identity_id: 'i1' }];
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, { routes: linkRoutes(), identities: both });
  await p.fire('INITIAL_SESSION', session);
  p.calls.length = 0;
  await p.click('gh-unlink');
  assert.equal(plain(p.calls.find(c => c.fn === 'unlinkIdentity').i).provider, 'github');
  assert.equal(p.rpcs('sync_github_link').length, 1, 'closes the link row');
  const only = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, { routes: linkRoutes(), identities: [{ provider: 'github', id: 'g1' }] });
  await only.fire('INITIAL_SESSION', session);
  assert.equal(only.$('gh-unlink').disabled, true);
  assert.match(only.text('gh-hint'), /add another way to sign in/);
});

await test('account page: activity lists entries as given, in Cairo dates with signed coins; purchases show as minus', async () => {
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, {
    routes: linkRoutes({
      'ledger_entries:select': { data: [
        { id: 3, kind: 'purchase', wallet_delta: -40, reason: 'Purchased Aurora', earned_at: '2026-10-25T10:00:00Z' },
        { id: 2, kind: 'contribution_award', wallet_delta: 60, reason: 'Merged pull request #100 for issue #20', earned_at: '2026-01-10T22:30:00Z' }], error: null },
      'contributions:select': { data: [{ ledger_entry_id: 2, url: 'https://github.com/LightningEg/Lightning/pull/100' }, { ledger_entry_id: 3, url: 'javascript:alert(1)' }], error: null } }),
    identities: [{ provider: 'email' }] });
  await p.fire('INITIAL_SESSION', session);
  const rows = [...p.$('act-list').children].map(li => [...li.children].map(c => c.textContent));
  assert.deepEqual(rows, [['2026-10-25', 'Purchased Aurora', '-40'], ['2026-01-11', 'Merged pull request #100 for issue #20', '+60']]);
  const links = [...p.$('act-list').querySelectorAll('a')];
  assert.equal(links.length, 1, 'only the https link becomes a link');
  assert.equal(links[0].href, 'https://github.com/LightningEg/Lightning/pull/100');
  assert.equal(links[0].rel, 'noopener noreferrer');
  assert.equal(p.visible('act-empty'), false);
  const ledgerQ = p.calls.find(c => c.table === 'ledger_entries');
  assert.deepEqual(plain(filt(ledgerQ, 'order')), [['earned_at', { ascending: false }], ['id', { ascending: false }]]);
});

await test('account page: activity shows an empty state', async () => {
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, { routes: linkRoutes(), identities: [{ provider: 'email' }] });
  await p.fire('INITIAL_SESSION', session);
  assert.equal(p.visible('act-empty'), true);
  assert.match(p.text('act-empty'), /Nothing yet/);
  assert.equal(p.$('act-list').children.length, 0);
});

await test('account page: member and server text is shown as text, never as markup', async () => {
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, {
    routes: linkRoutes({
      'ledger_entries:select': { data: [{ id: 1, kind: 'correction', wallet_delta: 5, reason: XSS, earned_at: '2026-10-25T10:00:00Z' }], error: null },
      'feedback_submissions:select': { data: [{ id: 1, body: XSS, context: XSS, status: 'rejected', amount: 0, note: XSS, created_at: '2026-10-25T10:00:00Z', reviewed_at: '2026-10-25T11:00:00Z' }], error: null },
      'rpc:sync_github_link': { data: { github_id: 1, github_login: XSS, linked_at: '2026-10-25T10:00:00Z' }, error: null },
      'github_links:select': { data: null, error: null } }),
    identities: [{ provider: 'email' }, { provider: 'github' }] });
  await p.fire('INITIAL_SESSION', session);
  for (const id of ['act-list', 'fb-list', 'gh-status']) {
    assert.equal(p.$(id).querySelectorAll('img, script, a[href^="javascript"]').length, 0, id);
    assert.ok(p.text(id).includes('<img src=x'), id + ' shows the raw text');
  }
  assert.equal(p.$('gh-status').querySelectorAll('a').length, 0, 'an odd login is never turned into a link');
  assert.equal(p.w.pwned, undefined);
});

await test('account page: feedback is validated before it is sent, then sent trimmed, and the list reloads', async () => {
  let rows = [];
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, {
    routes: linkRoutes({ 'rpc:submit_feedback': () => { rows = [{ id: 9, body: 'The chart is unclear.', context: 'budget page', status: 'pending', amount: 0, note: null, created_at: '2026-10-25T10:00:00Z', reviewed_at: null }]; return { data: { id: 9, status: 'pending' }, error: null }; },
      'feedback_submissions:select': () => ({ data: rows, error: null }) }),
    identities: [{ provider: 'email' }] });
  await p.fire('INITIAL_SESSION', session);
  assert.equal(p.visible('fb-empty'), true);
  await p.submit('form-feedback');
  assert.match(p.text('status-feedback'), /Write your message/);
  p.set('fb-body', 'x'.repeat(4001));
  await p.submit('form-feedback');
  assert.match(p.text('status-feedback'), /4000/);
  assert.equal(p.rpcs('submit_feedback').length, 0, 'invalid input never reaches the database');
  p.set('fb-body', '  The chart is unclear.  ');
  p.set('fb-context', ' budget page ');
  await p.submit('form-feedback');
  assert.deepEqual(plain(p.rpcs('submit_feedback')[0].args), { p_body: 'The chart is unclear.', p_context: 'budget page' });
  assert.equal(p.text('status-feedback'), 'sent');
  assert.equal(p.$('fb-body').value, '');
  assert.equal(p.$('fb-list').children.length, 1);
  assert.match(p.text('fb-list'), /The chart is unclear\./);
  assert.match(p.text('fb-list'), /waiting/);
  assert.equal(p.visible('fb-empty'), false);
});

await test('account page: the daily limit and other refusals are explained', async () => {
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, {
    routes: linkRoutes({ 'rpc:submit_feedback': { data: null, error: { message: 'at most 5 feedback messages per day', code: '54000' } } }),
    identities: [{ provider: 'email' }] });
  await p.fire('INITIAL_SESSION', session);
  p.set('fb-body', 'hello');
  await p.submit('form-feedback');
  assert.match(p.text('status-feedback'), /5 messages today/);
  assert.equal(p.$('fb-body').value, 'hello', 'the text is kept so nothing is lost');
});

await test('account page: accepted feedback shows its coins and the reply', async () => {
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, {
    routes: linkRoutes({ 'feedback_submissions:select': { data: [
      { id: 2, body: 'Add a dark theme', context: null, status: 'accepted', amount: 25, note: 'Shipped in 0.6', created_at: '2026-10-25T10:00:00Z', reviewed_at: '2026-10-25T11:00:00Z' },
      { id: 1, body: 'Spam', context: null, status: 'duplicate', amount: 0, note: null, created_at: '2026-10-24T10:00:00Z', reviewed_at: '2026-10-24T11:00:00Z' }], error: null } }),
    identities: [{ provider: 'email' }] });
  await p.fire('INITIAL_SESSION', session);
  const t = p.text('fb-list');
  assert.match(t, /accepted/);
  assert.match(t, /\+25 Cotton/);
  assert.match(t, /reply: Shipped in 0\.6/);
  assert.match(t, /duplicate/);
});

await test('account page: signing out clears what was shown', async () => {
  const p = await boot('forgeeks-account.html', ACCOUNT_SCRIPTS, {
    routes: linkRoutes({ 'ledger_entries:select': { data: [{ id: 1, kind: 'x', wallet_delta: 5, reason: 'Secret reason', earned_at: '2026-10-25T10:00:00Z' }], error: null } }),
    identities: [{ provider: 'email' }] });
  await p.fire('INITIAL_SESSION', session);
  assert.match(p.text('act-list'), /Secret reason/);
  await p.fire('SIGNED_OUT', null);
  assert.equal(p.$('act-list').textContent, '');
  assert.equal(p.$('gh-status').textContent, '');
});

/* ===================================================================== task board */

const TASKS = ['js/forgeeks-tasks.js'];
const board = [
  { repository: 'LightningEg/Lightning', issue_number: 12, title: 'Round money', amount: 120, acceptance_criteria: 'Whole EGP everywhere.\nTests pass.', version: 2, claimed: true, mine: true, locked_amount: 80 },
  { repository: 'LightningEg/Lightning', issue_number: 9, title: 'Fix the chart', amount: 50, acceptance_criteria: 'Axis starts at zero.', version: 1, claimed: true, mine: false, locked_amount: null },
  { repository: 'LightningEg/Lightning', issue_number: 4, title: null, amount: 10, acceptance_criteria: 'Typo fixed.', version: 1, claimed: false, mine: false, locked_amount: null }
];

await test('tasks: signed out sees one line and a sign-in link, and nothing is requested', async () => {
  const p = await boot('forgeeks-tasks.html', TASKS, { routes: { 'rpc:task_board': { data: board, error: null } } });
  await p.fire('INITIAL_SESSION', null);
  assert.equal(p.visible('view-out'), true);
  assert.equal(p.visible('view-in'), false);
  assert.equal(p.$('sign-in').getAttribute('href'), 'forgeeks-account.html?next=forgeeks-tasks.html');
  assert.equal(p.calls.length, 0);
  assert.equal(p.$('task-list').children.length, 0);
});

await test('tasks: signed in lists open tasks with coins, state, criteria and a GitHub link in a new tab', async () => {
  const p = await boot('forgeeks-tasks.html', TASKS, { routes: {
    'rpc:task_board': { data: board, error: null }, 'github_links:select': { data: { github_login: 'bee' }, error: null } } });
  await p.fire('INITIAL_SESSION', session);
  assert.equal(p.rpcs('task_board').length, 1);
  assert.equal(p.visible('view-in'), true);
  const items = [...p.$('task-list').children];
  assert.equal(items.length, 3);
  const first = items[0];
  assert.match(first.querySelector('h2').textContent, /^#12Round money$/);
  assert.deepEqual([...first.querySelectorAll('.tag')].map(t => t.textContent), ['120 Cotton', 'yours']);
  assert.match(first.textContent, /Whole EGP everywhere\.\nTests pass\./);
  assert.match(first.textContent, /locked at 80 Cotton.*now offers 120 Cotton/);
  assert.deepEqual([...items[1].querySelectorAll('.tag')].map(t => t.textContent), ['50 Cotton', 'taken']);
  assert.deepEqual([...items[2].querySelectorAll('.tag')].map(t => t.textContent), ['10 Cotton', 'open']);
  assert.match(items[2].querySelector('h2').textContent, /Task$/, 'a task without a title still reads');
  const a = first.querySelector('a');
  assert.equal(a.href, 'https://github.com/LightningEg/Lightning/issues/12');
  assert.equal(a.target, '_blank');
  assert.equal(a.rel, 'noopener noreferrer');
  // No claimant identity can be on the page: the database never sends one.
  assert.ok(!p.text('task-list').includes('bee'));
  assert.match(p.text('gh-note'), /paid when the pull request is merged/);
  assert.match(p.text('gh-note'), /Linked now: @bee/);
  assert.match(p.text('view-in'), /\/take/);
  assert.match(p.text('view-in'), /Closes #/);
});

await test('tasks: a member without a linked GitHub account is told coins wait for them', async () => {
  const p = await boot('forgeeks-tasks.html', TASKS, { routes: { 'rpc:task_board': { data: board, error: null }, 'github_links:select': { data: null, error: null } } });
  await p.fire('INITIAL_SESSION', session);
  assert.match(p.text('gh-note'), /Not linked yet/);
  assert.equal(p.$('gh-note').querySelector('a').getAttribute('href'), 'forgeeks-account.html');
});

await test('tasks: the empty board and a failing request both say so', async () => {
  const empty = await boot('forgeeks-tasks.html', TASKS, { routes: { 'rpc:task_board': { data: [], error: null }, 'github_links:select': { data: null, error: null } } });
  await empty.fire('INITIAL_SESSION', session);
  assert.equal(empty.visible('task-empty'), true);
  const bad = await boot('forgeeks-tasks.html', TASKS, { routes: { 'rpc:task_board': { data: null, error: { message: 'Failed to fetch' } } } });
  await bad.fire('INITIAL_SESSION', session);
  assert.match(bad.text('acct-msg'), /Cannot reach the server/);
  assert.equal(bad.visible('task-empty'), false);
});

await test('tasks: titles, criteria and odd repository names are never turned into markup or links', async () => {
  const p = await boot('forgeeks-tasks.html', TASKS, { routes: { 'rpc:task_board': { data: [
    { repository: 'LightningEg/Lightning', issue_number: 1, title: XSS, amount: 5, acceptance_criteria: XSS, version: 1, claimed: false, mine: false, locked_amount: null },
    { repository: 'javascript:alert(1)//x', issue_number: 2, title: 'Odd', amount: 5, acceptance_criteria: 'ok', version: 1, claimed: false, mine: false, locked_amount: null }], error: null },
    'github_links:select': { data: null, error: null } } });
  await p.fire('INITIAL_SESSION', session);
  assert.equal(p.$('task-list').querySelectorAll('img, script').length, 0);
  assert.ok(p.text('task-list').includes('<img src=x'));
  const items = [...p.$('task-list').children];
  assert.equal(items[1].querySelectorAll('a').length, 0, 'no link for a repository that is not owner/name');
  assert.equal(p.w.pwned, undefined);
});

await test('tasks: signing out removes the list from the page', async () => {
  const p = await boot('forgeeks-tasks.html', TASKS, { routes: { 'rpc:task_board': { data: board, error: null }, 'github_links:select': { data: null, error: null } } });
  await p.fire('INITIAL_SESSION', session);
  assert.equal(p.$('task-list').children.length, 3);
  await p.fire('SIGNED_OUT', null);
  assert.equal(p.visible('view-in'), false);
  assert.equal(p.visible('view-out'), true);
});

await test('tasks and admin: without the sign-in script they say so plainly instead of staying blank', async () => {
  for (const [page, scripts] of [['forgeeks-tasks.html', TASKS], ['forgeeks-admin.html', ['js/forgeeks-admin.js']]]) {
    const p = await boot(page, scripts, { supabase: false });
    await tick();
    assert.match(p.text('acct-msg'), /Sign-in is not available right now/, page);
    assert.equal(p.visible('view-loading'), false, page);
  }
});

/* ===================================================================== owner's console */

const ADMIN = ['js/forgeeks-admin.js'];
const overview = [
  { offer_id: 5, repository: 'LightningEg/Lightning', issue_number: 12, status: 'open', version: 2, amount: 120, title: 'Round money', acceptance_criteria: 'Whole EGP.', edited_at: '2026-10-25T10:00:00Z',
    claim_status: 'active', claim_login: 'bee', claim_amount: 80, claimed_at: '2026-10-25T09:00:00Z', award: null, award_amount: null },
  { offer_id: 4, repository: 'LightningEg/Lightning', issue_number: 9, status: 'closed', version: 1, amount: 50, title: XSS, acceptance_criteria: XSS, edited_at: '2026-10-24T10:00:00Z',
    claim_status: null, claim_login: null, claim_amount: null, claimed_at: null, award: 'paid', award_amount: 50 }
];
const adminRoutes = (extra = {}) => ({
  'rpc:is_admin': { data: true, error: null },
  'rpc:admin_task_overview': { data: overview, error: null },
  'rpc:admin_pending_awards': { data: [], error: null },
  'rpc:admin_feedback_queue': { data: [], error: null },
  'profile_reports:select': { data: [], error: null },
  'audit_log:select': { data: [], error: null },
  ...extra
});
const adminBoot = async (extra = {}) => { const p = await boot('forgeeks-admin.html', ADMIN, { routes: adminRoutes(extra) }); await p.fire('INITIAL_SESSION', session); return p; };

await test('admin: signed out sees only the owner sentence and a sign-in link; no database call', async () => {
  const p = await boot('forgeeks-admin.html', ADMIN, { routes: adminRoutes() });
  await p.fire('INITIAL_SESSION', null);
  assert.equal(p.visible('view-no'), true);
  assert.equal(p.visible('view-admin'), false);
  assert.equal(p.text('no-text'), 'This page is for the owner.');
  assert.equal(p.$('sign-in').getAttribute('href'), 'forgeeks-account.html?next=forgeeks-admin.html');
  assert.equal(p.calls.length, 0);
});

await test('admin: a signed-in member who is not the owner sees the sentence and nothing else', async () => {
  const p = await adminBoot({ 'rpc:is_admin': { data: false, error: null } });
  assert.deepEqual(p.rpcs().map(c => c.fn), ['is_admin', 'is_admin']); // Header owner link and console independently check access.
  assert.equal(p.calls.filter(c => c.kind === 'from' && c.table !== 'member_profiles').length, 0, 'no data is requested');
  assert.equal(p.visible('view-no'), true);
  assert.equal(p.visible('view-admin'), false);
  assert.equal(p.visible('no-signin'), false);
  assert.equal(p.text('no-text'), 'This page is for the owner.');
  assert.equal(p.$('tasks-list').children.length, 0);
});

await test('admin: if the owner check fails, the page stays closed and says why', async () => {
  const p = await adminBoot({ 'rpc:is_admin': { data: null, error: { message: 'Failed to fetch' } } });
  assert.equal(p.visible('view-admin'), false);
  assert.match(p.text('acct-msg'), /Cannot reach the server/);
  assert.deepEqual(p.rpcs().map(c => c.fn), ['is_admin', 'is_admin']); // Header owner link and console independently check access.
});

await test('admin: the owner gets every section loaded once', async () => {
  const p = await adminBoot();
  assert.equal(p.visible('view-admin'), true);
  assert.equal(p.visible('view-no'), false);
  const fns = p.calls.map(c => c.fn ?? c.table);
  for (const f of ['is_admin', 'admin_task_overview', 'admin_pending_awards', 'admin_feedback_queue', 'profile_reports', 'audit_log']) assert.equal(fns.filter(x => x === f).length, f === 'is_admin' ? 2 : 1, f);
  assert.equal(p.$('tasks-list').children.length, 2);
  assert.match(p.$('tasks-list').children[0].textContent, /#12 Round money/);
  assert.match(p.$('tasks-list').children[0].textContent, /claim: bee, active, locked at 80 Cotton/);
  assert.match(p.$('tasks-list').children[1].textContent, /award: paid 50 Cotton/);
});

await test('admin: publish sends the exact payload, with the repository fixed, and then reloads the overview', async () => {
  const p = await adminBoot({ 'rpc:publish_reward': { data: { version: 1 }, error: null } });
  p.set('rw-issue', '7'); p.set('rw-amount', '75'); p.set('rw-title', ' Round money '); p.set('rw-criteria', ' Whole EGP everywhere. ');
  await p.submit('form-reward');
  const call = p.rpcs('publish_reward');
  assert.equal(call.length, 1);
  assert.deepEqual(plain(call[0].args), { p_repo: 'LightningEg/Lightning', p_issue: 7, p_amount: 75, p_criteria: 'Whole EGP everywhere.', p_title: 'Round money' });
  assert.equal(p.rpcs('admin_task_overview').length, 2);
  assert.match(p.text('status-reward'), /published #7 at 75 Cotton/);
});

await test('admin: publish refuses bad numbers and empty criteria before asking the database', async () => {
  const p = await adminBoot();
  for (const [issue, amount, crit, msg] of [['', '5', 'x', /Issue number/], ['7', '-5', 'x', /Cotton/], ['7', '5.5', 'x', /Cotton/], ['7', '5', '  ', /Acceptance criteria/]]) {
    p.set('rw-issue', issue); p.set('rw-amount', amount); p.set('rw-criteria', crit);
    await p.submit('form-reward');
    assert.match(p.text('status-reward'), msg);
  }
  assert.equal(p.rpcs('publish_reward').length, 0);
});

await test('admin: a refused publish shows the reason in plain words', async () => {
  const p = await adminBoot({ 'rpc:publish_reward': { data: null, error: { message: 'administrator only', code: '42501' } } });
  p.set('rw-issue', '7'); p.set('rw-amount', '5'); p.set('rw-criteria', 'x');
  await p.submit('form-reward');
  assert.match(p.text('status-reward'), /not allowed/);
});

await test('admin: edit fills the form, history lists versions, close and reopen call the right function', async () => {
  const p = await adminBoot({
    'reward_offer_versions:select': { data: [{ version: 2, amount: 120, title: 'Round money', acceptance_criteria: 'Whole EGP.', edited_at: '2026-10-25T10:00:00Z' }, { version: 1, amount: 80, title: null, acceptance_criteria: 'Older text', edited_at: '2026-10-24T10:00:00Z' }], error: null },
    'rpc:admin_set_offer_status': { data: null, error: null } });
  const row = p.$('tasks-list').children[0];
  const btn = label => [...row.querySelectorAll('button')].find(b => b.textContent === label);
  await p.click(btn('edit'));
  assert.deepEqual([p.$('rw-issue').value, p.$('rw-amount').value, p.$('rw-title').value, p.$('rw-criteria').value], ['12', '120', 'Round money', 'Whole EGP.']);
  assert.match(p.text('status-reward'), /version 3/);
  await p.click(btn('history'));
  const q = p.calls.find(c => c.table === 'reward_offer_versions');
  assert.ok(hasFilter(q, 'eq', 'offer_id', 5));
  assert.match(row.querySelector('.adm-sub').textContent, /v2 · 120 Cotton/);
  assert.match(row.querySelector('.adm-sub').textContent, /v1 · 80 Cotton/);
  await p.click(btn('history'));
  assert.equal(row.querySelector('.adm-sub'), null, 'history closes again');
  await p.click(btn('close'));
  assert.deepEqual(plain(p.rpcs('admin_set_offer_status')[0].args), { p_offer_id: 5, p_status: 'closed' });
  await p.click([...p.$('tasks-list').children[1].querySelectorAll('button')].find(b => b.textContent === 'reopen'));
  assert.deepEqual(plain(p.rpcs('admin_set_offer_status')[1].args), { p_offer_id: 4, p_status: 'open' });
});

await test('admin: member text from the database is shown as text everywhere', async () => {
  const p = await adminBoot({
    'rpc:admin_feedback_queue': { data: [{ id: 1, display_name: XSS, body: XSS, context: XSS, status: 'pending', amount: 0, note: null, created_at: '2026-10-25T10:00:00Z', reviewed_at: null }], error: null },
    'rpc:admin_pending_awards': { data: [{ id: 1, github_login: XSS, github_id: 7, repository: 'LightningEg/Lightning', issue_number: 3, pr_number: 4, pr_title: XSS, pr_url: 'javascript:alert(1)', amount: 5, merged_at: '2026-10-25T10:00:00Z', created_at: '2026-10-25T10:00:00Z' }], error: null },
    'profile_reports:select': { data: [{ id: 1, target_user: 'u1', reporter: 'u2', reason: XSS, status: 'open', created_at: '2026-10-25T10:00:00Z' }], error: null },
    'member_profiles:select': { data: [{ user_id: 'u1', display_name: XSS }, { user_id: 'u2', display_name: XSS }], error: null },
    'audit_log:select': { data: [{ id: 1, actor: 'abcdef12-0000-0000-0000-000000000000', action: XSS, target_type: XSS, target_id: XSS, detail: { reason: XSS }, created_at: '2026-10-25T10:00:00Z' }], error: null } });
  for (const id of ['tasks-list', 'pending-list', 'feedback-list', 'reports-list', 'audit-list']) {
    assert.equal(p.$(id).querySelectorAll('img, script, a[href^="javascript"]').length, 0, id);
    assert.ok(p.text(id).includes('<img src=x'), id + ' shows the raw text');
  }
  assert.equal(p.$('pending-list').querySelectorAll('a').length, 0, 'a non-https pull request link is not made');
  assert.equal(p.w.pwned, undefined);
});

await test('admin: pending awards link only real https pull request pages', async () => {
  const p = await adminBoot({ 'rpc:admin_pending_awards': { data: [{ id: 1, github_login: 'ghost', github_id: 7, repository: 'LightningEg/Lightning', issue_number: 41, pr_number: 300, pr_title: 'Ghost work', pr_url: 'https://github.com/LightningEg/Lightning/pull/300', amount: 12, merged_at: '2026-10-25T10:00:00Z', created_at: '2026-10-25T10:00:00Z' }], error: null } });
  const a = p.$('pending-list').querySelector('a');
  assert.equal(a.href, 'https://github.com/LightningEg/Lightning/pull/300');
  assert.equal(a.rel, 'noopener noreferrer');
  assert.match(p.text('pending-list'), /@ghost · PR #300 for issue #41/);
  assert.match(p.text('pending-list'), /12 Cotton/);
});

const feedbackItem = { id: 3, display_name: 'geek-1a2b', body: 'Add a dark theme', context: 'home', status: 'pending', amount: 0, note: null, created_at: '2026-10-25T10:00:00Z', reviewed_at: null };

await test('admin: feedback is accepted with coins and a note, rejected without coins, and bad coins are refused', async () => {
  const p = await adminBoot({ 'rpc:admin_feedback_queue': { data: [feedbackItem], error: null }, 'rpc:admin_review_feedback': { data: { id: 3 }, error: null } });
  const li = p.$('feedback-list').children[0];
  const btn = label => [...li.querySelectorAll('button')].find(b => b.textContent === label);
  assert.match(li.textContent, /Add a dark theme/);
  li.querySelector('#fbc-3').value = '-4';
  await p.click(btn('accept'));
  assert.match(p.text('status-feedback'), /Cotton/);
  assert.equal(p.rpcs('admin_review_feedback').length, 0);
  li.querySelector('#fbc-3').value = '25';
  li.querySelector('#fbn-3').value = ' Thanks, shipped. ';
  await p.click(btn('accept'));
  assert.deepEqual(plain(p.rpcs('admin_review_feedback')[0].args), { p_id: 3, p_status: 'accepted', p_amount: 25, p_note: 'Thanks, shipped.' });
  assert.equal(p.rpcs('admin_feedback_queue').length, 2, 'the queue reloads');
  const li2 = p.$('feedback-list').children[0];
  li2.querySelector('#fbc-3').value = '500';
  await p.click([...li2.querySelectorAll('button')].find(b => b.textContent === 'reject'));
  assert.deepEqual(plain(p.rpcs('admin_review_feedback')[1].args), { p_id: 3, p_status: 'rejected', p_amount: 0, p_note: null });
  await p.click([...p.$('feedback-list').children[0].querySelectorAll('button')].find(b => b.textContent === 'duplicate'));
  assert.equal(p.rpcs('admin_review_feedback')[2].args.p_status, 'duplicate');
});

await test('admin: an empty feedback queue says so', async () => {
  const p = await adminBoot();
  assert.equal(p.visible('feedback-empty'), true);
  assert.equal(p.visible('pending-empty'), true);
});

await test('admin: a ledger correction is looked up first, shown, and only then posted', async () => {
  const p = await adminBoot({
    'ledger_entries:select': { data: { id: 12, user_id: 'u1', kind: 'contribution_award', wallet_delta: 60, contribution_delta: 60, reason: 'Merged pull request #100', earned_at: '2026-10-25T10:00:00Z' }, error: null },
    'member_profiles:select': { data: { display_name: 'Ada' }, error: null },
    'rpc:admin_correct_entry': { data: { id: 99 }, error: null } });
  assert.equal(p.$('cx-post').hidden, true);
  p.set('cx-id', '0'); p.set('cx-reason', 'wrong amount');
  await p.submit('form-correct');
  assert.match(p.text('status-correct'), /Entry id/);
  p.set('cx-id', '12'); p.set('cx-reason', '  wrong amount  ');
  await p.submit('form-correct');
  assert.equal(p.rpcs('admin_correct_entry').length, 0, 'looking up never posts');
  assert.equal(p.$('cx-post').hidden, false);
  assert.match(p.text('cx-preview'), /Entry 12 · 2026-10-25 · contribution_award · Ada · \+60 Cotton/);
  assert.match(p.text('cx-preview'), /reverses it: -60 Cotton and -60 score/);
  const q = p.calls.find(c => c.table === 'ledger_entries');
  assert.ok(hasFilter(q, 'eq', 'id', 12));
  // Changing the entry or the reason after the look-up takes the confirm button away.
  p.set('cx-reason', 'another reason');
  assert.equal(p.$('cx-post').hidden, true);
  await p.submit('form-correct');
  await p.click('cx-post');
  assert.deepEqual(plain(p.rpcs('admin_correct_entry')[0].args), { p_entry_id: 12, p_reason: 'another reason' });
  assert.match(p.text('status-correct'), /correction posted for entry 12/);
  assert.equal(p.$('cx-post').hidden, true);
});

await test('admin: a correction for a missing or anonymized entry is not offered', async () => {
  const none = await adminBoot({ 'ledger_entries:select': { data: null, error: null } });
  none.set('cx-id', '404'); none.set('cx-reason', 'x');
  await none.submit('form-correct');
  assert.match(none.text('status-correct'), /No entry with that id/);
  assert.equal(none.$('cx-post').hidden, true);
  const anon = await adminBoot({ 'ledger_entries:select': { data: { id: 5, user_id: null, kind: 'contribution_award', wallet_delta: 5, contribution_delta: 5, reason: 'x', earned_at: '2026-10-25T10:00:00Z' }, error: null } });
  anon.set('cx-id', '5'); anon.set('cx-reason', 'x');
  await anon.submit('form-correct');
  assert.match(anon.text('status-correct'), /deleted account/);
  assert.equal(anon.$('cx-post').hidden, true);
});

await test('admin: moderation finds a profile by exact name, needs a reason, then suspends and restores', async () => {
  let suspended = false;
  const p = await adminBoot({
    'member_profiles:select': () => ({ data: [{ user_id: 'u9', display_name: '50%_off', suspended }], error: null }),
    'rpc:admin_suspend_profile': q => { suspended = q.args.p_suspended; return { data: null, error: null }; } });
  p.set('mod-name', 'x');
  await p.submit('form-mod');
  assert.match(p.text('status-mod'), /2 to 40/);
  p.set('mod-name', '50%_off');
  await p.submit('form-mod');
  const q = p.calls.filter(c => c.table === 'member_profiles').pop();
  assert.deepEqual(filt(q, 'ilike'), [['display_name', '50\\%\\_off']]);
  const li = p.$('mod-list').children[0];
  await p.click(li.querySelector('button'));
  assert.match(p.text('status-mod'), /Reason/);
  assert.equal(p.rpcs('admin_suspend_profile').length, 0);
  p.set('mod-reason', 'harassment, report 7');
  await p.click(p.$('mod-list').children[0].querySelector('button'));
  assert.deepEqual(plain(p.rpcs('admin_suspend_profile')[0].args), { p_user: 'u9', p_suspended: true, p_reason: 'harassment, report 7' });
  assert.equal(p.$('mod-list').children[0].querySelector('button').textContent, 'restore', 'the list reloads with the new state');
  await p.click(p.$('mod-list').children[0].querySelector('button'));
  assert.equal(p.rpcs('admin_suspend_profile')[1].args.p_suspended, false);
});

await test('admin: before the reports table exists the section says so and the rest still works', async () => {
  const p = await adminBoot({ 'profile_reports:select': { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.profile_reports' in the schema cache" } } });
  assert.equal(p.text('reports-empty'), 'No reports table yet.');
  assert.equal(p.visible('reports-empty'), true);
  assert.equal(p.$('tasks-list').children.length, 2, 'other sections loaded');
});

await test('admin: any other reports error is not mistaken for a missing table', async () => {
  const p = await adminBoot({ 'profile_reports:select': { data: null, error: { code: '42501', message: 'permission denied for table profile_reports' } } });
  assert.notEqual(p.text('reports-empty'), 'No reports table yet.');
  assert.match(p.text('reports-empty'), /not allowed/);
});

await test('admin: open reports come first with names; they can be actioned, dismissed or sent to moderation', async () => {
  const reports = [
    { id: 1, target_user: 'u1', reporter: 'u2', reason: 'old one', status: 'dismissed', created_at: '2026-10-20T10:00:00Z' },
    { id: 2, target_user: 'u1', reporter: 'u2', reason: 'rude bio', status: 'open', created_at: '2026-10-24T10:00:00Z' }];
  const p = await adminBoot({
    'profile_reports:select': { data: reports, error: null },
    'member_profiles:select': { data: [{ user_id: 'u1', display_name: 'Troll' }, { user_id: 'u2', display_name: 'Ada' }], error: null },
    'rpc:admin_resolve_report': { data: null, error: null } });
  const items = [...p.$('reports-list').children];
  assert.match(items[0].textContent, /Troll.*rude bio.*reported by Ada/s);
  assert.match(items[1].textContent, /old one/);
  assert.deepEqual([...items[1].querySelectorAll('button')].map(b => b.textContent), ['use name for moderation'], 'resolved reports cannot be resolved again');
  const btn = label => [...items[0].querySelectorAll('button')].find(b => b.textContent === label);
  await p.click(btn('use name for moderation'));
  assert.equal(p.$('mod-name').value, 'Troll');
  await p.click(btn('actioned'));
  assert.deepEqual(plain(p.rpcs('admin_resolve_report')[0].args), { p_id: 2, p_status: 'actioned' });
  await p.click([...p.$('reports-list').children[0].querySelectorAll('button')].find(b => b.textContent === 'dismiss'));
  assert.deepEqual(plain(p.rpcs('admin_resolve_report')[1].args), { p_id: 2, p_status: 'dismissed' });
});

await test('admin: the audit log shows the latest actions newest first', async () => {
  const p = await adminBoot({ 'audit_log:select': { data: [
    { id: 9, actor: 'abcdef12-0000-0000-0000-000000000000', action: 'ledger.correct', target_type: 'ledger_entry', target_id: '12', detail: { reason: 'wrong amount' }, created_at: '2026-01-10T22:30:00Z' }], error: null } });
  const q = p.calls.find(c => c.table === 'audit_log');
  assert.deepEqual(plain(filt(q, 'order')), [['id', { ascending: false }]]);
  assert.deepEqual(filt(q, 'limit'), [[30]]);
  assert.match(p.text('audit-list'), /ledger\.correct ledger_entry 12 · by abcdef12 · 2026-01-11 00:30 · \{"reason":"wrong amount"\}/);
});

await test('admin: signing out wipes the console from the page', async () => {
  const p = await adminBoot({ 'rpc:admin_feedback_queue': { data: [feedbackItem], error: null } });
  assert.match(p.text('tasks-list'), /Round money/);
  await p.fire('SIGNED_OUT', null);
  assert.equal(p.visible('view-admin'), false);
  assert.equal(p.visible('view-no'), true);
  for (const id of ['tasks-list', 'pending-list', 'feedback-list', 'mod-list', 'reports-list', 'audit-list']) assert.equal(p.$(id).textContent, '', id);
});

await test('pages: the new pages are not indexed, and the shell knows them', () => {
  for (const page of ['forgeeks-tasks.html', 'forgeeks-admin.html']) {
    const html = read(page);
    assert.match(html, /<meta name="robots" content="noindex,nofollow">/, page);
    assert.match(html, /<title>[A-Za-z]+ · For Geeks · Lightning<\/title>/, page);
    assert.ok(!/innerHTML/.test(read(page.replace('forgeeks-', 'js/forgeeks-').replace('.html', '.js'))), page + ' script never uses innerHTML');
  }
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(read('js/forgeeks-account-rewards.js')));
  const shell = read('tools/geeks_shell.py');
  assert.match(shell, /forgeeks-tasks\.html", "~\/root\/for-geeks\/<b>tasks<\/b>"/);
  assert.match(shell, /forgeeks-admin\.html", "~\/root\/for-geeks\/<b>admin<\/b>"/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
