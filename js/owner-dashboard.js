/* Owner console (admin.html): one view at a time (Overview, Top-ups, Catalogue, Members, Stories, Money journal,
   Settings), the segmented filters, and the Overview
   drawn from admin_dashboard() (supabase/migrations/20261025330000_owner_dashboard.sql): what needs the owner, the
   month against the fixed cost, paying members, the coins in circulation, thirty days of revenue and what sells.
   Every decision and credit still goes through js/store-admin.js and the server; this file only reads and shows.
   It refreshes when store-admin.js says something changed (lightning:owner-changed). */
(function () {
  'use strict';
  var doc = document, FG = window.FG;
  var $ = function (id) { return doc.getElementById(id); };
  var host = $('ops-dash');
  if (!host || !FG) return;
  var VIEWS = ['today', 'requests', 'sales', 'activity', 'catalogue', 'members', 'social', 'bank', 'settings'];
  var ALIAS = { setup: 'settings', pricing: 'settings', retention: 'settings', credits: 'members' };
  var last = null, loading = false, again = false, store = {}, ready = null;

  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(p, kids) { kids.forEach(function (k) { if (k) p.appendChild(k); }); return p; }
  function egp(piastres) { return Math.round(Number(piastres || 0) / 100).toLocaleString('en-US'); }
  function num(n) { return Math.round(Number(n || 0)).toLocaleString('en-US'); }
  function ago(ts) {
    if (!ts) return '';
    var h = Math.max(0, (Date.now() - new Date(ts).getTime()) / 36e5);
    return h < 1 ? 'oldest under an hour' : h < 48 ? 'oldest ' + Math.round(h) + ' h ago' : 'oldest ' + Math.round(h / 24) + ' days ago';
  }

  /* ---------- one view at a time ---------- */
  function show() {
    var want = (location.hash || '').slice(1);
    want = ALIAS[want] || want;
    if (VIEWS.indexOf(want) < 0) want = 'today';
    VIEWS.forEach(function (v) { var s = $(v); if (s) s.hidden = v !== want; });
    Array.prototype.forEach.call(doc.querySelectorAll('.ops-nav a'), function (a) {
      if (a.getAttribute('data-view') === want) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    window.dispatchEvent(new CustomEvent('lightning:owner-view', { detail: { view: want } }));
  }
  window.addEventListener('hashchange', show);
  show();
  // Switching views never jumps the page to the section: it keeps the console header in sight instead.
  var shell = doc.querySelector('.oc-head');
  function settle() { if (shell && window.scrollY > shell.offsetTop) window.scrollTo(0, shell.offsetTop); }
  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var v = a.getAttribute('href').slice(1), to = ALIAS[v] || v;
    if (VIEWS.indexOf(to) < 0 && v !== 'bank') return;
    e.preventDefault();
    if (location.hash !== '#' + v) history.pushState(null, '', '#' + v);
    show(); settle();
  });
  if (location.hash) {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.addEventListener('load', function () { setTimeout(function () { window.scrollTo(0, 0); }, 0); });
  }

  // Segmented filters drive the plain select beside them, which js/store-admin.js listens to.
  Array.prototype.forEach.call(doc.querySelectorAll('.oc-seg'), function (group) {
    var select = $(group.getAttribute('data-for'));
    if (!select) return;
    group.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button[data-value]');
      if (!b || b.disabled) return;
      Array.prototype.forEach.call(group.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      select.value = b.getAttribute('data-value');
      select.dispatchEvent(new Event('change'));
    });
  });

  // Verification: the gate shows until the session is verified, then folds away.
  window.addEventListener('lightning:owner-access', function (e) {
    var gate = $('ops-mfa'), access = $('store-access'), on = !!(e.detail && e.detail.verified);
    if (gate) gate.hidden = on;
    if (access) access.hidden = on; // "Owner account recognized" has done its job
    if (on) load();
  });

  /* ---------- Today ---------- */
  function need(count, title, sub, view, tone) {
    var a = el('a', 'ops-need' + (count > 0 ? ' on ' + (tone || '') : ''));
    a.href = '#' + view;
    add(a, [el('strong', null, num(count)), add(el('span'), [el('b', null, title), el('small', null, sub)])]);
    return a;
  }
  function kpi(label, value, unit, sub, extra) {
    var c = el('article', 'ops-kpi');
    add(c, [el('span', 'ops-kpi-l', label)]);
    var v = el('strong', null, value);
    if (unit) v.appendChild(el('small', null, ' ' + unit));
    c.appendChild(v);
    if (sub) c.appendChild(sub);
    if (extra) c.appendChild(extra);
    return c;
  }
  function change(now, before, unit) {
    var p = el('p', 'ops-sub');
    var d = Number(now) - Number(before);
    if (!Number(before) && !Number(now)) { p.textContent = 'Nothing yet this month or last'; return p; }
    var chip = el('span', 'ops-chip ' + (d > 0 ? 'good' : d < 0 ? 'bad' : ''), (d > 0 ? '↑ ' : d < 0 ? '↓ ' : '') + (unit === 'egp' ? egp(Math.abs(d)) + ' EGP' : num(Math.abs(d))));
    add(p, [chip, el('span', null, ' vs ' + (unit === 'egp' ? egp(before) + ' EGP' : num(before)) + ' last month')]);
    return p;
  }
  function chart(days) {
    var ns = 'http://www.w3.org/2000/svg', w = 600, h = 140, max = 0;
    days.forEach(function (d) { max = Math.max(max, Number(d.piastres)); });
    var svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); svg.setAttribute('class', 'ops-chart'); svg.setAttribute('role', 'img');
    var total = days.reduce(function (n, d) { return n + Number(d.piastres); }, 0);
    svg.setAttribute('aria-label', 'Revenue in the last 30 days: ' + egp(total) + ' EGP in total' + (max ? ', best day ' + egp(max) + ' EGP' : ''));
    var bw = w / days.length;
    days.forEach(function (d, i) {
      var v = Number(d.piastres), bh = max ? Math.max(v ? 4 : 2, (v / max) * (h - 18)) : 2;
      var r = doc.createElementNS(ns, 'rect');
      r.setAttribute('x', (i * bw + 2).toFixed(1)); r.setAttribute('width', Math.max(2, bw - 4).toFixed(1));
      r.setAttribute('y', (h - bh).toFixed(1)); r.setAttribute('height', bh.toFixed(1)); r.setAttribute('rx', '3');
      r.setAttribute('class', v ? 'bar' : 'bar zero');
      var t = doc.createElementNS(ns, 'title'); t.textContent = d.day + ': ' + egp(v) + ' EGP'; r.appendChild(t);
      svg.appendChild(r);
    });
    return svg;
  }

  // Ready to sell: each thing the store needs before money changes hands, with where to fix it.
  function readiness(d) {
    var r = ready || {}, cfg = r.settings || {}, coin = r.pricing || {}, apps = r.apps || { on: 0, all: 0 };
    var steps = [
      [!!(cfg.instapay_address && cfg.recipient_name && cfg.qr_asset_id), 'Receiving details and QR', 'Your InstaPay address, the exact name it shows, and the private QR', 'settings'],
      [!!(store.payments_enabled || cfg.enabled), 'Checkout open', 'Members can start a top-up', 'settings'],
      [!!coin.enabled, 'Top-up quotes allowed', (coin.coins_per_egp || 5) + ' coins a pound, bonuses from ' + ((r.tiers || [])[0] ? r.tiers[0].minimum_egp + ' EGP' : 'none'), 'settings'],
      [Number(d.fixed_cost_egp) > 0, 'Fixed cost set', 'The break-even line below', 'settings'],
      [Number(d.payers_all) > 0, 'A real payment credited', 'Pay yourself once from another account, credit it, buy, check on a second device', 'requests'],
      [apps.all > 0 && apps.on === apps.all, 'App themes released', apps.on + ' of ' + apps.all + ' on. Turn each on once the app version that carries it has shipped', 'catalogue']];
    var done = steps.filter(function (s) { return s[0]; }).length;
    var list = el('ol', 'oc-ready');
    steps.forEach(function (s) {
      var a = el('a', 'oc-ready-step' + (s[0] ? ' done' : ''));
      a.href = '#' + s[3];
      add(a, [el('span', 'oc-tick', s[0] ? '✓' : ''), add(el('span'), [el('b', null, s[1]), el('small', null, s[2])])]);
      list.appendChild(add(el('li'), [a]));
    });
    var head = add(el('div', 'ops-card-h'), [el('h3', null, 'Ready to sell'), el('span', 'ops-chip ' + (done === steps.length ? 'good' : ''), done + ' of ' + steps.length)]);
    return add(el('section', 'ops-block ops-card oc-ready-card'), [head, list]);
  }
  function context() {
    // what the store is set to, for the readiness list; each read is allowed to fail on its own
    var safe = function (fn, none) { return new Promise(function (ok) { ok(fn()); }).then(function (r) { return r && !r.error ? r.data : none; }, function () { return none; }); };
    var from = function (t) { return safe(function () { return FG.sb.from(t).select('*').eq('id', 1).single(); }, null); };
    var tiers = safe(function () { return FG.sb.from('coin_bonus_tiers').select('*').order('minimum_egp'); }, []);
    var cat = safe(function () { return FG.sb.rpc('admin_catalog'); }, null);
    return Promise.all([from('payment_settings'), from('coin_pricing'), tiers, cat]).then(function (x) {
      var apps = { on: 0, all: 0 };
      ((x[3] && x[3].items) || []).forEach(function (i) { (i.app || []).forEach(function (v) { apps.all++; if (v.enabled) apps.on++; }); });
      ready = { settings: x[0], pricing: x[1], tiers: x[2] || [], apps: apps };
    });
  }

  function render(d) {
    host.textContent = '';
    var n = d.needs || {};
    // what needs the owner, first
    var needs = el('div', 'ops-needs');
    add(needs, [
      need(n.receipts, 'Tickets to confirm', n.receipts ? ago(n.oldest_receipt_at) : 'Nothing waiting', 'requests', 'warn'),
      need(n.awaiting_receipt, 'Not paid yet', n.awaiting_receipt ? 'Opened, details not sent' : 'None', 'requests', ''),
      need(n.stories, 'Stories to review', n.stories ? 'Check the code and the link' : 'Queue clear', 'social', 'warn'),
      need(n.mismatches, 'Ledger mismatches', n.mismatches ? 'A wallet differs from its ledger' : 'Wallets agree with the ledger', 'today', 'bad')]);
    var loose = Number(n.unmatched) ? add(el('p', 'ops-fine'), [el('span', null, num(n.unmatched) + ' older transfer' + (Number(n.unmatched) === 1 ? '' : 's') + ' with no ticket. '), (function () { var a = el('a', null, 'Open the money journal'); a.href = '#bank'; return a; })()]) : null;
    host.appendChild(add(el('section', 'ops-block'), [el('h3', null, 'Needs you'), needs, loose]));

    // the month
    var fixed = Number(d.fixed_cost_egp) * 100, rev = Number(d.revenue_month), left = Math.max(0, fixed - rev);
    var avg = Number(d.avg_topup_90d), pct = fixed ? Math.min(100, Math.round(rev / fixed * 100)) : 100;
    var meter = add(el('div', 'ops-meter'), [el('i')]);
    meter.firstChild.style.width = pct + '%';
    meter.setAttribute('role', 'meter'); meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100'); meter.setAttribute('aria-valuenow', String(pct));
    meter.setAttribute('aria-label', 'Fixed cost covered this month');
    var beSub = el('p', 'ops-sub', !fixed ? 'Set your fixed cost in Settings' : left ? egp(left) + ' EGP to go' + (avg ? ', about ' + num(Math.ceil(left / avg)) + ' top-ups at your average ' + egp(avg) + ' EGP' : '') : 'Covered, ' + egp(rev - fixed) + ' EGP above');
    var kpis = add(el('div', 'ops-kpis'), [
      kpi('Revenue this month', egp(rev), 'EGP', change(rev, d.revenue_prev, 'egp')),
      kpi('Fixed cost covered', pct + '%', null, beSub, meter),
      kpi('Paying members this month', num(d.payers_month), null, el('p', 'ops-sub', num(d.payers_all) + ' all time · ' + num(d.repeat_payers) + ' came back · ' + num(d.members_month) + ' new members')),
      kpi('Coins unspent', num(d.coins_outstanding), 'coins', el('p', 'ops-sub', 'This month: ' + num(d.coins_sold_month) + ' sold · ' + num(d.coins_given_month) + ' given · ' + num(d.coins_spent_month) + ' spent'))]);
    host.appendChild(add(el('section', 'ops-block'), [el('h3', null, 'This month'), kpis]));

    // thirty days, then what sells
    var days = Array.isArray(d.daily) ? d.daily : [];
    var total = days.reduce(function (s, x) { return s + Number(x.piastres); }, 0);
    var best = days.reduce(function (m, x) { return Math.max(m, Number(x.piastres)); }, 0);
    var axis = days.length ? add(el('div', 'ops-axis'), [el('span', null, days[0].day), el('span', null, best ? 'best day ' + egp(best) + ' EGP' : 'no revenue yet'), el('span', null, 'today')]) : null;
    var trend = add(el('section', 'ops-block ops-card'), [add(el('div', 'ops-card-h'), [el('h3', null, 'Revenue, last 30 days'), el('span', 'ops-fine', egp(total) + ' EGP · ' + num(d.topups_month) + ' top-ups this month')]), chart(days), axis]);
    var rate = Number(d.coins_per_egp) || 5;
    var sells = add(el('section', 'ops-block ops-card'), [add(el('div', 'ops-card-h'), [el('h3', null, 'What sells this month'), el('span', 'ops-fine', 'by purchases')])]);
    var items = Array.isArray(d.top_items) ? d.top_items : [];
    if (!items.length) sells.appendChild(el('p', 'ops-empty', 'No purchases yet this month.'));
    else {
      var ul = el('ul', 'ops-sells');
      var top = Math.max.apply(null, items.map(function (i) { return Number(i.sold); }));
      items.forEach(function (i) {
        var kind = i.type === 'theme' ? (i.tier === 'texture' ? 'Textured' : i.tier === 'motion' ? 'Animated' : 'Palette') : i.type[0].toUpperCase() + i.type.slice(1);
        var bar = add(el('span', 'ops-sell-bar'), [el('i')]);
        bar.firstChild.style.width = Math.round(Number(i.sold) / top * 100) + '%';
        ul.appendChild(add(el('li'), [add(el('span', 'ops-sell-name'), [el('b', null, i.name), el('small', null, kind)]), bar,
          el('span', 'ops-sell-n', num(i.sold) + ' sold'), el('span', 'ops-sell-c', num(i.coins) + ' coins · ' + num(Number(i.coins) / rate) + ' EGP')]));
      });
      sells.appendChild(ul);
    }
    host.appendChild(add(el('div', 'ops-pair'), [trend, sells]));
    host.appendChild(readiness(d));

    // badges on the tabs, and the fixed cost in Settings
    Array.prototype.forEach.call(doc.querySelectorAll('[data-badge]'), function (b) { var v = Number(n[b.getAttribute('data-badge')]) || 0; b.textContent = v ? String(v) : ''; b.hidden = !v; });
    var f = $('ops-fixed-cost');
    if (f && doc.activeElement !== f.elements.egp) f.elements.egp.value = d.fixed_cost_egp;
  }

  function load() {
    if (loading) { again = true; return; }
    loading = true;
    Promise.all([Promise.resolve(FG.sb.rpc('admin_dashboard')), context()]).then(function (x) {
      var r = x[0];
      if (r.error) throw r.error;
      last = r.data; render(last);
    }).catch(function (e) {
      host.textContent = '';
      host.appendChild(el('p', 'ops-empty', 'The dashboard did not load. ' + (FG.say ? FG.say(e) : '')));
    }).then(function () { loading = false; if (again) { again = false; load(); } });
  }
  window.addEventListener('lightning:owner-changed', function (e) { if (e.detail) store = e.detail; load(); });

  var form = $('ops-fixed-cost');
  if (form) form.onsubmit = function (e) {
    e.preventDefault();
    var st = $('ops-fixed-status'), b = form.querySelector('button');
    b.disabled = true;
    Promise.resolve(FG.sb.rpc('admin_set_fixed_cost', { p_egp: Number(form.elements.egp.value) })).then(function (r) {
      if (r.error) throw r.error;
      st.textContent = 'Saved. Today now measures against ' + num(form.elements.egp.value) + ' EGP a month.';
      load();
    }).catch(function (err) { st.textContent = FG.say ? FG.say(err) : 'Could not save.'; }).then(function () { b.disabled = false; });
  };
})();
