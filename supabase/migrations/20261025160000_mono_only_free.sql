begin;
-- Owner policy revision: Mono is the only free palette. Preserve purchases and
-- palettes already equipped before conversion; never revoke paid inventory.
insert into public.inventory(user_id,item_id)
select e.user_id,e.item_id from public.equipped_items e join public.catalog_items c on c.id=e.item_id
where e.slot='theme' and c.is_default and c.id<>'mono' on conflict do nothing;
update public.catalog_items set is_default=false,price=100 where type='theme' and is_default and id<>'mono';
create function public.admin_set_palette_price(p_item_id text,p_price integer)returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_mfa_admin();
 if p_item_id='mono' or p_price is null or p_price<1 or p_price>1000000 then raise exception 'Mono stays free; other palettes need a positive price';end if;
 update public.catalog_items set price=p_price,is_default=false where id=p_item_id and type='theme';
 if not found then raise exception 'palette not found';end if;
 insert into public.audit_log(actor,action,target_type,target_id,detail) values(auth.uid(),'catalog.price','item',p_item_id,jsonb_build_object('price',p_price));
end $$;
revoke all on function public.admin_set_palette_price(text,integer) from public,anon;
grant execute on function public.admin_set_palette_price(text,integer) to authenticated;
commit;
