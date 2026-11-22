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
// The new window expressions are the replacement strings in the migration ('' is a quote inside the SQL literal).
const replaced = [...sql.matchAll(/'(\(date_trunc\(''day''.+?at time zone ''Africa\/Cairo'')'\);/g)].map(m => m[1].replaceAll("''", "'"));
const formula = name => replaced[name === 't0' ? 0 : 1];
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

await test('the live definitions are edited in place, and the migration stops if they changed', async () => {
  // Load every migration on a stub database: the edit finds its line, and the functions keep their guard and grants.
  const pg = new mod.PGlite(), { readdirSync } = await import('node:fs');
  await pg.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now(), last_sign_in_at timestamptz);
    create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade, provider text not null, provider_id text not null, identity_data jsonb not null default '{}', created_at timestamptz not null default now(), unique (provider, provider_id));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;`);
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) await pg.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  for (const fn of ['public.admin_sales(integer)', 'public.admin_dashboard()']) {
    const def = (await pg.query(`select pg_get_functiondef($1::regprocedure) d`, [fn])).rows[0].d;
    assert.match(def, /\(date_trunc\('day', now\(\) at time zone 'Africa\/Cairo'\) - (make_interval\(days => d - 1\)|interval '29 days')\) at time zone 'Africa\/Cairo'/, fn);
    assert.match(def, /require_mfa_admin/, fn);
    assert.match(def, /SECURITY DEFINER/, fn);
    const priv = (await pg.query(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') u`, [fn])).rows[0];
    assert.deepEqual([priv.a, priv.u], [false, true], fn);
  }
  const dash = (await pg.query(`select pg_get_functiondef('public.admin_dashboard()'::regprocedure) d`)).rows[0].d;
  assert.match(dash, /details_submitted_at/, 'the InstaPay edit to admin_dashboard is kept');
  await assert.rejects(pg.exec(sql), /admin_sales changed/, 'run twice, it refuses instead of editing blind');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
