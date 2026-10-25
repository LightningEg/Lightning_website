/* For Geeks member profile (forgeeks-profile.html?u=<display name>).
   Reads two public database functions with the publishable key:
     get_profile(p_name)       the profile if it is visible to this visitor, else no row
     get_profile_work(p_name)  verified work first, then self-reported links
   A signed-in visitor who is not the owner can report the profile (report_profile). A missing, private,
   suspended or members-only-while-signed-out profile all look the same: one calm line.
   Every member-written string goes on the page with textContent (js/forgeeks-showcase.js). */
(function (root) {
  'use strict';
  var doc = root.document;
  var S = root.FGShow;
  var FG = root.FG;
  var NAME_MAX = 40;
  var SUFFIX = ' · For Geeks · Lightning';
  var $ = function (id) { return doc.getElementById(id); };

  var token = 0;
  var current = null;   // the profile on screen

  /* ---------- which profile ---------- */
  function wanted() {
    var u;
    try { u = new URLSearchParams(root.location.search).get('u'); } catch (e) { u = null; }
    if (typeof u !== 'string') return null;
    u = u.trim();
    return u.length >= 2 && u.length <= NAME_MAX ? u : null;
  }

  function same(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }
  function first(d) { return Array.isArray(d) ? d[0] : d; }

  /* ---------- states ---------- */
  function clear() {
    ['pf-banner', 'pf-av', 'pf-bio', 'pf-ranks', 'pf-actions', 'pf-work-sec', 'pf-setup-sec', 'pf-missing', 'pf-retry']
      .forEach(function (id) { $(id).hidden = true; });
    $('pf-name').textContent = '';
    doc.title = 'Profile' + SUFFIX;
  }

  function status(text) { var s = $('pf-status'); s.textContent = text || ''; s.hidden = !text; }

  function missing() {
    clear();
    status('');
    current = null;
    $('pf-name').textContent = 'There is no profile to show here.';
    $('pf-missing').hidden = false;
  }

  function failed() {
    clear();
    current = null;
    status('The profile did not load. Try again.');
    $('pf-retry').hidden = false;
  }

  /* ---------- sections ---------- */
  function ranks(p) {
    var ul = $('pf-ranks');
    ul.textContent = '';
    function chip(text) { ul.appendChild(S.el('li', '', text)); }
    if (p.rank_month != null) chip('rank ' + S.num(p.rank_month) + ' this month');
    if (p.rank_all != null) chip('rank ' + S.num(p.rank_all) + ' all time');
    if (p.contribution_score != null && isFinite(Number(p.contribution_score))) chip(S.num(p.contribution_score) + ' score');
    if (p.visibility === 'members') chip('signed-in members only');
    ul.hidden = !ul.children.length;
  }

  function workRow(w) {
    var li = S.el('li');
    var verified = w.verified === true;
    li.appendChild(S.el('span', 'tag' + (verified ? '' : ' self'), verified ? 'verified' : 'self-reported'));
    var body = S.el('div', 'wk');
    var title = typeof w.title === 'string' ? w.title : '';
    var url = S.httpsUrl(w.url);
    var t = url ? S.link(url, title || url, 't') : S.el('span', 't', title);
    body.appendChild(t);
    var meta = S.el('p', 'm');
    var bits = [];
    if (verified) {
      if (w.repository) bits.push(S.el('span', '', String(w.repository)));
      if (w.pr_number != null && url) bits.push(S.link(url, 'pr #' + Number(w.pr_number)));
      var issue = S.issueUrl(w.repository, w.issue_number);
      if (issue) bits.push(S.link(issue, 'issue #' + Number(w.issue_number)));
      var d = S.ymd(w.merged_at);
      if (d) bits.push(S.el('span', '', 'merged ' + d));
    } else if (url) {
      bits.push(S.el('span', '', S.host(url)));
    }
    bits.forEach(function (b, i) {
      if (i) meta.appendChild(doc.createTextNode(' · '));
      meta.appendChild(b);
    });
    if (bits.length) body.appendChild(meta);
    li.appendChild(body);
    return li;
  }

  function work(res) {
    var sec = $('pf-work-sec'), ul = $('pf-work');
    ul.textContent = '';
    if (res && res.error) {
      ul.appendChild(S.el('li', 'note', 'The work list did not load. Reload to try again.'));
      sec.hidden = false;
      return;
    }
    var rows = res && Array.isArray(res.data) ? res.data : [];
    rows.forEach(function (w) { if (w && typeof w.title === 'string') ul.appendChild(workRow(w)); });
    sec.hidden = !ul.children.length;
  }

  function setupRow(dl, label, value) {
    if (value == null) return;
    var dt = S.el('dt', '', label);
    var dd = S.el('dd');
    if (typeof value === 'string') dd.textContent = value; else dd.appendChild(value);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function setup(p) {
    var dl = $('pf-setup');
    dl.textContent = '';
    function text(v) { return typeof v === 'string' && v.trim() ? v.trim() : null; }
    function list(v) {
      var a = (Array.isArray(v) ? v : []).filter(function (x) { return typeof x === 'string' && x.trim(); });
      return a.length ? a.join(', ') : null;
    }
    function outside(v) {
      var url = S.httpsUrl(v);
      return url ? S.link(url, S.host(url) + ' ↗') : null;
    }
    setupRow(dl, 'editor', text(p.setup_editor));
    setupRow(dl, 'system', text(p.setup_os));
    setupRow(dl, 'languages', list(p.setup_languages));
    setupRow(dl, 'tools', list(p.setup_tools));
    setupRow(dl, 'notes', text(p.setup_notes));
    setupRow(dl, 'dotfiles', outside(p.dotfiles_url));
    setupRow(dl, 'portfolio', outside(p.portfolio_url));
    $('pf-setup-sec').hidden = !dl.children.length;
  }

  function actions(p, me) {
    var signedIn = !!(FG.session && FG.session());
    var owner = !!(me && same(me.display_name, p.display_name));
    $('pf-edit').hidden = !owner;
    $('pf-report').hidden = !(signedIn && !owner);
    $('pf-actions').hidden = $('pf-edit').hidden && $('pf-report').hidden;
  }

  function render(p, workRes, me) {
    clear();
    status('');
    current = p;
    doc.title = p.display_name + SUFFIX;
    $('pf-name').textContent = p.display_name;
    var oldBadge = $('pf-name').parentNode.querySelector('.fg-badge');
    if (oldBadge) oldBadge.remove();
    var pb = S.badge(p.badge_item_id);
    if (pb) $('pf-name').after(pb);
    var b = $('pf-banner');
    var item = S.itemId(p.banner_item_id);
    if (item) b.setAttribute('data-item', item); else b.removeAttribute('data-item');
    b.hidden = false;
    var av = S.avatar(p.display_name, p.avatar_url, 'av xl', p.frame_item_id);
    av.id = 'pf-av';
    $('pf-av').replaceWith(av);
    var bio = $('pf-bio');
    bio.textContent = typeof p.bio === 'string' ? p.bio.trim() : '';
    bio.hidden = !bio.textContent;
    ranks(p);
    actions(p, me);
    work(workRes);
    setup(p);
  }

  /* ---------- load ---------- */
  function load() {
    var mine = ++token;
    var name = wanted();
    if (!name) { missing(); return; }
    clear();
    status('loading…');
    S.ready(FG).then(function () {
      if (mine !== token) return null;
      return FG.sb.rpc('get_profile', { p_name: name });
    }).then(function (res) {
      if (!res || mine !== token) return null;
      if (res.error) { failed(); return null; }
      var p = first(res.data);
      if (!p || typeof p.display_name !== 'string' || !p.display_name) { missing(); return null; }
      return Promise.all([
        FG.sb.rpc('get_profile_work', { p_name: p.display_name }).then(function (r) { return r; }, function (e) { return { error: e }; }),
        FG.me()
      ]).then(function (r) {
        if (mine === token) render(p, r[0], r[1]);
      });
    }).then(null, function () { if (mine === token) failed(); });
  }

  /* ---------- report ---------- */
  var REPORT_WORDS = [
    [/already have an open report/i, 'You already reported this profile. A moderator will look at it.'],
    [/too many reports/i, 'You reached today\'s limit of 10 reports. Try again tomorrow.'],
    [/cannot report your own/i, 'This is your own profile.'],
    [/profile not found/i, 'That profile is no longer shown.'],
    [/1 to 500/i, 'Write 1 to 500 characters.']
  ];

  function reportSays(err) {
    var m = String((err && err.message) || '');
    for (var i = 0; i < REPORT_WORDS.length; i++) if (REPORT_WORDS[i][0].test(m)) return REPORT_WORDS[i][1];
    return FG.say(err);
  }

  function openReport() {
    var d = $('rp');
    $('rp-reason').value = '';
    $('rp-count').textContent = '0 / 500';
    $('rp-status').textContent = '';
    $('rp-status').className = 'rp-status';
    $('rp-send').hidden = false;
    $('rp-send').disabled = false;
    $('rp-cancel').textContent = 'cancel';
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
    $('rp-reason').focus();
  }

  function closeReport() {
    var d = $('rp');
    if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
    $('pf-report').focus();
  }

  function sendReport(ev) {
    ev.preventDefault();
    if (!current) return;
    var reason = $('rp-reason').value.trim();
    var st = $('rp-status');
    if (reason.length < 1 || reason.length > 500) {
      st.textContent = 'Write 1 to 500 characters.';
      st.className = 'rp-status bad';
      return;
    }
    $('rp-send').disabled = true;
    st.className = 'rp-status';
    st.textContent = 'sending…';
    FG.sb.rpc('report_profile', { p_name: current.display_name, p_reason: reason }).then(function (res) {
      if (res.error) {
        st.textContent = reportSays(res.error);
        st.className = 'rp-status bad';
        $('rp-send').disabled = false;
        return;
      }
      st.textContent = 'Thanks. A moderator will look at it.';
      st.className = 'rp-status ok';
      $('rp-send').hidden = true;
      $('rp-cancel').textContent = 'close';
    }, function (e) {
      st.textContent = reportSays(e);
      st.className = 'rp-status bad';
      $('rp-send').disabled = false;
    });
  }

  /* ---------- start ---------- */
  function init() {
    if (!FG || !FG.sb || !S) {
      clear();
      status('This profile is not available right now.');
      return;
    }
    $('pf-retry').addEventListener('click', load);
    $('pf-report').addEventListener('click', openReport);
    $('rp-cancel').addEventListener('click', closeReport);
    $('rp-form').addEventListener('submit', sendReport);
    $('rp-reason').addEventListener('input', function () {
      $('rp-count').textContent = $('rp-reason').value.length + ' / 500';
    });
    load();
    // Signing in or out changes what this visitor may see and do here.
    FG.onAuth(function () { load(); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(window);
