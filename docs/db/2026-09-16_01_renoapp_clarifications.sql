begin;

create table if not exists public.renoapp_case_clarifications (
  case_id uuid not null references public.renovation_cases(id) on delete cascade,
  question_id uuid not null references public.renoapp_apply_questions(id),
  question_key text not null,
  label text not null,
  original_answer text not null,
  answer_label text,
  answer_note text,
  state text not null default 'pending' check (state in ('pending','answered','resolved','not_relevant')),
  requested boolean not null default false,
  revision integer not null default 0,
  review_note text,
  reviewed_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  primary key (case_id,question_id)
);
alter table public.renoapp_case_clarifications enable row level security;
revoke all on public.renoapp_case_clarifications from public,anon,authenticated;
grant all on public.renoapp_case_clarifications to service_role;

-- Initial submissions insert their answers after the case has left draft status.
create or replace function public.renoapp_capture_clarification()
returns trigger language plpgsql security definer set search_path=public as $$
declare q public.renoapp_apply_questions; o public.renoapp_apply_question_options; s text;
begin
  select status into s from public.renovation_cases where id=new.case_id for update;
  select * into q from public.renoapp_apply_questions where id=new.question_id;
  select * into o from public.renoapp_apply_question_options where id=new.option_id and question_id=new.question_id;
  if s <> 'draft' and q.key='har-du-fatt-besked-fran-kommunen-om-den-planerade-atgarden-kraver-anmalan'
    and o.key='needs_investigation' then
    insert into public.renoapp_case_clarifications(case_id,question_id,question_key,label,original_answer)
      values(new.case_id,q.id,q.key,q.label,o.label) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists renoapp_capture_clarification on public.renoapp_case_question_answers;
create trigger renoapp_capture_clarification after insert on public.renoapp_case_question_answers
  for each row execute function public.renoapp_capture_clarification();

create or replace function public.renoapp_guard_clarification_approval()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status='draft' and new.status<>'draft' then
    insert into public.renoapp_case_clarifications(case_id,question_id,question_key,label,original_answer)
      select new.id,q.id,q.key,q.label,o.label from public.renoapp_case_question_answers a
      join public.renoapp_apply_questions q on q.id=a.question_id
      join public.renoapp_apply_question_options o on o.id=a.option_id and o.question_id=q.id
      where a.case_id=new.id and q.key='har-du-fatt-besked-fran-kommunen-om-den-planerade-atgarden-kraver-anmalan'
        and o.key='needs_investigation' on conflict do nothing;
  end if;
  if new.status in ('approved','conditional','approved_with_conditions') and exists(
    select 1 from public.renoapp_case_clarifications where case_id=new.id and state in ('pending','answered')
  ) then raise exception 'CLARIFICATION_REVIEW_REQUIRED'; end if;
  return new;
end $$;
drop trigger if exists renoapp_guard_clarification_approval on public.renovation_cases;
create trigger renoapp_guard_clarification_approval before update of status on public.renovation_cases
  for each row execute function public.renoapp_guard_clarification_approval();

create or replace function public.renoapp_review_clarification(
  p_case_id uuid,p_question_id uuid,p_revision integer,p_action text,p_note text,p_actor uuid
) returns void language plpgsql security definer set search_path=public as $$
declare c public.renovation_cases; r public.renoapp_case_clarifications; latest public.renoapp_completion_requests;
begin
  select * into strict c from public.renovation_cases where id=p_case_id for update;
  select * into r from public.renoapp_case_clarifications where case_id=p_case_id and question_id=p_question_id for update;
  if not found or r.revision is distinct from p_revision or c.status in ('draft','approved','conditional','approved_with_conditions','rejected')
    then raise exception 'CLARIFICATION_CHANGED'; end if;
  if p_action is null or p_action not in ('request','not_requested','resolve','not_relevant','reopen') then raise exception 'CLARIFICATION_CHANGED'; end if;
  if length(coalesce(p_note,''))>4000 then raise exception 'CLARIFICATION_NOTE_REQUIRED'; end if;
  if p_action in ('resolve','not_relevant','reopen') then
    select * into latest from public.renoapp_completion_requests where case_id=p_case_id order by created_at desc limit 1;
    if c.status='need_info' and latest.submitted_at is null and exists(
      select 1 from jsonb_array_elements(latest.items) i where i->>'id'='clarification:'||p_question_id
    ) then raise exception 'CLARIFICATION_ROUND_OPEN'; end if;
    if nullif(btrim(p_note),'') is null then raise exception 'CLARIFICATION_NOTE_REQUIRED'; end if;
  elsif r.state not in ('pending','answered') then raise exception 'CLARIFICATION_CHANGED';
  end if;
  if p_action='resolve' and r.state<>'answered' then raise exception 'CLARIFICATION_REVIEW_REQUIRED'; end if;
  update public.renoapp_case_clarifications set
    state=case p_action when 'resolve' then 'resolved' when 'not_relevant' then 'not_relevant'
      when 'reopen' then case when answer_label is null then 'pending' else 'answered' end else state end,
    requested=case when p_action='request' then true when p_action in ('not_requested','resolve','not_relevant','reopen') then false else requested end,
    review_note=case when p_action in ('resolve','not_relevant','reopen') then btrim(p_note) else review_note end,
    reviewed_by=case when p_action in ('resolve','not_relevant','reopen') then p_actor else reviewed_by end,
    revision=revision+1 where case_id=p_case_id and question_id=p_question_id;
  insert into public.renovation_case_messages(case_id,type,author_role,author_profile_id,message,metadata)
    values(p_case_id,'status_change','board',p_actor,'Klarläggande uppdaterat.',
      jsonb_build_object('questionId',p_question_id,'action',p_action,'note',p_note,'previousState',r.state,'revision',r.revision+1));
end $$;

-- Reuse the existing atomic publication and mail idempotency; freeze the question and options in this round.
create or replace function public.renoapp_publish_completion_clarifications(
  p_case_id uuid,p_id uuid,p_previous_id uuid,p_status text,p_actor uuid,p_items jsonb,p_selected jsonb,p_message text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare i jsonb; r public.renoapp_case_clarifications; frozen jsonb='[]'; q jsonb; result jsonb;
begin
  perform 1 from public.renovation_cases where id=p_case_id for update;
  if exists(select 1 from public.renoapp_completion_requests where id=p_id and case_id=p_case_id) then
    return jsonb_build_object('id',p_id);
  end if;
  if (select coalesce(jsonb_agg('clarification:'||question_id order by question_id),'[]') from public.renoapp_case_clarifications
      where case_id=p_case_id and requested and state in ('pending','answered')) <>
     (select coalesce(jsonb_agg(entry->>'id' order by entry->>'id'),'[]') from jsonb_array_elements(p_items) entry where entry->>'category'='clarification')
    then raise exception 'CLARIFICATION_CHANGED'; end if;
  for i in select * from jsonb_array_elements(p_items) loop
    if i->>'category'='clarification' then
      select * into r from public.renoapp_case_clarifications where case_id=p_case_id
        and question_id=split_part(i->>'id',':',2)::uuid;
      if not found or r.revision is distinct from (i->>'clarificationRevision')::integer then raise exception 'CLARIFICATION_CHANGED'; end if;
      select jsonb_build_object('questionId',r.question_id,'label',r.label,'revision',r.revision,'options',
        coalesce(jsonb_agg(jsonb_build_object('id',o.id,'key',o.key,'label',o.label) order by o.sort_order),'[]')) into q
        from public.renoapp_apply_question_options o where o.question_id=r.question_id and o.is_active;
      if jsonb_array_length(q->'options')<2 then raise exception 'CLARIFICATION_CHANGED'; end if;
      i:=i||jsonb_build_object('question',q);
    end if;
    frozen:=frozen||jsonb_build_array(i);
  end loop;
  result:=public.renoapp_publish_completion(p_case_id,p_id,p_previous_id,p_status,p_actor,frozen,p_selected,p_message);
  update public.renoapp_completion_requests set draft=draft||jsonb_build_object('clarificationAnswers',coalesce((
    select jsonb_object_agg(a.key,a.value) from public.renoapp_completion_requests previous,
      lateral jsonb_each(coalesce(previous.draft->'clarificationAnswers','{}')) a
    where previous.id=p_previous_id and previous.submitted_at is null and exists(
      select 1 from jsonb_array_elements(frozen) x where x->>'id'='clarification:'||a.key
    )), '{}')) where id=p_id;
  return result;
end $$;

create or replace function public.renoapp_save_completion_clarifications(
  p_case_id uuid,p_request_id uuid,p_token_hash text,p_revision integer,
  p_participants jsonb,p_reply text,p_submit boolean,p_answers jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.renoapp_completion_requests; i jsonb; a jsonb; o public.renoapp_apply_question_options;
  question_id_value uuid; previous_answers jsonb; result jsonb; s text;
begin
  select status into s from public.renovation_cases where id=p_case_id for update;
  -- The existing function checks token, current round, revision and participant confirmations.
  result:=public.renoapp_save_completion(p_case_id,p_request_id,p_token_hash,p_revision,p_participants,p_reply,p_submit);
  select * into strict r from public.renoapp_completion_requests where id=p_request_id;
  if jsonb_typeof(p_answers) is distinct from 'object' or exists(
    select 1 from jsonb_object_keys(p_answers) k where not exists(
      select 1 from jsonb_array_elements(r.items) entry where entry->>'id'='clarification:'||k
    )) then raise exception 'COMPLETION_BASE_FIELDS_LOCKED'; end if;
  for i in select * from jsonb_array_elements(r.items) where value->>'category'='clarification' loop
    question_id_value:=(i->'question'->>'questionId')::uuid;
    a:=p_answers->question_id_value::text;
    if length(coalesce(a->>'note',''))>4000 then raise exception 'CLARIFICATION_ANSWER_REQUIRED'; end if;
    if nullif(a->>'optionId','') is not null then
      select * into o from public.renoapp_apply_question_options where id=(a->>'optionId')::uuid
        and question_id=question_id_value and is_active;
      if not found or not exists(select 1 from jsonb_array_elements(i->'question'->'options') x
        where x->>'id'=a->>'optionId' and x->>'key'=o.key) then raise exception 'CLARIFICATION_CHANGED'; end if;
    else
      o:=null;
    end if;
    if p_submit then
      if o.id is null or (o.key='needs_investigation' and nullif(btrim(a->>'note'),'') is null)
        then raise exception 'CLARIFICATION_ANSWER_REQUIRED'; end if;
      if not exists(select 1 from public.renoapp_case_clarifications where case_id=p_case_id and question_id=question_id_value
        and state in ('pending','answered')) then raise exception 'CLARIFICATION_CHANGED'; end if;
      select coalesce(jsonb_agg(jsonb_build_object('optionId',previous.option_id,'label',old_option.label)),'[]') into previous_answers
        from public.renoapp_case_question_answers previous join public.renoapp_apply_question_options old_option on old_option.id=previous.option_id
        where previous.case_id=p_case_id and previous.question_id=question_id_value;
      delete from public.renoapp_case_question_answers where case_id=p_case_id and question_id=question_id_value;
      insert into public.renoapp_case_question_answers(case_id,question_id,option_id) values(p_case_id,question_id_value,o.id);
      update public.renoapp_case_clarifications set state=case when o.key='needs_investigation' then 'pending' else 'answered' end,
        answer_label=case when o.key='needs_investigation' then null else o.label end,answer_note=btrim(a->>'note'),
        requested=false,review_note=null,reviewed_by=null,revision=revision+1
        where case_id=p_case_id and question_id=question_id_value;
      insert into public.renovation_case_messages(case_id,type,author_role,message,metadata)
        values(p_case_id,'status_change','applicant','Svar på klarläggande registrerat.',jsonb_build_object(
          'completionRequestId',p_request_id,'questionId',question_id_value,'previousAnswers',previous_answers,
          'answer',jsonb_build_object('optionId',o.id,'label',o.label,'note',a->>'note')));
    end if;
  end loop;
  update public.renoapp_completion_requests set draft=draft||jsonb_build_object('clarificationAnswers',p_answers) where id=p_request_id;
  return result;
end $$;

revoke all on function public.renoapp_capture_clarification() from public,anon,authenticated;
revoke all on function public.renoapp_guard_clarification_approval() from public,anon,authenticated;
revoke all on function public.renoapp_review_clarification(uuid,uuid,integer,text,text,uuid) from public,anon,authenticated;
revoke all on function public.renoapp_publish_completion_clarifications(uuid,uuid,uuid,text,uuid,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.renoapp_save_completion_clarifications(uuid,uuid,text,integer,jsonb,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.renoapp_review_clarification(uuid,uuid,integer,text,text,uuid) to service_role;
grant execute on function public.renoapp_publish_completion_clarifications(uuid,uuid,uuid,text,uuid,jsonb,jsonb,text) to service_role;
grant execute on function public.renoapp_save_completion_clarifications(uuid,uuid,text,integer,jsonb,text,boolean,jsonb) to service_role;
commit;
