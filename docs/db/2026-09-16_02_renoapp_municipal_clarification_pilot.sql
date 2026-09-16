-- Run only AFTER the clarification-capable application is deployed and verified.
begin;
do $$
begin
  if not exists(select 1 from public.renoapp_apply_questions
    where key='har-du-fatt-besked-fran-kommunen-om-den-planerade-atgarden-kraver-anmalan' and is_active) then
    raise exception 'Active municipal question not found; review configuration before activating the pilot.';
  end if;
  if to_regprocedure('public.renoapp_save_completion_clarifications(uuid,uuid,text,integer,jsonb,text,boolean,jsonb)') is null then
    raise exception 'Install the clarification foundation first.';
  end if;
end $$;
insert into public.renoapp_apply_question_options(question_id,key,label,description,sort_order,is_active)
select id,'needs_investigation','Jag behöver undersöka detta',
  'Du kan skicka in ansökan nu. Frågan visas som ej klarlagd för styrelsen. Om styrelsen begär ett besked återkommer du med svaret i samma ansökan.',30,true
from public.renoapp_apply_questions where key='har-du-fatt-besked-fran-kommunen-om-den-planerade-atgarden-kraver-anmalan'
on conflict(question_id,key) do nothing;
update public.renoapp_apply_questions set help_text=
  'Besvara frågan utifrån kommunens besked om det planerade arbetet. Om du ännu inte har klarlagt detta väljer du Jag behöver undersöka detta. Beskriv hela arbetet vid kontakt med kommunen och ta vid behov hjälp av utföraren eller en sakkunnig. Styrelsens beslut ersätter inte kommunens besked.'
where key='har-du-fatt-besked-fran-kommunen-om-den-planerade-atgarden-kraver-anmalan';
commit;
