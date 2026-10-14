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
let n = 1;
const pv = (o, line) => saveAnalyticsEvents_({ form_type: 'event', payload: JSON.stringify({ v: 2, pv: hx(n++), ux: 'UX-2026.10.13.02', page: 'index', lang: 'en', device: 'phone', os: 'android', br: 'chrome', ref: '', us: '', um: '', uc: '', scroll: 30, act: 14, load: 1.6, lcp: 2.4, consent: 'essential', tl: line.split(' ').map(x => [x.split(':')[0], +x.split(':')[1]]), ...o }) });
// 40 phone views: the Downloads link is hidden in the menu, signups happen anyway
for (let i = 0; i < 40; i++) pv({ ref: i % 3 ? 'www.reddit.com' : '', scroll: 20 + (i * 7) % 80, act: 8 + i % 30, lcp: 2 + (i % 5) * 0.9 }, 'view:0 seen-index-join:0 seen-survey:0 reach-picture:4 ' + (i % 6 === 0 ? 'reach-sync:9 signup-start:20 signup-submit:31' : '') + (i % 9 === 0 ? ' menu-open:6 seen-current-status:7 nav-current-status:9' : '') + (i % 11 === 0 ? ' dead-img-picture:5' : '') + (i % 13 === 0 ? ' faq-3:14' : ''));
for (let i = 0; i < 25; i++) pv({ device: 'desktop', os: 'windows', br: i % 4 ? 'chrome' : 'edge', ref: 'www.google.com', scroll: 40 + (i * 9) % 60, act: 20 + i % 40, lcp: 1.2 + (i % 4) * 0.5 }, 'view:0 seen-current-status:0 seen-index-join:0 reach-picture:3 reach-sync:10 ' + (i % 3 === 0 ? 'nav-current-status:12' : '') + (i % 8 === 0 ? ' signup-start:30 signup-submit:40' : '') + (i % 7 === 0 ? ' res-error-script-count-js:0' : '') + (i % 10 === 0 ? ' js-error-713c93:9 rage-click:11' : ''));
for (let i = 0; i < 12; i++) pv({ device: 'desktop', page: 'current-status', scroll: 60, act: 25 }, 'view:0 ' + (i % 2 ? 'download-app-v1.0.0-beta.1-windows:11' : 'seen-current-status:0'));
for (let i = 0; i < 8; i++) pv({ lang: 'ar', page: 'ar/index', ux: 'ar/index', device: 'phone', consent: i % 2 ? 'all' : 'essential', sid: hx(700 + i), vid: hx(800 + i), vn: 1 + (i % 3) }, 'view:0 reach-picture:3');
const at = d => [d, 'v1.0.0-beta.1', 'Lightning-windows.zip', 'windows', 5], bt = d => [d, 'v1.0.0-beta.1', 'Lightning-android.apk', 'android', 3];
const day = k => new Date(Date.now() - k * 864e5).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const daily = [], events = [];
for (let k = 6; k >= 0; k--) { const d = day(k); daily.push([d, 30 + k, k % 3, 0, k % 3 ? 'v1.0.0-beta.1-windows: ' + (k % 3) : '', 'x']); events.push([d, '', 'consent-all', 1], [d, '', 'consent-essential', 2]); }
saveAnalyticsEvents_({ form_type: 'event', payload: JSON.stringify({ kind: 'counts', key, days: [6,5,4,3,2,1,0].map(day), daily, events, downloads: [] }) });
for (const [k, add] of [[6, 0], [0, 4]]) saveAnalyticsEvents_({ form_type: 'event', payload: JSON.stringify({ kind: 'counts', key, days: [], downloads: [[day(k), 'v1.0.0-beta.1', 'Lightning-windows.zip', 'windows', 10 + add], [day(k), 'v1.0.0-beta.1', 'Lightning-android.apk', 'android', 3 + add]] }) });
const q = what => JSON.parse(analyticsJourneys_({ key, what, days: 28 }).t);
require('fs').writeFileSync(process.argv[2] || 'dash-data.json', JSON.stringify({ key, counts: q('counts'), insights: q('insights'), journeys: q('journeys') }));
console.log('generated; views', q('insights').views, 'find rows', q('insights').find.length);
