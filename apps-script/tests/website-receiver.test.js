const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function setup() {
  const tabs = {}, props = {}, cached = new Map(), openedBooks = [];
  let now = Date.now(), broken = false, locked = false;
  const cache = { get(k) { const v = cached.get(k); return v && v.expiry > now ? v.value : null; },
    put(k, value, ttl) { cached.set(k, { value, expiry: now + ttl * 1000 }); }, remove: k => cached.delete(k),
    putAll(values, ttl) { Object.entries(values).forEach(([k, v]) => this.put(k, v, ttl)); },
    getAll(keys) { return Object.fromEntries(keys.map(k => [k, this.get(k)]).filter(([, v]) => v !== null)); },
    removeAll(keys) { keys.forEach(k => this.remove(k)); } };
  const files = [];
  const folder = { createFile(blob) { const file = { blob, trashed: false, setDescription() {},
    getUrl() { return `https://drive.invalid/${files.indexOf(file)}`; }, setTrashed(value) { file.trashed = value; } };
    files.push(file); return file; } };
  const book = { getSheetByName: n => tabs[n] || null, insertSheet(n) {
    const rows = [];
    return tabs[n] = { rows, getLastRow: () => rows.length, getLastColumn: () => rows[0].length,
      appendRow: r => rows.push(r), setFrozenRows() {},
      getRange(r, c, n, w) { return { getValues: () => rows.slice(r - 1, r - 1 + n).map(row => row.slice(c - 1, c - 1 + w)),
        setValues(values) { if (broken) throw new Error('storage failure'); values.forEach((row, i) => { rows[r - 1 + i] = row; }); } }; } };
  } };
  const context = vm.createContext({ Date: class extends Date { static now() { return now; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ getContent: () => t, setMimeType() { return this; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => props[k] = v }) },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked, false, 'locks never nest'); locked = true; }, releaseLock() { locked = false; } }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => book, openById: id => { openedBooks.push(id); return book; } },
    DriveApp: { createFolder: () => ({ ...folder, getId: () => 'private-folder' }), getFolderById: () => folder },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, text) => [...crypto.createHash('sha256').update(text).digest()], getUuid: () => crypto.randomUUID(),
      base64Decode: value => [...Buffer.from(value, 'base64')], newBlob: (bytes, mime, name) => ({ bytes, mime, name }) },
    analyticsJourneys_: (data, method) => ({ getContent: () => JSON.stringify({ method, keyFromBody: data.key }) }),
    saveAnalyticsEvents_: data => ({ getContent: () => JSON.stringify({ event: data.payload }) })
  });
  for (const file of ['WebsiteReceiver.gs', 'AppFeedbackReceiverPatch.gs', 'UXTestsReceiverPatch.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  const post = (values, query = {}) => {
    const contents = new URLSearchParams(values).toString();
    return JSON.parse(context.doPost({ postData: { contents, type: 'application/x-www-form-urlencoded;charset=UTF-8' }, parameter: query }).getContent());
  };
  return { context, post, tabs, props, cached, files, openedBooks, advance: ms => { now += ms; }, fail: yes => { broken = yes; } };
}
const signup = (n = 1, extra = {}) => ({ form_type: 'signup', email: `person${n}@example.test`, form_session: `session_${String(n).padStart(16, '0')}`, ...extra });
test('survey formula-shaped free text and signup email stay literal', () => {
  const r = setup();
  assert.equal(r.post({ form_type: 'survey', biggest_problem: '\t=1+1', page_url: '@a', email: '=x@example.test' }).ok, true);
  const row = r.tabs['Survey responses v2'].rows[1];
  assert.ok(row.includes("'\t=1+1")); assert.ok(row.includes("'@a")); assert.ok(row.includes("'=x@example.test"));
  assert.equal(r.post(signup(1, { email: '+a@example.test' })).ok, true);
  assert.equal(r.tabs['Email signups v2'].rows[1][1], "'+a@example.test");
});
test('checkboxes are retained; unsupported choices, excess choices and malformed email rejected', () => {
  const r = setup();
  assert.equal(r.post([['form_type', 'survey'], ['tracking_tools', 'Bank apps'], ['tracking_tools', 'Notes / paper']]).ok, true);
  assert.equal(r.tabs['Survey responses v2'].rows[1][2], 'Bank apps | Notes / paper');
  assert.equal(r.post({ form_type: 'survey', confidence_budgeting: '=1+1' }).ok, false);
  assert.equal(r.post({ form_type: 'survey', biggest_problem: 'x'.repeat(2001) }).ok, false);
  assert.equal(r.post(signup(1, { email: 'not-an-email' })).ok, false);
  assert.equal(r.post({ form_type: 'survey' }).ok, false);
  assert.equal(r.post({ form_type: 'signup', email: '' }).ok, false);
});
test('no query-string credential or form-type injection reaches handlers', () => {
  const r = setup();
  assert.deepEqual(r.post({ action: 'journeys', key: 'body' }, { action: 'journeys', key: 'query' }), { method: 'POST', keyFromBody: 'body' });
  assert.equal(r.post({ action: 'journeys' }, { key: 'query' }).ok, false);
  assert.equal(r.post({ email: 'a@example.test' }, { form_type: 'signup' }).error, 'unknown_form');
  assert.equal(JSON.parse(r.context.doGet({ parameter: { action: 'journeys', key: 'query' } }).getContent()).error, 'method_not_allowed');
});
test('rejects filled honeypots, duplicate scalar fields, unknown routes and invalid encoding', () => {
  const r = setup();
  assert.equal(r.post(signup(1, { website: 'spam' })).ok, false);
  assert.equal(r.post([['form_type', 'signup'], ['email', 'a@example.test'], ['email', 'b@example.test']]).ok, false);
  assert.equal(r.post({ form_type: 'unrecognized' }).ok, false);
  assert.equal(JSON.parse(r.context.doPost({ postData: { contents: '%xx=a', type: 'application/x-www-form-urlencoded' } }).getContent()).ok, false);
  assert.equal(r.context.doPost({ postData: { contents: '{}', type: 'application/json' } }).getContent().includes('false'), true);
  assert.equal(Object.keys(r.tabs).length, 0);
});
test('duplicates do not append; failed writes remain retryable', () => {
  const r = setup();
  assert.equal(r.post(signup()).ok, true);
  assert.equal(r.post(signup()).error, 'duplicate_submission');
  assert.equal(r.tabs['Email signups v2'].rows.length, 2);
  r.fail(true); assert.equal(r.post(signup(2)).ok, false);
  r.fail(false); assert.equal(r.post(signup(2)).ok, true);
  assert.equal(r.tabs['Email signups v2'].rows.length, 3);
});
test('per-session throttle is server checked and expires', () => {
  const r = setup();
  for (let n = 1; n <= 5; n++) assert.equal(r.post(signup(n, { form_session: 'same_session_12345' })).ok, true);
  assert.equal(r.post(signup(6, { form_session: 'same_session_12345' })).error, 'rate_limit');
  r.advance(601000);
  assert.equal(r.post(signup(6, { form_session: 'same_session_12345' })).ok, true);
});
test('per-day and per-minute caps work even with fresh client identities', () => {
  const r = setup();
  r.props.WEBSITE_FORM_USAGE = JSON.stringify({ day: new Date().toISOString().slice(0, 10), counts: { signup: 300 } });
  assert.equal(r.post(signup()).error, 'daily_limit');
  delete r.props.WEBSITE_FORM_USAGE;
  for (let n = 1; n <= 30; n++) assert.equal(r.post(signup(n)).ok, true);
  assert.equal(r.post(signup(31)).error, 'rate_limit');
});
test('feedback routes pass through literal-cell protection and confirmed responses', () => {
  const r = setup();
  assert.equal(r.post({ form_type: 'app_feedback', tickets_json: JSON.stringify([{ section: '=1+1', type: 'bug', area: 'app', description: '=2+2' }]) }).ok, true);
  assert.equal(r.tabs['App Feedback'].rows[1][3], "'=1+1");
  assert.equal(r.post({ form_type: 'ux_test', feedback_json: JSON.stringify([{ reaction: 'liked', title: '=1+1' }]) }).ok, true);
  assert.equal(r.tabs['UX Tests'].rows[1][3], "'=1+1");
  assert.equal(r.post({ form_type: 'ux_test', feedback_json: '{}' }).ok, false);
});

test('long distinct feedback submissions are not mistaken for duplicates', () => {
  const r = setup(), session = 'a'.repeat(32);
  const tickets = Array.from({ length: 6 }, (_, i) => ({ section: 'Overview', type: 'Bug', area: 'Technical',
    description: 'x'.repeat(899) + (i === 5 ? 'A' : 'x') }));
  const send = () => r.post({ form_type: 'app_feedback', form_session: session, tickets_json: JSON.stringify(tickets) });
  assert.equal(send().ok, true);
  tickets[5].description = 'x'.repeat(899) + 'B';
  assert.equal(send().ok, true);
  assert.equal(r.tabs['App Feedback'].rows.length, 13);
});

test('standalone receiver uses the configured spreadsheet for both feedback routes', () => {
  const r = setup(); r.props.WEBSITE_FORMS_SPREADSHEET_ID = 'configured-sheet';
  assert.equal(r.post({ form_type: 'app_feedback', tickets_json: JSON.stringify([{ section: 'Overview', type: 'Bug', area: 'Technical', description: 'example' }]) }).ok, true);
  assert.equal(r.post({ form_type: 'ux_test', feedback_json: JSON.stringify([{ reaction: 'liked' }]) }).ok, true);
  assert.deepEqual(r.openedBooks, ['configured-sheet', 'configured-sheet']);
});

test('selected image uploads temporarily; submission consumes the token once', () => {
  const r = setup(), session = 'a'.repeat(32), image = { name: 'dummy.png', mime: 'image/png', base64: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') };
  const staged = r.post({ form_type: 'app_feedback_image', form_session: session, upload_id: 'b'.repeat(32), image_json: JSON.stringify(image) });
  assert.equal(staged.ok, true); assert.match(staged.token, /^[a-f0-9]{64}$/); assert.equal(r.files.length, 0);
  const ticket = [{ section: 'Overview', type: 'Bug', area: 'Technical', description: 'example', attachments: [{ token: staged.token }] }];
  assert.equal(r.post({ form_type: 'app_feedback', form_session: 'c'.repeat(32), tickets_json: JSON.stringify(ticket) }).ok, false);
  assert.equal(r.files.length, 0);
  const duplicate = [{ ...ticket[0], attachments: [{ token: staged.token }, { token: staged.token }] }];
  assert.equal(r.post({ form_type: 'app_feedback', form_session: session, tickets_json: JSON.stringify(duplicate) }).ok, false);
  assert.equal(r.files.length, 0);
  assert.equal(r.post({ form_type: 'app_feedback', form_session: session, tickets_json: JSON.stringify(ticket) }).ok, true);
  assert.equal(r.files.length, 1); assert.ok(r.tabs['App Feedback'].rows[1][13].includes('https://drive.invalid/'));
  assert.equal(Object.values(JSON.parse(r.props.APP_FEEDBACK_STAGE_USAGE)).reduce((n, slot) => n + slot.chunks, 0), 0);
  ticket[0].description = 'different request';
  assert.equal(r.post({ form_type: 'app_feedback', form_session: session, tickets_json: JSON.stringify(ticket) }).ok, false);
  assert.equal(r.files.length, 1);
});

test('staged uploads reject bots, invalid sessions and non-image content', () => {
  const r = setup(), session = 'a'.repeat(32), id = '8'.repeat(32);
  const image = JSON.stringify({ name: 'bad.png', mime: 'image/png', base64: Buffer.from('not a PNG').toString('base64') });
  const data = { form_type: 'app_feedback_image', form_session: session, upload_id: id, image_json: image };
  assert.equal(r.post({ ...data, website: 'robot' }).ok, false);
  assert.equal(r.post({ ...data, form_session: 'invalid' }).ok, false);
  assert.equal(r.post(data).error, 'invalid_image');
  assert.equal(r.files.length, 0);
  assert.equal([...r.cached.keys()].filter(key => key.startsWith('feedback-image-')).length, 0);
});

test('evicted image chunks report expiry without creating Drive files', () => {
  const r = setup(), session = 'a'.repeat(32), image = { name: 'dummy.png', mime: 'image/png', base64: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') };
  const staged = r.post({ form_type: 'app_feedback_image', form_session: session, upload_id: '9'.repeat(32), image_json: JSON.stringify(image) });
  r.cached.delete('feedback-image-' + staged.token + '-0');
  const ticket = [{ section: 'Overview', type: 'Bug', area: 'Technical', description: 'example', attachments: [{ token: staged.token }] }];
  assert.equal(r.post({ form_type: 'app_feedback', form_session: session, tickets_json: JSON.stringify(ticket) }).error, 'image_expired');
  assert.equal(r.files.length, 0);
});

test('expired and over-capacity staged images fail without creating Drive files', () => {
  const r = setup(), session = 'd'.repeat(32), image = { name: 'dummy.png', mime: 'image/png', base64: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') };
  const staged = r.post({ form_type: 'app_feedback_image', form_session: session, upload_id: 'e'.repeat(32), image_json: JSON.stringify(image) });
  r.advance(21601000);
  const ticket = [{ section: 'Overview', type: 'Bug', area: 'Technical', description: 'example', attachments: [{ token: staged.token }] }];
  assert.equal(r.post({ form_type: 'app_feedback', form_session: session, tickets_json: JSON.stringify(ticket) }).error, 'image_expired');
  const hour = Math.floor((Date.now() + 21601000) / 3600000);
  r.props.APP_FEEDBACK_STAGE_USAGE = JSON.stringify({ [hour]: { chunks: 300 } });
  assert.equal(r.post({ form_type: 'app_feedback_image', form_session: session, upload_id: 'f'.repeat(32), image_json: JSON.stringify(image) }).error, 'upload_capacity');
  assert.equal(r.files.length, 0);
});

test('ten selected images can be sent together and a failed write remains retryable', () => {
  const r = setup(), session = '1'.repeat(32);
  const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(90000)]);
  const image = { name: 'dummy.png', mime: 'image/png', base64: bytes.toString('base64') };
  const tokens = Array.from({ length: 10 }, (_, i) => {
    const result = r.post({ form_type: 'app_feedback_image', form_session: session,
      upload_id: i.toString(16).padStart(32, '0'), image_json: JSON.stringify(image) });
    assert.equal(result.ok, true); return result.token;
  });
  assert.equal(r.files.length, 0);
  const tickets = [0, 1].map(i => ({ section: 'Overview', type: 'Bug', area: 'Technical', description: `ticket ${i}`,
    attachments: tokens.slice(i * 5, i * 5 + 5).map(token => ({ token })) }));
  const post = () => r.post({ form_type: 'app_feedback', form_session: session, tickets_json: JSON.stringify(tickets) });
  r.fail(true); assert.equal(post().error, 'save_failed');
  assert.equal(r.files.filter(file => !file.trashed).length, 0);
  r.fail(false); assert.equal(post().ok, true);
  assert.equal(r.files.filter(file => !file.trashed).length, 10);
  assert.equal(r.tabs['App Feedback'].rows.length, 3);
});
test('started_at: only an instant submission is refused; wrong clocks and old tabs are not', () => {
  const r = setup();
  const at = ms => signup(r.tabs && Math.floor(Math.random() * 1e6), { started_at: String(Date.now() + ms) });
  assert.equal(r.post(at(-100)).error, 'invalid_submission');      // opened 100 ms ago
  assert.equal(r.post(at(-2000)).ok, true);                         // normal
  assert.equal(r.post(at(-3 * 24 * 3600 * 1000)).ok, true);         // tab open for days
  assert.equal(r.post(at(10 * 60 * 1000)).ok, true);                // device clock 10 minutes ahead
});
