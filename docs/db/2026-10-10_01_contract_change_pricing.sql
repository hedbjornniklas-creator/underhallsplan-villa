-- Gizmo: independent hourly rates, cost markups and a versioned price annex for changes.
-- Prerequisites: 2026-10-08_01 through _04. Run before deploying the application.
-- No existing draft contents, published snapshots or signed agreements are rewritten.
begin;

create or replace function public.assert_contract_changes(p_body jsonb,p_complete boolean default false)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare
  p jsonb := p_body#>'{contractDetails,changesPricing}'; row jsonb; a jsonb; key text; val numeric;
  ids text[] := '{}'; kinds text[] := '{}'; complete boolean := true;
begin
  if p is null then return; end if;
  if jsonb_typeof(p) is distinct from 'object' or p->'version' is distinct from '1'::jsonb
    or coalesce(p->>'mode','') not in ('fields','attachment') or jsonb_typeof(p->'rates') is distinct from 'array'
    or jsonb_typeof(p->'markups') is distinct from 'object' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if jsonb_array_length(p->'rates')>50 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  foreach key in array array['annexRevision','standardText','notes'] loop
    if jsonb_typeof(p->key) is distinct from 'string' or length(p->>key)>(case key when 'annexRevision' then 100 when 'notes' then 6200 else 6000 end)
      then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  end loop;
  complete := btrim(p->>'standardText')<>'';
  for row in select value from jsonb_array_elements(p->'rates') loop
    if jsonb_typeof(row) is distinct from 'object' or jsonb_typeof(row->'id') is distinct from 'string'
      or coalesce(row->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (row->>'id')=any(ids) or coalesce(row->>'kind','') not in ('ordinary','management','other')
      or (row->>'kind'<>'other' and (row->>'kind')=any(kinds))
      or jsonb_typeof(row->'title') is distinct from 'string' or length(row->>'title')>250
      or not row ? 'hourlyOre' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    ids := array_append(ids,row->>'id'); kinds := array_append(kinds,row->>'kind');
    if row->'hourlyOre'<>'null'::jsonb then
      if jsonb_typeof(row->'hourlyOre') is distinct from 'number' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      val := (row->>'hourlyOre')::numeric;
      if val<>trunc(val) or val<0 or val>100000000000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    end if;
    if p->>'mode'='fields' and (btrim(row->>'title')='' or row->'hourlyOre'='null'::jsonb or (row->>'hourlyOre')::numeric<=0) then complete := false; end if;
  end loop;
  if p->>'mode'='fields' and not 'ordinary'=any(kinds) then complete := false; end if;
  foreach key in array array['materials','subcontractors','equipment','other'] loop
    if not (p->'markups') ? key then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if p->'markups'->key<>'null'::jsonb then
      if jsonb_typeof(p->'markups'->key) is distinct from 'number' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      val := (p->'markups'->>key)::numeric;
      if val<0 or val>1000 or val*100<>trunc(val*100) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    elsif p->>'mode'='fields' then complete := false; end if;
  end loop;
  if not p ? 'annex' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  a := p->'annex';
  if a<>'null'::jsonb then
    if jsonb_typeof(a) is distinct from 'object' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    foreach key in array array['fileId','type','name','date'] loop
      if jsonb_typeof(a->key) is distinct from 'string' or length(a->>key)>(case key when 'fileId' then 36 when 'type' then 100 when 'name' then 250 else 10 end)
        then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    end loop;
    if (a->>'fileId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if a->>'date'<>'' then
      begin
        if (a->>'date') !~ '^\d{4}-\d{2}-\d{2}$' or to_char((a->>'date')::date,'YYYY-MM-DD') is distinct from a->>'date'
          then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      exception when others then raise exception 'CUSTOMER_OFFER_INVALID'; end;
    end if;
    if p->>'mode'='attachment' then
      if jsonb_typeof(p_body#>'{contractDetails,assignment,documents}') is distinct from 'array'
        or not exists(select 1 from jsonb_array_elements(p_body#>'{contractDetails,assignment,documents}') doc where doc=a)
        or not coalesce(p_body->'attachmentIds' @> jsonb_build_array(a->>'fileId'),false)
        or p_body->>'termsAttachmentId'=a->>'fileId' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      if btrim(a->>'name')='' or btrim(a->>'type')='' or a->>'date'='' then complete := false; end if;
    end if;
  elsif p->>'mode'='attachment' then complete := false; end if;
  if p->>'mode'='attachment' and btrim(p->>'annexRevision')='' then complete := false; end if;
  if p_body#>'{contractDetails,fields,changes}' is distinct from jsonb_build_object('status',case when complete then 'specified' else 'unreviewed' end,
    'text','Prisgrunder för ÄTA anges i avtalets ÄTA-sektion.') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if p_complete and not complete then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
end $$;

do $migration$
declare definition text; original text;
begin
  definition := replace(pg_get_functiondef('public.assert_customer_contract(jsonb,boolean)'::regprocedure),E'\r\n',E'\n');
  if position('perform public.assert_contract_changes(p_body,p_complete);' in definition)=0 then
    original := E'begin\n  if not p_body ? ''contractDetails'' then return; end if;';
    if position(original in definition)=0 then raise exception 'CONTRACT_CHANGES_MIGRATION_SOURCE_MISMATCH'; end if;
    execute replace(definition,original,E'begin\n  perform public.assert_contract_changes(p_body,p_complete);\n  if not p_body ? ''contractDetails'' then return; end if;');
  end if;
end $migration$;

create or replace function public.guard_contract_change_pricing() returns trigger
language plpgsql set search_path=public,pg_catalog as $$
declare a jsonb;
begin
  if tg_op='UPDATE' and old.body->'contractDetails' ? 'changesPricing' and not coalesce(new.body->'contractDetails' ? 'changesPricing',false)
    then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  a := new.body#>'{contractDetails,changesPricing,annex}';
  if new.body#>>'{contractDetails,changesPricing,mode}'='attachment' and a<>'null'::jsonb and not exists(
    select 1 from public.action_case_attachments f where f.id=(a->>'fileId')::uuid
      and f.org_id=new.org_id and f.action_case_id=new.action_case_id and f.content_type='application/pdf'
  ) then raise exception 'CUSTOMER_OFFER_FILES'; end if;
  return new;
end $$;
drop trigger if exists independent_contract_change_pricing_guard on public.action_case_customer_contract_drafts;
create trigger independent_contract_change_pricing_guard before insert or update of body on public.action_case_customer_contract_drafts
  for each row execute function public.guard_contract_change_pricing();

revoke all on function public.assert_contract_changes(jsonb,boolean),public.guard_contract_change_pricing() from public,anon,authenticated;
grant execute on function public.assert_contract_changes(jsonb,boolean),public.guard_contract_change_pricing() to service_role;
notify pgrst, 'reload schema';
commit;
