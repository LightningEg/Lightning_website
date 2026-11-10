/* For Geeks leaderboard and members directory (forgeeks-leaderboard.html).
   With ?sample the board shows made-up people instead (lb-sample says so).
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
  var sample = /[?&]sample(=|&|$)/.test(root.location.search);
  var boardCache = {};
  var previousRanks = {}, levels = {};
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

  // What a coder advertises (8Q): their GitHub login, the title of their last merged pull request, merges this month and
  // their portfolio. Every link is checked here: https only, a GitHub login of the allowed shape, text only.
  function httpsUrl(u) {
    if (typeof u !== 'string' || u.length > 500) return null;
    try { var p = new root.URL(u); return p.protocol === 'https:' && !p.username && !p.password ? p.href : null; } catch (_) { return null; }
  }
  function ext(href, cls, text) {
    var a = S.el('a', cls, text);
    a.href = href;
    a.rel = 'noopener nofollow ugc';
    return a;
  }
  function coderLine(r) {
    if (sample) return null;
    var parts = [];
    var login = typeof r.github_login === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(r.github_login) ? r.github_login : null;
    if (login) parts.push(ext('https://github.com/' + login, 'lb-gh', '@' + login));
    var pr = httpsUrl(r.last_merge_url);
    if (pr && typeof r.last_merge_title === 'string' && r.last_merge_title.trim()) parts.push(ext(pr, 'lb-pr', r.last_merge_title.trim()));
    var n = Number(r.merges_month);
    if (n > 0) parts.push(S.el('span', 'lb-n', S.num(n) + (n === 1 ? ' merge' : ' merges') + ' this month'));
    var site = httpsUrl(r.portfolio_url);
    if (site) parts.push(ext(site, 'lb-site', 'portfolio'));
    if (!parts.length) return null;
    var p = S.el('p', 'lb-coder');
    parts.forEach(function (x, i) { if (i) p.appendChild(doc.createTextNode(' · ')); p.appendChild(x); });
    return p;
  }

  // One table row per member: rank, display name, contributions and score, over the member's banner (owner, 2026-10-25).
  // Only a well-formed catalog id reaches the banner's attribute.
  function row(r) {
    var rank = Number(r.rank);
    var tr = S.el('tr', 'lb-row' + (rank >= 1 && rank <= 3 ? ' top' : ''));
    var rk = S.el('td', 'rk');
    rk.appendChild(S.el('span', 'lb-text', String(rank)));
    if (S.itemId(r.banner_item_id)) {
      var bg = S.banner(r.banner_item_id);
      bg.classList.add('lb-bg');
      rk.appendChild(bg);
      rk.appendChild(S.el('span', 'lb-veil'));
      tr.classList.add('has-banner');
    }
    tr.appendChild(rk);
    var td = S.el('td', 'nm-c');
    var a = S.el(sample || r.preview_entry ? 'span' : 'a', 'nm', r.display_name);
    if (!sample && !r.preview_entry) a.href = S.profileHref(r.display_name);
    if (S.nameStyle) S.nameStyle(a, r.name_item_id);
    var nameWrap = S.el('span', 'lb-text lb-name-text');
    nameWrap.appendChild(a);
    td.appendChild(nameWrap);
    // The supporter level is a badge beside the name (its name is the tooltip and the screen-reader text), never words.
    var sup = !r.preview_entry && levels[r.display_name] && S.badge(levels[r.display_name]);
    if (sup) td.appendChild(sup);
    var coder = coderLine(r);
    if (coder) td.appendChild(coder);
    tr.appendChild(td);
    var ct = S.el('td', 'ct'), sc = S.el('td', 'sc');
    ct.appendChild(S.el('span', 'lb-text', S.num(Number(r.contribution_count) || 0)));
    sc.appendChild(S.el('span', 'lb-text', S.num(r.score)));
    tr.appendChild(ct); tr.appendChild(sc);
    return tr;
  }

  /* ---------- sample people (?sample): a filled table to look at, made in the page, never sent or saved ---------- */
  // Counts represent accepted feedback (10 points each). Monthly counts are a subset of all-time counts.
  var SAMPLE_PEOPLE = [
    ['Ahmed Hassan', 9, 24], ['Mariam Adel', 8, 19], ['Mohamed Samir', 7, 21],
    ['Omar Khaled', 7, 16], ['Youssef Mahmoud', 6, 18], ['Salma Fathy', 6, 14],
    ['Karim Mostafa', 5, 15], ['Mahmoud Tarek', 5, 12], ['Nourhan Ahmed', 4, 13],
    ['Mostafa Ibrahim', 4, 11], ['Amr Magdy', 3, 10], ['Hassan Wael', 3, 8],
    ['Aya Mohamed', 3, 7], ['Khaled Adel', 2, 6], ['Abdelrahman Ali', 2, 5],
    ['Seif Hamdy', 2, 4], ['Tamer Fouad', 1, 3], ['Hossam Nabil', 1, 2]
  ];
  var SAMPLE_BANNERS = ['banner-dusk', null, null, 'banner-felucca', null, null, 'banner-dunes', null, null];
  var SAMPLE_NAMES_STYLE = [null, null, 'name-gold', null, null, null, null, null, null];
  function sampleBoard(p) {
    var rows = SAMPLE_PEOPLE.map(function (person, i) {
      var count = person[p === 'month' ? 1 : 2];
      return { display_name: person[0], preview_entry: true, contribution_count: count, score: count * 10,
        banner_item_id: SAMPLE_BANNERS[i % SAMPLE_BANNERS.length], name_item_id: SAMPLE_NAMES_STYLE[i % SAMPLE_NAMES_STYLE.length] };
    });
    rows.sort(function (a, b) { return b.score - a.score; });
    // Equal scores share a rank, as on the server.
    rows.forEach(function (r, i) { r.rank = i && r.score === rows[i - 1].score ? rows[i - 1].rank : i + 1; });
    return rows;
  }

  // The main leaderboard includes temporary fictional feedback entries for the owner's visual review.
  function withPreviewEntries(rows, p) {
    var names = {};
    rows.forEach(function (r) { if (r && typeof r.display_name === 'string') names[r.display_name.toLowerCase()] = true; });
    var combined = rows.concat(sampleBoard(p).filter(function (r) { return !names[r.display_name.toLowerCase()]; }));
    combined.sort(function (a, b) { return Number(b.score) - Number(a.score); });
    combined.forEach(function (r, i) { r.rank = i && Number(r.score) === Number(combined[i - 1].score) ? combined[i - 1].rank : i + 1; });
    return combined.slice(0, BOARD_LIMIT);
  }

  function showBoard(rows) {
    var list = $('lb-list');
    var body = $('lb-body');
    body.textContent = '';
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
    good.forEach(function (r) { var tr=row(r); body.appendChild(tr); var old=previousRanks[period+':'+r.display_name]; if(!sample && old!=null && old!==Number(r.rank) && tr.animate && !root.matchMedia('(prefers-reduced-motion: reduce)').matches) tr.animate([{opacity:.5,transform:'translateY('+Math.max(-16,Math.min(16,(Number(r.rank)-old)*8))+'px)'},{opacity:1,transform:'none'}],{duration:300,easing:'ease-out'}); previousRanks[period+':'+r.display_name]=Number(r.rank); });
    $('lb-empty').hidden = true;
    list.hidden = false;
  }

  function loadBoard() {
    var mine = ++boardToken;
    var p = period;
    $('lb-panel').setAttribute('aria-labelledby', TAB_IDS[p]);
    if (sample) boardCache[p] = boardCache[p] || sampleBoard(p);
    if (boardCache[p]) { showBoard(boardCache[p]); return; }
    boardState('loading…');
    FG.sb.rpc('leaderboard', { p_period: p, p_limit: BOARD_LIMIT }).then(function (res) {
      if (mine !== boardToken) return;
      if (res.error) { boardState('The leaderboard did not load. Try again.', true); return; }
      boardCache[p] = doc.body.hasAttribute('data-main-store') ? withPreviewEntries(res.data || [], p) : (res.data || []);
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
    if (S.nameStyle) S.nameStyle(a, r.name_item_id);
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
    $('lb-sample').hidden = true;  // the owner's look test: the sample reads as a real board (2026-10-30); only ?sample shows it
    FG.sb.rpc('supporter_levels').then(function(res){ if(res.error || !Array.isArray(res.data))return; res.data.forEach(function(x){levels[x.display_name]=x.supporter_badge;}); if(boardCache[period])showBoard(boardCache[period]); });
    pick('month');
    loadMembers(true);
    // Signing in or out changes which profiles are visible (members-only ones), so ask again.
    FG.onAuth(function () { loadMembers(true); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(window);
