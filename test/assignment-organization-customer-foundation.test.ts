import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const customerFoundation = readFileSync(
  new URL('../docs/db/2026-09-10_05_organization_customers.sql', import.meta.url),
  'utf8'
).replace('create extension if not exists pgcrypto;', '')

const assignmentCustomerFoundation = readFileSync(
  new URL('../docs/db/2026-09-11_02_assignment_organization_customer.sql', import.meta.url),
  'utf8'
)

type ResultRow = {
  result_code: string
  assignment_id: string | null
  organization_customer_id: string | null
  assignment_updated_at: string | Date | null
  customer_number: number | null
  customer_version: number | null
  customer_created: boolean | null
}

type Fixture = {
  actor: string
  outsider: string
  inactiveMember: string
  orgA: string
  orgB: string
}

type Assignment = {
  id: string
  updatedAt: string
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
      org_id uuid not null references public.organizations (id) on delete cascade,
      profile_id uuid not null references public.profiles (id) on delete cascade,
      role text not null,
      is_active boolean not null default true,
      primary key (org_id, profile_id)
    );

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

    create function public.is_valid_swedish_organization_number(p_value text)
    returns boolean
    language sql
    immutable
    strict
    set search_path = ''
    as $$ select p_value ~ '^[0-9]{6}-[0-9]{4}$' $$;

    create table public.assignments (
      id uuid primary key,
      org_id uuid not null references public.organizations (id) on delete cascade,
      customer_name text,
      customer_email text not null,
      customer_phone text,
      customer_address text,
      customer_postal_code text,
      customer_city text,
      invoice_name text,
      invoice_email text,
      invoice_address text,
      personal_identity_number text,
      assignment_details jsonb not null default '{}'::jsonb,
      updated_by uuid references public.profiles (id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create function public.assignments_set_updated_at()
    returns trigger
    language plpgsql
    as $$
    begin
      new.updated_at = clock_timestamp();
      return new;
    end;
    $$;

    create trigger trg_assignments_set_updated_at
    before update on public.assignments
    for each row execute function public.assignments_set_updated_at();

    alter table public.assignments enable row level security;
    grant select, insert, update, delete on table public.assignments
      to authenticated, service_role;

    create policy assignments_member_all
      on public.assignments
      for all
      to authenticated
      using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
  `)

  await db.exec(customerFoundation)
  await db.exec(assignmentCustomerFoundation)
  await db.exec(assignmentCustomerFoundation)
  return db
}

async function fixture(db: PGlite): Promise<Fixture> {
  const values = {
    actor: randomUUID(),
    outsider: randomUUID(),
    inactiveMember: randomUUID(),
    orgA: randomUUID(),
    orgB: randomUUID(),
  }

  await db.query('insert into profiles (id) values ($1), ($2), ($3)', [
    values.actor,
    values.outsider,
    values.inactiveMember,
  ])
  await db.query(
    `insert into organizations (id, name)
     values ($1, 'Organisation A'), ($2, 'Organisation B')`,
    [values.orgA, values.orgB]
  )
  await db.query(
    `insert into org_members (org_id, profile_id, role, is_active)
     values
       ($1, $2, 'inspector', true),
       ($1, $3, 'admin', false)`,
    [values.orgA, values.actor, values.inactiveMember]
  )

  return values
}

async function insertAssignment(
  db: PGlite,
  values: Fixture,
  options: {
    orgId?: string
    name?: string | null
    email?: string
    invoiceName?: string | null
    invoiceEmail?: string | null
    invoiceAddress?: string | null
  } = {}
): Promise<Assignment> {
  const id = randomUUID()
  const result = await db.query<{ updated_at: string | Date }>(
    `insert into assignments (
       id,
       org_id,
       customer_name,
       customer_email,
       customer_phone,
       customer_address,
       customer_postal_code,
       customer_city,
       invoice_name,
       invoice_email,
       invoice_address,
       updated_by
     ) values (
       $1, $2, $3, $4, '+46701234567', 'Kundgatan 1', '111 22', 'Stockholm',
       $5, $6, $7, $8
     )
     returning updated_at`,
    [
      id,
      options.orgId ?? values.orgA,
      options.name === undefined ? 'Assignment snapshot' : options.name,
      options.email ?? 'assignment@example.test',
      options.invoiceName ?? null,
      options.invoiceEmail ?? null,
      options.invoiceAddress ?? null,
      values.actor,
    ]
  )
  return {
    id,
    updatedAt: new Date(result.rows[0].updated_at).toISOString(),
  }
}

async function updateAssignmentSnapshot(
  db: PGlite,
  assignmentId: string,
  field:
    | 'customer_name'
    | 'customer_email'
    | 'customer_phone'
    | 'customer_address'
    | 'customer_postal_code'
    | 'customer_city'
    | 'invoice_name'
    | 'invoice_email'
    | 'invoice_address',
  value: string
) {
  const result = await db.query<{ updated_at: string | Date }>(
    `update assignments
     set ${field} = $1
     where id = $2
     returning updated_at`,
    [value, assignmentId]
  )
  return new Date(result.rows[0].updated_at).toISOString()
}

async function insertCustomer(
  db: PGlite,
  values: Fixture,
  options: {
    orgId?: string
    name?: string
    organizationNumber?: string
    email?: string | null
    active?: boolean
    invoiceOverride?: boolean
  } = {}
) {
  const invoiceOverride = options.invoiceOverride ?? false
  const result = await db.query<{
    id: string
    customer_number: number
    version: number
  }>(
    `insert into organization_customers (
       org_id,
       customer_type,
       name,
       organization_number,
       email,
       phone,
       address,
       postal_code,
       city,
       invoice_same_as_customer,
       invoice_name,
       invoice_email,
       invoice_address,
       invoice_country_code,
       is_active,
       created_by_profile_id,
       updated_by_profile_id
     ) values (
       $1, 'business', $2, $3, $4, '+4685551234', 'Registergatan 7', '114 55', 'Stockholm',
       $5, $6, $7, $8, $9, $10, $11, $11
     )
     returning id, customer_number, version`,
    [
      options.orgId ?? values.orgA,
      options.name ?? 'Registerkund AB',
      options.organizationNumber ?? '556123-4567',
      options.email === undefined ? 'register@example.test' : options.email,
      !invoiceOverride,
      invoiceOverride ? 'Registerkund ekonomi' : null,
      invoiceOverride ? 'invoice@example.test' : null,
      invoiceOverride ? 'Fakturagatan 8' : null,
      invoiceOverride ? 'SE' : null,
      options.active ?? true,
      values.actor,
    ]
  )
  return {
    id: result.rows[0].id,
    number: Number(result.rows[0].customer_number),
    version: Number(result.rows[0].version),
  }
}

async function assign(
  db: PGlite,
  input: {
    orgId: string
    assignmentId: string
    assignmentUpdatedAt: string
    mode: 'existing' | 'create' | string
    actor: string
    customerId?: string | null
    customerVersion?: number | null
    customerType?: 'business' | 'private' | null
    identityNumber?: string | null
  }
) {
  return db.query<ResultRow>(
    `select *
     from assign_organization_customer($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.orgId,
      input.assignmentId,
      input.assignmentUpdatedAt,
      input.mode,
      input.customerId ?? null,
      input.customerVersion ?? null,
      input.customerType ?? null,
      input.identityNumber ?? null,
      input.actor,
    ]
  )
}

function assertFailure(row: ResultRow, resultCode: string) {
  assert.deepEqual(row, {
    result_code: resultCode,
    assignment_id: null,
    organization_customer_id: null,
    assignment_updated_at: null,
    customer_number: null,
    customer_version: null,
    customer_created: null,
  })
}

test('migration is repeatable and installs a same-organization server-managed relation', async () => {
  const db = await database()
  try {
    const values = await fixture(db)
    await db.exec('set role service_role')
    const assignment = await insertAssignment(db, values)
    const sameOrg = await insertCustomer(db, values)
    const otherOrg = await insertCustomer(db, values, {
      orgId: values.orgB,
      name: 'Annan organisation AB',
    })
    const inactive = await insertCustomer(db, values, {
      name: 'Inaktiv AB',
      organizationNumber: '556016-0680',
      active: false,
    })

    const schema = await db.query<{ definition: string }>(`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'public.assignments'::regclass
        and conname = 'assignments_organization_customer_fk'
    `)
    assert.equal(schema.rows.length, 1)
    assert.match(schema.rows[0].definition, /FOREIGN KEY \(org_id, organization_customer_id\)/)
    assert.match(schema.rows[0].definition, /organization_customers\(org_id, id\)/)

    const index = await db.query<{ count: number }>(`
      select count(*)::int as count
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'assignments_org_customer_idx'
    `)
    assert.equal(Number(index.rows[0].count), 1)

    await assert.rejects(
      db.query(
        'update assignments set organization_customer_id = $1 where id = $2',
        [otherOrg.id, assignment.id]
      ),
      /assignments_organization_customer_active_check|belongs to another organization/
    )
    await assert.rejects(
      db.query(
        'update assignments set organization_customer_id = $1 where id = $2',
        [inactive.id, assignment.id]
      ),
      /assignments_organization_customer_active_check|inactive/
    )

    await db.query(
      'update assignments set organization_customer_id = $1 where id = $2',
      [sameOrg.id, assignment.id]
    )
    await db.exec('reset role')
    await assert.rejects(
      db.query('delete from organization_customers where id = $1', [sameOrg.id]),
      /assignments_organization_customer_fk|foreign key constraint/
    )

    const privileges = await db.query<{
      public_execute: boolean
      anon_execute: boolean
      authenticated_execute: boolean
      service_execute: boolean
    }>(`
      select
        has_function_privilege(
          'public',
          'public.assign_organization_customer(uuid,uuid,timestamptz,text,uuid,bigint,text,text,uuid)',
          'execute'
        ) as public_execute,
        has_function_privilege(
          'anon',
          'public.assign_organization_customer(uuid,uuid,timestamptz,text,uuid,bigint,text,text,uuid)',
          'execute'
        ) as anon_execute,
        has_function_privilege(
          'authenticated',
          'public.assign_organization_customer(uuid,uuid,timestamptz,text,uuid,bigint,text,text,uuid)',
          'execute'
        ) as authenticated_execute,
        has_function_privilege(
          'service_role',
          'public.assign_organization_customer(uuid,uuid,timestamptz,text,uuid,bigint,text,text,uuid)',
          'execute'
        ) as service_execute
    `)
    assert.deepEqual(privileges.rows, [{
      public_execute: false,
      anon_execute: false,
      authenticated_execute: false,
      service_execute: true,
    }])

    const browserAssignment = await insertAssignment(db, values)
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [values.actor])
    await db.exec('set role authenticated')
    await assert.rejects(
      db.query(
        'update assignments set organization_customer_id = $1 where id = $2',
        [sameOrg.id, browserAssignment.id]
      ),
      /organization_customer_id is server-managed|permission denied/
    )
  } finally {
    await db.close()
  }
})

test('existing mode links an active customer, refreshes the snapshot and is idempotent', async () => {
  const db = await database()
  try {
    const values = await fixture(db)
    await db.exec('set role service_role')
    const firstAssignment = await insertAssignment(db, values)
    const secondAssignment = await insertAssignment(db, values)
    const customer = await insertCustomer(db, values, { invoiceOverride: true })

    const first = await assign(db, {
      orgId: values.orgA,
      assignmentId: firstAssignment.id,
      assignmentUpdatedAt: firstAssignment.updatedAt,
      mode: 'existing',
      actor: values.actor,
      customerId: customer.id,
      customerVersion: customer.version,
    })
    assert.equal(first.rows[0].result_code, 'LINKED')
    assert.equal(first.rows[0].assignment_id, firstAssignment.id)
    assert.equal(first.rows[0].organization_customer_id, customer.id)
    assert.equal(Number(first.rows[0].customer_number), customer.number)
    assert.equal(Number(first.rows[0].customer_version), customer.version)
    assert.equal(first.rows[0].customer_created, false)
    assert.ok(first.rows[0].assignment_updated_at)

    const snapshot = await db.query<{
      organization_customer_id: string
      customer_name: string
      customer_email: string
      customer_phone: string
      customer_address: string
      customer_postal_code: string
      customer_city: string
      invoice_name: string
      invoice_email: string
      invoice_address: string
      assignment_details: { customerType?: string }
      updated_by: string
    }>(
      `select
         organization_customer_id,
         customer_name,
         customer_email,
         customer_phone,
         customer_address,
         customer_postal_code,
         customer_city,
         invoice_name,
         invoice_email,
         invoice_address,
         assignment_details,
         updated_by
       from assignments
       where id = $1`,
      [firstAssignment.id]
    )
    assert.deepEqual(snapshot.rows, [{
      organization_customer_id: customer.id,
      customer_name: 'Registerkund AB',
      customer_email: 'register@example.test',
      customer_phone: '+4685551234',
      customer_address: 'Registergatan 7',
      customer_postal_code: '114 55',
      customer_city: 'Stockholm',
      invoice_name: 'Registerkund ekonomi',
      invoice_email: 'invoice@example.test',
      invoice_address: 'Fakturagatan 8',
      assignment_details: { customerType: 'business' },
      updated_by: values.actor,
    }])

    const retry = await assign(db, {
      orgId: values.orgA,
      assignmentId: firstAssignment.id,
      assignmentUpdatedAt: firstAssignment.updatedAt,
      mode: 'existing',
      actor: values.actor,
      customerId: customer.id,
      customerVersion: customer.version,
    })
    assert.equal(retry.rows[0].result_code, 'ALREADY_LINKED')
    assert.equal(retry.rows[0].organization_customer_id, customer.id)

    const second = await assign(db, {
      orgId: values.orgA,
      assignmentId: secondAssignment.id,
      assignmentUpdatedAt: secondAssignment.updatedAt,
      mode: 'existing',
      actor: values.actor,
      customerId: customer.id,
      customerVersion: customer.version,
    })
    assert.equal(second.rows[0].result_code, 'LINKED')

    const usage = await db.query<{ count: number }>(
      'select count(*)::int as count from assignments where organization_customer_id = $1',
      [customer.id]
    )
    assert.equal(Number(usage.rows[0].count), 2)
  } finally {
    await db.close()
  }
})

test('existing mode fails closed for authorization, organization, state and versions', async () => {
  const db = await database()
  try {
    const values = await fixture(db)
    await db.exec('set role service_role')
    const customer = await insertCustomer(db, values)
    const inactive = await insertCustomer(db, values, {
      name: 'Inaktiv AB',
      organizationNumber: '556016-0680',
      active: false,
    })
    const noEmail = await insertCustomer(db, values, {
      name: 'Utan e-post AB',
      organizationNumber: '556677-8899',
      email: null,
    })
    const otherOrg = await insertCustomer(db, values, {
      orgId: values.orgB,
      name: 'Annan org AB',
    })

    const cases: Array<{
      expected: string
      assignment: Assignment
      actor?: string
      assignmentUpdatedAt?: string
      customerId?: string
      customerVersion?: number
    }> = [
      {
        expected: 'MEMBER_REQUIRED',
        assignment: await insertAssignment(db, values),
        actor: values.outsider,
      },
      {
        expected: 'MEMBER_REQUIRED',
        assignment: await insertAssignment(db, values),
        actor: values.inactiveMember,
      },
      {
        expected: 'ASSIGNMENT_VERSION_CONFLICT',
        assignment: await insertAssignment(db, values),
        assignmentUpdatedAt: '2000-01-01T00:00:00.000Z',
      },
      {
        expected: 'CUSTOMER_NOT_FOUND',
        assignment: await insertAssignment(db, values),
        customerId: otherOrg.id,
      },
      {
        expected: 'CUSTOMER_INACTIVE',
        assignment: await insertAssignment(db, values),
        customerId: inactive.id,
        customerVersion: inactive.version,
      },
      {
        expected: 'CUSTOMER_VERSION_CONFLICT',
        assignment: await insertAssignment(db, values),
        customerVersion: customer.version + 1,
      },
      {
        expected: 'CUSTOMER_EMAIL_REQUIRED',
        assignment: await insertAssignment(db, values),
        customerId: noEmail.id,
        customerVersion: noEmail.version,
      },
    ]

    for (const item of cases) {
      const response = await assign(db, {
        orgId: values.orgA,
        assignmentId: item.assignment.id,
        assignmentUpdatedAt: item.assignmentUpdatedAt ?? item.assignment.updatedAt,
        mode: 'existing',
        actor: item.actor ?? values.actor,
        customerId: item.customerId ?? customer.id,
        customerVersion: item.customerVersion ?? customer.version,
      })
      assertFailure(response.rows[0], item.expected)
    }

    const missing = await assign(db, {
      orgId: values.orgA,
      assignmentId: randomUUID(),
      assignmentUpdatedAt: new Date().toISOString(),
      mode: 'existing',
      actor: values.actor,
      customerId: customer.id,
      customerVersion: customer.version,
    })
    assertFailure(missing.rows[0], 'ASSIGNMENT_NOT_FOUND')

    const conflictAssignment = await insertAssignment(db, values)
    const linked = await assign(db, {
      orgId: values.orgA,
      assignmentId: conflictAssignment.id,
      assignmentUpdatedAt: conflictAssignment.updatedAt,
      mode: 'existing',
      actor: values.actor,
      customerId: customer.id,
      customerVersion: customer.version,
    })
    assert.equal(linked.rows[0].result_code, 'LINKED')
    const conflictingCustomer = await insertCustomer(db, values, {
      name: 'Konflikt AB',
      organizationNumber: '556765-4321',
    })
    const conflict = await assign(db, {
      orgId: values.orgA,
      assignmentId: conflictAssignment.id,
      assignmentUpdatedAt: firstDate(linked.rows[0].assignment_updated_at),
      mode: 'existing',
      actor: values.actor,
      customerId: conflictingCustomer.id,
      customerVersion: conflictingCustomer.version,
    })
    assertFailure(conflict.rows[0], 'LINK_CONFLICT')
  } finally {
    await db.close()
  }
})

function firstDate(value: string | Date | null) {
  assert.ok(value)
  return new Date(value).toISOString()
}

test('create mode snapshots once, does not match private customers and reports identity conflicts', async () => {
  const db = await database()
  try {
    const values = await fixture(db)
    await db.exec('set role service_role')
    const assignment = await insertAssignment(db, values, {
      name: 'Privatkund',
      email: 'PRIVATE@EXAMPLE.TEST',
      invoiceName: 'Privatkund faktura',
      invoiceEmail: 'billing@example.test',
      invoiceAddress: 'Fakturaadress 9',
    })

    const created = await assign(db, {
      orgId: values.orgA,
      assignmentId: assignment.id,
      assignmentUpdatedAt: assignment.updatedAt,
      mode: 'create',
      actor: values.actor,
      customerType: 'private',
      identityNumber: null,
    })
    assert.equal(created.rows[0].result_code, 'CREATED_AND_LINKED')
    assert.equal(created.rows[0].assignment_id, assignment.id)
    assert.ok(created.rows[0].organization_customer_id)
    assert.equal(Number(created.rows[0].customer_number), 1001)
    assert.equal(Number(created.rows[0].customer_version), 1)
    assert.equal(created.rows[0].customer_created, true)

    const linkedAssignment = await db.query<{ assignment_details: { customerType?: string } }>(
      'select assignment_details from assignments where id = $1',
      [assignment.id]
    )
    assert.deepEqual(linkedAssignment.rows[0].assignment_details, { customerType: 'consumer' })

    const stored = await db.query<{
      customer_type: string
      name: string
      email: string
      phone: string
      address: string
      postal_code: string
      city: string
      invoice_same_as_customer: boolean
      invoice_name: string
      invoice_email: string
      invoice_address: string
      invoice_country_code: string
    }>(
      `select
         customer_type,
         name,
         email,
         phone,
         address,
         postal_code,
         city,
         invoice_same_as_customer,
         invoice_name,
         invoice_email,
         invoice_address,
         invoice_country_code
       from organization_customers
       where id = $1`,
      [created.rows[0].organization_customer_id]
    )
    assert.deepEqual(stored.rows, [{
      customer_type: 'private',
      name: 'Privatkund',
      email: 'private@example.test',
      phone: '+46701234567',
      address: 'Kundgatan 1',
      postal_code: '111 22',
      city: 'Stockholm',
      invoice_same_as_customer: false,
      invoice_name: 'Privatkund faktura',
      invoice_email: 'billing@example.test',
      invoice_address: 'Fakturaadress 9',
      invoice_country_code: 'SE',
    }])

    const retry = await assign(db, {
      orgId: values.orgA,
      assignmentId: assignment.id,
      assignmentUpdatedAt: assignment.updatedAt,
      mode: 'create',
      actor: values.actor,
      customerType: 'private',
      identityNumber: null,
    })
    assert.equal(retry.rows[0].result_code, 'ALREADY_LINKED')
    assert.equal(retry.rows[0].organization_customer_id, created.rows[0].organization_customer_id)

    const samePersonAssignment = await insertAssignment(db, values, {
      name: 'Privatkund',
      email: 'private@example.test',
    })
    const separatePrivateCustomer = await assign(db, {
      orgId: values.orgA,
      assignmentId: samePersonAssignment.id,
      assignmentUpdatedAt: samePersonAssignment.updatedAt,
      mode: 'create',
      actor: values.actor,
      customerType: 'private',
      identityNumber: null,
    })
    assert.equal(separatePrivateCustomer.rows[0].result_code, 'CREATED_AND_LINKED')
    assert.notEqual(
      separatePrivateCustomer.rows[0].organization_customer_id,
      created.rows[0].organization_customer_id
    )

    const firstBusinessAssignment = await insertAssignment(db, values, {
      name: 'Unikt AB',
      email: 'foretag@example.test',
    })
    const firstBusiness = await assign(db, {
      orgId: values.orgA,
      assignmentId: firstBusinessAssignment.id,
      assignmentUpdatedAt: firstBusinessAssignment.updatedAt,
      mode: 'create',
      actor: values.actor,
      customerType: 'business',
      identityNumber: '556123-4567',
    })
    assert.equal(firstBusiness.rows[0].result_code, 'CREATED_AND_LINKED')

    const duplicateBusinessAssignment = await insertAssignment(db, values, {
      name: 'Samma organisationsnummer AB',
      email: 'annan@example.test',
    })
    const duplicateBusiness = await assign(db, {
      orgId: values.orgA,
      assignmentId: duplicateBusinessAssignment.id,
      assignmentUpdatedAt: duplicateBusinessAssignment.updatedAt,
      mode: 'create',
      actor: values.actor,
      customerType: 'business',
      identityNumber: '556123-4567',
    })
    assertFailure(duplicateBusiness.rows[0], 'CUSTOMER_IDENTITY_CONFLICT')

    const customerCount = await db.query<{ count: number }>(
      'select count(*)::int as count from organization_customers where org_id = $1',
      [values.orgA]
    )
    assert.equal(Number(customerCount.rows[0].count), 3)
  } finally {
    await db.close()
  }
})

test('create mode validates its tagged input and the assignment snapshot', async () => {
  const db = await database()
  try {
    const values = await fixture(db)
    await db.exec('set role service_role')
    const missingName = await insertAssignment(db, values, { name: null })

    const incomplete = await assign(db, {
      orgId: values.orgA,
      assignmentId: missingName.id,
      assignmentUpdatedAt: missingName.updatedAt,
      mode: 'create',
      actor: values.actor,
      customerType: 'private',
      identityNumber: null,
    })
    assertFailure(incomplete.rows[0], 'CUSTOMER_SNAPSHOT_INCOMPLETE')

    const assignment = await insertAssignment(db, values)
    for (const invalid of [
      {
        customerType: 'business' as const,
        identityNumber: null,
      },
      {
        customerType: 'private' as const,
        identityNumber: ' 900101-1234',
      },
    ]) {
      const response = await assign(db, {
        orgId: values.orgA,
        assignmentId: assignment.id,
        assignmentUpdatedAt: assignment.updatedAt,
        mode: 'create',
        actor: values.actor,
        ...invalid,
      })
      assertFailure(response.rows[0], 'INVALID_REQUEST')
    }
  } finally {
    await db.close()
  }
})

test('create mode rejects unsafe snapshot text and invalid email without partial writes', async () => {
  const db = await database()
  try {
    const values = await fixture(db)
    await db.exec('set role service_role')
    const invalidSnapshots: Array<{
      field: Parameters<typeof updateAssignmentSnapshot>[2]
      value: string
    }> = [
      { field: 'customer_name', value: 'Otillåtet\nnamn' },
      { field: 'customer_email', value: 'kund\u0007@example.test' },
      { field: 'customer_phone', value: '070\t1234567' },
      { field: 'customer_address', value: 'Kundgatan\n1' },
      { field: 'customer_postal_code', value: '111\r22' },
      { field: 'customer_city', value: 'Stock\u007fholm' },
      { field: 'invoice_name', value: 'Faktura\nnamn' },
      { field: 'invoice_email', value: 'faktura\u0007@example.test' },
      { field: 'invoice_address', value: 'Fakturagatan\n2' },
      { field: 'customer_email', value: 'saknar-snabel-a.example.test' },
      { field: 'invoice_email', value: 'ogiltig-fakturaadress' },
    ]
    const assignmentIds: string[] = []

    for (const invalid of invalidSnapshots) {
      const assignment = await insertAssignment(db, values)
      assignmentIds.push(assignment.id)
      const updatedAt = await updateAssignmentSnapshot(
        db,
        assignment.id,
        invalid.field,
        invalid.value
      )
      const response = await assign(db, {
        orgId: values.orgA,
        assignmentId: assignment.id,
        assignmentUpdatedAt: updatedAt,
        mode: 'create',
        actor: values.actor,
        customerType: 'private',
        identityNumber: null,
      })
      assertFailure(
        response.rows[0],
        'CUSTOMER_SNAPSHOT_INCOMPLETE'
      )
    }

    const customers = await db.query<{ count: number }>(
      'select count(*)::int as count from organization_customers where org_id = $1',
      [values.orgA]
    )
    assert.equal(Number(customers.rows[0].count), 0)

    const assignments = await db.query<{
      id: string
      organization_customer_id: string | null
    }>(
      `select id, organization_customer_id
       from assignments
       where id = any($1::uuid[])
       order by id`,
      [assignmentIds]
    )
    assert.equal(assignments.rows.length, invalidSnapshots.length)
    assert.ok(
      assignments.rows.every(
        (assignment) => assignment.organization_customer_id === null
      )
    )
  } finally {
    await db.close()
  }
})
