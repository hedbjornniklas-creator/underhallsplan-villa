-- Assignments foundation (org + memberships)
-- Date: 2026-02-20
-- Scope:
-- 1) organizations
-- 2) org_members
-- 3) helper functions for org membership checks
-- 4) idempotent seed for existing profiles

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email_from text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'inspector',
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_members_role_check
    check (role in ('admin', 'inspector')),
  constraint org_members_unique_org_profile
    unique (org_id, profile_id)
);

create unique index if not exists org_members_default_per_profile_idx
  on public.org_members (profile_id)
  where is_default = true;

create index if not exists org_members_profile_id_idx
  on public.org_members (profile_id);

create index if not exists org_members_org_id_idx
  on public.org_members (org_id);

create index if not exists organizations_created_by_idx
  on public.organizations (created_by);

create or replace function public.organizations_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_organizations_set_updated_at on public.organizations;

create trigger trg_organizations_set_updated_at
before update on public.organizations
for each row
execute function public.organizations_set_updated_at();

create or replace function public.org_members_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_org_members_set_updated_at on public.org_members;

create trigger trg_org_members_set_updated_at
before update on public.org_members
for each row
execute function public.org_members_set_updated_at();

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.profile_id::text = auth.uid()::text
      and m.is_active = true
  );
$$;

create or replace function public.is_org_admin(p_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.profile_id::text = auth.uid()::text
      and m.is_active = true
      and m.role = 'admin'
  );
$$;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;

-- Seed: create one default org per profile that has no default org membership.
with profiles_missing_default_org as (
  select
    p.id,
    p.is_admin,
    coalesce(
      nullif(trim(p.org_name), ''),
      nullif(trim(p.company_name), ''),
      'Organization'
    ) as org_name
  from public.profiles p
  where not exists (
    select 1
    from public.org_members m
    where m.profile_id = p.id
      and m.is_default = true
  )
),
inserted_orgs as (
  insert into public.organizations (name, created_by)
  select
    org_name,
    id
  from profiles_missing_default_org
  returning id, created_by
)
insert into public.org_members (org_id, profile_id, role, is_active, is_default)
select
  o.id,
  o.created_by,
  case when p.is_admin then 'admin' else 'inspector' end,
  true,
  true
from inserted_orgs o
join public.profiles p
  on p.id = o.created_by
on conflict (org_id, profile_id) do nothing;
