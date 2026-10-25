begin;
-- RLS must also reject revoked sessions for private payment reads, not just writes.
create function public.has_active_session()returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then return false;end if;
 perform private.require_active_session();return true;
 exception when insufficient_privilege then return false;
end $$;
revoke all on function public.has_active_session()from public,anon;
grant execute on function public.has_active_session()to authenticated;
create or replace function public.is_admin()returns boolean language sql stable security definer set search_path='' as $$
 select public.has_active_session()and exists(select 1 from public.admin_roles where user_id=auth.uid());
$$;
create or replace function private.require_mfa_admin()returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_active_session();
 if not public.is_admin()or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','')<>'aal2'then raise exception 'MFA administrator required'using errcode='42501';end if;
end $$;
do $$declare target text;begin
 foreach target in array array['topup_requests','receipt_uploads','topup_adjustments','payment_returns','bank_transfers','payment_settings']loop
  execute format('create policy payment_active_session on public.%I as restrictive for select to authenticated using((select public.has_active_session()))',target);
 end loop;
 if to_regclass('storage.objects')is not null then
  execute $p$create policy receipt_active_session on storage.objects as restrictive for select to authenticated using(bucket_id<>'topup-receipts' or(select public.has_active_session()))$p$;
 end if;
end $$;
-- Safe pricing metadata makes the allowed range visible before the first amount is entered.
create or replace function public.checkout_availability()returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',coalesce(s.enabled and p.enabled,false),'support_email','hello@lightningeg.com',
 'processing_message',s.processing_message,'pricing',jsonb_build_object('coins_per_egp',p.coins_per_egp,'minimum_egp',p.minimum_egp,'maximum_egp',p.maximum_egp,
 'tiers',(select coalesce(jsonb_agg(jsonb_build_object('minimum_egp',minimum_egp,'bonus_percent',bonus_percent)order by minimum_egp),'[]'::jsonb)from public.coin_bonus_tiers)))
 from public.payment_settings s cross join public.coin_pricing p where s.id=1 and p.id=1;
$$;
commit;
