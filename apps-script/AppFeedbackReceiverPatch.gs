/**
 * Lightning · route app-feedback tickets and their screenshots
 *
 * Setup in the existing Apps Script receiver:
 *
 * 1. Add this as a new script file, or replace the older copy of this patch.
 * 2. Add this route near the TOP of the existing doPost(e), before its survey
 *    fallback that writes every request as a survey response:
 *
 *    if (e && e.parameter && e.parameter.form_type === 'app_feedback') {
 *      return saveAppFeedback_(e.parameter);
 *    }
 *
 * 3. Run setupAppFeedbackDrive() once from the Apps Script editor as the
 *    deployment owner. Authorize Drive access when prompted; this creates the
 *    private screenshot folder.
 * 4. Deploy a NEW VERSION of the existing web app deployment. Keep its /exec
 *    URL unchanged.
 *
 * Screenshots are written to a new folder in the deployment owner's Drive.
 * The folder is not shared by this script; the sheet stores private Drive
 * links. Each ticket row contains up to five attachment links.
 */
const APP_FEEDBACK_SPREADSHEET_ID = '';
const APP_FEEDBACK_SHEET_NAME = 'App Feedback';
const APP_FEEDBACK_IMAGE_FOLDER_PROPERTY = 'APP_FEEDBACK_IMAGE_FOLDER_ID';
const APP_FEEDBACK_MAX_IMAGES_PER_TICKET = 5;
const APP_FEEDBACK_MAX_IMAGES_PER_SUBMISSION = 10;
const APP_FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const APP_FEEDBACK_MAX_SUBMISSION_BYTES = 12 * 1024 * 1024;
const APP_FEEDBACK_HEADERS = [
  'Submitted at', 'Landing release', 'App build', 'Section / page', 'Type',
  'Area', 'Description', 'Page URL', 'Session ID', 'Ticket #', 'Device',
  'Reporter Name', 'Reporter Email', 'Screenshots (private Drive links)'
];

function appFeedbackSheet_() {
  const id = APP_FEEDBACK_SPREADSHEET_ID || PropertiesService.getScriptProperties().getProperty('WEBSITE_FORMS_SPREADSHEET_ID');
  const book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('Feedback spreadsheet is not configured');
  let sheet = book.getSheetByName(APP_FEEDBACK_SHEET_NAME);
  if (!sheet) sheet = book.insertSheet(APP_FEEDBACK_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(APP_FEEDBACK_HEADERS);
    sheet.setFrozenRows(1);
  } else {
    const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const missing = APP_FEEDBACK_HEADERS.slice(existing.length);
    if (missing.length) sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function appFeedbackImageFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const savedId = properties.getProperty(APP_FEEDBACK_IMAGE_FOLDER_PROPERTY);
  if (savedId) return DriveApp.getFolderById(savedId);
  const folder = DriveApp.createFolder('Lightning app feedback screenshots');
  properties.setProperty(APP_FEEDBACK_IMAGE_FOLDER_PROPERTY, folder.getId());
  return folder;
}

/** Run once from the Apps Script editor as the deployment owner to grant Drive access and create the private folder. */
function setupAppFeedbackDrive() {
  const folder = appFeedbackImageFolder_();
  Logger.log(folder.getUrl());
}

function appFeedbackImageBytes_(attachment) {
  const mime = String(attachment.mime || '').toLowerCase();
  const base64 = String(attachment.base64 || '');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error('Unsupported screenshot type');
  if (!base64 || base64.length > Math.ceil(APP_FEEDBACK_MAX_IMAGE_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('Invalid screenshot data');
  const bytes = Utilities.base64Decode(base64);
  if (!bytes.length || bytes.length > APP_FEEDBACK_MAX_IMAGE_BYTES) throw new Error('Screenshot exceeds the size limit');
  const b = bytes.map(value => value & 255);
  const png = mime === 'image/png' && b.length >= 8 && b.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
  const jpeg = mime === 'image/jpeg' && b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
  const webp = mime === 'image/webp' && b.length >= 12 && String.fromCharCode.apply(null, b.slice(0, 4)) === 'RIFF' && String.fromCharCode.apply(null, b.slice(8, 12)) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('Screenshot content does not match its file type');
  return bytes;
}

function appFeedbackSafeName_(name, mime) {
  const extension = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
  let safe = String(name || 'screenshot').replace(/\\/g, '/').split('/').pop().replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 80);
  if (!safe) safe = 'screenshot';
  return safe.replace(/\.(png|jpe?g|webp)$/i, '') + extension;
}

// Cache chunks are transient: abandoned images expire without creating Drive files. Capacity is reserved
// conservatively for seven hours, leaving room in the shared cache for the receiver's rate limits.
const APP_FEEDBACK_STAGE_CHUNK = 80000;
const APP_FEEDBACK_STAGE_TTL = 21600;
function stageAppFeedbackImage_(data) {
  const reply = websiteJson_;
  if (!/^[a-f0-9]{32}$/.test(data.form_session || '') || !/^[a-f0-9]{32}$/.test(data.upload_id || '')) return reply({ ok: false, error: 'invalid_submission' });
  let image;
  try {
    if (typeof data.image_json !== 'string' || data.image_json.length > 7 * 1024 * 1024) throw new Error('invalid image');
    image = JSON.parse(data.image_json);
    if (!image || typeof image.base64 !== 'string') throw new Error('invalid image');
    appFeedbackImageBytes_(image); // validate type, signature and decoded size before reserving cache
    image.mime = String(image.mime || '').toLowerCase();
    image.name = appFeedbackSafeName_(image.name, image.mime);
  } catch (_) { return reply({ ok: false, error: 'invalid_image' }); }
  const chunks = Math.ceil(image.base64.length / APP_FEEDBACK_STAGE_CHUNK);
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties(), now = Date.now(), hour = Math.floor(now / 3600000);
    const slots = JSON.parse(props.getProperty('APP_FEEDBACK_STAGE_USAGE') || '{}');
    Object.keys(slots).forEach(key => { if (+key <= hour - 7) delete slots[key]; });
    const used = Object.values(slots).reduce((sum, slot) => sum + slot.chunks, 0);
    if (used + chunks + 1 > 300) return reply({ ok: false, error: 'upload_capacity' });
    const slot = slots[hour] || { chunks: 0 }; slot.chunks += chunks + 1; slots[hour] = slot;
    props.setProperty('APP_FEEDBACK_STAGE_USAGE', JSON.stringify(slots));
    const token = websiteDigest_(data.form_session + ':' + data.upload_id + ':' + Utilities.getUuid());
    const cache = CacheService.getScriptCache(), entries = {};
    for (let i = 0; i < chunks; i++) entries['feedback-image-' + token + '-' + i] = image.base64.slice(i * APP_FEEDBACK_STAGE_CHUNK, (i + 1) * APP_FEEDBACK_STAGE_CHUNK);
    entries['feedback-upload-' + token] = JSON.stringify({ session: data.form_session, name: image.name, mime: image.mime, chunks, hour });
    cache.putAll(entries, APP_FEEDBACK_STAGE_TTL);
    return reply({ ok: true, token });
  } catch (_) { return reply({ ok: false, error: 'upload_failed' }); }
  finally { lock.releaseLock(); }
}

function appFeedbackStaged_(attachment, session, staged) {
  const token = String(attachment.token || '');
  if (!/^[a-f0-9]{64}$/.test(token) || staged.some(item => item.token === token)) throw new Error('Invalid screenshot token');
  const cache = CacheService.getScriptCache(), key = 'feedback-upload-' + token, raw = cache.get(key);
  if (!raw) throw new Error('Screenshot expired');
  const info = JSON.parse(raw);
  if (!session || info.session !== session || !Number.isInteger(info.chunks) || info.chunks < 1 || info.chunks > 88) throw new Error('Invalid screenshot session');
  const keys = Array.from({ length: info.chunks }, (_, i) => 'feedback-image-' + token + '-' + i);
  const values = cache.getAll(keys);
  if (keys.some(k => typeof values[k] !== 'string')) throw new Error('Screenshot expired');
  staged.push({ token, key, raw, keys, hour: info.hour });
  return { name: info.name, mime: info.mime, base64: keys.map(k => values[k]).join('') };
}

function saveAppFeedback_(data) {
  const respond = websiteJson_;
  if (data.website) return respond({ ok: false, error: 'invalid_submission' });
  if (typeof data.tickets_json !== 'string' || data.tickets_json.length > 72 * 1024 * 1024) return respond({ ok: false, error: 'invalid_tickets' });
  let tickets;
  try { tickets = JSON.parse(data.tickets_json || '[]'); } catch (_) { return respond({ ok: false, error: 'invalid_tickets' }); }
  if (!Array.isArray(tickets) || tickets.length > 30) return respond({ ok: false, error: 'invalid_tickets' });

  const submittedAt = new Date();
  const validTickets = tickets.filter(ticket => ticket && ticket.section && ticket.type && ticket.area && ticket.description);
  // Nothing to save: answer before any quota is used or any staged screenshot is consumed.
  if (!validTickets.length) return respond({ ok: false, error: 'no_tickets' });
  let totalImages = 0;
  const staged = [];
  try {
    // Count before decoding so an oversized array cannot allocate many image buffers.
    const count = validTickets.reduce((n, ticket) => n + (Array.isArray(ticket.attachments) ? ticket.attachments.length : 0), 0);
    if (count > APP_FEEDBACK_MAX_IMAGES_PER_SUBMISSION) throw new Error('Submission has too many screenshots');
    let encodedLength = 0;
    validTickets.forEach(ticket => {
      if (ticket.attachments == null) ticket.attachments = [];
      if (!Array.isArray(ticket.attachments) || ticket.attachments.length > APP_FEEDBACK_MAX_IMAGES_PER_TICKET) throw new Error('Invalid screenshot count');
      totalImages += ticket.attachments.length;
      ticket.attachments = ticket.attachments.map(attachment => attachment && attachment.token ? appFeedbackStaged_(attachment, data.form_session, staged) : attachment);
      ticket.attachments.forEach(attachment => {
        if (!attachment || typeof attachment.base64 !== 'string') throw new Error('Invalid screenshot data');
        encodedLength += attachment.base64.length;
        if (encodedLength > 4 * Math.ceil(APP_FEEDBACK_MAX_SUBMISSION_BYTES / 3) + 40) throw new Error('Submission is too large');
      });
    });
    validTickets.forEach(ticket => {
      ticket.attachments = ticket.attachments.map(attachment => ({
        name: appFeedbackSafeName_(attachment.name, String(attachment.mime || '').toLowerCase()),
        mime: String(attachment.mime || '').toLowerCase(),
        bytes: appFeedbackImageBytes_(attachment)
      }));
    });
    if (totalImages > APP_FEEDBACK_MAX_IMAGES_PER_SUBMISSION) throw new Error('Submission has too many screenshots');

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    const createdFiles = [];
    let consumed = false;
    try {
      // A shared daily cap bounds Drive and Sheet growth; Apps Script exposes no client IP.
      const props = PropertiesService.getScriptProperties();
      const day = submittedAt.toISOString().slice(0, 10);
      let usage = JSON.parse(props.getProperty('APP_FEEDBACK_USAGE') || '{}');
      if (usage.day !== day) usage = { day, rows: 0, bytes: 0 };
      const bytes = validTickets.reduce((n, t) => n + t.attachments.reduce((m, a) => m + a.bytes.length, 0), 0);
      if (bytes > APP_FEEDBACK_MAX_SUBMISSION_BYTES) return respond({ ok: false, error: 'invalid_submission' });
      if (usage.rows + validTickets.length > 1000 || usage.bytes + bytes > 100 * 1024 * 1024) return respond({ ok: false, error: 'daily_limit' });
      const cache = staged.length ? CacheService.getScriptCache() : null;
      if (staged.some(item => cache.get(item.key) !== item.raw)) return respond({ ok: false, error: 'image_expired' });
      consumed = true;
      staged.forEach(item => cache.remove(item.key));
      // Reserve capacity before writes; failed requests still consume their quota.
      props.setProperty('APP_FEEDBACK_USAGE', JSON.stringify({ day, rows: usage.rows + validTickets.length, bytes: usage.bytes + bytes }));
      const folder = totalImages ? appFeedbackImageFolder_() : null;
      const rows = validTickets.map((ticket, index) => {
        const links = (ticket.attachments || []).map((attachment, imageIndex) => {
          const blob = Utilities.newBlob(attachment.bytes, attachment.mime, attachment.name);
          const file = folder.createFile(blob);
          createdFiles.push(file);
          file.setDescription(`Lightning app feedback · ${data.session_id || 'anonymous'} · ticket ${index + 1} · screenshot ${imageIndex + 1}`);
          return file.getUrl();
        });
        return [
          submittedAt,
          data.experience_version || '',
          data.app_build || '',
          ticket.section || '',
          ticket.type || '',
          ticket.area || '',
          String(ticket.description || '').slice(0, 1000),
          data.page_url || '',
          data.session_id || '',
          index + 1,
          data.device || '',
          String(data.reporter_name || '').slice(0, 100),
          String(data.reporter_email || '').slice(0, 254),
          links.join('\n')
        ].map(v => websiteCell_(v));
      });
      const sheet = appFeedbackSheet_();
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, APP_FEEDBACK_HEADERS.length).setValues(rows);
      try {
        staged.forEach(item => cache.removeAll(item.keys));
        if (staged.length) {
          const slots = JSON.parse(props.getProperty('APP_FEEDBACK_STAGE_USAGE') || '{}');
          staged.forEach(item => { if (slots[item.hour]) slots[item.hour].chunks = Math.max(0, slots[item.hour].chunks - item.keys.length - 1); });
          props.setProperty('APP_FEEDBACK_STAGE_USAGE', JSON.stringify(slots));
        }
      } catch (_) { /* chunks and reserved capacity expire */ }
      return respond({ ok: true });
    } catch (error) {
      createdFiles.forEach(file => { try { file.setTrashed(true); } catch (_) {} });
      if (consumed) staged.forEach(item => { try { CacheService.getScriptCache().put(item.key, item.raw, APP_FEEDBACK_STAGE_TTL); } catch (_) {} });
      console.error(error);
      return respond({ ok: false, error: 'save_failed' });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return respond({ ok: false, error: error.message === 'Screenshot expired' ? 'image_expired' : 'invalid_submission' });
  }
}

/** Optional one-off routing check from the Apps Script editor. */
function testAppFeedbackRoute() {
  const result = doPost({ parameter: {
    form_type: 'app_feedback', experience_version: 'TEST', app_build: 'Version A',
    page_url: 'https://lightningeg.com/current-status.html', session_id: 'test-session', device: 'desktop',
    tickets_json: JSON.stringify([{ section: 'Import CSV', type: 'Improvement', area: 'Visual', description: 'Test row — delete after confirming the route.' }])
  } });
  Logger.log(result.getContent());
}
