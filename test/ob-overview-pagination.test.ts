import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { OverviewAssignment, OverviewInspection, OverviewWorkflow } from '../src/lib/ob/overview'

const db = new PGlite()
const uuid = (kind: number, n = 1) => `${String(kind).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`
const user = uuid(90), otherUser = uuid(91), org = uuid(92), otherOrg = uuid(93)
const acceptedAt = '2026-01-01T12:00:00Z'
type Page = {
  rows: { assignment: OverviewAssignment | null; inspection: OverviewInspection | null; workflow: OverviewWorkflow | null }[]
  total: number; counts: { all: number; active: number; closed: number }; page: number; pageSize: number
}

async function asRole<T>(role: 'authenticated' | 'anon' | 'service_role', subject: string, action: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [subject])
  await db.exec(`set role ${role}`)
  try { return await action() } finally { await db.exec('reset role') }
}

async function page(options: {
  orgId?: string; search?: string; filter?: string; sort?: string; attentionOnly?: boolean
  showArchived?: boolean; page?: number; pageSize?: number
} = {}) {
  return asRole('authenticated', user, async () => {
    const result = await db.query<{ result: Page }>(
      'select public.ob_overview_page($1::uuid, $2::text, $3::text, $4::text, $5::boolean, $6::boolean, $7::integer, $8::integer) as result',
      [options.orgId ?? org, options.search ?? '', options.filter ?? 'all', options.sort ?? 'date-desc',
        options.attentionOnly ?? false, options.showArchived ?? false, options.page ?? 1, options.pageSize ?? 10],
    )
    return result.rows[0].result
  })
}

async function insert(table: string, row: Record<string, unknown>) {
  const fields = Object.keys(row)
  await db.query(`insert into public.${table} (${fields.join(',')}) values (${fields.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row))
}

async function assignment(n: number, overrides: Record<string, unknown> = {}) {
  await insert('assignments', { id: uuid(1, n), org_id: org, assignment_type: 'OB', status: 'booked',
    customer_name: `Kund ${n}`, customer_email: `kund${n}@example.invalid`, property_address: `Gatan ${n}`,
    property_city: 'Stockholm', preferred_date: '2026-01-01', accepted_at: acceptedAt, booked_at: acceptedAt,
    created_at: '2026-01-01T00:00:00Z', ...overrides })
  await insert('assignment_acceptances', { id: uuid(5, n), org_id: overrides.org_id ?? org,
    assignment_id: uuid(1, n), accepted_at: acceptedAt, created_at: acceptedAt })
}

async function inspection(n: number, overrides: Record<string, unknown> = {}, owner = user) {
  await insert('properties', { id: uuid(2, n), owner, address: `Fastighetsgatan ${n}`, city: 'Stockholm', client_name: `Fastighetskund ${n}` })
  await insert('inspections', { id: uuid(3, n), property_id: uuid(2, n), inspection_family: 'OB', status: 'ongoing',
    date: '2026-01-01', created_at: '2026-01-01T00:00:00Z', assignment_number: `OB-${n}`, ...overrides })
  await insert('ob_property_snapshot', { inspection_id: uuid(3, n), address: `Snapshotgatan ${n}`, city: 'Stockholm', client_name: `Snapshotkund ${n}` })
}

async function workflow(n: number, current = n, initial = current, needsReview = false) {
  await insert('ob_assignment_workflows', { inspection_id: uuid(3, n), org_id: org,
    current_assignment_id: uuid(1, current), initial_assignment_id: uuid(1, initial) })
  await insert('workflow_state_fixture', { inspection_id: uuid(3, n), assignment_id: uuid(1, current), needs_review: needsReview })
}

async function stateCalls() {
  return (await db.query<{ n: number }>('select (case when is_called then last_value else 0 end)::integer n from workflow_state_calls')).rows[0].n
}

async function dataSnapshot() {
  const result: Record<string, unknown> = {}
  for (const table of ['assignments', 'properties', 'inspections', 'ob_property_snapshot', 'ob_assignment_workflows',
    'assignment_links', 'assignment_acceptances', 'assignment_link_incidents', 'workflow_state_fixture']) {
    result[table] = (await db.query(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`)).rows
  }
  return result
}

async function seedFifty() {
  // Fifty distinct dates give stable paging; the attention rows are on the last ordinary page.
  for (let n = 1; n <= 50; n++) {
    const date = new Date(Date.UTC(2026, 0, n)).toISOString().slice(0, 10)
    await assignment(n, { inspection_id: uuid(3, n), preferred_date: date })
    await inspection(n, { date, status: n > 40 ? 'completed' : 'ongoing', customer_name: n <= 3 ? 'Mål för sökning' : `Kund ${n}` })
    await workflow(n, n, n, n <= 5)
  }
}

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    create table org_members (org_id uuid, user_id uuid);
    create function public.is_org_member(p_org_id uuid) returns boolean language sql stable security definer
      set search_path = public, pg_catalog as $$
      select exists(select 1 from org_members where org_id = p_org_id and user_id = auth.uid())
    $$;
    create table assignments (
      id uuid primary key, org_id uuid not null, assignment_type text not null, inspection_id uuid,
      status text not null, customer_name text, customer_email text, property_address text, preliminary_address text,
      property_city text, preferred_date date, accepted_at timestamptz, booked_at timestamptz,
      archived_at timestamptz, created_at timestamptz not null, internal_private_marker text default 'PRIVATE_ASSIGNMENT_FIELD'
    );
    create table properties (id uuid primary key, owner uuid not null, address text, city text, client_name text);
    create table inspections (
      id uuid primary key, property_id uuid not null references properties(id), inspection_family text not null,
      status text, date date, created_at timestamptz not null, assignment_number text, customer_name text,
      client_name text, visible boolean not null default true, internal_private_marker text default 'PRIVATE_INSPECTION_FIELD'
    );
    create table ob_property_snapshot (
      inspection_id uuid primary key references inspections(id), address text, city text, client_name text,
      visible boolean not null default true, internal_private_marker text default 'PRIVATE_SNAPSHOT_FIELD'
    );
    create table ob_assignment_workflows (
      inspection_id uuid primary key, org_id uuid not null, current_assignment_id uuid not null unique,
      initial_assignment_id uuid not null, initial_snapshot jsonb default '{"secret":"PRIVATE_INITIAL_SNAPSHOT"}'
    );
    create table assignment_links (
      id uuid primary key, org_id uuid not null, assignment_id uuid not null, expires_at timestamptz not null,
      used_at timestamptz, revoked_at timestamptz
    );
    create table assignment_acceptances (
      id uuid primary key, org_id uuid not null, assignment_id uuid not null,
      accepted_at timestamptz not null, created_at timestamptz not null
    );
    create table assignment_link_incidents (
      id uuid primary key, org_id uuid not null, assignment_id uuid not null, resolved_at timestamptz
    );
    create table workflow_state_fixture (
      inspection_id uuid primary key, assignment_id uuid not null, needs_review boolean not null default false,
      paused boolean not null default false, reason text
    );
    create sequence workflow_state_calls;
    -- Instrument only the authoritative boundary. The migration's real flags, filtering and joins are exercised.
    create function public.ob_assignment_workflow_state(p_inspection_id uuid) returns jsonb
      language plpgsql stable security definer set search_path = public, pg_catalog as $$
    declare state workflow_state_fixture;
    begin
      perform nextval('workflow_state_calls');
      select * into state from workflow_state_fixture where inspection_id = p_inspection_id;
      if not found then return null; end if;
      return jsonb_build_object('assignmentId', state.assignment_id, 'inspectionId', state.inspection_id,
        'needsReview', state.needs_review, 'paused', state.paused, 'reason', state.reason,
        'initialSnapshot', jsonb_build_object('secret', 'PRIVATE_INITIAL_SNAPSHOT'),
        'currentSnapshot', jsonb_build_object('secret', 'PRIVATE_CURRENT_SNAPSHOT'),
        'inspectionSnapshot', jsonb_build_object('secret', 'PRIVATE_INSPECTION_SNAPSHOT'),
        'reviewToken', 'PRIVATE_REVIEW_TOKEN', 'reconciliationToken', 'PRIVATE_RECONCILIATION_TOKEN');
    end $$;
    revoke all on function ob_assignment_workflow_state(uuid) from public, anon, authenticated;
    grant execute on function ob_assignment_workflow_state(uuid) to service_role;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant select on assignments, properties, inspections, ob_property_snapshot, ob_assignment_workflows,
      assignment_links, assignment_acceptances to authenticated;
    grant select on assignment_link_incidents to service_role;
    alter table assignments enable row level security;
    create policy assignments_read on assignments for select to authenticated using (is_org_member(org_id));
    alter table properties enable row level security;
    create policy properties_read on properties for select to authenticated using (owner = auth.uid());
    alter table inspections enable row level security;
    create policy inspections_read on inspections for select to authenticated using (
      visible and exists(select 1 from properties p where p.id = property_id and p.owner = auth.uid())
    );
    alter table ob_property_snapshot enable row level security;
    create policy snapshot_read on ob_property_snapshot for select to authenticated using (
      visible and exists(select 1 from inspections i where i.id = inspection_id)
    );
    alter table ob_assignment_workflows enable row level security;
    create policy workflows_read on ob_assignment_workflows for select to authenticated using (is_org_member(org_id));
    alter table assignment_links enable row level security;
    create policy links_read on assignment_links for select to authenticated using (is_org_member(org_id));
    alter table assignment_acceptances enable row level security;
    create policy acceptances_read on assignment_acceptances for select to authenticated using (is_org_member(org_id));
    alter table assignment_link_incidents enable row level security;
  `)
  await db.query('insert into org_members values ($1, $2), ($3, $4)', [org, user, otherOrg, otherUser])
  const migration = readFileSync(new URL('../docs/db/2026-09-25_01_ob_overview_pagination.sql', import.meta.url), 'utf8')
  await db.exec(migration)
  await db.exec(migration)
})

beforeEach(async () => {
  await db.exec(`truncate assignments, properties, inspections, ob_property_snapshot, ob_assignment_workflows,
    assignment_links, assignment_acceptances, assignment_link_incidents, workflow_state_fixture cascade;
    alter sequence workflow_state_calls restart with 1;`)
})
after(() => db.close())

test('fifty workflows return ten rows, complete counts and at most ten authoritative reads per ordinary page', async () => {
  await seedFifty()
  const beforeRead = await dataSnapshot()
  const first = await page()
  assert.equal(first.rows.length, 10)
  assert.equal(first.total, 50)
  assert.deepEqual(first.counts, { all: 50, active: 40, closed: 10 })
  assert.equal(first.page, 1)
  assert.equal(first.pageSize, 10)
  assert.equal(await stateCalls(), 10)
  assert.equal(first.rows[0].inspection?.id, uuid(3, 50))
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE_|initialSnapshot|currentSnapshot|inspectionSnapshot|reviewToken|reconciliationToken/)
  const second = await page({ page: 2 })
  assert.equal(second.rows.length, 10)
  assert.equal(await stateCalls(), 20)
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.inspection?.id)).size, 20)
  assert.deepEqual(await dataSnapshot(), beforeRead, 'reading pages must not mutate business data')
})

test('search and status filters cover the whole collection and counts precede the status filter', async () => {
  await seedFifty()
  const searched = await page({ search: ' MÅL   Stockholm ' })
  assert.equal(searched.total, 3)
  assert.deepEqual(searched.counts, { all: 3, active: 3, closed: 0 })
  assert.deepEqual(searched.rows.map(row => row.inspection?.id), [uuid(3, 3), uuid(3, 2), uuid(3, 1)])
  const closed = await page({ filter: 'closed', pageSize: 10, page: 2 })
  assert.equal(closed.total, 10)
  assert.equal(closed.page, 1, 'a stale page after filtering moves to the last available page')
  assert.equal(closed.rows.length, 10)
  assert.deepEqual(closed.counts, { all: 50, active: 40, closed: 10 })
  assert.ok(closed.rows.every(row => row.inspection?.status === 'completed'))
  const active = await page({ filter: 'active', sort: 'date-asc', pageSize: 25, page: 2 })
  assert.equal(active.total, 40)
  assert.equal(active.rows.length, 15)
  assert.equal(active.rows[0].inspection?.id, uuid(3, 26))
  const last = await page({ page: 999999 })
  assert.equal(last.page, 5)
  assert.equal(last.rows.length, 10)
  assert.equal(last.rows[0].inspection?.id, uuid(3, 10))
  assert.equal(last.total, 50)
  assert.deepEqual(last.counts, { all: 50, active: 40, closed: 10 })
  const empty = await page({ page: 999999, search: 'Inga träffar på detta' })
  assert.equal(empty.page, 1)
  assert.equal(empty.rows.length, 0)
  assert.equal(empty.total, 0)
  assert.deepEqual(empty.counts, { all: 0, active: 0, closed: 0 })
})

test('attention is evaluated before pagination, including workflows on later ordinary pages', async () => {
  await seedFifty()
  const attention = await page({ attentionOnly: true, pageSize: 10 })
  assert.equal(attention.total, 5)
  assert.equal(attention.rows.length, 5)
  assert.deepEqual(attention.counts, { all: 5, active: 5, closed: 0 })
  assert.deepEqual(attention.rows.map(row => row.inspection?.id), [5, 4, 3, 2, 1].map(n => uuid(3, n)))
  assert.ok(attention.rows.every(row => row.workflow?.needsReview === true))
  assert.equal(await stateCalls(), 50, 'evaluate each candidate once, without repeating page-row workflow reads')
})

test('workflow pointers consume superseded confirmations while ambiguous legacy links stay visible', async () => {
  await inspection(1)
  await assignment(1, { inspection_id: uuid(3, 1), status: 'cancelled' })
  await assignment(2, { inspection_id: uuid(3, 1) })
  await assignment(3, { inspection_id: uuid(3, 1), status: 'cancelled' })
  await workflow(1, 2, 1)
  await inspection(2)
  await assignment(4, { inspection_id: uuid(3, 2) })
  await assignment(5, { inspection_id: uuid(3, 2) })
  const result = await page()
  assert.equal(result.total, 4)
  assert.equal(result.rows.filter(row => row.inspection?.id === uuid(3, 1)).length, 1)
  assert.equal(result.rows.find(row => row.workflow)?.assignment?.id, uuid(1, 2))
  assert.deepEqual(result.rows.filter(row => row.inspection?.id === uuid(3, 2)).map(row => row.assignment), [null])
  assert.deepEqual(result.rows.filter(row => !row.inspection).map(row => row.assignment?.id).sort(), [uuid(1, 4), uuid(1, 5)])
})

test('org membership, owner scope and RLS hide inaccessible inspections and snapshots', async () => {
  await inspection(1, {}, otherUser)
  await assignment(1, { inspection_id: uuid(3, 1) })
  await workflow(1)
  await inspection(2, { visible: false, customer_name: 'PRIVATE_HIDDEN_INSPECTION' })
  await assignment(2, { inspection_id: uuid(3, 2) })
  await inspection(3)
  await db.query("update ob_property_snapshot set visible = false, address = 'PRIVATE_HIDDEN_ADDRESS', client_name = 'PRIVATE_HIDDEN_CUSTOMER' where inspection_id = $1", [uuid(3, 3)])
  await assignment(4, { org_id: otherOrg, customer_name: 'PRIVATE_FOREIGN_ORG' })
  await assignment(5, { assignment_type: 'TU', customer_name: 'PRIVATE_OTHER_MODULE' })
  const result = await page()
  assert.equal(result.total, 3)
  assert.deepEqual(result.rows.filter(row => row.inspection).map(row => row.inspection?.id), [uuid(3, 3)])
  assert.equal(result.rows.find(row => row.inspection)?.inspection?.address, 'Fastighetsgatan 3')
  assert.equal(result.rows.find(row => row.inspection)?.inspection?.snapshot_customer, 'Fastighetskund 3')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/)
  await assert.rejects(page({ orgId: otherOrg }))
  for (const role of ['anon', 'service_role'] as const) {
    await asRole(role, user, async () => {
      await assert.rejects(db.query('select public.ob_overview_page($1::uuid)', [org]), /permission denied/)
      await assert.rejects(db.query('select public.ob_overview_item_flags($1::uuid, null, null)', [org]), /permission denied/)
    })
  }
  await asRole('authenticated', user, async () => {
    await assert.rejects(db.query('select * from public.assignment_link_incidents'), /permission denied/)
    await assert.rejects(db.query('select public.ob_assignment_workflow_state($1::uuid)', [uuid(3, 1)]), /permission denied/)
    await assert.rejects(db.query('select public.ob_overview_item_flags($1::uuid, $2::uuid, null)', [org, uuid(1, 4)]), /OB_OVERVIEW_ASSIGNMENT_FORBIDDEN/)
    await assert.rejects(db.query('select public.ob_overview_item_flags($1::uuid, $2::uuid, null)', [org, uuid(1, 5)]), /OB_OVERVIEW_ASSIGNMENT_FORBIDDEN/)
  })
  await asRole('authenticated', '', async () => {
    await assert.rejects(db.query('select public.ob_overview_page($1::uuid)', [org]), /OB_OVERVIEW_ORG_FORBIDDEN/)
  })
})

test('archive visibility and paging limits apply before the final slice', async () => {
  await assignment(1, { status: 'cancelled' })
  await assignment(2, { status: 'draft', archived_at: acceptedAt })
  await inspection(3, { status: 'archived' })
  await assignment(4)
  for (const options of [{ page: 0 }, { page: -1 }, { page: 1000000 },
    { pageSize: 0 }, { pageSize: 1 }, { pageSize: 2 }, { pageSize: 100 }]) {
    await assert.rejects(page(options), /OB_OVERVIEW_PAGE_INVALID/)
  }
  for (const options of [{ filter: 'unknown' }, { sort: 'unknown' }]) {
    await assert.rejects(page(options), /OB_OVERVIEW_FILTER_INVALID/)
  }
  await assert.rejects(page({ search: 'x'.repeat(201) }), /OB_OVERVIEW_.*INVALID/)
  const acceptedSearch = await page({ search: 'x'.repeat(200) })
  assert.equal(acceptedSearch.total, 0)
  const ordinary = await page({ pageSize: 10 })
  assert.equal(ordinary.page, 1)
  assert.equal(ordinary.pageSize, 10)
  assert.equal(ordinary.rows.length, 2)
  assert.deepEqual(ordinary.counts, { all: 2, active: 1, closed: 1 })
  const archived = await page({ showArchived: true, pageSize: 25 })
  assert.equal(archived.pageSize, 25)
  assert.equal(archived.rows.length, 4)
  assert.deepEqual(archived.counts, { all: 4, active: 1, closed: 3 })
  const largestPage = await page({ showArchived: true, pageSize: 50 })
  assert.equal(largestPage.pageSize, 50)
  assert.equal(largestPage.rows.length, 4)
  const attention = await page({ attentionOnly: true, showArchived: true })
  assert.equal(attention.total, 0, 'archived drafts do not count as needing attention')
})

test('customer and address ordering follow Swedish alphabet with a stable tie break', async () => {
  const labels = ['Östen', 'Anna', 'Ägir', 'Zelda', 'Åke', 'Anna']
  for (let n = 1; n <= labels.length; n++) {
    await assignment(n, { customer_name: labels[n - 1], property_address: labels[n - 1] })
  }
  const expected = [2, 6, 4, 5, 3, 1].map(n => uuid(1, n))
  for (const sort of ['customer', 'address']) {
    const result = await page({ sort })
    assert.deepEqual(result.rows.map(row => row.assignment?.id), expected)
  }
  assert.equal(await stateCalls(), 0, 'ordinary confirmations must never invoke workflow reconciliation')
})

test('active links, matching acceptances, unresolved incidents and paused workflows preserve attention flags', async () => {
  await assignment(1, { status: 'sent', accepted_at: null, booked_at: null })
  await assignment(2, { status: 'sent', accepted_at: null, booked_at: null })
  await assignment(3)
  await assignment(4, { inspection_id: uuid(3, 4) })
  await inspection(4)
  await workflow(4)
  await assignment(5, { status: 'draft', accepted_at: null, booked_at: null })
  await assignment(6, { status: 'cancelled' })
  await inspection(7, { status: 'unexpected_status' })
  await assignment(8, { status: 'accepted', booked_at: null })
  await assignment(9, { status: 'cancelled' })
  await db.query("update workflow_state_fixture set paused = true, reason = 'Pausad för kontroll' where inspection_id = $1", [uuid(3, 4)])
  await insert('assignment_links', { id: uuid(6, 1), org_id: org, assignment_id: uuid(1, 1), expires_at: '2099-01-01' })
  await insert('assignment_links', { id: uuid(6, 2), org_id: org, assignment_id: uuid(1, 2), expires_at: '2000-01-01' })
  await insert('assignment_link_incidents', { id: uuid(7, 1), org_id: org, assignment_id: uuid(1, 3) })
  await insert('assignment_link_incidents', { id: uuid(7, 2), org_id: org, assignment_id: uuid(1, 1), resolved_at: acceptedAt })
  await insert('assignment_link_incidents', { id: uuid(7, 3), org_id: org, assignment_id: uuid(1, 6) })
  const beforeRead = await dataSnapshot()
  const ordinary = await page()
  const first = ordinary.rows.find(row => row.assignment?.id === uuid(1, 1))?.assignment
  assert.equal(first?.activeLink, true)
  assert.equal(first?.approvalVerified, false)
  assert.equal(first?.linkIssue, false)
  const incident = ordinary.rows.find(row => row.assignment?.id === uuid(1, 3))?.assignment
  assert.equal(incident?.approvalVerified, true)
  assert.equal(incident?.linkIssue, true)
  const attention = await page({ attentionOnly: true })
  assert.deepEqual(attention.rows.filter(row => row.assignment).map(row => row.assignment?.id).sort(),
    [2, 3, 4, 5, 6, 8].map(n => uuid(1, n)))
  assert.equal(attention.rows.find(row => !row.assignment)?.inspection?.id, uuid(3, 7))
  assert.equal(attention.rows.find(row => row.workflow)?.workflow?.reason, 'Pausad för kontroll')
  assert.deepEqual(await dataSnapshot(), beforeRead)
})
