import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(
  new URL('../docs/db/2026-09-10_05_organization_customers.sql', import.meta.url),
  'utf8'
).replace('create extension if not exists pgcrypto;', '')

async function database() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;

    create table public.profiles (
      id uuid primary key
    );

    create table public.organizations (
      id uuid primary key,
      name text not null
    );

    create function public.is_valid_swedish_organization_number(p_value text)
    returns boolean
    language plpgsql
    immutable
    strict
    set search_path = ''
    as $$
    declare
      compact_value text;
      checksum integer := 0;
      digit integer;
      position integer;
    begin
      if p_value !~ '^[0-9]{6}-[0-9]{4}$' then
        return false;
      end if;
      compact_value := replace(p_value, '-', '');
      for position in 1..10 loop
        digit := substring(compact_value from position for 1)::integer;
        if mod(position, 2) = 1 then
          digit := digit * 2;
          if digit > 9 then digit := digit - 9; end if;
        end if;
        checksum := checksum + digit;
      end loop;
      return mod(checksum, 10) = 0;
    end;
    $$;
  `)

  await db.exec(migration)
  await db.exec(migration)
  return db
}

type Fixture = {
  admin: string
  orgA: string
  orgB: string
}

async function fixture(db: PGlite): Promise<Fixture> {
  const admin = randomUUID()
  const orgA = randomUUID()
  const orgB = randomUUID()
  await db.query('insert into profiles (id) values ($1)', [admin])
  await db.query(
    "insert into organizations (id, name) values ($1, 'Organisation A'), ($2, 'Organisation B')",
    [orgA, orgB]
  )
  return { admin, orgA, orgB }
}

async function insertBusiness(
  db: PGlite,
  fixtureValue: Fixture,
  orgId: string,
  organizationNumber: string,
  name = 'Testkund AB'
) {
  return db.query<{ id: string; customer_number: number; version: number }>(
    `insert into organization_customers (
       org_id, customer_type, name, organization_number, created_by_profile_id,
       updated_by_profile_id
     ) values ($1, 'business', $2, $3, $4, $4)
     returning id, customer_number, version`,
    [orgId, name, organizationNumber, fixtureValue.admin]
  )
}

test('migration is repeatable and allocates customer numbers independently from 1001', async () => {
  const db = await database()
  try {
    const ids = await fixture(db)
    await db.exec('set role service_role')

    const first = await insertBusiness(db, ids, ids.orgA, '556123-4567', 'Första AB')
    const second = await insertBusiness(db, ids, ids.orgA, '556765-4321', 'Andra AB')
    const otherOrg = await insertBusiness(db, ids, ids.orgB, '556123-4567', 'Första i B AB')

    assert.deepEqual(first.rows.map((row) => Number(row.customer_number)), [1001])
    assert.deepEqual(second.rows.map((row) => Number(row.customer_number)), [1002])
    assert.deepEqual(otherOrg.rows.map((row) => Number(row.customer_number)), [1001])
  } finally {
    await db.close()
  }
})
test('customer identity stays unique inside one organization even after deactivation', async () => {
  const db = await database()
  try {
    const ids = await fixture(db)
    await db.exec('set role service_role')
    const inserted = await insertBusiness(db, ids, ids.orgA, '556123-4567')
    await db.query('update organization_customers set is_active = false where id = $1', [
      inserted.rows[0].id,
    ])

    await assert.rejects(
      insertBusiness(db, ids, ids.orgA, '556123-4567', 'Dubblett AB'),
      /organization_customers_organization_number_uidx|duplicate key|unique constraint/
    )
    await assert.doesNotReject(
      insertBusiness(db, ids, ids.orgB, '556123-4567', 'Separat organisation AB')
    )
  } finally {
    await db.close()
  }
})

test('trigger keeps organization and customer number immutable and increments version', async () => {
  const db = await database()
  try {
    const ids = await fixture(db)
    await db.exec('set role service_role')
    const inserted = await insertBusiness(db, ids, ids.orgA, '556123-4567')
    const customer = inserted.rows[0]

    const updated = await db.query<{
      org_id: string
      customer_number: number
      version: number
      name: string
    }>(
      `update organization_customers
       set org_id = $1, customer_number = 9999, name = 'Nytt namn AB'
       where id = $2
       returning org_id, customer_number, version, name`,
      [ids.orgB, customer.id]
    )

    assert.equal(updated.rows[0].org_id, ids.orgA)
    assert.equal(Number(updated.rows[0].customer_number), 1001)
    assert.equal(Number(updated.rows[0].version), 2)
    assert.equal(updated.rows[0].name, 'Nytt namn AB')
  } finally {
    await db.close()
  }
})

test('database rejects incomplete invoice and Fortnox field groups', async () => {
  const db = await database()
  try {
    const ids = await fixture(db)
    await db.exec('set role service_role')

    await assert.rejects(
      db.query(
        `insert into organization_customers (
           org_id, customer_type, name, organization_number,
           invoice_same_as_customer, invoice_name
         ) values ($1, 'business', 'Fakturakund AB', '556123-4567', false, 'Ekonomi')`,
        [ids.orgA]
      ),
      /organization_customers_invoice_override_check/
    )

    for (const fragment of [
      "fortnox_synced_at) values ($1, 'business', 'Kund AB', '556123-4567', now())",
      "fortnox_tenant_id, fortnox_synced_at) values ($1, 'business', 'Kund AB', '556123-4567', '123', now())",
      "fortnox_customer_number, fortnox_synced_at) values ($1, 'business', 'Kund AB', '556123-4567', '1001', now())",
    ]) {
      await assert.rejects(
        db.query(
          `insert into organization_customers
             (org_id, customer_type, name, organization_number, ${fragment}`,
          [ids.orgA]
        ),
        /organization_customers_fortnox_pair_check/
      )
    }
  } finally {
    await db.close()
  }
})

test('browser roles cannot read the register and service role cannot hard-delete customers', async () => {
  const db = await database()
  try {
    const ids = await fixture(db)
    await db.exec('set role service_role')
    const inserted = await insertBusiness(db, ids, ids.orgA, '556123-4567')

    await assert.rejects(
      db.query('delete from organization_customers where id = $1', [inserted.rows[0].id]),
      /permission denied/
    )

    await db.exec('reset role')
    await db.exec('set role authenticated')
    await assert.rejects(
      db.query('select id from organization_customers'),
      /permission denied/
    )
  } finally {
    await db.close()
  }
})
