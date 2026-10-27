begin;
-- 8S: the owner console. App unlocks per theme, extra profiles in the month's sales, merges held for unlinked GitHub
-- accounts, and the blog bonus on top of the story reward ladder. Everything here is read-only for the owner except the
-- ladder and the blog bonus; every price and every ledger write stays in SQL. Owner (MFA administrator) only.

-- ---------------------------------------------------------------- app unlocks per theme (Catalogue > App themes)
-- One row per theme whose app unlock is on: codes issued and redeemed (all time), profiles that claimed it, extra profiles
-- sold and the coins they brought, and how many members hold a claimed profile or an extra seat.
create function public.admin_app_unlocks() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_mfa_admin();
  return (select coalesce(jsonb_agg(x order by x.name), '[]'::jsonb) from (
    select c.id as item_id, c.name,
      (select count(*) from private.activation_tickets t where t.item_id = c.id) as codes_issued,
      (select count(*) from private.activation_tickets t where t.item_id = c.id and t.redeemed_at is not null) as codes_redeemed,
      (select count(*) from public.profile_claims p where p.item_id = c.id) as profiles_claimed,
      (select coalesce(sum(s.extra), 0) from public.theme_seats s where s.item_id = c.id) as extra_seats_sold,
      (select coalesce(sum(sp.price_paid), 0) from public.seat_purchases sp where sp.item_id = c.id) as extra_coins,
      (select count(*) from (select user_id from public.theme_seats s where s.item_id = c.id and s.extra > 0
                             union select user_id from public.profile_claims p where p.item_id = c.id) m) as members_with_seats
    from public.catalog_items c
    where exists (select 1 from public.bundled_item_versions b where b.item_id = c.id and b.enabled)) x);
end $$;

-- Extra profiles sold this month (Cairo month), shaped like a catalogue row so the Overview can list them beside themes.
create function public.admin_month_seat_sales() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare m0 timestamptz := date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo';
begin
  perform private.require_mfa_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', 'seat:' || c.id, 'name', 'Extra profile · ' || c.name, 'type', 'seat', 'tier', null,
            'sold', x.sold, 'coins', x.coins) order by x.sold desc, x.coins desc), '[]'::jsonb)
    from (select item_id, count(*) as sold, sum(price_paid) as coins from public.seat_purchases where created_at >= m0 group by item_id) x
    join public.catalog_items c on c.id = x.item_id);
end $$;

-- ---------------------------------------------------------------- merges held for unlinked GitHub accounts
-- Recognition points (every merge) and coins (an offer) wait here until their author links GitHub; linking pays them.
create function public.admin_held_awards() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_mfa_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'kind', case when p.points is not null then 'points' else 'coins' end,
      'github_login', p.github_login, 'repository', p.repository, 'pr_number', p.pr_number, 'pr_url', p.pr_url, 'pr_title', p.pr_title,
      'issue_number', p.issue_number, 'amount', coalesce(p.points, p.amount), 'merged_at', p.merged_at) order by p.created_at, p.id), '[]'::jsonb)
    from public.pending_awards p where p.settled_at is null);
end $$;

-- ---------------------------------------------------------------- the story reward ladder and the blog bonus
alter table public.story_reward_ladder add column blog_coins integer not null default 100 check (blog_coins between 0 and 500);
alter table public.community_stories
  add column blog_url text check (blog_url is null or char_length(blog_url) <= 300),
  add column blog_coins_paid integer not null default 0 check (blog_coins_paid >= 0),
  add column blog_paid_at timestamptz;

create or replace function public.admin_story_ladder() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_mfa_admin();
  return (select jsonb_build_object('coins', coins, 'points', points, 'blog_coins', blog_coins) from public.story_reward_ladder);
end $$;

-- The two-argument version is replaced: only the stories page called it, and that editor moved to the console.
-- p_blog_coins left out keeps the blog bonus as it is.
drop function public.admin_set_story_ladder(integer, integer);
create function public.admin_set_story_ladder(p_coins integer, p_points integer, p_blog_coins integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.story_reward_ladder;
begin
  perform private.require_mfa_admin();
  if p_coins is null or p_points is null or p_coins not between 0 and 500 or p_points not between 0 and 500
     or (p_blog_coins is not null and p_blog_coins not between 0 and 500) then
    raise exception 'coins, points and the blog bonus must be 0 to 500'; end if;
  update public.story_reward_ladder set coins = p_coins, points = p_points, blog_coins = coalesce(p_blog_coins, blog_coins),
    updated_by = auth.uid(), updated_at = now() returning * into l;
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (auth.uid(), 'story.ladder', 'settings', 'story_reward_ladder', jsonb_build_object('coins', l.coins, 'points', l.points, 'blog_coins', l.blog_coins));
  return jsonb_build_object('coins', l.coins, 'points', l.points, 'blog_coins', l.blog_coins);
end $$;

-- Blog bonus: a published story that the blog or a guide now links earns the author the ladder's blog coins, once.
-- Wallet only (an 'admin_gift' entry): it never counts toward the three rewarded stories in 30 days and never raises rank.
create function public.admin_story_blog_bonus(p_id uuid, p_blog_url text) returns public.community_stories
language plpgsql security definer set search_path = '' as $$
declare
  r public.community_stories; l public.story_reward_ladder; e public.ledger_entries;
  url text := btrim(coalesce(p_blog_url, ''));
begin
  perform private.require_mfa_admin();
  if url !~ '^https://(www[.])?lightningeg[.]com/(ar/)?(blog-[a-z0-9-]+|guides|budget-your-salary|see-where-your-money-goes|know-what-you-own|your-data-and-devices)[.]html$' then
    raise exception 'the link must be a lightningeg.com blog post or guide (https)'; end if;
  perform 1 from public.wallets where user_id = (select user_id from public.community_stories where id = p_id) for update;
  select * into r from public.community_stories where id = p_id for update;
  if not found then raise exception 'story not found'; end if;
  if r.status <> 'published' then raise exception 'only a published story earns the blog bonus'; end if;
  if r.blog_url is not null then return r; end if;
  select * into l from public.story_reward_ladder;
  if l.blog_coins > 0 then
    e := public.award_coins(r.user_id, 'admin_gift', l.blog_coins, 'story_blog', r.id::text, 'Story linked from the blog');
  end if;
  update public.community_stories set blog_url = url, blog_coins_paid = l.blog_coins, blog_paid_at = now(), updated_at = now()
   where id = r.id returning * into r;
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (auth.uid(), 'story.blog_bonus', 'story', r.id::text, jsonb_build_object('url', url, 'coins', l.blog_coins, 'ledger_entry_id', e.id));
  return r;
end $$;

revoke all on function public.admin_app_unlocks(), public.admin_month_seat_sales(), public.admin_held_awards(), public.admin_story_ladder(),
  public.admin_set_story_ladder(integer, integer, integer), public.admin_story_blog_bonus(uuid, text) from public, anon;
grant execute on function public.admin_app_unlocks(), public.admin_month_seat_sales(), public.admin_held_awards(), public.admin_story_ladder(),
  public.admin_set_story_ladder(integer, integer, integer), public.admin_story_blog_bonus(uuid, text) to authenticated;
commit;
