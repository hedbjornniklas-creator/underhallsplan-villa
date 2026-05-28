-- Technical investigations documents
-- Date: 2026-05-28
-- Scope:
-- 1) Add document storage for TU investigations
-- 2) Keep documents separate from image bank/appendix images

create extension if not exists pgcrypto;

create table if not exists public.technical_investigation_documents (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  storage_bucket text not null default 'tu-investigation-documents',
  file_path text not null,
  file_name text,
  title text,
  content_type text,
  file_size_bytes bigint,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint technical_investigation_documents_file_path_check check (btrim(file_path) <> '')
);

create index if not exists technical_investigation_documents_inspection_idx
  on public.technical_investigation_documents (inspection_id, created_at desc);

create index if not exists technical_investigation_documents_org_idx
  on public.technical_investigation_documents (org_id, created_at desc);

drop trigger if exists trg_technical_investigation_documents_set_updated_at
  on public.technical_investigation_documents;
create trigger trg_technical_investigation_documents_set_updated_at
before update on public.technical_investigation_documents
for each row
execute function public.technical_investigations_set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select
  'tu-investigation-documents',
  'tu-investigation-documents',
  false,
  26214400,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]::text[]
where not exists (
  select 1
  from storage.buckets
  where id = 'tu-investigation-documents'
);

alter table public.technical_investigation_documents enable row level security;

grant select, insert, update, delete on table
  public.technical_investigation_documents
to authenticated;

drop policy if exists technical_investigation_documents_member_all
  on public.technical_investigation_documents;
create policy technical_investigation_documents_member_all
  on public.technical_investigation_documents
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
