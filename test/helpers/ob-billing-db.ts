import type { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node strip-types requires the TypeScript extension.
import { runtimeDb, asRole, sql, ACTOR, COLLEAGUE, ORG, OTHER } from './ob-organization-runtime-db.ts'

export { asRole, ACTOR, COLLEAGUE, ORG, OTHER }
export const ADMIN = '20000000-0000-4000-8000-000000000003'
export const billingMigration = sql('2026-11-07_02_ob_inspection_billing.sql')

export async function billingGrant(db: PGlite, actor = ACTOR, org = ORG) {
  await db.query(`insert into platform_access_assignments(profile_id,product_id,module_id,role_id,scope_type,scope_id)
    select $1,p.id,m.id,r.id,'organization',$2 from platform_products p,platform_modules m,platform_roles r
    where p.key='dashboard' and m.key='inspections' and r.key='inspector'`, [actor, org])
}

// Install the real current overview, organization/lock guards and per-member
// visibility chain. Only pre-existing platform/foundation fixtures are mocked.
export async function billingDb(install = true) {
  const db = await runtimeDb()
  const administration = sql('2026-10-01_01_organization_administration.sql')
  await db.exec(administration.slice(administration.indexOf('create or replace function public.organization_assert_admin('),
    administration.indexOf('create or replace function public.organization_validate_values(')))
  await db.exec(`create function public.is_org_admin(uuid) returns boolean language sql security definer as $$
    select exists(select 1 from org_members where org_id=$1 and profile_id=auth.uid() and is_active and role='admin') $$;
    insert into profiles values('${ADMIN}'); insert into org_members values('${ORG}','${ADMIN}','admin',true);
    alter table profiles add column full_name text;
    update profiles set full_name='Testbesiktningsman' where id='${ACTOR}';
    grant select,insert,update,delete on assignments,assignment_links to authenticated;`)
  const rls = sql('2026-02-20_03_assignments_rls.sql')
  await db.exec(rls.slice(rls.indexOf('drop policy if exists assignments_select_member'),
    rls.indexOf('-- assignment_acceptances')))
  await billingGrant(db); await billingGrant(db, COLLEAGUE); await billingGrant(db, ACTOR, OTHER)
  await db.exec(sql('2026-10-12_04_ob_member_visibility.sql'))
  if (install) await db.exec(billingMigration)
  return db
}

export type Billing = {
  status: 'not_invoiced' | 'invoiced'; invoiceNumber: string | null;
  invoicedAt: string | null; updatedAt: string | null; updatedByName: string | null; revision: number
}

export async function saveBilling(db: PGlite, id: string, flag: boolean, number: string | null, revision: number,
  org = ORG, actor = ACTOR) {
  return asRole(db, 'service_role', async () => (await db.query<{ value: Billing }>(
    'select ob_set_inspection_billing($1,$2,$3,$4,$5,$6) value', [org, id, actor, flag, number, revision],
  )).rows[0].value)
}
