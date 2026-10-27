// One story card for every place stories appear (stories page, Guides strip, profile). Member text uses textContent only.
(function (root) {
  'use strict';
  var doc = root.document;
  var AR = /^ar/i.test(doc.documentElement.lang || '');
  var SOURCES = [
    ['linkedin_url', /^https:\/\/www\.linkedin\.com\/(posts\/|feed\/update\/)/, AR ? 'اقرأ على لينكدإن' : 'Read on LinkedIn'],
    ['reddit_url', /^https:\/\/www\.reddit\.com\/r\/[A-Za-z0-9_]+\/comments\//, AR ? 'اقرأ على ريديت' : 'Read on Reddit']
  ];
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function excerpt(text, n) { var t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; }
  // The site hosts no story text: a card is a title, a short summary and links to the author's own post.
  function firstSource(s) {
    for (var i = 0; i < SOURCES.length; i++) { var u = s[SOURCES[i][0]]; if (typeof u === 'string' && SOURCES[i][1].test(u)) return u; }
    return null;
  }
  function card(s) {
    var S = root.FGShow;
    var a = el('article', 'story-card');
    var head = el('div', 'story-by');
    if (S) head.appendChild(S.avatar(s.author, s.avatar_url, 'av', s.frame_item_id));
    var who = el('a', 'story-author', s.author || '');
    if (S) who.href = S.profileHref(s.author);
    var bd = S && S.badge ? S.badge(s.badge_item_id) : null;
    if (bd) who.appendChild(bd);
    head.appendChild(who);
    if (s.published_at) {
      var d = new Date(s.published_at);
      if (!isNaN(d)) head.appendChild(el('time', 'story-date', d.toISOString().slice(0, 10)));
    }
    var h = el('h3', 'story-title');
    var out = firstSource(s);
    if (out) { var l = el('a', '', s.title); l.href = out; l.target = '_blank'; l.rel = 'noopener noreferrer'; h.appendChild(l); } else h.textContent = s.title;
    a.append(h, head);
    var body = el('p', 'story-body', excerpt(s.summary, 400));
    a.appendChild(body);
    var foot = el('div', 'story-foot');
    SOURCES.forEach(function (x) {
      if (typeof s[x[0]] === 'string' && x[1].test(s[x[0]])) {
        var l2 = el('a', 'story-src', x[2] + ' ↗'); l2.className = 'story-src btn-link'; l2.href = s[x[0]]; l2.target = '_blank'; l2.rel = 'noopener noreferrer'; foot.appendChild(l2);
      }
    });
    if (foot.childNodes.length) a.appendChild(foot);
    return a;
  }
  root.FGStory = { card: card, excerpt: excerpt };
})(window);
