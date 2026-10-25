/* For Geeks showcase: helpers shared by the leaderboard (forgeeks-leaderboard.html) and the member profile
   (forgeeks-profile.html). Everything a member typed (name, bio, tags, link labels) is only ever put on the
   page with textContent; links must be https and open in a new tab; an avatar is https, sent without a
   referrer, and falls back to the first letter of the name. Pure helpers are tested in node
   (supabase/tests/showcase-pages.test.mjs). Load after js/forgeeks-auth.js. */
(function (root) {
  'use strict';

  var ITEM_RE = /^[a-z0-9-]{2,60}$/;      // catalog item ids (supabase catalog_items.id)
  var REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/;   // owner/name; the name is never . or ..

  /* ---------- pure helpers ---------- */

  // An https link without credentials, or null. Returns the normalised address.
  function httpsUrl(u) {
    if (typeof u !== 'string' || u.length > 2000 || !/^https:\/\/[^\s<>"'\\]+$/.test(u)) return null;
    try {
      var p = new URL(u);
      if (p.protocol !== 'https:' || p.username || p.password || !p.hostname) return null;
      return p.href;
    } catch (e) { return null; }
  }

  function host(u) {
    var h = httpsUrl(u);
    return h ? new URL(h).hostname.replace(/^www\./, '') : '';
  }

  function initial(name) {
    var c = String(name || '').trim().charAt(0);
    return c ? c.toUpperCase() : '?';
  }

  // The main site has its own profile page; For Geeks keeps forgeeks-profile.html.
  function profileHref(name) {
    var main = root.document && root.document.body && root.document.body.hasAttribute('data-main-store');
    return (main ? 'profile.html' : 'forgeeks-profile.html') + '?u=' + encodeURIComponent(String(name));
  }

  function num(n) {
    n = Number(n);
    return isFinite(n) ? n.toLocaleString('en-US') : '0';
  }

  // yyyy-mm-dd from a database timestamp, or ''.
  function ymd(ts) {
    var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(ts || ''));
    return m ? m[1] : '';
  }

  // The rewarded issue's address, only for a repository name that is plainly owner/name.
  function issueUrl(repo, n) {
    n = Number(n);
    return typeof repo === 'string' && REPO_RE.test(repo) && !/\/\.+$/.test(repo) && n > 0 && n % 1 === 0
      ? 'https://github.com/' + repo + '/issues/' + n : null;
  }

  // Up to `max` short setup tags for a card: editor, system, languages, tools; no repeats, no empties.
  function tags(row, max) {
    var out = [], seen = {};
    function add(v) {
      if (typeof v !== 'string') return;
      v = v.trim();
      var k = v.toLowerCase();
      if (!v || seen[k] || out.length >= max) return;
      seen[k] = true;
      out.push(v);
    }
    add(row.setup_editor); add(row.setup_os);
    (Array.isArray(row.setup_languages) ? row.setup_languages : []).forEach(add);
    (Array.isArray(row.setup_tools) ? row.setup_tools : []).forEach(add);
    return out;
  }

  function itemId(v) { return typeof v === 'string' && ITEM_RE.test(v) ? v : ''; }

  var pure = { httpsUrl: httpsUrl, host: host, initial: initial, profileHref: profileHref, num: num, ymd: ymd,
    issueUrl: issueUrl, tags: tags, itemId: itemId };
  if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }

  /* ---------- browser: small builders, all text through textContent ---------- */
  var doc = root.document;

  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // An outside link: https only (else null), new tab, no referrer.
  function link(url, text, cls) {
    var href = httpsUrl(url);
    if (!href) return null;
    var a = el('a', cls || '', text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  // Frames and badges: purely visual catalog items. Only a well-formed catalog id reaches an attribute.
  var BADGES = {
    'badge-bolt': ['Bolt', 'M13 2 4 14h6l-1 8 9-12h-6z'],
    'badge-coin': ['Coin', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v10m-3-7c0-1.4 1.3-2 3-2s3 .6 3 2-1.3 1.8-3 2-3 .6-3 2 1.3 2 3 2 3-.6 3-2'],
    'badge-pen': ['Writer', 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3'],
    'badge-star': ['Star', 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z']
  };
  function badge(id) {
    var item = itemId(id), def = item && BADGES[item];
    if (!def) return null;
    var NS = 'http://www.w3.org/2000/svg';
    var b = el('span', 'fg-badge');
    b.setAttribute('data-item', item);
    b.setAttribute('title', def[0]);
    var svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    var path = doc.createElementNS(NS, 'path');
    path.setAttribute('d', def[1]);
    svg.appendChild(path); b.appendChild(svg);
    var t = el('span', 'sr', def[0] + ' badge');
    b.appendChild(t);
    return b;
  }

  function avatar(name, url, cls, frameId) {
    var av = el('span', cls || 'av');
    var fr = itemId(frameId);
    if (fr) av.setAttribute('data-frame', fr);
    av.setAttribute('aria-hidden', 'true');
    var src = httpsUrl(url);
    if (src) {
      var img = doc.createElement('img');
      img.alt = '';
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
      img.addEventListener('error', function () { av.textContent = initial(name); });
      img.src = src;
      av.appendChild(img);
    } else {
      av.textContent = initial(name);
    }
    return av;
  }

  // The cosmetic banner (css/forgeeks-cosmetics.css). Only a well-formed catalog id reaches the attribute.
  function banner(id) {
    var b = el('div', 'fg-banner');
    var item = itemId(id);
    if (item) b.setAttribute('data-item', item);
    b.setAttribute('aria-hidden', 'true');
    return b;
  }

  // Wait for the stored session (so members-only profiles show), but never hang a public page on it.
  function ready(FG, ms) {
    return Promise.race([
      FG.ready,
      new Promise(function (r) { root.setTimeout(r, ms || 4000); })
    ]).then(function () {}, function () {});
  }

  var api = {};
  for (var k in pure) api[k] = pure[k];
  api.el = el; api.link = link; api.avatar = avatar; api.banner = banner; api.badge = badge; api.ready = ready;
  root.FGShow = api;
})(typeof window !== 'undefined' ? window : globalThis);
