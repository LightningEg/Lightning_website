// Community pulse (Home): one quiet line of real activity, never money.
// Shared stories from the community feed (people telling how they use Lightning); developer activity never shows here.
// Nothing is made up: with no activity, or offline, the line stays hidden.
(function () {
  'use strict';
  var host = document.querySelector('[data-pulse]');
  if (!host) return;
  var line = host.querySelector('.pulse-line');
  var ar = document.documentElement.lang.indexOf('ar') === 0;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var items = [];
  var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var bdi = function (t) { return '<bdi>' + esc(t) + '</bdi>'; };

  var stories = new Promise(function (done) {
    var FG = window.FG;
    if (!FG) return done();
    Promise.resolve(FG.ready).then(function () {
      if (!FG.sb) return done();
      return FG.sb.rpc('stories_feed', { p_id: null, p_author: null }).then(function (r) {
        (r && r.data || []).slice(0, 4).forEach(function (s) {
          var name = s.author;
          if (!name) return;
          var link = '<a href="' + (ar ? '../' : '') + 'stories.html">' + bdi(name) + '</a>';
          items.push({ t: Date.parse(s.created_at || s.published_at) || 0, html: ar ? link + ' حكى إزاي بيستخدم لايتنينج' : link + ' shared how they use Lightning' });
        });
        done();
      });
    }).catch(function () { done(); });
  });

  stories.then(function () {
    if (!items.length) return;
    items.sort(function (a, b) { return b.t - a.t; });
    var i = 0;
    line.innerHTML = items[0].html;
    host.hidden = false;
    if (items.length < 2 || reduce) return;
    setInterval(function () {
      if (document.hidden || host.matches(':hover,:focus-within')) return;
      line.classList.add('is-out');
      setTimeout(function () { i = (i + 1) % items.length; line.innerHTML = items[i].html; line.classList.remove('is-out'); }, 350);
    }, 4200);
  });
})();
