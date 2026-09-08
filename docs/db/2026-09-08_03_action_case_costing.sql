-- Uppdrag: action case draft costing
-- Date: 2026-09-08
-- Prerequisite: 2026-09-08_01_action_cases_foundation.sql
-- Scope:
-- 1) Add traceable cost lines for labor, material, subcontractors and waste
-- 2) Separate internal cost from customer price
-- 3) Require explicit human verification of every sourced price

create table if not exists public.action_case_cost_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  action_case_id uuid not null references public.action_cases (id) on delete cascade,
  action_case_item_id uuid not null references public.action_case_items (id) on delete cascade,
  category text not null check (category in ('own_labor', 'material', 'subcontractor', 'waste', 'transport', 'other')),
  description text not null,
  quantity numeric(14,3) not null default 1 check (quantity > 0),
  unit text not null default 'st',
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  markup_percent numeric(7,2) not null default 0 check (markup_percent between -100 and 1000),
  vat_rate numeric(5,2) not null default 25 check (vat_rate between 0 and 100),
  price_source text not null default 'manual'
    check (price_source in ('manual', 'beijer', 'subcontractor', 'price_book', 'ai_suggestion', 'other')),
  source_url text,
  source_checked_at timestamptz,
  is_verified boolean not null default false,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  sort_order integer not null default 100,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint action_case_cost_lines_description_check check (btrim(description) <> ''),
  constraint action_case_cost_lines_unit_check check (btrim(unit) <> ''),
  constraint action_case_cost_lines_verification_check
    check (
      (is_verified = false and verified_by is null and verified_at is null)
      or (is_verified = true and verified_by is not null and verified_at is not null)
    )
);

create index if not exists action_case_cost_lines_item_sort_idx
  on public.action_case_cost_lines (action_case_item_id, sort_order, created_at);
create index if not exists action_case_cost_lines_case_idx
  on public.action_case_cost_lines (action_case_id, category);

drop trigger if exists trg_action_case_cost_lines_updated_at on public.action_case_cost_lines;
create trigger trg_action_case_cost_lines_updated_at
before update on public.action_case_cost_lines
for each row execute function public.operational_tasks_set_updated_at();

alter table public.action_case_cost_lines enable row level security;
grant select, insert, update, delete on public.action_case_cost_lines to authenticated;

drop policy if exists action_case_cost_lines_org_member_all on public.action_case_cost_lines;
create policy action_case_cost_lines_org_member_all on public.action_case_cost_lines
for all to authenticated
using (public.is_org_member(org_id))
with check (
  public.is_org_member(org_id)
  and exists (
    select 1 from public.action_case_items item
    where item.id = action_case_cost_lines.action_case_item_id
      and item.action_case_id = action_case_cost_lines.action_case_id
      and item.org_id = action_case_cost_lines.org_id
  )
);
