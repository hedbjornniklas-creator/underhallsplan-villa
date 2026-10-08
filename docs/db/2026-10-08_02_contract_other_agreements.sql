-- Remove the separate customer-work requirement from new editable contracts.
-- Prerequisite: 2026-10-08_01_independent_customer_contract.sql.
-- Run before deploying the application. No drafts or signed snapshots are rewritten.
begin;

create or replace function public.assert_customer_contract(p_body jsonb,p_complete boolean default false)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare d jsonb; a jsonb; e jsonb; k text; s jsonb;
begin
  if not p_body ? 'contractDetails' then return; end if;
  d := p_body->'contractDetails'; a := d->'advice';
  if jsonb_typeof(d) is distinct from 'object' or d->'version' is distinct from '1'::jsonb
    or jsonb_typeof(d->'fields') is distinct from 'object' or jsonb_typeof(a) is distinct from 'object'
    or coalesce(a->>'status','') not in ('unreviewed','none','given') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  foreach k in array array['work','reason','communicatedAt','customerResponse'] loop
    if jsonb_typeof(a->k) is distinct from 'string' or length(a->>k)>6000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  end loop;
  if a->>'communicatedAt'<>'' then
    begin
      if (a->>'communicatedAt') !~ '^\d{4}-\d{2}-\d{2}$' or to_char((a->>'communicatedAt')::date,'YYYY-MM-DD') is distinct from a->>'communicatedAt' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    exception when others then raise exception 'CUSTOMER_OFFER_INVALID'; end;
  end if;
  if d ? 'otherAgreements' then
    if jsonb_typeof(d->'otherAgreements') is distinct from 'string' or length(d->>'otherAgreements')>6200
      or d#>'{fields,customerWork}' is distinct from jsonb_build_object('status','unreviewed','text','')
      then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  end if;
  if d ? 'workEnvironmentDefaultVersion'
    and d->'workEnvironmentDefaultVersion' is distinct from '"abs18-2018-06"'::jsonb
    then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  s := d#>'{assignment,standardConditions}';
  if s is not null then
    if jsonb_typeof(s) is distinct from 'object' or s->>'version' is distinct from 'abs18-2018-06'
      or jsonb_typeof(s->'text') is distinct from 'string' or length(s->>'text')>6000
      or p_body->>'contractForm' is distinct from 'abs18' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  end if;
  if p_complete then
    if a->>'status'='unreviewed' then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
    foreach k in array array['work','reason','communicatedAt','customerResponse'] loop
      if (a->>'status'='given' and btrim(a->>k)='') or (a->>'status'='none' and btrim(a->>k)<>'') then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
    end loop;
  end if;
  foreach k in array array['parties','property','documents','controls','workEnvironment','customerWork','changes','delay','inspection','insurance','completionProtection','security'] loop
    e := d->'fields'->k;
    if jsonb_typeof(e) is distinct from 'object' or coalesce(e->>'status','') not in ('unreviewed','specified','document','not_applicable')
      or jsonb_typeof(e->'text') is distinct from 'string' or length(e->>'text')>6000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if p_complete and not (k='customerWork' and d ? 'otherAgreements')
      and (e->>'status'='unreviewed' or btrim(e->>'text')='') then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
  end loop;
end $$;
revoke all on function public.assert_customer_contract(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.assert_customer_contract(jsonb,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
