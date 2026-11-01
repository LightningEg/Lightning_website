// The decision dashboard's aggregation, moved out of the Apps Script receiver (analyticsInsights_) so the owner console can
// compute it from the page-view records kept in Supabase (admin_page_views). Pure: no DOM, no network, testable in Node
// (analytics/tests/insights.test.js checks it against the receiver on the same rows). The answer has the shape rules.js reads.
// A row: {at, day, consent, ux, page, lang, device, os, browser, ref, from, us, scroll, active, lcp, tl} where tl is
// {code: seconds}. Every row in Supabase was measured (scroll and time on page recorded).
(function (root) {
  const DOWNLOADS_PAGE = 'current-status';
  const MIN_GROUP = 5;
  const TZ = 'Africa/Cairo';
  const cairoDay = t => new Date(t).toLocaleDateString('en-CA', {timeZone: TZ});

  function source(utm, ref) {
    if (utm) return String(utm).toLowerCase();
    const host = String(ref || '').toLowerCase().replace(/^(www|m|l|lm|mobile|out)\./, '');
    if (!host) return 'direct';
    const known = [[/^com\.google\.android\.gm$/, 'gmail'], [/(^|\.)google\./, 'google'], [/(^|\.)(facebook|fb)\.(com|me)$|^com\.facebook\./, 'facebook'],
      [/^(t\.co|x\.com|twitter\.com)$/, 'x'], [/(^|\.)instagram\.com$/, 'instagram'], [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'linkedin'],
      [/(^|\.)reddit\.com$/, 'reddit'], [/whatsapp/, 'whatsapp'], [/(^|\.)bing\.com$/, 'bing'], [/duckduckgo/, 'duckduckgo'],
      [/(^|\.)(chatgpt\.com|openai\.com)$/, 'chatgpt'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'], [/(^|\.)github\.com$/, 'github'], [/(^|\.)yahoo\./, 'yahoo']];
    const hit = known.filter(k => k[0].test(host))[0];
    return hit ? hit[1] : host;
  }

  function build(allRows, days, now) {
    now = now || Date.now();
    const fromDay = cairoDay(now - (days - 1) * 864e5);
    const rows = allRows.filter(r => (r.day || cairoDay(r.at)) >= fromDay);
    const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
    const median = list => {
      if (!list.length) return '';
      const sorted = list.slice().sort((a, b) => a - b), m = sorted.length >> 1;
      return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2 * 10) / 10;
    };
    const top = (map, n) => Object.keys(map).map(k => ({code: k, count: map[k]})).sort((a, b) => b.count - a.count).slice(0, n);
    const INTERACTION = /^(click-|nav-|foot-|link-|menu-open|signup-start|survey-start|faq-|calc-used|screen-|lang-switch|theme-toggle|download)/;
    const USAGE = /^(click-|nav-|foot-|link-|menu-open|calc-used|screen-|lang-switch|theme-toggle|signup-|survey-|download)/;
    const slug = DOWNLOADS_PAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const DL_SEEN = new RegExp('^seen-' + slug), DL_CLICK = new RegExp('^(click|nav|foot|link)-' + slug), DL_PAGE = new RegExp('^(ar/)?' + slug + '$');

    const daily = {}, pages = {}, byRelease = {}, arrive = {};
    let lastAt = 0, wrongTotal = 0, pressesTotal = 0;
    const consent = {all: 0, essential: 0, undecided: 0, gpc: 0};
    const deep = {25: 0, 50: 0, 75: 0, 90: 0};
    const find = {}, faq = {}, dead = {}, errors = {}, reach = {}, lcpBy = {};
    const who = {device: {}, lang: {}, source: {}, browser: {}, os: {}};
    const activeAll = [];
    let measuredViews = 0;
    const downloadsPage = {views: 0, clicked: 0};
    const usage = {}, builds = {};
    let views = 0, rage = 0, still = 0, downloaded = 0;

    rows.forEach(r => {
      const t = r.tl || {};
      const codes = Object.keys(t);
      const any = re => codes.some(c => re.test(c));
      const release = r.ux, page = r.page, device = r.device, scroll = +r.scroll || 0, active = +r.active || 0, lcp = +r.lcp || 0;
      const measured = r.active !== '' && r.active != null; // old rows rebuilt from the Events sheet have no time on page; Supabase rows always do
      const seen = any(DL_SEEN);
      const linkClicked = any(DL_CLICK);
      const clicked = linkClicked || any(/^download-app-/);
      const started = 'signup-start' in t, submitted = 'signup-submit' in t;
      const interactions = codes.filter(c => INTERACTION.test(c)).map(c => t[c]);
      views += 1;
      const at = new Date(r.at).getTime();
      if (at > lastAt) lastAt = at;
      const dayKey = r.day || cairoDay(at);
      const isDl = DL_PAGE.test(page);
      const pressedCodes = codes.filter(c => /^download-app-/.test(c));
      const mobileOs = /^(android|ios)$/.test(r.os), computerOs = /^(windows|mac|linux|chromeos)$/.test(r.os);
      const wrong = pressedCodes.some(c => (mobileOs && /-(windows|mac|linux)$/.test(c)) || (computerOs && /-android$/.test(c)));
      const d = daily[dayKey + '|' + device] || (daily[dayKey + '|' + device] = {date: dayKey, device, views: 0, other: 0, seen: 0, link: 0, went_downloads: 0, dl_pressed: 0, pressed: 0, started: 0, submitted: 0, signup_unseen: 0, wrong_platform: 0});
      d.views += 1;
      if (isDl) { d.went_downloads += 1; if (pressedCodes.length) d.dl_pressed += 1; if (measured) { const f2 = String(r.from || '') || 'none'; arrive[f2] = (arrive[f2] || 0) + 1; } }
      else { d.other += 1; if (seen) d.seen += 1; if (linkClicked) d.link += 1; }
      if (pressedCodes.length) d.pressed += 1;
      if (started) d.started += 1;
      if (submitted) { d.submitted += 1; if (!seen && !isDl) d.signup_unseen += 1; }
      if (wrong) d.wrong_platform += 1;
      pressesTotal += pressedCodes.length ? 1 : 0; wrongTotal += wrong ? 1 : 0;
      const pg = pages[page] || (pages[page] = {page, views: 0, phone_views: 0, errors: {}, dead: {}, faq: {}, lcp: []});
      pg.views += 1;
      if (device === 'phone') pg.phone_views += 1;
      if (lcp > 0 && device === 'phone') pg.lcp.push(lcp);
      codes.forEach(c => {
        const bucket = /^faq-/.test(c) ? pg.faq : /^dead-/.test(c) ? pg.dead : /^(js-error|js-reject|res-error)-/.test(c) ? pg.errors : null;
        if (bucket) bucket[c] = (bucket[c] || 0) + 1;
      });
      const rk = page + '|' + release;
      const br = byRelease[rk] || (byRelease[rk] = {page, release, first: at, last: at, views: 0, seen: 0, link: 0, went: 0, pressed: 0, submitted: 0, signup_unseen: 0});
      br.views += 1; br.first = Math.min(br.first, at); br.last = Math.max(br.last, at);
      if (isDl) br.went += 1; else { if (seen) br.seen += 1; if (linkClicked) br.link += 1; }
      if (pressedCodes.length) br.pressed += 1;
      if (submitted) { br.submitted += 1; if (!seen && !isDl) br.signup_unseen += 1; }
      consent[r.consent] = (consent[r.consent] || 0) + 1;
      if (measured) {
        measuredViews += 1;
        activeAll.push(active);
        [25, 50, 75, 90].forEach(p => { if (scroll >= p) deep[p] += 1; });
      }
      if (!interactions.length) still += 1;

      if (isDl) {
        downloadsPage.views += 1;
        if (any(/^download-app-/)) downloadsPage.clicked += 1;
      } else {
        const f = find[device] || (find[device] = {device, views: 0, seen: 0, clicked: 0, started: 0, submitted: 0, signup_unseen: 0, signup_noclick: 0, menu: 0, first: []});
        f.views += 1;
        if (seen) f.seen += 1;
        if (clicked) f.clicked += 1;
        if (started) f.started += 1;
        if (submitted) { f.submitted += 1; if (!seen) f.signup_unseen += 1; if (!clicked) f.signup_noclick += 1; }
        if ('menu-open' in t) f.menu += 1;
        if (interactions.length) f.first.push(Math.min.apply(null, interactions));
      }

      if (any(/^download-app-/)) downloaded += 1;
      codes.forEach(c => {
        if (USAGE.test(c)) usage[c] = (usage[c] || 0) + 1;
        if (/^download-app-/.test(c)) builds[c.slice(13)] = (builds[c.slice(13)] || 0) + 1;
        if (/^faq-/.test(c)) faq[c] = (faq[c] || 0) + 1;
        else if (/^dead-/.test(c)) dead[c] = (dead[c] || 0) + 1;
        else if (/^(js-error|js-reject|res-error|invalid)-/.test(c)) errors[c] = (errors[c] || 0) + 1;
        else if (c === 'rage-click') rage += 1;
      });

      const key = release + '|' + page;
      const g = reach[key] || (reach[key] = {release, page, views: 0, sections: {}});
      g.views += 1;
      codes.forEach(c => { if (/^reach-/.test(c)) g.sections[c.slice(6)] = (g.sections[c.slice(6)] || 0) + 1; });

      const fromField = String(r.from || '');
      const arrival = measured && (fromField === '' || fromField === 'outside');
      const pairs = [['device', device], ['lang', r.lang], ['browser', r.browser], ['os', r.os]];
      if (arrival) pairs.push(['source', source(r.us, r.ref)]);
      pairs.forEach(pair => {
        const m = who[pair[0]];
        const w = m[pair[1] || 'unknown'] || (m[pair[1] || 'unknown'] = {views: 0, active: [], downloads: 0, pressed: 0, signups: 0});
        w.views += 1;
        if (measured) w.active.push(active);
        if (clicked) w.downloads += 1;
        if (pressedCodes.length) w.pressed += 1;
        if (submitted) w.signups += 1;
      });
      if (lcp > 0) (lcpBy[device] = lcpBy[device] || []).push(lcp);
    });

    const groupRows = (map, merge) => {
      const out = [], rest = {views: 0, active: [], downloads: 0, pressed: 0, signups: 0};
      Object.keys(map).forEach(k => {
        const w = map[k];
        if (merge && w.views < MIN_GROUP) {
          rest.views += w.views; rest.downloads += w.downloads; rest.pressed += w.pressed; rest.signups += w.signups; rest.active = rest.active.concat(w.active);
        } else out.push({key: k, w});
      });
      if (rest.views) out.push({key: 'Smaller groups', w: rest});
      return out.sort((a, b) => b.w.views - a.w.views).map(o => ({key: o.key, views: o.w.views, active_median: median(o.w.active),
        toward: o.w.downloads, pressed: o.w.pressed, signups: o.w.signups, download_pct: pct(o.w.downloads, o.w.views), signup_pct: pct(o.w.signups, o.w.views)}));
    };
    const listOf = m => Object.keys(m).map(k => ({code: k, count: m[k]})).sort((a, b) => b.count - a.count).slice(0, 15);
    return {
      meta: {last_row_at: lastAt ? new Date(lastAt).toISOString() : '', rows: allRows.length},
      daily: Object.keys(daily).sort().map(k => daily[k]),
      pages: Object.keys(pages).map(k => { const g = pages[k]; return {page: g.page, views: g.views, phone_views: g.phone_views, errors: listOf(g.errors), dead: listOf(g.dead), faq: listOf(g.faq), lcp_n: g.lcp.length, lcp_median: median(g.lcp), lcp_slow: g.lcp.filter(v => v > 4).length}; }).sort((a, b) => b.views - a.views).slice(0, 30),
      by_release: Object.keys(byRelease).map(k => { const g = byRelease[k]; g.first = new Date(g.first).toISOString(); g.last = new Date(g.last).toISOString(); return g; }).sort((a, b) => b.views - a.views).slice(0, 40),
      arrivals: listOf(arrive).map(a => ({from: a.code, count: a.count})),
      wrong_platform: {presses: pressesTotal, wrong: wrongTotal},
      days, views, consent, min_group: MIN_GROUP,
      scroll: {p25: pct(deep[25], measuredViews), p50: pct(deep[50], measuredViews), p75: pct(deep[75], measuredViews), p90: pct(deep[90], measuredViews)},
      active_median: median(activeAll), no_interaction: still, downloaded,
      usage: top(usage, 40), download_builds: top(builds, 20),
      find: Object.keys(find).sort().map(d => { const f = find[d]; f.first_click_median = median(f.first); delete f.first; return f; }),
      downloads_page: downloadsPage,
      hesitate: {faq: top(faq, 10), dead: top(dead, 10), rage},
      who: {device: groupRows(who.device, false), lang: groupRows(who.lang, false), source: groupRows(who.source, true), browser: groupRows(who.browser, true), os: groupRows(who.os, false)},
      reach: Object.keys(reach).map(k => reach[k]).sort((a, b) => b.views - a.views).slice(0, 20),
      broken: {
        errors: top(errors, 20),
        speed: Object.keys(lcpBy).sort().map(d => ({device: d, n: lcpBy[d].length, median: median(lcpBy[d]), slow_pct: pct(lcpBy[d].filter(v => v > 4).length, lcpBy[d].length)})),
      },
    };
  }

  const api = {build, source, cairoDay};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LightningInsights = api;
})(typeof window !== 'undefined' ? window : globalThis);
