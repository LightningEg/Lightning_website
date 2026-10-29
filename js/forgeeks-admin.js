/* For Geeks owner console (forgeeks-admin.html): rewards, pending awards, feedback, ledger corrections, moderation,
   reports and the audit log. The page only asks; every rule is enforced in the database (supabase/migrations), where
   each call here is refused for anyone who is not an administrator. Non-owners see one sentence and nothing else.
   Everything shown from the database goes through textContent. The rules are also tested in supabase/tests/rewards-pages.test.mjs. */
(function (root) {
  'use strict';

  /* ---------- rules: pure, no DOM ---------- */
  var REPO = 'LightningEg/Lightning';
  var MAX_ISSUE = 2147483647;

  function text(s) { return typeof s === 'string' ? s.trim() : ''; }
  function wholeNumber(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
    v = text(v);
    return /^\d{1,10}$/.test(v) ? Number(v) : NaN;
  }

  function rewardInput(f) {
    var issue = wholeNumber(f.issue), amount = wholeNumber(f.amount);
    var title = text(f.title), criteria = text(f.criteria);
    if (!(issue >= 1 && issue <= MAX_ISSUE)) return { error: 'Issue number: a whole number from 1.' };
    if (!(amount >= 0 && amount <= 100000)) return { error: 'Coins: a whole number from 0 to 100000.' };
    if (title.length > 200) return { error: 'Title: at most 200 characters.' };
    if (criteria.length < 1 || criteria.length > 4000) return { error: 'Acceptance criteria: 1 to 4000 characters.' };
    return { data: { p_repo: REPO, p_issue: issue, p_amount: amount, p_criteria: criteria, p_title: title || null } };
  }

  function reviewInput(id, status, coins, note) {
    id = wholeNumber(id); note = text(note);
    if (!(id >= 1)) return { error: 'Unknown feedback.' };
    if (['accepted', 'rejected', 'duplicate'].indexOf(status) < 0) return { error: 'Choose accept, duplicate or reject.' };
    var amount = 0;
    if (status === 'accepted') {
      amount = wholeNumber(coins === '' || coins == null ? 10 : coins);
      if (!(amount >= 0 && amount <= 10000)) return { error: 'Coins: a whole number from 0 to 10000.' };
    }
    if (status === 'accepted') { amount = Math.max(10, amount); if (amount > 10 && !note) return { error: 'Add a note for the discretionary bonus.' }; }
    if (note.length > 500) return { error: 'Note: at most 500 characters.' };
    return { data: { p_id: id, p_status: status, p_amount: amount, p_note: note || null } };
  }

  function correctionInput(id, reason) {
    id = wholeNumber(id); reason = text(reason);
    if (!(id >= 1)) return { error: 'Entry id: a whole number from 1.' };
    if (reason.length < 1 || reason.length > 500) return { error: 'Reason: 1 to 500 characters.' };
    return { data: { p_entry_id: id, p_reason: reason } };
  }

  function moderationName(name) {
    name = text(name);
    if (name.length < 2 || name.length > 40) return { error: 'Display name: 2 to 40 characters.' };
    return { data: name };
  }

  // A display name may contain % and _, which ilike treats as wildcards: match the name as typed.
  function likeExact(name) { return String(name).replace(/[\\%_]/g, function (c) { return '\\' + c; }); }

  function cairoDate(v) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : '';
  }
  function cairoTime(v) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  }
  function signed(n) { n = Math.trunc(Number(n) || 0); return (n > 0 ? '+' : n < 0 ? '-' : '') + Math.abs(n); }
  function coinsText(n) { n = Math.trunc(Number(n) || 0); return n + (n === 1 ? ' coin' : ' coins'); }
  function shortId(v) { return typeof v === 'string' && v ? v.slice(0, 8) : '-'; }

  // The reports table belongs to another migration; before it is applied the request fails like this.
  function missingTable(err) {
    var m = String((err && err.message) || '');
    var c = String((err && err.code) || '');
    return c === 'PGRST205' || c === '42P01' || /does not exist|schema cache|could not find the table/i.test(m);
  }

  var rules = {
    rewardInput: rewardInput, reviewInput: reviewInput, correctionInput: correctionInput, moderationName: moderationName,
    likeExact: likeExact, cairoDate: cairoDate, cairoTime: cairoTime, signed: signed, coinsText: coinsText,
    shortId: shortId, missingTable: missingTable
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = rules; return; }

  /* ---------- page ---------- */
  var doc = root.document;
  var FG = root.FG;
  var $ = function (id) { return doc.getElementById(id); };
  var HTTPS = /^https:\/\/[^\s<>"']{1,290}$/;
  var checkedFor = null;
  var pendingCorrection = null;

  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function show(view) { ['loading', 'no', 'admin'].forEach(function (v) { $('view-' + v).hidden = v !== view; }); }
  function note(s, kind) {
    var e = $('acct-msg');
    e.textContent = s || '';
    e.hidden = !s;
    e.className = 'acct-msg' + (kind ? ' ' + kind : '');
  }
  function flash(id, s, bad) { var e = $(id); e.textContent = s || ''; e.className = 'acct-status' + (bad ? ' bad' : ''); }
  function busy(btn, on) { btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false'); }
  function say(err) { return FG.say(err); }
  function button(label, cls, fn) {
    var b = el('button', cls || 'btn ghost', label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }
  function empty(listId, emptyId, n) { $(emptyId).hidden = n > 0; if (!n) $(listId).textContent = ''; }

  // Run one action: lock the button, show the outcome next to the section, reload what changed.
  async function act(btn, statusId, call, done, okText) {
    busy(btn, true);
    var r;
    try { r = await call(); } catch (e) { r = { error: e }; }
    busy(btn, false);
    if (r && r.error) { flash(statusId, say(r.error), true); return false; }
    if (done) await done();
    flash(statusId, okText || 'done');
    return true;
  }

  /* ----- rewards ----- */
  async function publish(ev) {
    ev.preventDefault();
    var form = ev.target, btn = form.querySelector('button[type=submit]');
    var v = rewardInput({ issue: form.elements.issue.value, amount: form.elements.amount.value, title: form.elements.title.value, criteria: form.elements.criteria.value });
    if (v.error) { flash('status-reward', v.error, true); return; }
    var ok = await act(btn, 'status-reward', function () { return FG.sb.rpc('publish_reward', v.data); }, loadTasks, '');
    if (ok) {
      var d = v.data;
      flash('status-reward', 'published #' + d.p_issue + ' at ' + coinsText(d.p_amount));
    }
  }

  function prefill(r) {
    var f = $('form-reward').elements;
    f.issue.value = r.issue_number; f.amount.value = r.amount; f.title.value = r.title || ''; f.criteria.value = r.acceptance_criteria || '';
    f.amount.focus();
    flash('status-reward', 'Change the Cotton or the criteria, then publish: it becomes version ' + (r.version + 1) + '.');
  }

  async function toggleHistory(r, li, btn) {
    var open = li.querySelector('.adm-sub');
    if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
    btn.setAttribute('aria-expanded', 'true');
    var sub = el('div', 'adm-sub');
    sub.appendChild(el('span', 'meta-line', 'loading…'));
    li.appendChild(sub);
    var res = await FG.sb.from('reward_offer_versions').select('version,amount,title,acceptance_criteria,edited_at')
      .eq('offer_id', r.offer_id).order('version', { ascending: false });
    sub.textContent = '';
    if (res.error) { sub.appendChild(el('span', 'meta-line', say(res.error))); return; }
    var ul = el('ul', 'rows');
    (res.data || []).forEach(function (v) {
      var item = el('li');
      item.appendChild(el('div', 'meta-line', 'v' + v.version + ' · ' + coinsText(v.amount) + ' · ' + cairoDate(v.edited_at) + (v.title ? ' · ' + v.title : '')));
      item.appendChild(el('div', 'what pre', v.acceptance_criteria));
      ul.appendChild(item);
    });
    sub.appendChild(ul);
  }

  function taskRow(r) {
    var li = el('li', 'adm-row');
    var head = el('div', 'task-head');
    head.appendChild(el('span', 'what', '#' + r.issue_number + ' ' + (r.title || '(no title)')));
    var tags = el('div', 'tags');
    tags.appendChild(el('span', 'tag' + (r.status === 'open' ? ' on' : ''), r.status));
    tags.appendChild(el('span', 'tag', coinsText(r.amount)));
    tags.appendChild(el('span', 'tag', 'v' + r.version));
    head.appendChild(tags);
    li.appendChild(head);
    var claim = r.claim_status ? ('claim: ' + (r.claim_login || 'unknown') + ', ' + r.claim_status + ', locked at ' + coinsText(r.claim_amount)) : 'no claim';
    var award = r.award ? ('award: ' + r.award + ' ' + coinsText(r.award_amount)) : 'award: none';
    li.appendChild(el('div', 'meta-line', claim + ' · ' + award));
    var acts = el('div', 'adm-actions');
    acts.appendChild(button('edit', 'btn ghost', function () { prefill(r); }));
    var hist = button('history', 'btn ghost', function () { toggleHistory(r, li, hist); });
    hist.setAttribute('aria-expanded', 'false');
    acts.appendChild(hist);
    var next = r.status === 'open' ? 'closed' : 'open';
    var tog = button(next === 'closed' ? 'close' : 'reopen', 'btn ghost', function () {
      act(tog, 'status-tasks', function () { return FG.sb.rpc('admin_set_offer_status', { p_offer_id: r.offer_id, p_status: next }); }, loadTasks, next === 'closed' ? 'closed #' + r.issue_number : 'reopened #' + r.issue_number);
    });
    acts.appendChild(tog);
    li.appendChild(acts);
    return li;
  }

  async function loadTasks() {
    var r = await FG.sb.rpc('admin_task_overview');
    var ul = $('tasks-list');
    ul.textContent = '';
    if (r.error) { flash('status-tasks', say(r.error), true); return; }
    var rows = r.data || [];
    empty('tasks-list', 'tasks-empty', rows.length);
    rows.forEach(function (row) { ul.appendChild(taskRow(row)); });
  }

  async function loadPending() {
    var r = await FG.sb.rpc('admin_pending_awards');
    var ul = $('pending-list');
    ul.textContent = '';
    if (r.error) { $('pending-empty').hidden = false; $('pending-empty').textContent = say(r.error); return; }
    var rows = r.data || [];
    $('pending-empty').textContent = 'Nothing waiting.';
    empty('pending-list', 'pending-empty', rows.length);
    rows.forEach(function (p) {
      var li = el('li');
      var head = el('div', 'task-head');
      head.appendChild(el('span', 'what', '@' + p.github_login + ' · PR #' + p.pr_number + ' for issue #' + p.issue_number));
      var tags = el('div', 'tags');
      tags.appendChild(el('span', 'tag on', coinsText(p.amount)));
      head.appendChild(tags);
      li.appendChild(head);
      var meta = el('div', 'meta-line', 'merged ' + cairoDate(p.merged_at) + ' · ');
      if (HTTPS.test(p.pr_url || '')) {
        var a = el('a', null, p.pr_title || 'pull request');
        a.href = p.pr_url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        meta.appendChild(a);
      } else {
        meta.appendChild(doc.createTextNode(p.pr_title || 'pull request'));
      }
      li.appendChild(meta);
      ul.appendChild(li);
    });
  }

  /* ----- feedback ----- */
  function feedbackRow(f) {
    var li = el('li');
    var tags = el('div', 'tags');
    tags.appendChild(el('span', 'when', cairoDate(f.created_at)));
    tags.appendChild(el('span', 'tag', f.display_name || 'member'));
    li.appendChild(tags);
    li.appendChild(el('div', 'what pre', f.body));
    if (f.context) li.appendChild(el('div', 'meta-line', 'where: ' + f.context));
    var fields = el('div', 'review-fields');
    var c = el('div', 'f');
    var cl = el('label', null, 'coins'); cl.htmlFor = 'fbc-' + f.id;
    var ci = el('input'); ci.id = 'fbc-' + f.id; ci.type = 'number'; ci.min = '0'; ci.max = '10000'; ci.step = '1'; ci.value = '10'; ci.setAttribute('inputmode', 'numeric');
    c.appendChild(cl); c.appendChild(ci);
    var n = el('div', 'f');
    var nl = el('label', null, 'note to the member'); nl.htmlFor = 'fbn-' + f.id;
    var ni = el('input'); ni.id = 'fbn-' + f.id; ni.type = 'text'; ni.maxLength = 500; ni.autocomplete = 'off';
    n.appendChild(nl); n.appendChild(ni);
    fields.appendChild(c); fields.appendChild(n);
    li.appendChild(fields);
    var acts = el('div', 'adm-actions');
    [['accept', 'accepted'], ['duplicate', 'duplicate'], ['reject', 'rejected']].forEach(function (pair) {
      var b = button(pair[0], pair[1] === 'accepted' ? 'btn' : 'btn ghost', function () {
        var v = reviewInput(f.id, pair[1], ci.value, ni.value);
        if (v.error) { flash('status-feedback', v.error, true); return; }
        act(b, 'status-feedback', function () { return FG.sb.rpc('admin_review_feedback', v.data); }, loadFeedback, pair[1] === 'accepted' && v.data.p_amount > 0 ? 'accepted, ' + coinsText(v.data.p_amount) + ' paid' : pair[1]);
      });
      acts.appendChild(b);
    });
    li.appendChild(acts);
    return li;
  }

  async function loadFeedback() {
    var r = await FG.sb.rpc('admin_feedback_queue', { p_status: 'pending', p_limit: 50 });
    var ul = $('feedback-list');
    ul.textContent = '';
    if (r.error) { flash('status-feedback', say(r.error), true); return; }
    var rows = r.data || [];
    empty('feedback-list', 'feedback-empty', rows.length);
    rows.forEach(function (f) { ul.appendChild(feedbackRow(f)); });
  }

  /* ----- ledger correction ----- */
  function resetCorrection() { pendingCorrection = null; $('cx-post').hidden = true; $('cx-preview').hidden = true; $('cx-preview').textContent = ''; }

  async function lookUp(ev) {
    ev.preventDefault();
    resetCorrection();
    var form = $('form-correct');
    var v = correctionInput(form.elements.id.value, form.elements.reason.value);
    if (v.error) { flash('status-correct', v.error, true); return; }
    busy($('cx-look'), true);
    var r = await FG.sb.from('ledger_entries').select('id,user_id,kind,wallet_delta,contribution_delta,reason,earned_at')
      .eq('id', v.data.p_entry_id).maybeSingle();
    var who = null;
    if (!r.error && r.data && r.data.user_id) {
      var m = await FG.sb.from('member_profiles').select('display_name').eq('user_id', r.data.user_id).maybeSingle();
      who = !m.error && m.data ? m.data.display_name : null;
    }
    busy($('cx-look'), false);
    if (r.error) { flash('status-correct', say(r.error), true); return; }
    if (!r.data) { flash('status-correct', 'No entry with that id.', true); return; }
    var e = r.data;
    if (!e.user_id) { flash('status-correct', 'That entry belongs to a deleted account and cannot be corrected.', true); return; }
    pendingCorrection = v.data;
    var p = $('cx-preview');
    p.hidden = false;
    p.textContent = 'Entry ' + e.id + ' · ' + cairoDate(e.earned_at) + ' · ' + e.kind + ' · ' + (who || 'member') + ' · ' + signed(e.wallet_delta) + ' Cotton · "' + e.reason +
      '". Posting reverses it: ' + signed(-e.wallet_delta) + ' coins' + (e.contribution_delta ? ' and ' + signed(-e.contribution_delta) + ' score' : '') + '.';
    $('cx-post').hidden = false;
    flash('status-correct', '');
  }

  async function postCorrection() {
    if (!pendingCorrection) return;
    var args = pendingCorrection;
    var ok = await act($('cx-post'), 'status-correct', function () { return FG.sb.rpc('admin_correct_entry', args); }, loadAudit, 'correction posted for entry ' + args.p_entry_id);
    if (ok) resetCorrection();
  }

  /* ----- moderation ----- */
  async function findProfiles(ev) {
    ev.preventDefault();
    var form = $('form-mod');
    var n = moderationName(form.elements.name.value);
    if (n.error) { flash('status-mod', n.error, true); return; }
    var r = await FG.sb.from('member_profiles').select('user_id,display_name,suspended').ilike('display_name', likeExact(n.data)).limit(10);
    var ul = $('mod-list');
    ul.textContent = '';
    if (r.error) { flash('status-mod', say(r.error), true); return; }
    var rows = r.data || [];
    if (!rows.length) { flash('status-mod', 'No profile with that display name.', true); return; }
    flash('status-mod', '');
    rows.forEach(function (p) {
      var li = el('li');
      var head = el('div', 'task-head');
      head.appendChild(el('span', 'what', p.display_name));
      head.appendChild(el('span', 'tag' + (p.suspended ? ' bad' : ' on'), p.suspended ? 'suspended' : 'visible'));
      li.appendChild(head);
      var acts = el('div', 'adm-actions');
      var b = button(p.suspended ? 'restore' : 'suspend', 'btn ghost', function () {
        var reason = text(form.elements.reason.value);
        if (!reason || reason.length > 300) { flash('status-mod', 'Reason: 1 to 300 characters.', true); return; }
        act(b, 'status-mod', function () { return FG.sb.rpc('admin_suspend_profile', { p_user: p.user_id, p_suspended: !p.suspended, p_reason: reason }); },
          function () { return findProfiles({ preventDefault: function () {} }); }, p.suspended ? 'restored' : 'suspended');
      });
      acts.appendChild(b);
      li.appendChild(acts);
      ul.appendChild(li);
    });
  }

  /* ----- reports ----- */
  async function names(ids) {
    var map = {};
    ids = ids.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    if (!ids.length) return map;
    var r = await FG.sb.from('member_profiles').select('user_id,display_name').in('user_id', ids);
    ((r && r.data) || []).forEach(function (p) { map[p.user_id] = p.display_name; });
    return map;
  }

  async function loadReports() {
    var ul = $('reports-list');
    ul.textContent = '';
    $('reports-empty').textContent = 'No reports.';
    var r = await FG.sb.from('profile_reports').select('id,target_user,reporter,reason,status,created_at').order('created_at', { ascending: false }).limit(50);
    if (r.error) {
      $('reports-empty').hidden = false;
      $('reports-empty').textContent = missingTable(r.error) ? 'No reports table yet.' : say(r.error);
      return;
    }
    var rows = (r.data || []).slice().sort(function (a, b) { return (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1); });
    empty('reports-list', 'reports-empty', rows.length);
    var map = await names(rows.reduce(function (acc, x) { return acc.concat([x.target_user, x.reporter]); }, []));
    rows.forEach(function (p) {
      var li = el('li');
      var head = el('div', 'task-head');
      head.appendChild(el('span', 'what', (map[p.target_user] || 'unknown profile')));
      var tags = el('div', 'tags');
      tags.appendChild(el('span', 'when', cairoDate(p.created_at)));
      tags.appendChild(el('span', 'tag' + (p.status === 'open' ? ' on' : ''), p.status));
      head.appendChild(tags);
      li.appendChild(head);
      li.appendChild(el('div', 'what pre', p.reason));
      li.appendChild(el('div', 'meta-line', 'reported by ' + (map[p.reporter] || 'unknown')));
      var acts = el('div', 'adm-actions');
      if (map[p.target_user]) {
        acts.appendChild(button('use name for moderation', 'btn ghost', function () {
          $('form-mod').elements.name.value = map[p.target_user];
          $('mod-name').focus();
        }));
      }
      if (p.status === 'open') {
        [['actioned', 'actioned'], ['dismiss', 'dismissed']].forEach(function (pair) {
          var b = button(pair[0], 'btn ghost', function () {
            act(b, 'status-reports', function () { return FG.sb.rpc('admin_resolve_report', { p_id: p.id, p_status: pair[1] }); }, loadReports, pair[1]);
          });
          acts.appendChild(b);
        });
      }
      li.appendChild(acts);
      ul.appendChild(li);
    });
  }

  /* ----- audit ----- */
  async function loadAudit() {
    var r = await FG.sb.from('audit_log').select('id,actor,action,target_type,target_id,detail,created_at').order('id', { ascending: false }).limit(30);
    var ul = $('audit-list');
    ul.textContent = '';
    if (r.error) { $('audit-empty').hidden = false; $('audit-empty').textContent = say(r.error); return; }
    var rows = r.data || [];
    $('audit-empty').textContent = 'Nothing logged yet.';
    empty('audit-list', 'audit-empty', rows.length);
    rows.forEach(function (a) {
      var li = el('li', 'log');
      li.appendChild(el('b', null, a.action));
      var d = '';
      try { d = JSON.stringify(a.detail || {}); } catch (_) { d = ''; }
      if (d.length > 220) d = d.slice(0, 220) + '…';
      li.appendChild(doc.createTextNode(' ' + (a.target_type || '') + ' ' + (a.target_id || '') + ' · by ' + shortId(a.actor) + ' · ' +
        cairoDate(a.created_at) + ' ' + cairoTime(a.created_at) + ' · ' + d));
      ul.appendChild(li);
    });
  }

  /* ----- gate ----- */
  function loadAll() {
    [loadTasks, loadPending, loadFeedback, loadReports, loadAudit].forEach(function (fn) { fn().catch(function () {}); });
  }

  function wipe() {
    ['tasks-list', 'pending-list', 'feedback-list', 'mod-list', 'reports-list', 'audit-list'].forEach(function (id) { $(id).textContent = ''; });
    resetCorrection();
    $('form-reward').reset(); $('form-correct').reset(); $('form-mod').reset();
  }

  function noAccess(signedIn) {
    checkedFor = null;
    wipe();
    $('no-signin').hidden = signedIn;
    if (!signedIn) $('sign-in').href = FG.signInHref();
    show('no');
  }

  async function gate(session) {
    var uid = session.user.id;
    if (checkedFor === uid) return;
    checkedFor = uid;
    note('');
    show('loading');
    var r = await FG.sb.rpc('is_admin');
    if (r.error) { checkedFor = null; noAccess(true); note(say(r.error), 'bad'); return; }
    if (r.data !== true) { checkedFor = null; noAccess(true); return; }
    show('admin');
    loadAll();
  }

  function init() {
    if (!FG || !FG.available) { show('no'); $('view-no').hidden = true; note('Sign-in is not available right now.', 'bad'); return; }
    $('form-reward').addEventListener('submit', publish);
    $('form-correct').addEventListener('submit', lookUp);
    $('form-correct').elements.id.addEventListener('input', resetCorrection);
    $('form-correct').elements.reason.addEventListener('input', resetCorrection);
    $('cx-post').addEventListener('click', postCorrection);
    $('form-mod').addEventListener('submit', findProfiles);
    FG.ready.then(function (r) { if (r && r.session) gate(r.session); else noAccess(false); });
    FG.onAuth(function (s) { if (s) gate(s); else noAccess(false); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
