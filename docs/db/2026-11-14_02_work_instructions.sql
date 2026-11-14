-- Internal execution instructions, independent of scope, costing and contract locks.
begin;
create table if not exists public.action_case_instruction_versions (
  item_id uuid not null references public.action_case_items(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  action_case_id uuid not null references public.action_cases(id) on delete cascade,
  revision integer not null check(revision>0), request_id uuid not null unique,
  request_payload jsonb not null, body jsonb not null,
  actor_profile_id uuid not null references public.profiles(id), actor_name text not null,
  created_at timestamptz not null default clock_timestamp(), primary key(item_id,revision)
);
create index if not exists instruction_versions_project on public.action_case_instruction_versions(org_id,action_case_id,item_id,revision desc);
create table if not exists public.action_case_instruction_files (
  item_id uuid not null, revision integer not null, position integer not null check(position between 1 and 50),
  attachment_id uuid references public.action_case_attachments(id),
  diary_photo_id uuid references public.action_case_diary_photos(id),
  file_name text not null, content_type text not null, file_size_bytes bigint not null,
  primary key(item_id,revision,position),
  foreign key(item_id,revision) references public.action_case_instruction_versions(item_id,revision) on delete cascade,
  check((attachment_id is null)<>(diary_photo_id is null))
);
create unique index if not exists instruction_file_project_unique on public.action_case_instruction_files(item_id,revision,attachment_id) where attachment_id is not null;
create unique index if not exists instruction_file_diary_unique on public.action_case_instruction_files(item_id,revision,diary_photo_id) where diary_photo_id is not null;
alter table public.action_case_instruction_versions enable row level security;
alter table public.action_case_instruction_files enable row level security;
revoke all on public.action_case_instruction_versions,public.action_case_instruction_files from public,anon,authenticated,service_role;
grant select on public.action_case_instruction_versions,public.action_case_instruction_files to service_role;

create or replace function public.guard_work_instruction_history() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- Deleting an unlocked moment may cascade; otherwise retain every saved version.
  if tg_op='DELETE' and not exists(select 1 from public.action_case_items where id=old.item_id) then return old; end if;
  raise exception 'WORK_INSTRUCTIONS_IMMUTABLE';
end $$;
drop trigger if exists instruction_history_immutable on public.action_case_instruction_versions;
create trigger instruction_history_immutable before update or delete on public.action_case_instruction_versions for each row execute function public.guard_work_instruction_history();
drop trigger if exists instruction_files_immutable on public.action_case_instruction_files;
create trigger instruction_files_immutable before update or delete on public.action_case_instruction_files for each row execute function public.guard_work_instruction_history();

create or replace function public.write_work_instructions(p_org_id uuid,p_case_id uuid,p_item_id uuid,p_actor_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.action_case_instruction_versions%rowtype; current_revision integer; next_revision integer;
  save_id uuid; request_body jsonb; file jsonb; source text; file_id uuid; position integer:=0;
  file_name text; mime text; bytes bigint; actor_name text; state text; created timestamptz;
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from public.org_members where org_id=p_org_id and profile_id=p_actor_id and is_active) then raise exception 'WORK_INSTRUCTIONS_FORBIDDEN'; end if;
  select p.status into state from public.action_cases p join public.action_case_items i on i.action_case_id=p.id and i.org_id=p.org_id
    where p.id=p_case_id and p.org_id=p_org_id and i.id=p_item_id for share of p,i;
  if not found then raise exception 'WORK_INSTRUCTIONS_NOT_FOUND'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or (p_data-array['requestId','revision','body'])<>'{}'::jsonb
    or coalesce(p_data->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_data->'revision') is distinct from 'number' or (p_data->>'revision')::numeric<>trunc((p_data->>'revision')::numeric)
    or (p_data->>'revision')::numeric not between 0 and 2147483646 then raise exception 'WORK_INSTRUCTIONS_INVALID'; end if;
  save_id:=(p_data->>'requestId')::uuid; request_body:=p_data->'body';
  if jsonb_typeof(request_body) is distinct from 'object' or (request_body-array['text','files'])<>'{}'::jsonb
    or jsonb_typeof(request_body->'text') is distinct from 'string' or length(request_body->>'text')>12000
    or jsonb_typeof(request_body->'files') is distinct from 'array' then raise exception 'WORK_INSTRUCTIONS_INVALID'; end if;
  if jsonb_array_length(request_body->'files')>50 then raise exception 'WORK_INSTRUCTIONS_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_item_id::text,34143));
  select * into prior from public.action_case_instruction_versions where request_id=save_id;
  if found then
    if prior.org_id<>p_org_id or prior.action_case_id<>p_case_id or prior.item_id<>p_item_id or prior.actor_profile_id<>p_actor_id or prior.request_payload<>p_data then raise exception 'WORK_INSTRUCTIONS_REQUEST_CONFLICT'; end if;
    return jsonb_build_object('requestId',prior.request_id,'revision',prior.revision,'createdAt',prior.created_at,'actorName',prior.actor_name);
  end if;
  if state in ('completed','cancelled') then raise exception 'WORK_INSTRUCTIONS_CLOSED'; end if;
  select coalesce(max(revision),0) into current_revision from public.action_case_instruction_versions where item_id=p_item_id;
  if current_revision<>(p_data->>'revision')::integer then raise exception 'WORK_INSTRUCTIONS_STALE'; end if;
  next_revision:=current_revision+1;
  select coalesce(nullif(full_name,''),email,'Medarbetare') into actor_name from public.profiles where id=p_actor_id;
  if actor_name is null then raise exception 'WORK_INSTRUCTIONS_FORBIDDEN'; end if;
  created:=clock_timestamp();
  insert into public.action_case_instruction_versions(item_id,org_id,action_case_id,revision,request_id,request_payload,body,actor_profile_id,actor_name,created_at)
    values(p_item_id,p_org_id,p_case_id,next_revision,save_id,p_data,request_body,p_actor_id,actor_name,created);
  for file in select value from jsonb_array_elements(request_body->'files') loop
    if jsonb_typeof(file) is distinct from 'object' or (file-array['source','id'])<>'{}'::jsonb or coalesce(file->>'source','') not in ('project','diary')
      or coalesce(file->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'WORK_INSTRUCTIONS_FILES'; end if;
    source:=file->>'source'; file_id:=(file->>'id')::uuid;
    if source='project' then
      select a.file_name,a.content_type,a.file_size_bytes into file_name,mime,bytes from public.action_case_attachments a
        where a.id=file_id and a.org_id=p_org_id and a.action_case_id=p_case_id and a.question_id is null for key share;
    else
      select p.name,p.content_type,p.size_bytes into file_name,mime,bytes from public.action_case_diary_photos p
        join public.action_case_diary_entries e on e.id=p.entry_id where p.id=file_id and e.org_id=p_org_id and e.action_case_id=p_case_id for key share of p;
    end if;
    if not found then raise exception 'WORK_INSTRUCTIONS_FILES'; end if;
    position:=position+1;
    insert into public.action_case_instruction_files(item_id,revision,position,attachment_id,diary_photo_id,file_name,content_type,file_size_bytes)
      values(p_item_id,next_revision,position,case when source='project' then file_id end,case when source='diary' then file_id end,file_name,mime,bytes);
  end loop;
  return jsonb_build_object('requestId',save_id,'revision',next_revision,'createdAt',created,'actorName',actor_name);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'WORK_INSTRUCTIONS_INVALID';
  when unique_violation then raise exception 'WORK_INSTRUCTIONS_FILES';
end $$;
revoke all on function public.guard_work_instruction_history(),public.write_work_instructions(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.write_work_instructions(uuid,uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
