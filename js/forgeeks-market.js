/* For Geeks market (forgeeks-market.html): themes and banners, for looks only, bought with earned coins.
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

  var state = { items: [], signedIn: false, uid: null, balance: 0, busy: false, run: 0 };
  var dlg = { item: null, key: null, trigger: null, busy: false, done: false };

  /* ---------- small helpers ---------- */
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function coins(n) { return n + (n === 1 ? ' coin' : ' coins'); }
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
  function preview(it, compact) { return it.type === 'banner' ? bannerPreview(it) : themePreview(it, compact); }

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

  function actions(it, compact) {
    var row = el('div', 'mkt-acts');
    if (!state.signedIn) return row; // signed out: browse only, the sign-in link is at the top
    var ghost = compact ? 'mkt-mini' : 'btn ghost';
    if (it.equipped) {
      row.appendChild(el('span', 'mkt-state', '✓ equipped'));
      if (it.type === 'banner') row.appendChild(button('mkt-mini', 'remove banner', 'remove', it, 'remove banner ' + it.name));
    } else if (it.owned) {
      row.appendChild(button(ghost, 'equip', 'equip', it));
    } else {
      row.appendChild(button(ghost, 'buy', 'buy', it));
    }
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
    head.appendChild(el('span', 'mkt-tag', free ? 'free' : (it.owned ? 'owned' : coins(it.price))));
    li.appendChild(head);
    if (!compact && it.description) li.appendChild(el('p', 'mkt-note', it.description));
    li.appendChild(actions(it, compact));
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
    var themes = state.items.filter(function (i) { return i.type === 'theme'; });
    fill('list-themes', themes.filter(function (i) { return !i.is_default; }));
    fill('list-free', themes.filter(function (i) { return i.is_default; }));
    fill('list-banners', state.items.filter(function (i) { return i.type === 'banner'; }));
    $('h-free').hidden = $('list-free').children.length === 0;
  }

  /* ---------- loading ---------- */
  function readWallet() {
    return FG.sb.from('wallets').select('balance,contribution_score').eq('user_id', state.uid).maybeSingle();
  }
  function refreshWallet() {
    if (!state.signedIn) return Promise.resolve();
    return Promise.resolve(readWallet()).then(function (r) {
      if (!r.error) { state.balance = r.data ? r.data.balance : 0; $('coins').textContent = String(state.balance); }
    }, function () {});
  }

  function load() {
    var run = ++state.run;
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
  function mark(it) {
    state.items.forEach(function (x) { if (x.type === it.type) x.equipped = x.id === it.id; });
  }

  function equip(it) {
    return Promise.resolve(FG.sb.rpc('equip_item', { p_item_id: it.id })).then(function (r) {
      if (r.error) return { error: r.error };
      mark(it);
      if (it.type === 'theme') applyTheme(it.id);
      return {};
    }, function (e) { return { error: e }; });
  }

  function onAct(act, it, btn) {
    if (state.busy) return;
    if (act === 'buy') { openBuy(it, btn); return; }
    setBusy(true);
    var p = act === 'equip'
      ? equip(it).then(function (r) { if (!r.error) note(it.name + ' is equipped.', 'ok'); return r; })
      : Promise.resolve(FG.sb.rpc('unequip_slot', { p_slot: 'banner' })).then(function (r) {
          if (r.error) return { error: r.error };
          state.items.forEach(function (x) { if (x.type === 'banner') x.equipped = false; });
          note('Banner removed.', 'ok');
          return {};
        }, function (e) { return { error: e }; });
    p.then(function (r) {
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

  function openBuy(it, trigger) {
    dlg.item = it; dlg.key = newKey(); dlg.trigger = trigger; dlg.busy = false; dlg.done = false;
    $('buy-title').textContent = 'buy ' + it.name.toLowerCase();
    var pv = $('buy-pv');
    while (pv.firstChild) pv.removeChild(pv.firstChild);
    pv.appendChild(preview(it, false));
    $('buy-note').textContent = it.description || '';
    $('buy-l1').textContent = 'price';
    $('buy-l2').textContent = 'balance now';
    $('buy-l3').textContent = 'balance after';
    $('buy-price').textContent = coins(it.price);
    $('buy-now').textContent = coins(state.balance);
    var after = state.balance - it.price;
    $('buy-after').textContent = after >= 0 ? coins(after) : '−' + coins(-after);
    dstatus(after < 0 ? 'You have ' + coins(state.balance) + '. The server decides if this goes through.' : '');
    $('buy-ok').hidden = false; $('buy-ok').disabled = false;
    $('buy-equip').hidden = true; $('buy-cancel').textContent = 'cancel';
    $('buy').hidden = false;
    doc.documentElement.style.overflow = 'hidden';
    $('buy-ok').focus();
  }

  function closeBuy() {
    if ($('buy').hidden) return;
    $('buy').hidden = true;
    doc.documentElement.style.overflow = '';
    var back = dlg.item && doc.querySelector('.mkt-cell[data-item="' + dlg.item.id + '"] button');
    var target = back || (dlg.trigger && doc.contains(dlg.trigger) ? dlg.trigger : null);
    if (target) target.focus();
  }

  function confirmBuy(ev) {
    if (ev && ev.detail > 1) return; // the second click of a double click
    if (dlg.busy || dlg.done || !dlg.item) return;
    var it = dlg.item, key = dlg.key;
    dlg.busy = true;
    $('buy-ok').disabled = true;
    dstatus('');
    Promise.resolve(FG.sb.rpc('purchase_item', { p_item_id: it.id, p_idempotency_key: key })).then(function (r) { return r; }, function (e) { return { error: e }; })
      .then(function (r) {
        dlg.busy = false;
        if (r.error) { buyFailed(it, r.error); return; }
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

  function buyFailed(it, err) {
    var msg = say(err);
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
    var it = dlg.item;
    if (!it || dlg.busy) return;
    dlg.busy = true;
    $('buy-equip').disabled = true;
    equip(it).then(function (r) {
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
    var f = Array.prototype.filter.call(win().querySelectorAll('button'), function (b) { return !b.disabled && !b.hidden; });
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
    if (!FG || !FG.ready) { unavailable(); return; }
    FG.ready.then(function () {
      if (!FG.sb) { unavailable(); return; }
      load();
      FG.onAuth(function () { closeBuy(); load(); });
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(window);
