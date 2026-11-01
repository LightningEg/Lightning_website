/* Owner console, Analytics view: the decision tabs (What to act on, Numbers and trends, Download path, Channels, Fix list,
   Readers, Releases, Details). Moved here from analytics/dashboard.html (plan item 8X). It reads the anonymous page-view
   records from Supabase (admin_page_views, MFA administrators only), computes the same answer the receiver used to
   (analytics/insights.js) and judges it with the 11 rules in analytics/rules.js. Nothing is sent anywhere and nothing is stored.
   Every value is set with textContent. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const n = v => Math.round(v).toLocaleString('en');
  const pct = v => `${Math.round(v)}%`;
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const R = window.LightningRules, FG = window.FG;
  let verified = false, authGeneration = 0, openTab = () => {};
  if (!$('dx-health') || !FG || !R || !window.LightningInsights) return;
  openTab = key => { const b = document.querySelector('#an-tabs [data-tab="' + key + '"]'); if (b) b.click(); };

  // The owner's browser is not counted on the site (js/analytics.js reads the same mark). Unlocking marks it.
  const NOTRACK = 'lightning-notrack';
  const notCounted = () => { try { return localStorage.getItem(NOTRACK) === '1'; } catch (_) { return false; } };
  const setCounted = on => { try { if (on) localStorage.removeItem(NOTRACK); else localStorage.setItem(NOTRACK, '1'); } catch (_) {} };
  let cur = null, wide = null, daily = [], events = [], journeys = {rows: [], dropped: 0}, downloads = [], period = 28, ctx = {order: {}, labels: {}};

  async function loadRegistry() {
    if (Object.keys(registry).length) return;
    try {
      const list = (await (await fetch('version-registry.json')).json()).releases || [];
      registry = Object.fromEntries(list.map(r => [r.id, r]));
    } catch (_) {}
  }
  const show = () => {};
  const I = window.LightningInsights, ROWS_PER_CALL = 1000, MAX_CALLS = 80;
  // Every page-view record of the last `days` days, a page at a time (admin_page_views, MFA administrators only).
  async function fetchRows(days) {
    const rows = []; let total = Infinity, live = '';
    for (let call = 0; call < MAX_CALLS && rows.length < total; call++) {
      const r = await FG.sb.rpc('admin_page_views', {p_days: days, p_offset: rows.length, p_limit: ROWS_PER_CALL});
      if (r.error) throw r.error;
      const page = r.data || {}; total = Number(page.total) || 0; live = page.live_from || live;
      if (!(page.rows || []).length) break;
      page.rows.forEach(x => rows.push(x));
    }
    return {rows, live, truncated: rows.length < total};
  }
  async function load() {
    if (!verified) return;
    const generation = ++authGeneration;
    $('dx-status').hidden = false; $('dx-status').textContent = 'Loading…';
    try {
      const [data] = await Promise.all([fetchRows(Math.min(period * 2, 90)), loadRegistry()]);
      if (generation !== authGeneration) return;
      wide = I.build(data.rows, period * 2); cur = I.build(data.rows, period);
      [cur, wide].forEach(a => { a.meta.live_from = data.live; a.meta.truncated = data.truncated; });
      daily = []; events = []; downloads = []; journeys = {rows: [], dropped: 0};
      await prepareContext();
      if (generation !== authGeneration) return;
      $('dx-status').hidden = true; render();
    } catch (e) {
      if (generation !== authGeneration) return;
      $('dx-status').hidden = false; $('dx-status').textContent = 'The analytics did not load. ' + (FG.say ? FG.say(e) : (e && e.message) || '');
    }
  }
  // ---- plain-language names: the site sends short codes (click-index-join); these turn them into sentences ----
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const human = slug => cap(String(slug).replace(/[-_]+/g, ' ').trim());
  const PAGES = {index: 'Home page', features: 'Features', 'how-it-works': 'How It Works', 'current-status': 'Downloads', guides: 'Guides',
    survey: 'Survey', 'sample-profiles': 'Sample profiles', 'release-log': 'Release log', privacy: 'Privacy Notice', versions: 'Version archive',
    'app-feedback': 'App feedback', blog: 'Guides', 'budget-app-egypt': 'Budget guide', 'expense-tracker-egypt': 'Expense tracker guide',
    'net-worth-tracker': 'Net worth guide', 'cash-flow-planner': 'Cash flow guide', 'investment-tracker-egypt': 'Investment guide',
    'bank-statement-budgeting': 'Bank statement guide', 'offline-personal-finance-app': 'Privacy guide',
    'sync-phone-and-pc-without-cloud': 'Phone and PC sync guide', 'track-money-you-hold-for-others': 'Money held for others guide'};
  const HASHES = {join: 'sign-up band', downloads: 'downloads', top: 'top of the page', faq: 'questions', calculator: 'calculator'};
  const HOST = /-(com|org|net|io|gg|me|app|dev|co|eg|ly|tv|us)$/;
  const pageName = path => {
    const arabic = path.startsWith('ar/'), base = path.replace(/^ar\//, '').replace(/\.html$/, '');
    const name = PAGES[base] || human(base);
    return arabic ? `${name} (Arabic)` : name;
  };
  let registry = {};
  const releaseName = id => (registry[id] ? registry[id].name : /^UX-/.test(id) ? id : pageName(id));
  const releasePage = id => (registry[id] ? registry[id].page : `${id}.html`);

  function targetName(slug) {
    if (HOST.test(slug)) return slug.replace(/^www-/, '').replace(/-/g, '.');
    const known = Object.keys(PAGES).sort((a, b) => b.length - a.length).find(p => slug === p || slug.startsWith(p + '-'));
    if (!known) return human(slug);
    const hash = slug.slice(known.length + 1);
    return hash ? `${PAGES[known]}, ${HASHES[hash] || human(hash).toLowerCase()} section` : PAGES[known];
  }
  const clickLabel = slug => (HOST.test(slug) ? `Clicked a link to ${targetName(slug)}` : `Clicked a button to ${targetName(slug)}`);
  const THING = {img: 'a picture', figure: 'a picture', h1: 'a heading', h2: 'a heading', h3: 'a heading', h4: 'a heading', p: 'a paragraph', span: 'some text', strong: 'some text',
    b: 'some text', em: 'some text', svg: 'an icon', path: 'an icon', use: 'an icon', div: 'an empty area', section: 'an empty area', article: 'an empty area', main: 'an empty area',
    li: 'a list item', ul: 'a list', header: 'an empty area', footer: 'an empty area', body: 'the page background', html: 'the page background'};
  const FILE = {img: 'picture', script: 'script', link: 'stylesheet'};
  const FIXED = {'calc-used': 'Used the calculator', 'lang-switch': 'Switched language (English or Arabic)', download: 'Clicked an app download',
    sample: 'Clicked a sample-pack download', 'signup-start': 'Started the email signup', 'signup-submit': 'Sent the email signup',
    'survey-start': 'Started the survey', 'survey-submit': 'Sent the survey'};
  function eventLabel(code) {
    if (FIXED[code]) return FIXED[code];
    let m;
    if ((m = code.match(/^faq-(\d+)$/))) return `Opened question ${m[1]} in the questions list`;
    if ((m = code.match(/^screen-(.+)$/))) return `Enlarged a screenshot (${human(m[1]).toLowerCase()})`;
    if ((m = code.match(/^click-(.+)$/))) return clickLabel(m[1]);
    if (code === 'rage-click') return 'Clicked the same spot three times in a second';
    if (code === 'menu-open') return 'Opened the phone menu';
    if (code === 'theme-toggle') return 'Switched between light and dark';
    if (code === 'res-error-script-count-js') return 'The visit counter was blocked (probably an ad blocker)';
    if ((m = code.match(/^nav-(.+)$/))) return `Pressed ${targetName(m[1])} in the top bar`;
    if ((m = code.match(/^foot-(.+)$/))) return `Pressed ${targetName(m[1])} in the footer`;
    if ((m = code.match(/^link-(.+)$/))) return `Pressed a link to ${targetName(m[1])}`;
    if ((m = code.match(/^seen-(.+)$/))) return `Had ${targetName(m[1])} on screen`;
    if ((m = code.match(/^dead-([a-z0-9]+)-(.+)$/))) {
      const heading = ((sectionCache['index.html'] || {}).names || {})[m[2]];
      return `Tapped ${THING[m[1]] || 'something'} ${m[2] === 'page' ? 'on the page' : `in ${heading ? `"${heading}"` : `the ${human(m[2]).toLowerCase()} part`}`} that isn't a button`;
    }
    if ((m = code.match(/^js-error-(.+)$/))) return `A page script crashed (code ${m[1]})`;
    if ((m = code.match(/^js-reject-(.+)$/))) return `A background request failed (code ${m[1]})`;
    if ((m = code.match(/^res-error-(img|script|link)-(.+)$/))) return `A ${FILE[m[1]]} failed to load: ${m[2].replace(/-([a-z0-9]+)$/, '.$1')}`;
    if ((m = code.match(/^invalid-(.+)$/))) return `The ${human(m[1]).toLowerCase()} box was refused by the form check`;
    if ((m = code.match(/^(.+)-(start|submit)$/))) return `${m[2] === 'start' ? 'Started' : 'Sent'} the ${human(m[1]).toLowerCase()} form`;
    return human(code);
  }

  // Section names come from the live page itself (its headings), so they never go stale.
  const sectionCache = {};
  async function sectionNames(file) {
    if (sectionCache[file]) return sectionCache[file];
    const names = {}, order = [];
    try {
      const html = await (await fetch(`${file}`)).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('main section[id]').forEach(sec => {
        const h = sec.querySelector('h2'); if (!h) return;
        const text = h.textContent.replace(/\s+/g, ' ').trim();
        names[sec.id] = text.length > 64 ? text.slice(0, 61) + '…' : text; order.push(sec.id);
      });
    } catch (_) {}
    return (sectionCache[file] = {names, order});
  }


  // Section order and headings of every page we have numbers for, read from the live page, so rules can speak in words.
  async function prepareContext() {
    ctx = {order: {}, labels: {}};
    if (!cur) return;
    const pages = [...new Set([...(cur.reach || []).map(g => g.page), ...(cur.pages || []).map(g => g.page)])];
    await Promise.all(pages.map(p => sectionNames(`${p}.html`)));
    pages.sort((a, b) => /^ar\//.test(a) - /^ar\//.test(b)).forEach(p => { // English headings first, so an Arabic page never renames a section
      const s = sectionCache[`${p}.html`]; if (!s) return;
      ctx.order[p] = s.order;
      Object.entries(s.names).forEach(([id, name]) => { if (!(id in ctx.labels)) ctx.labels[id] = name; });
    });
    (cur.pages || []).forEach(g => (g.dead || []).forEach(d => {
      const m = d.code.match(/^dead-([a-z0-9]+)-(.+)$/); if (!m) return;
      const heading = ((sectionCache[`${g.page}.html`] || {}).names || {})[m[2]];
      ctx.labels[d.code] = `${THING[m[1]] || 'something'} ${m[2] === 'page' ? 'on the page' : `in ${heading ? `“${heading}”` : `the ${human(m[2]).toLowerCase()} part`}`}`;
    }));
  }

  // ---- dates (Cairo days, as the receiver counts them) ----
  const cairoToday = () => new Date().toLocaleDateString('en-CA', {timeZone: 'Africa/Cairo'});
  const addDays = (d, k) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
  const win = () => { const t = cairoToday(), a = addDays(t, -(period - 1)), b = addDays(t, -(2 * period - 1)); return {today: t, curFrom: a, prevFrom: b}; };
  const dateList = () => { const w = win(); return Array.from({length: period}, (_, i) => addDays(w.curFrom, i)); };
  const inCur = d => d >= win().curFrom, inPrev = d => d >= win().prevFrom && d < win().curFrom;
  const dailyRows = () => (wide && wide.daily) || [];
  const sumDaily = (rows, f) => rows.reduce((t, r) => t + (Number(r[f]) || 0), 0);
  const liveFrom = () => (cur && cur.meta && cur.meta.live_from) || (wide && wide.meta && wide.meta.live_from) || '';
  const dayName = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {day: 'numeric', month: 'short', timeZone: 'UTC'});
  const byDate = (rows, f) => { const m = {}; rows.forEach(r => { m[r.date] = (m[r.date] || 0) + (Number(r[f]) || 0); }); return m; };

  // Real downloads from GitHub's daily snapshots (each is the running total of every file). A day's value is the rise
  // since the snapshot before it; a period's value is the last total in it minus the last total before it, which is
  // the same sum and what the spreadsheet check computes.
  function realByDate() {
    const totals = {};
    downloads.forEach(d => { totals[d.date] = (totals[d.date] || 0) + (Number(d.count) || 0); });
    const dates = Object.keys(totals).sort(), out = {};
    dates.forEach((d, i) => { if (i) out[d] = Math.max(0, totals[d] - totals[dates[i - 1]]); });
    const lastBefore = day => dates.filter(d => d < day).pop(), lastBy = day => dates.filter(d => d <= day).pop();
    // {value, base, end} for the days from..to, or null when no snapshot before `from` exists to start from.
    const between = (from, to) => {
      const base = lastBefore(from), end = lastBy(to);
      return base && end && end >= from ? {value: Math.max(0, totals[end] - totals[base]), base, end} : null;
    };
    return {out, snapshots: dates.length, between, first: dates[0] || ''};
  }

  // ---- certainty ----
  const LABEL = {clear: 'Clear', early: 'Early sign', 'too-early': 'Too early'};
  function rate(k, nn) {
    const w = R.wilson(k, nn), box = el('span');
    box.append(el('span', `${R.pc(k, nn)}%`), el('span', nn ? `${Math.round(w.lo * 100)}–${Math.round(w.hi * 100)}%` : '', 'dash-ci'));
    const c = R.certainty(k, nn); box.append(el('span', LABEL[c], `dash-chip${c === 'clear' ? ' clear' : ''}`)); box.lastChild.style.marginInlineStart = '6px';
    box.title = `${n(k)} of ${n(nn)} page views. 90% range ${Math.round(w.lo * 100)}–${Math.round(w.hi * 100)}%.`;
    return box;
  }
  function table(headers, rows, dimFrom) {
    const t = el('table', undefined, 'dash-table'), head = el('tr');
    headers.forEach(h => head.append(el('th', h)));
    const thead = el('thead'); thead.append(head); t.append(thead);
    const body = el('tbody');
    rows.forEach(cells => { const tr = el('tr'); cells.forEach((c, i) => { const td = el('td', c instanceof Node ? undefined : c, dimFrom !== undefined && i >= dimFrom ? 'dash-dim' : ''); if (c instanceof Node) td.append(c); tr.append(td); }); body.append(tr); });
    t.append(body); return t;
  }
  const devName = d => ({phone: 'Phone', tablet: 'Tablet', desktop: 'Computer'}[d] || human(d));
  const noData = box => { box.replaceChildren(); if (!cur || !cur.views) { box.append(el('p', 'No page views in this period yet.', 'dash-empty')); return true; } return false; };
  // An empty answer from the current script means no page views yet, not an old script.
  const scriptCurrent = () => true;
  const EMPTY_YET = 'No page views recorded yet. They appear here within a minute of someone visiting the site.';
  const needsScript = (box, what) => { box.replaceChildren(el('p', scriptCurrent() ? EMPTY_YET : `${what} has nothing to show yet.`, 'dash-empty')); };

  // ---- 1. data health ----
  function health() {
    const box = $('dx-health'); box.replaceChildren(); box.classList.remove('dash-bad');
    const add = (label, text, bad) => { const s = el('span'); s.append(el('b', label + ' '), document.createTextNode(text)); box.append(s); if (bad) box.classList.add('dash-bad'); };
    const m = cur && cur.meta;
    if (!m || !cur.views) add('No page views in this period yet.', 'They appear here within a minute of someone visiting.', !m);
    else {
      add('Page views kept in Supabase.', `${n(cur.views)} in the last ${period} days.`);
      if (m.last_row_at) {
        const mins = Math.max(0, Math.round((Date.now() - new Date(m.last_row_at).getTime()) / 60000));
        const ago = mins < 90 ? `${mins} minutes ago` : mins < 2880 ? `${Math.round(mins / 60)} hours ago` : `${Math.round(mins / 1440)} days ago`;
        add('Last page view', ago + '.', mins > 72 * 60);
        if (mins > 72 * 60) add('Nothing has arrived for 3 days.', 'Check that the site still loads js/analytics.js.', true);
      }
      if (m.truncated) add('Showing the newest records only.', 'More page views than one load can carry.', true);
    }
    const lf = liveFrom();
    if (lf) add('Records since', `${dayName(lf)}.`);
    const s = el('span'), b = el('button', notCounted() ? 'Count it again' : 'Stop counting it'); b.type = 'button';
    s.append(el('b', notCounted() ? 'This browser is not counted.' : 'This browser is counted on the site.'), document.createTextNode(' '), b);
    b.addEventListener('click', () => { setCounted(notCounted()); health(); });
    box.append(s);
  }

  // ---- 2. verdicts ----
  const ANCHOR = {path: 'path', channels: 'channels', fix: 'fix', content: 'readers', release: 'release', details: 'details', health: 'act'};
  function verdicts() {
    const box = $('dx-verdicts'); box.replaceChildren();
    let cards = cur ? R.verdicts(cur, ctx) : [];
    if (!cards.length) cards = [R.nothingClear(cur || {})];
    cards.forEach(c => {
      const card = el('div', undefined, 'card card-support dash-verdict');
      const top = el('div'); top.append(el('span', LABEL[c.certainty], `dash-chip${c.certainty === 'clear' ? ' clear' : ''}`));
      if (c.n) top.append(el('span', `${n(c.n)} page views behind this`, 'dash-ci'));
      card.append(top, el('p', c.finding));
      const ul = el('ul'); c.options.forEach(o => ul.append(el('li', o))); card.append(ul);
      if (c.certainty === 'too-early' && c.more && c.id !== 'quiet') card.append(el('p', `Needs about ${n(c.more)} more page views to be sure.`, 'dash-ci'));
      const a = el('button', 'See the evidence', 'dash-link'); a.type = 'button'; a.addEventListener('click', () => openTab(ANCHOR[c.evidence] || 'act')); card.append(a);
      box.append(card);
    });
  }

  // ---- 3. key numbers ----
  function sparkline(values) {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 100 30'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
    const max = Math.max(1, ...values), step = values.length > 1 ? 100 / (values.length - 1) : 100;
    const line = document.createElementNS(ns, 'polyline'); line.setAttribute('class', 'dash-spark');
    line.setAttribute('points', values.map((v, i) => `${(i * step).toFixed(1)},${(28 - v / max * 26).toFixed(1)}`).join(' '));
    svg.append(line); return svg;
  }
  function change(a, b, hasPrev) {
    if (!hasPrev) return ['No earlier period to compare yet.', ''];
    const d = a - b; if (!d) return [`Same as before (${n(b)}).`, ''];
    return d > 0 ? [`Up ${n(d)} from ${n(b)}.`, 'up'] : [`Down ${n(-d)} from ${n(b)}.`, 'down'];
  }
  function metricSeries() {
    const dates = dateList(), rows = dailyRows(), real = realByDate();
    const per = f => { const m = byDate(rows, f); return dates.map(d => m[d] || 0); };
    return {dates, views: per('views'), pressed: per('pressed'), dlPressed: per('dl_pressed'), submitted: per('submitted'), real: dates.map(d => real.out[d] || 0), snapshots: real.snapshots};
  }
  function tiles() {
    const box = $('dx-tiles'); box.replaceChildren();
    const rows = dailyRows(), real = realByDate(), hasDaily = rows.length > 0, w = win(), lf = liveFrom();
    const curRows = rows.filter(r => inCur(r.date)), prevRows = rows.filter(r => inPrev(r.date));
    // Compare only with a whole earlier period of full records: a period that is partly missing, or partly Allow-all
    // only, would always read as "Up".
    const firstDay = rows.reduce((m, r) => (!m || r.date < m ? r.date : m), '');
    const partial = !!lf && lf > w.curFrom, hasPrev = prevRows.length > 0 && firstDay <= w.prevFrom && !(lf && lf > w.prevFrom);
    const s = metricSeries(), seven = a => a.slice(-7);
    const realCur = real.between(w.curFrom, w.today), realPrev = real.between(w.prevFrom, addDays(w.curFrom, -1));
    const cv = sumDaily(curRows, 'views'), pv = sumDaily(prevRows, 'views'), cp = sumDaily(curRows, 'pressed'), pp = sumDaily(prevRows, 'pressed');
    const items = hasDaily ? [
      ['Page views', cv, pv, seven(s.views), hasPrev],
      ['Download presses', cp, pp, seven(s.pressed), hasPrev],
      ['Real downloads (GitHub)', realCur ? realCur.value : 0, realPrev ? realPrev.value : 0, seven(s.real), !!(realCur && realPrev),
        realCur ? '' : real.snapshots < 2 ? 'GitHub download counts are not in the console yet.' : `Snapshots start ${dayName(real.first)}: no total from before this period to count from.`],
      ['Signups sent', sumDaily(curRows, 'submitted'), sumDaily(prevRows, 'submitted'), seven(s.submitted), hasPrev],
      ['Download presses per 100 page views', cv ? Math.round(cp / cv * 100) : 0, pv ? Math.round(pp / pv * 100) : 0, seven(s.views.map((v, i) => (v ? s.pressed[i] / v * 100 : 0))), hasPrev],
    ] : [['Page views', cur ? cur.views : 0, 0, [], false], ['Download presses', cur ? cur.downloaded : 0, 0, [], false]];
    items.forEach(([label, a, b, series, compare, pending]) => {
      const t = el('div', undefined, 'card card-support dash-tile');
      t.append(el('b', pending ? '–' : n(a)), el('span', label));
      if (pending) t.append(el('span', pending));
      else { const [words, tone] = change(a, b, compare); const d = el('span', undefined, 'dash-delta'); d.append(el('span', words, `dash-chip ${tone}`)); t.append(d); }
      if (series.length) t.append(sparkline(series));
      box.append(t);
    });
    const fairFrom = lf ? addDays(lf, 2 * period - 1) : '';
    $('dx-numbers-note').textContent = !hasDaily ? (scriptCurrent() ? EMPTY_YET : 'The receiver script is out of date, so only this period’s totals show.')
      : partial ? `Full records began ${dayName(lf)}; days before it hold only Allow-all visitors, so these totals run low. A fair comparison with the ${period} days before starts ${dayName(fairFrom)}.`
      : hasPrev ? `Each number is set beside the ${period} days before, with the last 7 days as a line.`
      : lf && lf > w.prevFrom ? `The ${period} days before are partly from before full records (${dayName(lf)}), so there is nothing fair to compare with until ${dayName(fairFrom)}.`
      : 'Data does not yet cover the whole period before, so there is nothing fair to compare with.';
    check(cv, cp, sumDaily(curRows, 'submitted'), realCur);
  }

  // ---- 3b. the same numbers, as spreadsheet formulas the owner can paste into any empty cell ----
  function check(views, pressed, signups, realCur) {
    const box = $('dx-check-box'); box.replaceChildren();
    const w = win(), D = d => `DATE(${+d.slice(0, 4)},${+d.slice(5, 7)},${+d.slice(8, 10)})`, P = "'Page views'!", G = "'GitHub downloads'!";
    const since = `${P}A:A,">="&${D(w.curFrom)}`, t = R.totals(cur || {});
    const rows = [
      ['Page views', n(views), `=COUNTIFS(${since})`],
      ['Download presses (page views with one)', n(pressed), `=COUNTIFS(${since},${P}U:U,"*download-app-*")`],
      ['Signups sent', n(signups), `=COUNTIFS(${since},${P}U:U,"*signup-submit*")`],
      ['Downloads page views', n(t.went), `=COUNTIFS(${since},${P}E:E,"*current-status")`],
    ];
    if (realCur) rows.push(['Real downloads (GitHub)', n(realCur.value), `=SUMIFS(${G}E:E,${G}A:A,"${realCur.end}")-SUMIFS(${G}E:E,${G}A:A,"${realCur.base}")`]);
    box.append(el('p', `From ${dayName(w.curFrom)} to today, Cairo time, in the analytics spreadsheet. Paste a formula into any empty cell: it should give the number beside it. Rows that arrive while you check can add one or two.`, 'dash-empty'));
    box.lastChild.style.margin = '12px 0';
    box.append(table(['Number', 'Here', 'Formula'], rows.map(([label, v, f]) => {
      const cell = el('span'), code = el('code', f), copy = el('button', 'Copy'); copy.type = 'button';
      copy.addEventListener('click', () => { try { navigator.clipboard.writeText(f); copy.textContent = 'Copied'; } catch (_) {} });
      cell.append(code, document.createTextNode(' '), copy); return [label, v, cell];
    })));
    box.append(el('p', 'Signups sent counts page views where the form was sent, your own tests included. The signup rows in the survey spreadsheet are the list of people.', 'dash-foot'));
    box.lastChild.style.margin = '12px 0 0';
  }

  // ---- 4. the path to a download ----
  function path() {
    const box = $('dx-path-box'); if (noData(box)) return;
    if (!cur.daily) return needsScript(box, 'The path');
    const t = R.totals(cur), cols = ['phone', 'tablet', 'desktop'].filter(d => t.by[d]).map(d => [devName(d), t.by[d]]);
    cols.push(['All devices', t]);
    const hasLink = (cur.daily || []).some(d => typeof d.link === 'number');
    const head = title => ['', ...cols.map(c => c[0])].map((h, i) => (i ? h : title));
    box.append(el('h3', 'On the pages that lead to Downloads'), table(head('Page views on every page but Downloads'), [
      ['Page views', ...cols.map(c => n(c[1].other))],
      ['The Downloads link was on screen', ...cols.map(c => rate(c[1].seen, c[1].other))],
      ['Pressed the Downloads link', ...cols.map(c => (hasLink ? rate(c[1].link, c[1].other) : '–'))],
    ]));
    box.append(el('h3', 'On the Downloads page'), table(head('Page views of the Downloads page'), [
      ['Page views', ...cols.map(c => n(c[1].went))],
      ['Pressed a download', ...cols.map(c => (hasLink ? (c[1].went ? rate(c[1].dl_pressed, c[1].went) : '–') : '–'))],
      ['Of all download presses, for another device', ...cols.map(c => (c[1].pressed ? rate(c[1].wrong, c[1].pressed) : '–'))],
    ]));
    const notes = el('ul', undefined, 'dash-list');
    if (!hasLink) notes.append(el('li', 'Presses of the Downloads link, and presses on the Downloads page alone, need the latest receiver script.'));
    const real = realByDate(), w = win(), realCur = real.between(w.curFrom, w.today);
    notes.append(el('li', `Download presses on any page: ${n(t.pressed)}. Real downloads from GitHub in the same days: ${realCur ? n(realCur.value) : 'not known yet'}. ` +
      'GitHub counts every fetch of a file, including links shared outside the site and repeat downloads, so the two never match exactly; a press with no download is a cancelled or blocked one.'));
    const arr = cur.arrivals || [];
    if (arr.length) notes.append(el('li', 'Downloads page views came from: ' + arr.map(a => `${a.from === 'outside' ? 'another site' : a.from === 'none' || a.from === 'unknown' ? 'no referrer (typed, bookmarked or an app)' : pageName(a.from)} (${n(a.count)})`).join(', ') + '.'));
    notes.style.marginTop = '14px'; box.append(notes);
  }

  // ---- 5. trends ----
  function releaseMarkers() {
    return Object.values(registry).filter(r => /^(index|current-status)\.html$/.test(r.page || '') && /^UX-\d{4}\.\d\d\.\d\d\./.test(r.id))
      .map(r => ({date: r.id.slice(3, 13).replace(/\./g, '-'), name: r.name || r.id}));
  }
  const relWords = list => `${list.length} release${list.length === 1 ? '' : 's'}: ${list[0]}${list.length > 1 ? ` and ${list.length - 1} more` : ''}`;
  // A bar per day: counts this small read better as bars than as a zig-zag line. Days before full records are grey.
  function chart(title, dates, values, opts) {
    const o = opts || {}, lf = liveFrom(), wrap = el('div', undefined, 'card card-support dash-chart'), ns = 'http://www.w3.org/2000/svg';
    const total = values.reduce((a, b) => a + b, 0), full = dates.map((d, i) => (!lf || d >= lf ? values[i] : 0)).reduce((a, b) => a + b, 0);
    wrap.append(el('h3', `${title} · ${n(total)} in total`));
    const W = 320, H = 124, L = 26, B = 22, T = 8, Rr = 4, max = o.max || Math.max(1, ...values), top = max <= 4 ? 4 : Math.ceil(max / 5) * 5;
    const slot = (W - L - Rr) / dates.length, bw = Math.max(1, slot - 2), x = i => L + i * slot + 1, y = v => T + (H - T - B) * (1 - v / top);
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${title} by day`);
    const mk = (tag, attrs) => { const e = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); svg.append(e); return e; };
    mk('line', {class: 'ax', x1: L, x2: W - Rr, y1: y(0), y2: y(0)}); mk('line', {class: 'ax', x1: L, x2: W - Rr, y1: y(top), y2: y(top), 'stroke-dasharray': '2 3'});
    const t1 = mk('text', {x: 0, y: y(top) + 4}); t1.textContent = n(top); const t0 = mk('text', {x: 0, y: y(0) + 4}); t0.textContent = '0';
    const a = mk('text', {x: L, y: H - 4}); a.textContent = dayName(dates[0]); const b = mk('text', {x: W - Rr, y: H - 4, 'text-anchor': 'end'}); b.textContent = dayName(dates[dates.length - 1]);
    const rel = {}; (o.markers || []).forEach(m => { if (dates.includes(m.date)) (rel[m.date] = rel[m.date] || []).push(m.name); });
    Object.keys(rel).forEach(d => { const i = dates.indexOf(d), cx = x(i) + bw / 2; mk('path', {class: 'tick', d: `M${cx - 3},${y(0) + 7} L${cx + 3},${y(0) + 7} L${cx},${y(0) + 2} Z`}); });
    const tip = el('div', undefined, 'dash-tip');
    values.forEach((v, i) => {
      const pre = lf && dates[i] < lf, h = Math.max(v ? 2 : 0, y(0) - y(v));
      const bar = mk('rect', {class: `bar${o.cls ? ' ' + o.cls : ''}${pre ? ' pre' : ''}`, x: x(i), y: y(0) - h, width: bw, height: h, rx: Math.min(2, bw / 2)});
      const hit = mk('rect', {class: 'hit', x: L + i * slot, y: 0, width: slot, height: H});
      const on = () => { bar.classList.add('on'); tip.style.display = 'block';
        tip.textContent = `${dayName(dates[i])}: ${n(v)}${pre ? ' (Allow all only)' : ''}${rel[dates[i]] ? ` · ${relWords(rel[dates[i]])}` : ''}`;
        const r = svg.getBoundingClientRect(), px = (x(i) + bw / 2) / W * r.width; tip.style.left = `${Math.min(Math.max(px - 70, 0), Math.max(0, r.width - 170))}px`; tip.style.top = '34px'; };
      const off = () => { bar.classList.remove('on'); tip.style.display = 'none'; };
      hit.addEventListener('mouseenter', on); hit.addEventListener('mouseleave', off); hit.addEventListener('touchstart', on, {passive: true});
    });
    const tbl = table(['Day', title, 'Release'], dates.map((d, i) => [d, `${n(values[i])}${lf && d < lf ? ' (Allow all only)' : ''}`, rel[d] ? relWords(rel[d]) : ''])); tbl.hidden = true;
    const toggle = el('button', 'Show as table'); toggle.type = 'button';
    toggle.addEventListener('click', () => { tbl.hidden = !tbl.hidden; svg.style.display = tbl.hidden ? '' : 'none'; toggle.textContent = tbl.hidden ? 'Show as table' : 'Show as chart'; });
    wrap.append(svg, tip);
    if (o.note) wrap.append(el('p', o.note, 'cap'));
    else if (lf && dates[0] < lf && full !== total) wrap.append(el('p', `${n(full)} since full records began on ${dayName(lf)}.`, 'cap'));
    wrap.append(tbl, toggle); return wrap;
  }
  function trends() {
    const box = $('dx-charts'); box.replaceChildren();
    if (!dailyRows().length) { const c = el('div', undefined, 'card card-support dash-card'); needsScript(c, 'Trends'); box.append(c); return; }
    const s = metricSeries(), dlMax = Math.max(1, ...s.pressed, ...s.real);
    box.append(chart('Page views', s.dates, s.views, {markers: releaseMarkers()}), chart('Signups sent', s.dates, s.submitted),
      chart('Download presses', s.dates, s.pressed, {max: dlMax, note: 'Same scale as real downloads beside it.'}),
      chart('Real downloads (GitHub)', s.dates, s.real, {max: dlMax, cls: 'real', note: s.snapshots < 2 ? 'GitHub download counts are not in the console yet.' : 'The rise in GitHub’s count since the snapshot before; a missed day lands on the next one.'}));
  }

  // ---- 6. channels ----
  const SOURCE = {direct: 'Direct (typed, bookmarked or an app)', google: 'Google', gmail: 'Gmail', facebook: 'Facebook', x: 'X (Twitter)', instagram: 'Instagram', linkedin: 'LinkedIn',
    reddit: 'Reddit', whatsapp: 'WhatsApp', bing: 'Bing', duckduckgo: 'DuckDuckGo', chatgpt: 'ChatGPT', youtube: 'YouTube', github: 'GitHub', yahoo: 'Yahoo'};
  function channels() {
    const box = $('dx-channels-box'); if (noData(box)) return;
    const rows = (cur.who && cur.who.source) || [], counted = rows.some(r => typeof r.toward === 'number');
    if (!rows.length) { box.append(el('p', 'No arrivals recorded in this period yet.', 'dash-empty')); return; }
    const siteK = rows.reduce((x, r) => x + R.toward(r), 0), siteN = rows.reduce((x, r) => x + r.views, 0);
    box.append(table(['Source', 'Arrivals', 'First page led toward a download', 'Against all arrivals'], rows.map(r => {
      const k = R.toward(r), merged = r.key === 'Smaller groups';
      const verdict = merged || r.views < 30 ? 'Too early' : ({above: 'Better', below: 'Worse', same: 'No clear difference'})[R.compare({k, n: r.views}, {k: siteK, n: siteN})];
      return [SOURCE[r.key] || r.key, n(r.views), r.views ? rate(k, r.views) : '–', verdict];
    })));
    box.append(el('p', `All arrivals: ${R.pc(siteK, siteN)}% led toward a download on their first page.${counted ? '' : ' This receiver script still counts every page view as an arrival; paste the latest one.'}`, 'dash-foot'));
  }

  // ---- 7. fix list ----
  function fixList() {
    const box = $('dx-fix-box'); if (noData(box)) return;
    if (!cur.pages) return needsScript(box, 'The fix list');
    const rows = [];
    cur.pages.forEach(g => {
      (g.errors || []).forEach(e => rows.push({what: R.errorWords(e.code), page: g.page, k: e.count, n: g.views, kind: /script-count-js/.test(e.code) ? 'ad blocker, no action' : /^res-error-/.test(e.code) ? 'broken file' : 'broken script', dim: /script-count-js/.test(e.code)}));
      (g.dead || []).forEach(d => rows.push({what: `Taps ${ctx.labels[d.code] || d.code}, which does nothing`, page: g.page, k: d.count, n: g.views, kind: 'looks clickable'}));
      if (g.lcp_n >= 10 && g.lcp_slow) rows.push({what: `Main content takes over 4 seconds on phones (typical ${g.lcp_median} s)`, page: g.page, k: g.lcp_slow, n: g.views, kind: 'speed'});
    });
    if (cur.hesitate && cur.hesitate.rage) rows.push({what: 'Clicked the same spot three times in a second', page: '', k: cur.hesitate.rage, n: cur.views, kind: 'looks clickable'});
    rows.sort((a, b) => (a.dim - b.dim) || b.k - a.k);
    if (!rows.length) { box.append(el('p', 'Nothing failed, ran slowly or looked clickable in this period.', 'dash-empty')); return; }
    box.append(table(['What happened', 'Page', 'Page views affected', 'Kind of fix'], rows.slice(0, 20).map(r => [r.what, r.page ? pageName(r.page) : 'All pages', `${n(r.k)} · ${R.pc(r.k, r.n)}%`, r.kind])));
  }

  // ---- 8. readers: sections and questions ----
  const faqCache = {};
  async function faqQuestions(page) {
    if (faqCache[page]) return faqCache[page];
    let list = [];
    try {
      const doc = new DOMParser().parseFromString(await (await fetch(`${page}.html`)).text(), 'text/html');
      list = [...doc.querySelectorAll('#faq details summary')].map(s => s.textContent.replace(/\s+/g, ' ').trim());
    } catch (_) {}
    return (faqCache[page] = list);
  }
  async function readers() {
    const bars = $('dx-bars'), faqBox = $('dx-faq-box'), note = $('dx-drop-note'), select = $('dx-release');
    bars.replaceChildren(); faqBox.replaceChildren(); note.hidden = true;
    if (!cur || !cur.reach || !cur.reach.length) { select.hidden = true; bars.append(el('p', 'No section views in this period yet.', 'dash-empty')); return; }
    const groups = cur.reach, keep = select.value, idOf = g => `${g.release}|${g.page}`;
    select.replaceChildren(...groups.map(g => { const o = el('option', `${pageName(g.page)}${/^UX-/.test(g.release) ? ` · ${releaseName(g.release)}` : ''} · ${n(g.views)} page views`); o.value = idOf(g); return o; }));
    select.hidden = false; if (groups.some(g => idOf(g) === keep)) select.value = keep;
    const group = groups.find(g => idOf(g) === select.value) || groups[0];
    const {names, order} = await sectionNames(`${group.page}.html`);
    if (idOf(group) !== select.value) return;
    const rows = Object.entries(group.sections).sort((a, b) => { const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]); return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || b[1] - a[1]; });
    if (!rows.length) bars.append(el('p', `${n(group.views)} page views, none reached a section yet.`, 'dash-empty'));
    let worst = null;
    rows.forEach(([id, v], i) => {
      const label = names[id] || human(id), share = v / group.views * 100;
      if (i && group.views >= 50) { const drop = (rows[i - 1][1] - v) / group.views * 100; if (!worst || drop > worst.drop) worst = {drop, a: names[rows[i - 1][0]] || human(rows[i - 1][0]), b: label}; }
      const row = el('div', undefined, 'dash-bar'), track = el('span', undefined, 'dash-track'), fill = el('span', undefined, 'dash-fill');
      fill.style.width = `${Math.min(100, share)}%`; track.append(fill);
      row.title = `${label}: ${n(v)} of ${n(group.views)} page views reached this section (code: reach-${id})`;
      row.append(el('span', label), track, el('b', `${pct(share)} · ${n(v)}`)); bars.append(row);
    });
    if (worst && worst.drop > 0) { note.hidden = false; note.textContent = `The biggest drop: ${Math.round(worst.drop)} points of readers stop between “${worst.a}” and “${worst.b}”.`; }
    const pg = ((cur.pages || []).find(p => p.page === group.page) || {}), faq = pg.faq || [], qs = await faqQuestions(group.page);
    if (idOf(group) !== select.value) return;
    faqBox.append(faq.length ? table(['Question', 'Page views'], faq.map(f => [qs[+f.code.slice(4) - 1] || eventLabel(f.code), n(f.count)])) : el('p', 'No question opened on this page yet.', 'dash-empty'));
  }

  // ---- 9. did the last release help ----
  function releaseEffect() {
    const sel = $('dx-rel-page'), box = $('dx-rel-box'); box.replaceChildren();
    const byPage = {}; ((cur && cur.by_release) || []).forEach(r => { (byPage[r.page] = byPage[r.page] || []).push(r); });
    const pages = Object.keys(byPage).filter(p => byPage[p].length >= 2);
    const keep = sel.value; sel.replaceChildren(...pages.map(p => { const o = el('option', pageName(p)); o.value = p; return o; })); sel.hidden = !pages.length;
    if (!pages.length) { box.append(el('p', cur && cur.by_release ? 'No page has two versions with page views in this period yet.' : 'This needs the latest receiver script.', 'dash-empty')); return; }
    if (pages.includes(keep)) sel.value = keep;
    const list = byPage[sel.value].sort((a, b) => new Date(a.first) - new Date(b.first)), c = list[list.length - 1], p = list[list.length - 2];
    const dl = /^(ar\/)?current-status$/.test(sel.value);
    const metrics = dl ? [['Pressed a download', 'pressed']] : [['Downloads link on screen', 'seen'], ...(typeof c.link === 'number' ? [['Pressed the Downloads link', 'link']] : []), ['Sent the signup', 'submitted'], ['Signup without ever seeing Downloads', 'signup_unseen']];
    box.append(table(['Measure', `Before · ${releaseName(p.release)} · ${n(p.views)} page views`, `Now · ${releaseName(c.release)} · ${n(c.views)} page views`, 'Verdict'], metrics.map(([label, f]) => {
      const enough = c.views >= 30 && p.views >= 30;
      const v = !enough ? 'Too early' : ({above: 'Higher', below: 'Lower', same: 'No clear difference'})[R.compare({k: c[f], n: c.views}, {k: p[f], n: p.views})];
      return [label, rate(p[f], p.views), rate(c[f], c.views), v];
    })));
  }

  // ---- 10. details ----
  function details() {
    const box = $('dx-details-box'); box.replaceChildren();
    if (cur && cur.views) {
      const names = {lang: {en: 'English', ar: 'Arabic'}, source: {direct: 'Direct or unknown'}};
      [['browser', 'Browser'], ['os', 'Operating system'], ['lang', 'Language']].forEach(([k, title]) => {
        const rows = (cur.who && cur.who[k]) || []; if (!rows.length) return;
        box.append(el('h3', title, 'dash-sub'), table([title, 'Page views', 'Typical seconds active', 'Headed for a download', 'Sent the signup'],
          rows.map(r => [(names[k] && names[k][r.key]) || human(r.key), n(r.views), r.active_median === '' ? '–' : r.active_median, `${R.pc(R.toward(r), r.views)}%`, `${typeof r.signups === 'number' ? R.pc(r.signups, r.views) : r.signup_pct}%`])));
      });
      const c = cur.consent, tot = cur.views;
      box.append(el('h3', 'Consent choices', 'dash-sub'), el('p', `Allow all: ${R.pc(c.all, tot)}% · essential only: ${R.pc(c.essential, tot)}% · no answer: ${R.pc(c.undecided, tot)}% · Global Privacy Control: ${R.pc(c.gpc, tot)}%.`, 'dash-empty'));
      if (cur.usage && cur.usage.length) box.append(el('h3', 'Everything visitors did', 'dash-sub'), table(['What visitors did', 'Page views', 'Code'], cur.usage.map(u => [eventLabel(u.code), n(u.count), u.code]), 2));
    }
    // Allow-all journeys, by first page
    const groups = {}; journeys.rows.filter(r => r.date >= win().curFrom).forEach(r => {
      const merged = r.landing_release === 'other', key = merged ? 'Smaller groups' : `${r.landing_release}\u0001${r.landing_page}`;
      const g = groups[key] || (groups[key] = {visits: 0, downloads: 0, signups: 0, merged, page: r.landing_page});
      g.visits += Number(r.visits) || 0; g.downloads += Number(r.downloads) || 0; g.signups += Number(r.signups) || 0;
    });
    const entries = Object.values(groups).sort((a, b) => b.visits - a.visits);
    box.append(el('h3', 'Allow-all journeys, by first page', 'dash-sub'));
    box.append(entries.length ? table(['First page', 'Visits', 'Downloads', 'Signups'], entries.map(g => [g.merged ? 'Smaller groups' : pageName(g.page), n(g.visits), n(g.downloads), n(g.signups)])) : el('p', 'No linked visits in this period yet.', 'dash-empty'));
    // GitHub downloads by build
    if (downloads.length) {
      const dates = [...new Set(downloads.map(d => d.date))].sort(), end = dates[dates.length - 1], rows = downloads.filter(d => d.date === end);
      box.append(el('h3', `GitHub downloads by file, total at ${end}`, 'dash-sub'), table(['Build', 'Real downloads in total'], rows.map(d => [`${d.tag} · ${human(d.platform)}`, n(d.count)])));
    }
    // GoatCounter tables (the cross-check)
    const gc = daily.filter(r => r.date >= win().curFrom).sort((a, b) => (a.date < b.date ? 1 : -1));
    if (gc.length) box.append(el('h3', 'GoatCounter, day by day (cross-check)', 'dash-sub'), table(['Day', 'Page views counted', 'App downloads counted'], gc.slice(0, 14).map(r => [r.date, n(r.page_visits), n(r.app_downloads)])));
    if (journeys.dropped) box.append(el('p', `The script dropped ${n(journeys.dropped)} events at its daily limits.`, 'dash-note'));
  }

  function render() {
    health(); verdicts(); tiles(); path(); trends(); channels(); fixList(); readers(); releaseEffect(); details();
    $('dx-foot').textContent = 'Page views are not people: one person opening five pages is five. Percentages show a 90% range and a label: Clear (100 or more page views, narrow range), Early sign (30 or more), Too early.';
  }

  $('dx-period').addEventListener('click', e => {
    const b = e.target.closest('button[data-days]'); if (!b) return;
    period = Number(b.dataset.days);
    document.querySelectorAll('#dx-period button[data-days]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    load();
  });
  $('dx-release').addEventListener('change', readers);
  $('dx-rel-page').addEventListener('change', releaseEffect);
  window.addEventListener('lightning:owner-access', e => {
    verified = !!(e.detail && e.detail.verified);
    if (verified) { setCounted(false); load(); } else { authGeneration++; $('dx-status').hidden = false; $('dx-status').textContent = 'Verify your session to load the analytics.'; }
  });
  window.addEventListener('lightning:owner-changed', () => { const v = document.getElementById('analytics'); if (v && !v.hidden) load(); });
  window.FGOwnerDecisions = {load};

})();
