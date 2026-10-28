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
  // cosmetics/slots.json slot behind each of the ten parts (schema 2: part 10 is the ground's texture and motion)
  var SLOT = ['palette', 'header', 'navigation', 'hero', 'cards', 'charts', 'controls', 'overlays', 'menus', 'ground'];
  // The themes that also dress the PC app and the phone: one purchase with their website version (themes.md, 8L).
  var APP = [
    { id: 'dendera', line: 'Temple pigments on aged papyrus by day, the star ceiling by night, a pigment thread along the header.' },
    { id: 'papyrus', line: 'Lapis lacquer and gold foil whose light travels the edge, over papyrus fibres.' },
    { id: 'cotton', line: 'Warm paper and linen, embossed terracotta, ink tabs.' },
    { id: 'nile', line: 'Nile night and gold, on every screen you use.' }
  ];
  var VIEWS = [['themes', 'Themes'], ['sets', 'Sets'], ['banners', 'Banners'], ['frames', 'Frames'], ['names', 'Names'], ['badges', 'Badges'], ['owned', 'Owned']];

  var ms = null;            // the market's state, handed over on every render
  var view = 'themes';
  var trying = null;        // what Try it is showing: {kind, id, name, item, c, palette}
  var lookOverride = {};    // Try it on a banner, frame or badge
  var me = null;
  var apps = [];            // validated app-theme manifests
  var built = false, built2 = false;
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
  var rate = null; // coins per EGP, from coin_rate(): prices also read in EGP
  function egp(n) { return rate ? Math.round(n / rate) : null; }
  function priced(n) {
    var s = el('span', 'mkt-price'); add(s, [coin(), el('span', null, String(n))]);
    var e = egp(n);
    if (e) s.appendChild(el('small', 'mkt-egp', e + ' EGP'));
    s.setAttribute('aria-label', n + (n === 1 ? ' Cotton' : ' Cotton') + (e ? ', about ' + e + ' EGP' : ''));
    return s;
  }
  // a theme's tier (guideline/themes.md section 7): from the catalog, else from the seed
  function tierOf(it) { if (it.tier) return it.tier; var t = siteTheme(it.id); return t && t.tex ? 'texture' : 'palette'; }
  var TIER_WORD = { palette: 'Palette', texture: 'Textured', motion: 'Animated' };
  function coinsWord(n) { return Number(n).toLocaleString('en-US') + (n === 1 ? ' Cotton' : ' Cotton'); }
  function siteTheme(id) { var l = (LG && LG.THEMES) || []; for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function items(type) { return ms ? ms.items.filter(function (i) { return i.type === type; }) : []; }
  function equippedOf(type) { var l = items(type); for (var i = 0; i < l.length; i++) if (l[i].equipped) return l[i]; return null; }
  function wearOn() { try { return root.localStorage.getItem(WEAR_OFF) !== '1'; } catch (_) { return true; } }
  function setWear(on) { try { if (on) root.localStorage.removeItem(WEAR_OFF); else root.localStorage.setItem(WEAR_OFF, '1'); } catch (_) {} }
  function skinFor(it) { var t = siteTheme(it.id); return t && !it.is_default ? { id: t.id, name: t.name, c: t.c.slice(0, 4), tex: t.tex } : null; }
  function entryFor(it) {
    var t = it.type === 'theme' ? siteTheme(it.id) : null;
    return { kind: it.type, id: it.id, name: it.name, item: it, c: t ? t.c.slice(0, 4) : null, tex: t && t.tex, palette: t ? PV.fromWebsite(t) : null };
  }
  function appEntry(m) {
    var p = m.parts.palette;
    var item = ms ? ms.items.filter(function (i) { return i.id === m.id && i.type === 'theme'; })[0] || null : null;
    return { kind: 'theme', app: m, id: m.id, name: m.name, item: item, c: [p.background, p.text, p.muted, p.accent], palette: PV.clean(Object.assign({}, PV.DEFAULT, p)) };
  }

  /* ---------- the page around the cells ---------- */
  function sections() {
    var get = function (id) { var l = $(id); return l ? l.closest('.mkt-sec') : null; };
    return { themes: get('list-themes'), sets: get('list-sets'), banners: get('list-banners'), frames: get('list-frames'), names: get('list-names'), badges: get('list-badges') };
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
    if (MAIN) add(earn, [link('topup.html', 'Top up your wallet'), link('stories.html', 'Share a story to earn Cotton')]);
    else add(earn, [link('forgeeks-tasks.html', 'Earn Cotton with open tasks')]);
    wallet.appendChild(earn);

    // what a buyer gets, said once, beside the wallet
    var trust = el('ul', 'mkt-trust');
    trust.setAttribute('aria-label', ui('What you get'));
    [['Pay once, keep it', 'No subscription. What you buy stays on your account.'],
     ['Both sites', MAIN ? 'Here and on For Geeks, light and dark. The app too, unlocked once per profile.' : 'Here and on the main site. The app too, unlocked once per profile.'],
     ['Looks only', 'Every feature of Lightning stays free. Nothing here changes a number or a rank.'],
     ['Paid in Egypt', 'InstaPay, checked by a person. Cotton arrive once your transfer does.']].forEach(function (x) {
      trust.appendChild(add(el('li'), [el('b', null, ui(x[0])), el('span', null, x[1])]));
    });
    top.parentNode.insertBefore(trust, top.nextSibling);
    if (FG && FG.ready) FG.ready.then(function () { return FG.sb && FG.sb.rpc('coin_rate'); }).then(function (r) {
      var n = r && !r.error && r.data && Number(r.data.coins_per_egp);
      if (n > 0 && n <= 1000) { rate = n; if (ms) M().render(); }
    }, function () {});

    // tabs
    var tabs = el('nav', 'mkt-tabs');
    tabs.setAttribute('aria-label', 'Market sections');
    VIEWS.forEach(function (v) {
      var b = btn('mkt-tab', v[1], function () { show(v[0], true); });
      b.setAttribute('data-view', v[0]);
      tabs.appendChild(b);
    });
    body.insertBefore(tabs, trust.nextSibling);
    var empty = el('p', 'mkt-empty', 'Nothing here yet. Buy something, or browse the other tabs.');
    empty.id = 'mkt-empty'; empty.hidden = true;
    body.appendChild(empty);

    // the app themes in testing, first in Themes
    var feat = el('div', 'mkt-feat');
    feat.id = 'mkt-feat'; feat.hidden = true;
    var themes = sections().themes;
    themes.appendChild(feat);
    // the tiers, side by side, then the textured and animated tiers as their own row of large cards, then the palettes
    var tiers = el('ul', 'mkt-tiers'); tiers.id = 'mkt-tiers';
    var texH = el('h3', 'mkt-sub', ui('Textured and animated')); texH.id = 'h-textured';
    var tex = el('ul', 'mkt-grid textured'); tex.id = 'list-textured'; tex.setAttribute('aria-labelledby', 'h-textured');
    var palH = el('h3', 'mkt-sub', ui('Palettes')); palH.id = 'h-palettes';
    var grid = $('list-themes');
    grid.setAttribute('aria-labelledby', 'h-palettes');
    themes.insertBefore(tiers, grid); themes.insertBefore(texH, grid); themes.insertBefore(tex, grid); themes.insertBefore(palH, grid);
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
    $('h-textured').hidden = !$('list-textured').querySelector('.mkt-cell:not([hidden])');
    $('h-palettes').hidden = !$('list-themes').querySelector('.mkt-cell:not([hidden])');
    $('mkt-tiers').hidden = view !== 'themes';
    if ($('mkt-vote')) $('mkt-vote').hidden = view !== 'themes' || !poll;
    if ($('mkt-gifts')) $('mkt-gifts').hidden = view !== 'owned' || !$('mkt-gifts').getAttribute('data-has');
    if ($('mkt-supporter')) $('mkt-supporter').hidden = !$('mkt-supporter').firstChild;
    $('mkt-empty').hidden = any;
  }

  /* ---------- Your look ---------- */
  function drawLook() {
    var card = doc.querySelector('.mkt-look-card');
    if (!card) return;
    var pick = function (type) { return lookOverride[type] !== undefined ? lookOverride[type] : (equippedOf(type) || {}).id; };
    while (card.firstChild) card.removeChild(card.firstChild);
    var name = me && me.display_name ? me.display_name : (ms && ms.signedIn ? 'You' : 'Your name');
    card.appendChild(PV.profile({ name: name, banner: pick('banner'), frame: pick('frame'), badge: pick('badge'), nameStyle: pick('name') }));
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
    if (MAIN) return; // the main site tags the cards that ship in the app instead of repeating them in a second block
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
    add(feat, [el('h3', 'mkt-sub', ui('Try these on your PC and phone')), el('p', 'mkt-feat-why',
      'One purchase dresses both websites and the app on your PC and phone: unlock it in the app once per profile with a code from your account.')]);
    var row = el('div', 'mkt-feat-row');
    apps.forEach(function (m) {
      var e = appEntry(m);
      var card = PV.paint(el('article', 'mkt-feat-card'), e.palette);
      card.setAttribute('data-app', m.id);
      var words = add(el('div', 'mkt-feat-words'), [el('span', 'mkt-feat-tag', ui(e.item ? TIER_WORD[tierOf(e.item)] + ' · site and app' : 'App theme · in testing')), el('h4', 'mkt-feat-name', m.name), el('p', 'mkt-feat-line', m.line)]);
      var acts = add(el('div', 'mkt-feat-acts'), [
        btn('mkt-feat-try', 'Try it', function () { tryOn(e); }, 'Try ' + m.name + ' on this page'),
        btn('mkt-feat-more', 'Details', function (ev) { openDetail(e, ev.currentTarget, 'pc'); }, m.name + ' details'),
        e.item ? add(el('span', 'mkt-feat-price'), [priced(e.item.price)]) : el('span', 'mkt-feat-price', ui('Price not set yet'))]);
      if (m.id === 'dendera') acts.appendChild(btn('mkt-feat-more', 'How to use', function () {
        var guide = $('app-guide');
        if (guide) { guide.scrollIntoView({ block: 'start' }); guide.focus({ preventScroll: true }); }
      }, 'How to use Dendera'));
      words.appendChild(acts);
      var shots = add(el('div', 'mkt-feat-shots'), [PV.pc(e.palette), PV.phone(e.palette)]);
      shots.setAttribute('aria-hidden', 'true');
      add(card, [words, shots]);
      row.appendChild(card);
    });
    feat.appendChild(row);
  }

  /* ---------- cells: Try it and Details ---------- */
  var WORDS = { 'buy': 'Buy', 'equip': 'Equip', 'remove banner': 'Remove banner', '✓ equipped': '✓ Equipped', 'owned': 'Owned', 'free': 'Free',
    'buy set': 'Buy set', 'gift': 'Gift', 'plain name': 'Plain name', '✓ yours': '✓ Yours', 'earned': 'Earned', 'earned by topping up': 'Earned through support', 'first 100 to top up': 'First 100 to top up' };
  function cellHook(li, it) {
    cellInner(li, it);
    if (MAIN) tidy(li, it);
  }
  function cellInner(li, it) {
    var acts = li.querySelector('.mkt-acts');
    // Part B writes sentence case; the shared cells come in For Geeks' lower case
    if (MAIN) Array.prototype.forEach.call(li.querySelectorAll('.mkt-acts button,.mkt-state,.mkt-tag'), function (n) { if (WORDS[n.textContent]) n.textContent = WORDS[n.textContent]; });
    if (MAIN) Array.prototype.forEach.call(li.querySelectorAll('.mkt-season'), function (n) { n.textContent = n.textContent.charAt(0).toUpperCase() + n.textContent.slice(1); });
    if (it.type === 'set') { // a set is bought whole: its price in EGP too, no try-on
      var st0 = li.querySelector('.mkt-tag');
      if (st0 && !it.owned && Number(it.set_price) > 0) { while (st0.firstChild) st0.removeChild(st0.firstChild); st0.appendChild(priced(Number(it.set_price))); }
      var sb = acts.querySelector('[data-act="buy"]'); if (sb) sb.classList.add('mkt-buy');
      return;
    }
    var buy = acts.querySelector('[data-act="buy"]');
    if (buy) buy.classList.add('mkt-buy');
    if (it.is_default && it.type === 'theme') return;
    var st = it.type === 'theme' ? siteTheme(it.id) : null;
    if (it.type === 'theme') {
      var tr = el('span', 'mkt-tier mkt-tier-' + tierOf(it), ui(TIER_WORD[tierOf(it)]));
      var chips = el('span', 'mkt-chips');
      chips.appendChild(tr);
      if (MAIN && bundled[it.id]) chips.appendChild(el('span', 'mkt-tier mkt-onapp', 'On PC and phone'));
      li.insertBefore(chips, li.querySelector('.mkt-head'));
    }
    if (st && st.archived) li.insertBefore(el('p', 'mkt-archived', MAIN ? 'Archived: still yours, no longer sold.' : 'archived: still yours, no longer sold.'), acts);
    var e = entryFor(it);
    add(acts, [
      btn('mkt-mini mkt-try-btn', 'Try it', function () { tryOn(e); }, 'Try ' + it.name),
      btn('mkt-mini ghost mkt-details-btn', 'Details', function (ev) { openDetail(e, ev.currentTarget); }, it.name + ' details')]);
    var tag = li.querySelector('.mkt-tag');
    if (tag && !it.owned && it.price > 0 && !it.award) { while (tag.firstChild) tag.removeChild(tag.firstChild); tag.appendChild(priced(it.price)); }
    if (it.tier === 'motion' && it.type !== 'theme') li.insertBefore(el('span', 'mkt-tier mkt-tier-motion', ui('Animated')), li.querySelector('.mkt-head'));
  }


  /* One main action, Try it, and a More menu: the main site's cards (owner, 2026-10-27). The shared cells in
     js/forgeeks-market.js stay as they are; this regroups their buttons, keeping every handler. */
  function tidy(li, it) {
    var acts = li.querySelector('.mkt-acts');
    if (!acts) return;
    var one = function (sel) { return acts.querySelector(sel); };
    var cart = one('[data-cart]'), buy = one('[data-act="buy"]'), equip = one('[data-act="equip"]'), gift = one('[data-act="gift"]'),
      remove = one('[data-act="remove"]'), tryBtn = one('.mkt-try-btn'), details = one('.mkt-details-btn');
    var primary = equip || cart || buy;
    var more = [];
    if (primary === equip && equip) equip.textContent = 'Wear';
    if (primary === cart && buy) { buy.textContent = it.type === 'set' ? 'Buy set now' : 'Buy now'; more.push(buy); }
    [details, gift, remove].forEach(function (b) { if (b) more.push(b); });
    if (primary) { primary.className = 'mkt-mini mkt-primary'; primary.removeAttribute('data-primary'); }
    var kept = [one('.mkt-state'), primary, tryBtn].filter(Boolean);
    while (acts.firstChild) acts.removeChild(acts.firstChild);
    kept.forEach(function (n) { acts.appendChild(n); });
    if (more.length) {
      var d = el('details', 'mkt-more');
      var sum = el('summary', null, 'More');
      sum.setAttribute('aria-label', 'More about ' + it.name);
      var list = el('div', 'mkt-more-list');
      more.forEach(function (b) { b.className = 'mkt-more-item'; list.appendChild(b); b.addEventListener('click', function () { d.open = false; }); });
      add(d, [sum, list]);
      acts.appendChild(d);
    }
    // pressing the preview tries the look on, like the Try it button
    var pv = li.firstElementChild;
    if (tryBtn && pv && !li.classList.contains('compact')) {
      pv.classList.add('mkt-pv-try');
      pv.addEventListener('click', function () { tryBtn.click(); });
    }
  }
  doc.addEventListener('click', function (ev) {
    Array.prototype.forEach.call(doc.querySelectorAll('.mkt-more[open]'), function (d) { if (!d.contains(ev.target)) d.open = false; });
  });
  doc.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    var d = doc.querySelector('.mkt-more[open]');
    if (d) { ev.preventDefault(); d.open = false; var s = d.querySelector('summary'); if (s) s.focus(); }
  });

  /* ---------- tags and links from the app ---------- */
  var bundled = {};        // item ids whose theme ships in the app (bundled_item_versions, enabled)
  function loadBundled() {
    if (!MAIN || !FG || !FG.sb || !FG.sb.from) return;
    try {
      Promise.resolve(FG.sb.from('bundled_item_versions').select('item_id').eq('enabled', true)).then(function (r) {
        if (!r || r.error || !Array.isArray(r.data)) return;
        var next = {};
        r.data.forEach(function (x) { if (x && typeof x.item_id === 'string') next[x.item_id] = true; });
        bundled = next;
        if (ms && ms.items.length) M().render();
      }, function () {});
    } catch (_) {}
  }
  // marketplace.html?item=<id> (the app's See prices link): open that item's tab, scroll to it, mark it.
  var TAB_OF = { theme: 'themes', set: 'sets', banner: 'banners', frame: 'frames', badge: 'badges', name: 'names' };
  // A member who owns no paid theme starts on Sets (a whole look for 20% less): its tab goes first, once.
  var tabsOrdered = false;
  function orderTabs(state) {
    if (tabsOrdered || !MAIN || !state.signedIn || doc.body.dataset.collection) return;
    var sets = state.items.some(function (i) { return i.type === 'set'; });
    if (!sets) return;
    tabsOrdered = true;
    var owns = state.items.some(function (i) { return i.type === 'theme' && !i.is_default && i.owned; });
    var hashed = VIEWS.some(function (v) { return v[0] === (root.location.hash || '').slice(1); });
    if (owns) return;
    var tabs = doc.querySelector('.mkt-tabs'), first = tabs && tabs.querySelector('.mkt-tab'), setsTab = tabs && tabs.querySelector('[data-view="sets"]');
    if (setsTab && first && setsTab !== first) tabs.insertBefore(setsTab, first);
    var asked = false;
    try { asked = !!new root.URLSearchParams(root.location.search).get('item'); } catch (_) {}
    if (!hashed && !asked) view = 'sets';
  }
  var hitDone = false, hit = null;   // hit: the item being pointed at, and until when
  function mark() {
    if (!hit) return;
    if (Date.now() > hit.until) { hit = null; return; }
    var cell = doc.querySelector('.mkt-cell[data-item="' + hit.id + '"]');
    if (cell && !cell.hidden) cell.classList.add('mkt-hit');
  }
  function highlight() {
    if (!MAIN || !ms || !ms.items.length) return;
    if (hitDone) { mark(); return; } // the cards are drawn again as the page loads: keep the mark on the new card
    var id = null;
    try { id = new root.URLSearchParams(root.location.search).get('item'); } catch (_) {}
    hitDone = true;
    var it = id ? ms.items.filter(function (i) { return i.id === id; })[0] : null; // only ids the catalogue lists
    if (!it) return;
    if (TAB_OF[it.type] && view !== TAB_OF[it.type]) show(TAB_OF[it.type], false);
    hit = { id: it.id, until: Date.now() + 4000 };
    mark();
    var cell = doc.querySelector('.mkt-cell[data-item="' + it.id + '"]');
    if (cell && !cell.hidden && cell.scrollIntoView) cell.scrollIntoView({ block: 'center', behavior: root.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
    if (MAIN) { var T = root.LightningTheme; if (T && T.skin) T.skin(e.c ? { id: e.id, name: e.name, c: e.c, tex: e.tex } : null, false); return; }
    var r = doc.documentElement;
    if (!fgTry) fgTry = { theme: r.dataset.theme || null, texture: r.dataset.texture || null };
    if (e.tex) r.dataset.texture = e.tex; else delete r.dataset.texture;
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
    if (fgTry.texture) r.dataset.texture = fgTry.texture; else delete r.dataset.texture;
    fgTry = null;
  }

  // Counted by js/analytics.js when the page has it (main site): the look's id, never who looked.
  function stat(name, count) { if (root.LightningTrack) root.LightningTrack(name, count); }
  function lookId(e) { return (e.item && e.item.id) || e.id || 'look'; }

  function tryOn(e) {
    stat('store-try-' + lookId(e));
    if (trying) undo();
    trying = e;
    if (e.kind === 'theme') {
      paintSite(e);
      var target=doc.querySelector('.mkt-look .pv-profile');
      if(target && target.animate && !root.matchMedia('(prefers-reduced-motion: reduce)').matches)
        target.animate([{opacity:.45,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:280,easing:'ease-out'});
    }
    else { lookOverride = {}; lookOverride[e.kind] = e.id; }
    drawLook();
    var text = tbar.querySelector('.mkt-trybar-text');
    text.textContent = '';
    add(text, [el('span', null, 'Previewing '), el('b', null, e.name), el('span', null, e.kind === 'theme' ? ' on this page. Nothing is saved.' : ' on your look. Nothing is saved.')]);
    drawBar();
    tbar.hidden = false;
    doc.body.classList.add('mkt-trying');
    if (e.kind !== 'theme') { var look = doc.querySelector('.mkt-look'); if (look && look.scrollIntoView) look.scrollIntoView({ block: 'nearest', behavior: root.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
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
        duo.appendChild(add(el('figure'), [PV.site(PV.fromSite({ c: e.c, tex: e.tex }, m[0])), el('figcaption', null, ui(m[1]))]));
      });
      s.appendChild(duo);
    } else if (mode === 'geeks') s.appendChild(PV.geek(PV.fromWebsite({ c: e.c, tex: e.tex })));
    else s.appendChild(PV.pc(e.palette));
    Array.prototype.forEach.call(doc.querySelectorAll('.mkt-views button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode)); });
    var note = doc.querySelector('.mkt-stage-note');
    note.textContent = e.kind !== 'theme' ? 'How others see you on your profile, the leaderboard and your stories.'
      : mode === 'website' ? 'The main website\u2019s own version of this theme, light by default and dark with the switch. Layout, sizes and words never change.'
      : mode === 'geeks' ? 'For Geeks\u2019 own version of the same theme. One purchase dresses both sites, each in its own look.'
      : 'Mohab’s sample year in this palette. Only colours change; every figure, label and place stays the same.';
  }

  function openDetail(e, trigger, mode) {
    stat('store-details-' + lookId(e));
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
        var g = e.app && e.app.parts.ground;
        var changes = e.app ? !!e.app.parts[SLOT[i]] && (SLOT[i] !== 'ground' || g.texture !== 'none' || g.artwork !== 'none' || g.ambient !== 'none') : i === 9 ? !!e.tex : i < 9 && i !== 3;
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
    } else if (e.app && !e.item) acts.appendChild(el('span', 'mkt-feat-price', ui('Price not set yet')));
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
  function drawTiers(state) {
    var ul = $('mkt-tiers');
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    var low = function (tier) {
      var p = state.items.filter(function (i) { return i.type === 'theme' && !i.is_default && tierOf(i) === tier; }).map(function (i) { return i.price; });
      return p.length ? Math.min.apply(null, p) : null;
    };
    [['palette', 'Palette', 'New colours on both sites, with a light and a dark side.'],
     ['texture', 'Textured', 'The palette plus a woven texture behind every page.'],
     ['motion', 'Animated', 'The texture plus one slow signature motion.']].forEach(function (x) {
      var price = low(x[0]);
      var li = add(el('li', 'mkt-tierc mkt-tier-' + x[0]), [el('span', 'mkt-tier mkt-tier-' + x[0], ui(x[1])), el('p', null, x[2])]);
      li.appendChild(price ? add(el('p', 'mkt-tier-price'), [el('span', null, ui('From') + ' '), priced(price)]) : el('p', 'mkt-tier-price', ui('Coming soon')));
      ul.appendChild(li);
    });
  }

  function buyOpened(it, balance) {
    var s = short();
    while (s.firstChild) s.removeChild(s.firstChild);
    var missing = it.price - balance;
    stat('store-buy');
    s.hidden = missing <= 0;
    if (missing <= 0) return;
    stat('store-short', true);
    $('buy-title').textContent = 'not enough Cotton for ' + it.name.toLowerCase();
    $('buy-status').textContent = '';
    $('buy-ok').hidden = true;
    $('buy-cancel').textContent = 'close';
    $('buy-cancel').focus();
    add(s, [el('p', 'mkt-short-need', 'You need ' + coinsWord(missing) + ' more' + (egp(missing) ? ', about ' + Math.max(1, egp(missing)) + ' EGP.' : '.')),
      el('p', 'mkt-short-how', MAIN ? 'Cotton come from wallet top-ups and from stories you share. Your score stays as it is.' : 'Cotton come from merged tasks and accepted feedback. Your score stays as it is.')]);
    var ways = el('div', 'mkt-short-ways');
    if (MAIN) add(ways, [link('topup.html', 'Top up your wallet'), link('stories.html', 'Share a story')]);
    else add(ways, [link('forgeeks-tasks.html', 'See open tasks')]);
    s.appendChild(ways);
  }
  function buyClosed() { var s = $('buy-short'); if (s) s.hidden = true; }

  /* ---------- supporters: earned badges, the theme vote, gifts received ---------- */
  var extrasRun = null, poll = null;
  function rpcData(name) {
    return FG && FG.sb ? Promise.resolve(FG.sb.rpc(name)).then(function (r) { return r && !r.error ? r.data : null; }, function () { return null; }) : Promise.resolve(null);
  }
  function loadExtras(state) {
    if (extrasRun === state.run) return;
    extrasRun = state.run;
    var run = state.run;
    rpcData('supporter_status').then(function (s) { if (run === extrasRun) drawSupporter(s, state); });
    rpcData('theme_poll').then(function (p) { if (run === extrasRun) { poll = p; drawVote(); } });
    if (state.signedIn) rpcData('my_gifts').then(function (g) { if (run === extrasRun) drawGifts(g); }); else drawGifts(null);
  }
  // Badges tab: how far this member is from the next supporter badge, and how many Founding places are left.
  function drawSupporter(s, state) {
    var box = $('mkt-supporter'); if (!box) return;
    box.replaceChildren();
    if (!s || !Array.isArray(s.tiers)) { box.hidden = true; return; }
    var got = Number(s.support_equivalent_egp) || 0;
    var owned = s.tiers.filter(function(t) { return t.owned; });
    var next = s.tiers.filter(function(t) { return !t.owned; })[0];
    var level = owned.length ? owned[owned.length - 1].name : 'Support Lightning';
    box.appendChild(el('p', 'mkt-sup-line', state.signedIn ? level : 'Bronze · Silver · Gold · True supporter'));
    if (state.signedIn && s.support_equivalent_egp != null) {
      var top = next ? Number(next.egp) : 1000;
      var meter = el('div','mkt-sup-meter'); meter.setAttribute('role','meter');
      meter.setAttribute('aria-label','Combined support toward ' + (next ? next.name : 'True supporter'));
      meter.setAttribute('aria-valuemin','0'); meter.setAttribute('aria-valuemax',String(top));
      meter.setAttribute('aria-valuenow',String(Math.min(got,top)));
      var fill=el('i'); fill.style.width=Math.min(100,got/top*100)+'%'; meter.appendChild(fill); box.appendChild(meter);
      box.appendChild(el('p','mkt-sup-progress', next ? Math.min(100,Math.floor(got/top*100))+'% toward '+next.name : 'Thank you for keeping Lightning free.'));
    }
    var legend=el('p','mkt-sup-legend'); s.tiers.forEach(function(t){ legend.appendChild(el(t.owned?'b':'span',null,ui(t.name))); }); box.appendChild(legend); if(!MAIN) legend.textContent=legend.textContent.toLowerCase();
    box.appendChild(el('p','mkt-sup-found','Earned through money and contributions together.'));
    if(s.founding_owned) box.appendChild(el('p','mkt-sup-found','You are a Founding supporter: one of the first 100.'));
    if(state.signedIn && next) { box.appendChild(link('topup.html','Top up')); box.appendChild(link('community.html','Contribute')); }
    box.hidden=false;
  }
  // Themes tab, last: supporters choose the next theme. Everyone sees the count.
  function drawVote() {
    var sec = sections().themes, box = $('mkt-vote');
    if (!sec) return;
    if (!box) { box = el('section', 'mkt-vote'); box.id = 'mkt-vote'; box.setAttribute('aria-labelledby', 'vote-h'); sec.appendChild(box); }
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!poll || !Array.isArray(poll.options) || !poll.options.length) { box.hidden = true; return; }
    var h = el('h3', 'mkt-sub', ui('Choose the next theme')); h.id = 'vote-h';
    var total = poll.options.reduce(function (a, o) { return a + (Number(o.votes) || 0); }, 0);
    var ul = el('ul', 'mkt-vote-list');
    poll.options.forEach(function (o) {
      var n = Number(o.votes) || 0, li = el('li', 'mkt-vote-opt' + (poll.my_vote === o.id ? ' mine' : ''));
      var bar = el('i', 'mkt-vote-bar'); bar.style.width = (total ? Math.round(n / total * 100) : 0) + '%';
      add(li, [add(el('div', 'mkt-vote-text'), [el('b', null, o.name), el('span', null, o.description)]), bar, el('span', 'mkt-vote-n', n + (n === 1 ? ' vote' : ' votes'))]);
      if (poll.can_vote) {
        var b = btn('mkt-mini', poll.my_vote === o.id ? 'Your vote' : 'Vote', function () {
          b.disabled = true;
          Promise.resolve(FG.sb.rpc('vote_theme', { p_option: o.id })).then(function (r) { if (!r.error && r.data) { poll = r.data; drawVote(); } else b.disabled = false; }, function () { b.disabled = false; });
        }, 'Vote for ' + o.name);
        if (poll.my_vote === o.id) b.disabled = true;
        li.appendChild(b);
      }
      ul.appendChild(li);
    });
    var why = el('p', 'mkt-vote-why', poll.can_vote ? (MAIN ? 'Supporters choose. You can change your vote until the theme ships.' : 'supporters choose. you can change your vote until the theme ships.')
      : (MAIN ? 'Supporters choose: earn a supporter badge through money and contributions to vote.' : 'supporters choose: earn a supporter badge through money and contributions to vote.'));
    add(box, [h, why, ul]);
    box.hidden = view !== 'themes';
  }
  // Owned tab, first: what other members gave you.
  function drawGifts(g) {
    var box = $('mkt-gifts');
    if (!box) {
      box = el('section', 'mkt-gifts'); box.id = 'mkt-gifts'; box.setAttribute('aria-labelledby', 'gifts-h');
      var tabs = doc.querySelector('.mkt-tabs'); if (!tabs) return;
      tabs.parentNode.insertBefore(box, tabs.nextSibling);
    }
    while (box.firstChild) box.removeChild(box.firstChild);
    var got = g && Array.isArray(g.received) ? g.received : [];
    box.setAttribute('data-has', got.length ? '1' : '');
    if (got.length) {
      var h = el('h2', 'mkt-sub', ui('Gifts for you')); h.id = 'gifts-h';
      var ul = el('ul', 'mkt-gift-list');
      got.slice(0, 8).forEach(function (x) { var li = el('li'); add(li, [el('b', null, x.item), el('span', null, (MAIN ? 'From ' : 'from ') + x.from)]); ul.appendChild(li); });
      add(box, [h, ul]);
    }
    box.hidden = view !== 'owned' || !got.length;
  }

  /* ---------- hooks for js/forgeeks-market.js ---------- */
  root.MarketUI = {
    preview: function (it, compact) {
      if (it.type !== 'theme' || compact) return null;
      var t = siteTheme(it.id);
      if (!t) return null;
      if (tierOf(it) === 'texture') {
        // the textured tier shows itself large: the main site, the computer and the phone, all on its texture
        var pal = MAIN ? PV.fromSite(t, root.LightningTheme && root.LightningTheme.get && root.LightningTheme.get() === 'dark' ? 'dark' : 'light') : PV.fromWebsite(t);
        var pair = add(el('div', 'mkt-big-pv'), [PV.site(pal), add(el('div', 'pv-pair'), [PV.pc(PV.fromWebsite(t)), PV.phone(PV.fromWebsite(t))])]);
        pair.setAttribute('aria-hidden', 'true');
        return pair;
      }
      return PV.thumb(PV.fromWebsite(t));
    },
    cell: cellHook,
    rendered: function (state) {
      ms = state;
      build();
      // textured and animated cells move to their own row; the tier row says what each tier is and costs
      var tex = $('list-textured');
      while (tex.firstChild) tex.removeChild(tex.firstChild);
      Array.prototype.forEach.call($('list-themes').querySelectorAll('.mkt-cell'), function (li) {
        var it = state.items.filter(function (x) { return x.id === li.getAttribute('data-item'); })[0];
        if (it && tierOf(it) !== 'palette') tex.appendChild(li);
      });
      drawTiers(state);
      if (apps.length) drawFeatured();
      loadExtras(state);
      orderTabs(state);
      if (!built2) { built2 = true; loadBundled(); }
      arrange();
      drawLook();
      syncSkin(false);
      highlight();
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
