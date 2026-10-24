/* For Geeks account page, rewards panels (forgeeks-account.html): github link, activity, feedback.
   Needs window.FG (js/forgeeks-auth.js). The GitHub link comes from GitHub's own sign-in through Supabase Auth:
   a typed username is never used. Everything shown from the database goes through textContent.
   The rules at the top are also tested in supabase/tests/rewards-pages.test.mjs. */
(function (root) {
  'use strict';

  /* ---------- rules: pure, no DOM ---------- */
  var GH_LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
  var HTTPS = /^https:\/\/[^\s<>"']{1,290}$/;

  // yyyy-mm-dd in Cairo, whatever the browser's own zone (the leaderboard uses the same day).
  function cairoDate(v) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : '';
  }

  function signed(n) {
    n = Math.trunc(Number(n) || 0);
    return (n > 0 ? '+' : n < 0 ? '-' : '') + Math.abs(n);
  }

  function githubHref(login) { return typeof login === 'string' && GH_LOGIN.test(login) ? 'https://github.com/' + login : null; }

  function feedbackInput(body, context) {
    body = typeof body === 'string' ? body.trim() : '';
    context = typeof context === 'string' ? context.trim() : '';
    if (body.length < 1) return { error: 'Write your message first.' };
    if (body.length > 4000) return { error: 'Message: at most 4000 characters.' };
    if (context.length > 200) return { error: 'Where: at most 200 characters.' };
    return { data: { p_body: body, p_context: context || null } };
  }

  var shared = (typeof module !== 'undefined' && module.exports) ? null : root.FG;

  // Plain words for the errors this page can meet; anything else goes to the shared wording.
  function sayReward(err) {
    var m = String((err && (err.message || err.error_description)) || err || '');
    if (/unlink your current GitHub/i.test(m)) return 'This account already has a GitHub account linked. Unlink it first.';
    if (/already linked to another|already.*linked.*user|identity_already_exists/i.test(m)) return 'That GitHub account is already linked to another member. Unlink it there first, or use a different GitHub account.';
    if (/manual.?linking|linking.*disabled|provider.*(disabled|not enabled)/i.test(m)) return 'Linking GitHub is not switched on yet.';
    if (/at most 5 feedback/i.test(m)) return 'You have sent 5 messages today. Try again tomorrow.';
    if (/1 to 4000/.test(m)) return 'Message: 1 to 4000 characters.';
    if (/context must be/i.test(m)) return 'Where: at most 200 characters.';
    if (/minimum.*identities|at least 2 identities|identities.*(least|minimum)/i.test(m)) return 'Add another way to sign in before you unlink GitHub.';
    return shared && shared.say ? shared.say(err) : 'Something went wrong. Try again.';
  }

  var rules = { cairoDate: cairoDate, signed: signed, githubHref: githubHref, feedbackInput: feedbackInput, sayReward: sayReward };
  if (typeof module !== 'undefined' && module.exports) { module.exports = rules; return; }

  /* ---------- page ---------- */
  var doc = root.document;
  var FG = root.FG;
  var $ = function (id) { return doc.getElementById(id); };
  var PAGE = root.location.origin + root.location.pathname;
  var sb, uid = null, started = null;

  // A failed GitHub link comes back as ?error_description=… on this page. The account script tidies the address
  // first thing after load, so read it now, while this file is being evaluated.
  var returned = (function () {
    try {
      var h = new URLSearchParams(String(root.location.hash || '').replace(/^#/, ''));
      var s = new URLSearchParams(root.location.search || '');
      var code = h.get('error_code') || s.get('error_code') || '';
      var text = h.get('error_description') || s.get('error_description') || '';
      return /identity|link/i.test(code + ' ' + text) ? (code + ' ' + text) : '';
    } catch (_) { return ''; }
  })();

  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function flash(id, s, bad) { var e = $(id); e.textContent = s || ''; e.className = 'acct-status' + (bad ? ' bad' : ''); }
  function busy(btn, on) { btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false'); }
  function fail(err) { return sayReward(err); }

  /* ----- github ----- */
  var gh = { link: null, identity: null, others: 0 };

  function renderGithub(message, bad) {
    var line = $('gh-status'), hint = $('gh-hint');
    line.textContent = '';
    line.className = 'gh-line';
    if (gh.link) {
      line.appendChild(doc.createTextNode('linked as '));
      var href = githubHref(gh.link.github_login);
      if (href) {
        var a = el('a', null, '@' + gh.link.github_login);
        a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
        line.appendChild(a);
      } else {
        line.appendChild(doc.createTextNode('@' + String(gh.link.github_login)));
      }
    } else {
      line.className = 'gh-line dim';
      line.textContent = 'not linked';
    }
    $('gh-connect').hidden = !!gh.identity;
    $('gh-unlink').hidden = !gh.identity;
    $('gh-unlink').textContent = gh.link ? 'unlink github' : 'remove this github sign-in';
    var h = '';
    if (message) h = message;
    else if (gh.identity && gh.others < 1) h = 'To unlink, add another way to sign in first: a password or Google.';
    else if (!gh.link) h = 'You can still earn: coins for a merged pull request wait for you until you link.';
    hint.textContent = h;
    hint.hidden = !h;
    hint.className = 'fine' + (bad ? ' bad' : '');
    $('gh-unlink').disabled = !!gh.identity && gh.others < 1 && !!gh.link;
  }

  async function loadIdentities() {
    var r = await sb.auth.getUserIdentities();
    var list = (r && r.data && r.data.identities) || [];
    gh.identity = list.filter(function (i) { return i.provider === 'github'; })[0] || null;
    gh.others = list.filter(function (i) { return i.provider !== 'github'; }).length;
  }

  async function refreshGithub(sync) {
    var message = '', bad = false;
    try { await loadIdentities(); } catch (_) { gh.identity = null; gh.others = 0; }
    gh.link = null;
    if (sync) {
      var r = await sb.rpc('sync_github_link');
      if (r.error) { message = fail(r.error); bad = true; }
      else gh.link = r.data || null;
    }
    if (!gh.link && !message) {
      var q = await sb.from('github_links').select('github_login,github_id,linked_at').eq('user_id', uid).is('unlinked_at', null).maybeSingle();
      if (!q.error && q.data) gh.link = q.data;
    }
    if (!message && returned) { message = fail({ message: returned }); bad = true; returned = ''; }
    renderGithub(message, bad);
  }

  async function connect() {
    var btn = $('gh-connect');
    flash('status-github', '');
    busy(btn, true);
    var r = await sb.auth.linkIdentity({ provider: 'github', options: { redirectTo: PAGE } });
    if (r && r.error) { busy(btn, false); flash('status-github', fail(r.error), true); }
    // Otherwise the browser is on its way to GitHub; it returns to this page and the link is synced.
  }

  async function unlink() {
    var btn = $('gh-unlink');
    flash('status-github', '');
    busy(btn, true);
    try { await loadIdentities(); } catch (_) {}
    if (!gh.identity) { busy(btn, false); await refreshGithub(true); return; }
    var r = await sb.auth.unlinkIdentity(gh.identity);
    if (r && r.error) { busy(btn, false); flash('status-github', fail(r.error), true); return; }
    await sb.rpc('sync_github_link'); // closes the link row even if the database trigger was slow
    busy(btn, false);
    await refreshGithub(false);
    flash('status-github', 'unlinked');
  }

  /* ----- activity ----- */
  async function loadActivity() {
    var res = await Promise.all([
      sb.from('ledger_entries').select('id,kind,wallet_delta,reason,earned_at').eq('user_id', uid)
        .order('earned_at', { ascending: false }).order('id', { ascending: false }).limit(50),
      sb.from('contributions').select('ledger_entry_id,url').eq('user_id', uid)
    ]);
    var list = $('act-list');
    list.textContent = '';
    if (res[0].error) { $('act-empty').hidden = false; $('act-empty').textContent = fail(res[0].error); return; }
    var rows = res[0].data || [];
    var urls = {};
    ((res[1] && res[1].data) || []).forEach(function (c) { if (HTTPS.test(c.url || '')) urls[c.ledger_entry_id] = c.url; });
    $('act-empty').textContent = 'Nothing yet. Coins show up here when a pull request for a task is merged or your feedback is accepted.';
    $('act-empty').hidden = rows.length > 0;
    rows.forEach(function (r) {
      var li = el('li', 'act-row');
      li.appendChild(el('span', 'when', cairoDate(r.earned_at)));
      var what = el('span', 'what');
      if (urls[r.id]) {
        var a = el('a', null, r.reason);
        a.href = urls[r.id]; a.target = '_blank'; a.rel = 'noopener noreferrer';
        what.appendChild(a);
      } else {
        what.textContent = r.reason;
      }
      li.appendChild(what);
      li.appendChild(el('span', 'num' + (r.wallet_delta < 0 ? ' minus' : ''), signed(r.wallet_delta)));
      list.appendChild(li);
    });
  }

  /* ----- feedback ----- */
  var STATUS_WORDS = { pending: 'waiting', accepted: 'accepted', rejected: 'not accepted', duplicate: 'duplicate' };

  async function loadFeedback() {
    var r = await sb.from('feedback_submissions').select('id,body,context,status,amount,note,created_at,reviewed_at')
      .order('created_at', { ascending: false }).limit(20);
    var list = $('fb-list');
    list.textContent = '';
    if (r.error) { $('fb-empty').hidden = false; $('fb-empty').textContent = fail(r.error); return; }
    var rows = r.data || [];
    $('fb-empty').textContent = 'You have not sent any feedback yet.';
    $('fb-empty').hidden = rows.length > 0;
    $('fb-head').hidden = rows.length === 0;
    rows.forEach(function (f) {
      var li = el('li');
      var tags = el('div', 'tags');
      tags.appendChild(el('span', 'when', cairoDate(f.created_at)));
      tags.appendChild(el('span', 'tag' + (f.status === 'accepted' ? ' on' : ''), STATUS_WORDS[f.status] || String(f.status)));
      if (f.status === 'accepted' && f.amount > 0) tags.appendChild(el('span', 'tag on', signed(f.amount) + ' coins'));
      li.appendChild(tags);
      li.appendChild(el('div', 'what pre', f.body));
      if (f.context) li.appendChild(el('div', 'meta-line', 'where: ' + f.context));
      if (f.note) li.appendChild(el('div', 'meta-line pre', 'reply: ' + f.note));
      list.appendChild(li);
    });
  }

  async function sendFeedback(ev) {
    ev.preventDefault();
    var form = ev.target, btn = form.querySelector('button[type=submit]');
    var v = feedbackInput(form.elements.body.value, form.elements.context.value);
    if (v.error) { flash('status-feedback', v.error, true); return; }
    busy(btn, true);
    var r = await sb.rpc('submit_feedback', v.data);
    busy(btn, false);
    if (r.error) { flash('status-feedback', fail(r.error), true); return; }
    form.reset();
    flash('status-feedback', 'sent');
    loadFeedback();
  }

  /* ----- start ----- */
  function start(session) {
    var id = session && session.user && session.user.id;
    if (!id || started === id) return;
    started = id; uid = id;
    refreshGithub(true).catch(function () { renderGithub(fail(null), true); });
    loadActivity().catch(function () {});
    loadFeedback().catch(function () {});
  }

  function stop() {
    started = null; uid = null;
    gh = { link: null, identity: null, others: 0 };
    ['act-list', 'fb-list'].forEach(function (id) { $(id).textContent = ''; });
    $('gh-status').textContent = '';
  }

  function init() {
    if (!FG || !FG.sb || !$('rw-github')) return;
    sb = FG.sb;
    $('gh-connect').addEventListener('click', connect);
    $('gh-unlink').addEventListener('click', unlink);
    $('form-feedback').addEventListener('submit', sendFeedback);
    FG.ready.then(function (r) { if (r && r.session) start(r.session); });
    FG.onAuth(function (s) { if (s) start(s); else stop(); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
