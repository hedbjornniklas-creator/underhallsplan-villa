-- Original attachments only. No historic PDF generation or backfill.
-- Activate OB_ASSIGNMENT_PDF_ARCHIVE_ENABLED only after applying this migration.
begin;

create table if not exists public.assignment_confirmation_snapshots (
  assignment_id uuid primary key references public.assignments(id) on delete restrict,
  org_id uuid not null references public.organizations(id) on delete restrict,
  acceptance_id uuid not null unique references public.assignment_acceptances(id) on delete restrict,
  accepted_at timestamptz not null,
  schema_version text not null check (schema_version = 'ob-confirmation-v1'),
  snapshot_payload jsonb not null check (jsonb_typeof(snapshot_payload) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists assignment_confirmation_snapshots_org_idx on public.assignment_confirmation_snapshots(org_id);

create or replace function public.capture_ob_confirmation_snapshot()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  a public.assignments%rowtype;
  source jsonb := new.payload -> 'ob_document_source';
  addons jsonb;
begin
  -- Only new acceptances explicitly issued by the snapshot-aware server opt in.
  if source is null then return new; end if;
  if current_setting('role', true) not in ('service_role', 'postgres', 'none') then
    raise exception 'OB confirmation snapshots require the server';
  end if;
  select * into strict a from public.assignments where id = new.assignment_id and org_id = new.org_id;
  if a.assignment_type <> 'OB' or source ->> 'schemaVersion' is distinct from 'ob-confirmation-v1'
    or source #>> '{terms,version}' is distinct from new.terms_version
    or source #>> '{terms,documentHash}' is distinct from new.terms_document_hash
    or encode(sha256(convert_to(source #>> '{terms,text}', 'UTF8')), 'hex') is distinct from new.terms_document_hash
    or jsonb_typeof(source -> 'inspector') is distinct from 'object'
    or a.accepted_at is distinct from new.accepted_at then
    raise exception 'Invalid OB confirmation snapshot';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', addon_name_snapshot, 'priceAmount', price_amount_snapshot, 'currency', currency_snapshot
  ) order by addon_name_snapshot, id), '[]'::jsonb) into addons
  from public.assignment_addon_orders where assignment_id = new.assignment_id and org_id = new.org_id;
  insert into public.assignment_confirmation_snapshots(assignment_id, org_id, acceptance_id, accepted_at, schema_version, snapshot_payload)
  values (new.assignment_id, new.org_id, new.id, new.accepted_at, 'ob-confirmation-v1', jsonb_build_object(
    'assignment', to_jsonb(a) - 'notes_internal' - 'personal_identity_number',
    'issuerName', source -> 'issuerName', 'inspector', source -> 'inspector',
    'terms', source -> 'terms', 'addonOrders', addons,
    'acceptancePayload', new.payload - 'ob_document_source'
  ));
  return new;
end;
$$;
drop trigger if exists capture_ob_confirmation_snapshot on public.assignment_acceptances;
create trigger capture_ob_confirmation_snapshot after insert on public.assignment_acceptances
for each row execute function public.capture_ob_confirmation_snapshot();

create or replace function public.guard_ob_confirmation_snapshot()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'Archived assignment snapshots are immutable';
end;
$$;
drop trigger if exists ob_confirmation_snapshot_guard on public.assignment_confirmation_snapshots;
create trigger ob_confirmation_snapshot_guard before update or delete on public.assignment_confirmation_snapshots
for each row execute function public.guard_ob_confirmation_snapshot();
drop trigger if exists ob_confirmation_snapshot_truncate_guard on public.assignment_confirmation_snapshots;
create trigger ob_confirmation_snapshot_truncate_guard before truncate on public.assignment_confirmation_snapshots
for each statement execute function public.guard_ob_confirmation_snapshot();
alter table public.assignment_confirmation_snapshots enable row level security;
revoke all on public.assignment_confirmation_snapshots from public, anon, authenticated, service_role;
grant select on public.assignment_confirmation_snapshots to service_role;
revoke all on function public.capture_ob_confirmation_snapshot(), public.guard_ob_confirmation_snapshot()
  from public, anon, authenticated, service_role;

create table if not exists public.assignment_confirmation_pdfs (
  assignment_id uuid primary key references public.assignments(id) on delete restrict,
  org_id uuid not null references public.organizations(id) on delete restrict,
  acceptance_id uuid not null unique references public.assignment_acceptances(id) on delete restrict,
  accepted_at timestamptz not null,
  filename text not null check (filename ~ '^[A-Za-z0-9._-]+\.pdf$'),
  pdf_base64 text not null,
  byte_length integer generated always as (octet_length(decode(pdf_base64, 'base64'))) stored,
  pdf_sha256 text generated always as (encode(sha256(decode(pdf_base64, 'base64')), 'hex')) stored,
  created_at timestamptz not null default now(),
  check (byte_length between 5 and 10485760),
  check (substring(decode(pdf_base64, 'base64'), 1, 5) = convert_to('%PDF-', 'UTF8'))
);
create index if not exists assignment_confirmation_pdfs_org_idx on public.assignment_confirmation_pdfs(org_id);

create or replace function public.guard_assignment_confirmation_pdf()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Archived assignment documents are immutable';
  end if;
  if not exists (
    select 1 from public.assignment_acceptances ac
    join public.assignments a on a.id = ac.assignment_id and a.org_id = ac.org_id
    where ac.id = new.acceptance_id and ac.org_id = new.org_id
      and ac.assignment_id = new.assignment_id and ac.accepted_at = new.accepted_at
      and a.assignment_type = 'OB'
  ) then
    raise exception 'Assignment PDF acceptance mismatch';
  end if;
  return new;
end;
$$;
drop trigger if exists assignment_confirmation_pdf_guard on public.assignment_confirmation_pdfs;
create trigger assignment_confirmation_pdf_guard before insert or update or delete on public.assignment_confirmation_pdfs
for each row execute function public.guard_assignment_confirmation_pdf();
drop trigger if exists assignment_confirmation_pdf_truncate_guard on public.assignment_confirmation_pdfs;
create trigger assignment_confirmation_pdf_truncate_guard before truncate on public.assignment_confirmation_pdfs
for each statement execute function public.guard_assignment_confirmation_pdf();

alter table public.assignment_confirmation_pdfs enable row level security;
revoke all on public.assignment_confirmation_pdfs from public, anon, authenticated;
revoke all on public.assignment_confirmation_pdfs from service_role;
grant select, insert on public.assignment_confirmation_pdfs to service_role;
revoke all on function public.guard_assignment_confirmation_pdf() from public, anon, authenticated;
grant execute on function public.guard_assignment_confirmation_pdf() to service_role;

comment on table public.assignment_confirmation_pdfs is
  'Immutable original acceptance email attachments. Server-only, organization-scoped reads; never regenerated on download.';
commit;
