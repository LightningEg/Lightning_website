begin;
-- EGP thresholds are fixed; contribution equivalence uses current owner base pricing.
alter table public.catalog_items add column supporter_egp integer check (supporter_egp > 0);
update public.catalog_items set supporter_egp = case id when 'badge-supporter-bronze' then 100 when 'badge-supporter-silver' then 250 when 'badge-supporter-gold' then 500 end,
 award_coins = case id when 'badge-supporter-bronze' then 500 when 'badge-supporter-silver' then 1250 when 'badge-supporter-gold' then 2500 end,
 description = 'Earned through combined financial support and contributions.' where award = 'supporter';
insert into public.catalog_items(id,type,name,description,price,award,award_coins,supporter_egp)
values ('badge-supporter-true','badge','True supporter','Earned through combined financial support and contributions.',0,'supporter',5000,1000);

create function private.support_equivalent(p_user uuid) returns numeric language sql stable security definer set search_path = '' as $$
 select greatest(0, coalesce((select sum(r.received_piastres) from public.topup_requests r
   where r.user_id=p_user and r.status='approved' and not exists(select 1 from public.payment_returns pr where pr.request_id=r.id)
   and not exists(select 1 from public.ledger_entries c where c.reverses_entry_id=r.ledger_entry_id and c.kind='correction')),0))::numeric / 100
   + greatest(0,coalesce((select sum(contribution_delta) from public.ledger_entries where user_id=p_user),0))::numeric
   / (select coins_per_egp from public.coin_pricing where id=1);
$$;
revoke all on function private.support_equivalent(uuid) from public, anon, authenticated, service_role;

-- Preserve historical entitlements; new awards use confirmed funds, never top-up bonus Cotton or gifts.
create or replace function private.grant_supporter_badges(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare equivalent numeric;
begin
 equivalent := private.support_equivalent(p_user);
 insert into public.inventory(user_id,item_id)
 select p_user,id from public.catalog_items where award='supporter' and supporter_egp<=equivalent
 on conflict(user_id,item_id) do nothing;
 -- Founding remains the separate first-100-payers award; contributors do not consume these places.
 if exists(select 1 from public.ledger_entries where user_id=p_user and kind='paid_topup') then
   perform pg_advisory_xact_lock(hashtext('lightning:founding-supporter'));
   if not exists(select 1 from public.inventory where user_id=p_user and item_id='badge-founding')
     and (select count(*) from public.inventory where item_id='badge-founding')<100 then
     insert into public.inventory(user_id,item_id) values(p_user,'badge-founding') on conflict do nothing;
   end if;
 end if;
end $$;
-- Approval records are written after the ledger insert, so award again after the confirmed request is updated.
create function private.on_support_payment() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.grant_supporter_badges(new.user_id); return null; end $$;
create trigger confirmed_support_badges after insert or update on public.topup_requests for each row
 when (new.status='approved') execute function private.on_support_payment();
drop trigger ledger_supporter_badges on public.ledger_entries;
create trigger ledger_supporter_badges after insert on public.ledger_entries for each row
 execute function private.on_paid_topup();
revoke all on function private.on_support_payment() from public,anon,authenticated,service_role;
-- Pricing changes never revoke entitlements; refresh all eligible members against the new equivalent.
create function private.on_support_pricing() returns trigger language plpgsql security definer set search_path='' as $$
declare u record; begin for u in select user_id from public.wallets loop perform private.grant_supporter_badges(u.user_id); end loop; return null; end $$;
create trigger support_pricing_refresh after update of coins_per_egp on public.coin_pricing for each row execute function private.on_support_pricing();
revoke all on function private.on_support_pricing() from public,anon,authenticated,service_role;

create or replace function public.supporter_status() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'support_equivalent_egp',case when auth.uid() is null then null else private.support_equivalent(auth.uid()) end,
 'tiers',(select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'egp',c.supporter_egp,
 'coins',c.supporter_egp*(select coins_per_egp from public.coin_pricing where id=1),
 'owned',exists(select 1 from public.inventory i where i.user_id=auth.uid() and i.item_id=c.id)) order by c.supporter_egp) from public.catalog_items c where c.award='supporter'),
 'founding_left',greatest(0,100-(select count(*) from public.inventory where item_id='badge-founding')),
 'founding_owned',exists(select 1 from public.inventory where user_id=auth.uid() and item_id='badge-founding'));
$$;
revoke all on function public.supporter_status() from public;
grant execute on function public.supporter_status() to anon,authenticated,service_role;
-- Public output is only the earned level, never amount/progress; same visibility consent as profiles/leaderboard.
create function public.supporter_levels() returns table(display_name text,supporter_level text,supporter_badge text)
language sql stable security definer set search_path='' as $$
 select m.display_name, b.name,b.id from public.member_profiles m cross join lateral
 (select c.name,c.id from public.inventory i join public.catalog_items c on c.id=i.item_id
  where i.user_id=m.user_id and c.award='supporter' order by c.supporter_egp desc limit 1) b
 where not m.suspended and (m.visibility='public' or m.show_on_leaderboard);
$$;
revoke all on function public.supporter_levels() from public;
grant execute on function public.supporter_levels() to anon,authenticated,service_role;
do $$ declare u record; begin for u in select user_id from public.wallets loop perform private.grant_supporter_badges(u.user_id); end loop; end $$;
commit;
