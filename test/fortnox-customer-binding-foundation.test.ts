import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const fortnoxFoundation = readFileSync(
  new URL('../docs/db/2026-09-09_05_fortnox_connection_foundation.sql', import.meta.url),
  'utf8'
)
const scopeExpansion = readFileSync(
  new URL('../docs/db/2026-09-10_03_fortnox_customer_invoice_scopes.sql', import.meta.url),
  'utf8'
)
const customerFoundation = readFileSync(
  new URL('../docs/db/2026-09-10_05_organization_customers.sql', import.meta.url),
  'utf8'
).replace('create extension if not exists pgcrypto;', '')
const bindingMigration = readFileSync(
  new URL('../docs/db/2026-09-10_06_fortnox_customer_binding.sql', import.meta.url),
  'utf8'
)

type BindingRow = {
  result_code: string
  customer_id: string | null
  bound_org_id: string | null
  bound_tenant_id: string | null
  bound_fortnox_customer_number: string | null
  bound_at: string | Date | null
  customer_version: number | null
  customer_updated_at: string | Date | null
}

type Fixture = {
  admin: string
  inspector: string
  inactiveAdmin: string
  org: string
}

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
      id uuid primary key
    );

    create table public.organizations (
      id uuid primary key,
      name text not null
    );

    create table public.org_members (
      org_id uuid not null references public.organizations (id),
      profile_id uuid not null references public.profiles (id),
      role text not null,
      is_active boolean not null default true,
      primary key (org_id, profile_id)
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

  await db.exec(fortnoxFoundation)
  await db.exec(scopeExpansion)
  await db.exec(customerFoundation)
  await db.exec(bindingMigration)
  await db.exec(bindingMigration)
  return db
}

async function fixture(db: PGlite): Promise<Fixture> {
  const admin = randomUUID()
  const inspector = randomUUID()
  const inactiveAdmin = randomUUID()
  const org = randomUUID()

  await db.query('insert into profiles (id) values ($1), ($2), ($3)', [
    admin,
    inspector,
    inactiveAdmin,
  ])
  await db.query(
    `insert into organizations (id, name, organization_number)
     values ($1, 'Hushub 1', '556123-4567')`,
    [org]
  )
  await db.query(
    `insert into org_members (org_id, profile_id, role, is_active)
     values
       ($1, $2, 'admin', true),
       ($1, $3, 'inspector', true),
       ($1, $4, 'admin', false)`,
    [org, admin, inspector, inactiveAdmin]
  )
  await db.query(
    `insert into fortnox_connections (
       org_id,
       tenant_id,
       company_name,
       company_organization_number,
       granted_scopes,
       status,
       connected_by_profile_id
     ) values (
       $1,
       '100001',
       'STYR Projekt AB',
       '556123-4567',
       array['companyinformation', 'customer', 'invoice'],
       'connected',
       $2
     )`,
    [org, admin]
  )

  return { admin, inspector, inactiveAdmin, org }
}

async function insertCustomer(
  db: PGlite,
  values: Fixture,
  options: {
    name?: string
    organizationNumber?: string
    active?: boolean
    tenantId?: string
    fortnoxCustomerNumber?: string
  } = {}
) {
  const tenantId = options.tenantId ?? null
  const fortnoxCustomerNumber = options.fortnoxCustomerNumber ?? null
  const synced = tenantId !== null && fortnoxCustomerNumber !== null
  const result = await db.query<{ id: string; version: number }>(
    `insert into organization_customers (
       org_id,
       customer_type,
       name,
       organization_number,
       is_active,
       fortnox_tenant_id,
       fortnox_customer_number,
       fortnox_synced_at,
       created_by_profile_id,
       updated_by_profile_id
     ) values ($1, 'business', $2, $3, $4, $5, $6, $7, $8, $8)
     returning id, version`,
    [
      values.org,
      options.name ?? 'Testkund AB',
      options.organizationNumber ?? '556765-4321',
      options.active ?? true,
      tenantId,
      fortnoxCustomerNumber,
      synced ? new Date().toISOString() : null,
      values.admin,
    ]
  )
  return {
    id: result.rows[0].id,
    version: Number(result.rows[0].version),
  }
}

async function bind(
  db: PGlite,
  input: {
    orgId: string
    customerId: string
    expectedVersion: number
    profileId: string
    tenantId?: string
    customerNumber?: string
  }
) {
  return db.query<BindingRow>(
    `select *
     from bind_organization_customer_to_fortnox($1, $2, $3, $4, $5, $6)`,
    [
      input.orgId,
      input.customerId,
      input.expectedVersion,
      input.profileId,
      input.tenantId ?? '100001',
      input.customerNumber ?? 'HUSHUB-1001',
    ]
  )
}

function assertFailure(row: BindingRow, resultCode: string) {
  assert.deepEqual(row, {
    result_code: resultCode,
    customer_id: null,
    bound_org_id: null,
    bound_tenant_id: null,
    bound_fortnox_customer_number: null,
    bound_at: null,
    customer_version: null,
    customer_updated_at: null,
  })
}

test('migration is repeatable and an active admin can bind once and retry idempotently', async () => {
  const db = await database()
  try {
    const values = await fixture(db)
    await db.exec('set role service_role')
    const customer = await insertCustomer(db, values)

    const first = await bind(db, {
      orgId: values.org,
      customerId: customer.id,
      expectedVersion: customer.version,
      profileId: values.admin,
    })
    assert.equal(first.rows.length, 1)
    assert.equal(first.rows[0].result_code, 'BOUND')
    assert.equal(first.rows[0].customer_id, customer.id)
    assert.equal(first.rows[0].bound_org_id, values.org)
    assert.equal(first.rows[0].bound_tenant_id, '100001')
    assert.equal(first.rows[0].bound_fortnox_customer_number, 'HUSHUB-1001')
    assert.ok(first.rows[0].bound_at)
    assert.equal(Number(first.rows[0].customer_version), 2)
    assert.ok(first.rows[0].customer_updated_at)

    const stored = await db.query<{
      fortnox_tenant_id: string
      fortnox_customer_number: string
      fortnox_synced_at: string
      updated_by_profile_id: string
      version: number
    }>(
      `select
         fortnox_tenant_id,
         fortnox_customer_number,
         fortnox_synced_at,
         updated_by_profile_id,
         version
       from organization_customers
       where id = $1`,
      [customer.id]
    )
    assert.equal(stored.rows[0].fortnox_tenant_id, '100001')
    assert.equal(stored.rows[0].fortnox_customer_number, 'HUSHUB-1001')
    assert.ok(stored.rows[0].fortnox_synced_at)
    assert.equal(stored.rows[0].updated_by_profile_id, values.admin)
    assert.equal(Number(stored.rows[0].version), 2)

    const retry = await bind(db, {
      orgId: values.org,
      customerId: customer.id,
      expectedVersion: customer.version,
      profileId: values.admin,
    })
    assert.equal(retry.rows.length, 1)
    assert.equal(retry.rows[0].result_code, 'ALREADY_BOUND')
    assert.equal(Number(retry.rows[0].customer_version), 2)
    assert.equal(
      new Date(retry.rows[0].bound_at as string | Date).getTime(),
      new Date(first.rows[0].bound_at as string | Date).getTime()
    )

    const afterRetry = await db.query<{ version: number }>(
      'select version from organization_customers where id = $1',
      [customer.id]
    )
    assert.equal(Number(afterRetry.rows[0].version), 2)
  } finally {
    await db.close()
  }
})

test('binding fails closed for missing admin access, stale versions, inactive customers and stale connections', async () => {
  const db = await database()
  try {
    const values = await fixture(db)
    await db.exec('set role service_role')
    const active = await insertCustomer(db, values)
    const inactive = await insertCustomer(db, values, {
      name: 'Inaktiv kund AB',
      organizationNumber: '556016-0680',
      active: false,
    })

    for (const profileId of [values.inspector, values.inactiveAdmin, randomUUID()]) {
      const denied = await bind(db, {
        orgId: values.org,
        customerId: active.id,
        expectedVersion: active.version,
        profileId,
      })
      assertFailure(denied.rows[0], 'ADMIN_REQUIRED')
    }

    const stale = await bind(db, {
      orgId: values.org,
      customerId: active.id,
      expectedVersion: active.version + 1,
      profileId: values.admin,
    })
    assertFailure(stale.rows[0], 'VERSION_CONFLICT')

    const inactiveResult = await bind(db, {
      orgId: values.org,
      customerId: inactive.id,
      expectedVersion: inactive.version,
      profileId: values.admin,
    })
    assertFailure(inactiveResult.rows[0], 'CUSTOMER_INACTIVE')

    await db.query(
      "update fortnox_connections set status = 'needs_reauthorization' where org_id = $1",
      [values.org]
    )
    const staleConnection = await bind(db, {
      orgId: values.org,
      customerId: active.id,
      expectedVersion: active.version,
      profileId: values.admin,
    })
    assertFailure(staleConnection.rows[0], 'CONNECTION_NOT_CURRENT')

    await db.query("update fortnox_connections set status = 'connected' where org_id = $1", [
      values.org,
    ])
    const wrongTenant = await bind(db, {
      orgId: values.org,
      customerId: active.id,
      expectedVersion: active.version,
      profileId: values.admin,
      tenantId: '999999',
    })
    assertFailure(wrongTenant.rows[0], 'CONNECTION_NOT_CURRENT')

    const missingCustomer = await bind(db, {
      orgId: values.org,
      customerId: randomUUID(),
      expectedVersion: 1,
      profileId: values.admin,
    })
    assertFailure(missingCustomer.rows[0], 'CUSTOMER_NOT_FOUND')

    const invalid = await db.query<BindingRow>(
      `select *
       from bind_organization_customer_to_fortnox($1, $2, 0, $3, '100001', ' HUSHUB-1001')`,
      [values.org, active.id, values.admin]
    )
    assertFailure(invalid.rows[0], 'INVALID_REQUEST')

    const unchanged = await db.query<{
      fortnox_tenant_id: string | null
      fortnox_customer_number: string | null
      fortnox_synced_at: string | null
      version: number
    }>(
      `select fortnox_tenant_id, fortnox_customer_number, fortnox_synced_at, version
       from organization_customers
       where id = $1`,
      [active.id]
    )
    assert.deepEqual(unchanged.rows.map((row) => ({
      ...row,
      version: Number(row.version),
    })), [{
      fortnox_tenant_id: null,
      fortnox_customer_number: null,
      fortnox_synced_at: null,
      version: 1,
    }])
  } finally {
    await db.close()
  }
})

test('binding never overwrites another link or reuses a Fortnox customer number', async () => {
  const db = await database()
  try {
    const values = await fixture(db)
    await db.exec('set role service_role')
    const first = await insertCustomer(db, values)
    const second = await insertCustomer(db, values, {
      name: 'Andra kunden AB',
      organizationNumber: '556016-0680',
    })
    const prelinked = await insertCustomer(db, values, {
      name: 'Redan länkad AB',
      organizationNumber: '556677-8899',
      tenantId: '777777',
      fortnoxCustomerNumber: 'EXTERNAL-7',
    })

    const firstBinding = await bind(db, {
      orgId: values.org,
      customerId: first.id,
      expectedVersion: first.version,
      profileId: values.admin,
    })
    assert.equal(firstBinding.rows[0].result_code, 'BOUND')

    const duplicateNumber = await bind(db, {
      orgId: values.org,
      customerId: second.id,
      expectedVersion: second.version,
      profileId: values.admin,
    })
    assertFailure(duplicateNumber.rows[0], 'LINK_CONFLICT')

    const differentExistingLink = await bind(db, {
      orgId: values.org,
      customerId: prelinked.id,
      expectedVersion: prelinked.version,
      profileId: values.admin,
      customerNumber: 'HUSHUB-1003',
    })
    assertFailure(differentExistingLink.rows[0], 'LINK_CONFLICT')

    const rows = await db.query<{
      id: string
      fortnox_tenant_id: string | null
      fortnox_customer_number: string | null
      version: number
    }>(
      `select id, fortnox_tenant_id, fortnox_customer_number, version
       from organization_customers
       where id = any($1::uuid[])
       order by id`,
      [[second.id, prelinked.id]]
    )
    const byId = new Map(rows.rows.map((row) => [row.id, row]))
    assert.deepEqual(
      {
        tenant: byId.get(second.id)?.fortnox_tenant_id,
        number: byId.get(second.id)?.fortnox_customer_number,
        version: Number(byId.get(second.id)?.version),
      },
      { tenant: null, number: null, version: 1 }
    )
    assert.deepEqual(
      {
        tenant: byId.get(prelinked.id)?.fortnox_tenant_id,
        number: byId.get(prelinked.id)?.fortnox_customer_number,
        version: Number(byId.get(prelinked.id)?.version),
      },
      { tenant: '777777', number: 'EXTERNAL-7', version: 1 }
    )
  } finally {
    await db.close()
  }
})

test('only service_role can execute the binding RPC', async () => {
  const db = await database()
  try {
    const privileges = await db.query<{
      public_can_execute: boolean
      anon_can_execute: boolean
      authenticated_can_execute: boolean
      service_can_execute: boolean
    }>(`
      select
        has_function_privilege(
          'public',
          'public.bind_organization_customer_to_fortnox(uuid,uuid,bigint,uuid,text,text)',
          'execute'
        ) as public_can_execute,
        has_function_privilege(
          'anon',
          'public.bind_organization_customer_to_fortnox(uuid,uuid,bigint,uuid,text,text)',
          'execute'
        ) as anon_can_execute,
        has_function_privilege(
          'authenticated',
          'public.bind_organization_customer_to_fortnox(uuid,uuid,bigint,uuid,text,text)',
          'execute'
        ) as authenticated_can_execute,
        has_function_privilege(
          'service_role',
          'public.bind_organization_customer_to_fortnox(uuid,uuid,bigint,uuid,text,text)',
          'execute'
        ) as service_can_execute
    `)
    assert.deepEqual(privileges.rows, [{
      public_can_execute: false,
      anon_can_execute: false,
      authenticated_can_execute: false,
      service_can_execute: true,
    }])

    await db.exec('set role authenticated')
    await assert.rejects(
      db.query(
        `select *
         from bind_organization_customer_to_fortnox($1, $2, 1, $3, '100001', 'HUSHUB-1001')`,
        [randomUUID(), randomUUID(), randomUUID()]
      ),
      /permission denied/
    )
  } finally {
    await db.close()
  }
})
