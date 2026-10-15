-- TU: explicit early start, using the same lifecycle as OB. Apply before deployment.
-- No existing investigations, approvals, locks or report texts are rewritten.
begin;

create table if not exists public.tu_assignment_workflows (
  inspection_id uuid primary key references public.inspections(id) on delete restrict,
  org_id uuid not null references public.organizations(id),
  initial_assignment_id uuid not null references public.assignments(id) on delete restrict,
  current_assignment_id uuid not null unique references public.assignments(id) on delete restrict,
  started_at timestamptz not null default now(),
  started_by uuid not null references public.profiles(id),
  start_reason text not null check (length(btrim(start_reason)) between 5 and 1000),
  initial_snapshot jsonb not null,
  reviewed_snapshot jsonb,
  reviewed_acceptance_id uuid references public.assignment_acceptances(id) on delete restrict,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id)
);
create table if not exists public.tu_assignment_workflow_events (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.tu_assignment_workflows(inspection_id) on delete restrict,
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  event_type text not null check (event_type in ('started','reissued','reviewed')),
  performed_by uuid not null references public.profiles(id),
  performed_at timestamptz not null default now(),
  snapshot jsonb not null
);
alter table public.tu_assignment_workflows enable row level security;
alter table public.tu_assignment_workflow_events enable row level security;
revoke all on public.tu_assignment_workflows, public.tu_assignment_workflow_events from public, anon, authenticated;
grant all on public.tu_assignment_workflows, public.tu_assignment_workflow_events to service_role;

create or replace function public.tu_assert_assignment_actor(p_assignment_id uuid, p_org_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not exists (select 1 from public.assignments a join public.org_members m on m.org_id = a.org_id
    where a.id = p_assignment_id and a.org_id = p_org_id and a.assignment_type = 'TU'
      and m.profile_id = p_actor and m.is_active
      and (m.role = 'admin' or a.responsible_profile_id = p_actor)) then
    raise exception 'TU_ASSIGNMENT_FORBIDDEN';
  end if;
end;
$$;

create or replace function public.tu_assignment_snapshot(p_assignment_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  -- Reuse OB's established confirmation snapshot, including addons and terms.
  select public.ob_assignment_snapshot(p_assignment_id);
$$;

create or replace function public.tu_assignment_inspection_snapshot(p_inspection_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  select jsonb_build_object(
    'customer_name', i.customer_name, 'customer_email', i.customer_email, 'customer_phone', i.customer_phone,
    'customer_address', i.customer_address, 'customer_postal_code', i.customer_postal_code, 'customer_city', i.customer_city,
    'property_address', p.address, 'property_postal_code', p.postal_code, 'property_city', p.city,
    'property_municipality', p.municipality, 'property_owner_name', p.owner_name, 'cadastral_id', p.cadastral_id,
    'brf_name', d.brf_name, 'apartment_number', d.apartment_number, 'apartment_holder_name', d.apartment_holder_name,
    'preferred_date', i.date, 'preferred_time', i.inspection_time, 'scope_description', d.scope_description,
    'reportVersion', md5(coalesce(d.report_draft::text, '')))
  from public.technical_investigation_details d join public.inspections i on i.id = d.inspection_id
    join public.properties p on p.id = i.property_id where i.id = p_inspection_id;
$$;

create or replace function public.tu_assignment_workflow_state(p_inspection_id uuid, p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare w public.tu_assignment_workflows; a public.assignments; acceptance_id uuid;
  snapshot jsonb; inspection_snapshot jsonb; paused boolean; reviewed boolean; reason text;
begin
  select * into w from public.tu_assignment_workflows where inspection_id = p_inspection_id;
  if not found then return null; end if;
  if w.org_id <> p_org_id then raise exception 'TU_ASSIGNMENT_FORBIDDEN'; end if;
  select * into a from public.assignments where id = w.current_assignment_id and org_id = p_org_id;
  select id into acceptance_id from public.assignment_acceptances
    where assignment_id = a.id and org_id = p_org_id and accepted_at = a.accepted_at
    order by created_at desc, id limit 1;
  snapshot := public.tu_assignment_snapshot(a.id);
  inspection_snapshot := public.tu_assignment_inspection_snapshot(p_inspection_id);
  paused := a.id is null or a.inspection_id is distinct from p_inspection_id or a.archived_at is not null or a.status in ('draft','cancelled','expired')
    or (a.status = 'sent' and not exists (select 1 from public.assignment_links l where l.assignment_id = a.id
      and l.org_id = p_org_id and l.used_at is null and l.revoked_at is null and l.expires_at > now()));
  reviewed := acceptance_id is not null and w.reviewed_acceptance_id = acceptance_id and w.reviewed_snapshot = snapshot;
  reason := case when paused then 'Arbetet är pausat. Uppdragsbekräftelsen behöver vara aktuell och skickad.'
    when acceptance_id is null then 'Inväntar kundens godkännande.'
    when a.booked_at is null or a.status not in ('booked','completed') then 'Kunden har godkänt. Acceptera uppdraget innan slutleverans.'
    when not coalesce(reviewed,false) then 'Stäm av kundens godkända uppgifter mot utredningen före slutleverans.' else null end;
  return jsonb_build_object('inspectionId',w.inspection_id,'assignmentId',a.id,'status',a.status,
    'startedAt',w.started_at,'startReason',w.start_reason,'acceptedAt',case when acceptance_id is not null then a.accepted_at end,
    'bookedAt',a.booked_at,'initialSnapshot',w.initial_snapshot,'currentSnapshot',snapshot,'inspectionSnapshot',inspection_snapshot,
    'reviewToken',md5(snapshot::text || coalesce(acceptance_id::text,'') || inspection_snapshot::text),
    'needsReview',not coalesce(reviewed,false),'paused',paused,'canDeliver',reason is null,'reason',reason,
    'inspectionLocked',exists(select 1 from public.inspections i join public.technical_investigation_details d on d.inspection_id=i.id
      where i.id=p_inspection_id and (i.locked_at is not null or d.report_locked_at is not null or lower(i.status) in ('completed','klar','done'))));
end;
$$;

-- Normal and early TU starts share one row lock and one transaction. A retry opens the same investigation.
create or replace function public.tu_start_assignment_investigation(
  p_assignment_id uuid, p_org_id uuid, p_actor uuid, p_expected_updated_at timestamptz,
  p_template jsonb, p_object_type text, p_report_draft jsonb, p_early_reason text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare a public.assignments; v_property_id uuid; v_inspection_id uuid; early boolean;
  number_prefix text; next_number bigint; number text; snapshot jsonb;
begin
  select * into a from public.assignments where id=p_assignment_id and org_id=p_org_id for update;
  if not found then raise exception 'TU_ASSIGNMENT_NOT_FOUND'; end if;
  perform public.tu_assert_assignment_actor(a.id,p_org_id,p_actor);
  if a.inspection_id is not null then return jsonb_build_object('inspectionId',a.inspection_id,'propertyId',a.property_id); end if;
  if p_expected_updated_at is null or a.updated_at <> p_expected_updated_at then raise exception 'ASSIGNMENT_VERSION_CONFLICT'; end if;
  if a.archived_at is not null or a.status not in ('sent','ordered','booked') then raise exception 'TU_START_NOT_ALLOWED'; end if;
  early := a.status = 'sent';
  if early then
    if a.accepted_at is not null or a.last_sent_at is null or exists(select 1 from public.assignment_acceptances where assignment_id=a.id)
      or length(btrim(coalesce(p_early_reason,''))) not between 5 and 1000 then raise exception 'TU_EARLY_REASON_REQUIRED'; end if;
    if not exists(select 1 from public.assignment_links l where l.assignment_id=a.id and l.org_id=p_org_id
      and l.used_at is null and l.revoked_at is null and l.expires_at>now()) then raise exception 'TU_APPROVAL_LINK_REQUIRED'; end if;
  elsif not exists(select 1 from public.assignment_acceptances where assignment_id=a.id and org_id=p_org_id and accepted_at=a.accepted_at) then
    raise exception 'TU_ASSIGNMENT_NOT_ACCEPTED';
  end if;
  if nullif(p_template->>'key','') is null or jsonb_typeof(p_report_draft->'sections') is distinct from 'array'
    or p_object_type is null or p_object_type not in ('villa','apartment') then raise exception 'TU_REPORT_TEMPLATE_REQUIRED'; end if;
  if a.preferred_date is not null then
    perform pg_advisory_xact_lock(hashtextextended('tu-assignment-number:'||a.preferred_date::text,0));
    number_prefix := to_char(a.preferred_date,'YYYY-MMDD');
    select coalesce(max(substring(i.assignment_number from '[0-9]+$')::bigint),0)+1 into next_number from public.inspections i
      where i.inspection_family='TU' and i.date=a.preferred_date and i.assignment_number ~ ('^'||number_prefix||'-[0-9]+$');
    number := number_prefix||'-'||lpad(next_number::text,greatest(2,length(next_number::text)),'0');
  end if;
  insert into public.properties(owner,name,status,address,postal_code,city,municipality,cadastral_id,client_name,owner_name)
    values(coalesce(a.responsible_profile_id,p_actor),coalesce(nullif(btrim(coalesce(a.property_address,a.preliminary_address)),''),'Teknisk utredning'),
      'Utkast',coalesce(a.property_address,a.preliminary_address),a.property_postal_code,a.property_city,
      coalesce(a.property_municipality,a.property_city),case when p_object_type='villa' then a.cadastral_id end,a.customer_name,a.property_owner_name)
    returning id into v_property_id;
  insert into public.inspections(property_id,type,inspection_family,inspection_variant,status,date,inspection_time,assignment_number,
    scope,client_name,client_contact,customer_name,customer_email,customer_phone,customer_address,customer_postal_code,customer_city)
    values(v_property_id,'TU','TU','TU','draft',a.preferred_date,a.preferred_time,number,a.scope_description,a.customer_name,
      nullif(concat_ws(' | ',a.customer_phone,a.customer_email),''),a.customer_name,a.customer_email,a.customer_phone,a.customer_address,
      a.customer_postal_code,a.customer_city) returning id into v_inspection_id;
  insert into public.technical_investigation_details(inspection_id,org_id,inspector_profile_id,assignment_id,property_id,title,project_type,
    report_template_key,report_template_title,report_template_version,report_template_applied_at,report_authoring_mode,report_workflow_profile,
    property_object_type,scope_description,brf_name,apartment_number,apartment_holder_name,invoice_email,background,
    report_draft,report_draft_updated_at,created_by,updated_by)
    values(v_inspection_id,p_org_id,coalesce(a.responsible_profile_id,p_actor),a.id,v_property_id,p_template->>'documentTitle',p_template->>'projectType',
      p_template->>'key',p_template->>'title',(p_template->>'version')::integer,now(),p_template->>'authoringMode',p_template->>'workflowProfile',
      p_object_type,a.scope_description,case when p_object_type='apartment' then a.brf_name end,
      case when p_object_type='apartment' then a.apartment_number end,case when p_object_type='apartment' then a.apartment_holder_name end,
      a.invoice_email,a.scope_description,p_report_draft,now(),p_actor,p_actor);
  update public.assignments set property_id=v_property_id,
    inspection_id=v_inspection_id,converted_at=now(),
    status=case when early then a.status else 'completed' end,updated_by=p_actor where id=a.id;
  if early then
    snapshot := public.tu_assignment_snapshot(a.id);
    insert into public.tu_assignment_workflows(inspection_id,org_id,initial_assignment_id,current_assignment_id,started_by,start_reason,initial_snapshot)
      values(v_inspection_id,p_org_id,a.id,a.id,p_actor,btrim(p_early_reason),snapshot);
    insert into public.tu_assignment_workflow_events(inspection_id,assignment_id,event_type,performed_by,snapshot)
      values(v_inspection_id,a.id,'started',p_actor,snapshot);
  end if;
  return jsonb_build_object('inspectionId',v_inspection_id,'propertyId',v_property_id);
end;
$$;

create or replace function public.tu_review_assignment_workflow(p_inspection_id uuid,p_org_id uuid,p_actor uuid,p_review_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare w public.tu_assignment_workflows; a public.assignments; state jsonb; acceptance_id uuid;
begin
  select * into w from public.tu_assignment_workflows where inspection_id=p_inspection_id and org_id=p_org_id;
  if not found then raise exception 'TU_ASSIGNMENT_NOT_FOUND'; end if;
  select * into a from public.assignments where id=w.current_assignment_id for update;
  perform public.tu_assert_assignment_actor(a.id,p_org_id,p_actor);
  select * into w from public.tu_assignment_workflows where inspection_id=p_inspection_id for update;
  if w.current_assignment_id <> a.id then raise exception 'TU_WORKFLOW_CHANGED'; end if;
  -- Hold the inspection/detail/object while checking the comparison token; preserve all local edits.
  perform 1 from public.inspections where id=p_inspection_id for update;
  perform 1 from public.technical_investigation_details where inspection_id=p_inspection_id for update;
  perform 1 from public.properties where id=a.property_id for update;
  state := public.tu_assignment_workflow_state(p_inspection_id,p_org_id);
  if (state->>'inspectionLocked')::boolean then raise exception 'TU_REPORT_LOCKED'; end if;
  if (state->>'paused')::boolean or state->>'acceptedAt' is null or a.booked_at is null or a.status not in ('booked','completed') then
    raise exception 'TU_APPROVAL_REQUIRED'; end if;
  if p_review_token is null or state->>'reviewToken' <> p_review_token then raise exception 'TU_WORKFLOW_CHANGED'; end if;
  select id into acceptance_id from public.assignment_acceptances where assignment_id=a.id and org_id=p_org_id
    and accepted_at=a.accepted_at order by created_at desc,id limit 1;
  update public.tu_assignment_workflows set reviewed_snapshot=state->'currentSnapshot',reviewed_acceptance_id=acceptance_id,
    reviewed_at=now(),reviewed_by=p_actor where inspection_id=p_inspection_id;
  insert into public.tu_assignment_workflow_events(inspection_id,assignment_id,event_type,performed_by,snapshot)
    values(p_inspection_id,a.id,'reviewed',p_actor,jsonb_build_object('confirmation',state->'currentSnapshot','inspection',state->'inspectionSnapshot'));
  return public.tu_assignment_workflow_state(p_inspection_id,p_org_id);
end;
$$;

create or replace function public.tu_reissue_started_assignment(p_assignment_id uuid,p_org_id uuid,p_actor uuid,p_expected_updated_at timestamptz)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare a public.assignments; draft public.assignments; w public.tu_assignment_workflows;
begin
  select * into a from public.assignments where id=p_assignment_id and org_id=p_org_id for update;
  perform public.tu_assert_assignment_actor(a.id,p_org_id,p_actor);
  select * into w from public.tu_assignment_workflows where current_assignment_id=a.id for update;
  if not found or a.status not in ('sent','ordered','booked','expired') or a.archived_at is not null then raise exception 'TU_START_NOT_ALLOWED'; end if;
  if p_expected_updated_at is null or a.updated_at <> p_expected_updated_at then raise exception 'ASSIGNMENT_VERSION_CONFLICT'; end if;
  if exists(select 1 from public.inspections i join public.technical_investigation_details d on d.inspection_id=i.id
    where i.id=w.inspection_id and (i.locked_at is not null or d.report_locked_at is not null)) then raise exception 'TU_REPORT_LOCKED'; end if;
  draft:=a; draft.id:=gen_random_uuid(); draft.status:='draft'; draft.accepted_at:=null; draft.booked_at:=null;
  draft.accepted_via_ip:=null; draft.accepted_user_agent:=null; draft.terms_version:=null; draft.terms_document_hash:=null;
  draft.last_sent_at:=null; draft.created_at:=now(); draft.updated_at:=now(); draft.created_by:=p_actor; draft.updated_by:=p_actor;
  draft.assignment_details := coalesce(a.assignment_details, '{}'::jsonb) || jsonb_build_object('reissuedFromAssignmentId',a.id);
  update public.assignments set status='cancelled',inspection_id=null,updated_by=p_actor where id=a.id;
  insert into public.assignments select draft.*;
  insert into public.assignment_addon_orders(assignment_id,org_id,addon_service_id,addon_key,addon_name_snapshot,price_amount_snapshot,currency_snapshot)
    select draft.id,org_id,addon_service_id,addon_key,addon_name_snapshot,price_amount_snapshot,currency_snapshot
      from public.assignment_addon_orders where assignment_id=a.id;
  update public.tu_assignment_workflows set current_assignment_id=draft.id,reviewed_snapshot=null,reviewed_acceptance_id=null,
    reviewed_at=null,reviewed_by=null where inspection_id=w.inspection_id;
  update public.technical_investigation_details set assignment_id=draft.id where inspection_id=w.inspection_id;
  update public.assignment_links set revoked_at=now() where assignment_id=a.id and used_at is null and revoked_at is null;
  update public.inspection_report_links set revoked_at=now() where inspection_id=w.inspection_id and revoked_at is null;
  insert into public.tu_assignment_workflow_events(inspection_id,assignment_id,event_type,performed_by,snapshot)
    values(w.inspection_id,draft.id,'reissued',p_actor,public.tu_assignment_snapshot(draft.id));
  return draft.id;
end;
$$;

create or replace function public.tu_guard_assignment_workflow_write()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
declare row_data jsonb; old_data jsonb; v_id uuid; w public.tu_assignment_workflows; state jsonb;
begin
  row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  old_data:=case when tg_op='INSERT' then row_data else to_jsonb(old) end;
  v_id:=case when tg_table_name='inspections' then (row_data->>'id')::uuid else (row_data->>'inspection_id')::uuid end;
  if tg_op='UPDATE' and tg_table_name<>'inspections' and old_data->>'inspection_id' is distinct from row_data->>'inspection_id'
    and exists(select 1 from public.tu_assignment_workflows where inspection_id=(old_data->>'inspection_id')::uuid) then raise exception 'TU_WORKFLOW_LINK_IMMUTABLE'; end if;
  select * into w from public.tu_assignment_workflows where inspection_id=v_id;
  if not found then return coalesce(new,old); end if;
  if tg_op='DELETE' and tg_table_name in ('inspections','technical_investigation_details') then raise exception 'TU_WORKFLOW_LINK_IMMUTABLE'; end if;
  if tg_op='UPDATE' and tg_table_name='inspections' and (old_data->'property_id' is distinct from row_data->'property_id'
    or old_data->'type' is distinct from row_data->'type' or old_data->'inspection_family' is distinct from row_data->'inspection_family'
    or old_data->'inspection_variant' is distinct from row_data->'inspection_variant') then raise exception 'TU_WORKFLOW_LINK_IMMUTABLE'; end if;
  if tg_table_name='technical_investigation_details' and tg_op='UPDATE' then
    if old_data->'org_id' is distinct from row_data->'org_id' or old_data->'property_id' is distinct from row_data->'property_id'
      or old_data->'inspector_profile_id' is distinct from row_data->'inspector_profile_id' then raise exception 'TU_WORKFLOW_LINK_IMMUTABLE'; end if;
    if old_data->'assignment_id' is distinct from row_data->'assignment_id' then
      if (row_data->>'assignment_id')::uuid = w.current_assignment_id and coalesce(auth.role(),current_setting('role',true)) in ('service_role','none')
        and (old_data - array['assignment_id','updated_at']) = (row_data - array['assignment_id','updated_at']) then return new; end if;
      raise exception 'TU_WORKFLOW_LINK_IMMUTABLE';
    end if;
  end if;
  perform 1 from public.assignments where id=w.current_assignment_id for update;
  state:=public.tu_assignment_workflow_state(v_id,w.org_id);
  if tg_table_name='inspection_report_links' and tg_op='UPDATE' and row_data->>'revoked_at' is not null then return new; end if;
  if tg_table_name in ('inspection_report_links','tu_report_revisions') then
    if not (state->>'canDeliver')::boolean then raise exception 'TU_DELIVERY_BLOCKED'; end if;
  else
    if (state->>'paused')::boolean then raise exception 'TU_WORK_PAUSED'; end if;
    if ((tg_table_name='inspections' and (row_data->>'locked_at' is not null or lower(coalesce(row_data->>'status','')) in ('completed','klar','done')))
      or (tg_table_name='technical_investigation_details' and row_data->>'report_locked_at' is not null))
      and not (state->>'canDeliver')::boolean then raise exception 'TU_DELIVERY_BLOCKED'; end if;
  end if;
  return coalesce(new,old);
end;
$$;

do $$ declare t text; begin
  for t in select c.table_name from information_schema.columns c join information_schema.tables tbl
    on tbl.table_schema=c.table_schema and tbl.table_name=c.table_name and tbl.table_type='BASE TABLE'
    where c.table_schema='public' and c.column_name='inspection_id'
      and (c.table_name like 'tu\_%' escape '\' or c.table_name like 'technical\_investigation\_%' escape '\'
        or c.table_name='inspection_report_links') and c.table_name not in ('tu_assignment_workflows','tu_assignment_workflow_events')
    union all select 'inspections'
  loop
    execute format('drop trigger if exists trg_tu_assignment_workflow_write on public.%I',t);
    execute format('create trigger trg_tu_assignment_workflow_write before insert or update or delete on public.%I for each row execute function public.tu_guard_assignment_workflow_write()',t);
  end loop;
end $$;

create or replace function public.tu_guard_assignment_workflow_evidence()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
declare w public.tu_assignment_workflows; aid uuid; old_data jsonb; row_data jsonb;
begin
  old_data:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  row_data:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
  for w in select * from public.tu_assignment_workflows where current_assignment_id in (
    case when tg_table_name='assignments' then (old_data->>'id')::uuid else (old_data->>'assignment_id')::uuid end,
    case when tg_table_name='assignments' then (row_data->>'id')::uuid else (row_data->>'assignment_id')::uuid end)
  loop
    if coalesce(auth.role(),current_setting('role',true)) not in ('service_role','none') then raise exception 'TU_WORKFLOW_SERVER_WRITE_REQUIRED'; end if;
    if tg_table_name='assignments' and tg_op='UPDATE' and (row_data->'org_id' is distinct from old_data->'org_id'
      or row_data->'assignment_type' is distinct from old_data->'assignment_type' or row_data->'responsible_profile_id' is distinct from old_data->'responsible_profile_id'
      or row_data->'property_id' is distinct from old_data->'property_id'
      or (row_data->'inspection_id' is distinct from old_data->'inspection_id'
        and not (row_data->>'status'='cancelled' and row_data->>'inspection_id' is null))) then raise exception 'TU_WORKFLOW_LINK_IMMUTABLE'; end if;
    aid:=w.current_assignment_id;
    perform 1 from public.assignments where id=aid for update;
    if tg_table_name<>'assignments' or row_data->>'status' not in ('booked','completed') or row_data->>'archived_at' is not null
      or (row_data-array['updated_at','updated_by','status','notes_internal']) is distinct from (old_data-array['updated_at','updated_by','status','notes_internal']) then
      update public.inspection_report_links set revoked_at=now() where inspection_id=w.inspection_id and revoked_at is null;
    end if;
  end loop;
  return coalesce(new,old);
end;
$$;
do $$ declare t text; begin
  foreach t in array array['assignments','assignment_links','assignment_acceptances','assignment_addon_orders'] loop
    execute format('drop trigger if exists trg_tu_assignment_workflow_evidence on public.%I',t);
    execute format('create trigger trg_tu_assignment_workflow_evidence before update or delete%s on public.%I for each row execute function public.tu_guard_assignment_workflow_evidence()',
      case when t='assignments' then '' else ' or insert' end,t);
  end loop;
end $$;

-- OB's installed token wrapper already locks assignments before consuming a token.
-- Keep that wrapper and all existing lock guards; do not replace approval logic.
revoke all on function public.tu_assert_assignment_actor(uuid,uuid,uuid),public.tu_assignment_snapshot(uuid),
  public.tu_assignment_inspection_snapshot(uuid),public.tu_assignment_workflow_state(uuid,uuid),
  public.tu_start_assignment_investigation(uuid,uuid,uuid,timestamptz,jsonb,text,jsonb,text),
  public.tu_review_assignment_workflow(uuid,uuid,uuid,text),public.tu_reissue_started_assignment(uuid,uuid,uuid,timestamptz),
  public.tu_guard_assignment_workflow_write(),public.tu_guard_assignment_workflow_evidence() from public,anon,authenticated;
grant execute on function public.tu_assignment_workflow_state(uuid,uuid),
  public.tu_start_assignment_investigation(uuid,uuid,uuid,timestamptz,jsonb,text,jsonb,text),
  public.tu_review_assignment_workflow(uuid,uuid,uuid,text),public.tu_reissue_started_assignment(uuid,uuid,uuid,timestamptz) to service_role;
commit;
