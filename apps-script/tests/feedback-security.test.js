// Run: node --test apps-script/tests/feedback-security.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function receiver(file, exported) {
  const rows = [], props = {}, logs = [];
  let decodes = 0;
  const sheet = { getLastRow: () => rows.length, getLastColumn: () => rows[0].length,
    appendRow: row => rows.push(row), setFrozenRows() {},
    getRange: (r, c, n, w) => ({ getValues: () => [rows[0]], setValues: values => rows.push(...values) }) };
  const context = vm.createContext({ console: { error() {} }, Logger: { log: x => logs.push(x) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ t, setMimeType() { return this; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => props[k] = v }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => rows.length ? sheet : null, insertSheet: () => sheet }) },
    Utilities: { base64Decode() { decodes++; throw new Error('decode must not be reached'); } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return { call: data => context[exported](data), rows, props, logs, decodes: () => decodes };
}
const ticket = { section: 'Overview', type: 'bug', area: 'app', description: 'Example', attachments: [] };
const appData = tickets => ({ tickets_json: JSON.stringify(tickets) });
const uxData = feedback => ({ feedback_json: JSON.stringify(feedback) });

for (const prefix of ['=', '+', '-', '@', '\t=', '\r\n=']) {
  test(`app and UX store ${JSON.stringify(prefix)} as literal text`, () => {
    const a = receiver('AppFeedbackReceiverPatch.gs', 'saveAppFeedback_');
    const evil = prefix + '1+1';
    const response = JSON.parse(a.call({ ...appData([{ ...ticket, section: evil, description: evil }]), reporter_name: evil, page_url: evil }).t);
    assert.equal(response.ok, true);
    for (const index of [3, 6, 7, 11]) assert.equal(a.rows[1][index], "'" + evil);
    const u = receiver('UXTestsReceiverPatch.gs', 'saveUxTest_');
    u.call({ ...uxData([{ reaction: evil, title: evil, reasons: [evil] }]), page_url: evil });
    for (const index of [3, 4, 5, 6]) assert.equal(u.rows[1][index], "'" + evil);
  });
}
test('limits apply to all feedback metadata; normal strings and row types survive', () => {
  const a = receiver('AppFeedbackReceiverPatch.gs', 'saveAppFeedback_');
  a.call({ ...appData([ticket]), page_url: 'x'.repeat(6000), reporter_name: 'Alex' });
  assert.equal(a.rows[1][7].length, 2000);
  assert.equal(a.rows[1][11], 'Alex');
  assert.equal(a.rows[1][9], 1);
  assert.equal(Object.prototype.toString.call(a.rows[1][0]), '[object Date]');
});
test('invalid JSON, non-arrays, oversized arrays and filled honeypots never write', () => {
  for (const [file, name, field] of [['AppFeedbackReceiverPatch.gs', 'saveAppFeedback_', 'tickets_json'], ['UXTestsReceiverPatch.gs', 'saveUxTest_', 'feedback_json']]) {
    const r = receiver(file, name);
    for (const payload of ['{', '{}', JSON.stringify(Array(31).fill(ticket))]) r.call({ [field]: payload });
    r.call({ [field]: JSON.stringify([{ ...ticket, reaction: 'liked' }]), website: 'robot' });
    assert.equal(r.rows.length, 0);
  }
});
test('reject too many screenshots before decoding any image', () => {
  const a = receiver('AppFeedbackReceiverPatch.gs', 'saveAppFeedback_');
  const tickets = Array.from({ length: 3 }, () => ({ ...ticket, attachments: Array(4).fill({ mime: 'image/png', base64: 'AAAA' }) }));
  assert.equal(JSON.parse(a.call(appData(tickets)).t).error, 'invalid_submission');
  assert.equal(a.decodes(), 0);
  assert.equal(a.rows.length, 0);
});
test('daily feedback quota prevents further rows, resets on a later day', () => {
  for (const [file, name, prop, data] of [
    ['AppFeedbackReceiverPatch.gs', 'saveAppFeedback_', 'APP_FEEDBACK_USAGE', appData([ticket])],
    ['UXTestsReceiverPatch.gs', 'saveUxTest_', 'UX_FEEDBACK_USAGE', uxData([{ reaction: 'liked' }])]
  ]) {
    const r = receiver(file, name);
    r.props[prop] = JSON.stringify({ day: new Date().toISOString().slice(0, 10), rows: 1000, bytes: 0 });
    r.call(data); assert.equal(r.rows.length, 0);
    r.props[prop] = JSON.stringify({ day: '2000-01-01', rows: 1000, bytes: 0 });
    r.call(data); assert.equal(r.rows.length, 2);
  }
});
test('daily Drive byte cap prevents storage writes', () => {
  const r = receiver('AppFeedbackReceiverPatch.gs', 'saveAppFeedback_');
  r.props.APP_FEEDBACK_USAGE = JSON.stringify({ day: new Date().toISOString().slice(0, 10), rows: 0, bytes: 100 * 1024 * 1024 + 1 });
  assert.equal(JSON.parse(r.call(appData([ticket])).t).error, 'daily_limit');
  assert.equal(r.rows.length, 0);
});
