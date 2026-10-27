/* Owner console, Community view (admin.html #social): merges held for GitHub accounts that are not linked yet
   (admin_held_awards) and the story reward settings (admin_story_ladder / admin_set_story_ladder: coins, points and the blog
   bonus). The story review queue itself is js/store-admin.js with js/story-moderation.js. Every figure and name is set with
   textContent; the server (supabase/migrations/20261027210000_owner_console_seats_and_community.sql) checks everything. */
(function () {
  'use strict';
  var doc = document, FG = window.FG;
  var $ = function (id) { return doc.getElementById(id); };
  var list = $('ops-held-list'), form = $('ops-rewards');
  if (!list || !form || !FG) return;
  var verified = false;
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function num(n) { return Math.round(Number(n || 0)).toLocaleString('en-US'); }
  function rpc(name, args) { return Promise.resolve(FG.sb.rpc(name, args)).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function say(e) { return FG.say ? FG.say(e) : (e && e.message) || 'Could not complete this.'; }
  function safe(u) { try { var p = new URL(u); return p.protocol === 'https:' && p.hostname === 'github.com' ? p.href : null; } catch (_) { return null; } }

  function drawHeld(rows) {
    list.textContent = '';
    if (!rows.length) { list.appendChild(el('p', 'ops-empty', 'Nothing is waiting. Every merged pull request has been paid to a linked account.')); return; }
    var ul = el('ul', 'oc-held');
    rows.forEach(function (r) {
      var li = el('li');
      var who = el('b', null, '@' + r.github_login);
      var pr = safe(r.pr_url), title = (r.repository || '') + ' #' + r.pr_number;
      var what = pr ? el('a', null, title) : el('span', null, title);
      if (pr) { what.href = pr; what.target = '_blank'; what.rel = 'noopener noreferrer'; }
      var pays = el('span', 'oc-chip', r.kind === 'points' ? num(r.amount) + ' points' : num(r.amount) + ' coins');
      li.append(who, what, pays, el('small', null, 'merged ' + String(r.merged_at).slice(0, 10)));
      ul.appendChild(li);
    });
    list.appendChild(ul);
  }
  function load() {
    return Promise.all([
      rpc('admin_held_awards').then(drawHeld, function (e) { list.textContent = ''; list.appendChild(el('p', 'ops-empty', 'What is held did not load. ' + say(e))); }),
      rpc('admin_story_ladder').then(function (l) {
        if (doc.activeElement !== form.elements.coins) form.elements.coins.value = l.coins;
        if (doc.activeElement !== form.elements.points) form.elements.points.value = l.points;
        if (doc.activeElement !== form.elements.blog_coins) form.elements.blog_coins.value = l.blog_coins;
      }, function () {})]);
  }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var out = $('ops-rewards-status'), b = form.querySelector('button');
    b.disabled = true; out.textContent = '';
    rpc('admin_set_story_ladder', { p_coins: Number(form.elements.coins.value), p_points: Number(form.elements.points.value), p_blog_coins: Number(form.elements.blog_coins.value) }).then(function () {
      out.textContent = 'Saved. It applies to the next approval and the next blog bonus.';
      var refresh = $('store-social-refresh'); if (refresh) refresh.click(); // the queue shows the new amounts
      return load();
    }).catch(function (e) { out.textContent = say(e); }).then(function () { b.disabled = false; });
  });
  window.addEventListener('lightning:owner-access', function (e) { verified = !!(e.detail && e.detail.verified); if (verified) load(); });
  window.addEventListener('lightning:owner-view', function (e) { if (verified && e.detail && e.detail.view === 'social') load(); });
  window.addEventListener('lightning:owner-changed', function () { if (verified) load(); });
})();
