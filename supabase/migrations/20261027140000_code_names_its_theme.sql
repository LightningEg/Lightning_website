begin;
-- The code names its theme (owner, 2026-10-27: "simple and polished").
-- The app no longer asks which theme a code is for. It sends every paid theme it carries, with each one's version, and
-- the store redeems the code for its own theme when this app can wear it. An app that does not carry the code's theme
-- (or carries an older version of it) is refused before the code is spent, exactly as before.
-- The four-argument function stays for apps that still send one item.

create function public.redeem_activation_code(p_code text, p_items jsonb, p_profile_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  code text := lower(replace(btrim(p_code), '-', ''));
  t private.activation_tickets;
begin
  if code is null or code !~ '^[0-9a-f]{32}$' then raise exception 'invalid or expired activation code'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'unsupported bundled item version'; end if;
  select * into t from private.activation_tickets where code_hash = encode(sha256(convert_to(code, 'UTF8')), 'hex');
  if not found or t.expires_at <= now() or t.redeemed_at is not null then raise exception 'invalid or expired activation code'; end if;
  if not exists (select 1 from jsonb_array_elements(p_items) e
                  where e->>'item_id' = t.item_id and (e->>'asset_version') ~ '^[0-9]{1,6}$'
                    and (e->>'asset_version')::integer = t.asset_version) then
    raise exception 'unsupported bundled item version'; end if;
  -- One path for the seat, the burn and the audit: the four-argument function locks the ticket and checks it again.
  return public.redeem_activation_code(p_code, t.item_id, t.asset_version, p_profile_id);
end $$;
revoke all on function public.redeem_activation_code(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.redeem_activation_code(text, jsonb, text) to service_role;
commit;
