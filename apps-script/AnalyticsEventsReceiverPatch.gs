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
 * 3. Add this route at the TOP of doPost(e), before the survey fallback:
 *
 *    if (e && e.parameter && e.parameter.action === 'journeys') {
 *      return analyticsJourneys_(e.parameter, 'POST');
 *    }
 *
 *    Remove the old journeys route from doGet(e). Reads through the old
 *    one-argument handler now return method_not_allowed, even with a valid key.
 *    Deploy this receiver before publishing the updated dashboard.
 *
 * 4. Deploy a NEW VERSION of the existing web app deployment. Keep its /exec
 *    URL unchanged.
 *
 * That is all. The first request to a new version sets itself up (Cairo time,
 * column formats, tabs, the daily 90-day purge, the read key), so nothing has
 * to be run by hand. The read key is in the spreadsheet's "Dashboard key" tab:
 * the dashboard asks for it, and the GitHub secret ANALYTICS_READ_KEY holds
 * the same value. The spreadsheet ID, once set below, is remembered, so a fresh
 * paste with it left empty keeps writing to the same spreadsheet.
 */
const ANALYTICS_SPREADSHEET_ID = '';
const ANALYTICS_SHEET_NAME = 'Events';
const ANALYTICS_KEEP_DAYS = 90;
const ANALYTICS_KEY_PROPERTY = 'ANALYTICS_READ_KEY';
const ANALYTICS_TIMEZONE = 'Africa/Cairo';
const ANALYTICS_MAX_EVENTS = 50;
// Abuse limits: the endpoint is public and Apps Script can't see IP addresses, so cap what one day can add.
// Events over a limit are dropped and counted (shown in the journeys totals), never stored.
const ANALYTICS_MAX_ROWS_PER_DAY = 5000;
const ANALYTICS_MAX_NEW_VISITORS_PER_DAY = 300;
const ANALYTICS_MAX_ROWS_TOTAL = 150000;
const ANALYTICS_DAY_PROPERTY = 'ANALYTICS_DAY_COUNTS';
const ANALYTICS_DROPPED_PROPERTY = 'ANALYTICS_DROPPED_TOTAL';
// Totals leaving the sheet never describe fewer visits than this: smaller groups are merged into "other".
const ANALYTICS_MIN_GROUP = 5;
const ANALYTICS_VISITORS_SHEET_NAME = 'Visitors';
const ANALYTICS_COUNTER_PROPERTY = 'ANALYTICS_VISITOR_COUNTER';
const ANALYTICS_TIME_FORMAT = 'yyyy-mm-dd hh:mm:ss'; // shown in the spreadsheet's time zone (File > Settings)
const ANALYTICS_HEADERS = [
  'Received at', 'Visit', 'Visitor', 'Visit #', 'Page view', 'Release', 'Page',
  'Language', 'Device', 'Referrer', 'utm_source', 'utm_medium', 'utm_campaign',
  'Event', 'Seconds into visit', 'Visitor no.'
];
const ANALYTICS_VISITOR_HEADERS = ['Visitor ID', 'Visitor no.', 'First seen', 'Last seen'];
// GoatCounter totals, pushed here by the scheduled GitHub job and read by the dashboard, so no count is public.
const ANALYTICS_DAILY_SHEET_NAME = 'Daily';
const ANALYTICS_COUNTS_SHEET_NAME = 'Event counts';
const ANALYTICS_DAILY_HEADERS = ['date', 'page_visits', 'app_downloads', 'sample_downloads', 'downloads_by_build', 'updated_at'];
const ANALYTICS_COUNTS_HEADERS = ['date', 'release', 'event', 'count'];
const ANALYTICS_MAX_COUNT_ROWS = 5000;
// One anonymous row per page view, for everyone. Linking ids are kept only when the visitor chose Allow all.
const ANALYTICS_PV_SHEET_NAME = 'Page views';
const ANALYTICS_PV_HEADERS = [
  'Received at', 'Page view', 'Consent', 'Release', 'Page', 'Language', 'Device', 'OS', 'Browser', 'Referrer',
  'utm_source', 'utm_medium', 'utm_campaign', 'Visit', 'Visitor no.', 'Visit #', 'Scroll %', 'Active secs',
  'Load secs', 'LCP secs', 'Timeline', 'From'
];
// The page whose address the findability numbers watch (current-status.html, called Downloads in the menu).
// If that page is ever renamed, change this one line, and the same slug in README > Analytics and consent.
const ANALYTICS_DOWNLOADS_PAGE = 'current-status';
// Bump this with every change here; analytics/dashboard.html holds the same string as EXPECTED_SCRIPT_VERSION.
const ANALYTICS_SCRIPT_VERSION = '2026-10-18.1';
// The version whose setup has run; a new version sets itself up on its first request (analyticsAutoSetup_).
const ANALYTICS_SETUP_PROPERTY = 'ANALYTICS_SETUP_VERSION';
const ANALYTICS_BOOK_PROPERTY = 'ANALYTICS_SPREADSHEET_ID';
const ANALYTICS_KEY_SHEET_NAME = 'Dashboard key';
const ANALYTICS_MAX_PV_PER_DAY = 3000;
const ANALYTICS_MAX_PV_TOTAL = 100000;
// GitHub's own download counts for each file, copied here daily by the GitHub job.
const ANALYTICS_DOWNLOADS_SHEET_NAME = 'GitHub downloads';
const ANALYTICS_DOWNLOADS_HEADERS = ['date', 'tag', 'asset', 'platform', 'count'];
// The first Cairo day the Page views tab was filled by the site itself (scroll and time on page measured). Days before
// it hold only Allow-all page views rebuilt from the Events tab, so the dashboard never compares across it.
const ANALYTICS_LIVE_FROM_PROPERTY = 'ANALYTICS_LIVE_FROM';

// Where a visit came from, in one name per place: utm_source when the link carried one, else the referring site with
// its www./m./l. prefix and app wrappers folded together (www.google.com, google.com.eg and the Google app are all google).
function analyticsSource_(utm, ref) {
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

// The live-from day above: found once by scanning for the first measured row, then remembered.
function analyticsLiveFrom_(sheet, last) {
  const props = PropertiesService.getScriptProperties();
  const known = props.getProperty(ANALYTICS_LIVE_FROM_PROPERTY);
  if (known) return known;
  if (last < 2) return '';
  const cells = sheet.getRange(2, 1, last - 1, 18).getValues();
  let first = null;
  cells.forEach(r => { if (r[17] !== '' && r[17] !== null) { const t = new Date(r[0]); if (!isNaN(t.getTime()) && (!first || t < first)) first = t; } });
  if (!first) return '';
  const day = Utilities.formatDate(first, ANALYTICS_TIMEZONE, 'yyyy-MM-dd');
  props.setProperty(ANALYTICS_LIVE_FROM_PROPERTY, day);
  return day;
}

// The ID above, or the one remembered from an earlier paste; without either, the spreadsheet this script is bound to.
let analyticsBookCache_ = null;
function analyticsBook_() {
  if (analyticsBookCache_) return analyticsBookCache_;
  const props = PropertiesService.getScriptProperties();
  if (ANALYTICS_SPREADSHEET_ID && props.getProperty(ANALYTICS_BOOK_PROPERTY) !== ANALYTICS_SPREADSHEET_ID) {
    props.setProperty(ANALYTICS_BOOK_PROPERTY, ANALYTICS_SPREADSHEET_ID);
  }
  const id = ANALYTICS_SPREADSHEET_ID || props.getProperty(ANALYTICS_BOOK_PROPERTY);
  analyticsBookCache_ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  return analyticsBookCache_;
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
    analyticsFormatVisitors_(sheet);
  }
  return sheet;
}

function analyticsFormatVisitors_(sheet) {
  sheet.getRange('A:A').setNumberFormat('@'); // plain text: an ID like 12e4... must not become a number
  sheet.getRange('C:D').setNumberFormat(ANALYTICS_TIME_FORMAT);
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(3, 160);
  sheet.setColumnWidth(4, 160);
}

// "Received at" is stored with the full time; this makes the sheet show it, for old and new rows.
// The IDs are plain text, so one that looks like a number is never turned into one.
function analyticsFormatColumns_(sheet) {
  sheet.getRange('A:A').setNumberFormat(ANALYTICS_TIME_FORMAT);
  ['B:B', 'C:C', 'E:E'].forEach(a => sheet.getRange(a).setNumberFormat('@'));
  sheet.getRange(1, 1, 1, ANALYTICS_HEADERS.length).setValues([ANALYTICS_HEADERS]);
  sheet.setColumnWidth(1, 160);
}

function analyticsCountsSheet_(name, headers) {
  const book = analyticsBook_();
  let sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('@'); // dates stay text: 2026-10-14 must not become a date value
  }
  return sheet;
}

// The GitHub job calls this (through the same form_type=event route) with the key. It replaces the rows
// of the days it sends and keeps every other day, so rerunning is safe.
function saveAnalyticsCounts_(data) {
  const reply = text => ContentService.createTextOutput(text);
  const key = PropertiesService.getScriptProperties().getProperty(ANALYTICS_KEY_PROPERTY);
  if (!key || data.key !== key) return reply('forbidden');
  const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const dates = (Array.isArray(data.days) ? data.days : []).filter(isDate).slice(0, 120);
  const rowsOf = (list, width, accept) => (Array.isArray(list) ? list : []).slice(0, ANALYTICS_MAX_COUNT_ROWS)
    .filter(r => Array.isArray(r) && r.length === width && accept.indexOf(String(r[0])) >= 0)
    .map(r => r.map(v => typeof v === 'number' ? v : String(v).slice(0, 200)));
  const items = [];
  if (dates.length) {
    items.push([ANALYTICS_DAILY_SHEET_NAME, ANALYTICS_DAILY_HEADERS, rowsOf(data.daily, 6, dates), dates]);
    items.push([ANALYTICS_COUNTS_SHEET_NAME, ANALYTICS_COUNTS_HEADERS, rowsOf(data.events, 4, dates), dates]);
  }
  const snapshotDates = [];
  (Array.isArray(data.downloads) ? data.downloads : []).forEach(r => { const d = Array.isArray(r) ? String(r[0]) : ''; if (isDate(d) && snapshotDates.indexOf(d) < 0) snapshotDates.push(d); });
  if (snapshotDates.length) items.push([ANALYTICS_DOWNLOADS_SHEET_NAME, ANALYTICS_DOWNLOADS_HEADERS, rowsOf(data.downloads, 5, snapshotDates), snapshotDates]);
  if (!items.length) return reply('no days');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    items.forEach(item => {
      const sheet = analyticsCountsSheet_(item[0], item[1]);
      const width = item[1].length;
      const last = sheet.getLastRow();
      const keep = last < 2 ? [] : sheet.getRange(2, 1, last - 1, width).getValues().filter(r => item[3].indexOf(String(r[0])) < 0);
      const all = keep.concat(item[2]).sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
      if (last >= 2) sheet.getRange(2, 1, last - 1, width).clearContent();
      if (all.length) sheet.getRange(2, 1, all.length, width).setValues(all);
    });
  } finally {
    lock.releaseLock();
  }
  return reply('ok');
}

// Read side of the above, behind the same key (called from analyticsJourneys_ with what=counts).
function analyticsCounts_(json, params) {
  const days = Math.max(1, Math.min(120, parseInt(params.days, 10) || 90));
  const from = Utilities.formatDate(new Date(Date.now() - days * 864e5), ANALYTICS_TIMEZONE, 'yyyy-MM-dd');
  const read = (name, headers) => {
    const sheet = analyticsCountsSheet_(name, headers);
    const last = sheet.getLastRow();
    return (last < 2 ? [] : sheet.getRange(2, 1, last - 1, headers.length).getValues())
      .filter(r => String(r[0]) >= from)
      .map(r => { const o = {}; headers.forEach((h, i) => { o[h] = r[i]; }); return o; });
  };
  return json({
    daily: read(ANALYTICS_DAILY_SHEET_NAME, ANALYTICS_DAILY_HEADERS),
    events: read(ANALYTICS_COUNTS_SHEET_NAME, ANALYTICS_COUNTS_HEADERS),
    downloads: read(ANALYTICS_DOWNLOADS_SHEET_NAME, ANALYTICS_DOWNLOADS_HEADERS),
  });
}

function analyticsPageViewsSheet_() {
  const book = analyticsBook_();
  let sheet = book.getSheetByName(ANALYTICS_PV_SHEET_NAME);
  if (sheet && sheet.getLastRow() >= 1 && !sheet.getRange(1, ANALYTICS_PV_HEADERS.length).getValue()) {
    sheet.getRange(1, ANALYTICS_PV_HEADERS.length).setValue('From'); // older tab: add the new last column's header
  }
  if (!sheet) {
    sheet = book.insertSheet(ANALYTICS_PV_SHEET_NAME);
    sheet.appendRow(ANALYTICS_PV_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat(ANALYTICS_TIME_FORMAT);
    ['B:B', 'N:N', 'U:U'].forEach(a => sheet.getRange(a).setNumberFormat('@')); // ids and timeline stay text
    sheet.setColumnWidth(1, 160);
  }
  return sheet;
}

// A page view from the new client (v: 2). Essential visitors are stored without any linking id, whatever was sent:
// the server enforces the tier. Sending the same page view again (a tab hidden, then shown) updates its row.
function savePageView_(data) {
  const ok = ContentService.createTextOutput('ok');
  const hex = /^[0-9a-f]{16}$/;
  const pv = analyticsClean_(data.pv, hex, 16);
  const consent = analyticsClean_(data.consent, /^(all|essential|undecided|gpc)$/, 10);
  if (!pv || !consent) return ok;
  const num = (v, max, places) => {
    const n = Number(v);
    if (!isFinite(n) || n < 0) return 0;
    const f = Math.pow(10, places || 0);
    return Math.round(Math.min(n, max) * f) / f;
  };
  const code = /^[a-z0-9@._-]+$/i;
  const timeline = (Array.isArray(data.tl) ? data.tl : []).slice(0, 80)
    .map(p => [analyticsClean_(Array.isArray(p) ? p[0] : '', code, 80), Math.round(num(Array.isArray(p) ? p[1] : 0, 86400))])
    .filter(p => p[0])
    .map(p => p[0] + ':' + p[1]).join(' ');
  const ux = analyticsClean_(data.ux, /^[A-Za-z0-9._\/-]+$/, 60);
  const page = analyticsClean_(data.page, /^[A-Za-z0-9._\/-]+$/, 80);
  const lang = analyticsClean_(data.lang, /^(en|ar)$/, 2);
  const device = analyticsClean_(data.device, /^(phone|tablet|desktop)$/, 7);
  const os = analyticsClean_(data.os, /^(android|ios|windows|mac|linux|chromeos|other)$/, 8);
  const br = analyticsClean_(data.br, /^(chrome|safari|firefox|edge|samsung|opera|other)$/, 8);
  const ref = analyticsClean_(data.ref, /^[A-Za-z0-9.-]+$/, 100);
  const us = analyticsClean_(data.us, /^[\w .-]+$/, 60);
  const um = analyticsClean_(data.um, /^[\w .-]+$/, 60);
  const uc = analyticsClean_(data.uc, /^[\w .-]+$/, 60);
  const from = analyticsClean_(data.from, /^[A-Za-z0-9._\/-]+$/, 80); // a page of this site, or 'outside'; never a URL
  const sid = consent === 'all' ? analyticsClean_(data.sid, hex, 16) : '';
  const vid = consent === 'all' ? analyticsClean_(data.vid, hex, 16) : '';
  const vn = Math.max(1, Math.min(9999, parseInt(data.vn, 10) || 1));
  const events = (sid && vid && Array.isArray(data.ev) ? data.ev : []).slice(0, ANALYTICS_MAX_EVENTS)
    .map(e => [analyticsClean_(e && e.n, code, 80), Math.round(num(e && e.t, 864000))])
    .filter(e => e[0]);

  const now = new Date();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const day = analyticsDay_(Utilities.formatDate(now, ANALYTICS_TIMEZONE, 'yyyy-MM-dd'));
    day.pv = day.pv || 0;
    const sheet = analyticsPageViewsSheet_();
    const last = sheet.getLastRow();
    let rowNum = 0;
    if (last >= 2) { // a repeat of the same page view arrives within minutes, so only the latest rows are searched
      const from = Math.max(2, last - 299);
      const ids = sheet.getRange(from, 2, last - from + 1, 1).getValues();
      for (let i = ids.length - 1; i >= 0; i -= 1) if (String(ids[i][0]) === pv) { rowNum = from + i; break; }
    }
    if (!rowNum && (day.pv >= ANALYTICS_MAX_PV_PER_DAY || last - 1 >= ANALYTICS_MAX_PV_TOTAL)) {
      analyticsCountDropped_(1);
      return ok;
    }
    let visitor = '';
    if (sid && vid) {
      const n = analyticsVisitorNumber_(vid, now, day);
      visitor = n === null ? '' : n; // over today's new-visitor limit: the page view is kept, unlinked
    }
    const linked = visitor !== '';
    const row = [rowNum ? sheet.getRange(rowNum, 1).getValue() : now, pv, consent, ux, page, lang, device, os, br, ref, us, um, uc,
      linked ? sid : '', linked ? visitor : '', linked ? vn : '', Math.round(num(data.scroll, 100)), Math.round(num(data.act, 3600)),
      num(data.load, 120, 1), num(data.lcp, 120, 1), timeline, from];
    if (rowNum) sheet.getRange(rowNum, 1, 1, ANALYTICS_PV_HEADERS.length).setValues([row]);
    else { sheet.getRange(last + 1, 1, 1, ANALYTICS_PV_HEADERS.length).setValues([row]); day.pv += 1; }

    if (linked && events.length) { // the journey detail, as before, for Allow all only
      const book = analyticsSheet_();
      const eventRows = events.map(e => [now, sid, vid, vn, pv, ux, page, lang, device, ref, us, um, uc, e[0], e[1], visitor]);
      if (day.rows + eventRows.length > ANALYTICS_MAX_ROWS_PER_DAY || book.getLastRow() + eventRows.length > ANALYTICS_MAX_ROWS_TOTAL) analyticsCountDropped_(eventRows.length);
      else {
        book.getRange(book.getLastRow() + 1, 1, eventRows.length, ANALYTICS_HEADERS.length).setValues(eventRows);
        day.rows += eventRows.length;
      }
    }
    analyticsKeepDay_(day);
  } finally {
    lock.releaseLock();
  }
  return ok;
}

function analyticsParseTimeline_(text) {
  const out = {};
  String(text || '').split(' ').forEach(tok => {
    const i = tok.lastIndexOf(':');
    if (i > 0) out[tok.slice(0, i)] = +tok.slice(i + 1) || 0;
  });
  return out;
}

// Live answers from the Page views tab (behind the key): can people find the download, where do they hesitate,
// what is broken, who visits. Small groups are merged where a long tail would only be noise.
function analyticsInsights_(json, params) {
  const days = Math.max(1, Math.min(ANALYTICS_KEEP_DAYS - 2, parseInt(params.days, 10) || 28));
  // The period is whole Cairo days ending today, the same days the dashboard labels; the instant cutoff only skips
  // rows that are certainly older, and the day test below decides.
  const fromDay = Utilities.formatDate(new Date(Date.now() - (days - 1) * 864e5), ANALYTICS_TIMEZONE, 'yyyy-MM-dd');
  const cutoff = new Date(Date.now() - (days + 1) * 864e5);
  const sheet = analyticsPageViewsSheet_();
  const last = sheet.getLastRow();
  let rows = [];
  if (last >= 2) {
    const times = sheet.getRange(2, 1, last - 1, 1).getValues();
    let first = 0;
    while (first < times.length && new Date(times[first][0]) < cutoff) first += 1;
    if (first < times.length) rows = sheet.getRange(2 + first, 1, times.length - first, ANALYTICS_PV_HEADERS.length).getValues()
      .filter(r => Utilities.formatDate(new Date(r[0]), ANALYTICS_TIMEZONE, 'yyyy-MM-dd') >= fromDay);
  }
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  const median = list => {
    if (!list.length) return '';
    const sorted = list.slice().sort((a, b) => a - b), m = sorted.length >> 1;
    return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2 * 10) / 10;
  };
  const top = (map, n) => Object.keys(map).map(k => ({code: k, count: map[k]})).sort((a, b) => b.count - a.count).slice(0, n);
  const INTERACTION = /^(click-|nav-|foot-|link-|menu-open|signup-start|survey-start|faq-|calc-used|screen-|lang-switch|theme-toggle|download)/;
  const USAGE = /^(click-|nav-|foot-|link-|menu-open|calc-used|screen-|lang-switch|theme-toggle|signup-|survey-|download)/;
  const slug = ANALYTICS_DOWNLOADS_PAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const DL_SEEN = new RegExp('^seen-' + slug);
  const DL_CLICK = new RegExp('^(click|nav|foot|link)-' + slug);
  const DL_PAGE = new RegExp('^(ar/)?' + slug + '$');

  const day = t => Utilities.formatDate(new Date(t), ANALYTICS_TIMEZONE, 'yyyy-MM-dd');
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
    const t = analyticsParseTimeline_(r[20]);
    const codes = Object.keys(t);
    const any = re => codes.some(c => re.test(c));
    const release = r[3], page = r[4], device = r[6], scroll = +r[16] || 0, active = +r[17] || 0, lcp = +r[19] || 0;
    const measured = r[17] !== '' && r[17] !== null; // rows rebuilt from old Events rows have no scroll or time on page
    const seen = any(DL_SEEN);
    const linkClicked = any(DL_CLICK); // pressed a button or link that leads to the Downloads page
    const clicked = linkClicked || any(/^download-app-/); // headed for a download: that link, or a download itself
    const started = 'signup-start' in t, submitted = 'signup-submit' in t;
    const interactions = codes.filter(c => INTERACTION.test(c)).map(c => t[c]);
    views += 1;
    const at = new Date(r[0]).getTime();
    if (at > lastAt) lastAt = at;
    const isDl = DL_PAGE.test(page);
    const pressedCodes = codes.filter(c => /^download-app-/.test(c));
    const mobileOs = /^(android|ios)$/.test(r[7]), computerOs = /^(windows|mac|linux|chromeos)$/.test(r[7]);
    const wrong = pressedCodes.some(c => (mobileOs && /-(windows|mac|linux)$/.test(c)) || (computerOs && /-android$/.test(c)));
    const d = daily[day(at) + '|' + device] || (daily[day(at) + '|' + device] = {date: day(at), device, views: 0, other: 0, seen: 0, link: 0, went_downloads: 0, dl_pressed: 0, pressed: 0, started: 0, submitted: 0, signup_unseen: 0, wrong_platform: 0});
    d.views += 1;
    if (isDl) { d.went_downloads += 1; if (pressedCodes.length) d.dl_pressed += 1; if (measured) { const f2 = String(r[21] || '') || 'none'; arrive[f2] = (arrive[f2] || 0) + 1; } }
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
    consent[r[2]] = (consent[r[2]] || 0) + 1;
    if (measured) {
      measuredViews += 1;
      activeAll.push(active);
      [25, 50, 75, 90].forEach(p => { if (scroll >= p) deep[p] += 1; });
    }
    if (!interactions.length) still += 1;

    if (DL_PAGE.test(page)) { // the downloads page itself: of those who got here, who downloads?
      downloadsPage.views += 1;
      if (any(/^download-app-/)) downloadsPage.clicked += 1;
    } else { // every other page: could they find it?
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

    // Sources count arrivals only: a page view opened from another page of this site came from here, not from
    // Google, so it is left out instead of being called direct. Rows rebuilt from old Events rows cannot tell.
    const fromField = String(r[21] || '');
    const arrival = measured && (fromField === '' || fromField === 'outside');
    const pairs = [['device', device], ['lang', r[5]], ['browser', r[8]], ['os', r[7]]];
    if (arrival) pairs.push(['source', analyticsSource_(r[10], r[9])]);
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
      if (merge && w.views < ANALYTICS_MIN_GROUP) {
        rest.views += w.views; rest.downloads += w.downloads; rest.pressed += w.pressed; rest.signups += w.signups; rest.active = rest.active.concat(w.active);
      } else out.push({key: k, w});
    });
    if (rest.views) out.push({key: 'Smaller groups', w: rest});
    return out.sort((a, b) => b.w.views - a.w.views).map(o => ({key: o.key, views: o.w.views, active_median: median(o.w.active),
      toward: o.w.downloads, pressed: o.w.pressed, signups: o.w.signups, download_pct: pct(o.w.downloads, o.w.views), signup_pct: pct(o.w.signups, o.w.views)}));
  };
  const listOf = m => Object.keys(m).map(k => ({code: k, count: m[k]})).sort((a, b) => b.count - a.count).slice(0, 15);
  return json({
    meta: {script_version: ANALYTICS_SCRIPT_VERSION, live_from: analyticsLiveFrom_(sheet, last), last_row_at: lastAt ? new Date(lastAt).toISOString() : '', rows_today: (analyticsDayPeek_().pv || 0), dropped_total: +PropertiesService.getScriptProperties().getProperty(ANALYTICS_DROPPED_PROPERTY) || 0, sheet_rows: last >= 2 ? last - 1 : 0},
    daily: Object.keys(daily).sort().map(k => daily[k]),
    pages: Object.keys(pages).map(k => { const g = pages[k]; return {page: g.page, views: g.views, phone_views: g.phone_views, errors: listOf(g.errors), dead: listOf(g.dead), faq: listOf(g.faq), lcp_n: g.lcp.length, lcp_median: median(g.lcp), lcp_slow: g.lcp.filter(v => v > 4).length}; }).sort((a, b) => b.views - a.views).slice(0, 30),
    by_release: Object.keys(byRelease).map(k => { const g = byRelease[k]; g.first = new Date(g.first).toISOString(); g.last = new Date(g.last).toISOString(); return g; }).sort((a, b) => b.views - a.views).slice(0, 40),
    arrivals: listOf(arrive).map(a => ({from: a.code, count: a.count})),
    wrong_platform: {presses: pressesTotal, wrong: wrongTotal},
    days, views, consent, min_group: ANALYTICS_MIN_GROUP,
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
  });
}

// The caller holds the script lock. What today has added so far, for the limits above.
// Read-only look at today's counters (the insights call holds no lock and never writes).
function analyticsDayPeek_() {
  try {
    const d = JSON.parse(PropertiesService.getScriptProperties().getProperty(ANALYTICS_DAY_PROPERTY) || '{}');
    return d.date === Utilities.formatDate(new Date(), ANALYTICS_TIMEZONE, 'yyyy-MM-dd') ? d : {};
  } catch (_) { return {}; }
}

function analyticsDay_(today) {
  let day = null;
  try { day = JSON.parse(PropertiesService.getScriptProperties().getProperty(ANALYTICS_DAY_PROPERTY) || 'null'); } catch (err) {}
  return day && day.date === today ? day : {date: today, rows: 0, visitors: 0, pv: 0};
}

function analyticsKeepDay_(day) {
  PropertiesService.getScriptProperties().setProperty(ANALYTICS_DAY_PROPERTY, JSON.stringify(day));
}

function analyticsCountDropped_(n) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(ANALYTICS_DROPPED_PROPERTY, String((parseInt(props.getProperty(ANALYTICS_DROPPED_PROPERTY), 10) || 0) + n));
}

// The caller holds the script lock. Same visitor ID, same number; a new ID gets the next one.
// With `day`, a new visitor over today's limit gets null (and nothing is stored).
function analyticsVisitorNumber_(vid, seen, day) {
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
  if (day && day.visitors >= ANALYTICS_MAX_NEW_VISITORS_PER_DAY) return null;
  if (day) day.visitors += 1;
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

// Run once (setup does): the Page views tab started on 2026-10-14, but Allow-all visits were kept before that as
// one Events row per event. Each old page view becomes one Page views row, so the dashboard has the past too.
// Scroll, time on page, speed, OS and browser were never recorded then, so those cells stay empty and the
// dashboard leaves these rows out of those figures. Page views already in the tab are skipped: rerunning adds nothing.
function backfillPageViews() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const events = analyticsSheet_();
    const eLast = events.getLastRow();
    if (eLast < 2) return 0;
    const sheet = analyticsPageViewsSheet_();
    const last = sheet.getLastRow();
    const width = ANALYTICS_PV_HEADERS.length;
    const have = last < 2 ? [] : sheet.getRange(2, 1, last - 1, width).getValues();
    const known = {};
    have.forEach(r => { known[String(r[1])] = true; });
    const views = {}, order = [];
    events.getRange(2, 1, eLast - 1, ANALYTICS_HEADERS.length).getValues().forEach(r => {
      const pv = String(r[4]);
      if (!/^[0-9a-f]{16}$/.test(pv) || known[pv]) return;
      const at = new Date(r[0]), t = +r[14] || 0;
      if (isNaN(at.getTime())) return;
      let v = views[pv];
      if (!v) { v = views[pv] = {at, row: r, base: t, codes: {}}; order.push(pv); }
      if (at < v.at) v.at = at;
      if (t < v.base) v.base = t;
      const name = String(r[13]);
      if (name && !(name in v.codes)) v.codes[name] = t;
    });
    if (!order.length) return 0;
    const added = order.map(pv => {
      const v = views[pv], r = v.row;
      const timeline = Object.keys(v.codes).slice(0, 80).map(c => c + ':' + Math.max(0, v.codes[c] - v.base)).join(' ');
      return [v.at, pv, 'all', r[5], r[6], r[7], r[8], '', '', r[9], r[10], r[11], r[12], r[1], r[15], r[3], '', '', '', '', timeline, ''];
    });
    const all = have.concat(added).sort((a, b) => new Date(a[0]) - new Date(b[0])); // rows stay in time order
    sheet.getRange(2, 1, all.length, width).setValues(all);
    return added.length;
  } finally {
    lock.releaseLock();
  }
}

function setupAnalyticsEvents() {
  // Times are stored exactly; this is how they are shown. Without it the sheet may show UTC or a US zone,
  // so a visit just after midnight in Cairo looks like the evening before.
  analyticsBook_().setSpreadsheetTimeZone(ANALYTICS_TIMEZONE);
  analyticsFormatColumns_(analyticsSheet_());
  analyticsFormatVisitors_(analyticsVisitorsSheet_());
  const pvs = analyticsPageViewsSheet_();
  pvs.getRange('A:A').setNumberFormat(ANALYTICS_TIME_FORMAT);
  ['B:B', 'N:N', 'U:U'].forEach(a => pvs.getRange(a).setNumberFormat('@'));
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
  // The owner reads the key here instead of in a log. Anyone who can open this spreadsheet already sees more than it unlocks.
  const book = analyticsBook_();
  const keySheet = book.getSheetByName(ANALYTICS_KEY_SHEET_NAME) || book.insertSheet(ANALYTICS_KEY_SHEET_NAME);
  keySheet.getRange(1, 1, 2, 2).setValues([
    ['Dashboard key', key],
    ['Where it goes', 'Paste it into analytics/dashboard.html when it asks, and save it as the GitHub secret ANALYTICS_READ_KEY.'],
  ]);
  backfillVisitorNumbers();
  backfillPageViews();
  Logger.log('Analytics setup complete; read the key in the private Dashboard key tab.');
  props.setProperty(ANALYTICS_SETUP_PROPERTY, ANALYTICS_SCRIPT_VERSION);
}

// The first request to a new script version runs the setup above, so pasting and deploying are the only steps.
// The version is claimed first, so requests arriving together run it once; a failure is retried on the next request
// and never stops the request itself.
function analyticsAutoSetup_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(ANALYTICS_SETUP_PROPERTY) === ANALYTICS_SCRIPT_VERSION) return;
  props.setProperty(ANALYTICS_SETUP_PROPERTY, ANALYTICS_SCRIPT_VERSION);
  try {
    setupAnalyticsEvents();
  } catch (err) {
    props.deleteProperty(ANALYTICS_SETUP_PROPERTY);
    console.error('Analytics setup failed: ' + err);
  }
}

function analyticsClean_(value, pattern, max) {
  const text = String(value == null ? '' : value).slice(0, max);
  return pattern.test(text) ? text : '';
}

function saveAnalyticsEvents_(params) {
  const ok = ContentService.createTextOutput('ok');
  analyticsAutoSetup_();
  let data;
  try { data = JSON.parse(params.payload || ''); } catch (err) { return ok; }
  if (data && data.kind === 'counts') return saveAnalyticsCounts_(data);
  if (data && data.v === 2) return savePageView_(data);
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
    const day = analyticsDay_(Utilities.formatDate(now, ANALYTICS_TIMEZONE, 'yyyy-MM-dd'));
    const sheet = analyticsSheet_();
    const visitor = day.rows + rows.length > ANALYTICS_MAX_ROWS_PER_DAY || sheet.getLastRow() + rows.length > ANALYTICS_MAX_ROWS_TOTAL
      ? null
      : analyticsVisitorNumber_(head[1], now, day);
    if (visitor === null) {
      analyticsCountDropped_(rows.length);
      return ok;
    }
    rows.forEach(r => r.push(visitor));
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, ANALYTICS_HEADERS.length).setValues(rows);
    day.rows += rows.length;
    analyticsKeepDay_(day);
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

    const pvs = analyticsPageViewsSheet_();
    const pLast = pvs.getLastRow();
    if (pLast >= 2) {
      const pTimes = pvs.getRange(2, 1, pLast - 1, 1).getValues();
      let pOld = 0;
      while (pOld < pTimes.length && new Date(pTimes[pOld][0]) < cutoff) pOld += 1;
      if (pOld) pvs.deleteRows(2, pOld);
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

// Every read answers in JSON, a failure included, so the dashboard can say what went wrong instead of going blank.
function analyticsJourneys_(params, method) {
  const json = obj => ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  if (method !== 'POST') return json({error: 'method_not_allowed'});
  try {
    analyticsAutoSetup_();
    return analyticsRead_(json, params || {});
  } catch (err) {
    return json({error: 'script', message: String(err && err.message || err).slice(0, 300), script_version: ANALYTICS_SCRIPT_VERSION});
  }
}

// Totals per Cairo day and landing page (the first page of each visit). No visit numbers leave here.
function analyticsRead_(json, params) {
  const key = PropertiesService.getScriptProperties().getProperty(ANALYTICS_KEY_PROPERTY);
  if (!key || params.key !== key) return json({error: 'forbidden'});
  if (params.what === 'counts') return analyticsCounts_(json, params);
  if (params.what === 'insights') return analyticsInsights_(json, params);
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

  // Groups under ANALYTICS_MIN_GROUP visits are merged, per day, into one "other" row.
  const other = {};
  Object.keys(groups).forEach(k => {
    const g = groups[k];
    if (g.visits >= ANALYTICS_MIN_GROUP) return;
    delete groups[k];
    const o = other[g.date] || (other[g.date] = {date: g.date, landing_release: 'other', landing_page: 'other', source: 'other',
      device: 'other', lang: 'other', visits: 0, returning: 0, multi_page: 0, downloads: 0, signups: 0, surveys: 0, times: []});
    ['visits', 'returning', 'multi_page', 'downloads', 'signups', 'surveys'].forEach(f => { o[f] += g[f]; });
    o.times = o.times.concat(g.times);
  });
  Object.keys(other).forEach(d => { groups[d + '\u0001~other'] = other[d]; });

  const rows = Object.keys(groups).sort().map(k => {
    const g = groups[k];
    const t = g.times.sort((a, b) => a - b);
    const mid = t.length % 2 ? t[(t.length - 1) / 2] : Math.round((t[t.length / 2 - 1] + t[t.length / 2]) / 2);
    g.median_secs_to_download = t.length && g.visits >= ANALYTICS_MIN_GROUP ? mid : ''; // a few visits are never described one by one
    delete g.times;
    return g;
  });
  const dropped = parseInt(PropertiesService.getScriptProperties().getProperty(ANALYTICS_DROPPED_PROPERTY), 10) || 0;
  return json({days: dates, rows, min_group: ANALYTICS_MIN_GROUP, dropped_total: dropped});
}
