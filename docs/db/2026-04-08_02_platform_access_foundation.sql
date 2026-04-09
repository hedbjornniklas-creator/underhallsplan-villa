-- Platform access foundation
-- Date: 2026-04-08
-- Scope:
-- 1) products
-- 2) modules
-- 3) roles
-- 4) normalized access assignments
-- 5) idempotent backfill from current RenoApp, Dashboard and /admin access

create extension if not exists pgcrypto;

create or replace function public.platform_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.platform_products (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_products_key_check
    check (btrim(key) <> ''),
  constraint platform_products_label_check
    check (btrim(label) <> ''),
  constraint platform_products_sort_order_check
    check (sort_order > 0)
);

drop trigger if exists trg_platform_products_set_updated_at on public.platform_products;
create trigger trg_platform_products_set_updated_at
before update on public.platform_products
for each row
execute function public.platform_set_updated_at();

create table if not exists public.platform_modules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.platform_products (id) on delete cascade,
  key text not null,
  label text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_modules_key_check
    check (btrim(key) <> ''),
  constraint platform_modules_label_check
    check (btrim(label) <> ''),
  constraint platform_modules_sort_order_check
    check (sort_order > 0),
  constraint platform_modules_unique
    unique (product_id, key)
);

create index if not exists platform_modules_product_idx
  on public.platform_modules (product_id, is_active, sort_order);

drop trigger if exists trg_platform_modules_set_updated_at on public.platform_modules;
create trigger trg_platform_modules_set_updated_at
before update on public.platform_modules
for each row
execute function public.platform_set_updated_at();

create table if not exists public.platform_roles (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.platform_products (id) on delete cascade,
  key text not null,
  label text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_roles_key_check
    check (btrim(key) <> ''),
  constraint platform_roles_label_check
    check (btrim(label) <> ''),
  constraint platform_roles_sort_order_check
    check (sort_order > 0),
  constraint platform_roles_unique
    unique (product_id, key)
);

create index if not exists platform_roles_product_idx
  on public.platform_roles (product_id, is_active, sort_order);

drop trigger if exists trg_platform_roles_set_updated_at on public.platform_roles;
create trigger trg_platform_roles_set_updated_at
before update on public.platform_roles
for each row
execute function public.platform_set_updated_at();

create table if not exists public.platform_access_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.platform_products (id) on delete cascade,
  module_id uuid references public.platform_modules (id) on delete cascade,
  role_id uuid not null references public.platform_roles (id) on delete cascade,
  scope_type text not null default 'global',
  scope_id text,
  is_active boolean not null default true,
  granted_by_profile_id uuid references public.profiles (id) on delete set null,
  granted_reason text,
  source_system text,
  source_record_id text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_access_assignments_scope_type_check
    check (scope_type in ('global', 'brf', 'organization', 'property', 'case')),
  constraint platform_access_assignments_scope_id_check
    check (
      (scope_type = 'global' and nullif(btrim(coalesce(scope_id, '')), '') is null)
      or
      (scope_type <> 'global' and nullif(btrim(coalesce(scope_id, '')), '') is not null)
    )
);

create unique index if not exists platform_access_assignments_unique_idx
  on public.platform_access_assignments (
    profile_id,
    product_id,
    coalesce(module_id, '00000000-0000-0000-0000-000000000000'::uuid),
    role_id,
    scope_type,
    coalesce(scope_id, '')
  );

create index if not exists platform_access_assignments_profile_idx
  on public.platform_access_assignments (profile_id, is_active, expires_at);

create index if not exists platform_access_assignments_product_idx
  on public.platform_access_assignments (product_id, module_id, is_active, expires_at);

drop trigger if exists trg_platform_access_assignments_set_updated_at on public.platform_access_assignments;
create trigger trg_platform_access_assignments_set_updated_at
before update on public.platform_access_assignments
for each row
execute function public.platform_set_updated_at();

insert into public.platform_products (key, label, description, is_active, sort_order)
values
  ('renoapp', 'RenoApp', 'BRF renovation application and board workflow.', true, 100),
  ('dashboard', 'Dashboard', 'Property, inspection and operational modules.', true, 200),
  ('hushub_admin', 'HusHub Admin', 'Internal admin area under /admin.', true, 300)
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

insert into public.platform_modules (product_id, key, label, description, is_active, sort_order)
select
  p.id,
  seeded.key,
  seeded.label,
  seeded.description,
  true,
  seeded.sort_order
from public.platform_products p
join (
  values
    ('renoapp', 'board_portal', 'Board portal', 'Board workspace and case handling.', 100),
    ('renoapp', 'case_review', 'Case review', 'Limited review access to RenoApp cases.', 200),
    ('renoapp', 'admin', 'RenoApp admin', 'Admin functions inside RenoApp.', 300),
    ('dashboard', 'home', 'Dashboard home', 'Dashboard start page and product home.', 100),
    ('dashboard', 'inspections', 'Inspections', 'Inspection workflow and operational views.', 200),
    ('dashboard', 'maintenance_plan', 'Maintenance plan', 'Maintenance planning module.', 300),
    ('dashboard', 'reports', 'Reports', 'Reporting and exports.', 400),
    ('dashboard', 'admin', 'Dashboard admin', 'Dashboard administration.', 500),
    ('hushub_admin', 'landing', 'Admin landing', 'Landing page under /admin.', 100),
    ('hushub_admin', 'besiktapp_admin', 'BesiktApp admin', 'Internal admin for BesiktApp.', 200),
    ('hushub_admin', 'renoapp_admin', 'RenoApp admin', 'Internal admin for RenoApp.', 300),
    ('hushub_admin', 'access_management', 'Access management', 'Future user and entitlement administration.', 400)
) as seeded(product_key, key, label, description, sort_order)
  on seeded.product_key = p.key
on conflict (product_id, key) do update
set
  label = excluded.label,
  description = excluded.description,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

insert into public.platform_roles (product_id, key, label, description, is_active, sort_order)
select
  p.id,
  seeded.key,
  seeded.label,
  seeded.description,
  true,
  seeded.sort_order
from public.platform_products p
join (
  values
    ('renoapp', 'board_member', 'Board member', 'Standard board access in RenoApp.', 100),
    ('renoapp', 'renoapp_admin', 'RenoApp admin', 'BRF-level RenoApp admin access.', 200),
    ('renoapp', 'external_reviewer', 'External reviewer', 'Limited review access for selected cases.', 300),
    ('dashboard', 'inspector', 'Inspector', 'Standard dashboard access for inspections.', 100),
    ('dashboard', 'dashboard_admin', 'Dashboard admin', 'Admin access inside dashboard modules.', 200),
    ('dashboard', 'maintenance_editor', 'Maintenance editor', 'Maintenance planning editor.', 300),
    ('hushub_admin', 'hushub_superadmin', 'HusHub superadmin', 'Full internal admin access.', 100),
    ('hushub_admin', 'product_admin', 'Product admin', 'Internal admin for one or more product areas.', 200)
) as seeded(product_key, key, label, description, sort_order)
  on seeded.product_key = p.key
on conflict (product_id, key) do update
set
  label = excluded.label,
  description = excluded.description,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

with renoapp_refs as (
  select
    p.id as product_id,
    m.id as module_id,
    m.key as module_key,
    r.id as role_id,
    r.key as role_key
  from public.platform_products p
  join public.platform_modules m
    on m.product_id = p.id
  join public.platform_roles r
    on r.product_id = p.id
  where p.key = 'renoapp'
    and m.key = 'board_portal'
    and r.key in ('board_member', 'renoapp_admin')
)
insert into public.platform_access_assignments (
  profile_id,
  product_id,
  module_id,
  role_id,
  scope_type,
  scope_id,
  is_active,
  granted_reason,
  source_system,
  source_record_id
)
select
  member.profile_id,
  refs.product_id,
  refs.module_id,
  refs.role_id,
  'brf',
  member.brf_id::text,
  true,
  'Backfill from brf_members',
  'brf_members',
  member.id::text
from public.brf_members member
join renoapp_refs refs
  on refs.role_key = case when member.role = 'admin' then 'renoapp_admin' else 'board_member' end
where member.is_active = true
  and not exists (
    select 1
    from public.platform_access_assignments existing
    where existing.profile_id = member.profile_id
      and existing.product_id = refs.product_id
      and existing.module_id = refs.module_id
      and existing.role_id = refs.role_id
      and existing.scope_type = 'brf'
      and existing.scope_id = member.brf_id::text
  );

with dashboard_refs as (
  select
    p.id as product_id,
    r.id as role_id,
    r.key as role_key
  from public.platform_products p
  join public.platform_roles r
    on r.product_id = p.id
  where p.key = 'dashboard'
    and r.key in ('inspector', 'dashboard_admin')
)
insert into public.platform_access_assignments (
  profile_id,
  product_id,
  module_id,
  role_id,
  scope_type,
  scope_id,
  is_active,
  granted_reason,
  source_system,
  source_record_id
)
select
  member.profile_id,
  refs.product_id,
  null,
  refs.role_id,
  'organization',
  member.org_id::text,
  true,
  'Backfill from org_members',
  'org_members',
  member.id::text
from public.org_members member
join dashboard_refs refs
  on refs.role_key = case when member.role = 'admin' then 'dashboard_admin' else 'inspector' end
where member.is_active = true
  and not exists (
    select 1
    from public.platform_access_assignments existing
    where existing.profile_id = member.profile_id
      and existing.product_id = refs.product_id
      and coalesce(existing.module_id, '00000000-0000-0000-0000-000000000000'::uuid) = '00000000-0000-0000-0000-000000000000'::uuid
      and existing.role_id = refs.role_id
      and existing.scope_type = 'organization'
      and existing.scope_id = member.org_id::text
  );

with admin_refs as (
  select
    p.id as product_id,
    m.id as module_id,
    m.key as module_key,
    r.id as role_id
  from public.platform_products p
  join public.platform_modules m
    on m.product_id = p.id
  join public.platform_roles r
    on r.product_id = p.id
  where p.key = 'hushub_admin'
    and m.key in ('landing', 'besiktapp_admin', 'renoapp_admin', 'access_management')
    and r.key = 'hushub_superadmin'
)
insert into public.platform_access_assignments (
  profile_id,
  product_id,
  module_id,
  role_id,
  scope_type,
  scope_id,
  is_active,
  granted_reason,
  source_system,
  source_record_id
)
select
  profile.id,
  refs.product_id,
  refs.module_id,
  refs.role_id,
  'global',
  null,
  true,
  'Backfill from profiles.is_admin',
  'profiles',
  profile.id::text
from public.profiles profile
cross join admin_refs refs
where coalesce(profile.is_admin, false) = true
  and not exists (
    select 1
    from public.platform_access_assignments existing
    where existing.profile_id = profile.id
      and existing.product_id = refs.product_id
      and existing.module_id = refs.module_id
      and existing.role_id = refs.role_id
      and existing.scope_type = 'global'
      and existing.scope_id is null
  );
