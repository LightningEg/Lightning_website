// Tests for the public showcase (supabase/migrations/20261025110000_forgeeks_showcase.sql):
// get_profile, get_profile_work, member_directory, report_profile, admin_resolve_report.
//
// Runs every migration in order on PGlite (Postgres compiled to WebAssembly) with Supabase's roles
// and auth.uid() stubbed, then checks the rules as each role.
//
//   npm i --no-save @electric-sql/pglite
//   node supabase/tests/showcase.test.mjs

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const mod = process.env.PGLITE_PATH
  ? await import(pathToFileURL(process.env.PGLITE_PATH).href)
  : await import('@electric-sql/pglite');
const db = new mod.PGlite();

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADA = id(1), BEN = id(2), CY = id(3), DEE = id(4), EVE = id(5), ZED = id(6), OPS = id(7), RAE = id(8), QUINN = id(9);

// ---- stub the parts of Supabase the migrations depend on
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade, provider text not null, provider_id text not null, identity_data jsonb not null default '{}', created_at timestamptz not null default now(), unique (provider, provider_id));
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`);
for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  await db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
}

await db.exec(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);

async function as(role, uid, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
const q = (sql, params) => db.query(sql, params);
const anon = fn => as('anon', null, fn);
const member = (uid, fn) => as('authenticated', uid, fn);

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}
const refused = (p, re, code) => assert.rejects(p, e => {
  assert.match(e.message, re);
  if (code) assert.equal(e.code, code);
  return true;
});

// ---- people
await q(`insert into auth.users (id, email) values
  ($1, 'ada@example.test'), ($2, 'ben@example.test'), ($3, 'cy@example.test'), ($4, 'dee@example.test'),
  ($5, 'eve@example.test'), ($6, 'zed@example.test'), ($7, 'ops@example.test'), ($8, 'rae@example.test'), ($9, 'quinn@example.test')`,
  [ADA, BEN, CY, DEE, EVE, ZED, OPS, RAE, QUINN]);
await q(`insert into public.admin_roles (user_id, role) values ($1, 'admin')`, [OPS]);
await q(`insert into public.catalog_items (id, type, name, price) values ('banner-aurora', 'banner', 'Aurora', 60)`);

const award = (user, amount, source, extra = {}) =>
  as('service_role', null, () => q(
    `select * from public.award_coins($1, 'contribution_award', $2, 'pr', $3, 'Merged PR', coalesce($4::timestamptz, now()), 'primary', $5::jsonb)`,
    [user, amount, source, extra.earned ?? null, extra.contribution ? JSON.stringify(extra.contribution) : null]));
const pr = (n, title, mergedAt) => ({ repository: 'LightningEg/Lightning', issue_number: n, pr_number: n + 100, title,
  url: `https://github.com/LightningEg/Lightning/pull/${n + 100}`, merged_at: mergedAt });
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString();

// Private details that must never come back: email, real name, phone, birth date, wallet.
await member(ADA, async () => {
  await q(`update public.profiles set full_name = 'Ada Lovelace', phone = '+201000000001', birth_date = '1990-05-05' where user_id = $1`, [ADA]);
  await q(`update public.member_profiles set display_name = 'Ada', adult_confirmed = true, visibility = 'public', bio = 'I build budgets.',
    avatar_url = 'https://example.test/ada.png', show_work = true, show_setup = true, show_on_leaderboard = true,
    setup_editor = 'Neovim', setup_os = 'Arch Linux', setup_languages = array['Python','SQL'], setup_tools = array['git','tmux'],
    setup_notes = 'Dotfiles are boring.', dotfiles_url = 'https://example.test/dots', portfolio_url = 'https://example.test/ada' where user_id = $1`, [ADA]);
  await q(`insert into public.profile_links (user_id, label, url) values ($1, 'My CLI', 'https://example.test/cli')`, [ADA]);
});
await member(BEN, () => q(`update public.member_profiles set display_name = 'Ben', adult_confirmed = true, visibility = 'members',
  bio = 'Members only.', show_work = true, show_on_leaderboard = true where user_id = $1`, [BEN]));
await member(CY, () => q(`update public.member_profiles set display_name = 'Cy', bio = 'Private.', show_setup = true, show_work = true, setup_editor = 'Emacs' where user_id = $1`, [CY]));
await member(DEE, () => q(`update public.member_profiles set display_name = 'Dee', adult_confirmed = true, visibility = 'public',
  bio = 'Public, off the board.', show_work = false, show_on_leaderboard = false where user_id = $1`, [DEE]));
await member(EVE, () => q(`update public.member_profiles set display_name = 'Eve', adult_confirmed = true, visibility = 'public',
  show_work = true, show_on_leaderboard = true where user_id = $1`, [EVE]));
await member(ZED, () => q(`update public.member_profiles set display_name = 'Zed', adult_confirmed = true, visibility = 'public', show_on_leaderboard = true where user_id = $1`, [ZED]));

// Ada: 150 this month + 100 three months ago. Eve: 150 this month. Ben: 50. Dee: 300 but not on the board. Zed: none.
await award(ADA, 150, 'LightningEg/Lightning#101', { contribution: pr(1, 'Round money once', daysAgo(2)) });
await award(ADA, 100, 'LightningEg/Lightning#102', { earned: daysAgo(90), contribution: pr(2, 'Older fix', daysAgo(90)) });
await award(EVE, 150, 'LightningEg/Lightning#103', { contribution: pr(3, 'Eve fix', daysAgo(1)) });
await award(BEN, 50, 'LightningEg/Lightning#104', { contribution: pr(4, 'Ben fix', daysAgo(3)) });
await award(DEE, 300, 'LightningEg/Lightning#105', { contribution: pr(5, 'Dee fix', daysAgo(4)) });

const profile = (name) => q(`select * from public.get_profile($1)`, [name]).then(r => r.rows);
const work = (name) => q(`select * from public.get_profile_work($1)`, [name]).then(r => r.rows);

// ------------------------------------------------------------ visibility
await test('get_profile: private never shows, members need sign-in, public shows to everyone (anon, other member, self)', async () => {
  const seen = async (role, uid, name) => (await as(role, uid, () => profile(name))).length;
  // private (Cy): nobody, the owner included, the same as profile_directory
  assert.equal(await seen('anon', null, 'Cy'), 0);
  assert.equal(await seen('authenticated', BEN, 'Cy'), 0);
  assert.equal(await seen('authenticated', CY, 'Cy'), 0);
  // members (Ben)
  assert.equal(await seen('anon', null, 'Ben'), 0);
  assert.equal(await seen('authenticated', ADA, 'Ben'), 1);
  assert.equal(await seen('authenticated', BEN, 'Ben'), 1);
  // public (Ada)
  assert.equal(await seen('anon', null, 'Ada'), 1);
  assert.equal(await seen('authenticated', BEN, 'Ada'), 1);
  assert.equal(await seen('authenticated', ADA, 'Ada'), 1);
  // not there at all looks the same as private
  assert.equal(await seen('anon', null, 'Nobody'), 0);
});

await test('get_profile: the same rows as profile_directory, and the same columns it exposes', async () => {
  await anon(async () => {
    const d = (await q(`select * from public.profile_directory where display_name = 'Ada'`)).rows[0];
    const p = (await profile('Ada'))[0];
    for (const k of Object.keys(d)) assert.deepEqual(p[k], d[k], k);
    assert.equal(p.display_name, 'Ada');
    assert.equal(p.bio, 'I build budgets.');
    assert.equal(p.setup_editor, 'Neovim');
    assert.deepEqual(p.setup_languages, ['Python', 'SQL']);
    assert.equal(p.dotfiles_url, 'https://example.test/dots');
    assert.equal(p.visibility, 'public');
  });
});

await test('get_profile: a section the member left off stays empty even on a public profile', async () => {
  await member(ADA, () => q(`update public.member_profiles set show_setup = false where user_id = $1`, [ADA]));
  await anon(async () => {
    const p = (await profile('Ada'))[0];
    assert.equal(p.bio, 'I build budgets.');
    for (const k of ['setup_editor', 'setup_os', 'setup_languages', 'setup_tools', 'setup_notes', 'dotfiles_url', 'portfolio_url']) assert.equal(p[k], null, k);
  });
  await member(ADA, () => q(`update public.member_profiles set show_setup = true where user_id = $1`, [ADA]));
});

await test('lookup is exact and case-insensitive; wildcards and partial names match nothing', async () => {
  await anon(async () => {
    for (const n of ['Ada', 'ada', 'ADA', 'aDa']) assert.equal((await profile(n))[0]?.display_name, 'Ada', n);
    for (const n of ['Ad', 'Adam', 'Ada ', ' Ada', 'A%', '%', '_da', 'Ada%', '', null]) assert.equal((await profile(n)).length, 0, String(n));
  });
});

await test('suspended profiles disappear from every public function and come back when restored', async () => {
  await member(OPS, () => q(`select public.admin_suspend_profile($1, true, 'Spam')`, [EVE]));
  await anon(async () => {
    assert.equal((await profile('Eve')).length, 0);
    assert.equal((await work('Eve')).length, 0);
    assert.ok((await q(`select display_name from public.member_directory(60, 0)`)).rows.every(r => r.display_name !== 'Eve'));
    assert.ok((await q(`select display_name from public.leaderboard('all')`)).rows.every(r => r.display_name !== 'Eve'));
  });
  await member(RAE, () => refused(q(`select public.report_profile('Eve', 'x')`), /profile not found/, 'P0002'));
  await member(OPS, () => q(`select public.admin_suspend_profile($1, false, 'Reviewed')`, [EVE]));
  await anon(async () => assert.equal((await profile('Eve')).length, 1));
});

// ------------------------------------------------------------ nothing private leaks
const SHOWN = ['display_name', 'avatar_url', 'bio', 'visibility', 'setup_editor', 'setup_os', 'setup_languages', 'setup_tools', 'setup_notes',
  'dotfiles_url', 'portfolio_url', 'contribution_score', 'banner_item_id', 'rank_all', 'rank_month', 'frame_item_id', 'badge_item_id'];
const FORBIDDEN = /user_id|email|phone|birth|full_name|balance|wallet|purchase|inventory|suspended|marketing|adult_confirmed|show_|created_at|updated_at|reporter|ledger/i;

await test('no private column or value is returned: exact key lists, and none of the private details appear in any output', async () => {
  const everything = async () => {
    const out = [];
    out.push(...(await profile('Ada')), ...(await work('Ada')), ...(await q(`select * from public.member_directory(60, 0)`)).rows);
    return out;
  };
  for (const [role, uid] of [['anon', null], ['authenticated', BEN], ['authenticated', ADA]]) {
    const rows = await as(role, uid, everything);
    const text = JSON.stringify(rows, (k, v) => typeof v === 'bigint' ? Number(v) : v);
    for (const secret of ['ada@example.test', 'Ada Lovelace', '+201000000001', '1990-05-05', '00000000-0000-4000']) assert.ok(!text.includes(secret), `${role} saw ${secret}`);
    for (const k of new Set(rows.flatMap(r => Object.keys(r)))) assert.doesNotMatch(k, FORBIDDEN, `${role} got column ${k}`);
  }
  await anon(async () => {
    assert.deepEqual(Object.keys((await profile('Ada'))[0]), SHOWN);
    assert.deepEqual(Object.keys((await work('Ada'))[0]), ['display_name', 'repository', 'issue_number', 'pr_number', 'title', 'url', 'merged_at', 'verified']);
    assert.deepEqual(Object.keys((await q(`select * from public.member_directory()`)).rows[0]),
      ['display_name', 'avatar_url', 'bio', 'setup_editor', 'setup_os', 'setup_languages', 'setup_tools', 'contribution_score', 'banner_item_id', 'frame_item_id', 'badge_item_id']);
  });
});

await test('the tables behind the functions stay closed to visitors', async () => {
  await anon(async () => {
    await refused(q(`select * from public.member_profiles`), /permission denied/);
    await refused(q(`select * from public.wallets`), /permission denied/);
    await refused(q(`select * from public.profile_reports`), /permission denied/);
    await refused(q(`select * from private.leaderboard_ranks('all')`), /permission denied/);
  });
  await member(BEN, async () => {
    await refused(q(`select * from private.leaderboard_ranks('all')`), /permission denied/);
    assert.equal((await q(`select * from public.wallets where user_id <> $1`, [BEN])).rows.length, 0);
  });
});

// ------------------------------------------------------------ ranks
await test('ranks appear only for members on the leaderboard; ties share a rank; a lower rank follows a tie', async () => {
  await anon(async () => {
    const ada = (await profile('Ada'))[0];
    assert.deepEqual([Number(ada.rank_all), Number(ada.rank_month), ada.contribution_score], [1, 1, 250]);
    const eve = (await profile('Eve'))[0];
    assert.deepEqual([Number(eve.rank_all), Number(eve.rank_month)], [2, 1]); // 150 this month, tied with Ada
  });
  await member(ADA, async () => {
    const ben = (await profile('Ben'))[0];
    assert.deepEqual([Number(ben.rank_all), Number(ben.rank_month)], [3, 3]); // rank 3 after two share rank 1
  });
});

await test('a member who is not on the leaderboard shows no score and no rank, even with coins', async () => {
  await anon(async () => {
    const dee = (await profile('Dee'))[0];
    assert.equal(dee.contribution_score, null);
    assert.equal(dee.rank_all, null);
    assert.equal(dee.rank_month, null);
    assert.ok((await q(`select * from public.leaderboard('all')`)).rows.every(r => r.display_name !== 'Dee'));
  });
  // turning the switch off removes Ada's rank at once; turning it on restores it
  await member(ADA, () => q(`update public.member_profiles set show_on_leaderboard = false where user_id = $1`, [ADA]));
  await anon(async () => {
    const ada = (await profile('Ada'))[0];
    assert.deepEqual([ada.contribution_score, ada.rank_all, ada.rank_month], [null, null, null]);
    assert.equal(Number((await profile('Eve'))[0].rank_all), 1);
  });
  await member(ADA, () => q(`update public.member_profiles set show_on_leaderboard = true where user_id = $1`, [ADA]));
});

await test('on the board with no contributions yet: score 0, no rank', async () => {
  await anon(async () => {
    const zed = (await profile('Zed'))[0];
    assert.equal(zed.contribution_score, 0);
    assert.equal(zed.rank_all, null);
    assert.equal(zed.rank_month, null);
  });
});

await test('ranks agree with leaderboard() for every member on it, both periods', async () => {
  await member(DEE, async () => { // signed in, so the members-only profile on the board is readable too
    for (const period of ['all', 'month']) {
      const board = (await q(`select * from public.leaderboard($1)`, [period])).rows;
      assert.ok(board.length >= 2);
      for (const row of board) {
        const p = (await profile(row.display_name))[0];
        assert.equal(Number(p['rank_' + period]), Number(row.rank), `${row.display_name} ${period}`);
      }
    }
  });
});

await test('spending coins never changes a rank', async () => {
  const before = await anon(async () => (await profile('Ada'))[0]);
  await q(`insert into public.inventory (user_id, item_id) values ($1, 'banner-aurora')`, [ADA]); // owned, as after a purchase
  await as('service_role', null, () => q(`select * from public.award_coins($1, 'admin_gift', 5, 'gift', 'g1', 'Thanks')`, [ADA]));
  const after = await anon(async () => (await profile('Ada'))[0]);
  assert.deepEqual([after.rank_all, after.rank_month, after.contribution_score], [before.rank_all, before.rank_month, before.contribution_score]);
});

// ------------------------------------------------------------ banner
await test('the equipped banner id comes with the profile and the directory; nothing else about cosmetics does', async () => {
  await anon(async () => assert.equal((await profile('Ada'))[0].banner_item_id, null));
  await member(ADA, () => q(`select * from public.equip_item('banner-aurora')`));
  await anon(async () => {
    assert.equal((await profile('Ada'))[0].banner_item_id, 'banner-aurora');
    assert.equal((await q(`select banner_item_id from public.member_directory(60, 0) where display_name = 'Ada'`)).rows[0].banner_item_id, 'banner-aurora');
  });
  await member(ADA, () => q(`select public.unequip_slot('banner')`));
  await anon(async () => assert.equal((await profile('Ada'))[0].banner_item_id, null));
});

// ------------------------------------------------------------ work
await test('get_profile_work: verified first and newest merged first, then self-reported links; hidden entries left out', async () => {
  await anon(async () => {
    const rows = await work('ada');
    assert.deepEqual(rows.map(r => [r.title, r.verified]), [['Round money once', true], ['Older fix', true], ['My CLI', false]]);
    assert.equal(rows[0].url, 'https://github.com/LightningEg/Lightning/pull/101');
    assert.equal(rows[0].repository, 'LightningEg/Lightning');
    assert.equal(rows[2].repository, null);
    assert.equal(rows[2].merged_at, null);
  });
  await member(ADA, () => q(`update public.contributions set hidden = true where pr_number = 102`));
  await anon(async () => assert.deepEqual((await work('Ada')).map(r => r.title), ['Round money once', 'My CLI']));
  await member(ADA, () => q(`update public.contributions set hidden = false where pr_number = 102`));
});

await test('get_profile_work: empty when work is off, the profile is private, or it is members-only and you are signed out', async () => {
  await anon(async () => {
    assert.equal((await work('Dee')).length, 0); // show_work off, though she has a merged PR
    assert.equal((await work('Cy')).length, 0);
    assert.equal((await work('Ben')).length, 0);
    assert.equal((await work('Nobody')).length, 0);
  });
  await member(ADA, async () => assert.deepEqual((await work('Ben')).map(r => r.title), ['Ben fix']));
});

// ------------------------------------------------------------ directory
await test('member_directory: visible profiles by score then name; members-only ones need sign-in', async () => {
  await anon(async () => {
    const names = (await q(`select display_name from public.member_directory()`)).rows.map(r => r.display_name);
    assert.deepEqual(names, ['Ada', 'Eve', 'Zed', 'Dee']); // 250, 150, 0, then no score
  });
  await member(DEE, async () => {
    const names = (await q(`select display_name from public.member_directory()`)).rows.map(r => r.display_name);
    assert.deepEqual(names, ['Ada', 'Eve', 'Ben', 'Zed', 'Dee']);
  });
});

await test('member_directory: limit and offset are clamped and page cleanly', async () => {
  await member(DEE, async () => {
    const page = async (l, o) => (await q(`select display_name from public.member_directory($1, $2)`, [l, o])).rows.map(r => r.display_name);
    assert.deepEqual(await page(2, 0), ['Ada', 'Eve']);
    assert.deepEqual(await page(2, 2), ['Ben', 'Zed']);
    assert.deepEqual(await page(2, 4), ['Dee']);
    assert.deepEqual(await page(2, 99), []);
    assert.equal((await page(0, 0)).length, 1);
    assert.equal((await page(-5, 0)).length, 1);
    assert.deepEqual(await page(1, -3), ['Ada']);
    assert.equal((await page(null, null)).length, 5);
  });
  await q(`insert into auth.users (id, email) select gen_random_uuid(), 'bulk' || n || '@example.test' from generate_series(1, 70) n`);
  await q(`update public.member_profiles m set visibility = 'public', adult_confirmed = true from auth.users u where u.id = m.user_id and u.email like 'bulk%'`);
  await anon(async () => {
    assert.equal((await q(`select * from public.member_directory(1000, 0)`)).rows.length, 60);
    assert.equal((await q(`select * from public.member_directory(1000, 60)`)).rows.length, 70 + 4 - 60);
  });
  await q(`delete from auth.users where email like 'bulk%'`);
});

// ------------------------------------------------------------ reports
const report = (uid, name, reason = 'Spam links') => member(uid, () => q(`select public.report_profile($1, $2)`, [name, reason]));
const openReports = () => q(`select * from public.profile_reports order by id`).then(r => r.rows);

await test('report_profile: signed-in members only; visitors cannot call it', async () => {
  await anon(() => refused(q(`select public.report_profile('Ada', 'x')`), /permission denied/));
  await anon(() => refused(q(`insert into public.profile_reports (target_user, reporter, reason) values ($1, $1, 'x')`, [ADA]), /permission denied/));
  await member(RAE, async () => {
    await refused(q(`insert into public.profile_reports (target_user, reporter, reason) values ($1, $2, 'x')`, [ADA, RAE]), /permission denied/);
    await refused(q(`update public.profile_reports set status = 'dismissed'`), /permission denied/);
  });
  assert.equal((await openReports()).length, 0);
});

await test('report_profile: a visible profile can be reported; the report keeps the reporter and target ids for admins', async () => {
  await report(RAE, 'ada', '  Pretends to be staff.  ');
  const r = (await openReports())[0];
  assert.equal(r.target_user, ADA);
  assert.equal(r.reporter, RAE);
  assert.equal(r.reason, 'Pretends to be staff.');
  assert.equal(r.status, 'open');
  assert.equal(r.resolved_at, null);
  await report(RAE, 'Ben'); // members-only is visible to a signed-in reporter
  assert.equal((await openReports()).length, 2);
});

await test('report_profile: your own profile, a private, suspended or missing one are refused, the last three with the same words', async () => {
  await member(ADA, () => refused(q(`select public.report_profile('ada', 'x')`), /cannot report your own/));
  const same = [];
  for (const name of ['Cy', 'Nobody', 'Eve']) {
    if (name === 'Eve') await member(OPS, () => q(`select public.admin_suspend_profile($1, true, 'Spam')`, [EVE]));
    await member(RAE, () => assert.rejects(q(`select public.report_profile($1, 'x')`, [name]), e => { same.push([e.message, e.code]); return true; }));
  }
  await member(OPS, () => q(`select public.admin_suspend_profile($1, false, 'Reviewed')`, [EVE]));
  assert.equal(new Set(same.map(s => s.join('|'))).size, 1);
  assert.match(same[0][0], /profile not found/);
  await member(RAE, () => refused(q(`select public.report_profile(null, 'x')`), /profile not found/));
});

await test('report_profile: the reason must be 1 to 500 characters', async () => {
  await member(QUINN, async () => {
    await refused(q(`select public.report_profile('Ada', '')`), /1 to 500/);
    await refused(q(`select public.report_profile('Ada', '   ')`), /1 to 500/);
    await refused(q(`select public.report_profile('Ada', null)`), /1 to 500/);
    await refused(q(`select public.report_profile('Ada', $1)`, ['x'.repeat(501)]), /1 to 500/);
    await q(`select public.report_profile('Ada', $1)`, ['x'.repeat(500)]);
  });
  await q(`delete from public.profile_reports where reporter = $1`, [QUINN]);
});

await test('report_profile: one open report per reporter and profile; a resolved one lets you report again', async () => {
  await member(RAE, () => refused(q(`select public.report_profile('Ada', 'again')`), /already have an open report/));
  await member(QUINN, () => q(`select public.report_profile('Ada', 'first')`));
  await member(QUINN, () => refused(q(`select public.report_profile('ADA', 'second')`), /already have an open report/));
  await member(QUINN, () => refused(q(`insert into public.profile_reports (target_user, reporter, reason) values ($1, $2, 'x')`, [ADA, QUINN]), /permission denied/));
  // the database refuses a second open row even if the function were bypassed
  await assert.rejects(q(`insert into public.profile_reports (target_user, reporter, reason) values ($1, $2, 'x')`, [ADA, QUINN]), /profile_reports_one_open/);
  const mine = (await openReports()).find(r => r.reporter === QUINN);
  await member(OPS, () => q(`select * from public.admin_resolve_report($1, 'dismissed')`, [mine.id]));
  await member(QUINN, () => q(`select public.report_profile('Ada', 'third')`));
  assert.equal((await openReports()).filter(r => r.reporter === QUINN).length, 2);
});

await test('report_profile: at most 10 a day per reporter; reports older than a day stop counting', async () => {
  const SPAM = id(100);
  await q(`insert into auth.users (id, email) values ($1, 'spam@example.test')`, [SPAM]);
  await q(`insert into auth.users (id, email) select ('00000000-0000-4000-8000-0000000002' || lpad(n::text, 2, '0'))::uuid, 't' || n || '@example.test' from generate_series(1, 12) n`);
  await q(`update public.member_profiles set visibility = 'public', adult_confirmed = true, display_name = 'target-' || right(user_id::text, 2)
           where user_id::text like '00000000-0000-4000-8000-0000000002%'`);
  for (let i = 1; i <= 10; i++) await report(SPAM, 'target-' + String(i).padStart(2, '0'));
  await member(SPAM, () => refused(q(`select public.report_profile('target-11', 'x')`), /too many reports/));
  // another member is not affected
  await report(QUINN, 'target-11');
  // a report resolved by an admin still counts for the day
  const first = (await openReports()).find(r => r.reporter === SPAM);
  await member(OPS, () => q(`select * from public.admin_resolve_report($1, 'dismissed')`, [first.id]));
  await member(SPAM, () => refused(q(`select public.report_profile('target-11', 'x')`), /too many reports/));
  await q(`update public.profile_reports set created_at = now() - interval '2 days' where reporter = $1`, [SPAM]);
  await report(SPAM, 'target-11');
  await report(SPAM, 'target-12');
  assert.equal((await openReports()).filter(r => r.reporter === SPAM).length, 12);
});

await test('reports are read by administrators only: not by the reporter, the target or anyone else', async () => {
  const total = (await openReports()).length;
  assert.ok(total > 5);
  await member(RAE, async () => assert.equal((await q(`select * from public.profile_reports`)).rows.length, 0));
  await member(ADA, async () => assert.equal((await q(`select * from public.profile_reports`)).rows.length, 0));
  await member(OPS, async () => {
    const rows = (await q(`select * from public.profile_reports`)).rows;
    assert.equal(rows.length, total);
    assert.deepEqual(Object.keys(rows[0]), ['id', 'target_user', 'reporter', 'reason', 'status', 'created_at', 'resolved_at', 'resolved_by']);
  });
});

await test('admin_resolve_report: administrators only (42501); the status must be actioned or dismissed', async () => {
  const open = (await openReports()).find(r => r.status === 'open');
  await member(RAE, () => refused(q(`select * from public.admin_resolve_report($1, 'actioned')`, [open.id]), /administrator/, '42501'));
  await member(ADA, () => refused(q(`select * from public.admin_resolve_report($1, 'dismissed')`, [open.id]), /administrator/, '42501'));
  await anon(() => refused(q(`select * from public.admin_resolve_report($1, 'dismissed')`, [open.id]), /permission denied/));
  assert.equal((await q(`select status from public.profile_reports where id = $1`, [open.id])).rows[0].status, 'open');
  await member(OPS, async () => {
    for (const bad of ['open', 'closed', '', null]) await refused(q(`select * from public.admin_resolve_report($1, $2)`, [open.id, bad]), /actioned or dismissed/);
    await refused(q(`select * from public.admin_resolve_report(999999, 'dismissed')`), /report not found/);
  });
});

await test('admin_resolve_report: records who and when, writes one audit row, and repeating it changes nothing', async () => {
  const open = (await openReports()).find(r => r.reporter === RAE && r.target_user === ADA);
  const audits = async () => (await q(`select * from public.audit_log where action = 'report.resolve' and target_id = $1`, [String(open.id)])).rows;
  assert.equal((await audits()).length, 0);
  const done = await member(OPS, () => q(`select * from public.admin_resolve_report($1, 'actioned')`, [open.id]));
  assert.equal(done.rows[0].status, 'actioned');
  const row = (await q(`select * from public.profile_reports where id = $1`, [open.id])).rows[0];
  assert.equal(row.status, 'actioned');
  assert.equal(row.resolved_by, OPS);
  assert.ok(row.resolved_at);
  const a = await audits();
  assert.equal(a.length, 1);
  assert.equal(a[0].actor, OPS);
  assert.equal(a[0].target_type, 'profile_report');
  assert.equal(a[0].detail.status, 'actioned');
  assert.equal(a[0].detail.target_user, ADA);
  // same call again: no new audit row, no new timestamp
  await member(OPS, () => q(`select * from public.admin_resolve_report($1, 'actioned')`, [open.id]));
  assert.equal((await audits()).length, 1);
  assert.deepEqual((await q(`select resolved_at from public.profile_reports where id = $1`, [open.id])).rows[0].resolved_at, row.resolved_at);
  // a resolved report is final
  await member(OPS, () => refused(q(`select * from public.admin_resolve_report($1, 'dismissed')`, [open.id]), /already resolved/));
  await member(OPS, async () => assert.equal((await q(`select * from public.audit_log where action = 'report.resolve'`)).rows.length >= 3, true));
  await member(RAE, async () => assert.equal((await q(`select * from public.audit_log`)).rows.length, 0));
});

await test('deleting accounts: a reporter who leaves keeps the report (reporter empty); a target who leaves takes its reports with it', async () => {
  const LEAVER = id(300), TARGET = id(301);
  await q(`insert into auth.users (id, email) values ($1, 'leaver@example.test'), ($2, 'gone@example.test')`, [LEAVER, TARGET]);
  await q(`update public.member_profiles set visibility = 'public', adult_confirmed = true, display_name = 'Gone' where user_id = $1`, [TARGET]);
  await report(LEAVER, 'Ben', 'Leaver report');
  await report(LEAVER, 'Gone', 'Report on a member who then left');
  const count = async w => (await q(`select count(*)::int c from public.profile_reports where ${w}`)).rows[0].c;
  assert.equal(await count(`reason in ('Leaver report', 'Report on a member who then left')`), 2);
  await q(`delete from auth.users where id = $1`, [LEAVER]);
  assert.equal(await count(`reason = 'Leaver report' and reporter is null`), 1);
  await q(`delete from auth.users where id = $1`, [TARGET]);
  assert.equal(await count(`reason = 'Report on a member who then left'`), 0);
  await anon(async () => assert.equal((await profile('Gone')).length, 0));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
