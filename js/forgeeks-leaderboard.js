/* For Geeks leaderboard and members directory (forgeeks-leaderboard.html).
   Reads two public database functions with the publishable key, signed in or not:
     leaderboard(p_period, p_limit)      members who switched the leaderboard on, ranked (ties share a rank)
     member_directory(p_limit, p_offset) profiles members chose to show (members-only ones need a session)
   Every member-written string goes on the page with textContent (js/forgeeks-showcase.js). */
(function (root) {
  'use strict';
  var doc = root.document;
  var S = root.FGShow;
  var FG = root.FG;
  var BOARD_LIMIT = 50;
  var PAGE = 24;
  var TAB_IDS = { month: 'tab-month', all: 'tab-all' };
  var $ = function (id) { return doc.getElementById(id); };

  var period = 'month';
  var boardCache = {};
  var boardToken = 0, dirToken = 0, shown = 0;

  /* ---------- the board ---------- */
  function boardState(text, retry) {
    var s = $('lb-status');
    s.textContent = text || '';
    s.hidden = !text;
    var r = $('lb-retry');
    r.hidden = !retry;
    if (text) { $('lb-list').hidden = true; $('lb-empty').hidden = true; }
  }

  function row(r) {
    var rank = Number(r.rank);
    var li = S.el('li', 'lb-row');
    // the member's banner behind their row (owner, 2026-10-25); only a well-formed catalog id reaches the attribute
    if (S.itemId(r.banner_item_id)) {
      var bg = S.banner(r.banner_item_id);
      bg.classList.add('lb-bg');
      li.appendChild(bg);
      li.classList.add('has-banner');
    }
    li.appendChild(S.el('span', 'rk' + (rank >= 1 && rank <= 3 ? ' top' : ''), String(rank)));
    li.appendChild(S.avatar(r.display_name, r.avatar_url, 'av', r.frame_item_id));
    var a = S.el('a', 'nm', r.display_name);
    a.href = S.profileHref(r.display_name);
    var bd = S.badge(r.badge_item_id);
    if (bd) a.appendChild(bd);
    li.appendChild(a);
    var n = Number(r.contribution_count) || 0;
    var ct = S.el('span', 'ct');
    ct.appendChild(S.el('b', '', S.num(n)));
    ct.appendChild(S.el('small', '', n === 1 ? 'contribution' : 'contributions'));
    li.appendChild(ct);
    var sc = S.el('span', 'sc');
    sc.appendChild(S.el('b', '', S.num(r.score)));
    sc.appendChild(S.el('small', '', 'score'));
    li.appendChild(sc);
    return li;
  }

  function showBoard(rows) {
    var list = $('lb-list');
    list.textContent = '';
    var good = (Array.isArray(rows) ? rows : []).filter(function (r) {
      return r && typeof r.display_name === 'string' && r.display_name && Number(r.rank) >= 1;
    });
    boardState('');
    if (!good.length) {
      list.hidden = true;
      $('lb-empty-title').textContent = period === 'month' ? 'Nobody is ranked this month yet.' : 'Nobody is ranked yet.';
      $('lb-empty').hidden = false;
      return;
    }
    good.forEach(function (r) { list.appendChild(row(r)); });
    $('lb-empty').hidden = true;
    list.hidden = false;
  }

  function loadBoard() {
    var mine = ++boardToken;
    var p = period;
    $('lb-panel').setAttribute('aria-labelledby', TAB_IDS[p]);
    if (boardCache[p]) { showBoard(boardCache[p]); return; }
    boardState('loading…');
    FG.sb.rpc('leaderboard', { p_period: p, p_limit: BOARD_LIMIT }).then(function (res) {
      if (mine !== boardToken) return;
      if (res.error) { boardState('The leaderboard did not load. Try again.', true); return; }
      boardCache[p] = res.data || [];
      showBoard(boardCache[p]);
    }, function () {
      if (mine === boardToken) boardState('The leaderboard did not load. Try again.', true);
    });
  }

  function pick(p, focus) {
    if (!TAB_IDS[p]) return;
    period = p;
    Object.keys(TAB_IDS).forEach(function (k) {
      var t = $(TAB_IDS[k]);
      var on = k === p;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    loadBoard();
  }

  /* ---------- the members directory ---------- */
  function dirState(text, retry) {
    var s = $('mem-status');
    s.textContent = text || '';
    s.hidden = !text;
    $('mem-retry').hidden = !retry;
  }

  function card(r) {
    var c = S.el('article', 'mc');
    c.appendChild(S.banner(r.banner_item_id));
    var body = S.el('div', 'mc-body');
    var top = S.el('div', 'mc-top');
    top.appendChild(S.avatar(r.display_name, r.avatar_url, 'av lg', r.frame_item_id));
    if (r.contribution_score != null && isFinite(Number(r.contribution_score))) {
      top.appendChild(S.el('span', 'mc-sc', S.num(r.contribution_score) + ' score'));
    }
    body.appendChild(top);
    var h = S.el('h3', 'mc-name');
    var a = S.el('a', '', r.display_name);
    a.href = S.profileHref(r.display_name);
    var mb = S.badge(r.badge_item_id);
    if (mb) a.appendChild(mb);
    h.appendChild(a);
    body.appendChild(h);
    if (typeof r.bio === 'string' && r.bio.trim()) body.appendChild(S.el('p', 'mc-bio', r.bio.trim()));
    var t = S.tags(r, 4);
    if (t.length) {
      var ul = S.el('ul', 'mc-tags');
      ul.setAttribute('aria-label', 'Setup');
      t.forEach(function (x) { ul.appendChild(S.el('li', '', x)); });
      body.appendChild(ul);
    }
    c.appendChild(body);
    return c;
  }

  function loadMembers(reset) {
    var mine = ++dirToken;
    var grid = $('mem-grid');
    if (reset) { shown = 0; grid.textContent = ''; $('mem-more').hidden = true; }
    dirState('loading…');
    S.ready(FG).then(function () {
      if (mine !== dirToken) return null;
      return FG.sb.rpc('member_directory', { p_limit: PAGE, p_offset: shown });
    }).then(function (res) {
      if (!res || mine !== dirToken) return;
      if (res.error) { dirState('Members did not load. Try again.', true); return; }
      var rows = (Array.isArray(res.data) ? res.data : []).filter(function (r) {
        return r && typeof r.display_name === 'string' && r.display_name;
      });
      rows.forEach(function (r) { grid.appendChild(card(r)); });
      shown += Array.isArray(res.data) ? res.data.length : 0;
      $('mem-more').hidden = !(Array.isArray(res.data) && res.data.length >= PAGE);
      if (!grid.children.length) dirState('No profiles are shown yet.');
      else dirState('');
    }, function () {
      if (mine === dirToken) dirState('Members did not load. Try again.', true);
    });
  }

  /* ---------- start ---------- */
  function unavailable() {
    boardState('The leaderboard is not available right now.');
    dirState('Members are not available right now.');
  }

  function init() {
    if (!FG || !FG.sb || !S) { unavailable(); return; }
    var tabs = $('lb-tabs');
    tabs.addEventListener('click', function (ev) {
      var t = ev.target.closest('[role=tab]');
      if (t) pick(t.getAttribute('data-period'));
    });
    tabs.addEventListener('keydown', function (ev) {
      var order = ['month', 'all'];
      var i = order.indexOf(period);
      var next = ev.key === 'ArrowRight' ? order[(i + 1) % 2]
        : ev.key === 'ArrowLeft' ? order[(i + 1) % 2]
        : ev.key === 'Home' ? 'month' : ev.key === 'End' ? 'all' : null;
      if (next) { ev.preventDefault(); pick(next, true); }
    });
    $('lb-retry').addEventListener('click', function () { delete boardCache[period]; loadBoard(); });
    $('mem-retry').addEventListener('click', function () { loadMembers(true); });
    $('mem-more').addEventListener('click', function () { loadMembers(false); });
    pick('month');
    loadMembers(true);
    // Signing in or out changes which profiles are visible (members-only ones), so ask again.
    FG.onAuth(function () { loadMembers(true); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(window);
