/* Owner console, Sign-ups view (admin.html #signups): how many people made an account, and what they did next.
   Reads admin_signups() (supabase/migrations/20261031120000_admin_signups.sql), MFA administrators only, and changes
   nothing. It counts and never names: no email, id or token reaches the page, and administrators are counted apart so
   the owner's own account never reads as a member. Every value is set with textContent. The visits that come before
   a sign-up (page views) are still counted in GoatCounter and the Analytics dashboard until they move here (plan item 8X). */
(function () {
  'use strict';
  var doc = document, FG = window.FG;
  var $ = function (id) { return doc.getElementById(id); };
  var host = $('ops-signups');
  if (!host || !FG) return;
  var days = 90, verified = false, loading = false, again = false;
  var PROVIDER = { email: 'Email', google: 'Google', github: 'GitHub' };

  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(p, kids) { kids.forEach(function (k) { if (k) p.appendChild(k); }); return p; }
  function num(n) { return Math.round(Number(n || 0)).toLocaleString('en-US'); }
  function pct(a, b) { return Number(b) > 0 ? Math.round(Number(a) / Number(b) * 100) + '%' : '—'; }
  function say(e) { return FG.say ? FG.say(e) : (e && e.message) || 'Could not load this.'; }
  function yes(v) { return v ? 'Yes' : 'No'; }
  function kpi(label, value, unit, sub) {
    var c = el('article', 'ops-kpi'), v = el('strong', null, value);
    if (unit) v.appendChild(el('small', null, ' ' + unit));
    add(c, [el('span', 'ops-kpi-l', label), v, sub ? el('p', 'ops-sub', sub) : null]);
    return c;
  }

  function chart(rows) {
    var ns = 'http://www.w3.org/2000/svg', w = 600, h = 120, max = 0;
    rows.forEach(function (d) { max = Math.max(max, Number(d.signups)); });
    var svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); svg.setAttribute('class', 'ops-chart'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Sign-ups per day over the last ' + rows.length + ' days' + (max ? ', best day ' + num(max) : ', none yet'));
    var bw = w / Math.max(rows.length, 1);
    rows.forEach(function (d, i) {
      var v = Number(d.signups), bh = max ? Math.max(v ? 4 : 2, (v / max) * (h - 18)) : 2;
      var r = doc.createElementNS(ns, 'rect');
      r.setAttribute('x', (i * bw + 1).toFixed(1)); r.setAttribute('width', Math.max(2, bw - 2).toFixed(1));
      r.setAttribute('y', (h - bh).toFixed(1)); r.setAttribute('height', bh.toFixed(1)); r.setAttribute('rx', '3');
      r.setAttribute('class', v ? 'bar' : 'bar zero');
      var t = doc.createElementNS(ns, 'title'); t.textContent = d.day + ': ' + num(v) + (v === 1 ? ' sign-up' : ' sign-ups'); r.appendChild(t);
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

  // One row of a funnel: the step, how many, and what share of the step before it reached it.
  function steps(rows) {
    var list = el('ol', 'ops-steps');
    rows.forEach(function (r, i) {
      var prev = i ? rows[i - 1][1] : null;
      add(list, [add(el('li'), [el('span', 'ops-step-l', r[0]), el('strong', null, num(r[1])),
        el('small', 'ops-sub', i ? pct(r[1], prev) + ' of the step before' : (r[2] || ''))])]);
    });
    return list;
  }

  function render(s) {
    host.textContent = '';
    var t = s.totals || {}, st = s.steps || {}, per = s.period || {};
    var seg = el('div', 'oc-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Period');
    [[30, '30 days'], [90, '90 days'], [365, '1 year']].forEach(function (p) {
      var b = el('button', null, p[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(p[0] === days));
      b.addEventListener('click', function () { days = p[0]; load(); });
      seg.appendChild(b);
    });
    var refresh = el('button', 'btn ghost', 'Refresh'); refresh.type = 'button'; refresh.addEventListener('click', load);
    host.appendChild(add(el('div', 'oc-toolbar'), [seg, refresh]));

    var admins = Number(t.administrators) || 0;
    host.appendChild(add(el('div', 'ops-kpis'), [
      kpi('Members', num(t.members), '', t.members ? 'first ' + t.first_signup + ' · latest ' + t.latest_signup : 'no one has signed up yet'),
      kpi('New in the last ' + s.days + ' days', num(per.members), '', pct(per.members, t.members) + ' of all members'),
      kpi('Confirmed their email', pct(st.confirmed_email, st.signed_up), '', num(st.confirmed_email) + ' of ' + num(st.signed_up)),
      kpi('Did something', pct(st.did_something, st.signed_up), '', num(st.did_something) + ' asked for a top-up, bought or contributed')]));
    host.appendChild(el('p', 'ops-fine', num(admins) + (admins === 1 ? ' administrator account is' : ' administrator accounts are') +
      ' counted apart, not as a member.' + (Number(t.anonymous) ? ' ' + num(t.anonymous) + ' anonymous.' : '')));

    host.appendChild(add(el('section', 'ops-block ops-card'), [
      add(el('div', 'ops-card-h'), [el('h3', null, 'From signing up to doing something'), el('span', 'ops-fine', 'members, all time')]),
      steps([['Signed up', st.signed_up, 'accounts that are not administrators'], ['Confirmed their email', st.confirmed_email],
        ['Signed in', st.signed_in], ['Did something', st.did_something]]),
      el('p', 'ops-fine', 'Asked for a top-up ' + num(st.asked_topup) + ' · bought ' + num(st.bought) + ' · contributed ' + num(st.contributed) +
        ' · linked GitHub ' + num(st.linked_github) + '. A member can do more than one.')]));

    host.appendChild(add(el('section', 'ops-block ops-card'), [
      add(el('div', 'ops-card-h'), [el('h3', null, 'Sign-ups per day'), el('span', 'ops-fine', 'last ' + s.days + ' days')]),
      chart(Array.isArray(s.daily) ? s.daily : [])]));

    var prov = Array.isArray(s.providers) ? s.providers : [];
    host.appendChild(add(el('section', 'ops-block'), [add(el('div', 'ops-card-h'), [el('h3', null, 'How they sign in')]),
      table(['Way in', 'Members', 'Share'],
        prov.map(function (p) { return [PROVIDER[p.provider] || p.provider, num(p.members), pct(p.members, st.signed_up)]; }),
        'No sign-ups yet.'),
      el('p', 'ops-fine', 'One member can have two ways in, so the shares can add up to more than 100%.')]));

    var recent = Array.isArray(s.recent) ? s.recent : [];
    host.appendChild(add(el('section', 'ops-block'), [add(el('div', 'ops-card-h'), [el('h3', null, 'Latest sign-ups'), el('span', 'ops-fine', 'newest first, no names')]),
      table(['Day', 'Way in', 'Confirmed email', 'Signed in', 'Did something'],
        recent.map(function (r) {
          return [r.day, (r.providers || []).map(function (p) { return PROVIDER[p] || p; }).join(', '), yes(r.confirmed), yes(r.signed_in), yes(r.did_something)];
        }), 'No sign-ups yet.')]));

    host.appendChild(el('p', 'ops-fine', 'Visits before sign-up are counted in GoatCounter and the Analytics dashboard until they move into this console.'));
  }

  function load() {
    if (!verified) return Promise.resolve();
    if (loading) { again = true; return Promise.resolve(); }
    loading = true;
    return Promise.resolve(FG.sb.rpc('admin_signups', { p_days: days })).then(function (r) {
      if (r.error) throw r.error;
      render(r.data || {});
    }).catch(function (e) {
      host.textContent = '';
      host.appendChild(el('p', 'ops-empty', 'Sign-ups did not load. ' + say(e)));
    }).then(function () { loading = false; if (again) { again = false; load(); } });
  }
  window.addEventListener('lightning:owner-access', function (e) {
    verified = !!(e.detail && e.detail.verified);
    if (verified) load(); else { host.textContent = ''; host.appendChild(el('p', 'ops-empty', 'Verify your session to load sign-ups.')); }
  });
  window.addEventListener('lightning:owner-view', function (e) { if (verified && e.detail && e.detail.view === 'signups') load(); });
  window.addEventListener('lightning:owner-changed', function () { var v = $('signups'); if (v && !v.hidden) load(); });
  window.FGOwnerSignups = { load: load };
})();
