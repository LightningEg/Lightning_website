/* Owner console, Visitors view (admin.html #traffic): who came, from where, what they did, and how many then made an account.
   Reads admin_traffic() (supabase/migrations/20261101100000_admin_traffic.sql), MFA administrators only, and changes nothing.
   It counts and never names: the records hold no IP address, account or typed text, groups under 5 are folded together, and
   your own browsers are not counted (README › Analytics and consent). An arrival is a page view that did not come from another
   page of this site. Every value is set with textContent. The decision rules and the Page views sheet are still read by
   the owner console › Analytics until they move here (plan item 8X). */
(function () {
  'use strict';
  var doc = document, FG = window.FG;
  var $ = function (id) { return doc.getElementById(id); };
  var host = $('ops-traffic');
  if (!host || !FG) return;
  var days = 30, verified = false, loading = false, again = false;
  var THIN = 100; // under this many arrivals a rate is a hint, not a result (README: wait for a few hundred visits per page)

  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(p, kids) { kids.forEach(function (k) { if (k) p.appendChild(k); }); return p; }
  function num(n) { return Math.round(Number(n || 0)).toLocaleString('en-US'); }
  function pct(a, b) { return Number(b) > 0 ? Math.round(Number(a) / Number(b) * 100) + '%' : '—'; }
  function say(e) { return FG.say ? FG.say(e) : (e && e.message) || 'Could not load this.'; }
  function kpi(label, value, sub) {
    var c = el('article', 'ops-kpi');
    add(c, [el('span', 'ops-kpi-l', label), el('strong', null, value), sub ? el('p', 'ops-sub', sub) : null]);
    return c;
  }

  function chart(rows) {
    var ns = 'http://www.w3.org/2000/svg', w = 600, h = 120, max = 0;
    rows.forEach(function (d) { max = Math.max(max, Number(d.arrivals)); });
    var svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); svg.setAttribute('class', 'ops-chart'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Arrivals per day over the last ' + rows.length + ' days' + (max ? ', best day ' + num(max) : ', none yet'));
    var bw = w / Math.max(rows.length, 1);
    rows.forEach(function (d, i) {
      var v = Number(d.arrivals), bh = max ? Math.max(v ? 4 : 2, (v / max) * (h - 18)) : 2;
      var r = doc.createElementNS(ns, 'rect');
      r.setAttribute('x', (i * bw + 1).toFixed(1)); r.setAttribute('width', Math.max(2, bw - 2).toFixed(1));
      r.setAttribute('y', (h - bh).toFixed(1)); r.setAttribute('height', bh.toFixed(1)); r.setAttribute('rx', '3');
      r.setAttribute('class', v ? 'bar' : 'bar zero');
      var t = doc.createElementNS(ns, 'title');
      t.textContent = d.day + ': ' + num(v) + (v === 1 ? ' arrival' : ' arrivals') + ', ' + num(d.members) + ' new ' + (Number(d.members) === 1 ? 'member' : 'members') + ', ' + num(d.downloads) + ' download presses';
      r.appendChild(t); svg.appendChild(r);
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

  function steps(rows) {
    var list = el('ol', 'ops-steps');
    rows.forEach(function (r, i) {
      add(list, [add(el('li'), [el('span', 'ops-step-l', r[0]), el('strong', null, num(r[1])),
        el('small', 'ops-sub', i ? pct(r[1], rows[i - 1][1]) + ' of the step before' : (r[2] || ''))])]);
    });
    return list;
  }

  function render(s) {
    host.textContent = '';
    var t = s.totals || {}, seg = el('div', 'oc-seg');
    seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Period');
    [[7, '7 days'], [30, '30 days'], [90, '90 days']].forEach(function (p) {
      var b = el('button', null, p[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(p[0] === days));
      b.addEventListener('click', function () { days = p[0]; load(); });
      seg.appendChild(b);
    });
    var refresh = el('button', 'btn ghost', 'Refresh'); refresh.type = 'button'; refresh.addEventListener('click', load);
    host.appendChild(add(el('div', 'oc-toolbar'), [seg, refresh]));

    var arrivals = Number(t.arrivals) || 0, thin = arrivals < THIN;
    host.appendChild(add(el('div', 'ops-kpis'), [
      kpi('Arrivals', num(arrivals), 'from outside the site, last ' + s.days + ' days'),
      kpi('Read something', pct(t.engaged, arrivals), num(t.engaged) + ' scrolled half the page or stayed 15 seconds'),
      kpi('Reached Downloads', pct(t.reached_downloads, arrivals), num(t.download_presses) + ' pressed an app download'),
      kpi('Made an account', pct(t.new_members, arrivals), num(t.new_members) + ' new members; administrators not counted')]));
    host.appendChild(el('p', 'ops-fine', (thin ? 'Under ' + THIN + ' arrivals: read these as hints, not results. ' : '') +
      (s.live_from ? 'Records start ' + s.live_from + '. ' : 'No records yet. ') +
      'A member can have signed up without visiting in this period, so the last figure is a rough rate, not a funnel.'));

    host.appendChild(add(el('section', 'ops-block ops-card'), [
      add(el('div', 'ops-card-h'), [el('h3', null, 'From arriving to downloading'), el('span', 'ops-fine', 'arrivals only')]),
      steps([['Arrived', arrivals, 'a page view that did not come from this site'], ['Read something', t.engaged],
        ['Reached Downloads', t.reached_downloads], ['Pressed an app download', t.download_presses]])]));

    host.appendChild(add(el('section', 'ops-block ops-card'), [
      add(el('div', 'ops-card-h'), [el('h3', null, 'Arrivals per day'), el('span', 'ops-fine', 'hover a bar for members and downloads')]),
      chart(Array.isArray(s.daily) ? s.daily : [])]));

    var src = Array.isArray(s.sources) ? s.sources : [];
    host.appendChild(add(el('section', 'ops-block'), [add(el('div', 'ops-card-h'), [el('h3', null, 'Where they came from'), el('span', 'ops-fine', 'a campaign tag wins over the site')]),
      table(['Source', 'Arrivals', 'Share'], src.map(function (r) { return [r.source, num(r.arrivals), pct(r.arrivals, arrivals)]; }), 'No arrivals yet.'),
      el('p', 'ops-fine', 'Sources with fewer than 5 arrivals are folded into smaller groups.')]));

    var pages = Array.isArray(s.pages) ? s.pages : [];
    host.appendChild(add(el('section', 'ops-block'), [add(el('div', 'ops-card-h'), [el('h3', null, 'Where they landed')]),
      table(['Page', 'Arrivals', 'Read something'], pages.map(function (r) { return [r.page, num(r.arrivals), pct(r.engaged, r.arrivals)]; }), 'No arrivals yet.')]));

    var dev = Array.isArray(s.devices) ? s.devices : [], lang = Array.isArray(s.languages) ? s.languages : [];
    host.appendChild(add(el('section', 'ops-block'), [add(el('div', 'ops-card-h'), [el('h3', null, 'Device and language')]),
      table(['Group', 'Arrivals', 'Share'],
        dev.map(function (r) { return [r.device, num(r.arrivals), pct(r.arrivals, arrivals)]; })
          .concat(lang.map(function (r) { return [r.lang === 'ar' ? 'Arabic pages' : r.lang === 'en' ? 'English pages' : r.lang, num(r.arrivals), pct(r.arrivals, arrivals)]; })),
        'No arrivals yet.')]));

    host.appendChild(el('p', 'ops-fine', num(s.errors) + ' page views hit a script or file error and ' + num(s.slow) + ' were slow to show their main content (over 4 seconds). ' +
      'The decision rules and the search view are still in the Analytics dashboard until they move here.'));
  }

  function load() {
    if (!verified) return Promise.resolve();
    if (loading) { again = true; return Promise.resolve(); }
    loading = true;
    return Promise.resolve(FG.sb.rpc('admin_traffic', { p_days: days })).then(function (r) {
      if (r.error) throw r.error;
      render(r.data || {});
    }).catch(function (e) {
      host.textContent = '';
      host.appendChild(el('p', 'ops-empty', 'Visitors did not load. ' + say(e)));
    }).then(function () { loading = false; if (again) { again = false; load(); } });
  }
  window.addEventListener('lightning:owner-access', function (e) {
    verified = !!(e.detail && e.detail.verified);
    if (verified) load(); else { host.textContent = ''; host.appendChild(el('p', 'ops-empty', 'Verify your session to load visitors.')); }
  });
  window.addEventListener('lightning:owner-tab', function (e) { if (verified && e.detail && e.detail.tab === 'traffic') load(); });
  window.addEventListener('lightning:owner-changed', function () { var v = $('traffic'); if (v && !v.hidden) load(); });
  window.FGOwnerTraffic = { load: load };
})();
