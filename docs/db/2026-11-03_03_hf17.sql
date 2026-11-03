-- HF17 is a new JSON document form, not a rewrite of any existing agreement.
-- Install before the HF17 application release. No stored documents are changed.
begin;
set local lock_timeout='10s';

create or replace function public.assert_standard_contract_form(p_body jsonb)
returns void language plpgsql set search_path='' as $$
begin
  if not p_body ? 'contractForm' then return; end if;
  if jsonb_typeof(p_body->'contractForm') is distinct from 'string' or p_body->>'contractForm' not in ('abs18','hf17','custom')
    then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if p_body->>'contractForm'='hf17' and p_body#>'{contractDetails,assignment,standardConditions}' is not null
    then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
end $$;

create or replace function public.assert_contract_assignment(p_body jsonb,p_complete boolean default false)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare a jsonb:=p_body->'contractDetails'->'assignment'; d jsonb; k text; seen text[]:='{}'; complete boolean:=true; official_edition boolean;
begin
  if a is null then return; end if;
  if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(a->'documents') is distinct from 'array'
    or jsonb_array_length(a->'documents')>30 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  foreach k in array array['additionalScope','exclusions','documentNotes'] loop
    if jsonb_typeof(a->k) is distinct from 'string' or length(a->>k)>(case when k='additionalScope' then 12000 else 6000 end)
      then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  end loop;
  for d in select value from jsonb_array_elements(a->'documents') loop
    if jsonb_typeof(d) is distinct from 'object' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    foreach k in array array['fileId','type','name','date'] loop
      if jsonb_typeof(d->k) is distinct from 'string' or length(d->>k)>(case k when 'fileId' then 36 when 'type' then 100 when 'name' then 250 else 10 end)
        then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    end loop;
    if d->>'fileId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or d->>'fileId'=any(seen) or not coalesce(p_body->'attachmentIds' @> jsonb_build_array(d->>'fileId'),false)
      then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    seen:=array_append(seen,d->>'fileId');
    if d->>'date'<>'' then
      begin
        if d->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or to_char((d->>'date')::date,'YYYY-MM-DD') is distinct from d->>'date'
          then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      exception when others then raise exception 'CUSTOMER_OFFER_INVALID'; end;
    end if;
    -- The official original has an edition year, not a published calendar day.
    official_edition:=p_body->>'contractForm'='hf17' and d->>'fileId'=p_body->>'termsAttachmentId'
      and d->>'type'='Avtalsformulär och allmänna bestämmelser, HF17'
      and d->>'name'='Hantverkarformuläret 17 med allmänna bestämmelser (2017)';
    if btrim(d->>'type')='' or btrim(d->>'name')='' or (d->>'date'='' and not coalesce(official_edition,false)) then complete:=false; end if;
  end loop;
  if p_body#>'{contractDetails,fields,documents}' is distinct from jsonb_build_object('status',case when complete then 'specified' else 'unreviewed' end,
    'text','Avtalshandlingar anges i uppdragets handlingsförteckning.') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if p_complete and (not complete or (coalesce(p_body->>'termsAttachmentId','')<>'' and not p_body->>'termsAttachmentId'=any(seen)))
    then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
end $$;

create or replace function public.guard_standard_contract_form()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name in ('action_case_customer_offers','action_case_contract_signing_documents') then
    perform public.assert_standard_contract_form(new.snapshot);
  else perform public.assert_standard_contract_form(new.body); end if;
  return new;
end $$;

drop trigger if exists standard_contract_form on public.action_case_customer_offer_drafts;
create trigger standard_contract_form before insert or update of body on public.action_case_customer_offer_drafts for each row execute function public.guard_standard_contract_form();
drop trigger if exists standard_contract_form on public.action_case_customer_contract_drafts;
create trigger standard_contract_form before insert or update of body on public.action_case_customer_contract_drafts for each row execute function public.guard_standard_contract_form();
drop trigger if exists standard_contract_form on public.action_case_customer_offers;
create trigger standard_contract_form before insert or update of snapshot on public.action_case_customer_offers for each row execute function public.guard_standard_contract_form();
drop trigger if exists standard_contract_form on public.action_case_contract_signing_documents;
create trigger standard_contract_form before insert or update of snapshot on public.action_case_contract_signing_documents for each row execute function public.guard_standard_contract_form();
revoke all on function public.assert_standard_contract_form(jsonb),public.guard_standard_contract_form(),public.assert_contract_assignment(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.assert_standard_contract_form(jsonb),public.guard_standard_contract_form(),public.assert_contract_assignment(jsonb,boolean) to service_role;
notify pgrst,'reload schema';
commit;
