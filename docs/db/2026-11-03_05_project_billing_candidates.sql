-- Read-only review candidates for older running offers. No backfill or document writes.
-- Run after 2026-11-03_04_project_price_candidate_split.sql.
begin;
create or replace function public.legacy_project_price(b jsonb, item uuid)
returns jsonb language plpgsql set search_path=public,pg_catalog as $$
declare p jsonb:=b->'contractPricing'; r jsonb; t jsonb; c jsonb; k text; m text;
begin
  -- A running offer's inactive total basis is not a fixed lump sum to allocate.
  if p is null or (p->>'basis'<>'rows' and p->>'mode'<>'running') then return null; end if;
  select value into r from jsonb_array_elements(p->'rows') where public.contract_work_ref(value,item);
  if r is null or r ? 'projectPricing' then return null; end if;
  t:=jsonb_build_object('version',1,'split',p->'split','assumptions',coalesce(p#>>'{budget,assumptions}',''),'reviewTerms',coalesce(p#>>'{budget,reviewTerms}',''));
  m:=case when p->>'mode'='running' or (p->>'mode'='mixed' and r->>'kind'='running') then case when p->'budget' is not null and p->'budget'<>'null'::jsonb then 'budget' else 'running' end else 'fixed' end;
  foreach k in array array['combined','labour','material'] loop
    c:=jsonb_build_object('mode',m,'fixedOre',case k when 'combined' then r->'amountOre' when 'labour' then r->'labourOre' else r->'materialOre' end,
      'budgetOre',null,'hourlyOre',p#>'{running,hourlyOre}','markupPercent',p#>'{running,markupPercent}');
    if m='budget' and p->>'split'='separate' then return null; end if;
    if m='budget' and k='combined' then c:=c||jsonb_build_object('budgetOre',(select x->'amountOre' from jsonb_array_elements(p#>'{budget,rows}') x where x->'id'=r->'id')); end if;
    t:=t||jsonb_build_object(k,c);
  end loop;
  return t;
end $$;
revoke all on function public.legacy_project_price(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.legacy_project_price(jsonb,uuid) to service_role;
commit;
