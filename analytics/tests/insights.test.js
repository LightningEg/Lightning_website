// analytics/insights.js (the console's aggregation) must give the same answer as the receiver's analyticsInsights_ on the same
// page views. Uses the sample data of gen-data.js:   node analytics/tests/gen-data.js /tmp/d.json && node analytics/tests/insights.test.js /tmp/d.json
const fs = require('fs'), assert = require('assert');
const I = require('../insights.js');
const data = JSON.parse(fs.readFileSync(process.argv[2] || 'dash-data.json', 'utf8'));
let failed = 0;
const test = (name, fn) => { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n', e.message.slice(0, 600)); } };
const strip = a => { const c = JSON.parse(JSON.stringify(a)); delete c.meta; return c; };
for (const [label, days, expected] of [['28 days', 28, data.insights28], ['56 days', 56, data.insights56]]) {
  test(`same answer as the receiver over ${label}`, () => {
    const mine = strip(I.build(data.rows, days, Date.now()));
    const theirs = strip(expected);
    // by_release timestamps are compared as instants; the receiver sorts ties by row order, so compare as sets
    const key = o => JSON.stringify(o);
    for (const k of Object.keys(theirs)) {
      if (Array.isArray(theirs[k]) && ['by_release', 'reach', 'pages', 'usage', 'download_builds'].includes(k)) {
        assert.deepStrictEqual(mine[k].map(key).sort(), theirs[k].map(key).sort(), k);
      } else assert.deepStrictEqual(mine[k], theirs[k], k);
    }
    assert.deepStrictEqual(Object.keys(mine).sort(), Object.keys(theirs).sort());
  });
}
test('no rows is an empty answer, not an error', () => {
  const a = I.build([], 28, Date.now());
  assert.strictEqual(a.views, 0); assert.deepStrictEqual(a.daily, []);
});
test('a source folds to one name, and a campaign tag wins', () => {
  assert.strictEqual(I.source('', 'www.google.com.eg'), 'google'); assert.strictEqual(I.source('Reddit', 'x.example'), 'reddit'); assert.strictEqual(I.source('', ''), 'direct');
});
process.exit(failed ? 1 : 0);
