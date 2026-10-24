begin;
-- Recognition points are separate from spendable coins.
alter table public.ledger_entries drop constraint ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check check(kind in
 ('contribution_award','feedback_award','admin_gift','purchase','refund','correction','paid_topup','recognition'));
alter table public.ledger_entries drop constraint ledger_kind_shape;
alter table public.ledger_entries add constraint ledger_kind_shape check(case kind
 when 'contribution_award' then contribution_delta>0 and wallet_delta=contribution_delta
 when 'feedback_award' then contribution_delta>0 and wallet_delta=contribution_delta
 when 'admin_gift' then contribution_delta=0 and wallet_delta>0
 when 'recognition' then contribution_delta>0 and wallet_delta=0
 when 'paid_topup' then contribution_delta=0 and wallet_delta>0 and source_type='instapay'
 when 'purchase' then contribution_delta=0 and wallet_delta<0
 when 'refund' then contribution_delta=0 and wallet_delta>0 and reverses_entry_id is not null
 when 'correction' then reverses_entry_id is not null end);
create function private.require_mfa_admin() returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','')<>'aal2' then
 raise exception 'MFA administrator required' using errcode='42501';end if;
end $$;
revoke all on function private.require_mfa_admin() from public,anon,authenticated;
create function public.admin_credit_account(p_email text,p_coins integer,p_points integer,p_reason text,p_key uuid)
returns public.wallets language plpgsql security definer set search_path='' as $$
declare target uuid;e public.ledger_entries;w public.wallets;src text;
begin
 perform private.require_mfa_admin();
 if p_key is null or p_coins is null or p_points is null or p_coins<0 or p_coins>1000000 or p_points<0 or p_points>1000000 or p_coins+p_points=0
 or p_reason is null or char_length(btrim(p_reason)) not between 5 and 500 then raise exception 'valid amounts, reason and request key required';end if;
 perform pg_advisory_xact_lock(hashtext('manual:'||auth.uid()::text||':'||p_key::text));
 select id into target from auth.users where lower(email)=lower(btrim(p_email));
 if target is null then raise exception 'account not found';end if;
 select * into w from public.wallets where user_id=target for update;
 src:=auth.uid()::text||':'||p_key::text;
 -- Each request is all-or-nothing, and must preserve both amounts and recipient on retry.
 if exists(select 1 from public.audit_log where action='wallet.manual_credit' and target_id=src) then
  if not exists(select 1 from public.audit_log where action='wallet.manual_credit' and target_id=src
   and detail=jsonb_build_object('user_id',target,'coins',p_coins,'points',p_points,'reason',btrim(p_reason))) then raise exception 'request key already used';end if;
  return w;
 end if;
 if p_coins>0 then e:=private.post_ledger(target,'admin_gift',0,p_coins,'admin_credit',src,'coins',btrim(p_reason),'manual:'||src||':coins',now(),null,auth.uid());end if;
 if p_points>0 then e:=private.post_ledger(target,'recognition',p_points,0,'admin_credit',src,'points',btrim(p_reason),'manual:'||src||':points',now(),null,auth.uid());end if;
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'wallet.manual_credit','user',src,
 jsonb_build_object('user_id',target,'coins',p_coins,'points',p_points,'reason',btrim(p_reason)));
 select * into w from public.wallets where user_id=target;return w;
end $$;

create table public.community_stories(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 title text not null default '' check(char_length(title)<=140),body text not null default '' check(char_length(body)<=12000),
 linkedin_url text check(linkedin_url ~ '^https://(www\.)?linkedin\.com/(posts/|feed/update/)[^[:space:]<>"'']+$' and char_length(linkedin_url)<=1000),
 status text not null default 'draft' check(status in ('draft','pending','published','rejected','withdrawn')),
 consent_at timestamptz,submitted_at timestamptz,published_at timestamptz,review_note text check(char_length(review_note)<=500),
 award_entry_id bigint references public.ledger_entries(id),awarded_points integer not null default 0 check(awarded_points>=0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table private.story_source_claims(
 source_hash text primary key,story_id uuid references public.community_stories(id) on delete set null
);
alter table private.story_source_claims enable row level security;
create index story_source_story on private.story_source_claims(story_id);
create index stories_award_entry on public.community_stories(award_entry_id);
revoke all on private.story_source_claims from public,anon,authenticated,service_role;
create index stories_owner on public.community_stories(user_id,updated_at);
alter table public.community_stories enable row level security;
revoke all on public.community_stories from public,anon,authenticated;
grant select on public.community_stories to authenticated;
grant all on public.community_stories to service_role;
create policy stories_own on public.community_stories for select to authenticated using(user_id=auth.uid() or public.is_admin());
create function public.save_story(p_id uuid,p_title text,p_body text,p_linkedin_url text default null)
returns public.community_stories language plpgsql security definer set search_path='' as $$
declare r public.community_stories;link text:=nullif(regexp_replace(rtrim(split_part(split_part(btrim(p_linkedin_url),'?',1),'#',1),'/'),'^https://linkedin[.]com/','https://www.linkedin.com/'),'');
begin
 if auth.uid() is null then raise exception 'sign in required';end if;
 if p_title is null or p_body is null or char_length(p_title)>140 or char_length(p_body)>12000 then raise exception 'story too long or missing';end if;
 if p_id is null then
  perform pg_advisory_xact_lock(hashtext('story:'||auth.uid()::text));
  if(select count(*) from public.community_stories where user_id=auth.uid() and status<>'published')>=20 then raise exception 'too many draft stories';end if;
  insert into public.community_stories(user_id,title,body,linkedin_url)values(auth.uid(),btrim(p_title),btrim(p_body),link)returning * into r;
 else
  select * into r from public.community_stories where id=p_id and user_id=auth.uid() for update;
  if not found then raise exception 'story not found';end if;
  update public.community_stories set title=btrim(p_title),body=btrim(p_body),linkedin_url=link,status='draft',published_at=null,review_note=null,consent_at=null,updated_at=now() where id=r.id returning * into r;
 end if;
 return r;
end $$;
create function public.submit_story(p_id uuid,p_consent boolean)returns public.community_stories language plpgsql security definer set search_path='' as $$
declare r public.community_stories;
begin
 if auth.uid() is null then raise exception 'sign in required';end if;
 perform pg_advisory_xact_lock(hashtext('story:'||auth.uid()::text));
 select * into r from public.community_stories where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception 'story not found';end if;
 if r.status='pending' then return r;end if;
 if r.status='published' then raise exception 'already published';end if;
 if p_consent is distinct from true or char_length(r.title)<5 or char_length(r.body)<100 then raise exception 'title, at least 100 characters and explicit sharing consent required';end if;
 if not exists(select 1 from public.member_profiles where user_id=auth.uid() and visibility='public' and adult_confirmed and not suspended) then raise exception 'a public adult profile is required to publish';end if;
 if(select count(*) from public.audit_log where actor=auth.uid() and action='story.submit' and created_at>now()-interval '24 hours')>=5 then raise exception 'submission limit reached';end if;
 update public.community_stories set status='pending',consent_at=now(),submitted_at=now(),updated_at=now() where id=r.id returning * into r;
 insert into public.audit_log(actor,action,target_type,target_id)values(auth.uid(),'story.submit','story',r.id::text);
 return r;
end $$;
create function public.withdraw_story(p_id uuid)returns void language plpgsql security definer set search_path='' as $$
begin
 update public.community_stories set status='withdrawn',published_at=null,updated_at=now() where id=p_id and user_id=auth.uid();
 if not found then raise exception 'story not found';end if;
end $$;
create function public.admin_review_story(p_id uuid,p_publish boolean,p_points integer,p_note text)
returns public.community_stories language plpgsql security definer set search_path='' as $$
declare r public.community_stories;e public.ledger_entries;
begin
 perform private.require_mfa_admin();
 if p_points is null or p_points<0 or p_points>500 or p_publish is null or p_note is null or char_length(btrim(p_note)) not between 1 and 500 then raise exception 'valid decision, points and review note required';end if;
 select * into r from public.community_stories where id=p_id for update;
 if not found then raise exception 'story not found';end if;
 if r.status='published' and p_publish then return r;end if;
 if r.status not in ('pending','published') then raise exception 'story not awaiting review';end if;
 if p_publish then
  if r.consent_at is null or not exists(select 1 from public.member_profiles where user_id=r.user_id and visibility='public' and adult_confirmed and not suspended)then raise exception 'author consent and public adult profile required';end if;
  if r.linkedin_url is not null then
   insert into private.story_source_claims(source_hash,story_id)
   values(encode(sha256(convert_to(lower(r.linkedin_url),'UTF8')),'hex'),r.id) on conflict do nothing;
   if not exists(select 1 from private.story_source_claims where source_hash=encode(sha256(convert_to(lower(r.linkedin_url),'UTF8')),'hex') and story_id=r.id) then raise exception 'LinkedIn source already accepted for another story';end if;
  end if;
  if r.award_entry_id is null and p_points>0 then
   e:=private.post_ledger(r.user_id,'recognition',p_points,0,'community_story',r.id::text,'primary','Accepted community story','story:'||r.id::text,now(),null,auth.uid());
   update public.community_stories set award_entry_id=e.id,awarded_points=p_points where id=r.id;
  end if;
 end if;
 update public.community_stories set status=case when p_publish then 'published' else 'rejected' end,
  published_at=case when p_publish then now() else null end,review_note=btrim(p_note),updated_at=now() where id=r.id returning * into r;
 insert into public.audit_log(actor,action,target_type,target_id,detail)values(auth.uid(),'story.review','story',r.id::text,jsonb_build_object('published',p_publish,'points',r.awarded_points));
 return r;
end $$;
create function public.stories_feed(p_id uuid default null)
returns table(id uuid,title text,body text,author text,linkedin_url text,published_at timestamptz)
language sql stable security definer set search_path='' as $$
 select s.id,s.title,s.body,m.display_name,s.linkedin_url,s.published_at from public.community_stories s
 join public.member_profiles m on m.user_id=s.user_id
 where s.status='published' and m.visibility='public' and m.adult_confirmed and not m.suspended and(p_id is null or s.id=p_id)
 order by s.published_at desc,s.id limit 40;
$$;
revoke all on function public.save_story(uuid,text,text,text),public.submit_story(uuid,boolean),public.withdraw_story(uuid),
 public.admin_review_story(uuid,boolean,integer,text),public.admin_credit_account(text,integer,integer,text,uuid),public.stories_feed(uuid) from public,anon;
grant execute on function public.save_story(uuid,text,text,text),public.submit_story(uuid,boolean),public.withdraw_story(uuid),
 public.admin_review_story(uuid,boolean,integer,text),public.admin_credit_account(text,integer,integer,text,uuid),public.stories_feed(uuid) to authenticated;
grant execute on function public.stories_feed(uuid) to anon,service_role;
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  out jsonb;
  t text;
  col text;
  rows jsonb;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  out := jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
                                          'sign_in_methods', coalesce((select jsonb_agg(distinct i.provider) from auth.identities i where i.user_id = u.id), '[]'::jsonb))
                from auth.users u where u.id = uid));
  -- table and the column that holds the member's id; tables from later migrations are included when present
  foreach t in array array[
    'profiles:user_id', 'member_profiles:user_id', 'profile_links:user_id', 'github_links:user_id', 'wallets:user_id',
    'ledger_entries:user_id', 'contributions:user_id', 'reward_claims:user_id', 'purchases:user_id', 'inventory:user_id',
    'equipped_items:user_id', 'topup_requests:user_id', 'community_stories:user_id', 'feedback_submissions:user_id', 'profile_reports:reporter'] loop
    col := split_part(t, ':', 2);
    t := split_part(t, ':', 1);
    if to_regclass('public.' || t) is not null then
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x where x.%I = $1', t, col)
        into rows using uid;
      out := out || jsonb_build_object(t, rows);
    end if;
  end loop;
  return out;
end $$;
commit;
