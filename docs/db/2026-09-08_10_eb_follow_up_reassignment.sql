-- Requires 2026-09-07_08_eb_follow_up_remediation.sql and 2026-09-08_08_eb_follow_up_activity_mail.sql.
-- Guard reassignment and preserve frozen reports, role checks and suppressed activity mail.
begin;

create or replace function public.eb_apply_remediation_action(
  p_org_id uuid,
  p_project_id uuid,
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_action text,
  p_payload jsonb,
  p_actor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task public.eb_remediation_tasks%rowtype;
  v_access public.eb_remediation_access_links%rowtype;
  v_assignee public.eb_remediation_assignees%rowtype;
  v_access_id uuid := nullif(p_actor->>'accessLinkId', '')::uuid;
  v_profile_id uuid := nullif(p_actor->>'profileId', '')::uuid;
  v_actor_name text := nullif(btrim(p_actor->>'name'), '');
  v_actor_email text := nullif(btrim(p_actor->>'email'), '');
  v_role text := 'internal';
  v_paid boolean;
  v_order_status text;
  v_withdrawn_at timestamptz;
  v_status text;
  v_assignee_id uuid;
  v_due_date date;
  v_message text := nullif(btrim(p_payload->>'message'), '');
  v_event_id uuid := gen_random_uuid();
  v_event_type text;
  v_metadata jsonb := '{}'::jsonb;
  v_image_id uuid;
  v_file_path text;
  v_thumbnail_path text;
  v_from_status text;
  v_from_assignee_name text;
  v_assignment_changed boolean;
  v_reopened boolean := false;
begin
  if p_actor is null or jsonb_typeof(p_actor) <> 'object'
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_action not in ('status', 'assign', 'comment', 'image') then
    raise exception 'EB_REMEDIATION_ACTION_FORBIDDEN';
  end if;

  select * into v_task from public.eb_remediation_tasks
    where id = p_task_id and org_id = p_org_id and eb_project_id = p_project_id
    for update;
  if not found then raise exception 'EB_REMEDIATION_TASK_NOT_FOUND'; end if;
  v_paid := v_task.follow_up_order_id is not null;

  if v_access_id is not null then
    select * into v_access from public.eb_remediation_access_links
      where id = v_access_id and org_id = p_org_id and eb_project_id = p_project_id
      for share;
    if not found then raise exception 'EB_REMEDIATION_ACCESS_NOT_FOUND'; end if;
    if v_access.revoked_at is not null then raise exception 'EB_REMEDIATION_ACCESS_REVOKED'; end if;
    if v_access.expires_at is not null and v_access.expires_at <= now() then
      raise exception 'EB_REMEDIATION_ACCESS_EXPIRED';
    end if;
    if v_access.follow_up_order_id is distinct from v_task.follow_up_order_id
      or (v_access.inspection_id is not null and v_access.inspection_id <> v_task.inspection_id)
      or ((v_access.role = 'assignee' or (v_paid and v_access.role = 'contractor_admin'))
        and (v_access.remediation_assignee_id is null
          or v_access.remediation_assignee_id is distinct from v_task.remediation_assignee_id))
      or not v_task.included then
      raise exception 'EB_REMEDIATION_TASK_NOT_FOUND';
    end if;
    v_role := v_access.role;
    v_profile_id := null;
    v_actor_name := v_access.display_name;
    v_actor_email := v_access.email;
  elsif v_profile_id is null then
    raise exception 'EB_REMEDIATION_ACTION_FORBIDDEN';
  end if;

  if v_paid then
    -- This lock serializes cancellation against a concurrent contractor write.
    select status, withdrawal_requested_at into v_order_status, v_withdrawn_at from public.eb_follow_up_orders
      where id = v_task.follow_up_order_id and org_id = p_org_id
        and eb_project_id = p_project_id and inspection_id = v_task.inspection_id
      for share;
    if not found or v_order_status <> 'active' or v_withdrawn_at is not null then
      raise exception 'EB_FOLLOW_UP_ORDER_INACTIVE';
    end if;
  end if;

  if v_role = 'contractor_viewer'
    or (v_role = 'customer_owner' and not v_paid) then
    raise exception 'EB_REMEDIATION_ACTION_FORBIDDEN';
  end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception 'EB_REMEDIATION_CONFLICT';
  end if;
  if v_message is not null and (length(v_message) > 6000 or v_message ~ '[[:cntrl:]]' and v_message ~ '[\x01-\x08\x0B\x0C\x0E-\x1F]') then
    raise exception 'EB_REMEDIATION_COMMENT_INVALID';
  end if;

  v_from_status := v_task.status;
  if p_action = 'status' then
    v_status := p_payload->>'status';
    if v_status is null or v_status not in (
      'unassigned', 'assigned', 'in_progress', 'ready_for_review',
      'returned', 'reported_remedied', 'cannot_remedy'
    ) then raise exception 'EB_REMEDIATION_STATUS_INVALID'; end if;
    if v_paid then
      if v_role = 'customer_owner' then
        if v_status <> 'returned' then raise exception 'EB_REMEDIATION_ACTION_FORBIDDEN'; end if;
        if v_message is null then raise exception 'EB_REMEDIATION_COMMENT_REQUIRED'; end if;
      elsif v_role in ('assignee', 'contractor_admin') then
        if v_status not in ('in_progress', 'reported_remedied', 'cannot_remedy') then
          raise exception 'EB_REMEDIATION_ACTION_FORBIDDEN';
        end if;
      elsif v_role <> 'internal' then raise exception 'EB_REMEDIATION_ACTION_FORBIDDEN';
      end if;
      if v_status = 'cannot_remedy' and v_message is null then
        raise exception 'EB_REMEDIATION_COMMENT_REQUIRED';
      end if;
      if v_status = 'reported_remedied' and v_message is null
        and not exists(select 1 from public.eb_remediation_images where task_id = v_task.id) then
        raise exception 'EB_REMEDIATION_COMPLETION_EVIDENCE_REQUIRED';
      end if;
    else
      if v_role = 'assignee' then
        if v_status not in ('in_progress', 'ready_for_review', 'cannot_remedy') then
          raise exception 'EB_REMEDIATION_ACTION_FORBIDDEN';
        end if;
        if v_status = 'ready_for_review' and not exists(
          select 1 from public.eb_remediation_images where task_id = v_task.id
        ) then raise exception 'EB_REMEDIATION_COMPLETION_IMAGE_REQUIRED'; end if;
      elsif v_role = 'contractor_admin' then
        if v_status = 'unassigned' then raise exception 'EB_REMEDIATION_ACTION_FORBIDDEN'; end if;
      elsif v_role <> 'internal' then raise exception 'EB_REMEDIATION_ACTION_FORBIDDEN';
      end if;
    end if;
    if v_status = v_task.status and v_message is null then return to_jsonb(v_task); end if;
    update public.eb_remediation_tasks set status = v_status,
      reported_remedied_at = case when v_status = 'reported_remedied' then clock_timestamp() end,
      reported_remedied_by_access_id = case when v_status = 'reported_remedied' then v_access_id end,
      updated_at = clock_timestamp()
    where id = v_task.id returning * into v_task;
    v_event_type := 'status_changed';
  elsif p_action = 'assign' then
    if (v_paid and v_role not in ('customer_owner', 'internal'))
      or (not v_paid and v_role not in ('contractor_admin', 'internal')) then
      raise exception 'EB_REMEDIATION_ACTION_FORBIDDEN';
    end if;
    v_assignee_id := nullif(p_payload->>'assigneeId', '')::uuid;
    if v_assignee_id is not null then
      select * into v_assignee from public.eb_remediation_assignees
        where id = v_assignee_id and org_id = p_org_id and eb_project_id = p_project_id and is_active
          and follow_up_order_id is not distinct from v_task.follow_up_order_id
        for share;
      if not found then raise exception 'EB_REMEDIATION_ASSIGNEE_NOT_FOUND'; end if;
    end if;
    v_assignment_changed := v_task.remediation_assignee_id is distinct from v_assignee_id;
    if v_paid and v_assignment_changed then
      -- Issued links are guarded too: an invitation can still be queued or have
      -- been forwarded, even if sent_at/last_used_at have not been recorded.
      if (v_task.status = 'reported_remedied' or exists (
        select 1 from public.eb_remediation_access_links l
        where l.org_id = p_org_id and l.eb_project_id = p_project_id
          and l.follow_up_order_id = v_task.follow_up_order_id
          and l.inspection_id = v_task.inspection_id
          and l.role in ('assignee', 'contractor_admin', 'contractor_viewer')
          and l.remediation_assignee_id in (v_task.remediation_assignee_id, v_assignee_id)
      )) and (p_payload->'confirmReassignment') is distinct from 'true'::jsonb then
        raise exception 'EB_REMEDIATION_REASSIGNMENT_CONFIRMATION_REQUIRED';
      end if;
      if v_task.status = 'reported_remedied' then
        if (p_payload->'reopenCompleted') is distinct from 'true'::jsonb then
          raise exception 'EB_REMEDIATION_REOPEN_CONFIRMATION_REQUIRED';
        end if;
        v_reopened := true;
      end if;
      select name into v_from_assignee_name from public.eb_remediation_assignees
        where id = v_task.remediation_assignee_id and org_id = p_org_id
          and eb_project_id = p_project_id and follow_up_order_id = v_task.follow_up_order_id;
      v_message := 'Utförare ändrades från ' || coalesce(v_from_assignee_name, 'Ej tilldelad')
        || ' till ' || coalesce(v_assignee.name, 'Ej tilldelad') || '.'
        || case when v_reopened then ' Punkten återöppnades som Ej klar.' else '' end;
    end if;
    v_due_date := case when p_payload ? 'dueDate' then nullif(p_payload->>'dueDate', '')::date else v_task.due_date end;
    v_status := case when v_assignee_id is null then 'unassigned'
      when v_task.status = 'unassigned' or v_reopened then 'assigned' else v_task.status end;
    if v_task.remediation_assignee_id is not distinct from v_assignee_id
      and v_task.due_date is not distinct from v_due_date
      and v_task.status = v_status and v_task.assignment_managed_by = 'contractor' then
      return to_jsonb(v_task);
    end if;
    v_metadata := jsonb_build_object('fromAssigneeId', v_task.remediation_assignee_id, 'toAssigneeId', v_assignee_id,
      'fromAssigneeName', v_from_assignee_name, 'toAssigneeName', v_assignee.name, 'reopened', v_reopened);
    update public.eb_remediation_tasks set remediation_assignee_id = v_assignee_id,
      assignment_managed_by = 'contractor', due_date = v_due_date, status = v_status,
      reported_remedied_at = case when v_reopened then null else reported_remedied_at end,
      updated_at = clock_timestamp()
    where id = v_task.id returning * into v_task;
    v_event_type := 'assigned';
  elsif p_action = 'comment' then
    if v_message is null then raise exception 'EB_REMEDIATION_COMMENT_REQUIRED'; end if;
    update public.eb_remediation_tasks set updated_at = clock_timestamp()
      where id = v_task.id returning * into v_task;
    v_event_type := 'comment';
  elsif p_action = 'image' then
    v_image_id := nullif(p_payload->>'id', '')::uuid;
    v_file_path := p_payload->>'filePath';
    v_thumbnail_path := nullif(p_payload->>'thumbnailFilePath', '');
    if v_image_id is null or p_payload->>'storageBucket' is distinct from 'eb-remediation-images'
      or v_file_path is null or v_file_path not like p_project_id::text || '/' || p_task_id::text || '/%'
      or v_file_path ~ '(^|/)\.\.(/|$)'
      or (v_thumbnail_path is not null and (
        v_thumbnail_path not like p_project_id::text || '/' || p_task_id::text || '/%'
        or v_thumbnail_path ~ '(^|/)\.\.(/|$)'
      ))
      or coalesce(p_payload->>'contentType', '') not like 'image/%'
      or coalesce((p_payload->>'fileSizeBytes')::bigint, 0) not between 1 and 15728640 then
      raise exception 'EB_REMEDIATION_IMAGE_INVALID';
    end if;
    update public.eb_remediation_tasks set updated_at = clock_timestamp()
      where id = v_task.id returning * into v_task;
    v_event_type := 'photo_added';
    v_metadata := jsonb_build_object('imageId', v_image_id, 'fileName', p_payload->>'fileName');
  end if;

  insert into public.eb_remediation_events(
    id, org_id, eb_project_id, task_id, event_type,
    actor_access_link_id, actor_profile_id, actor_name, actor_email,
    message, from_status, to_status, metadata
  ) values (
    v_event_id, p_org_id, p_project_id, p_task_id, v_event_type,
    v_access_id, v_profile_id, v_actor_name, v_actor_email,
    v_message, v_from_status, v_task.status, v_metadata
  );
  if p_action = 'image' then
    insert into public.eb_remediation_images(
      id, org_id, eb_project_id, task_id, event_id, storage_bucket, file_path,
      thumbnail_file_path, file_name, content_type, file_size_bytes,
      uploaded_by_access_link_id, uploaded_by_profile_id
    ) values (
      v_image_id, p_org_id, p_project_id, p_task_id, v_event_id,
      p_payload->>'storageBucket', v_file_path, v_thumbnail_path,
      nullif(p_payload->>'fileName', ''), p_payload->>'contentType', (p_payload->>'fileSizeBytes')::bigint,
      v_access_id, v_profile_id
    );
  end if;

  if v_paid then
    insert into public.eb_follow_up_email_outbox(order_id, event_id, dedupe_key, kind, payload)
      values(v_task.follow_up_order_id, v_event_id, 'event:' || v_event_id::text, 'task_event', '{}'::jsonb);
  end if;
  return to_jsonb(v_task);
end;
$$;

revoke all on function public.eb_apply_remediation_action(uuid, uuid, uuid, timestamptz, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.eb_apply_remediation_action(uuid, uuid, uuid, timestamptz, text, jsonb, jsonb)
  to service_role;

-- Paid bulk changes are all-or-nothing; a stale version or missing confirmation
-- on any selected task cannot leave earlier tasks moved.
create or replace function public.eb_assign_remediation_tasks(
  p_org_id uuid, p_project_id uuid, p_tasks jsonb, p_payload jsonb, p_actor jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item jsonb; v_result jsonb := '[]'::jsonb;
begin
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) = 0 then
    raise exception 'EB_REMEDIATION_TASK_REQUIRED';
  end if;
  if exists(select 1 from jsonb_array_elements(p_tasks) item
      where item->>'id' is null or item->>'expectedUpdatedAt' is null)
    or (select count(*) from jsonb_array_elements(p_tasks)) <>
       (select count(distinct item->>'id') from jsonb_array_elements(p_tasks) item) then
    raise exception 'EB_REMEDIATION_CONFLICT';
  end if;
  for v_item in select value from jsonb_array_elements(p_tasks) order by value->>'id' loop
    v_result := v_result || jsonb_build_array(public.eb_apply_remediation_action(
      p_org_id, p_project_id, (v_item->>'id')::uuid,
      (v_item->>'expectedUpdatedAt')::timestamptz, 'assign', p_payload, p_actor));
  end loop;
  return v_result;
end $$;
revoke all on function public.eb_assign_remediation_tasks(uuid, uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.eb_assign_remediation_tasks(uuid, uuid, jsonb, jsonb, jsonb) to service_role;


commit;
