-- Uppgifter: manually registered supplier invoices and internal project cost allocation.
-- Requires organizations, profiles, action_cases and action_case_items.
-- This migration does not enable Fortnox import or expose invoice files to customers.
begin;

create table if not exists public.supplier_invoices (
  id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete restrict,
  revision integer not null check (revision > 0),
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  source text not null default 'manual' check (source in ('manual','fortnox')),
  external_id text,
  supplier_key text generated always as (
    case when regexp_replace(body->>'supplierOrgNumber','[^[:alnum:]]','','g') <> ''
      then lower(regexp_replace(body->>'supplierOrgNumber','[^[:alnum:]]','','g'))
      else lower(regexp_replace(body->>'supplierName','\s+','','g')) end
  ) stored,
  invoice_number_key text generated always as (lower(btrim(body->>'invoiceNumber'))) stored,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id,supplier_key,invoice_number_key),
  unique(org_id,source,external_id)
);
create index if not exists supplier_invoices_org_updated_idx on public.supplier_invoices(org_id,updated_at desc,id);

create table if not exists public.supplier_invoice_attachments (
  id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete restrict,
  invoice_id uuid not null references public.supplier_invoices(id) on delete restrict,
  file_name text not null,
  content_type text not null check (content_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 4194304),
  file_path text not null unique,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists supplier_invoice_attachments_org_invoice_idx on public.supplier_invoice_attachments(org_id,invoice_id);

create table if not exists public.supplier_invoice_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  invoice_id uuid not null references public.supplier_invoices(id) on delete restrict,
  event_type text not null check (event_type in ('created','updated','attachment_added')),
  revision integer not null,
  snapshot jsonb not null,
  performed_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists supplier_invoice_events_invoice_created_idx on public.supplier_invoice_events(org_id,invoice_id,created_at);

alter table public.supplier_invoices enable row level security;
alter table public.supplier_invoice_attachments enable row level security;
alter table public.supplier_invoice_events enable row level security;
revoke all on public.supplier_invoices, public.supplier_invoice_attachments, public.supplier_invoice_events from public, anon, authenticated;
grant all on public.supplier_invoices, public.supplier_invoice_attachments, public.supplier_invoice_events to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('supplier-invoice-files','supplier-invoice-files',false,4194304,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- A private bucket alone is insufficient if an older permissive storage policy
-- grants broad authenticated access. This restriction only affects this bucket.
do $$ begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists supplier_invoice_files_internal_only on storage.objects';
    execute 'create policy supplier_invoice_files_internal_only on storage.objects as restrictive for all to anon, authenticated using (bucket_id <> ''supplier-invoice-files'') with check (bucket_id <> ''supplier-invoice-files'')';
  end if;
end $$;

create or replace function public.write_supplier_invoice(
  p_org_id uuid,p_user_id uuid,p_invoice_id uuid,p_expected_revision integer,p_body jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  current_row public.supplier_invoices%rowtype;
  allocation jsonb;
  net_amount bigint;
  vat_amount bigint;
  allocated_amount bigint := 0;
  reference_id uuid;
  new_revision integer;
  field_name text;
  parsed_date date;
  event_kind text;
  supplier_name_key text;
  supplier_org_key text;
  number_key text;
begin
  if p_org_id is null or p_user_id is null or p_invoice_id is null or p_expected_revision is null or p_expected_revision < 0
    or p_body is null or jsonb_typeof(p_body) <> 'object' then raise exception 'INVOICE_INVALID'; end if;

  -- Cross-invoice references and ambiguous supplier identities must be checked
  -- against a stable ledger. Serialize this low-volume manual workflow per org.
  perform pg_advisory_xact_lock(hashtextextended('supplier-invoice-org:' || p_org_id::text,0));

  -- The manual endpoint owns this exact data contract. Provider identity is stored separately.
  if (p_body - array['supplierName','supplierOrgNumber','invoiceNumber','invoiceDate','dueDate','documentKind',
    'creditReferenceInvoiceId','currency','netAmountOre','vatAmountOre','approvalStatus','paymentStatus','paidOn','notes','sourceText','allocations']) <> '{}'::jsonb
    then raise exception 'INVOICE_INVALID'; end if;
  foreach field_name in array array['supplierName','supplierOrgNumber','invoiceNumber','invoiceDate','dueDate','documentKind','currency','approvalStatus','paymentStatus','notes','sourceText'] loop
    if jsonb_typeof(p_body->field_name) is distinct from 'string' then raise exception 'INVOICE_INVALID'; end if;
  end loop;
  if length(btrim(p_body->>'supplierName')) not between 1 and 200
    or length(p_body->>'supplierOrgNumber') > 40 or length(btrim(p_body->>'invoiceNumber')) not between 1 and 100
    or length(p_body->>'notes') > 5000 or length(p_body->>'sourceText') > 50000
    or (p_body->>'currency') <> 'SEK'
    or (p_body->>'documentKind') not in ('invoice','credit')
    or (p_body->>'approvalStatus') not in ('registered','approved','disputed','void')
    or (p_body->>'paymentStatus') not in ('unpaid','paid') then raise exception 'INVOICE_INVALID'; end if;

  foreach field_name in array array['invoiceDate','dueDate'] loop
    if (p_body->>field_name) !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVOICE_INVALID'; end if;
    parsed_date := (p_body->>field_name)::date;
    if parsed_date < date '1900-01-01' or to_char(parsed_date,'YYYY-MM-DD') <> p_body->>field_name then raise exception 'INVOICE_INVALID'; end if;
  end loop;
  if p_body->>'paymentStatus' = 'paid' then
    if jsonb_typeof(p_body->'paidOn') is distinct from 'string' or (p_body->>'paidOn') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVOICE_INVALID'; end if;
    parsed_date := (p_body->>'paidOn')::date;
    if parsed_date < date '1900-01-01' or to_char(parsed_date,'YYYY-MM-DD') <> p_body->>'paidOn' then raise exception 'INVOICE_INVALID'; end if;
  elsif p_body->'paidOn' is distinct from 'null'::jsonb then raise exception 'INVOICE_INVALID'; end if;

  if jsonb_typeof(p_body->'netAmountOre') is distinct from 'number' or jsonb_typeof(p_body->'vatAmountOre') is distinct from 'number'
    or (p_body->>'netAmountOre') !~ '^\d+$' or (p_body->>'vatAmountOre') !~ '^\d+$' then raise exception 'INVOICE_INVALID'; end if;
  net_amount := (p_body->>'netAmountOre')::bigint;
  vat_amount := (p_body->>'vatAmountOre')::bigint;
  if net_amount not between 1 and 99999999999 or vat_amount not between 0 and 99999999999 then raise exception 'INVOICE_INVALID'; end if;

  if p_body->'creditReferenceInvoiceId' is distinct from 'null'::jsonb then
    if jsonb_typeof(p_body->'creditReferenceInvoiceId') is distinct from 'string' or p_body->>'documentKind' <> 'credit' then raise exception 'INVOICE_INVALID'; end if;
    reference_id := (p_body->>'creditReferenceInvoiceId')::uuid;
    if reference_id = p_invoice_id or not exists(select 1 from public.supplier_invoices
      where id=reference_id and org_id=p_org_id
        and (p_body->>'approvalStatus'='void' or (body->>'documentKind'='invoice' and body->>'approvalStatus'<>'void')))
      then raise exception 'INVOICE_REFERENCE_INVALID'; end if;
  end if;

  if jsonb_typeof(p_body->'allocations') is distinct from 'array' or jsonb_array_length(p_body->'allocations') > 100 then raise exception 'INVOICE_ALLOCATION_INVALID'; end if;
  for allocation in select value from jsonb_array_elements(p_body->'allocations') loop
    if jsonb_typeof(allocation) <> 'object'
      or (allocation - array['caseId','itemId','category','description','amountOre']) <> '{}'::jsonb
      or jsonb_typeof(allocation->'caseId') is distinct from 'string'
      or jsonb_typeof(allocation->'category') is distinct from 'string'
      or jsonb_typeof(allocation->'description') is distinct from 'string'
      or length(allocation->>'description') > 500
      or allocation->>'category' not in ('material','subcontractor','waste','transport','other')
      or jsonb_typeof(allocation->'amountOre') is distinct from 'number'
      or (allocation->>'amountOre') !~ '^\d+$' then raise exception 'INVOICE_ALLOCATION_INVALID'; end if;
    if (allocation->>'amountOre')::bigint not between 1 and net_amount then raise exception 'INVOICE_ALLOCATION_INVALID'; end if;
    if not exists(select 1 from public.action_cases where id=(allocation->>'caseId')::uuid and org_id=p_org_id)
      then raise exception 'INVOICE_ALLOCATION_INVALID'; end if;
    if allocation->'itemId' is distinct from 'null'::jsonb then
      if jsonb_typeof(allocation->'itemId') is distinct from 'string' or not exists(select 1 from public.action_case_items
        where id=(allocation->>'itemId')::uuid and action_case_id=(allocation->>'caseId')::uuid and org_id=p_org_id)
        then raise exception 'INVOICE_ALLOCATION_INVALID'; end if;
    end if;
    allocated_amount := allocated_amount + (allocation->>'amountOre')::bigint;
  end loop;
  if allocated_amount > net_amount then raise exception 'INVOICE_ALLOCATION_INVALID'; end if;

  -- A supplier entered without its registration number is still the same
  -- potential invoice when the number is added later. Complete, different
  -- registration numbers may legitimately share a trading name.
  supplier_name_key := lower(regexp_replace(p_body->>'supplierName','\s+','','g'));
  supplier_org_key := lower(regexp_replace(p_body->>'supplierOrgNumber','[^[:alnum:]]','','g'));
  number_key := lower(btrim(p_body->>'invoiceNumber'));
  if exists(select 1 from public.supplier_invoices other
    where other.org_id=p_org_id and other.id<>p_invoice_id and other.invoice_number_key=number_key
      and lower(regexp_replace(other.body->>'supplierName','\s+','','g'))=supplier_name_key
      and (supplier_org_key='' or regexp_replace(other.body->>'supplierOrgNumber','[^[:alnum:]]','','g')=''))
    then raise exception 'INVOICE_DUPLICATE'; end if;

  -- Removing an original from the totals must not leave its live credits behind.
  -- Void the credits first; their historic references remain editable afterward.
  if (p_body->>'approvalStatus'='void' or p_body->>'documentKind'<>'invoice')
    and exists(select 1 from public.supplier_invoices credit
      where credit.org_id=p_org_id and credit.id<>p_invoice_id
        and credit.body->>'documentKind'='credit' and credit.body->>'approvalStatus'<>'void'
        and lower(credit.body->>'creditReferenceInvoiceId')=p_invoice_id::text)
    then raise exception 'INVOICE_REFERENCE_IN_USE'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_invoice_id::text,0));
  select * into current_row from public.supplier_invoices where id=p_invoice_id for update;
  if found then
    if current_row.org_id <> p_org_id then raise exception 'INVOICE_NOT_FOUND'; end if;
    if current_row.source <> 'manual' then raise exception 'INVOICE_EXTERNAL_READ_ONLY'; end if;
    -- An exact replay after a lost response succeeds without another revision/event.
    if current_row.revision=p_expected_revision+1 and current_row.body=p_body then
      return jsonb_build_object('id',current_row.id,'revision',current_row.revision);
    end if;
    if current_row.revision <> p_expected_revision then raise exception 'INVOICE_STALE'; end if;
    new_revision := current_row.revision + 1;
    update public.supplier_invoices set body=p_body,revision=new_revision,updated_by=p_user_id,updated_at=clock_timestamp()
      where id=p_invoice_id and org_id=p_org_id;
    event_kind := 'updated';
  else
    if p_expected_revision <> 0 then raise exception 'INVOICE_NOT_FOUND'; end if;
    new_revision := 1;
    insert into public.supplier_invoices(id,org_id,revision,body,source,created_by,updated_by)
      values(p_invoice_id,p_org_id,new_revision,p_body,'manual',p_user_id,p_user_id);
    event_kind := 'created';
  end if;
  insert into public.supplier_invoice_events(org_id,invoice_id,event_type,revision,snapshot,performed_by)
    values(p_org_id,p_invoice_id,event_kind,new_revision,p_body,p_user_id);
  return jsonb_build_object('id',p_invoice_id,'revision',new_revision);
exception
  when unique_violation then raise exception 'INVOICE_DUPLICATE';
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'INVOICE_INVALID';
end $$;

create or replace function public.add_supplier_invoice_attachment(
  p_org_id uuid,p_user_id uuid,p_invoice_id uuid,p_attachment_id uuid,
  p_file_name text,p_content_type text,p_file_size_bytes bigint,p_file_path text
) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare current_revision integer;
begin
  select revision into current_revision from public.supplier_invoices where id=p_invoice_id and org_id=p_org_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if p_attachment_id is null or p_user_id is null or p_file_name is null or length(btrim(p_file_name)) not between 1 and 180
    or p_content_type is null or p_content_type not in ('application/pdf','image/jpeg','image/png','image/webp')
    or p_file_size_bytes is null or p_file_size_bytes not between 1 and 4194304
    or p_file_path is null or p_file_path <> p_org_id::text || '/' || p_invoice_id::text || '/' || p_attachment_id::text
    then raise exception 'INVOICE_FILE_INVALID'; end if;
  if (select count(*) from public.supplier_invoice_attachments where invoice_id=p_invoice_id) >= 20
    then raise exception 'INVOICE_FILE_LIMIT'; end if;
  insert into public.supplier_invoice_attachments(id,org_id,invoice_id,file_name,content_type,file_size_bytes,file_path,created_by)
    values(p_attachment_id,p_org_id,p_invoice_id,p_file_name,p_content_type,p_file_size_bytes,p_file_path,p_user_id);
  insert into public.supplier_invoice_events(org_id,invoice_id,event_type,revision,snapshot,performed_by)
    values(p_org_id,p_invoice_id,'attachment_added',current_revision,jsonb_build_object('id',p_attachment_id,'fileName',p_file_name),p_user_id);
  return jsonb_build_object('id',p_attachment_id);
end $$;

revoke all on function public.write_supplier_invoice(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
revoke all on function public.add_supplier_invoice_attachment(uuid,uuid,uuid,uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.write_supplier_invoice(uuid,uuid,uuid,integer,jsonb) to service_role;
grant execute on function public.add_supplier_invoice_attachment(uuid,uuid,uuid,uuid,text,text,bigint,text) to service_role;
commit;
