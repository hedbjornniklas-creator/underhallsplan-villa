-- Synthetic minimum for the real shared admin helper and catalogue dependencies.
create table public.profiles (
  id uuid primary key, full_name text, created_at timestamptz default now(), org_name text,
  logo_url text, is_admin boolean not null default false, phone text, email text,
  company_name text, company_orgno text, company_address text, company_postal_code text,
  company_city text, avatar_path text, logo_path text, signature_path text
);
create table public.platform_products (id uuid primary key default gen_random_uuid(), key text unique);
create table public.platform_modules (id uuid primary key default gen_random_uuid(), product_id uuid references public.platform_products, key text);
create table public.platform_roles (id uuid primary key default gen_random_uuid(), product_id uuid references public.platform_products, key text);
create table public.platform_access_assignments (
  id uuid primary key default gen_random_uuid(), profile_id uuid references public.profiles,
  product_id uuid references public.platform_products, module_id uuid references public.platform_modules,
  role_id uuid references public.platform_roles, scope_type text, scope_id uuid,
  is_active boolean default true, expires_at timestamptz
);
alter table public.profiles enable row level security;
create policy profile_read on public.profiles for select to public using(id=auth.uid());
create policy profile_insert on public.profiles for insert to public with check(id=auth.uid());
create policy profile_update on public.profiles for update to public using(id=auth.uid()) with check(id=auth.uid());
alter table public.platform_access_assignments enable row level security;
alter table public.component_types enable row level security;
create policy catalogue_read on public.component_types for select to public using(true);
create policy catalogue_write on public.component_types for all to authenticated using(true) with check(true);
grant all on public.profiles,public.platform_products,public.platform_modules,public.platform_roles,public.component_types to anon,authenticated,service_role;
grant all on public.platform_access_assignments to service_role;
