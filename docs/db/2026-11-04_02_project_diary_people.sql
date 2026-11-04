-- Project-local, self-reported people. No email login, contract or calculation writes.
-- Run after 2026-11-04_01_project_diary.sql, immediately before the matching release.
begin;
create table if not exists public.action_case_diary_people (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  action_case_id uuid not null references public.action_cases(id),
  name text not null check(length(btrim(name)) between 1 and 160),
  company text not null check(length(btrim(company)) between 1 and 160),
  name_key text generated always as (lower(regexp_replace(btrim(name),'\s+',' ','g'))) stored,
  company_key text generated always as (lower(regexp_replace(btrim(company),'\s+',' ','g'))) stored,
  owner_key text not null,
  created_at timestamptz not null default now(),
  unique(action_case_id,name_key,company_key)
);
alter table public.action_case_diary_people enable row level security;
revoke all on public.action_case_diary_people from public,anon,authenticated,service_role;
grant select on public.action_case_diary_people to service_role;
drop trigger if exists diary_history_immutable on public.action_case_diary_people;
create trigger diary_history_immutable before update or delete on public.action_case_diary_people for each row execute function public.protect_project_diary_history();
create index if not exists project_diary_people_project on public.action_case_diary_people(org_id,action_case_id,name_key);
create index if not exists project_diary_people_owner on public.action_case_diary_people(action_case_id,owner_key,created_at);

-- Populate only the new directory; originals and their recorded identity remain untouched.
insert into public.action_case_diary_people(org_id,action_case_id,name,company,owner_key)
select org_id,action_case_id,name,company,'history' from (
  select distinct on (org_id,action_case_id,lower(regexp_replace(btrim(body->>'name'),'\s+',' ','g')),lower(regexp_replace(btrim(body->>'company'),'\s+',' ','g')))
    org_id,action_case_id,regexp_replace(btrim(body->>'name'),'\s+',' ','g') name,regexp_replace(btrim(body->>'company'),'\s+',' ','g') company
  from public.action_case_diary_entries
  where length(btrim(body->>'name')) between 1 and 160 and length(btrim(body->>'company')) between 1 and 160
  order by org_id,action_case_id,lower(regexp_replace(btrim(body->>'name'),'\s+',' ','g')),lower(regexp_replace(btrim(body->>'company'),'\s+',' ','g')),received_at,id
) originals on conflict(action_case_id,name_key,company_key) do nothing;
alter table public.action_case_diary_entries add column if not exists person_id uuid references public.action_case_diary_people(id);
alter table public.action_case_diary_entries drop constraint if exists action_case_diary_entries_actor_method_check;
alter table public.action_case_diary_entries add constraint action_case_diary_entries_actor_method_check check(actor_method in ('internal_login','email_code','qr_selection'));
create index if not exists project_diary_entry_person on public.action_case_diary_entries(org_id,action_case_id,person_id,work_date desc);

create or replace function public.project_diary_people_context(p_link_id uuid,p_nonce uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_catalog as $$
declare l public.action_case_diary_links; project_title text; people jsonb; items jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_DIARY_FORBIDDEN'; end if;
  select * into l from public.action_case_diary_links where id=p_link_id and nonce=p_nonce and active;
  if l.id is null then raise exception 'PROJECT_DIARY_NOT_FOUND'; end if;
  select c.title into project_title from public.action_cases c where c.id=l.action_case_id and c.org_id=l.org_id;
  if project_title is null then raise exception 'PROJECT_DIARY_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'company',p.company) order by p.name_key,p.company_key,p.id),'[]') into people
    from public.action_case_diary_people p where p.org_id=l.org_id and p.action_case_id=l.action_case_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'title',i.title) order by i.sort_order,i.id),'[]') into items
    from public.action_case_items i where i.org_id=l.org_id and i.action_case_id=l.action_case_id and i.status not in ('cancelled','declined');
  return jsonb_build_object('project',jsonb_build_object('id',l.action_case_id,'title',project_title),'people',people,'items',items);
end $$;

create or replace function public.project_diary_people_command(p_org_id uuid,p_case_id uuid,p_actor_id uuid,p_link_id uuid,p_nonce uuid,p_device_hash text,p_operation text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare l public.action_case_diary_links; person public.action_case_diary_people; e public.action_case_diary_entries; u public.action_case_diary_uploads;
  owner text; actor_name text; actor_email text:=''; person_name text; person_company text; body jsonb; minutes integer;
  rid uuid; file_ids uuid[]; body_date date; stamp timestamptz:=clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_DIARY_FORBIDDEN'; end if;
  if not exists(select 1 from public.action_cases c where c.id=p_case_id and c.org_id=p_org_id) then raise exception 'PROJECT_DIARY_NOT_FOUND'; end if;
  if p_actor_id is not null then
    if not exists(select 1 from public.org_members m where m.org_id=p_org_id and m.profile_id=p_actor_id and m.is_active) then raise exception 'PROJECT_DIARY_FORBIDDEN'; end if;
    if p_operation not in ('person','entry') then
      return public.project_diary_command(p_org_id,p_case_id,p_actor_id,null,null,null,p_operation,p_data);
    end if;
    select coalesce(nullif(btrim(p.full_name),''),p.email,'Intern anvandare'),coalesce(p.email,'') into actor_name,actor_email from public.profiles p where p.id=p_actor_id;
    owner:='profile:'||p_actor_id;
  else
    select * into l from public.action_case_diary_links where id=p_link_id and nonce=p_nonce and org_id=p_org_id and action_case_id=p_case_id and active for share;
    if l.id is null then raise exception 'PROJECT_DIARY_NOT_FOUND'; end if;
    if coalesce(p_device_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'PROJECT_DIARY_DEVICE'; end if;
    owner:='qr:'||p_device_hash; actor_name:='QR';
    if p_operation not in ('person','entry','reserve_photo','seal_photo') then raise exception 'PROJECT_DIARY_FORBIDDEN'; end if;
  end if;

  if p_operation='person' then
    if jsonb_typeof(p_data->'name') is distinct from 'string' or jsonb_typeof(p_data->'company') is distinct from 'string' then raise exception 'PROJECT_DIARY_PERSON'; end if;
    person_name:=regexp_replace(btrim(p_data->>'name'),'\s+',' ','g'); person_company:=regexp_replace(btrim(p_data->>'company'),'\s+',' ','g');
    if length(person_name) not between 1 and 160 or length(person_company) not between 1 and 160 or person_name ~ '[[:cntrl:]]' or person_company ~ '[[:cntrl:]]' then raise exception 'PROJECT_DIARY_PERSON'; end if;
    perform pg_advisory_xact_lock(hashtextextended('diary-people:'||p_case_id,0));
    select * into person from public.action_case_diary_people where org_id=p_org_id and action_case_id=p_case_id and name_key=lower(person_name) and company_key=lower(person_company);
    if person.id is null then
      if (select count(*) from public.action_case_diary_people where action_case_id=p_case_id)>=500
        or (p_actor_id is null and (select count(*) from public.action_case_diary_people where action_case_id=p_case_id and owner_key=owner and created_at>stamp-interval '1 day')>=15)
        or (p_actor_id is null and (select count(*) from public.action_case_diary_people where action_case_id=p_case_id and owner_key<>'history' and created_at>stamp-interval '1 day')>=100) then raise exception 'PROJECT_DIARY_RATE_LIMITED'; end if;
      insert into public.action_case_diary_people(org_id,action_case_id,name,company,owner_key) values(p_org_id,p_case_id,person_name,person_company,owner) returning * into person;
    end if;
    return jsonb_build_object('id',person.id,'name',person.name,'company',person.company);
  elsif p_operation='reserve_photo' then
    if coalesce(p_data->>'contentType','') not in ('image/jpeg','image/png','image/webp') or jsonb_typeof(p_data->'size') is distinct from 'number'
      or (p_data->>'size')::numeric<>trunc((p_data->>'size')::numeric) or (p_data->>'size')::numeric not between 1 and 8388608
      or length(coalesce(p_data->>'name','')) not between 1 and 250 or (p_data->>'name') ~ '[[:cntrl:]]' then raise exception 'PROJECT_DIARY_PHOTO'; end if;
    rid:=(p_data->>'id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended('diary-photo:'||p_case_id,0));
    select * into u from public.action_case_diary_uploads where id=rid;
    if u.id is not null then
      if u.org_id<>p_org_id or u.action_case_id<>p_case_id or u.owner_key<>owner or u.name<>p_data->>'name' or u.content_type<>p_data->>'contentType' or u.size_bytes<>(p_data->>'size')::integer or u.state='discarded' or u.expires_at<=stamp then raise exception 'PROJECT_DIARY_PHOTO'; end if;
      return to_jsonb(u);
    end if;
    if (select count(*) from public.action_case_diary_uploads where action_case_id=p_case_id and owner_key=owner and created_at>stamp-interval '1 day')>=40
      or (select count(*) from public.action_case_diary_uploads where action_case_id=p_case_id and created_at>stamp-interval '1 day')>=200
      or coalesce((select sum(size_bytes) from public.action_case_diary_uploads where action_case_id=p_case_id and created_at>stamp-interval '1 day'),0)+(p_data->>'size')::integer>524288000 then raise exception 'PROJECT_DIARY_RATE_LIMITED'; end if;
    insert into public.action_case_diary_uploads(id,org_id,action_case_id,owner_key,name,content_type,size_bytes) values(rid,p_org_id,p_case_id,owner,p_data->>'name',p_data->>'contentType',(p_data->>'size')::integer) returning * into u;
    return to_jsonb(u);
  elsif p_operation='seal_photo' then
    select * into u from public.action_case_diary_uploads where id=(p_data->>'id')::uuid and org_id=p_org_id and action_case_id=p_case_id and owner_key=owner for update;
    if u.id is null or u.state not in ('pending','ready') or u.expires_at<=stamp or coalesce(p_data->>'sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'PROJECT_DIARY_PHOTO'; end if;
    if u.state='ready' and u.sha256 is distinct from p_data->>'sha256' then raise exception 'PROJECT_DIARY_PHOTO'; end if;
    update public.action_case_diary_uploads set state='ready',sha256=p_data->>'sha256' where id=u.id;
    return jsonb_build_object('id',u.id,'name',u.name);
  elsif p_operation='entry' then
    rid:=(p_data->>'requestId')::uuid;
    if coalesce(p_data->>'requestHash','') !~ '^[a-f0-9]{64}$' then raise exception 'PROJECT_DIARY_INVALID'; end if;
    perform pg_advisory_xact_lock(hashtextextended('diary-entry:'||rid,0));
    select * into e from public.action_case_diary_entries where id=rid;
    if e.id is not null then
      if e.org_id<>p_org_id or e.action_case_id<>p_case_id or e.owner_key<>owner or e.request_hash<>p_data->>'requestHash' then raise exception 'PROJECT_DIARY_REQUEST_CONFLICT'; end if;
      return jsonb_build_object('id',e.id,'receivedAt',e.received_at,'minutes',e.minutes);
    end if;
    select * into person from public.action_case_diary_people where id=(p_data->>'personId')::uuid and org_id=p_org_id and action_case_id=p_case_id;
    if person.id is null then raise exception 'PROJECT_DIARY_PERSON'; end if;
    body:=p_data->'body';
    if jsonb_typeof(body) is distinct from 'object' or body-array['name','company','workDate','startTime','endTime','breakMinutes','text','itemId']<>'{}'::jsonb
      or (body->>'name') is distinct from person.name or (body->>'company') is distinct from person.company
      or jsonb_typeof(body->'text') is distinct from 'string' or length(btrim(body->>'text')) not between 1 and 6000
      or coalesce(body->>'workDate','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or coalesce(body->>'startTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(body->>'endTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or jsonb_typeof(body->'breakMinutes') is distinct from 'number' or (body->>'breakMinutes')::numeric<>trunc((body->>'breakMinutes')::numeric) or (body->>'breakMinutes')::integer<0 then raise exception 'PROJECT_DIARY_INVALID'; end if;
    body_date:=(body->>'workDate')::date;
    minutes:=extract(epoch from ((body->>'endTime')::time-(body->>'startTime')::time))/60-(body->>'breakMinutes')::integer;
    if body_date>(stamp at time zone 'Europe/Stockholm')::date or minutes<=0 or minutes>=1440 then raise exception 'PROJECT_DIARY_INVALID'; end if;
    if body->'itemId' is distinct from 'null'::jsonb and not exists(select 1 from public.action_case_items i where i.id=(body->>'itemId')::uuid and i.org_id=p_org_id and i.action_case_id=p_case_id) then raise exception 'PROJECT_DIARY_ITEM'; end if;
    if jsonb_typeof(p_data->'photoIds') is distinct from 'array' or jsonb_array_length(p_data->'photoIds')>8 then raise exception 'PROJECT_DIARY_PHOTO'; end if;
    select coalesce(array_agg(value::uuid),'{}'::uuid[]) into file_ids from jsonb_array_elements_text(p_data->'photoIds');
    if cardinality(file_ids)<>(select count(distinct x) from unnest(file_ids) x) then raise exception 'PROJECT_DIARY_PHOTO'; end if;
    perform pg_advisory_xact_lock(hashtextextended('diary-entry-project:'||p_case_id,0));
    if p_actor_id is null and ((select count(*) from public.action_case_diary_entries where action_case_id=p_case_id and owner_key=owner and received_at>stamp-interval '1 day')>=50
      or (select count(*) from public.action_case_diary_entries where action_case_id=p_case_id and actor_method='qr_selection' and received_at>stamp-interval '1 day')>=200) then raise exception 'PROJECT_DIARY_RATE_LIMITED'; end if;
    perform 1 from public.action_case_diary_uploads where id=any(file_ids) order by id for update;
    if cardinality(file_ids)<>(select count(*) from public.action_case_diary_uploads where id=any(file_ids) and org_id=p_org_id and action_case_id=p_case_id and owner_key=owner and state='ready' and entry_id is null and expires_at>stamp and sha256 ~ '^[a-f0-9]{64}$') then raise exception 'PROJECT_DIARY_PHOTO'; end if;
    insert into public.action_case_diary_entries(id,org_id,action_case_id,owner_key,request_hash,body,source_item_id,item_title,actor_profile_id,actor_name,author_email,actor_method,email_verified_at,minutes,work_date,person_id)
      values(rid,p_org_id,p_case_id,owner,p_data->>'requestHash',body,(body->>'itemId')::uuid,coalesce((select i.title from public.action_case_items i where i.id=(body->>'itemId')::uuid and i.action_case_id=p_case_id and i.org_id=p_org_id),''),p_actor_id,actor_name,actor_email,case when p_actor_id is null then 'qr_selection' else 'internal_login' end,null,minutes,body_date,person.id) returning * into e;
    insert into public.action_case_diary_photos(id,entry_id,name,content_type,size_bytes,sha256,position)
      select photo.id,rid,photo.name,photo.content_type,photo.size_bytes,photo.sha256,array_position(file_ids,photo.id) from public.action_case_diary_uploads photo where photo.id=any(file_ids);
    update public.action_case_diary_uploads set state='attached',entry_id=rid where id=any(file_ids);
    return jsonb_build_object('id',e.id,'receivedAt',e.received_at,'minutes',e.minutes);
  end if;
  raise exception 'PROJECT_DIARY_INVALID';
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'PROJECT_DIARY_INVALID';
end $$;
-- Retain old verification records for history, but retire their public entry points.
revoke all on function public.project_diary_public_context(uuid,uuid,text),public.project_diary_command(uuid,uuid,uuid,uuid,uuid,text,text,jsonb) from service_role;
revoke all on function public.project_diary_people_context(uuid,uuid),public.project_diary_people_command(uuid,uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.project_diary_people_context(uuid,uuid),public.project_diary_people_command(uuid,uuid,uuid,uuid,uuid,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
