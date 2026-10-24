// Tests for supabase/migrations/ (all files, in order)
//
// Runs the migration on PGlite (Postgres compiled to WebAssembly) with Supabase's roles
// and auth.uid() stubbed, then checks the access rules as each role.
//
//   npm i --no-save @electric-sql/pglite
//   node supabase/tests/schema.test.mjs
//
// PGlite has one connection, so true parallel purchases are not exercised here. The
// guarantee against overspending is the wallet row lock plus CHECK (balance >= 0); the
// sequential tests below prove the check and the idempotency rules.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const mod = process.env.PGLITE_PATH
  ? await import(pathToFileURL(process.env.PGLITE_PATH).href)
  : await import('@electric-sql/pglite');
const db = new mod.PGlite();

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

// ---- stub the parts of Supabase the migration depends on
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
    provider text not null, provider_id text not null, identity_data jsonb not null default '{}', created_at timestamptz not null default now(),
    unique (provider, provider_id));
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`);
for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  await db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
}

async function as(role, uid, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
const q = (sql, params) => db.query(sql, params);

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}

await q(`insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test'), ($3, 'c@example.test')`, [A, B, C]);
await q(`insert into public.catalog_items (id, type, name, price) values
  ('banner-aurora', 'banner', 'Aurora', 60), ('banner-gold', 'banner', 'Gold', 500)`);
const award = (user, amount, source, extra = {}) =>
  as('service_role', null, () => q(
    `select * from public.award_coins($1, 'contribution_award', $2, 'pr', $3, 'Merged PR', coalesce($4::timestamptz, now()), 'primary', $5::jsonb)`,
    [user, amount, source, extra.earned ?? null, extra.contribution ? JSON.stringify(extra.contribution) : null]));

await test('signup creates private profile, wallet and an alias that is not an email', async () => {
  const r = await q(`select m.display_name, m.visibility, w.balance, w.contribution_score from public.member_profiles m
                     join public.wallets w using (user_id) where user_id = $1`, [A]);
  assert.equal(r.rows.length, 1);
  assert.match(r.rows[0].display_name, /^geek-[0-9a-f]{8}$/);
  assert.equal(r.rows[0].visibility, 'private');
  assert.equal(r.rows[0].balance, 0);
  assert.equal((await q(`select count(*)::int c from public.profiles`)).rows[0].c, 3);
});

await test('members only see their own private data', async () => {
  await as('authenticated', A, async () => {
    assert.equal((await q(`select * from public.profiles`)).rows.length, 1);
    assert.equal((await q(`select * from public.wallets`)).rows.length, 1);
    const upd = await q(`update public.profiles set phone = '+201000000000' where user_id = $1`, [B]);
    assert.equal(upd.affectedRows, 0);
  });
});

await test('members cannot write balances, awards, inventory, roles or suspension', async () => {
  await as('authenticated', A, async () => {
    await assert.rejects(q(`update public.wallets set balance = 1000`), /permission denied/);
    await assert.rejects(q(`insert into public.ledger_entries (user_id, kind, contribution_delta, wallet_delta, source_type, source_id, reason, idempotency_key, earned_at)
      values ($1, 'contribution_award', 9, 9, 'x', 'y', 'forged', 'forged-key-1', now())`, [A]), /permission denied/);
    await assert.rejects(q(`insert into public.inventory (user_id, item_id) values ($1, 'banner-gold')`, [A]), /permission denied/);
    await assert.rejects(q(`insert into public.admin_roles (user_id, role) values ($1, 'admin')`, [A]), /permission denied/);
    await assert.rejects(q(`update public.member_profiles set suspended = false`), /permission denied/);
    await assert.rejects(q(`select * from public.award_coins($1, 'admin_gift', 5, 'x', 'y', 'z')`, [A]), /permission denied/);
    await assert.rejects(q(`select * from public.webhook_deliveries`), /permission denied/);
  });
});

await test('profile fields reject emails as alias, duplicate aliases, bad urls and future birth dates', async () => {
  await as('authenticated', A, async () => {
    await assert.rejects(q(`update public.member_profiles set display_name = 'me@example.test'`), /display_name/);
    await q(`update public.member_profiles set display_name = 'Ada' where user_id = $1`, [A]);
  });
  await as('authenticated', B, async () => {
    await assert.rejects(q(`update public.member_profiles set display_name = 'ADA' where user_id = $1`, [B]), /member_profiles_display_name_key/);
    await assert.rejects(q(`update public.member_profiles set portfolio_url = 'http://insecure.test'`), /portfolio_url/);
    await assert.rejects(q(`update public.profiles set birth_date = current_date + 1`), /future/);
  });
});

await test('public visibility and leaderboard need the 18+ confirmation', async () => {
  await as('authenticated', A, async () => {
    await assert.rejects(q(`update public.member_profiles set visibility = 'public' where user_id = $1`, [A]), /public_needs_adult/);
    await assert.rejects(q(`update public.member_profiles set show_on_leaderboard = true where user_id = $1`, [A]), /leaderboard_needs_adult/);
  });
});

await test('showcase: private stays hidden; opted-in sections only; members level needs sign-in', async () => {
  await as('anon', null, async () => assert.equal((await q(`select * from public.profile_directory`)).rows.length, 0));
  await as('authenticated', A, () => q(
    `update public.member_profiles set adult_confirmed = true, visibility = 'public', setup_editor = 'Neovim', setup_os = 'Arch', dotfiles_url = 'https://example.test/dots', show_setup = false where user_id = $1`, [A]));
  await as('anon', null, async () => {
    const r = await q(`select * from public.profile_directory`);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].display_name, 'Ada');
    assert.equal(r.rows[0].setup_editor, null); // show_setup is off
    assert.ok(!('user_id' in r.rows[0]) && !('suspended' in r.rows[0]));
    await assert.rejects(q(`select * from public.member_profiles`), /permission denied/);
  });
  await as('authenticated', A, () => q(`update public.member_profiles set show_setup = true where user_id = $1`, [A]));
  await as('anon', null, async () => assert.equal((await q(`select setup_editor from public.profile_directory`)).rows[0].setup_editor, 'Neovim'));
  await as('authenticated', A, () => q(`update public.member_profiles set visibility = 'members' where user_id = $1`, [A]));
  await as('anon', null, async () => assert.equal((await q(`select * from public.profile_directory`)).rows.length, 0));
  await as('authenticated', B, async () => assert.equal((await q(`select * from public.profile_directory`)).rows.length, 1));
  await as('authenticated', A, () => q(`update public.member_profiles set visibility = 'public' where user_id = $1`, [A]));
});

await test('awards: credited once, replay is idempotent, wallet and score update', async () => {
  const c = { repository: 'LightningEg/Lightning', issue_number: 12, pr_number: 40, title: 'Fix rounding', url: 'https://github.com/LightningEg/Lightning/pull/40', merged_at: '2026-10-20T10:00:00Z' };
  const first = (await award(A, 150, 'LightningEg/Lightning#40', { contribution: c })).rows[0];
  const again = (await award(A, 150, 'LightningEg/Lightning#40', { contribution: c })).rows[0];
  assert.equal(first.id, again.id);
  const w = (await q(`select balance, contribution_score from public.wallets where user_id = $1`, [A])).rows[0];
  assert.deepEqual([w.balance, w.contribution_score], [150, 150]);
  assert.equal((await q(`select count(*)::int c from public.contributions where user_id = $1`, [A])).rows[0].c, 1);
});

await test('a second award for the same source under a different key is rejected', async () => {
  await assert.rejects(q(
    `insert into public.ledger_entries (user_id, kind, contribution_delta, wallet_delta, source_type, source_id, reason, idempotency_key, earned_at)
     values ($1, 'contribution_award', 10, 10, 'pr', 'LightningEg/Lightning#40', 'dup', 'a-different-key', now())`, [A]),
    /ledger_one_award_per_source/);
});

await test('ledger is append-only', async () => {
  await assert.rejects(q(`update public.ledger_entries set wallet_delta = 0`), /append-only|not allowed/);
  await assert.rejects(q(`delete from public.ledger_entries`), /not allowed/);
  await assert.rejects(q(`truncate public.ledger_entries`), /append-only|not allowed|foreign key/);
});

await test('showcase work lists verified ledger work and self-reported links separately', async () => {
  await as('authenticated', A, () => q(`update public.member_profiles set show_work = true where user_id = $1`, [A]));
  await as('authenticated', A, () => q(`insert into public.profile_links (user_id, label, url) values ($1, 'My CLI tool', 'https://example.test/cli')`, [A]));
  await as('anon', null, async () => {
    const r = await q(`select title, verified from public.profile_work order by verified desc`);
    assert.deepEqual(r.rows.map(x => [x.title, x.verified]), [['Fix rounding', true], ['My CLI tool', false]]);
  });
  await as('authenticated', A, () => q(`update public.contributions set hidden = true`));
  await as('anon', null, async () => assert.equal((await q(`select * from public.profile_work`)).rows.length, 1));
  await as('authenticated', A, () => q(`update public.contributions set hidden = false`));
});

await test('profile links: https only and at most 12', async () => {
  await as('authenticated', B, async () => {
    await assert.rejects(q(`insert into public.profile_links (user_id, label, url) values ($1, 'x', 'javascript:alert(1)')`, [B]), /url/);
    for (let i = 0; i < 12; i++) await q(`insert into public.profile_links (user_id, label, url) values ($1, 'l', 'https://example.test/' || $2::text)`, [B, i]);
    await assert.rejects(q(`insert into public.profile_links (user_id, label, url) values ($1, 'l', 'https://example.test/13')`, [B]), /at most 12/);
  });
});

await test('purchase: debits wallet, keeps score, is idempotent, and owns once', async () => {
  const p = await as('authenticated', A, () => q(`select * from public.purchase_item('banner-aurora', 'purchase-key-0001')`));
  const w = (await q(`select balance, contribution_score from public.wallets where user_id = $1`, [A])).rows[0];
  assert.deepEqual([w.balance, w.contribution_score], [90, 150]);
  const replay = await as('authenticated', A, () => q(`select * from public.purchase_item('banner-aurora', 'purchase-key-0001')`));
  assert.equal(replay.rows[0].id, p.rows[0].id);
  assert.equal((await q(`select balance from public.wallets where user_id = $1`, [A])).rows[0].balance, 90);
  await as('authenticated', A, async () => {
    await assert.rejects(q(`select * from public.purchase_item('banner-aurora', 'purchase-key-0002')`), /already owned/);
    await assert.rejects(q(`select * from public.purchase_item('banner-gold', 'purchase-key-0001')`), /different item/);
    await assert.rejects(q(`select * from public.purchase_item('banner-gold', 'purchase-key-0003')`), /insufficient coins/);
    await assert.rejects(q(`select * from public.purchase_item('mono', 'purchase-key-0004')`), /free/);
    await assert.rejects(q(`select * from public.purchase_item('no-such-item', 'purchase-key-0005')`), /not available/);
  });
  assert.equal((await q(`select balance from public.wallets where user_id = $1`, [A])).rows[0].balance, 90);
});

await test('a member with no coins cannot buy; the database refuses a negative wallet', async () => {
  await as('authenticated', B, async () => assert.rejects(q(`select * from public.purchase_item('banner-aurora', 'purchase-key-0006')`), /insufficient coins/));
  await assert.rejects(q(`update public.wallets set balance = -1 where user_id = $1`, [B]), /wallets_balance_check/);
});

await test('equip: only owned or free default items, one per slot, signed in only', async () => {
  await as('authenticated', A, async () => {
    await q(`select * from public.equip_item('banner-aurora')`);
    await q(`select * from public.equip_item('mono')`);
    await q(`select * from public.equip_item('mono')`);
    assert.deepEqual((await q(`select slot, item_id from public.equipped_items order by slot`)).rows.map(r => r.item_id), ['banner-aurora', 'mono']);
  });
  await as('authenticated', B, async () => assert.rejects(q(`select * from public.equip_item('banner-aurora')`), /not owned/));
  await as('anon', null, async () => assert.rejects(q(`select * from public.equip_item('mono')`), /permission denied/));
  await as('authenticated', A, async () => {
    await q(`select public.unequip_slot('banner')`);
    assert.equal((await q(`select * from public.equipped_items where slot = 'banner'`)).rows.length, 0);
  });
});

await test('leaderboard: opt-in only, ties share a rank, spending never lowers rank, month uses Cairo time', async () => {
  await award(B, 150, 'LightningEg/Lightning#41');
  await award(C, 400, 'LightningEg/Lightning#10', { earned: new Date(Date.now() - 90 * 864e5).toISOString() });
  await q(`update public.member_profiles set adult_confirmed = true, show_on_leaderboard = true where user_id in ($1, $2, $3)`, [A, B, C]);
  const all = (await as('anon', null, () => q(`select * from public.leaderboard('all')`))).rows;
  assert.deepEqual(all.map(r => [Number(r.rank), Number(r.score)]), [[1, 400], [2, 150], [2, 150]]);
  const month = (await as('anon', null, () => q(`select * from public.leaderboard('month')`))).rows;
  assert.deepEqual(month.map(r => [Number(r.rank), Number(r.score)]), [[1, 150], [1, 150]]);
  assert.ok(!('user_id' in month[0]));
  await q(`update public.member_profiles set show_on_leaderboard = false where user_id = $1`, [C]);
  assert.equal((await as('anon', null, () => q(`select * from public.leaderboard('all')`))).rows.length, 2);
  await assert.rejects(q(`select * from public.leaderboard('week')`), /period/);
});

await test('admin tools: rewards are versioned, ineligible repos refused, non-admins refused', async () => {
  await as('authenticated', A, async () => assert.rejects(q(`select * from public.publish_reward('LightningEg/Lightning', 7, 75, 'Do it')`), /administrator only/));
  await q(`insert into public.admin_roles (user_id, role) values ($1, 'admin')`, [A]);
  await q(`insert into public.repositories (full_name, eligible) values ('LightningEg/Lightning_website', false)`);
  await as('authenticated', A, async () => {
    assert.equal((await q(`select * from public.publish_reward('LightningEg/Lightning', 7, 75, 'Do it', 'Round money')`)).rows[0].version, 1);
    assert.equal((await q(`select * from public.publish_reward('LightningEg/Lightning', 7, 100, 'Do it better')`)).rows[0].version, 2);
    await assert.rejects(q(`select * from public.publish_reward('LightningEg/Lightning_website', 1, 50, 'x')`), /not eligible/);
    await assert.rejects(q(`select * from public.publish_reward('LightningEg/Lightning', 8, -5, 'x')`), /amount/);
  });
  const v = (await q(`select version, amount from public.reward_offer_versions order by version`)).rows;
  assert.deepEqual(v.map(r => [r.version, r.amount]), [[1, 75], [2, 100]]);
  await assert.rejects(q(`update public.reward_offer_versions set amount = 1`), /append-only|not allowed/);
  await as('authenticated', B, async () => {
    assert.equal((await q(`select * from public.reward_offers`)).rows.length, 1);
    await assert.rejects(q(`insert into public.repositories (full_name, eligible) values ('x/y', true)`), /row-level security/);
    await assert.rejects(q(`insert into public.catalog_items (id, type, name, price) values ('free-gold', 'banner', 'Free', 1)`), /row-level security/);
  });
});

await test('admin corrections: linked reversal, repeat is a no-op, blocked when coins were spent, audited', async () => {
  const bEntry = (await q(`select id from public.ledger_entries where user_id = $1 and kind = 'contribution_award'`, [B])).rows[0].id;
  const aEntry = (await q(`select id from public.ledger_entries where user_id = $1 and kind = 'contribution_award'`, [A])).rows[0].id;
  await as('authenticated', A, async () => {
    const c1 = (await q(`select * from public.admin_correct_entry($1, 'Wrong amount')`, [bEntry])).rows[0];
    const c2 = (await q(`select * from public.admin_correct_entry($1, 'Wrong amount')`, [bEntry])).rows[0];
    assert.equal(c1.id, c2.id);
    assert.equal(Number(c1.reverses_entry_id), Number(bEntry));
    await assert.rejects(q(`select * from public.admin_correct_entry($1, 'Revert')`, [aEntry]), /wallets_balance_check/);
  });
  const w = (await q(`select balance, contribution_score from public.wallets where user_id = $1`, [B])).rows[0];
  assert.deepEqual([w.balance, w.contribution_score], [0, 0]);
  assert.equal((await q(`select count(*)::int c from public.audit_log where action = 'ledger.correct'`)).rows[0].c, 1);
  await as('authenticated', A, async () => assert.equal((await q(`select * from public.audit_log`)).rows.length >= 3, true));
  await as('authenticated', B, async () => assert.equal((await q(`select * from public.audit_log`)).rows.length, 0));
});

await test('moderation: only an admin function can suspend a profile, and it leaves the public view', async () => {
  await as('authenticated', B, async () => assert.rejects(q(`select public.admin_suspend_profile($1, true, 'x')`, [A]), /administrator only/));
  await as('authenticated', A, () => q(`select public.admin_suspend_profile($1, true, 'Spam')`, [A]));
  await as('anon', null, async () => assert.equal((await q(`select * from public.profile_directory`)).rows.length, 0));
  await as('authenticated', A, () => q(`select public.admin_suspend_profile($1, false, 'Reviewed')`, [A]));
  await as('anon', null, async () => assert.equal((await q(`select * from public.profile_directory`)).rows.length, 1));
});

await test('github identity: one active link per account and per GitHub id, history kept', async () => {
  await q(`insert into public.github_links (user_id, github_id, github_login) values ($1, 111, 'ada')`, [A]);
  await assert.rejects(q(`insert into public.github_links (user_id, github_id, github_login) values ($1, 111, 'ada2')`, [B]), /github_links_active_github/);
  await q(`update public.github_links set unlinked_at = now() where github_id = 111`);
  await q(`insert into public.github_links (user_id, github_id, github_login) values ($1, 111, 'ada')`, [B]);
  assert.equal((await q(`select count(*)::int c from public.github_links where github_id = 111`)).rows[0].c, 2);
});

await test('catalog: free defaults are always listed, retired items stay visible to owners', async () => {
  await as('anon', null, async () => assert.equal((await q(`select count(*)::int c from public.catalog_items where is_default`)).rows[0].c, 1));
  await q(`update public.catalog_items set active = false where id = 'banner-aurora'`);
  await as('anon', null, async () => assert.equal((await q(`select * from public.catalog_items where id = 'banner-aurora'`)).rows.length, 0));
  await as('authenticated', A, async () => assert.equal((await q(`select * from public.catalog_items where id = 'banner-aurora'`)).rows.length, 1));
  await as('authenticated', A, async () => q(`select * from public.equip_item('banner-aurora')`));
});

await test('minors: a birth date under 18 keeps the profile private, in the database as well as the page', async () => {
  const D = '00000000-0000-4000-8000-00000000000d';
  await q(`insert into auth.users (id, email) values ($1, 'd@example.test')`, [D]);
  await as('authenticated', D, async () => {
    await q(`update public.profiles set birth_date = current_date - interval '15 years' where user_id = $1`, [D]);
    await assert.rejects(q(`update public.member_profiles set visibility = 'public', adult_confirmed = true where user_id = $1`, [D]), /under 18/);
    await assert.rejects(q(`update public.member_profiles set adult_confirmed = true where user_id = $1`, [D]), /under 18/);
    await assert.rejects(q(`update public.member_profiles set show_on_leaderboard = true where user_id = $1`, [D]), /under 18|leaderboard_needs_adult/);
    await assert.rejects(q(`update public.member_profiles set visibility = 'members' where user_id = $1`, [D]), /under 18/);
    await q(`update public.member_profiles set bio = 'hi' where user_id = $1`, [D]); // private edits are fine
  });
  // An adult who is already public, then enters a birth date under 18, is made private at once.
  const E = '00000000-0000-4000-8000-00000000000e';
  await q(`insert into auth.users (id, email) values ($1, 'e@example.test')`, [E]);
  await as('authenticated', E, async () => {
    await q(`update public.member_profiles set adult_confirmed = true, visibility = 'public', show_on_leaderboard = true where user_id = $1`, [E]);
    await q(`update public.profiles set birth_date = current_date - interval '17 years' where user_id = $1`, [E]);
    const r = (await q(`select visibility, show_on_leaderboard, adult_confirmed from public.member_profiles where user_id = $1`, [E])).rows[0];
    assert.deepEqual([r.visibility, r.show_on_leaderboard, r.adult_confirmed], ['private', false, false]);
  });
  // An adult birth date changes nothing.
  const F = '00000000-0000-4000-8000-00000000000f';
  await q(`insert into auth.users (id, email) values ($1, 'f@example.test')`, [F]);
  await as('authenticated', F, async () => {
    await q(`update public.profiles set birth_date = '1990-05-05' where user_id = $1`, [F]);
    await q(`update public.member_profiles set adult_confirmed = true, visibility = 'public' where user_id = $1`, [F]);
    assert.equal((await q(`select visibility from public.member_profiles where user_id = $1`, [F])).rows[0].visibility, 'public');
  });
});

await test('deleting an account removes personal data but keeps anonymized ledger history', async () => {
  const before = (await q(`select count(*)::int c from public.ledger_entries where user_id = $1`, [A])).rows[0].c;
  assert.ok(before >= 2);
  await q(`delete from auth.users where id = $1`, [A]);
  assert.equal((await q(`select count(*)::int c from public.profiles where user_id = $1`, [A])).rows[0].c, 0);
  assert.equal((await q(`select count(*)::int c from public.wallets where user_id = $1`, [A])).rows[0].c, 0);
  assert.equal((await q(`select count(*)::int c from public.member_profiles where user_id = $1`, [A])).rows[0].c, 0);
  assert.equal((await q(`select count(*)::int c from public.ledger_entries where user_id is null`)).rows[0].c, before);
  await as('anon', null, async () => assert.ok((await q(`select display_name from public.profile_directory`)).rows.every(r => r.display_name !== 'Ada')));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
