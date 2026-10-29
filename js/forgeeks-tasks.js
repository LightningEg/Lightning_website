/* For Geeks task board (forgeeks-tasks.html): open tasks that pay Cotton, from public.task_board().
   Signed-in members only. The database says whether a task is taken or yours, never by whom.
   Everything shown from the database goes through textContent. The rules are also tested in supabase/tests/rewards-pages.test.mjs. */
(function (root) {
  'use strict';

  /* ---------- rules: pure, no DOM ---------- */
  var REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  var GH_LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

  function issueHref(repo, n) {
    n = Number(n);
    if (typeof repo !== 'string' || !REPO.test(repo) || !Number.isInteger(n) || n < 1) return null;
    return 'https://github.com/' + repo + '/issues/' + n;
  }

  function coinsText(n) { n = Math.trunc(Number(n) || 0); return n + ' Cotton'; }

  function stateOf(row) { return row && row.mine ? 'yours' : row && row.claimed ? 'taken' : 'open'; }

  // The sentence under a task you hold when the owner has changed the amount since you took it.
  function lockNote(row) {
    if (!row || !row.mine || row.locked_amount == null) return '';
    if (row.locked_amount === row.amount) return 'You have this task. Your reward is locked at ' + coinsText(row.locked_amount) + '.';
    return 'You have this task. Your reward is locked at ' + coinsText(row.locked_amount) + ', the amount when you took it. The task now offers ' + coinsText(row.amount) + '.';
  }

  var rules = { issueHref: issueHref, coinsText: coinsText, stateOf: stateOf, lockNote: lockNote };
  if (typeof module !== 'undefined' && module.exports) { module.exports = rules; return; }

  /* ---------- page ---------- */
  var doc = root.document;
  var FG = root.FG;
  var $ = function (id) { return doc.getElementById(id); };
  var loadedFor = null;

  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function show(view) { ['loading', 'out', 'in'].forEach(function (v) { $('view-' + v).hidden = v !== view; }); }
  function note(s, kind) {
    var e = $('acct-msg');
    e.textContent = s || '';
    e.hidden = !s;
    e.className = 'acct-msg' + (kind ? ' ' + kind : '');
  }

  function renderTasks(rows) {
    var ul = $('task-list');
    ul.textContent = '';
    $('task-empty').hidden = rows.length > 0;
    rows.forEach(function (r) {
      var state = stateOf(r);
      var li = el('li', 'panel task');
      var head = el('div', 'task-head');
      var h = el('h2');
      h.appendChild(el('span', 'n', '#' + r.issue_number));
      h.appendChild(doc.createTextNode(r.title || 'Task'));
      var tags = el('div', 'tags');
      tags.appendChild(el('span', 'tag on', coinsText(r.amount)));
      tags.appendChild(el('span', 'tag' + (state === 'yours' ? ' on' : ''), state));
      head.appendChild(h); head.appendChild(tags);
      li.appendChild(head);
      li.appendChild(el('p', 'crit-label', 'done when'));
      li.appendChild(el('p', 'crit pre', r.acceptance_criteria));
      var ln = lockNote(r);
      if (ln) li.appendChild(el('p', 'note', ln));
      var href = issueHref(r.repository, r.issue_number);
      if (href) {
        var row = el('div');
        row.className = 'row flush';
        var a = el('a', 'btn ghost small', 'open issue on github ↗');
        a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
        row.appendChild(a);
        li.appendChild(row);
      }
      ul.appendChild(li);
    });
  }

  async function githubNote(uid) {
    var line = $('gh-note');
    line.textContent = '';
    line.appendChild(doc.createTextNode('Cotton is paid when the pull request is merged, to the GitHub account linked on '));
    var a = el('a', null, 'your account page');
    a.href = 'forgeeks-account.html';
    line.appendChild(a);
    line.appendChild(doc.createTextNode('. '));
    var r = await FG.sb.from('github_links').select('github_login').eq('user_id', uid).is('unlinked_at', null).maybeSingle();
    if (r.error) return;
    if (r.data && GH_LOGIN.test(r.data.github_login || '')) line.appendChild(doc.createTextNode('Linked now: @' + r.data.github_login + '.'));
    else line.appendChild(doc.createTextNode('Not linked yet: Cotton for a merged pull request waits for you until you link.'));
  }

  async function load(session) {
    var uid = session.user.id;
    if (loadedFor === uid) return;
    loadedFor = uid;
    note('');
    show('loading');
    var r = await FG.sb.rpc('task_board');
    if (r.error) { loadedFor = null; show('in'); renderTasks([]); $('task-empty').hidden = true; note(FG.say(r.error), 'bad'); return; }
    renderTasks(r.data || []);
    show('in');
    githubNote(uid).catch(function () {});
  }

  function out() {
    loadedFor = null;
    $('sign-in').href = FG.signInHref();
    show('out');
  }

  function init() {
    if (!FG || !FG.available) { show('out'); $('view-out').hidden = true; note('Sign-in is not available right now.', 'bad'); return; }
    FG.ready.then(function (r) { if (r && r.session) load(r.session); else out(); });
    FG.onAuth(function (s) { if (s) load(s); else out(); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
