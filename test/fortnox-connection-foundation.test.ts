import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(
  new URL('../docs/db/2026-09-09_05_fortnox_connection_foundation.sql', import.meta.url),
  'utf8'
)

const REAUTHORIZATION_ERRORS = [
  'FORTNOX_ACCESS_TOKEN_REJECTED',
  'FORTNOX_CLIENT_CREDENTIALS_REJECTED',
  'FORTNOX_COMPANY_VERIFICATION_FAILED',
  'FORTNOX_INVALID_TENANT',
  'FORTNOX_ORGANIZATION_MISMATCH',
  'FORTNOX_PERMISSION_OR_LICENSE_MISSING',
  'FORTNOX_REQUIRED_SCOPE_MISSING',
] as const

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
  await db.exec(migration)
  return db
}

test('migration binds one normalized Fortnox company and TenantId to one HusHub organization', async () => {
  const db = await database()
  try {
    const admin = randomUUID()
    const otherAdmin = randomUUID()
    const org = randomUUID()
    const otherOrg = randomUUID()

    await db.query('insert into profiles (id) values ($1), ($2)', [admin, otherAdmin])
    await db.query(
      `insert into organizations (id, name, organization_number)
       values ($1, 'HusHub One', '556123-4567'), ($2, 'HusHub Two', '556765-4321')`,
      [org, otherOrg]
    )

    await assert.rejects(
      db.query("update organizations set organization_number = '5561234567' where id = $1", [org]),
      /organizations_organization_number_check/
    )
    await assert.rejects(
      db.query("update organizations set organization_number = '556123-4568' where id = $1", [org]),
      /organizations_organization_number_check/
    )

    await db.query(
      `insert into fortnox_connections
        (org_id, tenant_id, company_name, company_organization_number, granted_scopes, connected_by_profile_id)
       values ($1, '100001', 'HusHub One AB', '556123-4567', array['companyinformation'], $2)`,
      [org, admin]
    )

    await assert.rejects(
      db.query(
        `insert into fortnox_connections
          (org_id, tenant_id, company_name, company_organization_number, granted_scopes)
         values ($1, '100002', 'Duplicate org', '556123-4567', array['companyinformation'])`,
        [org]
      ),
      /duplicate key|unique constraint/
    )

    await assert.rejects(
      db.query(
        `insert into fortnox_connections
          (org_id, tenant_id, company_name, company_organization_number, granted_scopes)
         values ($1, '100001', 'HusHub Two AB', '556765-4321', array['companyinformation'])`,
        [otherOrg]
      ),
      /fortnox_connections_tenant_id_key/
    )

    await assert.rejects(
      db.query(
        `insert into fortnox_connections
          (org_id, tenant_id, company_name, company_organization_number, granted_scopes)
         values ($1, '100003', 'Wrong company', '556123-4567', array['companyinformation'])`,
        [otherOrg]
      ),
      /fortnox_connections_org_company_number_fkey/
    )

    await assert.rejects(
      db.query(
        `update fortnox_connections
         set granted_scopes = array['customer']
         where org_id = $1`,
        [org]
      ),
      /fortnox_connections_scopes_check/
    )
    await assert.rejects(
      db.query(
        `update fortnox_connections
         set granted_scopes = array['companyinformation', 'customer']
         where org_id = $1`,
        [org]
      ),
      /fortnox_connections_scopes_check/
    )
  } finally {
    await db.close()
  }
})

test('organization number is checksum-valid and browser roles cannot bypass the server route', async () => {
  const db = await database()
  try {
    const profile = randomUUID()
    const org = randomUUID()
    await db.query('insert into profiles (id) values ($1)', [profile])
    await db.query(
      "insert into organizations (id, name, created_by) values ($1, 'Protected org', $2)",
      [org, profile]
    )

    await db.exec('set role authenticated')
    await assert.rejects(
      db.query(
        "update organizations set organization_number = '556123-4567' where id = $1",
        [org]
      ),
      /organization_number is server-managed/
    )

    await db.exec('reset role')
    await db.exec('set role service_role')
    await db.query(
      "update organizations set organization_number = '556123-4567' where id = $1",
      [org]
    )
    const stored = await db.query<{ organization_number: string }>(
      'select organization_number from organizations where id = $1',
      [org]
    )
    assert.deepEqual(stored.rows, [{ organization_number: '556123-4567' }])
  } finally {
    await db.close()
  }
})

test('OAuth state is profile-bound, expiring and consumable exactly once', async () => {
  const db = await database()
  try {
    const admin = randomUUID()
    const otherAdmin = randomUUID()
    const org = randomUUID()
    const hash = 'a'.repeat(64)

    await db.query('insert into profiles (id) values ($1), ($2)', [admin, otherAdmin])
    await db.query(
      "insert into organizations (id, name, organization_number) values ($1, 'HusHub', '556123-4567')",
      [org]
    )
    await db.query(
      `insert into fortnox_oauth_states
        (state_hash, org_id, initiated_by_profile_id, requested_scopes, expires_at)
       values ($1, $2, $3, array['companyinformation'], now() + interval '10 minutes')`,
      [hash, org, admin]
    )

    await db.exec('set role service_role')
    const wrongUser = await db.query(
      'select * from consume_fortnox_oauth_state($1, $2)',
      [hash, otherAdmin]
    )
    assert.equal(wrongUser.rows.length, 0)

    const first = await db.query<{ org_id: string; requested_scopes: string[] }>(
      'select * from consume_fortnox_oauth_state($1, $2)',
      [hash, admin]
    )
    assert.deepEqual(first.rows, [
      { org_id: org, requested_scopes: ['companyinformation'] },
    ])

    const replay = await db.query(
      'select * from consume_fortnox_oauth_state($1, $2)',
      [hash, admin]
    )
    assert.equal(replay.rows.length, 0)

    await db.exec('reset role')
    await db.query(
      `insert into fortnox_oauth_states
        (state_hash, org_id, initiated_by_profile_id, requested_scopes, created_at, expires_at)
       values ($1, $2, $3, array['companyinformation'], now() - interval '12 minutes', now() - interval '2 minutes')`,
      ['b'.repeat(64), org, admin]
    )
    await db.exec('set role service_role')
    const expired = await db.query(
      'select * from consume_fortnox_oauth_state($1, $2)',
      ['b'.repeat(64), admin]
    )
    assert.equal(expired.rows.length, 0)
  } finally {
    await db.close()
  }
})

test('only the newest OAuth attempt can persist a Fortnox connection', async () => {
  const db = await database()
  try {
    const admin = randomUUID()
    const org = randomUUID()
    const olderHash = 'd'.repeat(64)
    const newerHash = 'e'.repeat(64)

    await db.query('insert into profiles (id) values ($1)', [admin])
    await db.query(
      "insert into organizations (id, name, organization_number) values ($1, 'HusHub', '556123-4567')",
      [org]
    )
    await db.exec('set role service_role')

    await db.query(
      `select create_fortnox_oauth_state(
        $1, $2, $3, array['companyinformation'], now() + interval '10 minutes'
      )`,
      [olderHash, org, admin]
    )
    const consumedOlder = await db.query(
      'select * from consume_fortnox_oauth_state($1, $2)',
      [olderHash, admin]
    )
    assert.equal(consumedOlder.rows.length, 1)

    await db.query(
      `select create_fortnox_oauth_state(
        $1, $2, $3, array['companyinformation'], now() + interval '10 minutes'
      )`,
      [newerHash, org, admin]
    )

    const olderSave = await db.query<{ saved: boolean }>(
      `select save_fortnox_connection_from_oauth_state(
        $1, $2, '100001', 'Older callback AB', '556123-4567',
        array['companyinformation'], now()
      ) as saved`,
      [olderHash, admin]
    )
    assert.deepEqual(olderSave.rows, [{ saved: false }])

    const beforeNewestSave = await db.query(
      'select org_id from fortnox_connections where org_id = $1',
      [org]
    )
    assert.equal(beforeNewestSave.rows.length, 0)

    const consumedNewest = await db.query(
      'select * from consume_fortnox_oauth_state($1, $2)',
      [newerHash, admin]
    )
    assert.equal(consumedNewest.rows.length, 1)

    const newestSave = await db.query<{ saved: boolean }>(
      `select save_fortnox_connection_from_oauth_state(
        $1, $2, '100002', 'Newest callback AB', '556123-4567',
        array['companyinformation'], now()
      ) as saved`,
      [newerHash, admin]
    )
    assert.deepEqual(newestSave.rows, [{ saved: true }])

    const replayedOlderSave = await db.query<{ saved: boolean }>(
      `select save_fortnox_connection_from_oauth_state(
        $1, $2, '100003', 'Replayed older callback AB', '556123-4567',
        array['companyinformation'], now()
      ) as saved`,
      [olderHash, admin]
    )
    assert.deepEqual(replayedOlderSave.rows, [{ saved: false }])

    const connection = await db.query<{
      tenant_id: string
      company_name: string
      connected_by_profile_id: string
    }>(
      `select tenant_id, company_name, connected_by_profile_id
       from fortnox_connections
       where org_id = $1`,
      [org]
    )
    assert.deepEqual(connection.rows, [
      {
        tenant_id: '100002',
        company_name: 'Newest callback AB',
        connected_by_profile_id: admin,
      },
    ])
  } finally {
    await db.close()
  }
})

test('live verification uses connection versions so stale results cannot overwrite reconnects', async () => {
  const db = await database()
  try {
    const admin = randomUUID()
    const org = randomUUID()
    const sameTenantReconnectHash = 'f'.repeat(64)
    const newTenantReconnectHash = '1'.repeat(64)

    await db.query('insert into profiles (id) values ($1)', [admin])
    await db.query(
      "insert into organizations (id, name, organization_number) values ($1, 'HusHub', '556123-4567')",
      [org]
    )
    await db.query(
      `insert into fortnox_connections
        (org_id, tenant_id, company_name, company_organization_number, granted_scopes)
       values ($1, '100001', 'Initial AB', '556123-4567', array['companyinformation'])`,
      [org]
    )
    await db.exec('set role service_role')

    const verified = await db.query<{
      company_name: string
      status: string
      connection_version: number
      last_verified_at: string
    }>(
      `select company_name, status, connection_version, last_verified_at
       from apply_fortnox_connection_verification(
         $1, '100001', 1, 'Verified AB', array['companyinformation'], null
       )`,
      [org]
    )
    assert.equal(verified.rows.length, 1)
    assert.equal(verified.rows[0].company_name, 'Verified AB')
    assert.equal(verified.rows[0].status, 'connected')
    assert.equal(Number(verified.rows[0].connection_version), 2)
    assert.ok(new Date(verified.rows[0].last_verified_at).getTime() > 0)

    const parallelStale = await db.query(
      `select * from apply_fortnox_connection_verification(
        $1, '100001', 1, null, null, 'FORTNOX_ACCESS_TOKEN_REJECTED'
      )`,
      [org]
    )
    assert.equal(parallelStale.rows.length, 0)

    const reauthorization = await db.query<{
      status: string
      connection_version: number
    }>(
      `select status, connection_version
       from apply_fortnox_connection_verification(
         $1, '100001', 2, null, null, 'FORTNOX_ACCESS_TOKEN_REJECTED'
       )`,
      [org]
    )
    assert.deepEqual(reauthorization.rows.map((row) => ({
      status: row.status,
      connection_version: Number(row.connection_version),
    })), [{ status: 'needs_reauthorization', connection_version: 3 }])

    await db.query(
      `select create_fortnox_oauth_state(
        $1, $2, $3, array['companyinformation'], now() + interval '10 minutes'
      )`,
      [sameTenantReconnectHash, org, admin]
    )
    await db.query('select * from consume_fortnox_oauth_state($1, $2)', [
      sameTenantReconnectHash,
      admin,
    ])
    const sameTenantSave = await db.query<{ saved: boolean }>(
      `select save_fortnox_connection_from_oauth_state(
        $1, $2, '100001', 'Same tenant reconnect AB', '556123-4567',
        array['companyinformation'], now()
      ) as saved`,
      [sameTenantReconnectHash, admin]
    )
    assert.deepEqual(sameTenantSave.rows, [{ saved: true }])

    const staleAfterSameTenantReconnect = await db.query(
      `select * from apply_fortnox_connection_verification(
        $1, '100001', 3, null, null, 'FORTNOX_CLIENT_CREDENTIALS_REJECTED'
      )`,
      [org]
    )
    assert.equal(staleAfterSameTenantReconnect.rows.length, 0)

    await db.query(
      `select create_fortnox_oauth_state(
        $1, $2, $3, array['companyinformation'], now() + interval '10 minutes'
      )`,
      [newTenantReconnectHash, org, admin]
    )
    await db.query('select * from consume_fortnox_oauth_state($1, $2)', [
      newTenantReconnectHash,
      admin,
    ])
    const newTenantSave = await db.query<{ saved: boolean }>(
      `select save_fortnox_connection_from_oauth_state(
        $1, $2, '100002', 'New tenant reconnect AB', '556123-4567',
        array['companyinformation'], now()
      ) as saved`,
      [newTenantReconnectHash, admin]
    )
    assert.deepEqual(newTenantSave.rows, [{ saved: true }])

    const staleAfterNewTenantReconnect = await db.query(
      `select * from apply_fortnox_connection_verification(
        $1, '100001', 4, 'Stale AB', array['companyinformation'], null
      )`,
      [org]
    )
    assert.equal(staleAfterNewTenantReconnect.rows.length, 0)

    const current = await db.query<{
      tenant_id: string
      company_name: string
      status: string
      connection_version: number
    }>(
      `select tenant_id, company_name, status, connection_version
       from fortnox_connections where org_id = $1`,
      [org]
    )
    assert.deepEqual(current.rows.map((row) => ({
      ...row,
      connection_version: Number(row.connection_version),
    })), [{
      tenant_id: '100002',
      company_name: 'New tenant reconnect AB',
      status: 'connected',
      connection_version: 5,
    }])

    await db.query('delete from fortnox_connections where org_id = $1', [org])
    const staleAfterDelete = await db.query(
      `select * from apply_fortnox_connection_verification(
        $1, '100002', 5, 'Deleted AB', array['companyinformation'], null
      )`,
      [org]
    )
    assert.equal(staleAfterDelete.rows.length, 0)
  } finally {
    await db.close()
  }
})

test('database verification RPC accepts exactly the permanent reauthorization error contract', async () => {
  const db = await database()
  try {
    const org = randomUUID()
    await db.query(
      "insert into organizations (id, name, organization_number) values ($1, 'HusHub', '556123-4567')",
      [org]
    )
    await db.query(
      `insert into fortnox_connections
        (org_id, tenant_id, company_name, company_organization_number, granted_scopes)
       values ($1, '100001', 'HusHub AB', '556123-4567', array['companyinformation'])`,
      [org]
    )
    await db.exec('set role service_role')

    let expectedVersion = 1
    for (const errorCode of REAUTHORIZATION_ERRORS) {
      const applied = await db.query<{ status: string; connection_version: number }>(
        `select status, connection_version
         from apply_fortnox_connection_verification(
           $1, '100001', $2, null, null, $3
         )`,
        [org, expectedVersion, errorCode]
      )
      expectedVersion += 1
      assert.deepEqual(applied.rows.map((row) => ({
        status: row.status,
        connection_version: Number(row.connection_version),
      })), [{
        status: 'needs_reauthorization',
        connection_version: expectedVersion,
      }], errorCode)
    }

    const rejected = await db.query(
      `select * from apply_fortnox_connection_verification(
        $1, '100001', $2, null, null, 'FORTNOX_UNKNOWN_ERROR'
      )`,
      [org, expectedVersion]
    )
    assert.equal(rejected.rows.length, 0)
    const unchanged = await db.query<{ connection_version: number }>(
      'select connection_version from fortnox_connections where org_id = $1',
      [org]
    )
    assert.equal(Number(unchanged.rows[0].connection_version), expectedVersion)
  } finally {
    await db.close()
  }
})

test('RLS keeps the connection base table, mutations and OAuth state server-only', async () => {
  const db = await database()
  try {
    const member = randomUUID()
    const otherMember = randomUUID()
    const org = randomUUID()
    const otherOrg = randomUUID()

    await db.query('insert into profiles (id) values ($1), ($2)', [member, otherMember])
    await db.query(
      `insert into organizations (id, name, organization_number)
       values ($1, 'Member org', '556123-4567'), ($2, 'Other org', '556765-4321')`,
      [org, otherOrg]
    )
    await db.query(
      `insert into org_members (org_id, profile_id, role)
       values ($1, $2, 'inspector'), ($3, $4, 'admin')`,
      [org, member, otherOrg, otherMember]
    )
    await db.query(
      `insert into fortnox_connections
        (org_id, tenant_id, company_name, company_organization_number, granted_scopes)
       values
        ($1, '100001', 'Member AB', '556123-4567', array['companyinformation']),
        ($2, '100002', 'Other AB', '556765-4321', array['companyinformation'])`,
      [org, otherOrg]
    )
    await db.query(
      `insert into fortnox_oauth_states
        (state_hash, org_id, initiated_by_profile_id, requested_scopes, expires_at)
       values ($1, $2, $3, array['companyinformation'], now() + interval '10 minutes')`,
      ['c'.repeat(64), org, member]
    )

    await db.exec('set role authenticated')
    await db.exec(`set request.jwt.claim.sub = '${member}'`)

    await assert.rejects(
      db.query('select org_id, company_name from fortnox_connections'),
      /permission denied/
    )

    await assert.rejects(
      db.query(
        `insert into fortnox_connections
          (org_id, tenant_id, company_name, company_organization_number, granted_scopes)
         values ($1, '100003', 'Blocked AB', '556123-4567', array['companyinformation'])`,
        [org]
      ),
      /permission denied/
    )
    await assert.rejects(
      db.query("update fortnox_connections set status = 'needs_reauthorization' where org_id = $1", [org]),
      /permission denied/
    )
    await assert.rejects(db.query('select * from fortnox_oauth_states'), /permission denied/)
    await assert.rejects(
      db.query('select * from consume_fortnox_oauth_state($1, $2)', ['c'.repeat(64), member]),
      /permission denied/
    )
    await assert.rejects(
      db.query(
        `select create_fortnox_oauth_state(
          $1, $2, $3, array['companyinformation'], now() + interval '10 minutes'
        )`,
        ['d'.repeat(64), org, member]
      ),
      /permission denied/
    )
    await assert.rejects(
      db.query(
        `select save_fortnox_connection_from_oauth_state(
          $1, $2, '100003', 'Blocked AB', '556123-4567',
          array['companyinformation'], now()
        )`,
        ['c'.repeat(64), member]
      ),
      /permission denied/
    )
    await assert.rejects(
      db.query(
        `select * from apply_fortnox_connection_verification(
          $1, '100001', 1, 'Blocked AB', array['companyinformation'], null
        )`,
        [org]
      ),
      /permission denied/
    )
  } finally {
    await db.close()
  }
})
