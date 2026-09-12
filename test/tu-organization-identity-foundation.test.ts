import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const compact = (value: string) => value.replace(/\s+/gu, ' ')

const sql = compact(read('docs/db/2026-09-12_07_profile_org_cards.sql'))
const tuServer = compact(read('src/lib/tu/server.ts'))
const assignmentServer = compact(read('src/lib/assignments/server.ts'))
const acceptRoute = compact(read('src/app/api/assignments/accept/[token]/route.ts'))
const reportRoute = compact(
  read('src/app/api/tu/investigations/[inspectionId]/report-delivery/route.ts')
)

test('SQL 07 isolates one profile card per organization with guarded writes', () => {
  assert.match(sql, /create table if not exists public\.profile_org_cards/u)
  assert.match(sql, /unique \(org_id, profile_id\)/u)
  assert.match(
    sql,
    /foreign key \(org_id, profile_id\) references public\.org_members \(org_id, profile_id\)/u
  )
  assert.match(sql, /new\.version := old\.version \+ 1/u)
  assert.match(sql, /alter table public\.profile_org_cards force row level security/u)
  assert.match(sql, /profile_id = auth\.uid\(\) and public\.is_org_member\(org_id\)/u)
  assert.match(sql, /public\.is_org_admin\(org_id\)/u)
})

test('legacy branding is copied to no more than one active home organization', () => {
  assert.match(sql, /count\(\*\) filter \(where member\.is_active\)/u)
  assert.match(
    sql,
    /where candidate\.is_active and \(candidate\.is_default or candidate\.active_membership_count = 1\)/u
  )
  assert.match(sql, /row_number\(\) over \( partition by candidate\.profile_id/u)
  assert.match(sql, /where membership\.candidate_rank = 1/u)
})

test('TU investigations persist the responsible inspector instead of using the viewer', () => {
  assert.match(
    sql,
    /add column if not exists inspector_profile_id uuid references public\.profiles \(id\)/u
  )
  assert.match(
    sql,
    /coalesce\(assignment\.responsible_profile_id, detail\.created_by\)/u
  )
  assert.match(sql, /assignment\.org_id = detail\.org_id/u)
  assert.match(
    sql,
    /member\.org_id = detail\.org_id and member\.profile_id = coalesce\(assignment\.responsible_profile_id, detail\.created_by\) and member\.is_active/u
  )
  assert.match(tuServer, /inspector_profile_id: input\.inspectorProfileId/u)
  assert.match(
    tuServer,
    /detail\.inspector_profile_id \?\? \(detail\.report_locked_at \? null : assignment\?\.responsible_profile_id \?\? detail\.created_by\)/u
  )
  assert.doesNotMatch(tuServer, /input\.inspectorProfileId \?\? assignment/u)
})

test('issued TU links freeze and later reuse the exact organization identity', () => {
  assert.match(sql, /issuer_snapshot_schema_version text/u)
  assert.match(sql, /issuer_identity_snapshot jsonb/u)
  assert.match(sql, /assignment_issuer_v1/u)
  assert.match(sql, /create trigger trg_assignment_links_protect_issuer_snapshot/u)
  assert.match(
    sql,
    /new\.issuer_identity_snapshot is distinct from old\.issuer_identity_snapshot/u
  )

  const confirmationStart = assignmentServer.indexOf(
    'export async function sendAssignmentConfirmation'
  )
  const confirmationEnd = assignmentServer.indexOf(
    'export async function sendAssignmentOrderReceipt'
  )
  const confirmationFunction = assignmentServer.slice(confirmationStart, confirmationEnd)
  const snapshotAt = confirmationFunction.indexOf(
    'const issuerIdentitySnapshot = await createTuAssignmentIssuerIdentitySnapshot'
  )
  const revokeAt = confirmationFunction.indexOf(".from('assignment_links') .update({ revoked_at:")
  assert.ok(snapshotAt >= 0)
  assert.ok(revokeAt > snapshotAt, 'issuer identity must be validated before the old link is revoked')
  assert.match(assignmentServer, /issuer_identity_snapshot: issuerIdentitySnapshot/u)
  assert.match(assignmentServer, /parseAssignmentIssuerIdentitySnapshot\(input\.issuerIdentitySnapshot/u)
  assert.match(acceptRoute, /parseAssignmentIssuerIdentitySnapshot\( link\.issuer_identity_snapshot/u)
  assert.match(acceptRoute, /issuerIdentitySnapshot: link\.issuer_identity_snapshot/u)
})

test('assignment links cannot reference an assignment in another organization', () => {
  assert.match(
    sql,
    /create unique index if not exists assignments_org_id_id_unique_idx on public\.assignments \(org_id, id\)/u
  )
  assert.match(
    sql,
    /foreign key \(org_id, assignment_id\) references public\.assignments \(org_id, id\) on delete cascade not valid/u
  )
  assert.match(
    sql,
    /validate constraint assignment_links_org_assignment_fkey/u
  )
})

test('TU acceptance validates its frozen issuer before consuming the public token', () => {
  const postStart = acceptRoute.indexOf('export async function POST')
  const postFunction = acceptRoute.slice(postStart)
  const parseAt = postFunction.search(
    /parseAssignmentIssuerIdentitySnapshot\(\s*link\.issuer_identity_snapshot/u
  )
  const consumeAt = postFunction.indexOf('await consumeAssignmentToken')

  assert.ok(parseAt >= 0, 'TU issuer snapshot must be parsed in POST')
  assert.ok(consumeAt > parseAt, 'TU issuer snapshot must be validated before token consumption')
  assert.match(postFunction, /\{ orgId: link\.org_id \}/u)
  assert.doesNotMatch(postFunction.slice(0, consumeAt), /profileId: responsibleProfileId/u)
})

test('non-TU accepted notices retain the responsible profile reply-to address', () => {
  const postStart = acceptRoute.indexOf('export async function POST')
  const postFunction = acceptRoute.slice(postStart)

  assert.match(postFunction, /updatedAssignment\.assignment_type === 'TU' \? null : await getProfileContact/u)
  assert.match(postFunction, /responsibleEmail: responsibleProfile\?\.email \?\? null/u)
})

test('new TU report finalization requires the frozen inspector organization card', () => {
  assert.match(reportRoute, /const usesFrozenRevision = action === 'send_and_lock'/u)
  assert.match(reportRoute, /profileId: investigation\.inspectorProfileId/u)
  assert.match(reportRoute, /await requireTuOrganizationProfileCard/u)
  assert.match(reportRoute, /Fyll i företagsvisitkortet för ansvarig besiktningsman/u)
})
