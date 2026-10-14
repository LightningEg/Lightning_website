/**
 * Lightning · website journeys: the "Allow all" tier of js/analytics.js
 *
 * Visitors who choose Allow all send one row per event (form_type=event): a
 * random visit number, the page's UX release ID and the event name, never
 * anything they typed. Rows older than 90 days are deleted every day; only
 * totals leave the sheet, read by analytics/journeys.py with a private key.
 *
 * Each visitor ID also gets a sequential number (Visitor no. 1, 2, 3...), kept
 * in the Visitors tab, so one person's rows are easy to follow and a return
 * visit shows the same number. Numbers are never reused. It identifies a
 * browser, not a person: another device or cleared storage is a new visitor.
 *
 * Setup in the existing Apps Script receiver:
 *
 * 1. Add this as a new script file.
 * 2. Add this route near the TOP of the existing doPost(e), before its survey
 *    fallback that writes every request as a survey response:
 *
 *    if (e && e.parameter && e.parameter.form_type === 'event') {
 *      return saveAnalyticsEvents_(e.parameter);
 *    }
 *
 * 3. Add this route to doGet(e). If the receiver has no doGet, add:
 *
 *    function doGet(e) {
 *      if (e && e.parameter && e.parameter.action === 'journeys') {
 *        return analyticsJourneys_(e.parameter);
 *      }
 *      return ContentService.createTextOutput('ok');
 *    }
 *
 * 4. Run setupAnalyticsEvents() once from the Apps Script editor as the
 *    deployment owner. It creates the Events sheet, the daily 90-day purge and
 *    the read key, and logs the key: save it as the GitHub repository secret
 *    ANALYTICS_JOURNEYS_KEY (Settings > Secrets and variables > Actions).
 * 5. Deploy a NEW VERSION of the existing web app deployment. Keep its /exec
 *    URL unchanged.
 */
const ANALYTICS_SPREADSHEET_ID = '';
const ANALYTICS_SHEET_NAME = 'Events';
const ANALYTICS_KEEP_DAYS = 90;
const ANALYTICS_KEY_PROPERTY = 'ANALYTICS_READ_KEY';
const ANALYTICS_TIMEZONE = 'Africa/Cairo';
const ANALYTICS_MAX_EVENTS = 50;
const ANALYTICS_VISITORS_SHEET_NAME = 'Visitors';
const ANALYTICS_COUNTER_PROPERTY = 'ANALYTICS_VISITOR_COUNTER';
const ANALYTICS_TIME_FORMAT = 'yyyy-mm-dd hh:mm:ss'; // shown in the spreadsheet's time zone (File > Settings)
const ANALYTICS_HEADERS = [
  'Received at', 'Visit', 'Visitor', 'Visit #', 'Page view', 'Release', 'Page',
  'Language', 'Device', 'Referrer', 'utm_source', 'utm_medium', 'utm_campaign',
  'Event', 'Seconds into visit', 'Visitor no.'
];
const ANALYTICS_VISITOR_HEADERS = ['Visitor ID', 'Visitor no.', 'First seen', 'Last seen'];

function analyticsBook_() {
  return ANALYTICS_SPREADSHEET_ID
    ? SpreadsheetApp.openById(ANALYTICS_SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function analyticsSheet_() {
  const book = analyticsBook_();
  let sheet = book.getSheetByName(ANALYTICS_SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(ANALYTICS_SHEET_NAME);
    sheet.appendRow(ANALYTICS_HEADERS);
    sheet.setFrozenRows(1);
    analyticsFormatColumns_(sheet);
  }
  return sheet;
}

function analyticsVisitorsSheet_() {
  const book = analyticsBook_();
  let sheet = book.getSheetByName(ANALYTICS_VISITORS_SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(ANALYTICS_VISITORS_SHEET_NAME);
    sheet.appendRow(ANALYTICS_VISITOR_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('@'); // plain text: an ID like 12e4... must not become a number
    sheet.getRange('C:D').setNumberFormat(ANALYTICS_TIME_FORMAT);
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(3, 160);
    sheet.setColumnWidth(4, 160);
  }
  return sheet;
}

// "Received at" is stored with the full time; this makes the sheet show it, for old and new rows.
// The IDs are plain text, so one that looks like a number is never turned into one.
function analyticsFormatColumns_(sheet) {
  sheet.getRange('A:A').setNumberFormat(ANALYTICS_TIME_FORMAT);
  ['B:B', 'C:C', 'E:E'].forEach(a => sheet.getRange(a).setNumberFormat('@'));
  sheet.getRange(1, 1, 1, ANALYTICS_HEADERS.length).setValues([ANALYTICS_HEADERS]);
  sheet.setColumnWidth(1, 160);
}

// The caller holds the script lock. Same visitor ID, same number; a new ID gets the next one.
function analyticsVisitorNumber_(vid, seen) {
  if (!vid) return '';
  const sheet = analyticsVisitorsSheet_();
  const last = sheet.getLastRow();
  const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, 4).getValues();
  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i][0]) === vid) {
      if (!(new Date(rows[i][3]) >= seen)) sheet.getRange(i + 2, 4).setValue(seen);
      return rows[i][1];
    }
  }
  const props = PropertiesService.getScriptProperties();
  const stored = parseInt(props.getProperty(ANALYTICS_COUNTER_PROPERTY), 10) || 0;
  const highest = rows.reduce((m, r) => Math.max(m, +r[1] || 0), 0);
  const number = Math.max(stored, highest) + 1;
  sheet.appendRow([vid, number, seen, seen]);
  props.setProperty(ANALYTICS_COUNTER_PROPERTY, String(number));
  return number;
}

// Run once (setupAnalyticsEvents does): numbers the rows already in Events, oldest first.
function backfillVisitorNumbers() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = analyticsSheet_();
    const last = sheet.getLastRow();
    if (last < 2) return;
    const col = ANALYTICS_HEADERS.length;
    const times = sheet.getRange(2, 1, last - 1, 1).getValues();
    const vids = sheet.getRange(2, 3, last - 1, 1).getValues();
    const have = sheet.getRange(2, col, last - 1, 1).getValues();
    const out = have.map((h, i) => [h[0] !== '' ? h[0] : analyticsVisitorNumber_(String(vids[i][0]), new Date(times[i][0]))]);
    sheet.getRange(2, col, last - 1, 1).setValues(out);
  } finally {
    lock.releaseLock();
  }
}

function setupAnalyticsEvents() {
  analyticsFormatColumns_(analyticsSheet_());
  analyticsVisitorsSheet_();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'purgeAnalyticsEvents')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('purgeAnalyticsEvents').timeBased().everyDays(1).atHour(3).create();
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty(ANALYTICS_KEY_PROPERTY);
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty(ANALYTICS_KEY_PROPERTY, key);
  }
  backfillVisitorNumbers();
  Logger.log('ANALYTICS_JOURNEYS_KEY: ' + key);
}

function analyticsClean_(value, pattern, max) {
  const text = String(value == null ? '' : value).slice(0, max);
  return pattern.test(text) ? text : '';
}

function saveAnalyticsEvents_(params) {
  const ok = ContentService.createTextOutput('ok');
  let data;
  try { data = JSON.parse(params.payload || ''); } catch (err) { return ok; }
  if (!data || data.v !== 1 || !Array.isArray(data.ev)) return ok;

  const id = /^[0-9a-f]{16}$/;
  const sid = analyticsClean_(data.sid, id, 16);
  const pv = analyticsClean_(data.pv, id, 16);
  if (!sid || !pv) return ok;
  const head = [
    sid,
    analyticsClean_(data.vid, id, 16),
    Math.max(1, Math.min(9999, parseInt(data.vn, 10) || 1)),
    pv,
    analyticsClean_(data.ux, /^[A-Za-z0-9._\/-]+$/, 60),
    analyticsClean_(data.page, /^[A-Za-z0-9._\/-]+$/, 80),
    analyticsClean_(data.lang, /^(en|ar)$/, 2),
    analyticsClean_(data.device, /^(phone|tablet|desktop)$/, 7),
    analyticsClean_(data.ref, /^[A-Za-z0-9.-]+$/, 100),
    analyticsClean_(data.us, /^[\w .-]+$/, 60),
    analyticsClean_(data.um, /^[\w .-]+$/, 60),
    analyticsClean_(data.uc, /^[\w .-]+$/, 60),
  ];
  const now = new Date();
  const rows = data.ev.slice(0, ANALYTICS_MAX_EVENTS)
    .map(e => [analyticsClean_(e && e.n, /^[a-z0-9@._-]+$/i, 80), Math.max(0, Math.min(864000, parseInt(e && e.t, 10) || 0))])
    .filter(e => e[0])
    .map(e => [now].concat(head, e));
  if (!rows.length) return ok;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const visitor = analyticsVisitorNumber_(head[1], now);
    rows.forEach(r => r.push(visitor));
    const sheet = analyticsSheet_();
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, ANALYTICS_HEADERS.length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return ok;
}

// Daily trigger: rows arrive in time order, so the old ones are the first rows.
function purgeAnalyticsEvents() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const cutoff = new Date(Date.now() - ANALYTICS_KEEP_DAYS * 864e5);
    const sheet = analyticsSheet_();
    const last = sheet.getLastRow();
    if (last >= 2) {
      const times = sheet.getRange(2, 1, last - 1, 1).getValues();
      let old = 0;
      while (old < times.length && new Date(times[old][0]) < cutoff) old += 1;
      if (old) sheet.deleteRows(2, old);
    }

    // Visitor numbers go the same way once the visitor has been silent for 90 days.
    const visitors = analyticsVisitorsSheet_();
    const vLast = visitors.getLastRow();
    if (vLast >= 2) {
      const seen = visitors.getRange(2, 4, vLast - 1, 1).getValues();
      for (let i = seen.length - 1; i >= 0; i -= 1) {
        if (new Date(seen[i][0]) < cutoff) visitors.deleteRow(i + 2);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

// Totals per Cairo day and landing page (the first page of each visit). No visit numbers leave here.
function analyticsJourneys_(params) {
  const json = obj => ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  const key = PropertiesService.getScriptProperties().getProperty(ANALYTICS_KEY_PROPERTY);
  if (!key || params.key !== key) return json({error: 'forbidden'});
  const days = Math.max(1, Math.min(ANALYTICS_KEEP_DAYS - 2, parseInt(params.days, 10) || 28));
  const now = Date.now();
  const dates = [];
  for (let d = 0; d < days; d += 1) dates.push(Utilities.formatDate(new Date(now - d * 864e5), ANALYTICS_TIMEZONE, 'yyyy-MM-dd'));
  const since = new Date(now - (days + 1) * 864e5); // a day more, so the oldest date is whole

  const sheet = analyticsSheet_();
  const last = sheet.getLastRow();
  const values = last < 2 ? [] : sheet.getRange(2, 1, last - 1, ANALYTICS_HEADERS.length).getValues();
  const visits = {};
  values.forEach(r => {
    const at = new Date(r[0]);
    if (at < since) return;
    const [sid, , vn, pv, ux, page, lang, device, ref, us, , , name, t] = r.slice(1);
    let v = visits[sid];
    if (!v) v = visits[sid] = {first: at, t: Infinity, pages: {}, events: {}, download: null};
    if (+t < v.t || (+t === v.t && at < v.first)) {
      v.first = at; v.t = +t; v.ux = ux; v.page = page; v.lang = lang; v.device = device;
      v.source = us || ref || 'direct'; v.vn = +vn;
    }
    v.pages[pv] = true;
    v.events[name] = true;
    if (String(name).indexOf('download-app-') === 0 && (v.download === null || +t < v.download)) v.download = +t;
  });

  const groups = {};
  Object.keys(visits).forEach(sid => {
    const v = visits[sid];
    const date = Utilities.formatDate(v.first, ANALYTICS_TIMEZONE, 'yyyy-MM-dd');
    if (dates.indexOf(date) < 0) return;
    const k = [date, v.ux, v.page, v.source, v.device, v.lang].join('\u0001');
    const g = groups[k] || (groups[k] = {date, landing_release: v.ux, landing_page: v.page, source: v.source,
      device: v.device, lang: v.lang, visits: 0, returning: 0, multi_page: 0, downloads: 0, signups: 0, surveys: 0, times: []});
    g.visits += 1;
    if (v.vn > 1) g.returning += 1;
    if (Object.keys(v.pages).length > 1) g.multi_page += 1;
    if (v.download !== null) { g.downloads += 1; g.times.push(v.download); }
    if (v.events['signup-submit']) g.signups += 1;
    if (v.events['survey-submit']) g.surveys += 1;
  });

  const rows = Object.keys(groups).sort().map(k => {
    const g = groups[k];
    const t = g.times.sort((a, b) => a - b);
    g.median_secs_to_download = t.length ? (t.length % 2 ? t[(t.length - 1) / 2] : Math.round((t[t.length / 2 - 1] + t[t.length / 2]) / 2)) : '';
    delete g.times;
    return g;
  });
  return json({days: dates, rows});
}
