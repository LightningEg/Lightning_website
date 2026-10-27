/* Owner console, Activity view (admin.html #activity): the audit timeline for coins, scores, sales and the owner's
   own actions. Reads admin_activity() (supabase/migrations/20261027100000_activity_audit.sql, MFA administrators
   only) and changes nothing: the records it shows are the append-only ledger, the purchases and the audit log.
   Filter, search by member, item or reference, page back through time, and save what is on screen as a CSV file.
   All server text is set with textContent; spreadsheet formulas in the CSV are neutralised. */
(function () {
  'use strict';
  var doc = document, FG = window.FG;
  var $ = function (id) { return doc.getElementById(id); };
  var host = $('ops-activity');
  if (!host || !FG) return;
  var CATS = [['all', 'Everything'], ['coins', 'Coins'], ['score', 'Scores'], ['sales', 'Sales'], ['admin', 'Owner actions']];
  var PAGE = 50;
  var cat = 'all', search = '', rows = [], more = false, summary = null, verified = false, loading = false, run = 0;
  var list, status, moreBtn, kpis, table;

  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(p, kids) { kids.forEach(function (k) { if (k) p.appendChild(k); }); return p; }
  function num(n) { return Math.round(Number(n || 0)).toLocaleString('en-US'); }
  function signed(n) { n = Number(n || 0); return n ? (n > 0 ? '+' : '−') + num(Math.abs(n)) : ''; }
  function when(ts) { var t = new Date(ts); return isNaN(t) ? '' : t.toISOString().slice(0, 16).replace('T', ' '); }
  function say(e) { return FG.say ? FG.say(e) : (e && e.message) || 'Could not load this.'; }
  function words(e) { return String(e || '').replace(/[._]/g, ' '); }
  function who(r) {
    var by = r.by === 'owner' ? 'owner' : r.by === 'system' ? 'automatic' : '';
    return [r.member || (r.member_ref ? '#' + r.member_ref : 'removed member'), by].filter(Boolean).join(' · ');
  }
  function what(r) {
    var bits = [r.item, r.gift_to ? 'gift to ' + r.gift_to : '', r.order ? 'order ' + r.order : '', r.detail].filter(Boolean);
    return bits.join(' · ');
  }

  function kpi(label, value, unit, sub) {
    var c = el('article', 'ops-kpi'), v = el('strong', null, value);
    if (unit) v.appendChild(el('small', null, ' ' + unit));
    return add(c, [el('span', 'ops-kpi-l', label), v, sub ? el('p', 'ops-sub', sub) : null]);
  }
  function drawSummary() {
    kpis.textContent = '';
    if (!summary) return;
    var s = summary, d = 'last ' + s.days + ' days';
    add(kpis, [
      kpi('Coins in', num(Number(s.paid_in) + Number(s.given)), 'coins', num(s.paid_in) + ' paid · ' + num(s.given) + ' given · ' + d),
      kpi('Coins spent', num(s.spent), 'coins', num(s.refunded) + ' refunded · ' + num(s.corrections) + ' corrections'),
      kpi('Score awarded', num(s.score_awarded), 'points', d),
      kpi('Owner actions', num(s.admin_actions), '', num(s.manual_credits) + ' manual credits')]);
  }

  function drawRows() {
    table.textContent = '';
    if (!rows.length) { table.appendChild(el('p', 'ops-empty', loading ? 'Loading…' : 'Nothing matches in the last ' + (summary ? summary.days : 30) + ' days.')); moreBtn.hidden = true; return; }
    var t = el('table', 'oc-table'), head = el('tr');
    ['When (UTC)', 'Who', 'What', 'Details', 'Coins', 'Score'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    t.appendChild(add(el('thead'), [head]));
    var body = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      add(tr, [el('td', 'num', when(r.at)), el('td', null, who(r)), el('td', null, words(r.event)), el('td', null, what(r)),
        el('td', 'num', signed(r.coins)), el('td', 'num', signed(r.score))]);
      body.appendChild(tr);
    });
    t.appendChild(body);
    table.appendChild(add(el('div', 'oc-table-wrap'), [t]));
    moreBtn.hidden = !more;
  }

  // One cell of a CSV: quoted, and a leading = + - @ made harmless so a spreadsheet never runs it.
  function cell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function csv() {
    var head = ['when_utc', 'category', 'event', 'member', 'member_ref', 'email', 'by', 'item', 'order', 'gift_to', 'reference', 'detail', 'coins', 'score'];
    var lines = [head.map(cell).join(',')];
    rows.forEach(function (r) {
      lines.push([r.at, r.category, r.event, r.member, r.member_ref, r.email, r.by, r.item, r.order, r.gift_to, r.ref, r.detail, r.coins, r.score].map(cell).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }
  function download() {
    if (!rows.length) { status.textContent = 'Nothing to export yet.'; return; }
    var blob = new Blob([csv()], { type: 'text/csv;charset=utf-8' }), a = doc.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lightning-activity-' + cat + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    status.textContent = 'Saved ' + num(rows.length) + ' rows. This file names members: keep it private.';
  }

  function load(append) {
    if (!verified) return Promise.resolve();
    var mine = ++run;
    loading = true;
    if (!append) { rows = []; more = false; drawRows(); }
    var before = append && rows.length ? rows[rows.length - 1].at : null;
    return Promise.resolve(FG.sb.rpc('admin_activity', { p_category: cat, p_search: search || null, p_before: before, p_limit: PAGE, p_days: 30 }))
      .then(function (r) {
        if (mine !== run) return;
        if (r.error) throw r.error;
        var d = r.data || {};
        rows = rows.concat(Array.isArray(d.rows) ? d.rows : []);
        more = !!d.has_more; summary = d.summary || summary;
        status.textContent = '';
        drawSummary();
      })
      .catch(function (e) { if (mine === run) status.textContent = 'Activity did not load. ' + say(e); })
      .then(function () { if (mine === run) { loading = false; drawRows(); } });
  }

  function build() {
    host.textContent = '';
    var seg = el('div', 'oc-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Kind of activity');
    CATS.forEach(function (c) {
      var b = el('button', null, c[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(c[0] === cat));
      b.addEventListener('click', function () {
        cat = c[0];
        Array.prototype.forEach.call(seg.children, function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        load(false);
      });
      seg.appendChild(b);
    });
    var input = el('input', 'oc-search'); input.type = 'search'; input.autocomplete = 'off'; input.maxLength = 80;
    input.placeholder = 'Member, item, order or reference'; input.setAttribute('aria-label', 'Search activity');
    var timer;
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { search = input.value.trim(); load(false); }, 300); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { clearTimeout(timer); search = input.value.trim(); load(false); } });
    var refresh = el('button', 'btn ghost', 'Refresh'); refresh.type = 'button'; refresh.addEventListener('click', function () { load(false); });
    var save = el('button', 'btn ghost', 'Save as CSV'); save.type = 'button'; save.addEventListener('click', download);
    status = el('p', 'oc-status'); status.setAttribute('role', 'status');
    kpis = el('div', 'ops-kpis');
    table = el('div');
    moreBtn = el('button', 'btn ghost oc-more', 'Load more'); moreBtn.type = 'button'; moreBtn.hidden = true;
    moreBtn.addEventListener('click', function () { load(true); });
    add(host, [add(el('div', 'oc-toolbar'), [seg, input, refresh, save]), status, kpis, table, moreBtn]);
  }

  window.addEventListener('lightning:owner-access', function (e) {
    verified = !!(e.detail && e.detail.verified);
    if (verified) { build(); load(false); }
    else { host.textContent = ''; host.appendChild(el('p', 'ops-empty', 'Verify your session to load activity.')); }
  });
  window.addEventListener('lightning:owner-view', function (e) { if (verified && e.detail && e.detail.view === 'activity') load(false); });
  window.addEventListener('lightning:owner-changed', function () { if (verified && !$('activity').hidden) load(false); });
  window.FGOwnerActivity = { load: load, csv: csv };
})();
