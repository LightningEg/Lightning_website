begin;
-- Use the automatically created member row for membership, avoiding Auth dependencies
-- in public projection views. Deleting an account cascades this row immediately.
do $$declare view_name text;definition text;begin
 foreach view_name in array array['profile_directory','profile_work']loop
  definition:=pg_get_viewdef(('public.'||view_name)::regclass,true);
  definition:=replace(definition,'auth.users current_member','public.member_profiles current_member');
  definition:=replace(definition,'current_member.id = auth.uid()','current_member.user_id = auth.uid()');
  execute 'create or replace view public.'||quote_ident(view_name)||' as '||definition;
 end loop;
end $$;
commit;
