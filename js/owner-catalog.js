/* Owner console, Catalogue view (admin.html #catalogue): tier prices, app releases and every item on sale.
   Reads admin_catalog() and changes prices, sale state and app releases only through the MFA-checked functions in
   supabase/migrations/20261026110000_catalogue_and_app_release.sql. A theme takes its tier's price everywhere it is
   worn (guideline/themes.md section 7); a set follows its parts at 80%; free and earned items are never priced. */
(function () {
  'use strict';
  var doc = document, FG = window.FG;
  var $ = function (id) { return doc.getElementById(id); };
  var host = $('ops-catalogue');
  if (!host || !FG) return;
  var TIERS = [['palette', 'Palette', 'New colours on both sites, the PC and the phone'],
               ['texture', 'Textured', 'The palette plus a material: a woven ground, grain, edge light'],
               ['motion', 'Animated', 'The material plus one slow signature motion, still under reduced motion']];
  var KINDS = [['all', 'All'], ['theme', 'Themes'], ['set', 'Sets'], ['banner', 'Banners'], ['frame', 'Frames'], ['badge', 'Badges'], ['name', 'Names']];
  var data = null, kind = 'all', loading = false, verified = false;
  var unlocks = {};                                   // admin_app_unlocks(): per theme with its unlock on, keyed by item id
  var claimsForm = $('admin-claims-form');            // Free a profile (js/owner-claims.js): kept here, in App themes, one home for seats

  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(p, kids) { kids.forEach(function (k) { if (k) p.appendChild(k); }); return p; }
  function num(n) { return Math.round(Number(n || 0)).toLocaleString('en-US'); }
  function rate() { return Number(data && data.coins_per_egp) || 5; }
  function egp(coins) { return num(Number(coins) / rate()) + ' EGP'; }
  function rpc(name, args) { return Promise.resolve(FG.sb.rpc(name, args)).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function say(e) { return FG.say ? FG.say(e) : (e && e.message) || 'Could not complete this.'; }
  function button(text, cls, fn, status) {
    var b = el('button', cls || 'btn ghost', text); b.type = 'button';
    b.onclick = function () { b.disabled = true; Promise.resolve().then(fn).catch(function (e) { status.textContent = say(e); }).then(function () { b.disabled = false; }); };
    return b;
  }
  function tierName(t) { for (var i = 0; i < TIERS.length; i++) if (TIERS[i][0] === t) return TIERS[i][1]; return ''; }
  function kindOf(i) {
    if (i.type === 'theme') return tierName(i.tier) + ' theme';
    var k = { set: 'Set', banner: 'Banner', frame: 'Frame', badge: 'Badge', name: 'Name style' }[i.type] || i.type;
    return i.tier === 'motion' ? 'Animated ' + k.toLowerCase() : k;
  }
  function state(i) {
    var now = Date.now();
    if (i.award) return ['Earned', ''];
    if (i.is_default) return ['Free default', ''];
    if (!i.active) return ['Retired', 'bad'];
    if (i.available_until && new Date(i.available_until).getTime() <= now) return ['Season over', ''];
    if (i.available_from && new Date(i.available_from).getTime() > now) return ['Opens ' + String(i.available_from).slice(0, 10), ''];
    if (i.available_until) return ['On sale until ' + String(i.available_until).slice(0, 10), 'good'];
    return ['On sale', 'good'];
  }

  /* ---------- tier prices ---------- */
  function tiers(status) {
    var grid = el('div', 'oc-tiers');
    TIERS.forEach(function (t) {
      var items = data.items.filter(function (i) { return i.type === 'theme' && i.tier === t[0] && !i.is_default && !i.award; });
      var price = (data.tiers || {})[t[0]];
      var card = el('article', 'oc-tier');
      var input = el('input'); input.type = 'number'; input.min = '1'; input.max = '1000000'; input.value = price || '';
      input.setAttribute('aria-label', t[1] + ' price in Cotton');
      var each = el('small', 'oc-hint', price ? egp(price) + ' each' : 'No theme in this tier yet');
      input.addEventListener('input', function () { each.textContent = Number(input.value) > 0 ? egp(input.value) + ' each' : ''; });
      var names = items.map(function (i) { return i.name; });
      add(card, [add(el('header'), [el('h4', null, t[1]), el('span', 'oc-chip', items.length + (items.length === 1 ? ' theme' : ' themes'))]),
        el('p', 'oc-tier-what', t[2]),
        add(el('div', 'oc-price'), [el('strong', null, price ? num(price) : '—'), el('span', null, 'Cotton')]),
        el('p', 'oc-hint', names.length ? names.join(', ') : 'Nothing on sale'),
        add(el('div', 'oc-inline'), [add(el('label', 'oc-inline-l'), [el('span', null, 'New price'), input]),
          button('Save', 'btn', function () {
            var v = Number(input.value);
            if (!(v > 0)) throw Error('Type a price in Cotton.');
            if (v === Number(price)) { status.textContent = 'That is already the ' + t[1].toLowerCase() + ' price.'; return; }
            if (!window.confirm('Set every ' + t[1].toLowerCase() + ' theme to ' + num(v) + ' Cotton (' + egp(v) + ')? ' + items.length + ' themes change; sets that include them follow. People who already bought keep what they paid.')) return;
            return rpc('admin_set_tier_price', { p_tier: t[0], p_price: v }).then(function (n) {
              status.textContent = t[1] + ' is now ' + num(v) + ' Cotton on ' + n + ' theme' + (n === 1 ? '' : 's') + '.';
              return load();
            });
          }, status)]), each]);
      grid.appendChild(card);
    });
    return grid;
  }

  /* ---------- app releases ---------- */
  // "4 profiles claimed · 2 extra profiles sold (150 Cotton) · 9 codes issued", from admin_app_unlocks()
  function unlockLine(u) {
    var claimed = Number(u.profiles_claimed), extra = Number(u.extra_seats_sold), codes = Number(u.codes_issued);
    return num(claimed) + (claimed === 1 ? ' profile' : ' profiles') + ' claimed · ' + num(extra) + (extra === 1 ? ' extra profile' : ' extra profiles') + ' sold (' + num(u.extra_coins) + ' Cotton) · ' +
      num(codes) + (codes === 1 ? ' code' : ' codes') + ' issued';
  }
  function releases(status) {
    var themes = data.items.filter(function (i) { return i.type === 'theme' && (i.app || []).length; });
    var box = el('div', 'oc-releases');
    if (!themes.length) { box.appendChild(el('p', 'ops-empty', 'No app theme is waiting for a release.')); return box; }
    var ul = el('ul', 'oc-rel-list');
    themes.forEach(function (i) {
      (i.app || []).forEach(function (v) {
        var chip = el('span', 'oc-chip ' + (v.enabled ? 'good' : ''), v.enabled ? 'Unlock on' : 'Waiting for the app release');
        var act = v.enabled
          ? button('Pause new unlocks', 'btn ghost', function () {
              if (!window.confirm('Stop issuing new app unlock codes for ' + i.name + '? Members who already unlocked it keep it.')) return;
              return rpc('admin_set_app_release', { p_item_id: i.id, p_version: v.version, p_enabled: false }).then(function () { status.textContent = i.name + ': new unlocks paused.'; return load(); });
            }, status)
          : button('Turn on unlock', 'btn', function () {
              if (!window.confirm('Turn on the app unlock for ' + i.name + ' version ' + v.version + '? Do this only after the app version that carries it has shipped to members on Windows and Android.')) return;
              return rpc('admin_set_app_release', { p_item_id: i.id, p_version: v.version, p_enabled: true }).then(function () { status.textContent = i.name + ': owners can now unlock it in the app.'; return load(); });
            }, status);
        var u = unlocks[i.id], stats = u ? el('small', 'oc-unlock-stats', unlockLine(u)) : null;
        ul.appendChild(add(el('li'), [add(el('span', 'oc-rel-name'), [el('b', null, i.name), el('small', null, tierName(i.tier) + ' · version ' + v.version + ' · ' + num(i.owners) + ' owner' + (Number(i.owners) === 1 ? '' : 's')), stats]), chip, act]));
      });
    });
    box.appendChild(ul);
    if (claimsForm) { claimsForm.hidden = false; box.appendChild(claimsForm); }
    return box;
  }

  /* ---------- every item ---------- */
  function table(status) {
    var rows = data.items.filter(function (i) { return kind === 'all' || i.type === kind; });
    var wrap = el('div', 'oc-table-wrap');
    var t = el('table', 'oc-table');
    var head = el('tr');
    ['Item', 'Kind', 'Price', 'Sold', 'Owners', 'Status', ''].forEach(function (h) { var th = el('th', null, h); th.scope = 'col'; head.appendChild(th); });
    t.appendChild(add(el('thead'), [head]));
    var body = el('tbody');
    rows.forEach(function (i) {
      var st = state(i), tr = el('tr');
      if (!i.active && !i.is_default) tr.className = 'retired';
      var price = el('td', 'num');
      if (i.is_default || i.award) price.appendChild(el('span', 'oc-muted', 'Free'));
      else add(price, [el('b', null, num(i.price) + ' Cotton'), el('small', null, egp(i.price))]);
      var act = el('td', 'oc-act');
      if (!i.is_default && !i.award && i.type !== 'theme' && i.type !== 'set') {
        var edit = el('details', 'oc-edit');
        var input = el('input'); input.type = 'number'; input.min = '1'; input.max = '1000000'; input.value = i.price; input.setAttribute('aria-label', 'Price of ' + i.name + ' in Cotton');
        add(edit, [el('summary', 'btn ghost small', 'Price'), add(el('div', 'oc-inline'), [input, button('Save', 'btn small', function () {
          var v = Number(input.value);
          if (!(v > 0)) throw Error('Type a price in Cotton.');
          return rpc('admin_set_item_price', { p_item_id: i.id, p_price: v }).then(function () { status.textContent = i.name + ' now costs ' + num(v) + ' Cotton (' + egp(v) + ').'; return load(); });
        }, status)])]);
        act.appendChild(edit);
      }
      if (!i.is_default && !i.award) act.appendChild(button(i.active ? 'Retire' : 'Offer again', 'btn ghost small', function () {
        if (i.active && !window.confirm('Take ' + i.name + ' off sale? The ' + num(i.owners) + ' people who own it keep it.')) return;
        return rpc('admin_set_item_active', { p_item_id: i.id, p_active: !i.active }).then(function () { status.textContent = i.name + (i.active ? ' is off sale. Owners keep it.' : ' is on sale again.'); return load(); });
      }, status));
      var name = add(el('td', 'oc-item'), [el('b', null, i.name), el('small', null, i.type === 'set' && i.parts ? i.parts.join(' · ') : i.id)]);
      add(tr, [name, el('td', null, kindOf(i)), price,
        add(el('td', 'num'), [el('b', null, num(i.sold_month) + ' this month'), el('small', null, num(i.sold) + ' in all · ' + num(i.coins) + ' Cotton')]),
        el('td', 'num', num(i.owners)), add(el('td'), [el('span', 'oc-chip ' + st[1], st[0])]), act]);
      body.appendChild(tr);
    });
    if (!rows.length) { var tr = el('tr'), td = el('td', 'ops-empty', 'Nothing of this kind yet.'); td.colSpan = 7; body.appendChild(add(tr, [td])); }
    t.appendChild(body);
    wrap.appendChild(t);
    return wrap;
  }

  function render() {
    host.textContent = '';
    var status = el('p', 'oc-status'); status.setAttribute('role', 'status');
    var filter = el('div', 'oc-seg'); filter.setAttribute('role', 'group'); filter.setAttribute('aria-label', 'Show items');
    KINDS.forEach(function (k) {
      var n = k[0] === 'all' ? data.items.length : data.items.filter(function (i) { return i.type === k[0]; }).length;
      if (!n && k[0] !== 'all') return;
      var b = el('button', null, k[1] + ' ' + n); b.type = 'button'; b.setAttribute('aria-pressed', String(k[0] === kind));
      b.onclick = function () { kind = k[0]; render(); };
      filter.appendChild(b);
    });
    add(host, [status,
      add(el('section', 'ops-block'), [add(el('div', 'ops-card-h'), [el('h3', null, 'Tier prices'), el('span', 'ops-fine', '1 EGP = ' + rate() + ' Cotton')]), tiers(status)]),
      add(el('section', 'ops-block ops-card'), [add(el('div', 'ops-card-h'), [el('h3', null, 'App themes'), el('span', 'ops-fine', 'Bought once, unlocked in the Windows and Android app with a one-time code')]), releases(status)]),
      add(el('section', 'ops-block'), [add(el('div', 'ops-card-h'), [el('h3', null, 'Every item'), filter]), table(status)])]);
  }

  function load() {
    if (loading) return Promise.resolve();
    loading = true;
    var seats = rpc('admin_app_unlocks').then(function (rows) { var m = {}; if (Array.isArray(rows)) rows.forEach(function (u) { if (u && typeof u.item_id === 'string') m[u.item_id] = u; }); return m; }, function () { return {}; });
    return Promise.all([rpc('admin_catalog'), seats]).then(function (x) { var d = x[0]; unlocks = x[1]; data = d || { items: [] }; data.items = data.items || []; render(); })
      .catch(function (e) { host.textContent = ''; host.appendChild(el('p', 'ops-empty', 'The catalogue did not load. ' + say(e))); })
      .then(function () { loading = false; });
  }
  window.addEventListener('lightning:owner-access', function (e) { verified = !!(e.detail && e.detail.verified); if (verified) load(); else { data = null; host.textContent = ''; host.appendChild(el('p', 'ops-empty', 'Verify your session to load the catalogue.')); } });
  window.addEventListener('lightning:owner-view', function (e) { if (verified && e.detail && e.detail.view === 'catalogue') load(); });
  window.FGOwnerCatalog = { load: load };
})();
