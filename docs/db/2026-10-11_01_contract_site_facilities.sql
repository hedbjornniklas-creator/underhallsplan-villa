-- Gizmo: practical workplace facilities in the independent contract draft.
-- Prerequisites: contract migrations through 2026-10-10_03. Run before deployment.
-- Existing drafts, agreement texts and signed snapshots are never rewritten.
begin;

create or replace function public.assert_contract_site_facilities(p_body jsonb,p_complete boolean default false)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare s jsonb := p_body#>'{contractDetails,siteFacilities}'; key text; row jsonb; party text;
begin
  if s is null then return; end if;
  if jsonb_typeof(s) is distinct from 'object' or s->'version' is distinct from '1'::jsonb
    or jsonb_typeof(s->'entries') is distinct from 'object' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  for key,row in select * from jsonb_each(s->'entries') loop
    if key not in ('electricity','water','toilet','changing','meals','storage','access','waste')
      or jsonb_typeof(row) is distinct from 'object' or jsonb_typeof(row->'details') is distinct from 'string'
      or length(row->>'details')>2000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    foreach party in array array['providedBy','paidBy'] loop
      if jsonb_typeof(row->party) is distinct from 'string' or row->>party not in ('','customer','contractor','agreed')
        then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    end loop;
    if p_complete and (row->>'providedBy'<>'' or row->>'paidBy'<>'' or btrim(row->>'details')<>'')
      and (row->>'providedBy'='' or row->>'paidBy'='' or btrim(row->>'details')='')
      then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
  end loop;
end $$;

do $migration$
declare definition text; original text;
begin
  definition := replace(pg_get_functiondef('public.assert_customer_contract(jsonb,boolean)'::regprocedure),E'\r\n',E'\n');
  if position('perform public.assert_contract_site_facilities(p_body,p_complete);' in definition)=0 then
    original := '  if not p_body ? ''contractDetails'' then return; end if;';
    if position(original in definition)=0 then raise exception 'CONTRACT_SITE_FACILITIES_MIGRATION_SOURCE_MISMATCH'; end if;
    execute replace(definition,original,E'  perform public.assert_contract_site_facilities(p_body,p_complete);\n' || original);
  end if;
end $migration$;

create or replace function public.guard_contract_site_facilities() returns trigger
language plpgsql set search_path=public,pg_catalog as $$
begin
  if tg_op='UPDATE' and old.body->'contractDetails' ? 'siteFacilities'
    and not coalesce(new.body->'contractDetails' ? 'siteFacilities',false)
    then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  perform public.assert_contract_site_facilities(new.body,false);
  return new;
end $$;
drop trigger if exists independent_contract_site_facilities_guard on public.action_case_customer_contract_drafts;
create trigger independent_contract_site_facilities_guard before insert or update of body on public.action_case_customer_contract_drafts
  for each row execute function public.guard_contract_site_facilities();

revoke all on function public.assert_contract_site_facilities(jsonb,boolean),public.guard_contract_site_facilities() from public,anon,authenticated;
grant execute on function public.assert_contract_site_facilities(jsonb,boolean),public.guard_contract_site_facilities() to service_role;
notify pgrst, 'reload schema';
commit;
