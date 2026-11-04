-- Separate site diary. Requires action_cases, action_case_items and explicit manager_profile_id.
-- No backfill, contract, calculation, task or customer-sharing writes.
begin;
create table if not exists public.action_case_diary_links (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
  action_case_id uuid not null unique references public.action_cases(id), active boolean not null default false,
  nonce uuid not null default gen_random_uuid(), revision integer not null default 1,
  updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
create table if not exists public.action_case_diary_challenges (
  id uuid primary key, link_id uuid not null references public.action_case_diary_links(id), nonce uuid not null,
  email text not null, browser_hash text not null, code_hash text not null, client_hash text not null,
  attempts integer not null default 0, created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '10 minutes'), consumed_at timestamptz
);
create table if not exists public.action_case_diary_sessions (
  id uuid primary key, link_id uuid not null references public.action_case_diary_links(id), nonce uuid not null,
  token_hash text not null unique, email text not null, name text not null default '', company text not null default '',
  verified_at timestamptz not null default now(), expires_at timestamptz not null default (now()+interval '30 days'), revoked_at timestamptz
);
create table if not exists public.action_case_diary_entries (
  id uuid primary key, org_id uuid not null references public.organizations(id), action_case_id uuid not null references public.action_cases(id),
  owner_key text not null, request_hash text not null, body jsonb not null, source_item_id uuid, item_title text not null default '',
  actor_profile_id uuid references public.profiles(id), actor_name text not null, author_email text not null,
  actor_method text not null check(actor_method in ('internal_login','email_code')), email_verified_at timestamptz,
  minutes integer not null check(minutes>0 and minutes<1440), work_date date not null, received_at timestamptz not null default now()
);
create table if not exists public.action_case_diary_uploads (
  id uuid primary key, org_id uuid not null references public.organizations(id), action_case_id uuid not null references public.action_cases(id),
  owner_key text not null, name text not null, content_type text not null, size_bytes integer not null check(size_bytes>0 and size_bytes<=8388608),
  state text not null default 'pending' check(state in ('pending','ready','attached','discarded')), sha256 text,
  entry_id uuid references public.action_case_diary_entries(id), created_at timestamptz not null default now(), expires_at timestamptz not null default (now()+interval '24 hours')
);
create table if not exists public.action_case_diary_photos (
  id uuid primary key references public.action_case_diary_uploads(id), entry_id uuid not null references public.action_case_diary_entries(id),
  name text not null, content_type text not null, size_bytes integer not null, sha256 text not null, position integer not null
);
create table if not exists public.action_case_diary_corrections (
  id uuid primary key, entry_id uuid not null references public.action_case_diary_entries(id), actor_profile_id uuid not null references public.profiles(id),
  actor_name text not null, text text not null check(length(btrim(text)) between 1 and 3000), created_at timestamptz not null default now()
);
create index if not exists project_diary_entry_dates on public.action_case_diary_entries(org_id,action_case_id,work_date desc,received_at desc,id);
alter table public.action_case_diary_uploads add column if not exists cleaned_at timestamptz;
create index if not exists project_diary_code_email on public.action_case_diary_challenges(email,created_at);
create index if not exists project_diary_code_client on public.action_case_diary_challenges(client_hash,created_at);
create index if not exists project_diary_code_project on public.action_case_diary_challenges(link_id,created_at);
create index if not exists project_diary_upload_owner on public.action_case_diary_uploads(action_case_id,owner_key,created_at);
create index if not exists project_diary_photo_entries on public.action_case_diary_photos(entry_id,position);
create index if not exists project_diary_correction_entries on public.action_case_diary_corrections(entry_id,created_at,id);
create index if not exists project_diary_cleanup on public.action_case_diary_uploads(org_id,action_case_id,expires_at) where entry_id is null and cleaned_at is null;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('project-diary-files','project-diary-files',false,8388608,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
do $$ begin
  if exists(select 1 from storage.buckets where id='project-diary-files' and (public or file_size_limit is null or file_size_limit>8388608 or allowed_mime_types is null or not allowed_mime_types <@ array['image/jpeg','image/png','image/webp']::text[])) then raise exception 'PROJECT_DIARY_STORAGE_CONFIG'; end if;
end $$;
create or replace function public.protect_project_diary_history() returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin raise exception 'PROJECT_DIARY_IMMUTABLE'; end $$;
do $$ declare t text; begin
  foreach t in array array['action_case_diary_links','action_case_diary_challenges','action_case_diary_sessions','action_case_diary_entries','action_case_diary_uploads','action_case_diary_photos','action_case_diary_corrections'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
  foreach t in array array['action_case_diary_entries','action_case_diary_photos','action_case_diary_corrections'] loop
    execute format('drop trigger if exists diary_history_immutable on public.%I',t);
    execute format('create trigger diary_history_immutable before update or delete on public.%I for each row execute function public.protect_project_diary_history()',t);
  end loop;
end $$;

create or replace function public.project_diary_public_context(p_link_id uuid,p_nonce uuid,p_session_hash text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_catalog as $$
declare l public.action_case_diary_links; s public.action_case_diary_sessions; title text; items jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_DIARY_FORBIDDEN'; end if;
  select * into l from public.action_case_diary_links where id=p_link_id and nonce=p_nonce and active;
  if l.id is null then raise exception 'PROJECT_DIARY_NOT_FOUND'; end if;
  select c.title into title from public.action_cases c where c.id=l.action_case_id and c.org_id=l.org_id;
  if title is null then raise exception 'PROJECT_DIARY_NOT_FOUND'; end if;
  select * into s from public.action_case_diary_sessions where link_id=l.id and nonce=l.nonce and token_hash=p_session_hash and revoked_at is null and expires_at>now();
  if s.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'title',i.title) order by i.sort_order,i.id),'[]') into items
      from public.action_case_items i where i.action_case_id=l.action_case_id and i.org_id=l.org_id and i.status not in ('cancelled','declined');
  end if;
  return jsonb_build_object('project',jsonb_build_object('id',l.action_case_id,'title',title),
    'session',case when s.id is null then null else jsonb_build_object('id',s.id,'email',s.email,'name',s.name,'company',s.company,'expiresAt',s.expires_at) end,'items',coalesce(items,'[]'));
end $$;

create or replace function public.project_diary_command(p_org_id uuid,p_case_id uuid,p_actor_id uuid,p_link_id uuid,p_nonce uuid,p_session_hash text,p_operation text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare l public.action_case_diary_links; s public.action_case_diary_sessions; ch public.action_case_diary_challenges;
  e public.action_case_diary_entries; u public.action_case_diary_uploads; corr public.action_case_diary_corrections;
  manager uuid; owner text; actor_name text; author_email text; item_title text:=''; body jsonb; minutes integer;
  rid uuid; file_ids uuid[]; fid uuid; body_date date; stamp timestamptz:=clock_timestamp(); result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_DIARY_FORBIDDEN'; end if;
  select c.manager_profile_id into manager from public.action_cases c where c.id=p_case_id and c.org_id=p_org_id;
  if not found then raise exception 'PROJECT_DIARY_NOT_FOUND'; end if;
  if p_actor_id is not null then
    if not exists(select 1 from public.org_members m where m.org_id=p_org_id and m.profile_id=p_actor_id and m.is_active) then raise exception 'PROJECT_DIARY_FORBIDDEN'; end if;
    select coalesce(nullif(btrim(p.full_name),''),p.email,'Intern anvandare'),coalesce(p.email,'') into actor_name,author_email from public.profiles p where p.id=p_actor_id;
    owner:='profile:'||p_actor_id;
  else
    select * into l from public.action_case_diary_links where id=p_link_id and org_id=p_org_id and action_case_id=p_case_id and nonce=p_nonce and active for share;
    if l.id is null then raise exception 'PROJECT_DIARY_NOT_FOUND'; end if;
    if p_operation not in ('challenge','verify') then
      select * into s from public.action_case_diary_sessions where link_id=l.id and nonce=l.nonce and token_hash=p_session_hash and revoked_at is null and expires_at>stamp for update;
      if s.id is null then raise exception 'PROJECT_DIARY_SESSION'; end if;
      owner:='session:'||s.id; author_email:=s.email; actor_name:=s.email;
    end if;
  end if;

  if p_operation in ('link_enable','link_disable') then
    if p_actor_id is null or manager is distinct from p_actor_id then raise exception 'PROJECT_DIARY_MANAGER'; end if;
    perform pg_advisory_xact_lock(hashtextextended('diary-link:'||p_case_id,0));
    select * into l from public.action_case_diary_links where action_case_id=p_case_id for update;
    if coalesce(l.revision,0) is distinct from (p_data->>'expectedRevision')::integer then raise exception 'PROJECT_DIARY_STALE'; end if;
    insert into public.action_case_diary_links(org_id,action_case_id,active,updated_by) values(p_org_id,p_case_id,p_operation='link_enable',p_actor_id)
      on conflict(action_case_id) do update set active=excluded.active,nonce=gen_random_uuid(),revision=action_case_diary_links.revision+1,updated_by=p_actor_id,updated_at=stamp returning * into l;
    return jsonb_build_object('revision',l.revision,'active',l.active);
  elsif p_operation='challenge' then
    if p_actor_id is not null or length(p_data->>'email')>254 or (p_data->>'email') !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
      or coalesce(p_data->>'browserHash','') !~ '^[a-f0-9]{64}$' or coalesce(p_data->>'codeHash','') !~ '^[a-f0-9]{64}$' or coalesce(p_data->>'clientHash','') !~ '^[a-f0-9]{64}$' then raise exception 'PROJECT_DIARY_INVALID'; end if;
    perform pg_advisory_xact_lock(hashtextextended('diary-client:'||(p_data->>'clientHash'),0));
    perform pg_advisory_xact_lock(hashtextextended('diary-email:'||(p_data->>'email'),0));
    perform pg_advisory_xact_lock(hashtextextended('diary-code-project:'||p_case_id,0));
    if (select count(*) from public.action_case_diary_challenges where email=p_data->>'email' and created_at>stamp-interval '1 hour')>=5
      or exists(select 1 from public.action_case_diary_challenges where email=p_data->>'email' and created_at>stamp-interval '60 seconds')
      or (select count(*) from public.action_case_diary_challenges where client_hash=p_data->>'clientHash' and created_at>stamp-interval '1 hour')>=30
      or (select count(*) from public.action_case_diary_challenges where link_id=l.id and created_at>stamp-interval '1 day')>=200 then raise exception 'PROJECT_DIARY_RATE_LIMITED'; end if;
    insert into public.action_case_diary_challenges(id,link_id,nonce,email,browser_hash,code_hash,client_hash) values((p_data->>'id')::uuid,l.id,l.nonce,lower(btrim(p_data->>'email')),p_data->>'browserHash',p_data->>'codeHash',p_data->>'clientHash');
    return jsonb_build_object('sent',true);
  elsif p_operation='verify' then
    if p_actor_id is not null or coalesce(p_data->>'sessionHash','') !~ '^[a-f0-9]{64}$' then raise exception 'PROJECT_DIARY_INVALID'; end if;
    select * into ch from public.action_case_diary_challenges where id=(p_data->>'id')::uuid and link_id=l.id and nonce=l.nonce and browser_hash=p_data->>'browserHash' for update;
    if ch.id is null or ch.expires_at<=stamp then return jsonb_build_object('outcome','expired'); end if;
    if ch.attempts>=5 then return jsonb_build_object('outcome','locked','attemptsRemaining',0); end if;
    if ch.code_hash is distinct from p_data->>'codeHash' then
      update public.action_case_diary_challenges set attempts=attempts+1 where id=ch.id;
      return jsonb_build_object('outcome','invalid','attemptsRemaining',4-ch.attempts);
    end if;
    if ch.consumed_at is null then
      insert into public.action_case_diary_sessions(id,link_id,nonce,token_hash,email) values(ch.id,l.id,l.nonce,p_data->>'sessionHash',ch.email);
      update public.action_case_diary_challenges set consumed_at=stamp where id=ch.id;
    end if;
    select * into s from public.action_case_diary_sessions where id=ch.id and token_hash=p_data->>'sessionHash' and revoked_at is null and expires_at>stamp;
    if s.id is null then return jsonb_build_object('outcome','expired'); end if;
    return jsonb_build_object('outcome','verified','expiresAt',s.expires_at);
  elsif p_operation='logout' then
    if s.id is null then raise exception 'PROJECT_DIARY_SESSION'; end if;
    update public.action_case_diary_sessions set revoked_at=stamp where id=s.id;
    return jsonb_build_object('loggedOut',true);
  elsif p_operation='reserve_photo' then
    if owner is null or coalesce(p_data->>'contentType','') not in ('image/jpeg','image/png','image/webp') or jsonb_typeof(p_data->'size')<>'number'
      or (p_data->>'size')::numeric not between 1 and 8388608 or length(coalesce(p_data->>'name','')) not between 1 and 250 or (p_data->>'name') ~ '[[:cntrl:]]' then raise exception 'PROJECT_DIARY_PHOTO'; end if;
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
    if owner is null or coalesce(p_data->>'requestHash','') !~ '^[a-f0-9]{64}$' then raise exception 'PROJECT_DIARY_INVALID'; end if;
    perform pg_advisory_xact_lock(hashtextextended('diary-entry:'||rid,0));
    select * into e from public.action_case_diary_entries where id=rid;
    if e.id is not null then
      if e.org_id<>p_org_id or e.action_case_id<>p_case_id or e.request_hash<>p_data->>'requestHash' or not(e.owner_key=owner or (s.id is not null and e.actor_method='email_code' and e.author_email=s.email)) then raise exception 'PROJECT_DIARY_REQUEST_CONFLICT'; end if;
      return jsonb_build_object('id',e.id,'receivedAt',e.received_at,'minutes',e.minutes);
    end if;
    body:=p_data->'body';
    if jsonb_typeof(body) is distinct from 'object' or body-array['name','company','workDate','startTime','endTime','breakMinutes','text','itemId']<>'{}'::jsonb
      or jsonb_typeof(body->'name') is distinct from 'string' or jsonb_typeof(body->'company') is distinct from 'string' or jsonb_typeof(body->'text') is distinct from 'string'
      or length(btrim(body->>'name')) not between 1 and 160 or length(btrim(body->>'company')) not between 1 and 160 or length(btrim(body->>'text')) not between 1 and 6000
      or coalesce(body->>'workDate','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or coalesce(body->>'startTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(body->>'endTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or jsonb_typeof(body->'breakMinutes') is distinct from 'number' or (body->>'breakMinutes')::numeric<>trunc((body->>'breakMinutes')::numeric) or (body->>'breakMinutes')::integer<0 then raise exception 'PROJECT_DIARY_INVALID'; end if;
    body_date:=(body->>'workDate')::date;
    minutes:=extract(epoch from ((body->>'endTime')::time-(body->>'startTime')::time))/60-(body->>'breakMinutes')::integer;
    if body_date>(stamp at time zone 'Europe/Stockholm')::date or minutes<=0 or minutes>=1440 then raise exception 'PROJECT_DIARY_INVALID'; end if;
    if body->'itemId' is distinct from 'null'::jsonb then
      select i.title into item_title from public.action_case_items i where i.id=(body->>'itemId')::uuid and i.org_id=p_org_id and i.action_case_id=p_case_id;
      if item_title is null then raise exception 'PROJECT_DIARY_ITEM'; end if;
    end if;
    if jsonb_typeof(p_data->'photoIds') is distinct from 'array' or jsonb_array_length(p_data->'photoIds')>8 then raise exception 'PROJECT_DIARY_PHOTO'; end if;
    select coalesce(array_agg(value::uuid),'{}'::uuid[]) into file_ids from jsonb_array_elements_text(p_data->'photoIds');
    if cardinality(file_ids)<>(select count(distinct x) from unnest(file_ids) x) then raise exception 'PROJECT_DIARY_PHOTO'; end if;
    perform 1 from public.action_case_diary_uploads where id=any(file_ids) order by id for update;
    if cardinality(file_ids)<>(select count(*) from public.action_case_diary_uploads where id=any(file_ids) and org_id=p_org_id and action_case_id=p_case_id and owner_key=owner and state='ready' and entry_id is null and expires_at>stamp and sha256 ~ '^[a-f0-9]{64}$') then raise exception 'PROJECT_DIARY_PHOTO'; end if;
    insert into public.action_case_diary_entries(id,org_id,action_case_id,owner_key,request_hash,body,source_item_id,item_title,actor_profile_id,actor_name,author_email,actor_method,email_verified_at,minutes,work_date)
      values(rid,p_org_id,p_case_id,owner,p_data->>'requestHash',body,(body->>'itemId')::uuid,coalesce(item_title,''),p_actor_id,actor_name,author_email,case when s.id is null then 'internal_login' else 'email_code' end,s.verified_at,minutes,body_date) returning * into e;
    insert into public.action_case_diary_photos(id,entry_id,name,content_type,size_bytes,sha256,position)
      select photo.id,rid,photo.name,photo.content_type,photo.size_bytes,photo.sha256,array_position(file_ids,photo.id) from public.action_case_diary_uploads photo where photo.id=any(file_ids);
    update public.action_case_diary_uploads set state='attached',entry_id=rid where id=any(file_ids);
    if s.id is not null then update public.action_case_diary_sessions set name=body->>'name',company=body->>'company' where id=s.id; end if;
    return jsonb_build_object('id',e.id,'receivedAt',e.received_at,'minutes',e.minutes);
  elsif p_operation='correction' then
    if p_actor_id is null or manager is distinct from p_actor_id then raise exception 'PROJECT_DIARY_MANAGER'; end if;
    rid:=(p_data->>'requestId')::uuid;
    perform pg_advisory_xact_lock(hashtextextended('diary-correction:'||rid,0));
    select * into corr from public.action_case_diary_corrections where id=rid;
    if corr.id is not null then
      if corr.actor_profile_id<>p_actor_id or corr.entry_id<>(p_data->>'entryId')::uuid or corr.text<>p_data->>'text' then raise exception 'PROJECT_DIARY_REQUEST_CONFLICT'; end if;
      return jsonb_build_object('id',rid);
    end if;
    if not exists(select 1 from public.action_case_diary_entries where id=(p_data->>'entryId')::uuid and org_id=p_org_id and action_case_id=p_case_id) then raise exception 'PROJECT_DIARY_NOT_FOUND'; end if;
    insert into public.action_case_diary_corrections(id,entry_id,actor_profile_id,actor_name,text) values(rid,(p_data->>'entryId')::uuid,p_actor_id,actor_name,p_data->>'text');
    return jsonb_build_object('id',rid);
  elsif p_operation='cleanup' then
    if p_actor_id is null or manager is distinct from p_actor_id then raise exception 'PROJECT_DIARY_MANAGER'; end if;
    -- Grace exceeds the photo route's hard runtime limit, so an in-flight archive cannot arrive after cleanup.
    with expired as (select id from public.action_case_diary_uploads where org_id=p_org_id and action_case_id=p_case_id and entry_id is null and expires_at<stamp-interval '15 minutes' and state<>'attached' and cleaned_at is null order by created_at limit 10 for update skip locked),
      changed as (update public.action_case_diary_uploads photo set state='discarded' from expired x where photo.id=x.id returning photo.id)
      select coalesce(jsonb_agg(id),'[]') into result from changed;
    return jsonb_build_object('ids',result);
  elsif p_operation='cleanup_done' then
    if p_actor_id is null or manager is distinct from p_actor_id then raise exception 'PROJECT_DIARY_MANAGER'; end if;
    if jsonb_typeof(p_data->'ids') is distinct from 'array' or jsonb_array_length(p_data->'ids')>10 then raise exception 'PROJECT_DIARY_INVALID'; end if;
    update public.action_case_diary_uploads photo set cleaned_at=stamp where photo.org_id=p_org_id and photo.action_case_id=p_case_id and photo.state='discarded' and photo.entry_id is null and photo.expires_at<stamp and photo.id in (select value::uuid from jsonb_array_elements_text(p_data->'ids'));
    return jsonb_build_object('done',true);
  end if;
  raise exception 'PROJECT_DIARY_INVALID';
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'PROJECT_DIARY_INVALID';
end $$;
revoke all on function public.project_diary_public_context(uuid,uuid,text),public.project_diary_command(uuid,uuid,uuid,uuid,uuid,text,text,jsonb),public.protect_project_diary_history() from public,anon,authenticated;
grant execute on function public.project_diary_public_context(uuid,uuid,text),public.project_diary_command(uuid,uuid,uuid,uuid,uuid,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
