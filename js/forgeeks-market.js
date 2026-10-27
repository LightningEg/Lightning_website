/* For Geeks market (forgeeks-market.html): themes and banners, for looks only, bought with earned Cotton Plants.
   Talks to Supabase through window.FG (js/forgeeks-auth.js) and the functions in
   supabase/migrations/20261025120000_forgeeks_market.sql. The server decides every price and every purchase;
   this page only shows what market_catalog() returns and sends item ids. Text from the catalog is only ever
   set with textContent. Tested in supabase/tests/market-pages.test.mjs. */
(function (root) {
  'use strict';
  var doc = root.document;
  var $ = function (id) { return doc.getElementById(id); };
  var FG = root.FG;
  var LG = root.LG; // the theme picker (js/forgeeks.js), if present
  // The main-site marketplace adds tabs, previews and try-on through these hooks (js/site-market.js); For Geeks has none.
  function ui(name) { var U = root.MarketUI; return U && typeof U[name] === 'function' ? U[name].bind(U) : null; }

  var state = { items: [], signedIn: false, uid: null, balance: 0, busy: false, run: 0 };
  var dlg = { item: null, key: null, trigger: null, busy: false, done: false, gift: false };

  /* ---------- small helpers ---------- */
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function coins(n) { return n + (n === 1 ? ' Cotton Plant' : ' Cotton Plants'); }
  // What a cell costs this member: a set is 80% of the parts they do not own yet (set_price, from the server).
  function priceOf(it) { return it.type === 'set' ? Number(it.set_price) || 0 : it.price; }
  // Gifts: anything on sale that is not a set, an earned badge or a free default.
  function giftable(it) {
    var t = it.type === 'theme' ? theme(it.id) : null, ended = it.available_until && !daysLeft(it);
    return state.signedIn && !it.award && it.type !== 'set' && !it.is_default && it.price > 0 && !(t && t.archived) && !ended;
  }
  // Seasonal: whole days left in the window, counted up (an item leaving tonight says 1 day).
  function daysLeft(it) {
    if (!it.available_until) return null;
    var ms = new Date(it.available_until).getTime() - Date.now();
    return isFinite(ms) && ms > 0 ? Math.ceil(ms / 864e5) : null;
  }
  function say(err) { return FG && FG.say ? FG.say(err) : 'Something went wrong. Try again.'; }
  function note(msg, kind) {
    var m = $('mkt-msg');
    m.textContent = msg || '';
    m.hidden = !msg;
    m.className = 'acct-msg' + (kind ? ' ' + kind : '');
  }
  // One key per dialog: a retry in the same dialog reuses it, so the server charges once.
  function newKey() {
    var c = root.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b); else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function theme(id) {
    var l = (LG && LG.THEMES) || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  // Apply a theme now and remember it here; the picker does the same if it is loaded.
  function applyTheme(id) {
    if (doc.body.dataset.mainStore) {
      try { root.localStorage.setItem("lightning-geeks-theme", id); } catch (_) {}
      return; // Website cosmetics belong to For Geeks; preserve the main site light/dark setting.
    }
    if (LG && LG.use) { LG.use(id); return; }
    var r = doc.documentElement;
    if (id === 'mono') delete r.dataset.theme; else r.dataset.theme = id;
    try { root.localStorage.setItem('lightning-geeks-theme', id); } catch (_) {}
  }

  /* ---------- previews ---------- */
  function themePreview(it, compact) {
    var t = theme(it.id);
    if (compact) {
      var d = el('span', 'dots');
      d.setAttribute('aria-hidden', 'true');
      (t ? [t.c[0], t.c[1], t.c[3]] : []).forEach(function (c) { var i = doc.createElement('i'); i.style.background = c; d.appendChild(i); });
      return d;
    }
    var pv = el('div', 'tm-pv mkt-pv');
    pv.setAttribute('aria-hidden', 'true');
    if (!t) return pv;
    pv.style.background = t.c[0]; pv.style.color = t.c[1];
    [[72, t.c[1], 1], [52, t.c[2], 0.85], [34, t.c[3], 1]].forEach(function (b) {
      var i = doc.createElement('i');
      i.style.width = b[0] + '%'; i.style.background = b[1];
      if (b[2] < 1) i.style.opacity = b[2];
      pv.appendChild(i);
    });
    var tab = doc.createElement('b');
    tab.style.background = t.c[3];
    pv.appendChild(tab);
    return pv;
  }
  function bannerPreview(it) {
    var b = el('div', 'fg-banner');
    b.setAttribute('data-item', it.id);
    b.setAttribute('aria-hidden', 'true');
    return b;
  }
  // A frame is shown on a sample avatar, a badge as itself beside a sample name. Both only set catalog ids.
  function framePreview(it) {
    var w = el('div', 'mkt-pv mkt-pv-item');
    w.setAttribute('aria-hidden', 'true');
    var av = el('span', 'av lg', 'L');
    av.setAttribute('data-frame', it.id);
    w.appendChild(av);
    return w;
  }
  function badgePreview(it) {
    var w = el('div', 'mkt-pv mkt-pv-item');
    w.setAttribute('aria-hidden', 'true');
    var S = root.FGShow, b = S && S.badge ? S.badge(it.id) : null;
    w.appendChild(el('span', 'mkt-pv-name', 'Your name'));
    if (b) w.appendChild(b);
    return w;
  }
  function namePreview(it) {
    var w = el('div', 'mkt-pv mkt-pv-item');
    w.setAttribute('aria-hidden', 'true');
    var n = el('span', 'mkt-pv-name mkt-pv-styled', 'Your name');
    var S = root.FGShow;
    if (S && S.nameStyle) S.nameStyle(n, it.id);
    w.appendChild(n);
    return w;
  }
  // A set: its banner, with the theme's colours and the other parts' marks laid over it.
  function setPreview(it) {
    var w = el('div', 'mkt-pv mkt-pv-set');
    w.setAttribute('aria-hidden', 'true');
    var parts = Array.isArray(it.parts) ? it.parts : [];
    var find = function (type) { for (var i = 0; i < parts.length; i++) { var x = byId(parts[i]); if (x && x.type === type) return x; } return null; };
    var b = find('banner'), f = find('frame'), n = find('name'), g = find('badge');
    if (b) w.appendChild(bannerPreview(b));
    var who = el('div', 'mkt-set-who');
    var av = el('span', 'av', 'L'); if (f) av.setAttribute('data-frame', f.id); who.appendChild(av);
    var nm = el('span', 'mkt-pv-name', 'Your name'); var S = root.FGShow;
    if (n && S && S.nameStyle) S.nameStyle(nm, n.id);
    who.appendChild(nm);
    if (g && S && S.badge) { var bd = S.badge(g.id); if (bd) who.appendChild(bd); }
    w.appendChild(who);
    return w;
  }
  function byId(id) { for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i]; return null; }
  function preview(it, compact) {
    var own = ui('preview'), node = own ? own(it, compact) : null;
    if (node) return node;
    return it.type === 'banner' ? bannerPreview(it) : it.type === 'frame' ? framePreview(it) : it.type === 'badge' ? badgePreview(it)
      : it.type === 'name' ? namePreview(it) : it.type === 'set' ? setPreview(it) : themePreview(it, compact);
  }

  /* ---------- cells ---------- */
  function button(cls, label, act, it, aria) {
    var b = el('button', cls, label);
    b.type = 'button';
    b.setAttribute('data-act', act);
    b.setAttribute('data-item', it.id);
    b.setAttribute('aria-label', aria || (label + ' ' + it.name));
    b.addEventListener('click', function () { onAct(act, it, b); });
    return b;
  }

  // The main-site marketplace adds a cart (js/market-cart.js); For Geeks has none and buys one item at a time.
  function addToCart(row, it, cls) {
    var mc = root.MarketCart, b = mc && mc.button ? mc.button(it, cls) : null;
    if (b) row.appendChild(b);
  }

  function actions(it, compact) {
    var row = el('div', 'mkt-acts');
    if (!state.signedIn) return row; // signed out: browse only, the sign-in link is at the top
    var ghost = compact ? 'mkt-mini' : 'btn ghost';
    if (it.type === 'set') {
      if (it.owned || priceOf(it) <= 0) row.appendChild(el('span', 'mkt-state', '✓ yours'));
      else { row.appendChild(button(ghost, 'buy set', 'buy', it)); addToCart(row, it, ghost); }
      return row;
    }
    if (it.equipped) {
      row.appendChild(el('span', 'mkt-state', '✓ equipped'));
      if (it.type === 'banner') row.appendChild(button('mkt-mini', 'remove banner', 'remove', it, 'remove banner ' + it.name));
      if (it.type === 'name') row.appendChild(button('mkt-mini', 'plain name', 'remove', it, 'wear a plain name instead of ' + it.name));
    } else if (it.owned) {
      row.appendChild(button(ghost, 'equip', 'equip', it));
    } else if (it.award) {
      row.appendChild(el('span', 'mkt-state mkt-earn', it.award === 'founding' ? 'first 100 to top up' : 'earned by topping up'));
    } else {
      row.appendChild(button(ghost, 'buy', 'buy', it));
      addToCart(row, it, compact ? 'mkt-mini' : 'btn ghost');
    }
    if (giftable(it)) row.appendChild(button('mkt-mini', 'gift', 'gift', it, 'give ' + it.name + ' to another member'));
    return row;
  }

  function cell(it) {
    var free = !!it.is_default;
    var compact = free && it.type === 'theme';
    var li = el('li', 'mkt-cell ' + (compact ? 'compact ' : '') + it.type + (it.owned && !free ? ' owned' : '') + (it.equipped ? ' equipped' : ''));
    li.setAttribute('data-item', it.id);
    li.setAttribute('data-state', it.equipped ? 'equipped' : (it.owned ? 'owned' : 'for-sale'));
    li.appendChild(preview(it, compact));
    var head = el('div', 'mkt-head');
    head.appendChild(el('h3', 'mkt-name', it.name));
    head.appendChild(el('span', 'mkt-tag', free ? 'free' : it.owned ? (it.award ? 'earned' : 'owned')
      : it.award ? '' : coins(priceOf(it))));
    li.appendChild(head);
    if (!compact && it.description) li.appendChild(el('p', 'mkt-note', it.description));
    var left = daysLeft(it);
    if (left) li.appendChild(el('p', 'mkt-season', left === 1 ? 'last day on sale' : 'on sale for ' + left + ' more days'));
    if (it.type === 'set' && !it.owned && priceOf(it) > 0 && priceOf(it) < it.price) li.appendChild(el('p', 'mkt-season mkt-save', 'instead of ' + coins(it.price)));
    li.appendChild(actions(it, compact));
    var hook = ui('cell');
    if (hook) hook(li, it, state);
    return li;
  }

  function fill(id, list) {
    var ul = $(id);
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    list.forEach(function (it) { ul.appendChild(cell(it)); });
  }

  function render() {
    $('mkt-loading').hidden = true;
    $('mkt-body').hidden = false;
    $('wallet').hidden = !state.signedIn;
    $('coins').textContent = String(state.balance);
    var si = $('mkt-signin');
    si.hidden = state.signedIn;
    if (!state.signedIn) si.href = FG.signInHref();
    // The collection page (collection.html) is this market drawn with only what the member owns.
    var mine = !!doc.body.dataset.collection;
    var items = mine ? state.items.filter(function (i) { return i.owned && i.type !== 'set'; }) : state.items;
    var col = $('mkt-collection');
    if (col) col.hidden = !state.signedIn;
    var themes = items.filter(function (i) { return i.type === 'theme'; });
    fill('list-themes', themes.filter(function (i) { return !i.is_default; }));
    fill('list-free', themes.filter(function (i) { return i.is_default; }));
    fill('list-banners', items.filter(function (i) { return i.type === 'banner'; }));
    if ($('list-frames')) fill('list-frames', items.filter(function (i) { return i.type === 'frame'; }));
    if ($('list-badges')) fill('list-badges', items.filter(function (i) { return i.type === 'badge'; }));
    if ($('list-names')) fill('list-names', items.filter(function (i) { return i.type === 'name'; }));
    if ($('list-sets')) fill('list-sets', mine ? [] : items.filter(function (i) { return i.type === 'set'; }));
    ['frames', 'badges', 'names', 'sets'].forEach(function (k) { var sec = $('sec-' + k); if (sec) sec.hidden = $('list-' + k).children.length === 0; });
    $('h-free').hidden = $('list-free').children.length === 0;
    if (mine) {
      var paid = items.some(function (i) { return !i.is_default; });
      ['themes', 'banners'].forEach(function (k) { var l = $('list-' + k), sec = l && l.closest('section'); if (sec) sec.hidden = k === 'themes' ? false : l.children.length === 0; });
      var empty = $('col-empty'); if (empty) empty.hidden = !state.signedIn || paid;
    }
    var done = ui('rendered');
    if (done) done(state);
  }

  /* ---------- loading ---------- */
  function readWallet() {
    return FG.sb.from('wallets').select('balance,contribution_score').eq('user_id', state.uid).maybeSingle();
  }
  function refreshWallet() {
    if (!state.signedIn) return Promise.resolve();
    var run = state.run;
    return Promise.resolve(readWallet()).then(function (r) {
      if (run !== state.run) return;
      if (!r.error) { state.balance = r.data ? r.data.balance : 0; $('coins').textContent = String(state.balance); }
    }, function () {});
  }

  function load() {
    var run = ++state.run;
    state.busy = false;
    var s = FG.session();
    state.signedIn = !!s;
    state.uid = s ? s.user.id : null;
    var jobs = [FG.sb.rpc('market_catalog')];
    if (s) jobs.push(readWallet());
    Promise.all(jobs).then(function (r) {
      if (run !== state.run) return; // a newer load (sign in or out) replaces this one
      if (r[0].error || !r[0].data) {
        $('mkt-loading').hidden = true;
        note(r[0].error ? say(r[0].error) : 'The market is not available right now.', 'bad');
        return;
      }
      state.items = r[0].data;
      state.balance = s && r[1] && !r[1].error && r[1].data ? r[1].data.balance : 0;
      if (s && r[1] && r[1].error) note(say(r[1].error), 'bad'); else note('');
      render();
      if (LG && LG.own) state.items.forEach(function (i) { if (i.type === 'theme' && !i.is_default) LG.own(i.id, !!i.owned); });
    }, function (e) {
      if (run !== state.run) return;
      $('mkt-loading').hidden = true;
      note(say(e), 'bad');
    });
  }

  /* ---------- equip and remove ---------- */
  function setBusy(on) {
    state.busy = on;
    Array.prototype.forEach.call(doc.querySelectorAll('.mkt-cell button'), function (b) { b.disabled = on; });
  }
  // Tell the page's banner strip (js/site-banner.js) that the equipped banner changed.
  function announce(id) {
    try { doc.dispatchEvent(new root.CustomEvent('lightning:banner', { detail: id })); } catch (e) {}
  }
  function mark(it) {
    state.items.forEach(function (x) { if (x.type === it.type) x.equipped = x.id === it.id; });
    if (it.type === 'banner') announce(it.id);
  }

  function equip(it) {
    var run = state.run;
    return Promise.resolve(FG.sb.rpc('equip_item', { p_item_id: it.id })).then(function (r) {
      if (run !== state.run) return { stale: true };
      if (r.error) return { error: r.error };
      mark(it);
      if (it.type === 'theme') applyTheme(it.id);
      var worn = ui('equipped');
      if (worn) worn(it);
      return {};
    }, function (e) { return { error: e }; });
  }

  function onAct(act, it, btn) {
    if (state.busy) return;
    if (act === 'buy') { openBuy(it, btn); return; }
    if (act === 'gift') { openBuy(it, btn, true); return; }
    setBusy(true);
    var run = state.run;
    var p = act === 'equip'
      ? equip(it).then(function (r) { if (run === state.run && !r.error) note(it.name + ' is equipped.', 'ok'); return r; })
      : Promise.resolve(FG.sb.rpc('unequip_slot', { p_slot: it.type })).then(function (r) {
          if (run !== state.run) return { stale: true };
          if (r.error) return { error: r.error };
          state.items.forEach(function (x) { if (x.type === it.type) x.equipped = false; });
          if (it.type === 'banner') { announce(null); note('Banner removed.', 'ok'); } else note('Your name is plain again.', 'ok');
          return {};
        }, function (e) { return { error: e }; });
    p.then(function (r) {
      if (run !== state.run) return;
      setBusy(false);
      if (r.error) note(say(r.error), 'bad');
      render();
      var again = doc.querySelector('.mkt-cell[data-item="' + it.id + '"] button');
      if (again) again.focus();
    });
  }

  /* ---------- the buy dialog ---------- */
  var win = function () { return $('buy').querySelector('.mkt-win'); };
  function dstatus(msg, bad) { var s = $('buy-status'); s.textContent = msg || ''; s.className = 'acct-status' + (bad ? ' bad' : ''); }

  function openBuy(it, trigger, gift) {
    if(dlg.busy) { note('Your current purchase or equip action is still processing. Wait for its result before choosing another item.'); return; }
    dlg.item = it; dlg.key = newKey(); dlg.trigger = trigger; dlg.busy = false; dlg.done = false; dlg.gift = !!gift;
    $('buy-title').textContent = (gift ? 'gift ' : 'buy ') + it.name.toLowerCase();
    var to = $('buy-gift');
    if (to) { to.hidden = !gift; $('buy-gift-name').value = ''; }
    var pv = $('buy-pv');
    while (pv.firstChild) pv.removeChild(pv.firstChild);
    pv.appendChild(preview(it, false));
    $('buy-note').textContent = it.description || '';
    $('buy-l1').textContent = 'price';
    $('buy-l2').textContent = 'balance now';
    $('buy-l3').textContent = 'balance after';
    var cost = priceOf(it);
    $('buy-price').textContent = coins(cost);
    $('buy-now').textContent = coins(state.balance);
    var after = state.balance - cost;
    $('buy-after').textContent = after >= 0 ? coins(after) : '−' + coins(-after);
    dstatus(after < 0 ? 'You have ' + coins(state.balance) + '. The server decides if this goes through.' : '');
    $('buy-ok').hidden = false; $('buy-ok').disabled = false;
    $('buy-equip').hidden = true; $('buy-cancel').textContent = 'cancel';
    $('buy').hidden = false;
    doc.documentElement.style.overflow = 'hidden';
    if (gift && to) $('buy-gift-name').focus(); else $('buy-ok').focus();
    var opened = ui('buyOpened');
    if (opened) opened(it, state.balance);
  }

  function closeBuy() {
    if ($('buy').hidden) return;
    var closed = ui('buyClosed');
    if (closed) closed();
    $('buy').hidden = true;
    doc.documentElement.style.overflow = '';
    var back = dlg.item && doc.querySelector('.mkt-cell[data-item="' + dlg.item.id + '"] button');
    var target = back || (dlg.trigger && doc.contains(dlg.trigger) ? dlg.trigger : null);
    if (target) target.focus();
  }

  function confirmBuy(ev) {
    if (ev && ev.detail > 1) return; // the second click of a double click
    if (dlg.busy || dlg.done || !dlg.item) return;
    var it = dlg.item, key = dlg.key, run = state.run;
    if (dlg.gift) { confirmGift(it, key, run); return; }
    dlg.busy = true;
    $('buy-ok').disabled = true;
    dstatus('');
    var call = it.type === 'set'
      ? FG.sb.rpc('purchase_set', { p_set_id: it.id, p_expected_price: priceOf(it), p_idempotency_key: key })
      : FG.sb.rpc('purchase_item_at_price', { p_item_id: it.id, p_expected_price: it.price, p_idempotency_key: key });
    Promise.resolve(call).then(function (r) { return r; }, function (e) { return { error: e }; })
      .then(function (r) {
        if (run !== state.run) return;
        dlg.busy = false;
        if (r.error) { buyFailed(it, r.error); return; }
        if (it.type === 'set') { // every part is now yours: read the market again, then say so
          dlg.done = true; closeBuy(); load(); note(it.name + ' is yours: every part is in Owned.', 'ok'); return;
        }
        var paid = r.data && typeof r.data.price_paid === 'number' ? r.data.price_paid : it.price;
        dlg.done = true;
        it.owned = true;
        state.balance = Math.max(0, state.balance - paid);
        if (LG && LG.own && it.type === 'theme') LG.own(it.id, true);
        render();
        $('buy-title').textContent = it.name.toLowerCase() + ' is yours';
        $('buy-l1').textContent = 'paid';
        $('buy-price').textContent = coins(paid);
        $('buy-l2').textContent = 'balance';
        $('buy-now').textContent = coins(state.balance);
        $('buy-l3').textContent = '';
        $('buy-after').textContent = '';
        dstatus('Bought.');
        $('buy-ok').hidden = true;
        $('buy-equip').hidden = false;
        $('buy-cancel').textContent = 'close';
        if ($('buy').hidden) note('Bought ' + it.name + ' for ' + coins(paid) + '.', 'ok'); // the dialog was closed while the request ran
        else $('buy-equip').focus();
        refreshWallet();
      });
  }

  // A gift: the server checks the name, the price and that they do not have it yet; nothing is equipped for them.
  function confirmGift(it, key, run) {
    var name = ($('buy-gift-name').value || '').trim();
    if (!name) { dstatus('Type their display name, as it shows on their profile.', true); $('buy-gift-name').focus(); return; }
    dlg.busy = true;
    $('buy-ok').disabled = true;
    dstatus('');
    Promise.resolve(FG.sb.rpc('gift_item', { p_item_id: it.id, p_recipient: name, p_expected_price: it.price, p_idempotency_key: key }))
      .then(function (r) { return r; }, function (e) { return { error: e }; })
      .then(function (r) {
        if (run !== state.run) return;
        dlg.busy = false;
        if (r.error) {
          if (/price changed/i.test(String((r.error && r.error.message) || ''))) { closeBuy(); load(); note('The price changed. Check the updated price before giving it.', 'bad'); return; }
          dstatus(say(r.error), true); $('buy-ok').disabled = false; return;
        }
        dlg.done = true;
        state.balance = Math.max(0, state.balance - it.price);
        var who = r.data && typeof r.data.to === 'string' ? r.data.to : name;
        $('buy-title').textContent = 'sent to ' + who;
        $('buy-l1').textContent = 'paid'; $('buy-price').textContent = coins(it.price);
        $('buy-l2').textContent = 'balance'; $('buy-now').textContent = coins(state.balance);
        $('buy-l3').textContent = ''; $('buy-after').textContent = '';
        $('buy-gift').hidden = true;
        dstatus(it.name + ' is in their collection now.');
        $('buy-ok').hidden = true;
        $('buy-cancel').textContent = 'close';
        render();
        refreshWallet();
        $('buy-cancel').focus();
      });
  }

  function buyFailed(it, err) {
    var msg = say(err);
    if (/price changed/i.test(String((err && err.message) || ''))) { closeBuy(); load(); note('The price changed. Check the updated price before buying.', 'bad'); return; }
    if (/already owned/i.test(String((err && err.message) || ''))) {
      // The server says it is already yours: show it that way.
      it.owned = true;
      closeBuy();
      render();
      note(msg, 'ok');
      return;
    }
    if ($('buy').hidden) note(msg, 'bad'); else dstatus(msg, true);
    $('buy-ok').disabled = false; // the same dialog keeps the same key, so trying again cannot charge twice
    refreshWallet();
  }

  function equipNow() {
    var it = dlg.item, run = state.run;
    if (!it || dlg.busy) return;
    dlg.busy = true;
    $('buy-equip').disabled = true;
    equip(it).then(function (r) {
      if (run !== state.run) return;
      dlg.busy = false;
      $('buy-equip').disabled = false;
      if (r.error) { dstatus(say(r.error), true); return; }
      closeBuy();
      render();
      note(it.name + ' is equipped.', 'ok');
    });
  }

  function trap(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); closeBuy(); return; }
    if (ev.key !== 'Tab') return;
    var f = Array.prototype.filter.call(win().querySelectorAll('button,input'), function (b) { return !b.disabled && !b.hidden && !(b.closest && b.closest('[hidden]')); });
    if (!f.length) { ev.preventDefault(); win().focus(); return; }
    var first = f[0], last = f[f.length - 1], at = doc.activeElement;
    if (ev.shiftKey && (at === first || !win().contains(at))) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && (at === last || !win().contains(at))) { ev.preventDefault(); first.focus(); }
  }

  /* ---------- start ---------- */
  function unavailable() {
    $('mkt-loading').hidden = true;
    note('Sign-in is not available right now.', 'bad');
  }

  function start() {
    $('buy-ok').addEventListener('click', confirmBuy);
    $('buy-equip').addEventListener('click', equipNow);
    $('buy-cancel').addEventListener('click', closeBuy);
    $('buy').querySelector('[data-close]').addEventListener('click', closeBuy);
    $('buy').addEventListener('keydown', trap);
    if ($('buy-gift-name')) $('buy-gift-name').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); confirmBuy(); } });
    if (!FG || !FG.ready) { unavailable(); return; }
    FG.ready.then(function () {
      if (!FG.sb) { unavailable(); return; }
      load();
      FG.onAuth(function () { closeBuy(); load(); });
      function resume() { if(!doc.hidden && $('buy').hidden && !dlg.busy && !state.busy) load(); }
      root.addEventListener('focus', resume);
      doc.addEventListener('visibilitychange', resume);
    });
  }

  root.LightningMarket = { state: state, reload: load, buy: function (it, b) { if (!state.busy) openBuy(it, b); }, act: onAct, render: render };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(window);
