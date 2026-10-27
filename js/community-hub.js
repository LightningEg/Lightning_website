// Community hub: the top five builders this month, each with their GitHub and last merged pull request.
// Real rows only (the leaderboard RPC lists members who switched it on); no sample people here.
// Member text goes in with textContent; links are checked (https, GitHub login shape) before use.
(function () {
  'use strict';
  var FG = window.FG;
  var list = document.getElementById('hb-list'), empty = document.getElementById('hb-empty'), status = document.getElementById('hb-status');
  if (!list) return;
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  var https = function (u) { try { var p = new URL(u); return p.protocol === 'https:' && !p.username && !p.password ? p.href : null; } catch (_) { return null; } };
  var link = function (href, cls, text) { var a = el('a', cls, text); a.href = href; a.rel = 'noopener nofollow ugc'; a.target = '_blank'; return a; };
  var nf = new Intl.NumberFormat('en');
  function row(r, i) {
    var li = el('li', 'hb-row');
    li.style.setProperty('--i', i);
    li.appendChild(el('span', 'hb-rk', String(r.rank || i + 1)));
    var who = el('div', 'hb-who');
    var name = el('a', 'hb-name', r.display_name || '');
    name.href = window.FGShow ? window.FGShow.profileHref(r.display_name) : 'leaderboard.html';
    who.appendChild(name);
    var meta = el('p', 'hb-meta');
    var login = typeof r.github_login === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(r.github_login) ? r.github_login : null;
    if (login) meta.appendChild(link('https://github.com/' + login, 'hb-gh', '@' + login));
    var pr = typeof r.last_merge_url === 'string' && https(r.last_merge_url);
    if (pr && typeof r.last_merge_title === 'string' && r.last_merge_title.trim()) {
      if (meta.childNodes.length) meta.appendChild(document.createTextNode(' · '));
      meta.appendChild(link(pr, 'hb-pr', r.last_merge_title.trim()));
    }
    if (meta.childNodes.length) who.appendChild(meta);
    li.appendChild(who);
    var sc = el('span', 'hb-sc', nf.format(Number(r.score) || 0));
    sc.setAttribute('aria-label', 'score ' + (Number(r.score) || 0));
    li.appendChild(sc);
    return li;
  }
  Promise.resolve(FG && FG.ready).then(function () {
    if (!FG || !FG.sb) throw new Error('offline');
    return FG.sb.rpc('leaderboard', { p_period: 'month', p_limit: 5 });
  }).then(function (res) {
    if (res.error) throw res.error;
    var rows = (res.data || []).slice(0, 5);
    status.hidden = true;
    if (!rows.length) { empty.hidden = false; return; }
    rows.forEach(function (r, i) { list.appendChild(row(r, i)); });
    list.hidden = false;
    FG.sb.rpc('supporter_levels').then(function(s){ if(s.error || !Array.isArray(s.data)) return; s.data.forEach(function(x){ Array.from(list.children).forEach(function(li){ if(li.querySelector('.hb-name').textContent===x.display_name) li.querySelector('.hb-who').appendChild(el('span','hb-supporter',x.supporter_level)); }); }); });
    // Where each score comes from (score_sources RPC); skipped quietly if it is not there yet.
    FG.sb.rpc('score_sources', { p_period: 'month', p_limit: 25 }).then(function (s) {
      if (s.error || !s.data) return;
      var by = {}; s.data.forEach(function (x) { by[x.display_name] = x; });
      [].forEach.call(list.children, function (li) {
        var x = by[li.querySelector('.hb-name').textContent]; if (!x) return;
        var bar = el('p', 'hb-src');
        [['code', 'code'], ['feedback', 'feedback'], ['writing', 'writing']].forEach(function (k) {
          var n = Number(x[k[0]]) || 0; if (n > 0) bar.appendChild(el('span', 'hb-src-' + k[0], k[1] + ' ' + nf.format(n)));
        });
        if (bar.childNodes.length) li.querySelector('.hb-who').appendChild(bar);
      });
    });
  }).catch(function () {
    status.textContent = 'The leaderboard did not load. ';
    var a = el('a', '', 'Open it'); a.href = 'leaderboard.html'; status.appendChild(a);
  });
})();
