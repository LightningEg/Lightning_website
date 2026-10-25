/* The market's shop floor, on the main-site Marketplace (marketplace.html, guideline Part B) and the For Geeks market
   (forgeeks-market.html, Part D): one structure, each site's own look (css/market-ui.css plus its page sheet).
   Your look, tabs (Themes, Banners, Frames, Badges, Owned), the app themes in testing, a detail window with the
   theme on the website, the computer and the phone, Try it for this visit, and a buy that says what is missing.
   It plugs into js/forgeeks-market.js through window.MarketUI; the server still decides every price and purchase.
   Try it saves nothing. Catalog text is only ever set with textContent. Previews: js/theme-preview.js. */
(function (root) {
  'use strict';
  var doc = root.document;
  var PV = root.LightningPreview;
  if (!PV || !doc.getElementById('mkt-body')) return;
  var MAIN = !!doc.body.dataset.mainStore;
  var $ = function (id) { return doc.getElementById(id); };
  var LG = root.LG, FG = root.FG, M = function () { return root.LightningMarket; };
  var WEAR_OFF = 'lightning-site-skin-off';
  var COIN = 'assets/brand/cotton-coin.svg';
  var PARTS = ['Colours', 'Header and top bar', 'Navigation', 'Hero number', 'Cards and lists', 'Charts and progress', 'Buttons and inputs', 'Sheets and dialogs', 'Settings and menus', 'Texture and motion'];
  // cosmetics/slots.json slot behind each of the ten parts
  var SLOT = ['palette', 'header', 'navigation', 'hero', 'cards', 'charts', 'controls', 'overlays', 'menus', 'decoration'];
  var APP = [
    { id: 'nile-nocturne', line: 'Egyptian night river. Deep water, one glowing current.' },
    { id: 'royal-obsidian-gold', line: 'Basalt and gold. Quiet luxury for tracking what you own.' }
  ];
  var VIEWS = [['themes', 'Themes'], ['banners', 'Banners'], ['frames', 'Frames'], ['badges', 'Badges'], ['owned', 'Owned']];

  var ms = null;            // the market's state, handed over on every render
  var view = 'themes';
  var trying = null;        // what Try it is showing: {kind, id, name, item, c, palette}
  var lookOverride = {};    // Try it on a banner, frame or badge
  var me = null;
  var apps = [];            // validated app-theme manifests
  var built = false;
  var detail = { trigger: null, entry: null, mode: 'website' };
  var fgTry = null;         // For Geeks: what to put back after Try it

  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function add(p, kids) { kids.forEach(function (k) { if (k) p.appendChild(k); }); return p; }
  // UI words: sentence case on the main site (Part B), lower case like commands on For Geeks (D10)
  function ui(t) { return MAIN || t == null ? t : t.toLowerCase(); }
  function btn(cls, text, fn, aria) {
    var b = el('button', cls, ui(text));
    b.type = 'button';
    if (aria) b.setAttribute('aria-label', aria);
    b.addEventListener('click', fn);
    return b;
  }
  function coin() { var i = el('img', 'coin-i'); i.src = COIN; i.alt = ''; i.width = 16; i.height = 16; return i; }
  function priced(n) { var s = el('span', 'mkt-price'); add(s, [coin(), el('span', null, String(n))]); s.setAttribute('aria-label', n + (n === 1 ? ' coin' : ' coins')); return s; }
  function coinsWord(n) { return n + (n === 1 ? ' coin' : ' coins'); }
  function siteTheme(id) { var l = (LG && LG.THEMES) || []; for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function items(type) { return ms ? ms.items.filter(function (i) { return i.type === type; }) : []; }
  function equippedOf(type) { var l = items(type); for (var i = 0; i < l.length; i++) if (l[i].equipped) return l[i]; return null; }
  function wearOn() { try { return root.localStorage.getItem(WEAR_OFF) !== '1'; } catch (_) { return true; } }
  function setWear(on) { try { if (on) root.localStorage.removeItem(WEAR_OFF); else root.localStorage.setItem(WEAR_OFF, '1'); } catch (_) {} }
  function skinFor(it) { var t = siteTheme(it.id); return t && !it.is_default ? { id: t.id, name: t.name, c: t.c.slice(0, 4) } : null; }
  function entryFor(it) {
    var t = it.type === 'theme' ? siteTheme(it.id) : null;
    return { kind: it.type, id: it.id, name: it.name, item: it, c: t ? t.c.slice(0, 4) : null, palette: t ? PV.fromWebsite(t) : null };
  }
  function appEntry(m) {
    var p = m.parts.palette;
    return { kind: 'theme', app: m, id: m.id, name: m.name, item: null, c: [p.background, p.text, p.muted, p.accent], palette: PV.clean(Object.assign({}, PV.DEFAULT, p)) };
  }

  /* ---------- the page around the cells ---------- */
  function sections() {
    var get = function (id) { var l = $(id); return l ? l.closest('.mkt-sec') : null; };
    return { themes: get('list-themes'), banners: get('list-banners'), frames: get('list-frames'), badges: get('list-badges') };
  }

  function build() {
    if (built) return;
    built = true;
    var body = $('mkt-body'), bar = body.querySelector('.mkt-bar');
    // Your look, paired with the wallet
    var top = el('div', 'mkt-top');
    var look = el('section', 'mkt-look');
    look.setAttribute('aria-labelledby', 'look-h');
    add(look, [el('h2', 'mkt-look-h', ui('Your look')), el('div', 'mkt-look-card'), el('p', 'mkt-look-line')]);
    look.firstChild.id = 'look-h';
    if (MAIN) {
      var wear = el('label', 'mkt-wear chk');
      var box = el('input'); box.type = 'checkbox'; box.id = 'wear-theme';
      box.addEventListener('change', function () { setWear(box.checked); syncSkin(true); });
      add(wear, [box, el('span', null, 'Wear my theme across this website')]);
      wear.hidden = true;
      look.appendChild(wear);
    }
    var wallet = el('section', 'mkt-wallet');
    wallet.setAttribute('aria-label', 'Wallet');
    bar.parentNode.insertBefore(top, bar);
    add(top, [look, wallet]);
    wallet.appendChild(bar);
    var chip = $('wallet');
    if (chip) chip.insertBefore(coin(), chip.firstChild);
    var earn = el('p', 'mkt-earn');
    if (MAIN) add(earn, [link('topup.html', 'Top up your wallet'), link('stories.html', 'Share a story for coins')]);
    else add(earn, [link('forgeeks-tasks.html', 'Earn coins with open tasks')]);
    wallet.appendChild(earn);

    // tabs
    var tabs = el('nav', 'mkt-tabs');
    tabs.setAttribute('aria-label', 'Market sections');
    VIEWS.forEach(function (v) {
      var b = btn('mkt-tab', v[1], function () { show(v[0], true); });
      b.setAttribute('data-view', v[0]);
      tabs.appendChild(b);
    });
    body.insertBefore(tabs, top.nextSibling);
    var empty = el('p', 'mkt-empty', 'Nothing here yet. Buy something, or browse the other tabs.');
    empty.id = 'mkt-empty'; empty.hidden = true;
    body.appendChild(empty);

    // the app themes in testing, first in Themes
    var feat = el('div', 'mkt-feat');
    feat.id = 'mkt-feat'; feat.hidden = true;
    var themes = sections().themes;
    themes.insertBefore(feat, themes.querySelector('.mkt-grid'));
    loadApps();

    buildDetail();
    buildBar();
    var h = (root.location.hash || '').slice(1);
    if (VIEWS.some(function (v) { return v[0] === h; })) view = h;
  }
  function link(href, text) { var a = el('a', 'mkt-link', ui(text)); a.href = href; return a; }

  function show(next, focus) {
    view = next;
    try { root.history.replaceState(null, '', '#' + next); } catch (_) {}
    arrange();
    if (focus) { var b = doc.querySelector('.mkt-tab[data-view="' + next + '"]'); if (b) b.focus(); }
  }

  function arrange() {
    var secs = sections(), any = false;
    Array.prototype.forEach.call(doc.querySelectorAll('.mkt-tab'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === view)); });
    Object.keys(secs).forEach(function (k) {
      var sec = secs[k];
      if (!sec) return;
      var cells = sec.querySelectorAll('.mkt-cell'), shown = 0;
      Array.prototype.forEach.call(cells, function (li) {
        var hide = view === 'owned' && li.getAttribute('data-state') === 'for-sale';
        li.hidden = hide;
        if (!hide) shown++;
      });
      var on = (view === k || view === 'owned') && shown > 0;
      if (k === 'themes' && view === 'themes') on = true;
      sec.hidden = !on;
      if (on) any = true;
    });
    if ($('h-free')) $('h-free').hidden = !$('list-free').querySelector('.mkt-cell:not([hidden])');
    $('mkt-feat').hidden = view !== 'themes' || !apps.length;
    $('mkt-empty').hidden = any;
  }

  /* ---------- Your look ---------- */
  function drawLook() {
    var card = doc.querySelector('.mkt-look-card');
    if (!card) return;
    var pick = function (type) { return lookOverride[type] !== undefined ? lookOverride[type] : (equippedOf(type) || {}).id; };
    while (card.firstChild) card.removeChild(card.firstChild);
    var name = me && me.display_name ? me.display_name : (ms && ms.signedIn ? 'You' : 'Your name');
    card.appendChild(PV.profile({ name: name, banner: pick('banner'), frame: pick('frame'), badge: pick('badge') }));
    var th = trying && trying.kind === 'theme' ? trying : null, eq = equippedOf('theme');
    var line = doc.querySelector('.mkt-look-line');
    line.textContent = th ? 'Trying ' + th.name + ' for this visit.' : ms && ms.signedIn
      ? 'Theme: ' + (eq ? eq.name : 'Mono') + '. Shown on your profile, the leaderboard and your stories.'
      : 'Sign in to keep a look. Try anything first; nothing is saved.';
    var wear = doc.querySelector('.mkt-wear');
    if (wear) {
      wear.hidden = !(ms && ms.signedIn && eq && !eq.is_default);
      $('wear-theme').checked = wearOn();
    }
  }

  // Main site: wear the equipped theme here when the member wants it; take off a theme they no longer own.
  function syncSkin(fromSwitch) {
    var T = root.LightningTheme;
    if (!MAIN || !T || !T.skin || trying) return;
    var worn = T.worn(), eq = equippedOf('theme');
    if (!ms.signedIn) { if (T.stored()) T.skin(null); return; }
    var want = eq && wearOn() ? skinFor(eq) : null;
    if (worn && !want && !fromSwitch) {
      var known = ms.items.filter(function (i) { return i.id === worn.id; })[0];
      if (known && known.owned && wearOn()) return; // owned, worn, and still wanted
    }
    if ((want && want.id) !== (worn && worn.id)) T.skin(want);
  }

  /* ---------- the app themes in testing ---------- */
  function loadApps() {
    if (!root.CosmeticParts || !root.fetch) return;
    var get = function (p) { return root.fetch(p).then(function (r) { if (!r.ok) throw Error('missing'); return r.json(); }); };
    get('cosmetics/slots.json').then(function (contract) {
      return Promise.all(APP.map(function (a) {
        return get('cosmetics/' + a.id + '.json').then(function (m) { root.CosmeticParts.validate(m, contract); m.line = a.line; return m; }, function () { return null; });
      }));
    }).then(function (list) {
      apps = list.filter(Boolean);
      drawFeatured();
      arrange();
    }, function () {});
  }

  function drawFeatured() {
    var feat = $('mkt-feat');
    while (feat.firstChild) feat.removeChild(feat.firstChild);
    if (!apps.length) return;
    add(feat, [el('h3', 'mkt-sub', ui('New for the app')), el('p', 'mkt-feat-why', MAIN ? 'Two themes for the PC app and the phone, in testing. Try them here; the price comes when the app can wear them.'
      : 'Two app themes in testing, cosmetics/nile-nocturne.json and cosmetics/royal-obsidian-gold.json, checked against cosmetics/slots.json. Try them here; a price comes when the app can wear them.')]);
    var row = el('div', 'mkt-feat-row');
    apps.forEach(function (m) {
      var e = appEntry(m);
      var card = PV.paint(el('article', 'mkt-feat-card'), e.palette);
      card.setAttribute('data-app', m.id);
      var words = add(el('div', 'mkt-feat-words'), [el('span', 'mkt-feat-tag', ui('App theme · in testing')), el('h4', 'mkt-feat-name', m.name), el('p', 'mkt-feat-line', m.line)]);
      var acts = add(el('div', 'mkt-feat-acts'), [
        btn('mkt-feat-try', 'Try it', function () { tryOn(e); }, 'Try ' + m.name + ' on this page'),
        btn('mkt-feat-more', 'Details', function (ev) { openDetail(e, ev.currentTarget, 'pc'); }, m.name + ' details'),
        el('span', 'mkt-feat-price', ui('Price not set yet'))]);
      words.appendChild(acts);
      var shots = add(el('div', 'mkt-feat-shots'), [PV.pc(e.palette), PV.phone(e.palette)]);
      shots.setAttribute('aria-hidden', 'true');
      add(card, [words, shots]);
      row.appendChild(card);
    });
    feat.appendChild(row);
  }

  /* ---------- cells: Try it and Details ---------- */
  var WORDS = { 'buy': 'Buy', 'equip': 'Equip', 'remove banner': 'Remove banner', '✓ equipped': '✓ Equipped', 'owned': 'Owned', 'free': 'Free' };
  function cellHook(li, it) {
    var acts = li.querySelector('.mkt-acts');
    // Part B writes sentence case; the shared cells come in For Geeks' lower case
    if (MAIN) Array.prototype.forEach.call(li.querySelectorAll('.mkt-acts button,.mkt-state,.mkt-tag'), function (n) { if (WORDS[n.textContent]) n.textContent = WORDS[n.textContent]; });
    var buy = acts.querySelector('[data-act="buy"]');
    if (buy) buy.classList.add('mkt-buy');
    if (it.is_default && it.type === 'theme') return;
    var st = it.type === 'theme' ? siteTheme(it.id) : null;
    if (st && st.archived) li.insertBefore(el('p', 'mkt-archived', MAIN ? 'Archived: still yours, no longer sold.' : 'archived: still yours, no longer sold.'), acts);
    var e = entryFor(it);
    add(acts, [
      btn('mkt-mini mkt-try-btn', 'Try it', function () { tryOn(e); }, 'Try ' + it.name),
      btn('mkt-mini ghost', 'Details', function (ev) { openDetail(e, ev.currentTarget); }, it.name + ' details')]);
    var tag = li.querySelector('.mkt-tag');
    if (tag && !it.owned && it.price > 0) { while (tag.firstChild) tag.removeChild(tag.firstChild); tag.appendChild(priced(it.price)); }
  }

  /* ---------- Try it ---------- */
  var tbar = null;
  function buildBar() {
    tbar = el('div', 'mkt-trybar');
    tbar.setAttribute('role', 'region');
    tbar.setAttribute('aria-label', 'Preview');
    tbar.hidden = true;
    add(tbar, [el('p', 'mkt-trybar-text'), el('div', 'mkt-trybar-acts')]);
    doc.body.appendChild(tbar);
    doc.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !ev.defaultPrevented && trying && $('buy').hidden && $('mkt-detail').hidden) cancelTry(); });
  }

  function paintSite(e) {
    if (MAIN) { var T = root.LightningTheme; if (T && T.skin) T.skin(e.c ? { id: e.id, name: e.name, c: e.c } : null, false); return; }
    var r = doc.documentElement;
    if (!fgTry) fgTry = { theme: r.dataset.theme || null };
    clearFgVars();
    if (e.app) {
      var p = e.palette, v = { '--bg': p.background, '--panel': p.surface, '--well': p.raised, '--ink': p.text, '--dim': p.muted, '--faint': p.border,
        '--line': p.border, '--line-strong': PV.mix(p.text, p.background, 0.3), '--accent': p.accent, '--btn': p.accent, '--btn-ink': p.onAccent };
      Object.keys(v).forEach(function (k) { r.style.setProperty(k, v[k]); });
      r.dataset.tryApp = '1';
    } else if (e.id === 'mono') delete r.dataset.theme;
    else r.dataset.theme = e.id;
  }
  function clearFgVars() {
    var r = doc.documentElement;
    if (!r.dataset.tryApp) return;
    ['--bg', '--panel', '--well', '--ink', '--dim', '--faint', '--line', '--line-strong', '--accent', '--btn', '--btn-ink'].forEach(function (k) { r.style.removeProperty(k); });
    delete r.dataset.tryApp;
  }
  function restoreSite() {
    if (MAIN) { var T = root.LightningTheme; if (T && T.skin) T.skin(T.stored(), false); return; }
    if (!fgTry) return;
    clearFgVars();
    var r = doc.documentElement;
    if (fgTry.theme) r.dataset.theme = fgTry.theme; else delete r.dataset.theme;
    fgTry = null;
  }

  function tryOn(e) {
    if (trying) undo();
    trying = e;
    if (e.kind === 'theme') paintSite(e);
    else { lookOverride = {}; lookOverride[e.kind] = e.id; }
    drawLook();
    var text = tbar.querySelector('.mkt-trybar-text');
    text.textContent = '';
    add(text, [el('span', null, 'Previewing '), el('b', null, e.name), el('span', null, e.kind === 'theme' ? ' on this page. Nothing is saved.' : ' on your look. Nothing is saved.')]);
    drawBar();
    tbar.hidden = false;
    doc.body.classList.add('mkt-trying');
    if (e.kind !== 'theme') { var look = doc.querySelector('.mkt-look'); if (look && look.scrollIntoView) look.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    var first = tbar.querySelector('.mkt-trybar-acts button,.mkt-trybar-acts a');
    if (first) first.focus();
  }
  // Buy, Equip or Sign in, then Cancel: redrawn when the item's state changes while it is being tried.
  function drawBar() {
    var acts = tbar.querySelector('.mkt-trybar-acts'), e = trying, it = e.item;
    while (acts.firstChild) acts.removeChild(acts.firstChild);
    if (it && ms && ms.signedIn && !it.owned) {
      var b = btn('mkt-trybar-buy', '', function () { M().buy(it, b); });
      add(b, [el('span', null, ui('Buy · ')), priced(it.price)]);
      acts.appendChild(b);
    } else if (it && it.owned && !it.equipped) {
      acts.appendChild(btn('mkt-trybar-buy', 'Equip', function (ev) { M().act('equip', it, ev.currentTarget); }));
    } else if (it && !ms.signedIn) {
      var a = link(FG && FG.signInHref ? FG.signInHref() : (MAIN ? 'account.html' : 'forgeeks-account.html'), 'Sign in to buy');
      a.className = 'mkt-trybar-buy';
      acts.appendChild(a);
    }
    acts.appendChild(btn('mkt-trybar-cancel', it && it.owned ? 'Done' : 'Cancel', cancelTry));
  }
  function undo() {
    if (!trying) return;
    if (trying.kind === 'theme') restoreSite();
    lookOverride = {};
    trying = null;
  }
  function cancelTry() {
    var was = trying;
    undo();
    tbar.hidden = true;
    doc.body.classList.remove('mkt-trying');
    drawLook();
    if (was && was.item) { var b = doc.querySelector('.mkt-cell[data-item="' + was.item.id + '"] .mkt-try-btn'); if (b) b.focus(); }
  }

  /* ---------- the detail window ---------- */
  function buildDetail() {
    var d = el('div', 'mkt-dlg mkt-detail');
    d.id = 'mkt-detail'; d.hidden = true;
    var back = el('div', 'mkt-back');
    back.addEventListener('click', closeDetail);
    var win = el('div', 'mkt-win mkt-detail-win');
    win.setAttribute('role', 'dialog'); win.setAttribute('aria-modal', 'true'); win.setAttribute('aria-labelledby', 'detail-title'); win.tabIndex = -1;
    var title = el('h2', null, ''); title.id = 'detail-title';
    add(win, [el('p', 'mkt-detail-tag'), title, el('p', 'mkt-detail-note'), el('div', 'mkt-views'), el('div', 'mkt-stage'), el('p', 'mkt-stage-note'),
      el('div', 'mkt-parts'), el('div', 'row mkt-detail-acts')]);
    add(d, [back, win]);
    d.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); closeDetail(); return; }
      if (ev.key !== 'Tab') return;
      var f = Array.prototype.filter.call(win.querySelectorAll('button,a[href]'), function (b) { return !b.disabled && b.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1], at = doc.activeElement;
      if (ev.shiftKey && (at === first || !win.contains(at))) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && (at === last || !win.contains(at))) { ev.preventDefault(); first.focus(); }
    });
    doc.body.appendChild(d);
  }

  function stage(e, mode) {
    var s = doc.querySelector('.mkt-stage');
    while (s.firstChild) s.removeChild(s.firstChild);
    detail.mode = mode;
    if (e.kind !== 'theme') {
      var o = {}; o[e.kind] = e.id;
      var eqb = equippedOf('banner'), eqf = equippedOf('frame'), eqd = equippedOf('badge');
      s.appendChild(PV.profile({ name: me && me.display_name ? me.display_name : 'Your name', banner: o.banner || (eqb && eqb.id), frame: o.frame || (eqf && eqf.id), badge: o.badge || (eqd && eqd.id) }));
    } else if (mode === 'phone') {
      var wrap = add(el('div', 'mkt-stage-phone'), [PV.phone(e.palette)]);
      s.appendChild(wrap);
    } else if (mode === 'website') {
      // the main site's own version: a light side and a dark side, as the light/dark switch shows them
      var duo = el('div', 'pv-duo');
      [['light', 'Light'], ['dark', 'Dark']].forEach(function (m) {
        duo.appendChild(add(el('figure'), [PV.site(PV.fromSite({ c: e.c }, m[0])), el('figcaption', null, ui(m[1]))]));
      });
      s.appendChild(duo);
    } else if (mode === 'geeks') s.appendChild(PV.geek(PV.fromWebsite({ c: e.c })));
    else s.appendChild(PV.pc(e.palette));
    Array.prototype.forEach.call(doc.querySelectorAll('.mkt-views button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode)); });
    var note = doc.querySelector('.mkt-stage-note');
    note.textContent = e.kind !== 'theme' ? 'How others see you on your profile, the leaderboard and your stories.'
      : mode === 'website' ? 'The main website\u2019s own version of this theme, light by default and dark with the switch. Layout, sizes and words never change.'
      : mode === 'geeks' ? 'For Geeks\u2019 own version of the same theme. One purchase dresses both sites, each in its own look.'
      : 'Mohab’s sample year in this palette. Only colours change; every figure, label and place stays the same.';
  }

  function openDetail(e, trigger, mode) {
    detail.entry = e; detail.trigger = trigger;
    var it = e.item, win = doc.querySelector('.mkt-detail-win');
    doc.querySelector('.mkt-detail-tag').textContent = ui(e.app ? 'App theme · in testing' : e.kind === 'theme' ? 'Theme · both sites, computer and phone' : e.kind[0].toUpperCase() + e.kind.slice(1));
    $('detail-title').textContent = e.name;
    doc.querySelector('.mkt-detail-note').textContent = e.app ? e.app.line : (it && it.description) || '';
    var views = doc.querySelector('.mkt-views');
    while (views.firstChild) views.removeChild(views.firstChild);
    if (e.kind === 'theme') {
      (e.app ? [['pc', 'Computer'], ['phone', 'Phone']] : MAIN ? [['website', 'Website'], ['geeks', 'For Geeks'], ['pc', 'Computer'], ['phone', 'Phone']]
        : [['geeks', 'For Geeks'], ['website', 'Main website'], ['pc', 'Computer'], ['phone', 'Phone']]).forEach(function (v) {
        var b = btn('mkt-view', v[1], function () { stage(e, v[0]); });
        b.setAttribute('data-mode', v[0]);
        views.appendChild(b);
      });
    }
    views.hidden = e.kind !== 'theme';
    stage(e, mode || (e.app ? 'pc' : MAIN ? 'website' : 'geeks'));
    // the ten parts
    var parts = doc.querySelector('.mkt-parts');
    while (parts.firstChild) parts.removeChild(parts.firstChild);
    if (e.kind === 'theme') {
      parts.appendChild(el('h3', 'mkt-parts-h', ui('What this theme changes')));
      var dl = el('dl', 'mkt-parts-list');
      PARTS.forEach(function (name, i) {
        var changes = e.app ? !!e.app.parts[SLOT[i]] && !(SLOT[i] === 'decoration') : i < 9 && i !== 3;
        add(dl, [add(el('div', changes ? 'on' : null), [el('dt', null, name), el('dd', null, changes ? 'changes' : 'stays')])]);
      });
      parts.appendChild(dl);
      parts.appendChild(el('p', 'mkt-parts-fine', 'Layout, fonts, sizes, labels and what each number means never change. Money in and money out keep their colours.'));
    }
    parts.hidden = e.kind !== 'theme';
    // actions
    var acts = doc.querySelector('.mkt-detail-acts');
    while (acts.firstChild) acts.removeChild(acts.firstChild);
    acts.appendChild(btn('btn', e.kind === 'theme' ? 'Try it on this page' : 'Try it on your look', function () { closeDetail(true); tryOn(e); }));
    if (it && ms && ms.signedIn) {
      if (it.equipped) acts.appendChild(el('span', 'mkt-state', ui('✓ Equipped')));
      else if (it.owned) acts.appendChild(btn('btn ghost', 'Equip', function () { closeDetail(true); M().act('equip', it, trigger); }));
      else { var b = btn('btn ghost', '', function () { closeDetail(true); M().buy(it, trigger); }); add(b, [el('span', null, ui('Buy · ')), priced(it.price)]); acts.appendChild(b); }
    } else if (it && it.price > 0) {
      var a = link(FG && FG.signInHref ? FG.signInHref() : 'account.html', 'Sign in to buy'); a.className = 'btn ghost'; acts.appendChild(a);
    } else if (e.app) acts.appendChild(el('span', 'mkt-feat-price', ui('Price not set yet')));
    acts.appendChild(btn('btn ghost', 'Close', function () { closeDetail(); }));
    $('mkt-detail').hidden = false;
    doc.documentElement.style.overflow = 'hidden';
    win.scrollTop = 0;
    win.focus({ preventScroll: true });
  }
  function closeDetail(keepFocus) {
    if ($('mkt-detail').hidden) return;
    $('mkt-detail').hidden = true;
    doc.documentElement.style.overflow = '';
    if (keepFocus !== true && detail.trigger && doc.contains(detail.trigger)) detail.trigger.focus();
  }

  /* ---------- buying with too few coins ---------- */
  function short() {
    var s = $('buy-short');
    if (s) return s;
    s = el('div', 'mkt-short');
    s.id = 'buy-short'; s.hidden = true;
    var sum = $('buy').querySelector('.mkt-sum');
    sum.parentNode.insertBefore(s, sum.nextSibling);
    return s;
  }
  function buyOpened(it, balance) {
    var s = short();
    while (s.firstChild) s.removeChild(s.firstChild);
    var missing = it.price - balance;
    s.hidden = missing <= 0;
    if (missing <= 0) return;
    $('buy-title').textContent = 'not enough coins for ' + it.name.toLowerCase();
    $('buy-status').textContent = '';
    $('buy-ok').hidden = true;
    $('buy-cancel').textContent = 'close';
    $('buy-cancel').focus();
    add(s, [el('p', 'mkt-short-need', 'You need ' + coinsWord(missing) + ' more.'),
      el('p', 'mkt-short-how', MAIN ? 'Coins come from wallet top-ups and from stories you share. Your score stays as it is.' : 'Coins come from merged tasks and accepted feedback. Your score stays as it is.')]);
    var ways = el('div', 'mkt-short-ways');
    if (MAIN) add(ways, [link('topup.html', 'Top up your wallet'), link('stories.html', 'Share a story')]);
    else add(ways, [link('forgeeks-tasks.html', 'See open tasks')]);
    s.appendChild(ways);
  }
  function buyClosed() { var s = $('buy-short'); if (s) s.hidden = true; }

  /* ---------- hooks for js/forgeeks-market.js ---------- */
  root.MarketUI = {
    preview: function (it, compact) {
      if (it.type !== 'theme' || compact) return null;
      var t = siteTheme(it.id);
      return t ? PV.thumb(PV.fromWebsite(t)) : null;
    },
    cell: cellHook,
    rendered: function (state) {
      ms = state;
      build();
      arrange();
      drawLook();
      syncSkin(false);
      if (trying && trying.item) {
        var fresh = state.items.filter(function (i) { return i.id === trying.item.id; })[0];
        if (fresh) { trying.item = fresh; drawBar(); }
      }
      if (state.signedIn && FG && FG.me && !me) FG.me().then(function (m) { me = m; drawLook(); }, function () {});
      if (!state.signedIn) me = null;
    },
    equipped: function (it) {
      if (trying) cancelTry();
      if (MAIN && it.type === 'theme') {
        var T = root.LightningTheme;
        if (T && T.skin) T.skin(it.is_default || !wearOn() ? null : skinFor(it));
      }
      drawLook();
    },
    buyOpened: buyOpened,
    buyClosed: buyClosed
  };
})(window);
