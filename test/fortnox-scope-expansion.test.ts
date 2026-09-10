import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const foundationMigration = readFileSync(
  new URL('../docs/db/2026-09-09_05_fortnox_connection_foundation.sql', import.meta.url),
  'utf8'
)
const scopeExpansionMigration = readFileSync(
  new URL('../docs/db/2026-09-10_03_fortnox_customer_invoice_scopes.sql', import.meta.url),
  'utf8'
)

async function database() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.profiles (
      id uuid primary key,
      company_orgno text
    );
    create table public.organizations (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      created_by uuid references public.profiles (id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.org_members (
      org_id uuid not null references public.organizations (id),
      profile_id uuid not null references public.profiles (id),
      role text not null,
      is_active boolean not null default true
    );
    grant select, insert, update, delete on table public.organizations
      to authenticated, service_role;
    create function public.is_org_member(p_org_id uuid) returns boolean
      language sql security definer
      set search_path = pg_catalog, public
      as $$
        select exists (
          select 1
          from public.org_members as member
          where member.org_id = p_org_id
            and member.profile_id = auth.uid()
            and member.is_active = true
        )
      $$;
  `)
  await db.exec(foundationMigration)
  return db
}

test('scope expansion preserves legacy rows, marks reauthorization once and accepts the full grant', async () => {
  const db = await database()
  try {
    const profileId = randomUUID()
    const orgId = randomUUID()
    await db.query('insert into profiles (id) values ($1)', [profileId])
    await db.query(
      `insert into organizations (id, name, organization_number)
       values ($1, 'HusHub Test', '556123-4567')`,
      [orgId]
    )
    await db.query(
      `insert into fortnox_connections
        (org_id, tenant_id, company_name, company_organization_number, granted_scopes)
       values ($1, '100001', 'HusHub Test AB', '556123-4567', array['companyinformation'])`,
      [orgId]
    )
    await db.query(
      `insert into fortnox_oauth_states
        (state_hash, org_id, initiated_by_profile_id, requested_scopes, expires_at, consumed_at)
       values ($1, $2, $3, array['companyinformation'], now() + interval '10 minutes', now())`,
      ['a'.repeat(64), orgId, profileId]
    )

    await db.exec(scopeExpansionMigration)

    const upgraded = await db.query<{
      status: string
      granted_scopes: string[]
      last_error_code: string | null
      last_error_at: string | Date | null
      connection_version: number
    }>(
      `select status, granted_scopes, last_error_code, last_error_at, connection_version
       from fortnox_connections
       where org_id = $1`,
      [orgId]
    )
    assert.deepEqual(upgraded.rows[0].granted_scopes, ['companyinformation'])
    assert.equal(upgraded.rows[0].status, 'needs_reauthorization')
    assert.equal(upgraded.rows[0].last_error_code, 'FORTNOX_REQUIRED_SCOPE_MISSING')
    assert.ok(upgraded.rows[0].last_error_at)
    assert.equal(Number(upgraded.rows[0].connection_version), 2)

    await db.exec(scopeExpansionMigration)
    const rerun = await db.query<{ connection_version: number; last_error_at: string | Date }>(
      `select connection_version, last_error_at
       from fortnox_connections
       where org_id = $1`,
      [orgId]
    )
    assert.equal(Number(rerun.rows[0].connection_version), 2)
    assert.equal(
      new Date(rerun.rows[0].last_error_at).getTime(),
      new Date(upgraded.rows[0].last_error_at!).getTime()
    )

    await db.query(
      `update fortnox_connections
       set granted_scopes = array['companyinformation', 'customer', 'invoice'],
           status = 'connected',
           last_error_code = null,
           last_error_at = null
       where org_id = $1`,
      [orgId]
    )
    const connected = await db.query<{ status: string; granted_scopes: string[] }>(
      'select status, granted_scopes from fortnox_connections where org_id = $1',
      [orgId]
    )
    assert.deepEqual(connected.rows[0], {
      status: 'connected',
      granted_scopes: ['companyinformation', 'customer', 'invoice'],
    })

    await assert.rejects(
      db.query(
        `update fortnox_connections
         set granted_scopes = array['companyinformation'], status = 'connected'
         where org_id = $1`,
        [orgId]
      ),
      /fortnox_connections_scopes_check/
    )

    for (const scopes of [
      "array['companyinformation', 'customer']",
      "array['companyinformation', 'customer', 'invoice', 'order']",
      "array['companyinformation', 'customer', 'customer']",
      "array[['companyinformation', 'customer', 'invoice']]",
    ] as const) {
      await assert.rejects(
        db.query(
          `update fortnox_connections
           set granted_scopes = ${scopes}, status = 'needs_reauthorization'
           where org_id = $1`,
          [orgId]
        ),
        /fortnox_connections_scopes_check/
      )
    }
  } finally {
    await db.close()
  }
})

test('scope expansion allows only the legacy or complete OAuth scope set', async () => {
  const db = await database()
  try {
    const profileId = randomUUID()
    const orgId = randomUUID()
    await db.query('insert into profiles (id) values ($1)', [profileId])
    await db.query(
      `insert into organizations (id, name, organization_number)
       values ($1, 'HusHub Test', '556123-4567')`,
      [orgId]
    )
    await db.exec(scopeExpansionMigration)

    await db.query(
      `insert into fortnox_oauth_states
        (state_hash, org_id, initiated_by_profile_id, requested_scopes, expires_at, consumed_at)
       values ($1, $2, $3, array['companyinformation', 'customer', 'invoice'], now() + interval '10 minutes', now())`,
      ['b'.repeat(64), orgId, profileId]
    )

    for (const [hash, scopes] of [
      ['c'.repeat(64), "array['companyinformation', 'customer']"],
      ['d'.repeat(64), "array['companyinformation', 'customer', 'invoice', 'order']"],
      ['e'.repeat(64), "array['companyinformation', 'customer', 'customer']"],
      ['f'.repeat(64), "array[['companyinformation', 'customer', 'invoice']]"],
    ] as const) {
      await assert.rejects(
        db.query(
          `insert into fortnox_oauth_states
            (state_hash, org_id, initiated_by_profile_id, requested_scopes, expires_at, consumed_at)
           values ($1, $2, $3, ${scopes}, now() + interval '10 minutes', now())`,
          [hash, orgId, profileId]
        ),
        /fortnox_oauth_states_scopes_check/
      )
    }
  } finally {
    await db.close()
  }
})
