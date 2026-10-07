-- Structured assignment and uploaded contract documents. No historical backfill.
begin;
create or replace function public.assert_contract_assignment(p_body jsonb, p_complete boolean default false)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare a jsonb := p_body->'contractDetails'->'assignment'; d jsonb; k text; seen text[] := '{}'; complete boolean := true;
begin
  if a is null then return; end if;
  if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(a->'documents') is distinct from 'array'
    or jsonb_array_length(a->'documents') > 30 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  foreach k in array array['additionalScope','exclusions','documentNotes'] loop
    if jsonb_typeof(a->k) is distinct from 'string' or length(a->>k) > (case when k='additionalScope' then 12000 else 6000 end)
      then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  end loop;
  for d in select value from jsonb_array_elements(a->'documents') loop
    if jsonb_typeof(d) is distinct from 'object' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    foreach k in array array['fileId','type','name','date'] loop
      if jsonb_typeof(d->k) is distinct from 'string' or length(d->>k) > (case k when 'fileId' then 36 when 'type' then 100 when 'name' then 250 else 10 end)
        then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    end loop;
    if (d->>'fileId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (d->>'fileId')=any(seen) or not coalesce(p_body->'attachmentIds' @> jsonb_build_array(d->>'fileId'), false)
      then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    seen := array_append(seen, d->>'fileId');
    if d->>'date' <> '' then
      begin
        if (d->>'date') !~ '^\d{4}-\d{2}-\d{2}$' or to_char((d->>'date')::date,'YYYY-MM-DD') is distinct from d->>'date'
          then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      exception when others then raise exception 'CUSTOMER_OFFER_INVALID'; end;
    end if;
    if btrim(d->>'type')='' or btrim(d->>'name')='' or d->>'date'='' then complete := false; end if;
  end loop;
  if p_body#>'{contractDetails,fields,documents}' is distinct from jsonb_build_object('status', case when complete then 'specified' else 'unreviewed' end,
    'text', 'Avtalshandlingar anges i uppdragets handlingsförteckning.') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if p_complete and (not complete or (coalesce(p_body->>'termsAttachmentId','')<>'' and not (p_body->>'termsAttachmentId')=any(seen)))
    then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
end $$;
revoke all on function public.assert_contract_assignment(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.assert_contract_assignment(jsonb,boolean) to service_role;

create or replace function public.guard_contract_assignment() returns trigger
language plpgsql set search_path=public,pg_catalog as $$
declare b jsonb; d jsonb;
begin
  if tg_table_name='action_case_customer_offer_drafts' then
    if tg_op='UPDATE' and old.body->'contractDetails' ? 'assignment' and not (new.body->'contractDetails' ? 'assignment')
      then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    b := new.body;
    perform public.assert_contract_assignment(b, false);
  else
    b := new.snapshot;
    perform public.assert_contract_assignment(b, true);
  end if;
  if not (b->'contractDetails' ? 'assignment') then return new; end if;
  for d in select value from jsonb_array_elements(b#>'{contractDetails,assignment,documents}') loop
    if not exists(select 1 from public.action_case_attachments f where f.id=(d->>'fileId')::uuid
      and f.org_id=new.org_id and f.action_case_id=new.action_case_id
      and not exists(select 1 from public.action_case_work_quotes q where q.document_id=f.id)
      and not exists(select 1 from public.action_case_quote_requests q where q.response_document_id=f.id))
      then raise exception 'CUSTOMER_OFFER_FILES'; end if;
    if tg_table_name='action_case_customer_offers' then
      if not exists(select 1 from jsonb_array_elements(new.files) f where f->>'id'=d->>'fileId')
        then raise exception 'CUSTOMER_OFFER_FILES'; end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.guard_contract_assignment() from public,anon,authenticated;
drop trigger if exists customer_offer_assignment_draft on public.action_case_customer_offer_drafts;
create trigger customer_offer_assignment_draft before insert or update of body on public.action_case_customer_offer_drafts
  for each row execute function public.guard_contract_assignment();
drop trigger if exists customer_offer_assignment_publication on public.action_case_customer_offers;
create trigger customer_offer_assignment_publication before insert on public.action_case_customer_offers
  for each row execute function public.guard_contract_assignment();
notify pgrst, 'reload schema';
commit;
