const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function setup() {
  const tabs = {}, props = {}, cached = new Map();
  let now = Date.now(), broken = false, locked = false;
  const cache = { get(k) { const v = cached.get(k); return v && v.expiry > now ? v.value : null; },
    put(k, value, ttl) { cached.set(k, { value, expiry: now + ttl * 1000 }); }, remove: k => cached.delete(k) };
  const book = { getSheetByName: n => tabs[n] || null, insertSheet(n) {
    const rows = [];
    return tabs[n] = { rows, getLastRow: () => rows.length,
      appendRow: r => rows.push(r), setFrozenRows() {},
      getRange(r, c, n, w) { return { getValues: () => rows.slice(r - 1, r - 1 + n).map(row => row.slice(c - 1, c - 1 + w)),
        setValues(values) { if (broken) throw new Error('storage failure'); values.forEach((row, i) => { rows[r - 1 + i] = row; }); } }; } };
  } };
  const context = vm.createContext({ Date: class extends Date { static now() { return now; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ getContent: () => t, setMimeType() { return this; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => props[k] = v }) },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked, false, 'locks never nest'); locked = true; }, releaseLock() { locked = false; } }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => book, openById: () => book },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, text) => [...crypto.createHash('sha256').update(text).digest()] },
    analyticsJourneys_: (data, method) => ({ getContent: () => JSON.stringify({ method, keyFromBody: data.key }) }),
    saveAnalyticsEvents_: data => ({ getContent: () => JSON.stringify({ event: data.payload }) })
  });
  for (const file of ['WebsiteReceiver.gs', 'AppFeedbackReceiverPatch.gs', 'UXTestsReceiverPatch.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  const post = (values, query = {}) => {
    const contents = new URLSearchParams(values).toString();
    return JSON.parse(context.doPost({ postData: { contents, type: 'application/x-www-form-urlencoded;charset=UTF-8' }, parameter: query }).getContent());
  };
  return { context, post, tabs, props, cached, advance: ms => { now += ms; }, fail: yes => { broken = yes; } };
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
