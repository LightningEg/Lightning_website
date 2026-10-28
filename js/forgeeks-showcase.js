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
    // Lightning's own two-leaf mark (assets/brand/lightning-mark.svg, scaled to 24): never a generic bolt (owner, 2026-10-28)
    'badge-bolt': ['Lightning mark', [['leaf-a', 'M12 2.78C12 2.28 11.57 2 11.15 2.25L8.45 3.63C6.26 4.73 4.91 6.75 4.91 9.52L4.91 15.97C4.91 17.74 6.33 18.45 7.82 17.6L12 15.55Z'],
      ['leaf-a lit', 'M4.91 11.89L12 8.45L12 15.55L7.82 17.6C6.33 18.45 4.91 17.74 4.91 15.97Z'],
      ['leaf-b', 'M12 21.22C12 21.72 12.43 22 12.85 21.75L15.55 20.37C17.74 19.27 19.09 17.25 19.09 14.48L19.09 8.03C19.09 6.26 17.67 5.55 16.18 6.4L12 8.45Z'],
      ['leaf-b lit', 'M19.09 12.11L12 15.55L12 8.45L16.18 6.4C17.67 5.55 19.09 6.26 19.09 8.03Z']]],
    'badge-coin': ['Coin', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v10m-3-7c0-1.4 1.3-2 3-2s3 .6 3 2-1.3 1.8-3 2-3 .6-3 2 1.3 2 3 2 3-.6 3-2'],
    'badge-pen': ['Writer', 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3'],
    'badge-star': ['Star', 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'],
    // earned by topping up (supporter release): a heart in a shield, one shape, three metals
    'badge-supporter-bronze': ['Bronze supporter', 'M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6zm0 13-3.2-3.1a2 2 0 0 1 3.2-2.4 2 2 0 0 1 3.2 2.4z'],
    'badge-supporter-silver': ['Silver supporter', 'M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6zm0 13-3.2-3.1a2 2 0 0 1 3.2-2.4 2 2 0 0 1 3.2 2.4z'],
    'badge-supporter-gold': ['Gold supporter', 'M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6zm0 13-3.2-3.1a2 2 0 0 1 3.2-2.4 2 2 0 0 1 3.2 2.4z'],
    'badge-supporter-true': ['True supporter', [['', 'M12 2 4 6v6c0 5 4 8 8 10 4-2 8-5 8-10V6z'],
      ['leaf-a', 'M12 6.96C12 6.7 11.78 6.55 11.55 6.68L10.14 7.41C8.98 7.98 8.28 9.04 8.28 10.50L8.28 13.89C8.28 14.82 9.02 15.19 9.8 14.74L12 13.66Z'],
      ['leaf-b', 'M12 16.64C12 16.9 12.22 17.05 12.45 16.92L13.86 16.19C15.02 15.62 15.72 14.56 15.72 13.10L15.72 9.71C15.72 8.78 14.98 8.41 14.2 8.86L12 9.94Z']]],
    'badge-founding': ['Founding supporter', 'M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.4 7.2 16.9l.9-5.4L4.2 7.7l5.4-.8zM8 20h8'],
    // seasonal
    'badge-cotton-boll': ['Cotton boll', 'M12 21v-6m0 0c-3 0-5-2-5-4.5S9 6 12 8c3-2 5 0 5 2.5S15 15 12 15zM9 6.5a3 3 0 0 1 6 0'],
    'badge-lantern': ['Fanous', 'M12 2v2m-3 2h6l1 3-1 8H9L8 9zm-1 3h8m-6 8 1 3h2l1-3']
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
    // One stroked path, or parts: [class, d] each, where a leaf-* part is filled in the mark's colours.
    (typeof def[1] === 'string' ? [['', def[1]]] : def[1]).forEach(function (part) {
      var path = doc.createElementNS(NS, 'path');
      if (part[0]) path.setAttribute('class', part[0]);
      path.setAttribute('d', part[1]);
      svg.appendChild(path);
    });
    b.appendChild(svg);
    var t = el('span', 'sr', def[0] + ' badge');
    b.appendChild(t);
    return b;
  }

  // A name style (type 'name') paints the display name itself; only a well-formed name-* id reaches the attribute.
  function nameStyle(node, id) {
    var item = itemId(id);
    if (node && item && /^name-/.test(item)) node.setAttribute('data-name-style', item);
    return node;
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
  api.el = el; api.link = link; api.avatar = avatar; api.banner = banner; api.badge = badge; api.nameStyle = nameStyle; api.ready = ready;
  root.FGShow = api;
})(typeof window !== 'undefined' ? window : globalThis);
