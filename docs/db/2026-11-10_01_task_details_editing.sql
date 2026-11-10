-- Audited editing of open manual tasks. Existing task rows are not migrated.
begin;
create or replace function public.edit_operational_task_details(
  p_org_id uuid, p_task_id uuid, p_actor_profile_id uuid, p_expected_version integer,
  p_changes jsonb, p_confirm_recipient_change boolean default false
) returns public.operational_tasks
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  t public.operational_tasks%rowtype; result public.operational_tasks%rowtype;
  new_profile uuid; new_contact uuid; new_due timestamptz; new_followup timestamptz;
  new_title text; new_description text; new_context text; new_primary text; new_fallback text;
  recipient_changed boolean; schedule_changed boolean; before_value jsonb; after_value jsonb;
  actor_name_value text; old_name text; new_name text;
begin
  if auth.role() is distinct from 'service_role' or p_actor_profile_id is null then raise exception 'TASK_DETAILS_FORBIDDEN'; end if;
  -- Serialize changes within a hierarchy before checking parent/child dates.
  perform 1 from public.operational_tasks where id = (select root_task_id from public.operational_tasks where id=p_task_id and org_id=p_org_id) for update;
  select * into t from public.operational_tasks where id=p_task_id and org_id=p_org_id and archived_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if not exists(select 1 from public.org_members where org_id=p_org_id and profile_id=p_actor_profile_id and is_active
    and (t.issuer_profile_id=p_actor_profile_id or role='admin')) then raise exception 'TASK_DETAILS_FORBIDDEN'; end if;
  if not public.task_profile_has_module_access(p_org_id,p_actor_profile_id) then raise exception 'TASK_DETAILS_FORBIDDEN'; end if;
  if t.created_source <> 'manual' then raise exception 'TASK_DETAILS_MANAGED'; end if;
  if t.status in ('approved','cancelled') then raise exception 'TASK_TERMINAL'; end if;
  if p_expected_version is null or p_expected_version < 1 then raise exception 'TASK_VERSION_REQUIRED'; end if;
  if t.version <> p_expected_version then raise exception 'TASK_VERSION_CONFLICT'; end if;
  if jsonb_typeof(p_changes) is distinct from 'object' or not (p_changes ?& array['title','description','contextLabel','assigneeProfileId','assigneeContactId','dueAt','nextFollowupAt','primaryChannel','fallbackChannel'])
    or exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('title','description','contextLabel','assigneeProfileId','assigneeContactId','dueAt','nextFollowupAt','primaryChannel','fallbackChannel')) then raise exception 'TASK_DETAILS_INPUT_INVALID'; end if;
  new_title := btrim(p_changes->>'title'); new_description := nullif(btrim(p_changes->>'description'),''); new_context := nullif(btrim(p_changes->>'contextLabel'),'');
  if nullif(new_title,'') is null or length(new_title)>500 or length(coalesce(new_description,''))>20000 or length(coalesce(new_context,''))>500 then raise exception 'TASK_DETAILS_INPUT_INVALID'; end if;
  new_profile := nullif(p_changes->>'assigneeProfileId','')::uuid; new_contact := nullif(p_changes->>'assigneeContactId','')::uuid;
  if (new_profile is null) = (new_contact is null) then raise exception 'TASK_ASSIGNEE_REQUIRED'; end if;
  new_due := (p_changes->>'dueAt')::timestamptz; new_followup := (p_changes->>'nextFollowupAt')::timestamptz;
  new_primary := p_changes->>'primaryChannel'; new_fallback := nullif(p_changes->>'fallbackChannel','');
  if new_primary is null or (new_primary not in ('email','whatsapp') and not (new_primary='in_app' and t.primary_channel='in_app'))
    or (new_fallback is not null and ((new_fallback not in ('email','whatsapp') and not (new_fallback='in_app' and t.fallback_channel='in_app')) or new_fallback=new_primary)) then raise exception 'TASK_DETAILS_INPUT_INVALID'; end if;
  if new_due is null then
    if new_followup is not null or new_profile is distinct from t.issuer_profile_id or new_contact is not null or t.parent_task_id is not null or t.task_kind<>'simple'
      or t.status in ('waiting','ready_for_review','returned') then raise exception 'TASK_DUE_REQUIRED'; end if;
    if exists(select 1 from public.operational_tasks where parent_task_id=t.id and archived_at is null) then raise exception 'TASK_DUE_EDIT_CHILDREN'; end if;
  elsif not isfinite(new_due) or new_followup is null or not isfinite(new_followup) or new_followup>new_due then raise exception 'TASK_FOLLOWUP_INVALID';
  end if;
  recipient_changed := new_profile is distinct from t.assignee_profile_id or new_contact is distinct from t.assignee_contact_id;
  schedule_changed := new_due is distinct from t.due_at or new_followup is distinct from t.next_followup_at;
  if recipient_changed and p_confirm_recipient_change is distinct from true then raise exception 'TASK_DETAILS_CONFIRM_RECIPIENT'; end if;
  if recipient_changed and exists(select 1 from public.task_message_deliveries where task_id=t.id and status in ('sending','ambiguous')) then raise exception 'TASK_DETAILS_DELIVERY_PENDING'; end if;
  if (recipient_changed or schedule_changed) and exists(select 1 from public.task_deadline_change_requests where task_id=t.id and status='pending') then raise exception 'TASK_DETAILS_PENDING_REQUEST'; end if;
  if schedule_changed and exists(select 1 from public.task_recurrence_rules where task_id=t.id and is_active) then raise exception 'TASK_DUE_EDIT_RECURRENCE'; end if;
  if new_due is not null and exists(select 1 from public.operational_tasks where id=t.parent_task_id and due_at<new_due) then raise exception 'TASK_CHILD_AFTER_PARENT_DUE'; end if;
  if new_due is not null and exists(select 1 from public.operational_tasks where parent_task_id=t.id and archived_at is null and status not in ('approved','cancelled') and due_at>new_due) then raise exception 'TASK_PARENT_DUE_BEFORE_CHILD'; end if;
  if recipient_changed and new_profile is not null and not public.task_profile_has_module_access(p_org_id,new_profile) then raise exception 'TASK_ASSIGNEE_TASK_ACCESS_REQUIRED'; end if;
  if new_contact is not null and not exists(select 1 from public.organization_contacts where org_id=p_org_id and id=new_contact and is_active
    and nullif(btrim(email),'') is not null and ((new_primary<>'whatsapp' and new_fallback is distinct from 'whatsapp') or nullif(btrim(coalesce(whatsapp_number,phone)),'') is not null)) then raise exception 'TASK_CONTACT_METHOD_REQUIRED'; end if;
  before_value := jsonb_build_object('title',t.title,'description',t.description,'contextLabel',t.context_label,'assigneeProfileId',t.assignee_profile_id,'assigneeContactId',t.assignee_contact_id,'dueAt',t.due_at,'nextFollowupAt',t.next_followup_at,'primaryChannel',t.primary_channel,'fallbackChannel',t.fallback_channel);
  after_value := jsonb_build_object('title',new_title,'description',new_description,'contextLabel',new_context,'assigneeProfileId',new_profile,'assigneeContactId',new_contact,'dueAt',new_due,'nextFollowupAt',new_followup,'primaryChannel',new_primary,'fallbackChannel',new_fallback);
  if before_value=after_value then return t; end if;
  if recipient_changed then
    update public.task_followup_rules set is_active=false,initial_dispatch_pending=true where task_id=t.id and org_id=p_org_id;
    -- Existing triggers revoke the old grant and may create a new exact grant.
    update public.operational_tasks set title=new_title,description=new_description,context_label=new_context,
      assignee_profile_id=new_profile,assignee_contact_id=new_contact,due_at=new_due,next_followup_at=new_followup,
      primary_channel=new_primary,fallback_channel=new_fallback,last_activity_at=now() where id=t.id returning * into result;
    update public.task_access_links set revoked_at=coalesce(revoked_at,now()) where task_id=t.id and revoked_at is null;
    update public.task_recipient_portal_grants set revoked_at=coalesce(revoked_at,now()),revocation_reason='task_reassigned_awaiting_dispatch' where task_id=t.id and revoked_at is null;
    update public.task_recipient_activation_tokens set revoked_at=now() where task_id=t.id and consumed_at is null and revoked_at is null;
    update public.task_automation_jobs set status='cancelled',completed_at=coalesce(completed_at,now()),locked_at=null,locked_by=null,heartbeat_at=null,error_message='TASK_RECIPIENT_CHANGED'
      where task_id=t.id and status in ('queued','processing','failed');
    update public.task_message_deliveries set status='cancelled',next_attempt_at=null,error_message='TASK_RECIPIENT_CHANGED'
      where task_id=t.id and status in ('queued','sending','failed');
  else
    update public.operational_tasks set title=new_title,description=new_description,context_label=new_context,due_at=new_due,next_followup_at=new_followup,
      primary_channel=new_primary,fallback_channel=new_fallback,last_activity_at=now() where id=t.id returning * into result;
    if new_due is null then update public.task_followup_rules set is_active=false,initial_dispatch_pending=false where task_id=t.id; end if;
  end if;
  select coalesce(nullif(btrim(full_name),''),email,'Uppdragsansvarig') into actor_name_value from public.profiles where id=p_actor_profile_id;
  old_name := coalesce((select full_name from public.profiles where id=t.assignee_profile_id),(select name from public.organization_contacts where id=t.assignee_contact_id),'Tidigare mottagare');
  new_name := coalesce((select full_name from public.profiles where id=new_profile),(select name from public.organization_contacts where id=new_contact),'Ny mottagare');
  insert into public.task_events(org_id,task_id,event_type,actor_type,actor_profile_id,actor_name,message,metadata)
    values(p_org_id,t.id,case when recipient_changed then 'task_recipient_changed' else 'task_details_changed' end,'profile',p_actor_profile_id,actor_name_value,
      case when recipient_changed then 'Mottagare ändrades från '||old_name||' till '||new_name||'. Den gamla länken spärrades. Inget nytt utskick har gjorts.' else 'Uppgiftens grunduppgifter ändrades.' end,
      jsonb_build_object('before',before_value,'after',after_value,'taskMutationApplied',true,'taskVersion',result.version));
  return result;
end;
$$;
revoke all on function public.edit_operational_task_details(uuid,uuid,uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.edit_operational_task_details(uuid,uuid,uuid,integer,jsonb,boolean) to service_role;

-- Internal reassignment uses the existing conversation notification queue, not
-- a fabricated status transition or a second, independent mail sender.
create or replace function public.dispatch_internal_task_reassignment(p_org_id uuid,p_task_id uuid,p_actor_profile_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_catalog as $$
declare t public.operational_tasks%rowtype; change_event public.task_events%rowtype; actor_name_value text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'TASK_DETAILS_FORBIDDEN'; end if;
  select * into t from public.operational_tasks where id=p_task_id and org_id=p_org_id and archived_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if not exists(select 1 from public.org_members where org_id=p_org_id and profile_id=p_actor_profile_id and is_active
    and (t.issuer_profile_id=p_actor_profile_id or role='admin')) then raise exception 'TASK_DISPATCH_FORBIDDEN'; end if;
  if not public.task_profile_has_module_access(p_org_id,p_actor_profile_id) then raise exception 'TASK_DISPATCH_FORBIDDEN'; end if;
  if t.status in ('approved','cancelled') then raise exception 'TASK_TERMINAL'; end if;
  if t.created_source<>'manual' or t.assignee_profile_id is null then return false; end if;
  select * into change_event from public.task_events where task_id=t.id and event_type='task_recipient_changed'
    order by (metadata->>'taskVersion')::integer desc,created_at desc,id desc limit 1;
  if not found then return false; end if;
  if exists(select 1 from public.task_events where task_id=t.id and event_type='comment' and metadata->>'reassignmentEventId'=change_event.id::text) then return true; end if;
  if not exists(select 1 from public.task_followup_rules where task_id=t.id and initial_dispatch_pending) then return false; end if;
  select coalesce(nullif(btrim(full_name),''),email,'Uppdragsansvarig') into actor_name_value from public.profiles where id=p_actor_profile_id;
  update public.task_followup_rules set initial_dispatch_pending=false,is_active=(t.due_at is not null) where task_id=t.id;
  insert into public.task_events(org_id,task_id,event_type,actor_type,actor_profile_id,actor_name,message,metadata)
    values(p_org_id,t.id,'comment','profile',p_actor_profile_id,actor_name_value,
      'Du har tilldelats uppdraget ”'||t.title||'”. Uppgiftens befintliga status är oförändrad. Läs beskrivningen och återkom här i dialogen.',
      jsonb_build_object('reassignmentEventId',change_event.id,'taskMutationApplied',true));
  return true;
end;
$$;
revoke all on function public.dispatch_internal_task_reassignment(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.dispatch_internal_task_reassignment(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
