-- RenoApp universal apply model
-- Date: 2026-03-30
-- Additive only / rollback-safe:
--  - Adds universal action categories and simplified action type metadata
--  - Adds requirement phases for resident-facing document guidance
--  - Adds contractor fields to renovation cases
-- Prerequisite:
--  - 2026-03-26_01_renoapp_mvp_foundation.sql
--  - 2026-03-29_01_renoapp_public_apply_multiaction_drafts.sql

create table if not exists public.renovation_action_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  description text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renovation_action_categories_slug_check
    check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint renovation_action_categories_label_check
    check (btrim(label) <> ''),
  constraint renovation_action_categories_sort_order_check
    check (sort_order > 0)
);

drop trigger if exists trg_renovation_action_categories_set_updated_at on public.renovation_action_categories;
create trigger trg_renovation_action_categories_set_updated_at
before update on public.renovation_action_categories
for each row
execute function public.renoapp_set_updated_at();

alter table public.renovation_action_types
  add column if not exists category_id uuid references public.renovation_action_categories (id) on delete set null,
  add column if not exists risk_level text not null default 'medium',
  add column if not exists contractor_requirement text not null default 'none',
  add column if not exists implies_structure boolean not null default false,
  add column if not exists implies_plumbing boolean not null default false,
  add column if not exists implies_ventilation boolean not null default false,
  add column if not exists implies_electrical boolean not null default false,
  add column if not exists implies_wet_room boolean not null default false,
  add column if not exists implies_surface_only boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'renovation_action_types_risk_level_check'
  ) then
    alter table public.renovation_action_types
      add constraint renovation_action_types_risk_level_check
      check (risk_level in ('low', 'medium', 'high'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'renovation_action_types_contractor_requirement_check'
  ) then
    alter table public.renovation_action_types
      add constraint renovation_action_types_contractor_requirement_check
      check (
        contractor_requirement in (
          'none',
          'qualified_contractor',
          'authorized_electrician',
          'safe_water',
          'bkr_or_gvk',
          'structural_engineer'
        )
      );
  end if;
end $$;

create index if not exists renovation_action_types_category_idx
  on public.renovation_action_types (category_id, sort_order);

alter table public.renovation_action_document_requirements
  add column if not exists phase text not null default 'before_required';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'renovation_action_document_requirements_phase_check'
  ) then
    alter table public.renovation_action_document_requirements
      add constraint renovation_action_document_requirements_phase_check
      check (phase in ('before_required', 'before_conditional', 'after_completion'));
  end if;
end $$;

create index if not exists renovation_action_document_requirements_phase_idx
  on public.renovation_action_document_requirements (action_type_id, phase, sort_order);

alter table public.renovation_cases
  add column if not exists contractor_name text,
  add column if not exists contractor_org_number text,
  add column if not exists contractor_email text,
  add column if not exists contractor_phone text,
  add column if not exists contractor_has_required_certification boolean not null default false;

insert into public.renovation_action_categories (slug, label, description, sort_order)
values
  ('vatrum', 'Våtrum', 'Arbeten i badrum, tvättutrymmen och andra våtrum.', 10),
  ('kok', 'Kök', 'Arbeten i kök, köksinredning och köksnära installationer.', 20),
  ('ytskikt', 'Ytskikt', 'Målning, golv och andra enklare invändiga ytskikt.', 30),
  ('vaggar-planlosning', 'Väggar och planlösning', 'Ändringar av väggar och planlösning i bostaden.', 40),
  ('installationer', 'Installationer', 'Arbeten som påverkar VVS, el eller ventilation.', 50),
  ('ovrigt', 'Övrigt', 'Övriga renoveringar som inte passar i de vanliga kategorierna.', 60)
on conflict (slug) do update
set
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = true;

update public.renovation_action_types
set
  category_id = category_map.category_id,
  risk_level = category_map.risk_level,
  contractor_requirement = category_map.contractor_requirement,
  implies_structure = category_map.implies_structure,
  implies_plumbing = category_map.implies_plumbing,
  implies_ventilation = category_map.implies_ventilation,
  implies_electrical = category_map.implies_electrical,
  implies_wet_room = category_map.implies_wet_room,
  implies_surface_only = category_map.implies_surface_only,
  description = coalesce(nullif(btrim(public.renovation_action_types.description), ''), category_map.description)
from (
  select
    rat.id as action_type_id,
    rac.id as category_id,
    rat.key,
    case rat.key
      when 'bathroom' then 'high'
      when 'kitchen' then 'medium'
      when 'wall' then 'medium'
      when 'plumbing' then 'high'
      when 'electrical' then 'medium'
      when 'ventilation' then 'high'
      when 'surface' then 'low'
      else 'medium'
    end as risk_level,
    case rat.key
      when 'bathroom' then 'bkr_or_gvk'
      when 'kitchen' then 'qualified_contractor'
      when 'wall' then 'qualified_contractor'
      when 'plumbing' then 'safe_water'
      when 'electrical' then 'authorized_electrician'
      when 'ventilation' then 'qualified_contractor'
      when 'surface' then 'none'
      else 'qualified_contractor'
    end as contractor_requirement,
    case when rat.key = 'wall' then true else false end as implies_structure,
    case when rat.key in ('bathroom', 'kitchen', 'plumbing') then true else false end as implies_plumbing,
    case when rat.key = 'ventilation' then true else false end as implies_ventilation,
    case when rat.key in ('bathroom', 'kitchen', 'electrical') then true else false end as implies_electrical,
    case when rat.key = 'bathroom' then true else false end as implies_wet_room,
    case when rat.key = 'surface' then true else false end as implies_surface_only,
    case rat.key
      when 'bathroom' then 'Renovering av badrum, tvättutrymme eller andra våtrum.'
      when 'kitchen' then 'Ändringar i kök, köksinredning eller installationer kopplade till kök.'
      when 'wall' then 'Rivning, flytt eller uppbyggnad av väggar och planlösningsändringar.'
      when 'plumbing' then 'Ändringar i vatten, avlopp eller annan VVS-installation.'
      when 'electrical' then 'Ändringar i elinstallationer, fasta elpunkter eller eldragning.'
      when 'ventilation' then 'Ändringar som påverkar ventilation eller frånluftssystem.'
      when 'surface' then 'Ytskiktsrenovering som målning, golv eller andra ytskikt utan större ingrepp.'
      else 'Annan åtgärd som inte passar i de vanliga kategorierna.'
    end as description
  from public.renovation_action_types rat
  join public.renovation_action_categories rac
    on rac.slug = case
      when rat.key = 'bathroom' then 'vatrum'
      when rat.key = 'kitchen' then 'kok'
      when rat.key = 'surface' then 'ytskikt'
      when rat.key = 'wall' then 'vaggar-planlosning'
      when rat.key in ('plumbing', 'electrical', 'ventilation') then 'installationer'
      else 'ovrigt'
    end
) as category_map
where public.renovation_action_types.id = category_map.action_type_id;

update public.renovation_action_document_requirements req
set phase = case
  when rat.key = 'bathroom' and rdt.key in ('drawing', 'insurance') then 'before_required'
  when rat.key = 'bathroom' and rdt.key in ('certificate') then 'before_conditional'
  when rat.key in ('plumbing', 'electrical', 'ventilation', 'kitchen', 'wall') and rdt.key = 'drawing' then 'before_required'
  when rat.key in ('plumbing', 'electrical', 'ventilation', 'kitchen', 'wall') and rdt.key = 'certificate' then 'before_conditional'
  when rat.key = 'surface' and rdt.key = 'drawing' then 'before_conditional'
  else req.phase
end
from public.renovation_action_types rat,
     public.renovation_document_types rdt
where req.action_type_id = rat.id
  and req.document_type_id = rdt.id;
