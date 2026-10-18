-- Private PDF references and immutable customer copies. Requires migration 01.
-- No project files, generic file grants, contracts, offers or payments are changed.
begin;
alter table public.action_case_customer_planning
  add column if not exists option_files jsonb not null default '[]',
  add column if not exists shared_option_files jsonb not null default '[]';

create or replace function public.assert_customer_choice_file_refs(p_refs jsonb,p_items jsonb)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare r jsonb; seen text[] := '{}'; pair text;
begin
  if jsonb_typeof(p_refs) is distinct from 'array' or jsonb_array_length(p_refs)>30 then raise exception 'CUSTOMER_CHOICE_FILES'; end if;
  for r in select value from jsonb_array_elements(p_refs) loop
    if jsonb_typeof(r) is distinct from 'object' or exists(select 1 from jsonb_object_keys(r) k where k not in ('optionId','fileId'))
      or coalesce(r->>'optionId','') !~ '^[0-9a-f-]{36}$' or coalesce(r->>'fileId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not exists(select 1 from jsonb_array_elements(p_items) i where i->>'id'=r->>'optionId') then raise exception 'CUSTOMER_CHOICE_FILES'; end if;
    pair := (r->>'optionId')||'/'||(r->>'fileId');
    if pair=any(seen) then raise exception 'CUSTOMER_CHOICE_FILES'; end if;
    seen := array_append(seen,pair);
  end loop;
end $$;

-- Recipient reset and legacy append-only imports must preserve the same privacy boundary.
create or replace function public.guard_customer_choice_files() returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin
  if new.participant_id is null or new.shared_items='[]'::jsonb then new.shared_option_files := '[]'; end if;
  select coalesce(jsonb_agg(r order by r->>'optionId',r->>'fileId'),'[]') into new.option_files
    from jsonb_array_elements(new.option_files) r where exists(select 1 from jsonb_array_elements(new.items) i where i->>'id'=r->>'optionId');
  perform public.assert_customer_choice_file_refs(new.option_files,new.items);
  return new;
end $$;
drop trigger if exists customer_choice_files_guard on public.action_case_customer_planning;
create trigger customer_choice_files_guard before insert or update on public.action_case_customer_planning
  for each row execute function public.guard_customer_choice_files();

create or replace function public.write_customer_planning(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_operation text,p_data jsonb)
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
declare current_row public.action_case_customer_planning%rowtype; recipient uuid; cats jsonb; versions jsonb := '{}'; c jsonb;
  old_options jsonb; new_options jsonb; version_id text; refs jsonb; manifests jsonb; r jsonb; source_row record; total_bytes bigint := 0;
  old_files jsonb; new_files jsonb;
begin
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select * into current_row from public.action_case_customer_planning where action_case_id=p_case_id and org_id=p_org_id for update;
  if coalesce(current_row.revision,0) is distinct from (p_data->>'revision')::integer then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  if p_operation is null or p_operation not in ('save','share','unshare') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  cats := case when p_data ? 'categories' then p_data->'categories' else current_row.categories end;
  refs := coalesce(current_row.option_files,'[]');
  if p_operation<>'unshare' then
    if cats is not null then
      if not (p_data ? 'categories') and p_data->'items' is distinct from current_row.items then raise exception 'CUSTOMER_CHOICE_SCHEMA'; end if;
      perform public.assert_customer_choice_categories(cats,p_data->'items',p_operation='share');
    end if;
    if p_data ? 'optionFiles' then refs := p_data->'optionFiles';
    else select coalesce(jsonb_agg(f),'[]') into refs from jsonb_array_elements(refs) f where exists(select 1 from jsonb_array_elements(p_data->'items') i where i->>'id'=f->>'optionId'); end if;
    perform public.assert_customer_choice_file_refs(refs,p_data->'items');
    if refs<>'[]' and cats is null then raise exception 'CUSTOMER_CHOICE_SCHEMA'; end if;
    select coalesce(jsonb_agg(f order by f->>'optionId',f->>'fileId'),'[]') into refs from jsonb_array_elements(refs) f;
    for r in select value from jsonb_array_elements(refs) loop
      select * into source_row from public.action_case_attachments a where a.id=(r->>'fileId')::uuid and a.org_id=p_org_id and a.action_case_id=p_case_id;
      if not found or source_row.content_type<>'application/pdf' or source_row.storage_bucket<>'action-case-files'
        or source_row.file_size_bytes<100 or source_row.file_size_bytes>20000000
        or length(source_row.file_name)>250 or btrim(source_row.file_name)=''
        or source_row.file_path not like p_org_id::text||'/'||p_case_id::text||'/%' or position('..' in source_row.file_path)>0
        or exists(select 1 from public.action_case_work_quotes q where q.org_id=p_org_id and q.document_id=source_row.id)
        or exists(select 1 from public.action_case_quote_requests q where q.org_id=p_org_id and q.response_document_id=source_row.id)
        then raise exception 'CUSTOMER_CHOICE_FILES'; end if;
      total_bytes := total_bytes+source_row.file_size_bytes;
    end loop;
    if total_bytes>50000000 then raise exception 'CUSTOMER_CHOICE_FILES'; end if;
  end if;
  if p_operation='save' then
    if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items')>200 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    insert into public.action_case_customer_planning(action_case_id,org_id,revision,items,categories,option_files,updated_by)
      values(p_case_id,p_org_id,1,p_data->'items',cats,refs,p_user_id)
      on conflict(action_case_id) do update set items=excluded.items,categories=excluded.categories,option_files=excluded.option_files,
        revision=action_case_customer_planning.revision+1,updated_by=p_user_id,updated_at=clock_timestamp();
  else
    if current_row.action_case_id is null then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    manifests := '[]';
    if p_operation='share' then
      if cats is not null and current_row.categories is null then raise exception 'CUSTOMER_CHOICE_SCHEMA'; end if;
      if p_data->>'confirmed' is distinct from 'true' or p_data->'items' is distinct from current_row.items
        or (current_row.categories is not null and cats is distinct from current_row.categories) or refs is distinct from current_row.option_files then raise exception 'CUSTOMER_OFFER_CONFIRM'; end if;
      if current_row.categories is not null and not (p_data ? 'categories') then raise exception 'CUSTOMER_CHOICE_SCHEMA'; end if;
      if refs<>'[]' and not (p_data ? 'optionFiles') then raise exception 'CUSTOMER_CHOICE_FILE_SCHEMA'; end if;
      manifests := coalesce(p_data->'sharedFiles','[]');
      if jsonb_typeof(manifests) is distinct from 'array' or jsonb_array_length(manifests)<>jsonb_array_length(refs) then raise exception 'CUSTOMER_CHOICE_FILES'; end if;
      for r in select value from jsonb_array_elements(manifests) loop
        if jsonb_typeof(r) is distinct from 'object' or exists(select 1 from jsonb_object_keys(r) k where k not in ('id','optionId','sourceId','fileName','fileSizeBytes','sha256','path'))
          or coalesce(r->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or coalesce(r->>'sha256','') !~ '^[0-9a-f]{64}$' or r->>'path' is distinct from p_org_id::text||'/'||p_case_id::text||'/choices/'||(r->>'id')||'.pdf'
          or not exists(select 1 from jsonb_array_elements(refs) ref where ref->>'optionId'=r->>'optionId' and ref->>'fileId'=r->>'sourceId')
          or not exists(select 1 from public.action_case_attachments a where a.id::text=r->>'sourceId' and a.org_id=p_org_id and a.action_case_id=p_case_id
            and to_jsonb(a.file_name)=r->'fileName' and to_jsonb(a.file_size_bytes)=r->'fileSizeBytes') then raise exception 'CUSTOMER_CHOICE_FILES'; end if;
      end loop;
      if (select count(distinct (f->>'optionId',f->>'sourceId')) from jsonb_array_elements(manifests) f)<>jsonb_array_length(refs)
        or (select count(distinct f->>'id') from jsonb_array_elements(manifests) f)<>jsonb_array_length(refs) then raise exception 'CUSTOMER_CHOICE_FILES'; end if;
      select id into recipient from public.action_case_participants where action_case_id=p_case_id and org_id=p_org_id and role='customer';
      if recipient is null then raise exception 'CUSTOMER_OFFER_RECIPIENT'; end if;
      if cats is not null then for c in select value from jsonb_array_elements(cats) loop
        version_id := null;
        select coalesce(jsonb_agg(i order by n),'[]') into old_options from jsonb_array_elements_text(c->'optionIds') with ordinality selected(option_id,n)
          join jsonb_array_elements(current_row.shared_items) i on i->>'id'=option_id;
        select coalesce(jsonb_agg(i order by n),'[]') into new_options from jsonb_array_elements_text(c->'optionIds') with ordinality selected(option_id,n)
          join jsonb_array_elements(current_row.items) i on i->>'id'=option_id;
        select coalesce(jsonb_agg(f-'id'-'path' order by f->>'optionId',f->>'sourceId'),'[]') into old_files
          from jsonb_array_elements(current_row.shared_option_files) f where c->'optionIds' ? (f->>'optionId');
        select coalesce(jsonb_agg(f-'id'-'path' order by f->>'optionId',f->>'sourceId'),'[]') into new_files
          from jsonb_array_elements(manifests) f where c->'optionIds' ? (f->>'optionId');
        if current_row.participant_id=recipient and old_options=new_options and old_files=new_files and exists(select 1 from jsonb_array_elements(coalesce(current_row.shared_categories,'[]')) old_c where old_c=c) then
          version_id := current_row.shared_category_versions->>(c->>'id');
        end if;
        versions := versions || jsonb_build_object(c->>'id',coalesce(version_id,gen_random_uuid()::text));
      end loop; end if;
    end if;
    update public.action_case_customer_planning set
      categories=case when p_operation='share' then cats else categories end,
      shared_items=case when p_operation='share' then items else '[]'::jsonb end,
      shared_categories=case when p_operation='share' then cats else null end,
      shared_option_files=manifests,shared_category_versions=versions,participant_id=recipient,
      revision=revision+1,updated_by=p_user_id,updated_at=clock_timestamp()
      where action_case_id=p_case_id and org_id=p_org_id;
  end if;
  insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,'customer_planning_'||p_operation,'Planerade tillval uppdaterade (inte beställning)',p_user_id);
end $$;

create or replace function public.customer_choices_snapshot(p_org_id uuid,p_case_id uuid,p_participant_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare p public.action_case_customer_planning%rowtype; chosen jsonb; files jsonb;
begin
  select * into p from public.action_case_customer_planning where org_id=p_org_id and action_case_id=p_case_id and participant_id=p_participant_id;
  if p.shared_categories is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('categoryId',c.category_id,'categoryVersion',c.category_version,'optionId',c.option_id,'revision',c.revision,'selectedAt',c.selected_at) order by c.category_id),'[]') into chosen
    from public.action_case_customer_choices c where c.org_id=p_org_id and c.action_case_id=p_case_id and c.participant_id=p_participant_id
      and exists(select 1 from jsonb_array_elements(p.shared_categories) cat where cat->>'id'=c.category_id::text);
  select coalesce(jsonb_agg(jsonb_build_object('id',f->>'id','optionId',f->>'optionId','fileName',f->>'fileName','fileSizeBytes',f->'fileSizeBytes')),'[]') into files
    from jsonb_array_elements(p.shared_option_files) f;
  return jsonb_build_object('revision',p.shared_revision,'categories',p.shared_categories,'items',p.shared_items,'versions',p.shared_category_versions,'choices',chosen,'files',files);
end $$;

create or replace function public.read_customer_choice_file(p_token_hash text,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare l public.action_case_access_links%rowtype; f jsonb;
begin
  -- Revalidate the customer link, current recipient and sharing on every request.
  perform public.read_customer_choices(p_token_hash);
  select * into l from public.action_case_access_links where token_hash=p_token_hash and revoked_at is null and expires_at>clock_timestamp();
  select file into f from public.action_case_customer_planning p cross join lateral jsonb_array_elements(p.shared_option_files) file
    where p.org_id=l.org_id and p.action_case_id=l.action_case_id and p.participant_id=l.participant_id and p.shared_categories is not null
      and file->>'id'=p_file_id::text and exists(select 1 from jsonb_array_elements(p.shared_items) i where i->>'id'=file->>'optionId');
  if f is null then raise exception 'CUSTOMER_CHOICE_NOT_SHARED'; end if;
  return jsonb_build_object('orgId',l.org_id,'caseId',l.action_case_id,'file',f);
end $$;

revoke all on function public.assert_customer_choice_file_refs(jsonb,jsonb), public.guard_customer_choice_files(), public.read_customer_choice_file(text,uuid),
  public.write_customer_planning(uuid,uuid,uuid,text,jsonb),public.customer_choices_snapshot(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_customer_choice_file_refs(jsonb,jsonb), public.read_customer_choice_file(text,uuid),
  public.write_customer_planning(uuid,uuid,uuid,text,jsonb),public.customer_choices_snapshot(uuid,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
