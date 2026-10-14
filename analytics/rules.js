// Decision rules and statistics for analytics/dashboard.html. Pure functions: no DOM, no network, testable in Node
// (analytics/tests/rules.test.js). Input is the private `what=insights` answer of the receiver.
(function (root) {
  const Z = 1.645; // Wilson 90% interval
  const DOWNLOADS_PAGE = /^(ar\/)?current-status$/;

  // ---- statistics ----
  function wilson(k, n) {
    if (!n) return {p: 0, lo: 0, hi: 1, half: 0.5};
    const p = k / n, z2 = Z * Z, d = 1 + z2 / n;
    const c = (p + z2 / (2 * n)) / d, h = Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / d;
    return {p, lo: Math.max(0, c - h), hi: Math.min(1, c + h), half: h};
  }
  // clear: n >= 100 and the interval is within 10 points; early: n >= 30; else too early.
  function certainty(k, n) {
    const w = wilson(k, n);
    return n >= 100 && w.half <= 0.1 ? 'clear' : n >= 30 ? 'early' : 'too-early';
  }
  // How many more page views until the interval is about 10 points wide (p = 0.5 when unknown).
  function needMore(k, n) {
    const p = n ? k / n : 0.5;
    return Math.max(0, Math.ceil(Z * Z * p * (1 - p) / 0.01 - n));
  }
  // 'above' / 'below' when the two intervals do not overlap, else 'same'.
  function compare(a, b) {
    const x = wilson(a.k, a.n), y = wilson(b.k, b.n);
    return x.lo > y.hi ? 'above' : x.hi < y.lo ? 'below' : 'same';
  }
  const pc = (k, n) => (n ? Math.round(k / n * 100) : 0);

  // ---- reading the insights answer ----
  function totals(ins) {
    const t = {views: 0, other: 0, seen: 0, went: 0, pressed: 0, started: 0, submitted: 0, signup_unseen: 0, wrong: 0, by: {}};
    ((ins && ins.daily) || []).forEach(d => {
      const b = t.by[d.device] || (t.by[d.device] = {views: 0, other: 0, seen: 0, went: 0, pressed: 0, started: 0, submitted: 0, signup_unseen: 0, wrong: 0});
      [t, b].forEach(x => {
        x.views += d.views; x.other += d.other; x.seen += d.seen; x.went += d.went_downloads; x.pressed += d.pressed;
        x.started += d.started; x.submitted += d.submitted; x.signup_unseen += d.signup_unseen; x.wrong += d.wrong_platform;
      });
    });
    return t;
  }
  const pageName = p => (/^ar\//.test(p) ? 'the Arabic ' : 'the ') + (p.replace(/^ar\//, '') === 'index' ? 'home page' : p.replace(/^ar\//, '').replace(/-/g, ' ') + ' page');
  const errorWords = c => /^res-error-script-count-js/.test(c) ? 'The visit counter was blocked (an ad blocker, no action)'
    : /^res-error-/.test(c) ? 'A file did not load (' + c.replace(/^res-error-/, '') + ')'
    : /^js-reject-/.test(c) ? 'A script failed quietly (' + c.slice(10) + ')' : 'A script error (' + c.slice(9) + ')';

  // A rule: (data, ctx) -> card | null. data = the insights answer; ctx = {order: {page: [section names]}, labels: {code: words}}.
  // A card: {id, finding, certainty, options, evidence, impact, n}. impact = page views affected x severity.
  const rules = [
    {id: 'hidden-on-phone', run(ins) {
      const p = totals(ins).by.phone; if (!p || p.other < 50) return null;
      if (p.seen / p.other >= 0.3) return null;
      return {id: this.id, evidence: 'path', n: p.other, k: p.seen, impact: p.other * 3,
        finding: `On phones the Downloads link was on screen in only ${pc(p.seen, p.other)}% of page views: it sits in the closed menu.`,
        options: ['Show Downloads in the phone top bar, outside the menu', 'Say “Download” in the hero line', 'Link Downloads from the signup band']};
    }},
    {id: 'signup-instead', run(ins) {
      const t = totals(ins); if (t.submitted < 10 || t.signup_unseen / t.submitted < 0.5) return null;
      return {id: this.id, evidence: 'path', n: t.submitted, k: t.signup_unseen, impact: t.submitted * 3,
        finding: `${t.signup_unseen} of ${t.submitted} signups came from people who never saw the Downloads link: they may think signing up is how to get the app.`,
        options: ['Say on the signup band that the app is free to download now', 'Put the Downloads link in the band', 'Ask after signup what they hoped to do (decision 15 in OWNER.md)']};
    }},
    {id: 'downloads-page-leak', run(ins) {
      const d = ins.downloads_page || {}, v = d.views || 0; if (v < 30 || d.clicked / v >= 0.4) return null;
      return {id: this.id, evidence: 'path', n: v, k: v - d.clicked, impact: (v - d.clicked) * 2,
        finding: `People reach Downloads but ${pc(v - d.clicked, v)}% leave without pressing a download.`,
        options: ['Check the page on a phone', 'Make the right platform obvious', 'Shorten what comes before the buttons']};
    }},
    {id: 'wrong-platform', run(ins) {
      const w = ins.wrong_platform || {}; if ((w.presses || 0) < 20 || w.wrong / w.presses < 0.1) return null;
      return {id: this.id, evidence: 'path', n: w.presses, k: w.wrong, impact: w.wrong * 3,
        finding: `${pc(w.wrong, w.presses)}% of download presses were for another device (for example a phone pressing the Windows file).`,
        options: ['Show the build for the visitor’s device first', 'Label platforms with device words']};
    }},
    {id: 'channels', run(ins) {
      const t = totals(ins), site = {k: t.pressed, n: t.views}; if (t.views < 30) return null;
      const best = [];
      ((ins.who && ins.who.source) || []).forEach(s => {
        if (s.views < 30 || /^(Smaller groups|direct)$/.test(s.key)) return;
        const k = Math.round(s.download_pct * s.views / 100), c = compare({k, n: s.views}, site);
        if (c === 'same') return;
        const times = Math.round((k / s.views) / Math.max(site.k / site.n, 0.005) * 10) / 10;
        best.push({s, c, k, times});
      });
      best.sort((a, b) => b.s.views - a.s.views);
      const x = best[0]; if (!x) return null;
      return x.c === 'above'
        ? {id: 'good-channel', evidence: 'channels', n: x.s.views, k: x.k, impact: x.s.views,
            finding: `Visitors from ${x.s.key} go for a download ${x.times}× as often as the site average.`, options: ['Post more there']}
        : {id: 'weak-channel', evidence: 'channels', n: x.s.views, k: x.k, impact: x.s.views,
            finding: `Visitors from ${x.s.key} go for a download less often than the site average (${pc(x.k, x.s.views)}% against ${pc(site.k, site.n)}%).`, options: ['Change what you post there', 'Or stop posting there']};
    }},
    {id: 'broken', run(ins) {
      let best = null;
      ((ins && ins.pages) || []).forEach(g => {
        if (g.views < 50) return;
        (g.errors || []).forEach(e => { const share = e.count / g.views; if (share >= 0.02 && (!best || e.count > best.e.count)) best = {g, e}; });
      });
      if (!best) return null;
      const blocked = /script-count-js/.test(best.e.code);
      return {id: this.id, evidence: 'fix', n: best.g.views, k: best.e.count, impact: blocked ? 0 : best.e.count * 4,
        finding: `${errorWords(best.e.code)} on ${pageName(best.g.page)}, in ${pc(best.e.count, best.g.views)}% of its page views.`,
        options: blocked ? ['Nothing to do: some visitors block the counter'] : /^res-error-/.test(best.e.code) ? ['Fix the file path'] : ['Check the script on that page']};
    }},
    {id: 'slow-phones', run(ins) {
      const s = ((ins.broken && ins.broken.speed) || []).find(x => x.device === 'phone');
      if (!s || s.n < 30 || !(s.median > 4)) return null;
      return {id: this.id, evidence: 'fix', n: s.n, k: Math.round(s.slow_pct * s.n / 100), impact: s.n * 2,
        finding: `On phones the main content takes ${s.median} seconds to appear; ${s.slow_pct}% wait more than 4.`,
        options: ['Shrink the hero images', 'Load the wow animation later']};
    }},
    {id: 'looks-clickable', run(ins, ctx) {
      let best = null;
      ((ins && ins.pages) || []).forEach(g => {
        if (g.views < 50) return;
        (g.dead || []).forEach(d => { if (d.count / g.views >= 0.03 && (!best || d.count > best.d.count)) best = {g, d}; });
      });
      if (!best) return null;
      const words = (ctx && ctx.labels && ctx.labels[best.d.code]) || best.d.code.replace(/^dead-/, '').replace(/-/g, ' ');
      return {id: this.id, evidence: 'fix', n: best.g.views, k: best.d.count, impact: best.d.count * 2,
        finding: `${pc(best.d.count, best.g.views)}% of page views on ${pageName(best.g.page)} tap ${words}, which does nothing.`,
        options: ['Make it open or zoom', 'Make it look less like a button']};
    }},
    {id: 'drop-off', run(ins, ctx) {
      let best = null;
      ((ins && ins.reach) || []).forEach(g => {
        if (g.views < 50) return;
        const order = (ctx && ctx.order && ctx.order[g.page]) || Object.keys(g.sections);
        const names = order.filter(n => n in g.sections);
        for (let i = 1; i < names.length; i += 1) {
          const drop = (g.sections[names[i - 1]] - g.sections[names[i]]) / g.views * 100;
          if (drop > 30 && (!best || drop > best.drop)) best = {g, a: names[i - 1], b: names[i], drop, lost: g.sections[names[i - 1]] - g.sections[names[i]]};
        }
      });
      if (!best) return null;
      const label = n => (ctx && ctx.labels && ctx.labels[n]) || n.replace(/-/g, ' ');
      return {id: this.id, evidence: 'content', n: best.g.views, k: best.lost, impact: best.lost,
        finding: `On ${pageName(best.g.page)}, ${Math.round(best.drop)} points of readers stop between “${label(best.a)}” and “${label(best.b)}”.`,
        options: [`Shorten or move “${label(best.a)}”`, 'Put the key message before it']};
    }},
    {id: 'arabic-gap', run(ins) {
      const by = {}; ((ins.who && ins.who.lang) || []).forEach(l => { by[l.key] = l; });
      const ar = by.ar, en = by.en; if (!ar || !en || ar.views < 30) return null;
      const a = {k: Math.round(ar.download_pct * ar.views / 100), n: ar.views}, e = {k: Math.round(en.download_pct * en.views / 100), n: en.views};
      if (compare(a, e) !== 'below') return null;
      return {id: this.id, evidence: 'details', n: ar.views, k: a.k, impact: ar.views,
        finding: `Arabic visitors go for a download less often (${pc(a.k, a.n)}% against ${pc(e.k, e.n)}%).`,
        options: ['Check the Arabic Downloads path', 'Check the Arabic copy for the download']};
    }},
    {id: 'release-effect', run(ins, ctx) {
      const byPage = {};
      ((ins && ins.by_release) || []).forEach(r => { (byPage[r.page] = byPage[r.page] || []).push(r); });
      let best = null;
      Object.keys(byPage).forEach(page => {
        const list = byPage[page].sort((a, b) => new Date(a.first) - new Date(b.first));
        if (list.length < 2) return;
        const cur = list[list.length - 1], prev = list[list.length - 2];
        if (cur.views < 30 || prev.views < 30) return;
        const metrics = DOWNLOADS_PAGE.test(page) ? [['pressed', 'download presses']] : [['seen', 'the Downloads link on screen'], ['pressed', 'download presses'], ['submitted', 'signups']];
        metrics.forEach(m => {
          const c = compare({k: cur[m[0]], n: cur.views}, {k: prev[m[0]], n: prev.views});
          if (c === 'same') return;
          const w = Math.abs(pc(cur[m[0]], cur.views) - pc(prev[m[0]], prev.views)) * cur.views;
          if (!best || w > best.w) best = {page, cur, prev, m, c, w};
        });
      });
      if (!best) return null;
      return {id: this.id, evidence: 'release', n: best.cur.views, k: best.cur[best.m[0]], impact: best.w / 10 + 1,
        finding: `Since ${best.cur.release}, ${best.m[1]} on ${pageName(best.page)} went from ${pc(best.prev[best.m[0]], best.prev.views)}% to ${pc(best.cur[best.m[0]], best.cur.views)}% of page views.`,
        options: best.c === 'above' ? ['Keep it'] : ['Roll back (the version archive keeps the previous page)', 'Or fix what changed']};
    }},
  ];

  // Run every rule, label each card, rank by impact, keep five. Nothing qualifies: one honest card.
  function verdicts(ins, ctx) {
    const cards = [];
    rules.forEach(r => {
      let c = null;
      try { c = r.run(ins || {}, ctx || {}); } catch (_) { c = null; }
      if (c) { c.certainty = certainty(c.k, c.n); c.more = needMore(c.k, c.n); cards.push(c); }
    });
    cards.sort((a, b) => b.impact - a.impact);
    return cards.slice(0, 5);
  }
  // The "Nothing is clear yet" card: page views needed (about 100 for a clear reading) and days at the current pace.
  function nothingClear(ins) {
    const views = ins && ins.views || 0, days = (ins && ins.days) || 1;
    const perDay = views / days, need = Math.max(0, 100 - ((totals(ins).by.phone || {}).other || 0));
    return {id: 'quiet', evidence: 'health', certainty: 'too-early', n: views, k: 0, impact: 0, more: need,
      finding: views ? 'Nothing is clear yet.' : 'No page views yet.',
      options: [need && perDay ? `About ${need} more page views on phones, about ${Math.max(1, Math.ceil(need / perDay))} days at the current pace.` : 'Keep collecting.']};
  }

  const api = {Z, wilson, certainty, needMore, compare, pc, totals, rules, verdicts, nothingClear, errorWords, pageName};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LightningRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
