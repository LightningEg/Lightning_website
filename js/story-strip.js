// Latest community stories in a strip: [data-story-strip] on the Guides page, and on a profile (author = ?u=).
(function () {
  'use strict';
  var FG = window.FG, host = document.querySelector('[data-story-strip]');
  if (!FG || !host || !window.FGStory) return;
  var author = host.hasAttribute('data-by-profile') ? new URLSearchParams(location.search).get('u') : null;
  var list = host.querySelector('[data-story-list]'), empty = host.querySelector('[data-story-empty]');
  var limit = Number(host.getAttribute('data-limit')) || 3;
  Promise.resolve(FG.ready).then(function () {
    if (!FG.sb) throw new Error('offline');
    return FG.sb.rpc('stories_feed', { p_id: null, p_author: author });
  }).then(function (r) {
    if (r.error) throw r.error;
    var rows = (r.data || []).slice(0, limit);
    rows.forEach(function (s) { list.appendChild(window.FGStory.card(s)); });
    if (rows.length) host.hidden = false;
    else if (author) host.hidden = true; else { host.hidden = false; if (empty) empty.hidden = false; }
  }).catch(function () { host.hidden = true; });
})();
