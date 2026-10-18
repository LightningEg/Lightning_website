/**
 * Entry points for the complete Lightning receiver. Install with the three
 * *ReceiverPatch.gs files, OR use the generated single-file bundle instead.
 * Replace old doPost/doGet definitions: Apps Script must have exactly one each.
 * Survey/signup writes use NEW v2 tabs so existing response layouts stay intact.
 * Bound scripts use their spreadsheet; standalone scripts require Script Property
 * WEBSITE_FORMS_SPREADSHEET_ID. Never put that ID or any secret in website JS.
 */
const WEBSITE_SURVEY_FIELDS = [
  'finance_tracking', 'tracking_tools', 'tracking_tools_other', 'tracked_items',
  'confidence_budgeting', 'confidence_saving', 'confidence_investing', 'confidence_wealth',
  'confidence_performance', 'priority_questions', 'priority_questions_other',
  'analysis_usefulness', 'maintenance_time', 'biggest_problem', 'early_tester', 'email', 'page_url'
];
const WEBSITE_SURVEY_CHOICES = {
  finance_tracking: ['Yes, regularly', 'Sometimes', 'I tried before but stopped', 'No'],
  tracking_tools: ['Excel / Google Sheets', 'Budgeting or finance app', 'Bank apps', 'Brokerage / investment apps', 'Notes / paper', 'Mostly in my head', "I don't currently track", 'Other'],
  tracked_items: ['Income and expenses', 'Account balances', 'Monthly budget', 'Savings', 'Investments', 'Investment returns', 'Net worth', 'Financial goals', "I don't currently track these"],
  priority_questions: ['Where is my money going?', 'How much am I saving?', 'How much money / wealth do I have?', 'Am I staying within my budget?', 'How are my investments performing?', 'How has my wealth changed over time?', 'How much money can I safely spend?', 'How is my money divided between cash, savings and investments?', 'Other'],
  analysis_usefulness: ['Very useful', 'Somewhat useful', 'Not sure', 'Not very useful', 'Not useful'],
  maintenance_time: ['5–10 minutes per week', '15–30 minutes per week', 'Around 1 hour per week', 'Around 1 hour per month', 'Less than 1 hour per month', 'Only if most of it were automatic'],
  early_tester: ['Yes', 'Maybe', 'No']
};

function websiteReply_(ok, error) {
  return ContentService.createTextOutput(JSON.stringify(ok ? { ok: true } : { ok: false, error }))
    .setMimeType(ContentService.MimeType.JSON);
}
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'journeys') return websiteReply_(false, 'method_not_allowed');
  return ContentService.createTextOutput('Lightning receiver 2026-10-18');
}
function doPost(e) {
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string') return websiteReply_(false, 'invalid_request');
    if (e.postData.contents.length > 90 * 1024 * 1024) return websiteReply_(false, 'request_too_large');
    e = websitePostEvent_(e);
    const data = e.parameter;
    const type = String(data.form_type || '');
    // The URL-encoded image envelope may be larger than its decoded JSON.
    const max = type === 'app_feedback' ? 90 * 1024 * 1024 : 256 * 1024;
    if (e.postData.contents.length > max) return websiteReply_(false, 'request_too_large');
    // A query string must never carry the analytics read key. Parse POST body only.
    if (data.action === 'journeys') {
      const body = websiteBody_(e.postData.contents);
      if (body.action !== 'journeys' || !body.key) return websiteReply_(false, 'invalid_request');
      return analyticsJourneys_(body, 'POST');
    }
    if (type === 'event') return saveAnalyticsEvents_(data); // analytics has its own caps/key checks
    if (!['survey', 'signup', 'app_feedback', 'ux_test'].includes(type)) return websiteReply_(false, 'unknown_form');
    const trap = e.parameters && e.parameters.website || [data.website || ''];
    if (trap.some(value => String(value).trim())) return websiteReply_(false, 'invalid_submission');
    let prepared = null;
    if (type === 'survey' || type === 'signup') prepared = websitePrepare_(e, type);
    const admission = websiteAdmission_(data, prepared);
    if (admission.error) return websiteReply_(false, admission.error);
    let saved = false;
    try {
      const result = type === 'app_feedback' ? saveAppFeedback_(data)
        : type === 'ux_test' ? saveUxTest_(data) : websiteSave_(type, prepared);
      saved = JSON.parse(result.getContent()).ok === true;
      if (saved) CacheService.getScriptCache().put(admission.duplicate, 'done', 600);
      return result;
    } finally {
      // A failed storage operation must remain retryable, never treated as a saved duplicate.
      if (!saved) CacheService.getScriptCache().remove(admission.duplicate);
    }
  } catch (_) {
    // Do not return sheet IDs, submitted data, credentials or stack traces.
    return websiteReply_(false, 'invalid_submission');
  }
}
function websitePostEvent_(e) {
  if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(e.postData.type || '')) throw new Error('Unsupported content type');
  const parameter = Object.create(null), parameters = Object.create(null);
  const parts = e.postData.contents.split('&');
  if (parts.length > 80) throw new Error('Too many fields');
  for (const part of parts) {
    const at = part.indexOf('=');
    const decode = value => decodeURIComponent(value.replace(/\+/g, ' '));
    const key = decode(at < 0 ? part : part.slice(0, at));
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(key) || ['constructor', 'prototype'].includes(key)) throw new Error('Invalid field');
    const value = decode(at < 0 ? '' : part.slice(at + 1));
    if (!parameters[key]) { parameters[key] = []; parameter[key] = value; }
    parameters[key].push(value);
    if (!['tracking_tools', 'tracked_items', 'priority_questions'].includes(key) && parameters[key].length > 1) throw new Error('Duplicate field');
  }
  return { postData: e.postData, parameter, parameters };
}
function websiteBody_(contents) {
  const values = {};
  for (const part of contents.split('&')) {
    const at = part.indexOf('=');
    const decode = value => decodeURIComponent(value.replace(/\+/g, ' '));
    const key = decode(at < 0 ? part : part.slice(0, at));
    if (Object.prototype.hasOwnProperty.call(values, key)) throw new Error('Duplicate field');
    Object.defineProperty(values, key, { value: decode(at < 0 ? '' : part.slice(at + 1)), enumerable: true });
  }
  return values;
}
function websiteCell_(value, max) {
  const text = String(value == null ? '' : value).slice(0, max || 2000);
  return /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? "'" + text : text;
}
function websiteValues_(e, name) {
  const raw = e.parameters && e.parameters[name] || (e.parameter && e.parameter[name] != null ? [e.parameter[name]] : []);
  if (!Array.isArray(raw) || raw.length > 12 || raw.some(v => typeof v !== 'string' || v.length > 2000)) throw new Error('Invalid field');
  return raw;
}
function websitePrepare_(e, type) {
  const fields = type === 'signup' ? ['email', 'page_url'] : WEBSITE_SURVEY_FIELDS;
  const values = {};
  for (const field of fields) {
    const parts = websiteValues_(e, field);
    const multi = ['tracking_tools', 'tracked_items', 'priority_questions'].includes(field);
    if (!multi && parts.length > 1 || field === 'priority_questions' && parts.length > 3) throw new Error('Invalid choices');
    const allowed = WEBSITE_SURVEY_CHOICES[field] || (field.startsWith('confidence_') ? ['1', '2', '3', '4', '5'] : null);
    if (allowed && parts.some(v => v && !allowed.includes(v))) throw new Error('Invalid choice');
    if (new Set(parts).size !== parts.length) throw new Error('Duplicate choices');
    values[field] = parts.join(' | ');
  }
  const email = values.email.trim();
  if (email.length > 254 || email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || type === 'signup' && !email) throw new Error('Invalid email');
  values.email = email;
  if (type === 'survey' && !WEBSITE_SURVEY_FIELDS.some(k => !['email', 'page_url'].includes(k) && values[k])) throw new Error('Empty survey');
  return values;
}
function websiteDigest_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(b => (b & 255).toString(16).padStart(2, '0')).join('');
}
function websiteAdmission_(data, prepared) {
  const now = Date.now(), type = data.form_type;
  const started = Number(data.started_at || 0);
  // Timing is only a cheap filter; clients can forge it. Existing clients remain supported.
  if (started && (!Number.isFinite(started) || started > now - 750 || started < now - 24 * 3600 * 1000)) return { error: 'invalid_submission' };
  const session = /^[a-zA-Z0-9_-]{16,96}$/.test(data.form_session || '') ? data.form_session : 'legacy';
  const fingerprint = type === 'signup' ? prepared.email.toLowerCase() : JSON.stringify(prepared || {
    session, content: String(data.tickets_json || data.feedback_json || '').slice(0, 4096), length: String(data.tickets_json || data.feedback_json || '').length
  });
  const duplicate = 'form-duplicate-' + websiteDigest_(type + ':' + fingerprint);
  const sessionKey = 'form-session-' + websiteDigest_(type + ':' + session);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cache = CacheService.getScriptCache(), props = PropertiesService.getScriptProperties();
    const seen = cache.get(duplicate);
    if (seen) return { error: seen === 'done' ? 'duplicate_submission' : 'in_progress' };
    const recent = JSON.parse(cache.get(sessionKey) || '{}');
    const times = Array.isArray(recent.times) ? recent.times.filter(t => t > now - 10 * 60 * 1000) : [];
    if (times.length >= 5) return { error: 'rate_limit' };
    const day = new Date(now).toISOString().slice(0, 10), minute = Math.floor(now / 60000);
    let usage = JSON.parse(props.getProperty('WEBSITE_FORM_USAGE') || '{}');
    if (usage.day !== day) usage = { day, counts: {} };
    const count = usage.counts[type] || 0;
    if (count >= 300) return { error: 'daily_limit' };
    if (usage.minute !== minute) { usage.minute = minute; usage.minuteCount = 0; }
    if (usage.minuteCount >= 30) return { error: 'rate_limit' };
    usage.counts[type] = count + 1; usage.minuteCount++;
    props.setProperty('WEBSITE_FORM_USAGE', JSON.stringify(usage));
    times.push(now);
    cache.put(sessionKey, JSON.stringify({ times }), 600);
    cache.put(duplicate, 'pending', 600);
    return { duplicate };
  } finally { lock.releaseLock(); }
}
function websiteSave_(type, values) {
  const fields = type === 'signup' ? ['email', 'page_url'] : WEBSITE_SURVEY_FIELDS;
  const name = type === 'signup' ? 'Email signups v2' : 'Survey responses v2';
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const id = PropertiesService.getScriptProperties().getProperty('WEBSITE_FORMS_SPREADSHEET_ID');
    const book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
    if (!book) return websiteReply_(false, 'configuration');
    let sheet = book.getSheetByName(name);
    if (!sheet) sheet = book.insertSheet(name);
    const headers = ['Submitted at'].concat(fields);
    if (!sheet.getLastRow()) { sheet.appendRow(headers); sheet.setFrozenRows(1); }
    // Refuse to append under an unexpected schema instead of mixing private data into wrong columns.
    if (JSON.stringify(sheet.getRange(1, 1, 1, headers.length).getValues()[0]) !== JSON.stringify(headers)) return websiteReply_(false, 'configuration');
    if (sheet.getLastRow() >= 50001) return websiteReply_(false, 'storage_limit');
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length)
      .setValues([[new Date()].concat(fields.map(k => websiteCell_(values[k], k === 'email' ? 254 : 2000)))]);
    return websiteReply_(true);
  } finally { lock.releaseLock(); }
}

/** Run from the Apps Script editor, never from a public HTTP route. */
function rotateAnalyticsReadKey() {
  const key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('ANALYTICS_READ_KEY', key);
  setupAnalyticsEvents(); // updates the private Dashboard key tab; does not log the key
  Logger.log('Key rotated. Copy it privately from the Dashboard key tab to the GitHub secret.');
}
