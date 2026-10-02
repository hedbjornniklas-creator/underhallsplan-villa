import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

export const sql = (name: string) => readFileSync(new URL(`../../docs/db/${name}`, import.meta.url), 'utf8').replace(/^\uFEFF/u, '')

export async function platformOrganizationDb() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;
    create schema storage; grant usage on schema storage to authenticated,anon,service_role;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null,metadata jsonb);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated,service_role;
    create policy legacy_permissive_bucket on storage.objects for all to authenticated using(true) with check(true);
    create table public.profiles(id uuid primary key,email text,full_name text,phone text,is_admin boolean default false,
      org_name text,company_name text,company_orgno text,company_address text,company_postal_code text,company_city text);`)
  await db.exec(sql('2026-02-20_01_assignments_org_foundation.sql'))
  await db.exec(sql('2026-04-08_02_platform_access_foundation.sql').split('with renoapp_refs as (')[0].replace('create extension if not exists pgcrypto;', ''))
  const foundation = sql('2026-09-09_05_fortnox_connection_foundation.sql')
  await db.exec(foundation.slice(foundation.indexOf('alter table public.organizations'), foundation.indexOf('create table if not exists public.fortnox_connections')))
  await db.exec(`create table fortnox_connections(org_id uuid primary key,company_organization_number text,
    foreign key(org_id,company_organization_number) references organizations(id,organization_number) on update restrict);
    insert into platform_modules(product_id,key,label) select id,'technical_investigations','TU' from platform_products where key='dashboard';`)
  const cards = sql('2026-09-12_07_profile_org_cards.sql')
  await db.exec(cards.slice(cards.indexOf('create table if not exists public.profile_org_cards'), cards.indexOf('-- Copy legacy data')))
  await db.exec(cards.slice(cards.indexOf('alter table public.profile_org_cards enable row level security'), cards.indexOf('revoke all on function public.profile_org_cards_prepare_write')))
  await db.exec(sql('2026-10-01_01_organization_administration.sql'))
  return db
}

export async function person(db: PGlite, legacyAdmin = false) {
  const id = randomUUID()
  await db.query('insert into auth.users values($1,$2,now())', [id,`${id}@example.test`])
  await db.query('insert into profiles(id,email,full_name,is_admin) values($1,$2,$3,$4)', [id,`${id}@example.test`,'Unchanged personal name',legacyAdmin])
  return id
}

export async function organization(db: PGlite, admin: string) {
  const id = randomUUID()
  await db.query('insert into organizations(id,name,created_by) values($1,$2,$3)', [id,'Existing organization',admin])
  await db.query(`insert into org_members(org_id,profile_id,role,is_active,is_default)
    values($1,$2,'admin',true,not exists(select 1 from org_members where profile_id=$2 and is_default))`, [id,admin])
  return id
}

export async function grant(db: PGlite, profileId: string, options: {
  product?: string; module?: string | null; role?: string; scope?: string; scopeId?: string | null;
  active?: boolean; expiresAt?: string | null;
} = {}) {
  const result = await db.query<{id:string}>(`insert into platform_access_assignments
    (profile_id,product_id,module_id,role_id,scope_type,scope_id,is_active,expires_at)
    select $1,p.id,m.id,r.id,$5,$6,$7,$8 from platform_products p
    left join platform_modules m on m.product_id=p.id and m.key=$3
    join platform_roles r on r.product_id=p.id and r.key=$4 where p.key=$2 returning id`, [
    profileId,options.product ?? 'hushub_admin',options.module === undefined ? 'access_management' : options.module,
    options.role ?? 'hushub_superadmin',options.scope ?? 'global',options.scopeId ?? null,options.active ?? true,options.expiresAt ?? null,
  ])
  return result.rows[0].id
}

export async function asRole<T>(db: PGlite, role: 'anon' | 'authenticated' | 'service_role', work: () => Promise<T>) {
  await db.exec(`set role ${role}`)
  try { return await work() } finally { await db.exec('reset role') }
}
