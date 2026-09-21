begin;

-- Replace only the substantive approval guard. Preserve clarification capture,
-- answers, review history, rules acceptance and existing access restrictions.
create or replace function public.renoapp_guard_clarification_approval()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status='draft' and new.status in ('approved','conditional','approved_with_conditions','rejected') then
    raise exception 'DRAFT_CASE_LOCKED';
  end if;
  if old.status='draft' and new.status<>'draft' then
    insert into public.renoapp_case_clarifications(case_id,question_id,question_key,label,original_answer)
      select new.id,q.id,q.key,q.label,o.label from public.renoapp_case_question_answers a
      join public.renoapp_apply_questions q on q.id=a.question_id
      join public.renoapp_apply_question_options o on o.id=a.option_id and o.question_id=q.id
      where a.case_id=new.id and q.key='har-du-fatt-besked-fran-kommunen-om-den-planerade-atgarden-kraver-anmalan'
        and o.key='needs_investigation' on conflict do nothing;
  end if;
  return new;
end $$;

commit;
