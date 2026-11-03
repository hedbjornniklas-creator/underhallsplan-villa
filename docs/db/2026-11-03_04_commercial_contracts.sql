-- AB 04/ABT 06 and legal-person buyers. Install after 2026-11-03_03_hf17.sql.
-- No existing document, price, customer or signed archive is rewritten.
begin;
set local lock_timeout='10s';

create or replace function public.assert_commercial_contract(p_body jsonb)
returns void language plpgsql set search_path='' as $$
declare b jsonb:=p_body#>'{contractParties,business}'; k text;
begin
  if p_body ? 'contractForm' and (jsonb_typeof(p_body->'contractForm') is distinct from 'string'
    or p_body->>'contractForm' not in ('abs18','hf17','ab04','abt06','custom')) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if p_body->>'contractForm'<>'abs18' and p_body#>'{contractDetails,assignment,standardConditions}' is not null
    then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if b is null or b='null'::jsonb then return; end if;
  if jsonb_typeof(b) is distinct from 'object' or jsonb_typeof(p_body#>'{contractParties,customers}') is distinct from 'array'
    then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if jsonb_array_length(p_body#>'{contractParties,customers}')<>1
    or p_body#>>'{contractParties,customers,0,personalNumber}' is distinct from '' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  foreach k in array array['organizationNumber','contactName','signatoryName'] loop
    if jsonb_typeof(b->k) is distinct from 'string' or length(b->>k)>(case when k='organizationNumber' then 20 else 250 end)
      or b->>k ~ '[[:cntrl:]]' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  end loop;
end $$;

create or replace function public.assert_standard_contract_form(p_body jsonb)
returns void language plpgsql set search_path='' as $$
begin perform public.assert_commercial_contract(p_body); end $$;

create or replace function public.guard_standard_contract_form()
returns trigger language plpgsql set search_path='' as $$
declare body jsonb; previous_body jsonb;
begin
  if tg_table_name in ('action_case_customer_offers','action_case_contract_signing_documents') then
    body:=new.snapshot;
    if tg_op='UPDATE' then previous_body:=old.snapshot; end if;
  else
    body:=new.body;
    if tg_op='UPDATE' then previous_body:=old.body; end if;
  end if;
  perform public.assert_standard_contract_form(body);
  -- An old client must not silently discard business identity. Explicit null clears it.
  if jsonb_typeof(previous_body#>'{contractParties,business}')='object'
    and not coalesce((body->'contractParties') ? 'business',false) then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  return new;
end $$;

revoke all on function public.assert_commercial_contract(jsonb),public.assert_standard_contract_form(jsonb),public.guard_standard_contract_form() from public,anon,authenticated;
grant execute on function public.assert_commercial_contract(jsonb),public.assert_standard_contract_form(jsonb),public.guard_standard_contract_form() to service_role;
notify pgrst,'reload schema';
commit;
