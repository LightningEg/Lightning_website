/* Theme previews for the main-site marketplace: the website, the PC app and the phone, drawn in a palette.
   Illustration only. The figures are Mohab's sample year as fixed words, never calculated here, and nothing
   here buys, equips or unlocks anything. Every colour is set as a --pv-* custom property from a checked hex,
   so a preview cannot carry CSS, URLs or text from the catalog. Styles: css/theme-preview.css. */
(function (root) {
  'use strict';
  var doc = root.document;
  var HEX = /^#[0-9a-f]{6}$/i;
  var KEYS = ['background', 'surface', 'raised', 'text', 'muted', 'border', 'accent', 'onAccent', 'income', 'expense', 'transfer', 'warning', 'focus', 'hero'];
  // cosmetics/lightning-default.json: the app as it ships
  var DEFAULT = { background: '#F5F8F7', surface: '#FFFFFF', raised: '#F5F8F7', text: '#0D2233', muted: '#566E7E', border: '#DDE9E6',
    accent: '#0B6DD6', onAccent: '#FFFFFF', income: '#097852', expense: '#C93D72', transfer: '#566E7E', warning: '#304A5C', focus: '#0B6DD6', hero: '#0D2233' };

  function rgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
  function hex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(Math.max(0, Math.min(255, v))).toString(16)).slice(-2); }).join(''); }
  // a share of colour a over colour b
  function mix(a, b, share) { var x = rgb(a), y = rgb(b); return hex(x.map(function (v, i) { return v * share + y[i] * (1 - share); })); }
  function lum(h) {
    var c = rgb(h).map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function isLight(h) { return lum(h) > 0.4; }

  /* A website theme has four colours: ground, text, quiet text, accent (js/site-theme-previews.js).
     The app needs fourteen; the rest are mixed from those four. Money keeps its meaning: income green, spending rose. */
  function fromWebsite(t) {
    if (!t || !t.c || t.c.length < 4 || !t.c.every(function (v) { return HEX.test(v); })) return DEFAULT;
    var bg = t.c[0], ink = t.c[1], quiet = t.c[2], acc = t.c[3], light = isLight(bg);
    var on = contrast(acc, bg) >= contrast(acc, ink) ? bg : ink;
    return { background: bg, surface: mix(ink, bg, light ? 0.03 : 0.05), raised: mix(ink, bg, light ? 0.06 : 0.09), text: ink, muted: quiet,
      border: mix(ink, bg, 0.15), accent: acc, onAccent: on, income: light ? '#097852' : '#4FD8A4', expense: light ? '#C93D72' : '#FF9393',
      transfer: quiet, warning: light ? '#8A5A00' : '#F2C86B', focus: acc, hero: ink };
  }
  function clean(p) {
    var out = {};
    KEYS.forEach(function (k) { out[k] = p && HEX.test(p[k] || '') ? p[k] : DEFAULT[k]; });
    return out;
  }
  function paint(node, palette) {
    var p = clean(palette);
    KEYS.forEach(function (k) { node.style.setProperty('--pv-' + k, p[k]); });
    node.setAttribute('data-tone', isLight(p.background) ? 'light' : 'dark');
    return node;
  }

  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function add(parent, kids) { kids.forEach(function (k) { if (k) parent.appendChild(k); }); return parent; }
  function mark() {
    var m = el('i', 'pv-mark');
    m.setAttribute('aria-hidden', 'true');
    return m;
  }
  function kpi(label, figure, unit, note, tone, meter) {
    var k = el('div', 'pv-kpi');
    add(k, [el('span', 'pv-kpi-l', label)]);
    var f = el('b', 'pv-fig', figure);
    if (unit) f.appendChild(el('small', null, ' ' + unit));
    k.appendChild(f);
    var n = el('span', 'pv-kpi-n' + (tone ? ' ' + tone : ''), note);
    k.appendChild(n);
    if (meter) { var m = el('span', 'pv-meter'); var i = el('i'); i.style.width = meter + '%'; m.appendChild(i); k.appendChild(m); }
    return k;
  }
  function row(name, value, tone) { return add(el('div', 'pv-row'), [el('span', null, name), el('b', tone || null, value)]); }
  function chart() {
    var ns = 'http://www.w3.org/2000/svg', s = doc.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 120 48'); s.setAttribute('class', 'pv-chart'); s.setAttribute('preserveAspectRatio', 'none');
    [12, 24, 36].forEach(function (y) { var l = doc.createElementNS(ns, 'path'); l.setAttribute('d', 'M0 ' + y + 'H120'); l.setAttribute('class', 'pv-grid'); s.appendChild(l); });
    var a = doc.createElementNS(ns, 'path'); a.setAttribute('d', 'M4 34 L60 26 L116 10 L116 48 L4 48Z'); a.setAttribute('class', 'pv-area'); s.appendChild(a);
    var p = doc.createElementNS(ns, 'path'); p.setAttribute('d', 'M4 34 L60 26 L116 10'); p.setAttribute('class', 'pv-line'); s.appendChild(p);
    return s;
  }

  /* The PC app's Overview (assets/app/mohab/overview.webp): sidebar, period, four KPIs, net worth with its chart. */
  function pc(palette) {
    var w = paint(el('div', 'pv pv-pc'), palette);
    var bar = add(el('div', 'pv-win'), [el('i'), el('i'), el('i')]);
    var side = el('div', 'pv-side');
    add(side, [add(el('div', 'pv-brand'), [mark(), el('span', null, 'Lightning')])]);
    ['Overview', 'Budget', 'Investments', 'Expense analysis', 'Cash planning', 'Settings'].forEach(function (n, i) {
      side.appendChild(el('span', 'pv-nav' + (i === 0 ? ' on' : ''), n));
    });
    add(side, [el('span', 'pv-side-h', 'Accounts'), row('CIB Payroll', '68,893'), row('Cash wallet', '10,220'), row('Gold at home', '57,195')]);
    var main = el('div', 'pv-main');
    var head = add(el('div', 'pv-head'), [add(el('div'), [el('b', 'pv-h1', 'Overview'), el('span', 'pv-sub', 'Your position and what changed')]),
      add(el('div', 'pv-seg'), [el('span', null, 'YTD'), el('span', 'on', 'Monthly'), el('span', null, 'Custom')])]);
    var note = add(el('div', 'pv-needs'), [el('i'), el('span', null, 'Nothing needs you today')]);
    var kpis = add(el('div', 'pv-kpis'), [
      kpi('Change in net worth', '+29,116', 'EGP', 'Net worth 198,065', 'up'),
      kpi('Savings rate', '50.1', '%', '+23,444 kept', 'up'),
      kpi('Investing rate', '39.4', '%', '+18,450 added', 'up', 34),
      kpi('Left in plan', '1,309', 'EGP', 'of 24,698 planned', null, 95)]);
    var lead = add(el('div', 'pv-lead'), [
      add(el('div', 'pv-lead-a'), [el('b', 'pv-h2', 'Net worth'), add(el('b', 'pv-big', '198,065'), [el('small', null, ' EGP')]),
        row('What you own', '250,565'), row('What you owe', '−52,500', 'out')]),
      add(el('div', 'pv-lead-b'), [el('b', 'pv-h2', 'Over time'), chart()])]);
    add(main, [head, note, kpis, lead]);
    add(w, [bar, add(el('div', 'pv-body'), [side, main])]);
    return w;
  }

  /* The phone's Overview (guideline C03, C06, C08): app bar, the Lead, two-by-two tiles, latest rows, five-slot tab bar. */
  function phone(palette) {
    var w = paint(el('div', 'pv pv-phone'), palette);
    var screen = el('div', 'pv-screen');
    add(screen, [
      add(el('div', 'pv-status'), [el('span', null, '9:41'), el('span', 'pv-notch')]),
      add(el('div', 'pv-appbar'), [mark(), el('b', null, 'Overview')]),
      add(el('div', 'pv-hero'), [el('span', 'pv-kpi-l', 'Net worth'), add(el('b', 'pv-big', '198,065'), [el('small', null, ' EGP')]),
        el('span', 'pv-kpi-n up', '+29,116 this month')]),
      add(el('div', 'pv-tiles'), [kpi('Savings rate', '50.1', '%', '+23,444 kept', 'up'), kpi('Left in plan', '1,309', '', 'of 24,698', null, 95)]),
      add(el('div', 'pv-list'), [el('span', 'pv-side-h', 'Latest'), row('Salary', '+46,833', 'in'), row('Groceries', '−2,140', 'out'), row('To savings', '10,000', 'move')]),
      add(el('div', 'pv-tabs'), ['Overview', 'Budget', '+', 'Transactions', 'More'].map(function (n, i) {
        return el('span', i === 0 ? 'on' : i === 2 ? 'pv-add' : null, n);
      }))]);
    w.appendChild(screen);
    return w;
  }

  /* The website in a website theme: top bar, hero, two buttons, a money tile. */
  function site(palette) {
    var w = paint(el('div', 'pv pv-site'), palette);
    add(w, [
      add(el('div', 'pv-win'), [el('i'), el('i'), el('i')]),
      add(el('div', 'pv-topbar'), [add(el('span', 'pv-brand'), [mark(), el('span', null, 'Lightning')]),
        add(el('span', 'pv-links'), [el('span', null, 'How It Works'), el('span', null, 'Guides'), el('span', null, 'Downloads')])]),
      add(el('div', 'pv-site-hero'), [el('b', 'pv-site-h', 'Know where your salary goes.'),
        el('span', 'pv-sub', 'Local-first money for salaried people in Egypt.'),
        add(el('div', 'pv-btns'), [el('span', 'pv-btn', 'Download free'), el('span', 'pv-btn ghost', 'How it works')])]),
      add(el('div', 'pv-tiles'), [kpi('Kept this month', '23,444', 'EGP', 'of 46,833 money in', 'up'), kpi('Safe to spend', '1,309', 'EGP', 'until payday')])]);
    return w;
  }

  /* A small card thumbnail: the PC app at a glance. */
  function thumb(palette) {
    var w = paint(el('div', 'pv pv-thumb'), palette);
    w.setAttribute('aria-hidden', 'true');
    var side = add(el('div', 'pv-side'), [mark(), el('i', 'on'), el('i'), el('i'), el('i')]);
    var main = add(el('div', 'pv-main'), [el('i', 'pv-t-h'), add(el('div', 'pv-kpis'), [el('i'), el('i'), el('i')]), add(el('div', 'pv-lead'), [el('i', 'pv-t-fig'), chart()])]);
    add(w, [side, main]);
    return w;
  }

  /* A profile card with a banner, a framed picture and a badge: how others see you. */
  function profile(opts) {
    opts = opts || {};
    var ID = /^[a-z0-9-]{1,48}$/;
    var c = el('div', 'pv-profile');
    var b = el('div', 'fg-banner');
    if (opts.banner && ID.test(opts.banner)) b.setAttribute('data-item', opts.banner);
    b.setAttribute('aria-hidden', 'true');
    var av = el('span', 'av lg', (opts.name || 'Y').trim().charAt(0).toUpperCase() || 'Y');
    if (opts.frame && ID.test(opts.frame)) av.setAttribute('data-frame', opts.frame);
    var who = add(el('div', 'pv-who'), [el('b', 'pv-name', opts.name || 'Your name')]);
    var S = root.FGShow;
    if (opts.badge && ID.test(opts.badge) && S && S.badge) { var bd = S.badge(opts.badge); if (bd) who.appendChild(bd); }
    add(c, [b, add(el('div', 'pv-id'), [av, who])]);
    return c;
  }

  root.LightningPreview = { DEFAULT: DEFAULT, fromWebsite: fromWebsite, clean: clean, paint: paint, pc: pc, phone: phone, site: site, thumb: thumb, profile: profile, isLight: isLight, contrast: contrast, mix: mix };
})(window);
