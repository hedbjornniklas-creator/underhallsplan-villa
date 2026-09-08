-- Additive: transactional moves in the RenoApp flow builder. No case data is changed.
-- Run the whole file before deploying the drag-to-reconnect interface.
begin;
set local lock_timeout = '5s';

create or replace view public.renoapp_flow_connections with (security_invoker = true) as
select id, 'action_question'::text as kind, 'action'::text as parent_kind,
  action_type_id as parent_id, 'question'::text as child_kind, question_id as child_id,
  is_active, is_required, null::text as phase, null::text as note, sort_order
from public.renoapp_action_type_questions
union all
select id, 'action_document', 'action', action_type_id, 'document', document_type_id,
  true, is_required, phase, note, sort_order
from public.renovation_action_document_requirements where brf_id is null
union all
select id, 'action_participant', 'action', action_type_id, 'participant_role', participant_role_id,
  is_active, is_required, null, null, sort_order
from public.renoapp_action_type_participant_roles
union all
select id, 'option_trigger', 'option', option_id, trigger_type,
  coalesce(question_id, document_type_id, participant_role_id, review_flag_id),
  is_active, true, null, null, sort_order
from public.renoapp_apply_option_triggers
union all
select id, 'flag_link',
  case when action_type_id is not null then 'action' when document_type_id is not null then 'document' else 'participant' end,
  coalesce(action_type_id, document_type_id, participant_role_id), 'review_flag', review_flag_id,
  is_active, true, null, null, sort_order
from public.renoapp_review_flag_links;

revoke all on public.renoapp_flow_connections from public, anon, authenticated;
grant select on public.renoapp_flow_connections to service_role;

create or replace function public.renoapp_move_flow_connection(
  p_source_kind text, p_source_id uuid, p_source_parent_id uuid,
  p_target_kind text, p_target_id uuid, p_expected_version text default null,
  p_apply boolean default false
) returns jsonb
language plpgsql security invoker set search_path = public
set lock_timeout = '5s' set statement_timeout = '15s'
as $move$
declare
  source_row public.renoapp_flow_connections%rowtype;
  table_name text;
  table_data jsonb;
  snapshot jsonb := '{}'::jsonb;
  version_value text;
  item_label text;
  from_label text;
  to_label text;
  default_phase_value text;
  parent_question_id uuid;
  result_value jsonb;
begin
  if p_apply is null or p_target_kind is null or p_target_kind not in ('action', 'option', 'document', 'participant') then
    raise exception 'FLOW_MOVE_INVALID';
  end if;

  -- Ordinary admin writers use these tables too. Serialize the short preview/apply
  -- against those writes, not just against other drag operations.
  lock table public.renovation_action_types, public.renovation_document_types,
    public.renoapp_participant_roles, public.renoapp_review_flags,
    public.renoapp_apply_questions, public.renoapp_apply_question_options,
    public.renoapp_action_type_questions, public.renovation_action_document_requirements,
    public.renoapp_action_type_participant_roles, public.renoapp_apply_option_triggers,
    public.renoapp_review_flag_links in share row exclusive mode;

  select * into source_row from public.renoapp_flow_connections
    where id = p_source_id and kind = p_source_kind and parent_id = p_source_parent_id and is_active;
  if not found then raise exception 'FLOW_MOVE_STALE'; end if;
  if source_row.parent_kind = p_target_kind and source_row.parent_id = p_target_id then
    raise exception 'FLOW_MOVE_SAME_PARENT';
  end if;
  if p_target_kind in ('document', 'participant') and source_row.child_kind <> 'review_flag' then
    raise exception 'FLOW_MOVE_INVALID_TARGET';
  end if;

  if p_target_kind = 'action' then
    select label into to_label from public.renovation_action_types where id = p_target_id and is_active;
  elsif p_target_kind = 'option' then
    select q.label || ' / ' || o.label, q.id into to_label, parent_question_id
      from public.renoapp_apply_question_options o join public.renoapp_apply_questions q on q.id = o.question_id
      where o.id = p_target_id and o.is_active and q.is_active;
  elsif p_target_kind = 'document' then
    select label into to_label from public.renovation_document_types where id = p_target_id and is_active;
  else
    select label into to_label from public.renoapp_participant_roles where id = p_target_id and is_active;
  end if;
  if to_label is null then raise exception 'FLOW_MOVE_INVALID_TARGET'; end if;

  if source_row.child_kind = 'question' then
    select label into item_label from public.renoapp_apply_questions where id = source_row.child_id and is_active;
  elsif source_row.child_kind = 'document' then
    select label, default_phase into item_label, default_phase_value
      from public.renovation_document_types where id = source_row.child_id and is_active;
  elsif source_row.child_kind = 'participant_role' then
    select label into item_label from public.renoapp_participant_roles where id = source_row.child_id and is_active;
  else
    select label into item_label from public.renoapp_review_flags where id = source_row.child_id and is_active;
  end if;
  if item_label is null then raise exception 'FLOW_MOVE_STALE'; end if;

  if source_row.parent_kind = 'action' then
    select label into from_label from public.renovation_action_types where id = source_row.parent_id;
  elsif source_row.parent_kind = 'option' then
    select q.label || ' / ' || o.label into from_label
      from public.renoapp_apply_question_options o join public.renoapp_apply_questions q on q.id = o.question_id
      where o.id = source_row.parent_id;
  elsif source_row.parent_kind = 'document' then
    select label into from_label from public.renovation_document_types where id = source_row.parent_id;
  else
    select label into from_label from public.renoapp_participant_roles where id = source_row.parent_id;
  end if;

  if exists (select 1 from public.renoapp_flow_connections
    where parent_kind = p_target_kind and parent_id = p_target_id
      and child_kind = source_row.child_kind and child_id = source_row.child_id) then
    raise exception 'FLOW_MOVE_DUPLICATE';
  end if;

  -- Answer triggers cannot represent optional requirements or per-link phase/notes.
  -- Refuse rather than silently losing those settings during a move.
  if p_target_kind = 'option' and (not source_row.is_required or source_row.note is not null
    or (source_row.phase is not null and source_row.phase is distinct from default_phase_value)) then
    raise exception 'FLOW_MOVE_CUSTOM_SETTINGS';
  end if;

  if source_row.child_kind = 'question' and p_target_kind = 'option' then
    if exists (
      with recursive reachable(id) as (
        select source_row.child_id
        union
        select t.question_id from reachable r
          join public.renoapp_apply_question_options o on o.question_id = r.id and o.is_active
          join public.renoapp_apply_option_triggers t on t.option_id = o.id
            and t.trigger_type = 'question' and t.is_active
      ) select 1 from reachable where id = parent_question_id
    ) then raise exception 'FLOW_MOVE_CYCLE'; end if;
  end if;

  foreach table_name in array array[
    'renovation_action_types', 'renovation_document_types', 'renoapp_participant_roles',
    'renoapp_review_flags', 'renoapp_apply_questions', 'renoapp_apply_question_options',
    'renoapp_action_type_questions', 'renovation_action_document_requirements',
    'renoapp_action_type_participant_roles', 'renoapp_apply_option_triggers', 'renoapp_review_flag_links'
  ] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by id), ''[]''::jsonb) from public.%I t', table_name)
      into table_data;
    snapshot := snapshot || jsonb_build_object(table_name, table_data);
  end loop;
  version_value := md5(snapshot::text);
  if p_apply and p_expected_version is distinct from version_value then raise exception 'FLOW_MOVE_STALE'; end if;
  result_value := jsonb_build_object('version', version_value, 'itemLabel', item_label,
    'fromLabel', from_label, 'toLabel', to_label,
    'shared', source_row.parent_kind <> 'action' or p_target_kind <> 'action');
  if not p_apply then return result_value; end if;

  if p_target_kind = 'option' then
    insert into public.renoapp_apply_option_triggers
      (option_id, trigger_type, question_id, document_type_id, participant_role_id, review_flag_id, sort_order, is_active)
    values (p_target_id, source_row.child_kind,
      case when source_row.child_kind = 'question' then source_row.child_id end,
      case when source_row.child_kind = 'document' then source_row.child_id end,
      case when source_row.child_kind = 'participant_role' then source_row.child_id end,
      case when source_row.child_kind = 'review_flag' then source_row.child_id end, source_row.sort_order, true);
  elsif source_row.child_kind = 'review_flag' then
    insert into public.renoapp_review_flag_links
      (review_flag_id, action_type_id, document_type_id, participant_role_id, sort_order, is_active)
    values (source_row.child_id,
      case when p_target_kind = 'action' then p_target_id end,
      case when p_target_kind = 'document' then p_target_id end,
      case when p_target_kind = 'participant' then p_target_id end, source_row.sort_order, true);
  elsif source_row.child_kind = 'question' then
    insert into public.renoapp_action_type_questions (action_type_id, question_id, is_required, sort_order, is_active)
      values (p_target_id, source_row.child_id, source_row.is_required, source_row.sort_order, true);
  elsif source_row.child_kind = 'document' then
    insert into public.renovation_action_document_requirements
      (action_type_id, document_type_id, is_required, sort_order, phase, note, brf_id)
    values (p_target_id, source_row.child_id, source_row.is_required, source_row.sort_order,
      coalesce(source_row.phase, default_phase_value), source_row.note, null);
  else
    insert into public.renoapp_action_type_participant_roles (action_type_id, participant_role_id, is_required, sort_order, is_active)
      values (p_target_id, source_row.child_id, source_row.is_required, source_row.sort_order, true);
  end if;

  case source_row.kind
    when 'action_question' then delete from public.renoapp_action_type_questions where id = source_row.id;
    when 'action_document' then delete from public.renovation_action_document_requirements where id = source_row.id and brf_id is null;
    when 'action_participant' then delete from public.renoapp_action_type_participant_roles where id = source_row.id;
    when 'option_trigger' then delete from public.renoapp_apply_option_triggers where id = source_row.id;
    when 'flag_link' then delete from public.renoapp_review_flag_links where id = source_row.id;
    else raise exception 'FLOW_MOVE_INVALID';
  end case;
  return result_value || jsonb_build_object('saved', true);
end;
$move$;

revoke all on function public.renoapp_move_flow_connection(text,uuid,uuid,text,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.renoapp_move_flow_connection(text,uuid,uuid,text,uuid,text,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
