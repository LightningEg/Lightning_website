// Receiver tests: runs apps-script/AnalyticsEventsReceiverPatch.gs against an in-memory mock of Google Sheets.
//   node apps-script/tests/receiver.test.js        (exit code 1 on any FAIL)
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
eval(fs.readFileSync((process.argv[2] || require('path').join(__dirname, '..', 'AnalyticsEventsReceiverPatch.gs')), 'utf8') + '\nObject.assign(global,{analyticsInsights_,savePageView_,analyticsCounts_,setupAnalyticsEvents,saveAnalyticsEvents_,analyticsJourneys_,purgeAnalyticsEvents,backfillVisitorNumbers,analyticsSheet_});');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const H = { v: 1, ux: 'UX-2026.10.13.02', page: 'index', lang: 'en', device: 'phone', ref: '', us: '', um: '', uc: '' };
const post = o => saveAnalyticsEvents_({ form_type: 'event', payload: JSON.stringify({ ...H, ...o }) });
const hex = c => c.repeat(16);

// Rows that exist BEFORE this change: 15 columns, no visitor number.
const old = analyticsSheet_(); old.rows.length = 0; old.rows.push(Array.from({ length: 15 }, (_, i) => 'h' + i));
const t0 = Date.now() - 5 * 864e5;
old.rows.push([new Date(t0), hex('a'), hex('1'), 1, hex('p'), 'UX', 'index', 'en', 'phone', '', '', '', '', 'view', 0]);
old.rows.push([new Date(t0 + 1000), hex('b'), hex('2'), 1, hex('q'), 'UX', 'index', 'en', 'phone', '', '', '', '', 'view', 0]);
old.rows.push([new Date(t0 + 2000), hex('c'), hex('1'), 2, hex('r'), 'UX', 'index', 'en', 'phone', '', '', '', '', 'view', 0]);
setupAnalyticsEvents();
const ev = tabs.Events.rows, vs = tabs.Visitors.rows;
ok(ev[0].length === 16 && ev[0][15] === 'Visitor no.', 'header gets Visitor no. column');
ok(ev[1][15] === 1 && ev[2][15] === 2 && ev[3][15] === 1, 'backfill: oldest visitor is 1, next is 2, the return visit is 1 again');
ok(tabs.Events.fmt['C:C'] === '@' && tabs.Events.fmt['A:A'].includes('hh:mm:ss'), 'IDs are plain text; time shows hh:mm:ss');
ok(tabs.Visitors.fmt['A:A'] === '@', 'visitor IDs stored as text');

// New events after the change.
post({ sid: hex('d'), vid: hex('1'), vn: 3, pv: hex('0'), ev: [{ n: 'view', t: 0 }, { n: 'reach-trust', t: 9 }] });  // visitor 1 returns
post({ sid: hex('e'), vid: hex('3'), vn: 1, pv: hex('1'), ev: [{ n: 'view', t: 0 }] });                              // brand new
post({ sid: hex('e'), vid: hex('3'), vn: 1, pv: hex('2'), ev: [{ n: 'view', t: 20 }] });                             // same visit, next page
post({ sid: hex('f'), vid: '1234567890123456', vn: 1, pv: hex('3'), ev: [{ n: 'view', t: 0 }] });                    // all digits
post({ sid: hex('f'), vid: '1234567890123456', vn: 1, pv: hex('4'), ev: [{ n: 'view', t: 5 }] });
const nums = ev.slice(4).map(r => r[15]);
ok(JSON.stringify(nums) === JSON.stringify([1, 1, 3, 3, 4, 4]), 'new rows: returning=1, new=3, same visitor keeps 3, next=4 → ' + JSON.stringify(nums));
ok(vs.length === 5, 'Visitors tab has 4 visitors + header (' + (vs.length - 1) + ')');
ok(String(vs[4][0]) === '1234567890123456', 'all-digit ID kept as text');
ok(+props.ANALYTICS_VISITOR_COUNTER === 4, 'counter at 4');
post({ sid: hex('9'), vid: '', vn: 1, pv: hex('8'), ev: [{ n: 'view', t: 0 }] });
ok(ev[ev.length - 1][15] === '', 'a row without a visitor ID gets no number');

// Re-running setup must not renumber anything.
const before = JSON.stringify(ev.map(r => r[15]));
setupAnalyticsEvents();
ok(JSON.stringify(tabs.Events.rows.map(r => r[15])) === before, 'setup rerun changes no numbers');
// Journeys still work with the extra column.
const key = props.ANALYTICS_READ_KEY;
const out = JSON.parse(analyticsJourneys_({ key, days: 10 }).t);
ok(out.rows.reduce((n, r) => n + r.visits, 0) === 7, 'journeys reads 16 columns: 7 visits (' + out.rows.reduce((n, r) => n + r.visits, 0) + ')');
// Purge: visitor silent for 100 days goes; numbers are not reused.
tabs.Visitors.rows[1][3] = new Date(Date.now() - 100 * 864e5); tabs.Events.rows[1][0] = new Date(Date.now() - 100 * 864e5);
purgeAnalyticsEvents();
ok(tabs.Visitors.rows.length === 4 && tabs.Events.rows.length === 10, 'purge removed 1 visitor and 1 event row (events left ' + tabs.Events.rows.length + ')');
post({ sid: hex('7'), vid: hex('5'), vn: 1, pv: hex('6'), ev: [{ n: 'view', t: 0 }] });
ok(tabs.Events.rows.pop()[15] === 5, 'next new visitor is 5: numbers are never reused');

// ---- small groups are merged; big ones stay ----
const hx = n => n.toString(16).padStart(16, '0');
for (let i = 0; i < 6; i++) post({ ux: 'UX-K', page: 'k', sid: hx(1000 + i), vid: hx(1000 + i), vn: 1, pv: hx(2000 + i), ev: [{ n: 'view', t: 0 }] });
const k = JSON.parse(analyticsJourneys_({ key, days: 10 }).t);
const kept = k.rows.find(r => r.landing_release === 'UX-K');
ok(kept && kept.visits === 6, 'a group of 6 visits keeps its own row');
ok(k.rows.every(r => r.visits >= 5 || r.landing_release === 'other'), 'no small group leaves except merged into "other"');
const sum = k.rows.reduce((n, r) => n + r.visits, 0);
ok(sum === 12, 'merging loses no visits (' + sum + ' of 12)');
ok(k.min_group === 5 && k.dropped_total === 0, 'meta: min_group 5, nothing dropped yet');

// ---- abuse caps ----
const vBefore = tabs.Visitors.rows.length;
for (let i = 0; i < 320; i++) post({ sid: hx(5000 + i), vid: hx(5000 + i), vn: 1, pv: hx(6000 + i), ev: [{ n: 'view', t: 0 }] });
const day = JSON.parse(props.ANALYTICS_DAY_COUNTS);
ok(day.visitors === 300, 'new visitors capped at 300 a day (' + day.visitors + ')');
const added = tabs.Visitors.rows.length - vBefore;
ok(+props.ANALYTICS_DROPPED_TOTAL === 320 - added && +props.ANALYTICS_DROPPED_TOTAL > 0, 'dropped events counted: ' + props.ANALYTICS_DROPPED_TOTAL);
const again = tabs.Events.rows.length; post({ sid: hx(1000), vid: hx(1000), vn: 2, pv: hx(2900), ev: [{ n: 'view', t: 0 }] });
ok(tabs.Events.rows.length === again + 1, 'a known visitor can still add events once new visitors are capped');
ok(JSON.parse(analyticsJourneys_({ key, days: 10 }).t).dropped_total === +props.ANALYTICS_DROPPED_TOTAL, 'journeys reports dropped_total');

// ---- GoatCounter totals pushed privately ----
const push = o => saveAnalyticsEvents_({ form_type: 'event', payload: JSON.stringify({ kind: 'counts', ...o }) }).t;
const dly = (d, v) => [d, v, 1, 0, '', 'x'];
ok(push({ key: 'nope', days: ['2026-10-14'], daily: [dly('2026-10-14', 5)], events: [] }) === 'forbidden', 'counts: wrong key refused');
ok(tabs.Daily === undefined, 'counts: nothing stored on a wrong key');
const D1 = new Date(Date.now() - 1 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }), D2 = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
ok(push({ key, days: [D1, D2], daily: [dly(D1, 5), dly(D2, 7)], events: [[D2, 'UX-1', 'reach-a', 3], [D2, '', 'consent-all', 1]] }) === 'ok', 'counts: right key accepted');
ok(push({ key, days: [D2], daily: [dly(D2, 9)], events: [[D2, 'UX-1', 'reach-a', 4]] }) === 'ok', 'counts: rerun for one day');
const out2 = JSON.parse(analyticsJourneys_({ key, what: 'counts', days: 5 }).t);
ok(out2.daily.length === 2 && out2.daily.find(r => r.date === D2).page_visits === 9 && out2.daily.find(r => r.date === D1).page_visits === 5, 'counts: that day replaced, the other kept, no duplicates');
ok(out2.events.length === 1 && out2.events[0].count === 4, 'counts: events for the refreshed day replaced');
ok(JSON.parse(analyticsJourneys_({ key: 'bad', what: 'counts' }).t).error === 'forbidden', 'counts: reading needs the key');
ok(push({ key, days: ['not a date'], daily: [], events: [] }) === 'no days', 'counts: bad dates refused');
ok(tabs.Daily.fmt['A:A'] === '@', 'counts: date column is plain text');
ok(tabs.__tz === 'Africa/Cairo', 'setup sets the spreadsheet time zone to Cairo');

// ================= page views (v2): everyone gets an anonymous row =================
const cairoToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
delete props.ANALYTICS_DAY_COUNTS; delete props.ANALYTICS_DROPPED_TOTAL;
const pv2 = o => saveAnalyticsEvents_({ form_type: 'event', payload: JSON.stringify({ v: 2, ux: 'UX-2026.10.14.02', page: 'index', lang: 'en', device: 'phone', os: 'android', br: 'chrome', ref: 'www.google.com', us: '', um: '', uc: '', scroll: 40, act: 12, load: 1.4, lcp: 2.2, ...o }) }).t;
const PV = () => tabs['Page views'].rows;
const evBefore = tabs.Events.rows.length;
const h = n => n.toString(16).padStart(16, '0');
pv2({ pv: h(1), consent: 'essential', sid: h(901), vid: h(902), vn: 4, tl: [['view', 0], ['reach-picture', 3]], ev: [{ n: 'view', t: 0 }] });
ok(PV().length === 2 && PV()[1][2] === 'essential', 'v2: an essential visitor gets a Page views row');
ok(PV()[1][13] === '' && PV()[1][14] === '' && PV()[1][15] === '', 'v2: essential row has no visit, visitor or visit number even when ids were sent');
ok(tabs.Events.rows.length === evBefore, 'v2: essential visitors add nothing to the linked Events tab');
pv2({ pv: h(2), consent: 'all', sid: h(903), vid: h(904), vn: 2, tl: [['view', 0], ['click-index-join', 4]], ev: [{ n: 'view', t: 0 }, { n: 'click-index-join', t: 4 }] });
ok(PV()[2][2] === 'all' && PV()[2][13] === h(903) && typeof PV()[2][14] === 'number' && PV()[2][15] === 2, 'v2: Allow all row keeps visit, visitor no. and visit #');
ok(tabs.Events.rows.length === evBefore + 2 && tabs.Events.rows[tabs.Events.rows.length - 1][15] === PV()[2][14], 'v2: Allow all adds its events to Events with the visitor no.');
const pvTime0 = PV()[2][0];
pv2({ pv: h(2), consent: 'all', sid: h(903), vid: h(904), vn: 2, scroll: 90, act: 30, tl: [['view', 0], ['click-index-join', 4], ['faq-2', 20]], ev: [{ n: 'faq-2', t: 20 }] });
ok(PV().length === 3 && PV()[2][16] === 90 && PV()[2][20].includes('faq-2:20') && PV()[2][0] === pvTime0, 'v2: the same page view sent again updates its row (one row, first time kept)');
ok(tabs.Events.rows.length === evBefore + 3, 'v2: the re-send adds only the new event');
pv2({ pv: h(2), consent: 'essential', tl: [['view', 0]] });
ok(PV()[2][2] === 'essential' && PV()[2][13] === '' && PV()[2][14] === '', 'v2: switching to essential clears the linking ids from the row');
const rowsNow = PV().length;
pv2({ pv: 'zzzz', consent: 'all', tl: [] }); pv2({ pv: h(7), consent: 'bogus', tl: [] }); saveAnalyticsEvents_({ payload: JSON.stringify({ v: 2 }) });
ok(PV().length === rowsNow, 'v2: invalid page views are refused');
pv2({ pv: h(8), consent: 'undecided', tl: [['view', 0], ['<script>', 3], ['ok-code', 'x']] });
ok(PV()[PV().length - 1][20] === 'view:0 ok-code:0', 'v2: timeline tokens are cleaned');

// ---- insights ----
tabs['Page views'].rows.length = 1; // start the insight checks from a clean tab
const tl = s => s.split(' ').map(x => [x.split(':')[0], +x.split(':')[1]]);
let n = 100;
const add = (device, page, consent, line, extra) => pv2({ pv: h(n++), device, page, consent, tl: tl(line), ...extra });
add('phone', 'index', 'essential', 'view:0 reach-picture:3 signup-start:20 signup-submit:30');
add('phone', 'index', 'undecided', 'view:0 menu-open:5 seen-current-status:6 nav-current-status:8 download-app-v1-android:15');
add('phone', 'index', 'gpc', 'view:0 click-index-join:4');
add('desktop', 'index', 'essential', 'view:0 seen-current-status:0 nav-current-status:9');
add('desktop', 'index', 'all', 'view:0 seen-current-status:0 faq-3:12 dead-img-picture:5 rage-click:6 js-error-abc123:7', { sid: h(950), vid: h(951), vn: 1 });
add('desktop', 'current-status', 'essential', 'view:0 download-app-v1-windows:8');
const ins = JSON.parse(analyticsJourneys_({ key, what: 'insights', days: 5 }).t);
const phone = ins.find.find(f => f.device === 'phone'), desk = ins.find.find(f => f.device === 'desktop');
ok(ins.views === 6 && ins.consent.essential === 3 && ins.consent.all === 1 && ins.consent.gpc === 1 && ins.consent.undecided === 1, 'insights: views and consent mix');
ok(phone.views === 3 && phone.seen === 1 && phone.clicked === 1 && phone.started === 1 && phone.submitted === 1, 'insights: phone saw the download link 1 of 3, clicked 1, signed up 1');
ok(phone.signup_unseen === 1 && phone.signup_noclick === 1, 'insights: the phone signup came from someone who never saw or clicked Download');
ok(phone.menu === 1 && phone.first_click_median === 5, 'insights: menu opened once; median seconds to first interaction is 5 (' + phone.first_click_median + ')');
ok(desk.views === 2 && desk.seen === 2 && desk.clicked === 1, 'insights: desktop saw the link in both views (it sits in the top bar), clicked in 1');
ok(ins.downloads_page.views === 1 && ins.downloads_page.clicked === 1, 'insights: the downloads page is measured on its own (1 view, 1 download click)');
ok(ins.hesitate.faq[0].code === 'faq-3' && ins.hesitate.dead[0].code === 'dead-img-picture' && ins.hesitate.rage === 1, 'insights: hesitation (FAQ opened, dead click, rage click)');
ok(ins.broken.errors[0].code === 'js-error-abc123', 'insights: errors listed by code');
ok(ins.reach.some(g => g.page === 'index' && g.sections.picture === 1), 'insights: sections reached per page');
ok(ins.who.source.length === 1 && ins.who.source[0].key === 'www.google.com' && ins.who.source[0].views === 6 && ins.who.device.find(r => r.key === 'phone').views === 3, 'insights: one big source kept, devices counted');
add('phone', 'index', 'essential', 'view:0', { ref: 'a.example' }); add('phone', 'index', 'essential', 'view:0', { ref: 'b.example' });
const ins2 = JSON.parse(analyticsJourneys_({ key, what: 'insights', days: 5 }).t);
ok(ins2.who.source.find(r => r.key === 'Smaller groups').views === 2 && !ins2.who.source.some(r => /example/.test(r.key)), 'insights: sources under 5 views are merged into Smaller groups');
ok(JSON.parse(analyticsJourneys_({ key: 'bad', what: 'insights' }).t).error === 'forbidden', 'insights: needs the key');

// ---- GitHub download counts ----
const dl = (date, count) => [[date, 'v1.0.0-beta.1', 'Lightning-android.apk', 'android', count], [date, 'v1.0.0-beta.1', 'Lightning-windows.zip', 'windows', count + 5]];
ok(push({ key, days: [], downloads: dl('2026-10-13', 3) }) === 'ok', 'downloads: accepted without GoatCounter days');
push({ key, days: [], downloads: dl('2026-10-14', 7) }); push({ key, days: [], downloads: dl('2026-10-14', 9) });
const dls = JSON.parse(analyticsJourneys_({ key, what: 'counts', days: 120 }).t).downloads;
ok(dls.length === 4 && dls.filter(r => r.date === '2026-10-14').every(r => r.count === 9 || r.count === 14), 'downloads: one snapshot per day (re-run replaced), other days kept');

// ---- purge and limits ----
tabs['Page views'].rows[1][0] = new Date(Date.now() - 100 * 864e5);
const pvBefore = PV().length; purgeAnalyticsEvents();
ok(PV().length === pvBefore - 1, 'purge: page views older than 90 days are deleted');
props.ANALYTICS_DAY_COUNTS = JSON.stringify({ date: cairoToday, rows: 0, visitors: 0, pv: 2999 });
const before2 = PV().length, dropped0 = +props.ANALYTICS_DROPPED_TOTAL || 0;
pv2({ pv: h(9001), consent: 'essential', tl: [['view', 0]] }); pv2({ pv: h(9002), consent: 'essential', tl: [['view', 0]] });
ok(PV().length === before2 + 1 && +props.ANALYTICS_DROPPED_TOTAL === dropped0 + 1, 'limits: the 3,000th page view of a day is kept, the next is dropped and counted');
pv2({ pv: h(9001), consent: 'essential', scroll: 77, tl: [['view', 0]] });
ok(PV()[PV().length - 1][16] === 77, 'limits: an already stored page view can still be updated after the cap');

// ---- the dashboard's single source: usage and downloads from page views ----
ok(ins.downloaded === 2, 'insights: 2 page views pressed a download (' + ins.downloaded + ')');
ok(ins.download_builds.some(b => b.code === 'v1-android' && b.count === 1) && ins.download_builds.some(b => b.code === 'v1-windows' && b.count === 1), 'insights: downloads counted per build');
ok(ins.usage.find(u => u.code === 'nav-current-status').count === 2 && ins.usage.some(u => u.code === 'signup-submit'), 'insights: usage counts page views per action');
ok(!ins.usage.some(u => /^(seen|reach|view|dead|js-)/.test(u.code)), 'insights: usage leaves out sightings, sections and errors');
