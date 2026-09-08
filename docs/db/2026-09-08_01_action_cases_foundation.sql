-- Uppdrag: action case foundation
-- Date: 2026-09-08
-- Scope:
-- 1) Add organization-scoped action cases beside operational tasks
-- 2) Store independently quotable work items in a stable order
-- 3) Keep an audit trail without changing the existing task workflow

create extension if not exists pgcrypto;

create table if not exists public.action_cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  property_address text not null,
  source_kind text not null default 'manual'
    check (source_kind in ('manual', 'inspection', 'email', 'customer_request')),
  source_reference text,
  description text,
  status text not null default 'preparing'
    check (status in ('preparing', 'pricing', 'quote_ready', 'awaiting_customer', 'approved', 'in_progress', 'completed', 'cancelled')),
  site_visit_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint action_cases_title_check check (btrim(title) <> ''),
  constraint action_cases_customer_name_check check (btrim(customer_name) <> ''),
  constraint action_cases_property_address_check check (btrim(property_address) <> '')
);

create table if not exists public.action_case_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  action_case_id uuid not null references public.action_cases (id) on delete cascade,
  title text not null,
  scope text,
  status text not null default 'scope_needed'
    check (status in ('scope_needed', 'pricing_needed', 'waiting_subcontractor', 'ready_for_quote', 'offered', 'approved', 'declined', 'scheduled', 'in_progress', 'ready_for_review', 'completed', 'cancelled')),
  sort_order integer not null default 100,
  own_labor_ready boolean not null default false,
  material_price_ready boolean not null default false,
  subcontractor_price_ready boolean not null default false,
  waste_solution_ready boolean not null default false,
  requires_subcontractor boolean not null default false,
  estimated_cost numeric(14,2),
  customer_price numeric(14,2),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint action_case_items_title_check check (btrim(title) <> ''),
  constraint action_case_items_sort_order_check check (sort_order > 0),
  constraint action_case_items_estimated_cost_check check (estimated_cost is null or estimated_cost >= 0),
  constraint action_case_items_customer_price_check check (customer_price is null or customer_price >= 0)
);

create table if not exists public.action_case_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  action_case_id uuid not null references public.action_cases (id) on delete cascade,
  action_case_item_id uuid references public.action_case_items (id) on delete cascade,
  event_type text not null,
  message text,
  performed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint action_case_events_type_check check (btrim(event_type) <> '')
);

create index if not exists action_cases_org_updated_idx
  on public.action_cases (org_id, updated_at desc);
create index if not exists action_case_items_case_sort_idx
  on public.action_case_items (action_case_id, sort_order, created_at);
create index if not exists action_case_events_case_created_idx
  on public.action_case_events (action_case_id, created_at desc);
create unique index if not exists action_case_items_case_sort_unique_idx
  on public.action_case_items (action_case_id, sort_order);

drop trigger if exists trg_action_cases_updated_at on public.action_cases;
create trigger trg_action_cases_updated_at
before update on public.action_cases
for each row execute function public.operational_tasks_set_updated_at();

drop trigger if exists trg_action_case_items_updated_at on public.action_case_items;
create trigger trg_action_case_items_updated_at
before update on public.action_case_items
for each row execute function public.operational_tasks_set_updated_at();

alter table public.action_cases enable row level security;
alter table public.action_case_items enable row level security;
alter table public.action_case_events enable row level security;

grant select, insert, update, delete on public.action_cases, public.action_case_items to authenticated;
grant select, insert on public.action_case_events to authenticated;

drop policy if exists action_cases_org_member_all on public.action_cases;
create policy action_cases_org_member_all on public.action_cases
for all to authenticated
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

drop policy if exists action_case_items_org_member_all on public.action_case_items;
create policy action_case_items_org_member_all on public.action_case_items
for all to authenticated
using (
  public.is_org_member(org_id)
  and exists (
    select 1 from public.action_cases action_case
    where action_case.id = action_case_items.action_case_id
      and action_case.org_id = action_case_items.org_id
  )
)
with check (
  public.is_org_member(org_id)
  and exists (
    select 1 from public.action_cases action_case
    where action_case.id = action_case_items.action_case_id
      and action_case.org_id = action_case_items.org_id
  )
);

drop policy if exists action_case_events_org_member_select on public.action_case_events;
create policy action_case_events_org_member_select on public.action_case_events
for select to authenticated using (public.is_org_member(org_id));

drop policy if exists action_case_events_org_member_insert on public.action_case_events;
create policy action_case_events_org_member_insert on public.action_case_events
for insert to authenticated
with check (
  public.is_org_member(org_id)
  and exists (
    select 1 from public.action_cases action_case
    where action_case.id = action_case_events.action_case_id
      and action_case.org_id = action_case_events.org_id
  )
);
