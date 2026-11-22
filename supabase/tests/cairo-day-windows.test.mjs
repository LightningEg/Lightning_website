// The owner's 30-day windows (supabase/migrations/20261122090000_cairo_day_windows.sql) start on a Cairo calendar day.
// now() cannot be faked, so the window formulas are read from the migration and run at fixed instants, the one that
// failed CI (00:57 Cairo on 21 Nov 2026, 22 days after summer time ended) among them.
//
//   PGLITE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/cairo-day-windows.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const mod = process.env.PGLITE_PATH ? await import(pathToFileURL(process.env.PGLITE_PATH).href) : await import('@electric-sql/pglite');
const db = new mod.PGlite();
const sql = readFileSync(new URL('../migrations/20261122090000_cairo_day_windows.sql', import.meta.url), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e.stack || e).split('\n').slice(0, 3).join('\n     ')); }
}
const formula = name => new RegExp(`${name} timestamptz := (.+);`).exec(sql)[1];
// The daily series each function draws: from the window's start, a row per Cairo day up to now.
async function days(start, at) {
  const s = start.replaceAll('now()', `'${at}'::timestamptz`).replace('make_interval(days => d - 1)', "interval '29 days'");
  const r = await db.query(`select count(*)::int n, min(to_char(g, 'YYYY-MM-DD HH24:MI')) first
    from generate_series((${s}) at time zone 'Africa/Cairo', '${at}'::timestamptz at time zone 'Africa/Cairo', interval '1 day') g`);
  return r.rows[0];
}
const INSTANTS = ['2026-11-21T22:57:00Z', '2026-11-21T23:30:00Z', '2026-11-21T12:00:00Z', '2026-10-31T21:30:00Z',
  '2026-07-15T21:30:00Z', '2026-04-30T22:30:00Z', '2026-12-31T21:59:00Z'];

for (const name of ['t0', 'd0']) {
  await test(`${name}: 30 Cairo days from midnight, whatever the clock did`, async () => {
    for (const at of INSTANTS) {
      const got = await days(formula(name), at);
      assert.equal(got.n, 30, `${at}: ${got.n} days`);
      assert.match(got.first, / 00:00$/, `${at}: starts at ${got.first}`);
    }
  });
}

await test('the old formula lost a day in the hour after Cairo midnight (why this migration exists)', async () => {
  const old = "date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' - interval '29 days'";
  assert.equal((await days(old, '2026-11-21T22:57:00Z')).n, 29);
  assert.equal((await days(old, '2026-11-21T23:30:00Z')).n, 30);
});

await test('both functions are replaced, guarded and granted as before', async () => {
  assert.match(sql, /create or replace function public\.admin_sales\(p_days integer default 30\)/);
  assert.match(sql, /create or replace function public\.admin_dashboard\(\)/);
  assert.equal((sql.match(/perform private\.require_mfa_admin\(\);/g) || []).length, 2);
  assert.equal((sql.match(/security definer set search_path = ''/g) || []).length, 2);
  assert.match(sql, /revoke all on function public\.admin_sales\(integer\), public\.admin_dashboard\(\) from public, anon;/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
