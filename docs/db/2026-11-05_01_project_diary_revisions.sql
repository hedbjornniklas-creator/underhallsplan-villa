-- Internal project manager edits only. QR remains submission-only.
-- Originals, archived photos, corrections and other modules are never rewritten.
begin;
create table if not exists public.action_case_diary_revisions (
  entry_id uuid not null references public.action_case_diary_entries(id),
  revision integer not null check(revision>=0), request_id uuid unique,
  request_payload jsonb, body jsonb not null, photo_ids uuid[] not null,
  item_title text not null, minutes integer not null check(minutes>0 and minutes<1440),
  actor_profile_id uuid references public.profiles(id), actor_name text not null,
  created_at timestamptz not null,
  primary key(entry_id,revision),
  check((revision=0 and request_id is null) or (revision>0 and request_id is not null and request_payload is not null and actor_profile_id is not null)),
  check(cardinality(photo_ids)<=20)
);
alter table public.action_case_diary_revisions enable row level security;
revoke all on public.action_case_diary_revisions from public,anon,authenticated,service_role;
grant select on public.action_case_diary_revisions to service_role;
drop trigger if exists diary_history_immutable on public.action_case_diary_revisions;
create trigger diary_history_immutable before update or delete on public.action_case_diary_revisions
  for each row execute function public.protect_project_diary_history();

create or replace view public.action_case_diary_current with (security_invoker=true) as
select e.id,e.org_id,e.action_case_id,e.owner_key,e.request_hash,e.body,e.source_item_id,e.item_title,
  e.actor_profile_id,e.actor_name,e.author_email,e.actor_method,e.email_verified_at,e.minutes,e.work_date,e.received_at,e.person_id,
  coalesce(r.revision,0) revision, coalesce(r.body,e.body) current_body,
  coalesce(r.item_title,e.item_title) current_item_title, coalesce(r.minutes,e.minutes) current_minutes,
  case when r.entry_id is null then e.work_date else (r.body->>'workDate')::date end current_work_date,
  case when r.entry_id is null then e.source_item_id else (r.body->>'itemId')::uuid end current_source_item_id,
  coalesce(r.photo_ids,(select coalesce(array_agg(p.id order by p.position,p.id),'{}'::uuid[]) from public.action_case_diary_photos p where p.entry_id=e.id)) current_photo_ids,
  case when r.revision>0 then r.created_at end edited_at,
  case when r.revision>0 then r.actor_name end edited_by
from public.action_case_diary_entries e
left join lateral (select v.* from public.action_case_diary_revisions v where v.entry_id=e.id order by v.revision desc limit 1) r on true;
revoke all on public.action_case_diary_current from public,anon,authenticated,service_role;
grant select on public.action_case_diary_current to service_role;

create or replace function public.revise_project_diary_entry(p_org_id uuid,p_case_id uuid,p_actor_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare e public.action_case_diary_entries; old public.action_case_diary_revisions; saved public.action_case_diary_revisions;
  rid uuid; version integer; expected integer; files uuid[]; original_files uuid[]; body jsonb; title text:=''; minutes integer; stamp timestamptz; actor text; next_position integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_DIARY_FORBIDDEN'; end if;
  if p_actor_id is null then raise exception 'PROJECT_DIARY_MANAGER'; end if;
  perform 1 from public.org_members where org_id=p_org_id and profile_id=p_actor_id and is_active for share;
  if not found then raise exception 'PROJECT_DIARY_FORBIDDEN'; end if;
  perform 1 from public.action_cases where org_id=p_org_id and id=p_case_id and manager_profile_id=p_actor_id for share;
  if not found then raise exception 'PROJECT_DIARY_MANAGER'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or p_data-array['entryId','requestId','expectedRevision','body','photoIds']<>'{}'::jsonb
    or jsonb_typeof(p_data->'expectedRevision') is distinct from 'number' or (p_data->>'expectedRevision')::numeric<>trunc((p_data->>'expectedRevision')::numeric)
    or (p_data->>'expectedRevision')::numeric not between 0 and 2147483646 then raise exception 'PROJECT_DIARY_INVALID'; end if;
  rid:=(p_data->>'requestId')::uuid; expected:=(p_data->>'expectedRevision')::integer;
  if rid is null then raise exception 'PROJECT_DIARY_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('diary-revision-request:'||rid,0));
  select * into e from public.action_case_diary_entries where id=(p_data->>'entryId')::uuid and org_id=p_org_id and action_case_id=p_case_id for update;
  if not found then raise exception 'PROJECT_DIARY_NOT_FOUND'; end if;
  select * into saved from public.action_case_diary_revisions where request_id=rid;
  if found then
    if saved.entry_id<>e.id or saved.actor_profile_id<>p_actor_id or saved.request_payload<>p_data then raise exception 'PROJECT_DIARY_REQUEST_CONFLICT'; end if;
    return jsonb_build_object('id',rid,'entryId',e.id,'revision',saved.revision,'receivedAt',e.received_at,'editedAt',saved.created_at,'minutes',saved.minutes);
  end if;
  stamp:=clock_timestamp();
  if stamp>=e.received_at+interval '48 hours' then raise exception 'PROJECT_DIARY_EDIT_CLOSED'; end if;
  select * into old from public.action_case_diary_revisions where entry_id=e.id order by revision desc limit 1;
  version:=coalesce(old.revision,0);
  if version<>expected then raise exception 'PROJECT_DIARY_REVISION_STALE'; end if;
  body:=p_data->'body';
  if jsonb_typeof(body) is distinct from 'object' or body-array['name','company','workDate','startTime','endTime','breakMinutes','text','itemId']<>'{}'::jsonb
    or body->'name' is distinct from e.body->'name' or body->'company' is distinct from e.body->'company' or body->'breakMinutes' is distinct from e.body->'breakMinutes'
    or jsonb_typeof(body->'text') is distinct from 'string' or length(btrim(body->>'text')) not between 1 and 6000
    or (body->>'text') ~ '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]'
    or coalesce(body->>'workDate','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    or coalesce(body->>'startTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(body->>'endTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or not(body ? 'itemId') then raise exception 'PROJECT_DIARY_INVALID'; end if;
  minutes:=extract(epoch from ((body->>'endTime')::time-(body->>'startTime')::time))/60-(body->>'breakMinutes')::integer;
  if (body->>'workDate')::date>(stamp at time zone 'Europe/Stockholm')::date or minutes<=0 or minutes>=1440 then raise exception 'PROJECT_DIARY_INVALID'; end if;
  if body->'itemId'<>'null'::jsonb then
    select i.title into title from public.action_case_items i where i.id=(body->>'itemId')::uuid and i.org_id=p_org_id and i.action_case_id=p_case_id;
    if title is null then raise exception 'PROJECT_DIARY_ITEM'; end if;
  end if;
  if jsonb_typeof(p_data->'photoIds') is distinct from 'array' or jsonb_array_length(p_data->'photoIds')>20 then raise exception 'PROJECT_DIARY_PHOTO'; end if;
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into files from jsonb_array_elements_text(p_data->'photoIds');
  if cardinality(files)<>(select count(distinct f) from unnest(files) f) then raise exception 'PROJECT_DIARY_PHOTO'; end if;
  perform 1 from public.action_case_diary_uploads where id=any(files) order by id for update;
  stamp:=clock_timestamp();
  if stamp>=e.received_at+interval '48 hours' then raise exception 'PROJECT_DIARY_EDIT_CLOSED'; end if;
  if exists(select 1 from unnest(files) f where not exists(select 1 from public.action_case_diary_photos p where p.id=f and p.entry_id=e.id)
    and not exists(select 1 from public.action_case_diary_uploads u where u.id=f and u.org_id=p_org_id and u.action_case_id=p_case_id and u.owner_key='profile:'||p_actor_id
      and u.state='ready' and u.entry_id is null and u.expires_at>stamp and u.sha256 ~ '^[a-f0-9]{64}$')) then raise exception 'PROJECT_DIARY_PHOTO'; end if;
  if version=0 and old.entry_id is null then
    select coalesce(array_agg(p.id order by p.position,p.id),'{}'::uuid[]) into original_files from public.action_case_diary_photos p where p.entry_id=e.id;
    insert into public.action_case_diary_revisions(entry_id,revision,body,photo_ids,item_title,minutes,actor_profile_id,actor_name,created_at)
      values(e.id,0,e.body,original_files,e.item_title,e.minutes,e.actor_profile_id,e.actor_name,e.received_at);
  end if;
  select coalesce(max(p.position),0) into next_position from public.action_case_diary_photos p where p.entry_id=e.id;
  insert into public.action_case_diary_photos(id,entry_id,name,content_type,size_bytes,sha256,position)
    select u.id,e.id,u.name,u.content_type,u.size_bytes,u.sha256,next_position+array_position(files,u.id) from public.action_case_diary_uploads u
      where u.id=any(files) and u.state='ready' and not exists(select 1 from public.action_case_diary_photos p where p.id=u.id);
  update public.action_case_diary_uploads set state='attached',entry_id=e.id where id=any(files) and entry_id is null;
  select coalesce(nullif(btrim(full_name),''),email,'Projektansvarig') into actor from public.profiles where id=p_actor_id;
  insert into public.action_case_diary_revisions(entry_id,revision,request_id,request_payload,body,photo_ids,item_title,minutes,actor_profile_id,actor_name,created_at)
    values(e.id,version+1,rid,p_data,body,files,coalesce(title,''),minutes,p_actor_id,actor,stamp);
  return jsonb_build_object('id',rid,'entryId',e.id,'revision',version+1,'receivedAt',e.received_at,'editedAt',stamp,'minutes',minutes);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'PROJECT_DIARY_INVALID';
end $$;
revoke all on function public.revise_project_diary_entry(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.revise_project_diary_entry(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
