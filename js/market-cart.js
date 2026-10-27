/* Marketplace cart (marketplace.html): collect looks, then buy them together in one step.
   The cart lives on the server (cart_view / cart_add / cart_remove / cart_clear) so it follows the member between
   devices, and checkout_cart buys every line or none of them, at the price shown here or not at all. This file only
   shows what the server returns and sends item ids; every price, ownership check and charge is the server's.
   Server text is only ever set with textContent. Tested in supabase/tests/cart.test.mjs and cart-pages.test.mjs. */
(function (root) {
  'use strict';
  var doc = root.document;
  var FG = root.FG;
  var cart = { lines: [], total: 0, balance: 0, suggestions: [], signedIn: false, busy: false };
  var dlg = { key: null, trigger: null, busy: false, done: false };
  var chip, count, win, fab, fabCount;
  var MAIN = !!doc.body.dataset.mainStore;
  // Part B writes sentence case; For Geeks keeps its lower-case commands.
  function T(t) { return MAIN ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
  var KIND = { theme: 'Theme', banner: 'Banner', frame: 'Frame', badge: 'Badge', name: 'Name colour', set: 'Set' };

  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function $(id) { return doc.getElementById(id); }
  function coins(n) { return n + (n === 1 ? ' Cotton Plant' : ' Cotton Plants'); }
  function say(err) { return FG && FG.say ? FG.say(err) : 'Something went wrong. Try again.'; }
  function newKey() {
    var c = root.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b); else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function market() { return root.LightningMarket; }
  // Draw the cards again, but only once the market itself has loaded: an early draw would show an empty page.
  function refresh() { var m = market(); if (m && m.state.items.length) m.render(); }
  function has(id) { return cart.lines.some(function (l) { return l.item_id === id; }); }
  function problems() { return cart.lines.filter(function (l) { return l.status === 'owned' || l.status === 'unavailable'; }); }
  function payable() { return cart.lines.filter(function (l) { return l.status === 'ok'; }); }
  function take(view) {
    cart.lines = (view && view.lines) || [];
    cart.total = Number(view && view.total) || 0;
    cart.balance = Number(view && view.balance) || 0;
    cart.suggestions = (view && Array.isArray(view.suggestions)) ? view.suggestions : [];
    paint();
  }

  /* ---------- the chip beside the wallet ---------- */
  function paint() {
    if (chip) {
      chip.hidden = !cart.signedIn;
      count.textContent = String(cart.lines.length);
    }
    if (fab) {
      var n = cart.lines.length;
      fab.hidden = !(cart.signedIn && n > 0);
      fabCount.textContent = String(n);
      fab.setAttribute('aria-label', 'Cart, ' + n + (n === 1 ? ' item' : ' items'));
    }
    if (!$('cart').hidden && !dlg.done) drawLines();
  }

  /* ---------- load, add, remove ---------- */
  function load() {
    var s = FG && FG.session && FG.session();
    cart.signedIn = !!s;
    if (!s) { cart.lines = []; cart.total = 0; cart.suggestions = []; paint(); return Promise.resolve(); }
    return Promise.resolve(FG.sb.rpc('cart_view')).then(function (r) {
      if (!r.error) take(r.data);
    }, function () {});
  }
  // The button on each card: add, or "in cart" to take it out again.
  function button(it, cls) {
    if (!cart.signedIn) return null;
    var inIt = has(it.id);
    var b = el('button', cls, inIt ? T('in cart ✓') : T('add to cart'));
    b.type = 'button';
    b.setAttribute('data-cart', it.id);
    b.setAttribute('aria-pressed', inIt ? 'true' : 'false');
    b.setAttribute('aria-label', (inIt ? 'remove ' : 'add ') + it.name + (inIt ? ' from your cart' : ' to your cart'));
    b.addEventListener('click', function () { toggle(it, b); });
    return b;
  }
  function toggle(it, btn) {
    if (cart.busy) return;
    cart.busy = true;
    if (btn) btn.disabled = true;
    var adding = !has(it.id);
    Promise.resolve(FG.sb.rpc(adding ? 'cart_add' : 'cart_remove', { p_item_id: it.id }))
      .then(function (r) { return r; }, function (e) { return { error: e }; })
      .then(function (r) {
        cart.busy = false;
        var m = market();
        if (r.error) {
          if (/already owned|already own/i.test(String((r.error && r.error.message) || ''))) { if (m && m.reload) m.reload(); }
          note(say(r.error), 'bad');
        } else {
          take(r.data);
          if (adding) note(it.name + ' is in your cart', 'ok', true);
          else note(it.name + ' is out of your cart', 'ok');
        }
        if (m) m.render();
        var again = doc.querySelector('.mkt-cell[data-item="' + it.id + '"] [data-cart]');
        if (again) again.focus();
      });
  }
  // The status line above the cards. After an add it carries a View cart action.
  function note(msg, kind, withView) {
    var m = $('mkt-msg');
    if (!m) return;
    m.textContent = msg || '';
    m.hidden = !msg;
    m.className = 'acct-msg' + (kind ? ' ' + kind : '');
    if (msg && withView) {
      var v = el('button', 'mkt-linkbtn', T('view cart'));
      v.type = 'button';
      v.addEventListener('click', function () { open(v); });
      m.appendChild(doc.createTextNode(' '));
      m.appendChild(v);
    }
  }

  /* ---------- the cart window ---------- */
  function build() {
    var d = el('div', 'mkt-dlg');
    d.id = 'cart';
    d.hidden = true;
    var back = el('div', 'mkt-back');
    back.setAttribute('data-close', '');
    win = el('div', 'mkt-win mkt-cart-win');
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-modal', 'true');
    win.setAttribute('aria-labelledby', 'cart-title');
    win.tabIndex = -1;
    win.appendChild(el('h2', null, T('your cart'))).id = 'cart-title';
    win.appendChild(el('ul', 'mkt-cart-lines')).id = 'cart-lines';
    win.appendChild(el('div', 'mkt-cart-suggest')).id = 'cart-suggest';
    var sum = el('dl', 'mkt-sum');
    [['cart-l1', 'total', 'cart-total'], ['cart-l2', 'balance now', 'cart-now'], ['cart-l3', 'balance after', 'cart-after']].forEach(function (x) {
      var row = el('div');
      var dt = el('dt', null, T(x[1])); dt.id = x[0];
      var dd = el('dd'); dd.id = x[2];
      row.appendChild(dt); row.appendChild(dd); sum.appendChild(row);
    });
    win.appendChild(sum);
    var st = el('p', 'acct-status'); st.id = 'cart-status'; st.setAttribute('role', 'status');
    win.appendChild(st);
    var row = el('div', 'row');
    [['cart-ok', 'btn', 'buy everything'], ['cart-topup', 'btn ghost', 'top up Cotton Plants'], ['cart-close', 'btn ghost', 'close']].forEach(function (x) {
      var b = x[0] === 'cart-topup' ? el('a', x[1], T(x[2])) : el('button', x[1], T(x[2]));
      if (b.tagName === 'A') b.href = 'topup.html'; else b.type = 'button';
      b.id = x[0];
      row.appendChild(b);
    });
    win.appendChild(row);
    // Emptying the cart is rare and destructive: a quiet link away from the main button.
    var quiet = el('p', 'mkt-cart-quiet');
    var clr = el('button', 'mkt-linkbtn', T('empty cart'));
    clr.type = 'button'; clr.id = 'cart-clear';
    quiet.appendChild(clr);
    win.appendChild(quiet);
    d.appendChild(back); d.appendChild(win);
    doc.body.appendChild(d);
    back.addEventListener('click', close);
    $('cart-close').addEventListener('click', close);
    $('cart-ok').addEventListener('click', checkout);
    $('cart-clear').addEventListener('click', clearAll);
    d.addEventListener('keydown', trap);
  }
  function status(msg, bad) { var s = $('cart-status'); s.textContent = msg || ''; s.className = 'acct-status' + (bad ? ' bad' : ''); }

  function lineNote(l) {
    return l.status === 'covered' ? 'comes with a set in your cart'
      : l.status === 'owned' ? 'you already have this'
      : l.status === 'unavailable' ? 'no longer on sale' : '';
  }
  // A small swatch of the theme's own colours (the website's registry), or a plain dot for other kinds.
  function swatch(l) {
    var s = el('i', 'mkt-cart-sw mkt-cart-sw-' + (l.type || 'item'));
    s.setAttribute('aria-hidden', 'true');
    var list = (root.LG && root.LG.THEMES) || [], t = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === l.item_id) t = list[i];
    if (t && t.c && /^#[0-9a-f]{3,8}$/i.test(t.c[0]) && /^#[0-9a-f]{3,8}$/i.test(t.c[3])) {
      s.style.background = 'linear-gradient(135deg,' + t.c[0] + ' 50%,' + t.c[3] + ' 50%)';
    }
    return s;
  }
  function drawLines() {
    var ul = $('cart-lines');
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    cart.lines.forEach(function (l) {
      var li = el('li', 'mkt-cart-line' + (l.status === 'ok' ? '' : ' off'));
      var name = el('span', 'mkt-cart-name');
      name.appendChild(swatch(l));
      name.appendChild(el('span', null, l.name));
      li.appendChild(name);
      var kind = KIND[l.type] || '';
      var n = lineNote(l);
      if (kind || n) li.appendChild(el('small', null, kind && n ? kind + ' · ' + n : kind || n));
      li.appendChild(el('b', null, l.status === 'ok' ? coins(l.price) : l.status === 'covered' ? 'included' : '—'));
      var rm = el('button', 'mkt-mini', T('remove'));
      rm.type = 'button';
      rm.setAttribute('aria-label', 'remove ' + l.name + ' from your cart');
      rm.addEventListener('click', function () { removeLine(l, rm); });
      li.appendChild(rm);
      ul.appendChild(li);
    });
    drawSuggestions();
    var after = cart.balance - cart.total, bad = problems().length, empty = payable().length === 0;
    $('cart-total').textContent = coins(cart.total);
    $('cart-now').textContent = coins(cart.balance);
    $('cart-after').textContent = after >= 0 ? coins(after) : '−' + coins(-after);
    $('cart-ok').disabled = dlg.busy || empty || bad > 0 || after < 0;
    $('cart-clear').hidden = cart.lines.length === 0; $('cart-clear').parentNode.hidden = cart.lines.length === 0;
    $('cart-topup').hidden = after >= 0;
    if (!cart.lines.length) status('Your cart is empty. Add looks from the marketplace.');
    else if (bad) status('Remove the items marked above, then check out.', true);
    else if (after < 0) status('You need ' + coins(-after) + ' more. Top up, then come back: your cart is kept.', true);
    else status('');
  }
  // The server's set suggestions (8N): one button swaps the parts in the cart for the cheaper set.
  function drawSuggestions() {
    var box = $('cart-suggest');
    while (box.firstChild) box.removeChild(box.firstChild);
    if (dlg.done) return;
    cart.suggestions.forEach(function (g) {
      var saving = Number(g.saving) || 0, extra = Number(g.extra) || 0;
      if (saving <= 0) return;
      var b = el('button', 'mkt-suggest-btn', 'Switch to the ' + g.name + ': save ' + coins(saving));
      b.type = 'button';
      b.setAttribute('data-set', g.set_id);
      b.addEventListener('click', function () { swapFor(g, b); });
      var row = el('p', 'mkt-suggest');
      row.appendChild(b);
      if (extra > 0) row.appendChild(el('small', null, 'It adds the other parts of the set for ' + coins(extra) + ' more.'));
      box.appendChild(row);
    });
  }
  function swapFor(g, btn) {
    if (cart.busy || dlg.busy) return;
    cart.busy = true; btn.disabled = true;
    Promise.resolve(FG.sb.rpc('cart_swap_for_set', { p_set_id: g.set_id })).then(function (r) { return r; }, function (e) { return { error: e }; })
      .then(function (r) {
        cart.busy = false;
        if (r.error) { status(say(r.error), true); btn.disabled = false; return; }
        take(r.data);
        if (market()) market().render();
        var f = win.querySelector('.mkt-cart-line .mkt-mini') || $('cart-close');
        f.focus();
      });
  }
  function removeLine(l, btn) {
    if (cart.busy || dlg.busy) return;
    cart.busy = true; btn.disabled = true;
    Promise.resolve(FG.sb.rpc('cart_remove', { p_item_id: l.item_id })).then(function (r) { return r; }, function (e) { return { error: e }; })
      .then(function (r) {
        cart.busy = false;
        if (r.error) status(say(r.error), true); else take(r.data);
        if (market()) market().render();
        var f = win.querySelector('.mkt-cart-line .mkt-mini') || $('cart-close');
        f.focus();
      });
  }
  function clearAll() {
    if (cart.busy || dlg.busy) return;
    cart.busy = true;
    Promise.resolve(FG.sb.rpc('cart_clear')).then(function (r) { return r; }, function (e) { return { error: e }; })
      .then(function (r) {
        cart.busy = false;
        if (r.error) status(say(r.error), true); else take(r.data);
        if (market()) market().render();
        $('cart-close').focus();
      });
  }

  function open(trigger) {
    if (!cart.signedIn) return;
    dlg.key = newKey(); dlg.trigger = trigger || null; dlg.busy = false; dlg.done = false;
    $('cart-title').textContent = T('your cart');
    $('cart-l1').textContent = T('total'); $('cart-l2').textContent = T('balance now'); $('cart-l3').textContent = T('balance after');
    $('cart-ok').hidden = false;
    $('cart-clear').parentNode.hidden = false;
    $('cart').hidden = false;
    doc.documentElement.style.overflow = 'hidden';
    load().then(function () { drawLines(); (payable().length && !$('cart-ok').disabled ? $('cart-ok') : $('cart-close')).focus(); });
    drawLines();
  }
  function close() {
    if ($('cart').hidden) return;
    $('cart').hidden = true;
    doc.documentElement.style.overflow = '';
    if (dlg.trigger && doc.contains(dlg.trigger)) dlg.trigger.focus();
  }

  function checkout(ev) {
    if (ev && ev.detail > 1) return; // the second click of a double click
    if (dlg.busy || dlg.done) return;
    dlg.busy = true;
    $('cart-ok').disabled = true;
    status('Placing your order…');
    Promise.resolve(FG.sb.rpc('checkout_cart', { p_expected_total: cart.total, p_idempotency_key: dlg.key }))
      .then(function (r) { return r; }, function (e) { return { error: e }; })
      .then(function (r) {
        dlg.busy = false;
        if (r.error) { failed(r.error); return; }
        done(r.data);
      });
  }
  function failed(err) {
    var msg = String((err && err.message) || '');
    // The same key is kept: a retry in this window can never charge twice.
    if (/price changed|cart changed|empty/i.test(msg)) {
      load().then(function () { var m = market(); if (m && m.reload) m.reload(); drawLines(); status(/price changed/i.test(msg) ? 'A price changed. Check the new total before buying.' : say(err), true); });
      return;
    }
    status(say(err), true);
    drawLines();
  }
  function done(order) {
    dlg.done = true;
    cart.lines = []; cart.total = 0;
    cart.balance = Number(order && order.balance) || cart.balance;
    paint();
    $('cart-title').textContent = T('order placed');
    var ul = $('cart-lines');
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    ((order && order.lines) || []).forEach(function (l) {
      var li = el('li', 'mkt-cart-line');
      li.appendChild(el('span', 'mkt-cart-name', l.name));
      li.appendChild(el('b', null, coins(Number(l.price_paid) || 0)));
      ul.appendChild(li);
    });
    $('cart-l1').textContent = T('paid'); $('cart-total').textContent = coins(Number(order && order.total) || 0);
    $('cart-l2').textContent = T('balance'); $('cart-now').textContent = coins(cart.balance);
    $('cart-l3').textContent = ''; $('cart-after').textContent = '';
    $('cart-ok').hidden = true; $('cart-clear').hidden = true; $('cart-clear').parentNode.hidden = true; $('cart-topup').hidden = true;
    $('cart-close').textContent = T('close');
    status('Bought. Everything is in your collection: equip it from the cards.');
    $('cart-close').focus();
    var m = market();
    if (m && m.reload) m.reload();
    note('Order placed for ' + coins(Number(order && order.total) || 0) + '.', 'ok');
  }

  function trap(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key !== 'Tab') return;
    var f = Array.prototype.filter.call(win.querySelectorAll('button,a[href]'), function (b) { return !b.disabled && !b.hidden && !(b.closest && b.closest('[hidden]')); });
    if (!f.length) { ev.preventDefault(); win.focus(); return; }
    var first = f[0], last = f[f.length - 1], at = doc.activeElement;
    if (ev.shiftKey && (at === first || !win.contains(at))) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && (at === last || !win.contains(at))) { ev.preventDefault(); first.focus(); }
  }

  /* ---------- the floating cart button: always in reach while the cart holds something ---------- */
  function buildFab() {
    fab = el('button', 'mkt-cart-fab');
    fab.type = 'button';
    fab.id = 'cart-fab';
    fab.hidden = true;
    fab.setAttribute('aria-haspopup', 'dialog');
    fab.appendChild(el('span', null, T('cart')));
    fabCount = el('b', null, '0');
    fab.appendChild(fabCount);
    fab.addEventListener('click', function () { open(fab); });
    doc.body.appendChild(fab);
    // keep clear of the cookie bar while it is on screen
    var lift = function () {
      var bar = doc.querySelector('.lc-bar'), h = 0;
      if (bar && !('answered' in bar.dataset) && bar.offsetParent !== null) h = bar.offsetHeight;
      fab.style.setProperty('--fab-lift', h ? (h + 12) + 'px' : '0px');
    };
    lift();
    root.addEventListener('resize', lift);
    root.addEventListener('lightning:consent', lift);
    if (root.MutationObserver) new root.MutationObserver(lift).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-answered'] });
    paint();
  }

  /* ---------- start ---------- */
  function start() {
    var wallet = $('wallet');
    if (!wallet || !FG || !FG.ready) return;
    build();
    chip = el('button', 'chip mkt-cart-chip');
    chip.type = 'button';
    chip.id = 'cart-open';
    chip.hidden = true;
    chip.setAttribute('aria-haspopup', 'dialog');
    chip.appendChild(doc.createTextNode(T('cart') + ' '));
    count = el('b', null, '0');
    chip.appendChild(count);
    chip.addEventListener('click', function () { open(chip); });
    wallet.parentNode.insertBefore(chip, wallet.nextSibling);
    buildFab();
    FG.ready.then(function () {
      if (!FG.sb) return;
      load().then(refresh);
      FG.onAuth(function () { close(); load().then(refresh); });
      root.addEventListener('focus', function () { if ($('cart').hidden && !cart.busy) load(); });
    });
  }

  root.MarketCart = { button: button, open: open, has: has, load: load, state: cart };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(window);
