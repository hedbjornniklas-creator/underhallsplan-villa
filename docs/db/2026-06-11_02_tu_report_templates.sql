-- Technical investigations report templates
-- Date: 2026-06-11
-- Scope:
-- 1) Add admin-managed TU report templates
-- 2) Add template sections that are copied into report_draft when a TU is created
-- 3) Store immutable template metadata on TU details without changing existing reports

create extension if not exists pgcrypto;

alter table public.technical_investigation_details
  add column if not exists report_template_key text,
  add column if not exists report_template_title text,
  add column if not exists report_template_version integer,
  add column if not exists report_template_applied_at timestamptz;

comment on column public.technical_investigation_details.report_template_key is
  'Template key copied when the TU report was created. Informational only after creation.';
comment on column public.technical_investigation_details.report_template_title is
  'Template title copied when the TU report was created. Informational only after creation.';
comment on column public.technical_investigation_details.report_template_version is
  'Template version copied when the TU report was created. Informational only after creation.';
comment on column public.technical_investigation_details.report_template_applied_at is
  'Timestamp when the selected TU template was copied into report_draft.';

create table if not exists public.settings_tu_report_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  title text not null,
  description text,
  document_title text not null,
  project_type text not null,
  version integer not null default 1,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_tu_report_templates_key_check
    check (btrim(key) <> '' and key ~ '^[a-z0-9_]+$'),
  constraint settings_tu_report_templates_title_check
    check (btrim(title) <> ''),
  constraint settings_tu_report_templates_document_title_check
    check (btrim(document_title) <> ''),
  constraint settings_tu_report_templates_project_type_check
    check (btrim(project_type) <> ''),
  constraint settings_tu_report_templates_version_check
    check (version > 0)
);

create unique index if not exists settings_tu_report_templates_key_unique_idx
  on public.settings_tu_report_templates (lower(key));

create unique index if not exists settings_tu_report_templates_key_plain_unique_idx
  on public.settings_tu_report_templates (key);

create index if not exists settings_tu_report_templates_active_sort_idx
  on public.settings_tu_report_templates (is_active, sort_order, title);

create table if not exists public.settings_tu_report_template_sections (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.settings_tu_report_templates (id) on delete cascade,
  template_section_key text not null,
  section_type_key text not null references public.settings_tu_report_section_types (key) on update cascade on delete restrict,
  title_override text,
  default_content text,
  ai_instruction text,
  sort_order integer not null default 100,
  is_required boolean not null default false,
  include_in_toc boolean not null default true,
  allow_delete boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_tu_report_template_sections_key_check
    check (btrim(template_section_key) <> '' and template_section_key ~ '^[a-z0-9_]+$'),
  constraint settings_tu_report_template_sections_type_key_check
    check (btrim(section_type_key) <> '' and section_type_key ~ '^[a-z0-9_]+$'),
  constraint settings_tu_report_template_sections_title_override_check
    check (title_override is null or btrim(title_override) <> '')
);

create unique index if not exists settings_tu_report_template_sections_template_key_idx
  on public.settings_tu_report_template_sections (template_id, template_section_key);

create index if not exists settings_tu_report_template_sections_template_sort_idx
  on public.settings_tu_report_template_sections (template_id, sort_order);

create or replace function public.settings_tu_report_templates_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_settings_tu_report_templates_set_updated_at
  on public.settings_tu_report_templates;
create trigger trg_settings_tu_report_templates_set_updated_at
before update on public.settings_tu_report_templates
for each row
execute function public.settings_tu_report_templates_set_updated_at();

drop trigger if exists trg_settings_tu_report_template_sections_set_updated_at
  on public.settings_tu_report_template_sections;
create trigger trg_settings_tu_report_template_sections_set_updated_at
before update on public.settings_tu_report_template_sections
for each row
execute function public.settings_tu_report_templates_set_updated_at();

create or replace function public.is_hushub_besiktapp_admin()
returns boolean
language sql
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id::text = auth.uid()::text
      and coalesce(p.is_admin, false) = true
  )
  or exists (
    select 1
    from public.platform_access_assignments paa
    join public.platform_products pp
      on pp.id = paa.product_id
     and pp.key = 'hushub_admin'
    join public.platform_modules pm
      on pm.id = paa.module_id
     and pm.key = 'besiktapp_admin'
    join public.platform_roles pr
      on pr.id = paa.role_id
     and pr.key in ('hushub_superadmin', 'product_admin')
    where paa.profile_id::text = auth.uid()::text
      and paa.is_active = true
      and (paa.expires_at is null or paa.expires_at > now())
      and paa.scope_type = 'global'
      and paa.scope_id is null
  );
$$;

grant execute on function public.is_hushub_besiktapp_admin() to authenticated;

grant select, insert, update, delete on table
  public.settings_tu_report_templates,
  public.settings_tu_report_template_sections
to authenticated;

alter table public.settings_tu_report_templates enable row level security;
alter table public.settings_tu_report_template_sections enable row level security;

drop policy if exists settings_tu_report_templates_admin_all
  on public.settings_tu_report_templates;
create policy settings_tu_report_templates_admin_all
  on public.settings_tu_report_templates
  for all
  to authenticated
  using (public.is_hushub_besiktapp_admin())
  with check (public.is_hushub_besiktapp_admin());

drop policy if exists settings_tu_report_template_sections_admin_all
  on public.settings_tu_report_template_sections;
create policy settings_tu_report_template_sections_admin_all
  on public.settings_tu_report_template_sections
  for all
  to authenticated
  using (public.is_hushub_besiktapp_admin())
  with check (public.is_hushub_besiktapp_admin());

insert into public.settings_tu_report_templates (
  key,
  title,
  description,
  document_title,
  project_type,
  version,
  sort_order,
  is_active,
  is_system
)
values
  (
    'deep_technical_investigation',
    'Fördjupad teknisk utredning',
    'Standardmall för tekniska utredningar med full struktur.',
    'Teknisk utredning',
    'Fördjupad teknisk utredning',
    1,
    100,
    true,
    true
  ),
  (
    'technical_status_statement',
    'Tekniskt statusutlåtande',
    'Mall för tekniskt statusutlåtande med sammanhållen statusbedömning.',
    'Tekniskt statusutlåtande',
    'Fastighetsbesiktning',
    1,
    200,
    true,
    true
  ),
  (
    'short_technical_statement',
    'Kort tekniskt utlåtande',
    'Kortare mall för avgränsade tekniska bedömningar.',
    'Kort tekniskt utlåtande',
    'Kort tekniskt utlåtande',
    1,
    300,
    true,
    true
  )
on conflict (key) do update
set
  title = excluded.title,
  description = excluded.description,
  document_title = excluded.document_title,
  project_type = excluded.project_type,
  version = excluded.version,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  is_system = true,
  updated_at = now();

with seed_rows (
  template_key,
  template_section_key,
  section_type_key,
  title_override,
  default_content,
  ai_instruction,
  sort_order,
  is_required,
  include_in_toc,
  allow_delete
) as (
  values
    ('deep_technical_investigation', 'background_scope', 'background_scope', null, null, 'Beskriv bakgrund och anledning till utredningen utan att dra tekniska slutsatser.', 100, false, true, true),
    ('deep_technical_investigation', 'assignment_scope', 'assignment_scope', null, null, 'Beskriv uppdragets omfattning, avgränsningar och kontrollerade delar.', 200, false, true, true),
    ('deep_technical_investigation', 'construction_description', 'construction_description', null, null, 'Beskriv berörd konstruktion och tekniska förutsättningar sakligt.', 300, false, true, true),
    ('deep_technical_investigation', 'basis_conditions', 'basis_conditions', null, null, 'Redovisa handlingar, uppgifter och besiktningsförutsättningar.', 400, false, true, true),
    ('deep_technical_investigation', 'observed_execution', 'observed_execution', null, null, 'Redovisa iakttagelser från platsbesök utan att blanda in åtgärdsförslag.', 500, false, true, true),
    ('deep_technical_investigation', 'technical_assessment', 'technical_assessment', null, null, 'Gör en teknisk bedömning baserad på iakttagelser och underlag.', 600, false, true, true),
    ('deep_technical_investigation', 'time_assessment', 'time_assessment', null, null, 'Bedöm tidsmässiga samband och sannolik skadeutveckling där det är möjligt.', 700, false, true, true),
    ('deep_technical_investigation', 'continued_risk', 'continued_risk', null, null, 'Bedöm fortsatt risk om förhållandet lämnas utan åtgärd.', 800, false, true, true),
    ('deep_technical_investigation', 'recommended_actions', 'recommended_actions', null, null, 'Föreslå fortsatt teknisk hantering utan juridiska slutsatser.', 900, false, true, true),
    ('deep_technical_investigation', 'closing_comments', 'closing_comments', null, null, 'Avsluta med ramar, reservationer och vad utlåtandet baseras på.', 1000, false, true, true),

    ('technical_status_statement', 'assignment_scope', 'assignment_scope', 'Uppdragets omfattning', null, 'Beskriv vad statusutlåtandet omfattar och vilka delar som kontrollerats.', 100, false, true, true),
    ('technical_status_statement', 'basis_conditions', 'basis_conditions', 'Underlag och besiktningsförutsättningar', null, 'Redovisa underlag och förutsättningar för statusbedömningen.', 200, false, true, true),
    ('technical_status_statement', 'observed_execution', 'observed_execution', 'Iakttagelser vid platsbesök', null, 'Redovisa iakttagelser och relevanta statusnoteringar.', 300, false, true, true),
    ('technical_status_statement', 'technical_assessment', 'technical_assessment', 'Sammanfattande bedömning', null, 'Sammanfatta teknisk status, brister och betydelse för fortsatt förvaltning.', 400, false, true, true),
    ('technical_status_statement', 'recommended_actions', 'recommended_actions', 'Rekommenderade kompletterande kontroller', null, 'Föreslå fortsatta kontroller eller tekniska utredningar där status inte kan verifieras.', 500, false, true, true),
    ('technical_status_statement', 'closing_comments', 'closing_comments', 'Avslutande kommentarer', null, 'Avsluta med ramar, reservationer och användningsområde för statusutlåtandet.', 600, false, true, true),

    ('short_technical_statement', 'assignment_scope', 'assignment_scope', 'Uppdragets omfattning', null, 'Beskriv kort vad utlåtandet omfattar och vad som inte ingår.', 100, false, true, true),
    ('short_technical_statement', 'observed_execution', 'observed_execution', 'Iakttagelser', null, 'Redovisa de iakttagelser som är relevanta för frågeställningen.', 200, false, true, true),
    ('short_technical_statement', 'technical_assessment', 'technical_assessment', 'Teknisk bedömning', null, 'Gör en kort teknisk bedömning med tydlig koppling till iakttagelserna.', 300, false, true, true),
    ('short_technical_statement', 'recommended_actions', 'recommended_actions', 'Rekommenderad fortsatt hantering', null, 'Föreslå nästa steg i kort och praktisk form.', 400, false, true, true)
)
insert into public.settings_tu_report_template_sections (
  template_id,
  template_section_key,
  section_type_key,
  title_override,
  default_content,
  ai_instruction,
  sort_order,
  is_required,
  include_in_toc,
  allow_delete
)
select
  templates.id,
  seed_rows.template_section_key,
  seed_rows.section_type_key,
  seed_rows.title_override,
  seed_rows.default_content,
  seed_rows.ai_instruction,
  seed_rows.sort_order,
  seed_rows.is_required,
  seed_rows.include_in_toc,
  seed_rows.allow_delete
from seed_rows
join public.settings_tu_report_templates templates
  on templates.key = seed_rows.template_key
on conflict (template_id, template_section_key) do update
set
  section_type_key = excluded.section_type_key,
  title_override = excluded.title_override,
  default_content = excluded.default_content,
  ai_instruction = excluded.ai_instruction,
  sort_order = excluded.sort_order,
  is_required = excluded.is_required,
  include_in_toc = excluded.include_in_toc,
  allow_delete = excluded.allow_delete,
  updated_at = now();
