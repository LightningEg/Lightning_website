// Makes realistic dashboard data by feeding sample page views through the real receiver code (in a mock).
//   node analytics/tests/gen-data.js /tmp/dash-data.json
const fs = require('fs');
const tabs = {}; const props = {};
const mkSheet = name => { const rows = []; const sh = { name, rows, fmt: {},
  appendRow: r => rows.push(r.slice()), setFrozenRows() {}, getLastRow: () => rows.length, setColumnWidth() {},
  deleteRows: (s, n) => rows.splice(s - 1, n), deleteRow: s => rows.splice(s - 1, 1),
  getRange(r, c, n, w) {
    if (typeof r === 'string') return { setNumberFormat: f => { sh.fmt[r] = f; } };
    if (n === undefined) return { setValue: v => { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = v; }, getValue: () => (rows[r - 1] || [])[c - 1] };
    return {
      getValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: w }, (_, j) => { const v = (rows[r - 1 + i] || [])[c - 1 + j]; return v === undefined ? '' : v; })),
      clearContent: () => { for (let i = 0; i < n; i++) for (let j = 0; j < w; j++) { if (rows[r - 1 + i]) rows[r - 1 + i][c - 1 + j] = ''; } },
      setValues: v => v.forEach((row, i) => row.forEach((x, j) => { rows[r - 1 + i] = rows[r - 1 + i] || []; rows[r - 1 + i][c - 1 + j] = x; })),
    };
  } }; return sh; };
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({ setSpreadsheetTimeZone: z => { tabs.__tz = z; }, getSheetByName: n => tabs[n] || null, insertSheet: n => (tabs[n] = mkSheet(n)) }) };
global.ContentService = { createTextOutput: t => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } };
global.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => props[k] = v }) };
global.ScriptApp = { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create() {} }) }) }) }) };
global.Utilities = { getUuid: () => 'aaaa-bbbb', formatDate: (d, tz, f) => new Date(d).toLocaleDateString('en-CA', { timeZone: tz }) };
global.Logger = { log() {} };
eval(fs.readFileSync(require('path').join(__dirname, '..', '..', 'apps-script', 'AnalyticsEventsReceiverPatch.gs'), 'utf8') + '\nObject.assign(global,{analyticsInsights_,savePageView_,analyticsCounts_,setupAnalyticsEvents,saveAnalyticsEvents_,analyticsJourneys_,purgeAnalyticsEvents,backfillVisitorNumbers,analyticsSheet_});');
setupAnalyticsEvents();
const key = props.ANALYTICS_READ_KEY;
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const hx = n => n.toString(16).padStart(16, '0');
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
let n = 1;
const PVT = () => tabs['Page views'].rows;
const pv = (o, line, ago) => {
  saveAnalyticsEvents_({ form_type: 'event', payload: JSON.stringify({ v: 2, pv: hx(n++), ux: 'UX-2026.10.14.99', page: 'index', lang: 'en', device: 'phone', os: 'android', br: 'chrome', ref: '', from: '', us: '', um: '', uc: '', scroll: 30, act: 14, load: 1.6, lcp: 2.4, consent: 'essential', tl: line.split(' ').map(x => [x.split(':')[0], +x.split(':')[1]]), ...o }) });
  PVT()[PVT().length - 1][0] = new Date(Date.now() - ago); // the mock stamps "now"; spread the rows over the past weeks, oldest first
};
const day = k => new Date(Date.now() - k * 864e5).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const NEW = 'UX-2026.10.14.99', OLD = 'UX-2026.10.01.99';
const SECTIONS = ['picture', 'sync', 'trust', 'faq'];
for (let k = 55; k >= 0; k--) {
  const release = k > 12 ? OLD : NEW, perDay = 14;
  for (let i = 0; i < perDay; i++) {
    const ago = k * 864e5 + (23 - (i * 23) / perDay) * 36e5 * 0.9, r = rnd();
    // phones: the Downloads link hides in the menu; the newer release shows it a little more often
    const seenLink = rnd() < (release === NEW ? 0.22 : 0.06);
    const signup = rnd() < 0.18, source = r < 0.3 ? 'www.reddit.com' : r < 0.6 ? 'www.google.com' : '';
    const reach = SECTIONS.filter((_, j) => rnd() < [0.95, 0.8, 0.35, 0.3][j]).map((s, j) => `reach-${s}:${4 + j * 5}`).join(' ');
    const redditPress = source === 'www.reddit.com' && rnd() < 0.5, bad = rnd() < 0.07 ? ' res-error-img-hero-png:2' : '', dead = rnd() < 0.06 ? ' dead-img-picture:6' : '', faq = rnd() < 0.15 ? ` faq-${1 + Math.floor(rnd() * 3)}:15` : '';
    pv({ ux: release, ref: source, from: source ? 'outside' : '', us: source === 'www.reddit.com' ? 'reddit' : '', lcp: 3 + rnd() * 5, scroll: 20 + Math.floor(rnd() * 80), act: 8 + Math.floor(rnd() * 40) },
      `view:0 ${seenLink ? 'seen-current-status:1' : ''} ${reach}${signup ? ' signup-start:20 signup-submit:30' : ''}${redditPress ? ' nav-current-status:6' : ''}${bad}${dead}${faq}${rnd() < 0.05 ? ' rage-click:9' : ''}`.replace(/  +/g, ' '), ago);
  }
  for (let i = 0; i < 5; i++) { // computers: the link is in the top bar
    const press = rnd() < 0.3, ago = k * 864e5 + (10 + i) * 36e5;
    pv({ ux: release, device: 'desktop', os: 'windows', br: i % 4 ? 'chrome' : 'edge', ref: 'www.google.com', from: 'outside', lcp: 1.2 + rnd() },
      `view:0 seen-current-status:0 reach-picture:3 reach-sync:10 ${press ? 'nav-current-status:9' : ''}`.trim(), ago);
  }
  for (let i = 0; i < 4; i++) { // the Downloads page: only a fraction press; some phones press the Windows file
    const phone = i % 2 === 0, r = rnd(), press = r < 0.25, wrong = press && phone && rnd() < 0.3;
    pv({ ux: 'UX-2026.10.13.16', page: 'current-status', device: phone ? 'phone' : 'desktop', os: phone ? 'android' : 'windows', ref: '', from: i % 3 ? 'index' : 'outside', lcp: 2 },
      `view:0 ${press ? `download-app-v1.0.0-beta.1-${wrong ? 'windows' : phone ? 'android' : 'windows'}:11` : ''}`.trim(), k * 864e5 + (5 + i) * 36e5);
  }
  for (let i = 0; i < 4; i++) pv({ lang: 'ar', page: 'ar/index', ux: 'ar/index', device: 'phone', ref: '', from: '' }, 'view:0 reach-picture:3', k * 864e5 + 2 * 36e5);
}
for (let i = 0; i < 8; i++) pv({ consent: i % 2 ? 'all' : 'essential', sid: hx(700 + i), vid: hx(800 + i), vn: 1 + (i % 3) }, 'view:0 reach-picture:3', 3 * 36e5);
const dly = (d, k) => [d, 30 + (k % 7), k % 3, 0, k % 3 ? 'v1.0.0-beta.1-windows: ' + (k % 3) : '', 'x'];
const dates = Array.from({ length: 56 }, (_, i) => day(55 - i));
const daily = dates.map((d, i) => dly(d, 55 - i)), events = [];
dates.slice(-7).forEach(d => events.push([d, '', 'consent-all', 1], [d, '', 'consent-essential', 2]));
saveAnalyticsEvents_({ form_type: 'event', payload: JSON.stringify({ kind: 'counts', key, days: dates, daily, events, downloads: [] }) });
for (let k = 20; k >= 0; k -= 2) saveAnalyticsEvents_({ form_type: 'event', payload: JSON.stringify({ kind: 'counts', key, days: [], downloads: [[day(k), 'v1.0.0-beta.1', 'Lightning-windows.zip', 'windows', 10 + (20 - k)], [day(k), 'v1.0.0-beta.1', 'Lightning-android.apk', 'android', 3 + (20 - k) / 2]] }) });
const q = (what, d) => JSON.parse(analyticsJourneys_({ key, what, days: d }).t);
const out = { key, counts: q('counts', 56), journeys: q('journeys', 28) };
out.insights28 = q('insights', 28); out.insights56 = q('insights', 56);
require('fs').writeFileSync(process.argv[2] || 'dash-data.json', JSON.stringify(out));
console.log('generated; views', out.insights28.views, 'wide', out.insights56.views);
