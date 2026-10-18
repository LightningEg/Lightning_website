/**
 * Lightning · route UX test feedback to its own "UX Tests" tab
 *
 * Why responses land in the survey sheet: the receiver's doPost(e) saves every
 * request as a survey row unless it checks form_type first. The website sends
 * UX feedback with form_type=ux_test (see js/ux-test.js).
 *
 * Setup (in the Apps Script project behind the receiver web app):
 *
 * 1. Add a new script file (for example "UXTests") and paste this whole file into it.
 *
 * 2. Make this the FIRST line inside your existing doPost(e), before anything
 *    that reads or saves survey fields:
 *
 *      if (e && e.parameter && e.parameter.form_type === 'ux_test') return saveUxTest_(e.parameter);
 *
 * 3. Deploy a new version of the SAME web app:
 *    Deploy → Manage deployments → pencil (edit) → Version: "New version" → Deploy.
 *    Saving the script is not enough: the live /exec URL keeps running the old
 *    version until you deploy a new one. Keep the same deployment so the URL in
 *    the website does not change.
 *
 * 4. Check it: run testUxRoute() once from the editor (approve access if asked).
 *    A test row should appear in the "UX Tests" tab. Delete it afterwards.
 *
 * The "UX Tests" tab and its header row are created automatically if missing.
 * If the script is not attached to the spreadsheet (a standalone project), paste
 * the spreadsheet ID into UX_SPREADSHEET_ID below.
 */
const UX_SPREADSHEET_ID = '';
const UX_SHEET_NAME = 'UX Tests';
const UX_HEADERS = ['Submitted at', 'Release', 'Section ID', 'Section', 'Reaction', 'Reasons', 'Page URL', 'Session ID', 'Device'];

function uxSheet_() {
  const book = UX_SPREADSHEET_ID ? SpreadsheetApp.openById(UX_SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(UX_SHEET_NAME);
  if (!sheet) sheet = book.insertSheet(UX_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(UX_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function saveUxTest_(data) {
  const respond = value => ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
  const response = respond({ ok: true });

  if (data.website || typeof data.feedback_json !== 'string' || data.feedback_json.length > 100000) return respond({ ok: false, error: 'invalid_submission' });
  let feedback = [];
  try { feedback = JSON.parse(data.feedback_json || '[]'); } catch (error) { return respond({ ok: false, error: 'invalid_submission' }); }
  if (!Array.isArray(feedback) || feedback.length > 30) return respond({ ok: false, error: 'invalid_submission' });
  const submittedAt = new Date();
  const rows = feedback
    .filter(item => item && item.reaction)
    .map(item => [
      submittedAt,
      data.experience_version || '',
      item.id || '',
      item.title || '',
      item.reaction || '',
      Array.isArray(item.reasons) ? item.reasons.join(' | ') : '',
      data.page_url || '',
      data.session_id || '',
      data.device || ''
    ].map(uxCell_));
  if (!rows.length) return respond({ ok: false, error: 'no_feedback' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const day = submittedAt.toISOString().slice(0, 10);
    let usage = JSON.parse(props.getProperty('UX_FEEDBACK_USAGE') || '{}');
    if (usage.day !== day) usage = { day, rows: 0 };
    if (usage.rows + rows.length > 1000) return respond({ ok: false, error: 'daily_limit' });
    props.setProperty('UX_FEEDBACK_USAGE', JSON.stringify({ day, rows: usage.rows + rows.length }));
    const sheet = uxSheet_();
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, UX_HEADERS.length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return response;
}

/** Run once from the editor to confirm UX feedback reaches the "UX Tests" tab. */
function testUxRoute() {
  const result = doPost({ parameter: {
    form_type: 'ux_test',
    experience_version: 'TEST',
    page_url: 'https://lightningeg.com/test',
    session_id: 'test-session',
    device: 'desktop',
    feedback_json: JSON.stringify([{ id: 'test', title: 'Routing test', reaction: 'liked', reasons: [] }])
  } });
  Logger.log(result.getContent());
}

function uxCell_(value) {
  if (typeof value === 'number' || value instanceof Date) return value;
  const text = String(value == null ? '' : value).slice(0, 2000);
  return /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? "'" + text : text;
}
