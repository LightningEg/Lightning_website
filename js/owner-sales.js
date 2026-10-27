/* Owner console, Sales view (admin.html #sales): what sold, how it was bought, and where carts stall.
   Reads admin_sales() (supabase/migrations/20261027090000_cart_and_sales_tracking.sql, MFA administrators only) and
   changes nothing. Money here is coins; the Overview shows revenue in EGP from top-ups. Item and member text is only
   ever set with textContent, and the view names no member: orders show a short id and the items bought. */
(function () {
  'use strict';
  var doc = document, FG = window.FG;
  var $ = function (id) { return doc.getElementById(id); };
  var host = $('ops-sales');
  if (!host || !FG) return;
  var days = 30, verified = false, loading = false, again = false;

  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(p, kids) { kids.forEach(function (k) { if (k) p.appendChild(k); }); return p; }
  function num(n) { return Math.round(Number(n || 0)).toLocaleString('en-US'); }
  function pct(a, b) { return Number(b) > 0 ? Math.round(Number(a) / Number(b) * 100) + '%' : '—'; }
  function say(e) { return FG.say ? FG.say(e) : (e && e.message) || 'Could not load this.'; }
  function kpi(label, value, unit, sub) {
    var c = el('article', 'ops-kpi'), v = el('strong', null, value);
    if (unit) v.appendChild(el('small', null, ' ' + unit));
    add(c, [el('span', 'ops-kpi-l', label), v, sub ? el('p', 'ops-sub', sub) : null]);
    return c;
  }
  function when(ts) { var t = new Date(ts); return isNaN(t) ? '' : t.toISOString().slice(0, 16).replace('T', ' '); }
  function kindOf(t) { return { theme: 'Theme', set: 'Set', banner: 'Banner', frame: 'Frame', badge: 'Badge', name: 'Name style' }[t] || t; }

  function chart(rows) {
    var ns = 'http://www.w3.org/2000/svg', w = 600, h = 140, max = 0;
    rows.forEach(function (d) { max = Math.max(max, Number(d.coins)); });
    var svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); svg.setAttribute('class', 'ops-chart'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Coins spent per day over the last ' + rows.length + ' days' + (max ? ', best day ' + num(max) + ' coins' : ''));
    var bw = w / Math.max(rows.length, 1);
    rows.forEach(function (d, i) {
      var v = Number(d.coins), bh = max ? Math.max(v ? 4 : 2, (v / max) * (h - 18)) : 2;
      var r = doc.createElementNS(ns, 'rect');
      r.setAttribute('x', (i * bw + 1).toFixed(1)); r.setAttribute('width', Math.max(2, bw - 2).toFixed(1));
      r.setAttribute('y', (h - bh).toFixed(1)); r.setAttribute('height', bh.toFixed(1)); r.setAttribute('rx', '3');
      r.setAttribute('class', v ? 'bar' : 'bar zero');
      var t = doc.createElementNS(ns, 'title'); t.textContent = d.day + ': ' + num(v) + ' coins, ' + num(d.units) + ' sold'; r.appendChild(t);
      svg.appendChild(r);
    });
    return svg;
  }

  function table(head, rows, empty) {
    if (!rows.length) return el('p', 'ops-empty', empty);
    var t = el('table', 'oc-table'), tr = el('tr');
    head.forEach(function (h) { tr.appendChild(el('th', null, h)); });
    t.appendChild(add(el('thead'), [tr]));
    var body = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr');
      r.forEach(function (c, i) { row.appendChild(el('td', i ? 'num' : null, c)); });
      body.appendChild(row);
    });
    t.appendChild(body);
    return add(el('div', 'oc-table-wrap'), [t]);
  }

  function render(s) {
    host.textContent = '';
    var sales = s.sales || {}, orders = s.orders || {}, f = s.funnel || {}, ch = sales.by_channel || {};
    var seg = el('div', 'oc-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Period');
    [7, 30, 90].forEach(function (n) {
      var b = el('button', null, n + ' days'); b.type = 'button'; b.setAttribute('aria-pressed', String(n === days));
      b.addEventListener('click', function () { days = n; load(); });
      seg.appendChild(b);
    });
    var refresh = el('button', 'btn ghost', 'Refresh'); refresh.type = 'button'; refresh.addEventListener('click', load);
    host.appendChild(add(el('div', 'oc-toolbar'), [seg, refresh]));

    var carted = Number((ch.cart || {}).units) || 0;
    host.appendChild(add(el('div', 'ops-kpis'), [
      kpi('Sold', num(sales.units), 'items', num(sales.buyers) + ' buyers · last ' + s.days + ' days'),
      kpi('Coins spent', num(sales.coins), 'coins', 'gifts included'),
      kpi('Orders', num(orders.count), '', 'average ' + num(orders.avg_coins) + ' coins, ' + Number(orders.avg_lines || 0) + ' items'),
      kpi('Bought from the cart', pct(carted, sales.units), '', num(carted) + ' of ' + num(sales.units) + ' sales')]));

    host.appendChild(add(el('section', 'ops-block ops-card'), [
      add(el('div', 'ops-card-h'), [el('h3', null, 'Coins spent per day'), el('span', 'ops-fine', 'cart ' + num((ch.cart || {}).coins) + ' · direct ' + num((ch.direct || {}).coins) + ' · gifts ' + num((ch.gift || {}).coins))]),
      chart(Array.isArray(s.daily) ? s.daily : [])]));

    var stalled = Number(f.stale_carts) || 0;
    host.appendChild(add(el('section', 'ops-block ops-card'), [
      add(el('div', 'ops-card-h'), [el('h3', null, 'Carts'), el('span', 'ops-fine', 'from add to order')]),
      add(el('div', 'ops-kpis'), [
        kpi('Added to a cart', num(f.adds), 'items', num(f.carts_started) + ' members · ' + num(f.removed) + ' taken out again'),
        kpi('Checked out', num(f.checkouts), 'orders', pct(f.checkouts, f.carts_started) + ' of members who started a cart'),
        kpi('Waiting in carts now', num(f.open_carts), 'carts', num(f.open_listed_coins) + ' coins at list price'),
        kpi('Stalled over a day', num(stalled), 'carts', stalled ? num(f.stale_listed_coins) + ' coins not yet spent' : 'nothing is stuck')])]));

    var items = Array.isArray(s.by_item) ? s.by_item : [];
    host.appendChild(add(el('section', 'ops-block'), [add(el('div', 'ops-card-h'), [el('h3', null, 'Every item that moved')]),
      table(['Item', 'Sold', 'Coins', 'Added to carts', 'Added → sold', 'In carts now'],
        items.map(function (i) { return [i.name + ' · ' + kindOf(i.type), num(i.units), num(i.coins), num(i.adds), pct(i.units, i.adds), num(i.in_carts)]; }),
        'Nothing has sold or been added to a cart in this period.')]));

    var recent = Array.isArray(s.recent_orders) ? s.recent_orders : [];
    host.appendChild(add(el('section', 'ops-block'), [add(el('div', 'ops-card-h'), [el('h3', null, 'Latest orders')]),
      table(['Order', 'When (UTC)', 'Items', 'Coins'],
        recent.map(function (o) { return [o.id, when(o.at), (o.items || []).join(', '), num(o.total)]; }),
        'No cart orders yet.')]));
  }

  function load() {
    if (!verified) return Promise.resolve();
    if (loading) { again = true; return Promise.resolve(); }
    loading = true;
    return Promise.resolve(FG.sb.rpc('admin_sales', { p_days: days })).then(function (r) {
      if (r.error) throw r.error;
      render(r.data || {});
    }).catch(function (e) {
      host.textContent = '';
      host.appendChild(el('p', 'ops-empty', 'Sales did not load. ' + say(e)));
    }).then(function () { loading = false; if (again) { again = false; load(); } });
  }
  window.addEventListener('lightning:owner-access', function (e) {
    verified = !!(e.detail && e.detail.verified);
    if (verified) load(); else { host.textContent = ''; host.appendChild(el('p', 'ops-empty', 'Verify your session to load sales.')); }
  });
  window.addEventListener('lightning:owner-view', function (e) { if (verified && e.detail && e.detail.view === 'sales') load(); });
  window.addEventListener('lightning:owner-changed', function () { if (!$('sales').hidden) load(); });
  window.FGOwnerSales = { load: load };
})();
