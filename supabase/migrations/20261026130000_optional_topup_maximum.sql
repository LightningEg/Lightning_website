-- No business maximum for top-ups. A nullable maximum still lets the owner
-- impose one later; integer piastres and coin storage remain technical bounds.
alter table public.coin_pricing alter column maximum_egp drop not null;
alter table public.coin_pricing drop constraint coin_pricing_check;
alter table public.coin_pricing add constraint coin_pricing_check
  check (maximum_egp is null or (maximum_egp >= minimum_egp and maximum_egp <= 21474836));

create or replace function public.quote_topup_amount(p_amount_piastres integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cfg public.coin_pricing; bonus integer; base bigint; extra bigint;
begin
  select * into cfg from public.coin_pricing where id = 1;
  if p_amount_piastres is null or p_amount_piastres % 100 <> 0
     or p_amount_piastres::bigint < cfg.minimum_egp::bigint * 100
     or (cfg.maximum_egp is not null and p_amount_piastres::bigint > cfg.maximum_egp::bigint * 100) then
    raise exception 'enter a whole EGP amount within the displayed range';
  end if;
  select coalesce(max(bonus_percent), 0) into bonus
    from public.coin_bonus_tiers where minimum_egp::bigint * 100 <= p_amount_piastres;
  base := p_amount_piastres::bigint * cfg.coins_per_egp / 100;
  extra := base * bonus / 100;
  if base + extra > 1000000000 then raise exception 'amount exceeds coin limit'; end if;
  return jsonb_build_object('amount_piastres', p_amount_piastres,
    'base_coins', base, 'bonus_percent', bonus, 'bonus_coins', extra,
    'coins', base + extra, 'pricing_version', cfg.version,
    'coins_per_egp', cfg.coins_per_egp, 'minimum_egp', cfg.minimum_egp,
    'maximum_egp', cfg.maximum_egp, 'enabled', cfg.enabled);
end $$;

with changed as (
  update public.coin_pricing set maximum_egp = null, version = version + 1
  where id = 1 and maximum_egp is not null returning version
)
insert into public.audit_log(actor, action, target_type, target_id, detail)
select null, 'payments.pricing', 'settings', '1',
  jsonb_build_object('source', 'owner request', 'maximum_egp', null, 'version', version)
from changed;
