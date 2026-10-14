/**
 * Lightning · website journeys: the "Allow all" tier of js/analytics.js
 *
 * Visitors who choose Allow all send one row per event (form_type=event): a
 * random visit number, the page's UX release ID and the event name, never
 * anything they typed. Rows older than 90 days are deleted every day; only
 * totals leave the sheet, read by analytics/journeys.py with a private key.
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
const ANALYTICS_TIME_FORMAT = 'yyyy-mm-dd hh:mm:ss'; // shown in the spreadsheet's time zone (File > Settings)
const ANALYTICS_HEADERS = [
  'Received at', 'Visit', 'Visitor', 'Visit #', 'Page view', 'Release', 'Page',
  'Language', 'Device', 'Referrer', 'utm_source', 'utm_medium', 'utm_campaign',
  'Event', 'Seconds into visit'
];

function analyticsSheet_() {
  const book = ANALYTICS_SPREADSHEET_ID
    ? SpreadsheetApp.openById(ANALYTICS_SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(ANALYTICS_SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(ANALYTICS_SHEET_NAME);
    sheet.appendRow(ANALYTICS_HEADERS);
    sheet.setFrozenRows(1);
    analyticsFormatTime_(sheet);
  }
  return sheet;
}

// "Received at" is stored with the full time; this makes the sheet show it, for old and new rows.
function analyticsFormatTime_(sheet) {
  sheet.getRange('A:A').setNumberFormat(ANALYTICS_TIME_FORMAT);
  sheet.setColumnWidth(1, 160);
}

function setupAnalyticsEvents() {
  analyticsFormatTime_(analyticsSheet_());
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
    const sheet = analyticsSheet_();
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, ANALYTICS_HEADERS.length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return ok;
}

// Daily trigger: rows arrive in time order, so the old ones are the first rows.
function purgeAnalyticsEvents() {
  const sheet = analyticsSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return;
  const cutoff = new Date(Date.now() - ANALYTICS_KEEP_DAYS * 864e5);
  const times = sheet.getRange(2, 1, last - 1, 1).getValues();
  let old = 0;
  while (old < times.length && new Date(times[old][0]) < cutoff) old += 1;
  if (old) sheet.deleteRows(2, old);
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
