-- Explicit issuer-authored completion, separate from the recipient review flow.
-- Run after the operational-task evidence checklist and recurrence migrations.
begin;

alter table public.operational_tasks add column if not exists completion_method text;
alter table public.operational_tasks drop constraint if exists operational_tasks_completion_method_check;
alter table public.operational_tasks add constraint operational_tasks_completion_method_check
  check (completion_method is null or (completion_method = 'manual' and status = 'approved'));
alter table public.operational_tasks drop constraint if exists operational_tasks_review_state_check;
alter table public.operational_tasks add constraint operational_tasks_review_state_check
  check (status <> 'approved' or (approved_at is not null and approved_by_profile_id is not null
    and (submitted_for_review_at is not null or coalesce(completion_method = 'manual',false))));

-- Do not manufacture a recipient submission date for a manual completion.
comment on column public.operational_tasks.completion_method is
  'manual: explicitly completed by the issuer. Recipient submission time remains unchanged; exceptions are recorded in the append-only event.';

create or replace function public.operational_task_completion_gaps(p_org_id uuid,p_task_id uuid) returns jsonb
language sql security definer set search_path=public,pg_catalog as $$
  select jsonb_build_object(
    'requirements', (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'label',r.label,'status',r.status) order by r.id),'[]')
      from public.task_requirements r where r.org_id=t.org_id and r.task_id=t.id and r.is_required
        and r.status not in ('verified','not_required','waived')),
    'evidenceTypes', (select coalesce(jsonb_agg(e.kind order by e.kind),'[]') from (
      select c.evidence_type as kind from public.task_completion_evidence_requirements c where c.org_id=t.org_id and c.task_id=t.id
      union all select t.evidence_requirement where t.evidence_requirement <> 'optional'
        and not exists(select 1 from public.task_completion_evidence_requirements c where c.org_id=t.org_id and c.task_id=t.id)
    ) e where not exists(select 1 from public.task_attachments a where a.org_id=t.org_id and a.task_id=t.id and a.is_completion_evidence
      and (e.kind='any' or a.attachment_type=e.kind or (e.kind='text' and a.attachment_type='audio' and nullif(btrim(a.transcript_text),'') is not null)))),
    'openChildCount', (select count(*) from public.operational_tasks c where c.org_id=t.org_id and c.parent_task_id=t.id
      and c.archived_at is null and c.status not in ('approved','cancelled'))
  ) from public.operational_tasks t where t.org_id=p_org_id and t.id=p_task_id and t.archived_at is null
$$;

create or replace function public.complete_operational_task_manually(
  p_org_id uuid,p_task_id uuid,p_actor_profile_id uuid,p_expected_version integer,p_comment text,p_acknowledged_gaps jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  task_row public.operational_tasks%rowtype; result public.operational_tasks%rowtype;
  gaps jsonb; expected_gaps jsonb; pending_deadlines jsonb; actor_name_value text;
  note text := nullif(btrim(p_comment),''); audit_message text; completed_at timestamptz;
  next_task_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'TASK_MANUAL_COMPLETION_FORBIDDEN'; end if;
  select * into task_row from public.operational_tasks where org_id=p_org_id and id=p_task_id and archived_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if p_actor_profile_id is distinct from task_row.issuer_profile_id or not exists(
    select 1 from public.org_members where org_id=p_org_id and profile_id=p_actor_profile_id and is_active
  ) then raise exception 'TASK_MANUAL_COMPLETION_FORBIDDEN'; end if;
  if task_row.created_source='system' then raise exception 'TASK_MANUAL_COMPLETION_MANAGED'; end if;
  if p_expected_version is null or p_expected_version<=0 then raise exception 'TASK_VERSION_REQUIRED'; end if;
  if note is null or length(note)>4000 then raise exception 'TASK_MANUAL_COMPLETION_COMMENT_REQUIRED'; end if;

  -- Replaying the identical request after a lost response does not create a
  -- second event, notification or recurring task. Other old requests still fail.
  if task_row.status='approved' and task_row.completion_method='manual' and exists(
    select 1 from public.task_events where org_id=p_org_id and task_id=p_task_id and event_type='status_changed'
      and actor_profile_id=p_actor_profile_id and metadata->>'completionMethod'='manual'
      and metadata->'expectedVersion'=to_jsonb(p_expected_version) and metadata->>'comment'=note
      and metadata->'acknowledgedGaps'=p_acknowledged_gaps
  ) then return jsonb_build_object('task',to_jsonb(task_row),'replayed',true); end if;
  if task_row.version<>p_expected_version then raise exception 'TASK_VERSION_CONFLICT'; end if;
  if task_row.status not in ('assigned','in_progress','waiting','returned','ready_for_review') then raise exception 'TASK_TRANSITION_INVALID'; end if;

  gaps:=public.operational_task_completion_gaps(p_org_id,p_task_id);
  if (gaps->>'openChildCount')::integer>0 then raise exception 'TASK_CHILDREN_INCOMPLETE'; end if;
  expected_gaps:=jsonb_build_object('requirementIds',
    (select coalesce(jsonb_agg(r->>'id' order by r->>'id'),'[]') from jsonb_array_elements(gaps->'requirements') r),
    'evidenceTypes',gaps->'evidenceTypes');
  if p_acknowledged_gaps is distinct from expected_gaps then raise exception 'TASK_MANUAL_COMPLETION_GAPS_CHANGED'; end if;

  select coalesce(nullif(btrim(full_name),''),email,'Uppdragsansvarig') into actor_name_value from public.profiles where id=p_actor_profile_id;
  select coalesce(jsonb_agg(id order by id),'[]') into pending_deadlines from public.task_deadline_change_requests
    where org_id=p_org_id and task_id=p_task_id and status='pending';
  completed_at:=clock_timestamp();
  update public.operational_tasks set status='approved',completion_method='manual',approved_at=completed_at,
    approved_by_profile_id=p_actor_profile_id,last_activity_at=completed_at where id=p_task_id;
  update public.task_deadline_change_requests set status='cancelled' where org_id=p_org_id and task_id=p_task_id and status='pending';

  audit_message:='Klarmarkerad manuellt av uppdragsansvarig.'||E'\n'||note;
  if jsonb_array_length(gaps->'requirements')>0 then audit_message:=audit_message||E'\nKvarstående kontrollpunkter: '||
    (select string_agg(r->>'label',', ' order by r->>'id') from jsonb_array_elements(gaps->'requirements') r)||'.'; end if;
  if jsonb_array_length(gaps->'evidenceTypes')>0 then audit_message:=audit_message||E'\nSaknade färdigbevis: '||
    (select string_agg(case e when 'photo' then 'Foto' when 'document' then 'Dokument' when 'text' then 'Textredovisning' else 'Färdigbevis' end,', ' order by e)
      from jsonb_array_elements_text(gaps->'evidenceTypes') e)||'.'; end if;
  insert into public.task_events(org_id,task_id,event_type,actor_type,actor_profile_id,actor_name,message,from_status,to_status,metadata)
    values(p_org_id,p_task_id,'status_changed','profile',p_actor_profile_id,actor_name_value,audit_message,task_row.status,'approved',
      jsonb_build_object('completionMethod','manual','comment',note,'expectedVersion',p_expected_version,'acknowledgedGaps',expected_gaps,
        'gaps',gaps,'priorSubmittedForReviewAt',task_row.submitted_for_review_at,'cancelledDeadlineRequestIds',pending_deadlines,'taskMutationApplied',true));
  -- The existing recurrence trigger has already created the next occurrence.
  -- Release its durable initial-assignment job in this same transaction, not
  -- after the HTTP response. The worker issues the personal recipient link.
  select next_rule.task_id into next_task_id from public.task_recurrence_rules current_rule
    join public.task_recurrence_rules next_rule on next_rule.org_id=current_rule.org_id
      and next_rule.series_id=current_rule.series_id and next_rule.sequence>current_rule.sequence
    join public.operational_tasks next_task on next_task.id=next_rule.task_id and next_task.org_id=p_org_id
      and next_task.issuer_profile_id=p_actor_profile_id and next_task.archived_at is null
    where current_rule.org_id=p_org_id and current_rule.task_id=p_task_id
    order by next_rule.sequence limit 1;
  if next_task_id is not null and exists(select 1 from public.operational_tasks where id=next_task_id
      and assignee_contact_id is not null and status not in ('approved','cancelled')) then
    perform public.finalize_operational_task_initial_dispatch(p_org_id,next_task_id,p_actor_profile_id);
  end if;
  select * into result from public.operational_tasks where id=p_task_id;
  return jsonb_build_object('task',to_jsonb(result),'replayed',false,'nextTaskId',next_task_id);
end $$;

revoke all on function public.operational_task_completion_gaps(uuid,uuid),public.complete_operational_task_manually(uuid,uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.operational_task_completion_gaps(uuid,uuid),public.complete_operational_task_manually(uuid,uuid,uuid,integer,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
