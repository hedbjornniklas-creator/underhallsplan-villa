import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const compact = (value: string) => value.replace(/\s+/gu, ' ')

const tuServer = compact(read('src/lib/tu/server.ts'))
const reportSnapshot = compact(read('src/lib/tu/reportSnapshot.ts'))
const migration = compact(read('docs/db/2026-09-12_07_profile_org_cards.sql'))
const reportDelivery = compact(
  read('src/app/api/tu/investigations/[inspectionId]/report-delivery/route.ts')
)

test('locked TU revisions remain readable after the inspector leaves the organization', () => {
  assert.match(tuServer, /A locked report is rendered from its immutable report snapshot/u)
  assert.match(
    tuServer,
    /!detail\.report_locked_at \|\| !\(error instanceof Error && error\.message === 'ORG_MEMBERSHIP_REQUIRED'\)/u
  )
  assert.match(
    tuServer,
    /detail\.inspector_profile_id \?\? \(detail\.report_locked_at \? null : assignment\?\.responsible_profile_id/u
  )
  assert.match(migration, /detail\.report_locked_at is null/u)
  assert.doesNotMatch(migration, /disable trigger user/u)
  assert.match(
    migration,
    /foreign key \(org_id, inspector_profile_id\) references public\.org_members \(org_id, profile_id\)/u
  )
})

test('a finalized TU re-send uses the frozen reply-to identity', () => {
  assert.match(reportDelivery, /function resolveFrozenReplyToEmail\(snapshot: unknown\)/u)
  assert.match(
    reportDelivery,
    /const replyToEmail = sendingFinalizedRevision \? resolveFrozenReplyToEmail\(snapshotPayload\)/u
  )
  assert.match(reportDelivery, /\? snapshotPayload\.report\.companyLogoAlt/u)
})

test('the organization-specific report footer is included in the immutable snapshot', () => {
  assert.match(tuServer, /report_footer_text: cleanText\(card\.reportFooterText\)/u)
  assert.match(reportSnapshot, /inspector\?\.report_footer_text/u)
})

test('legacy draft identity cannot override the exact organization card at finalization', () => {
  assert.match(reportSnapshot, /toPrintRow\('Besiktningsman', inspector\?\.full_name\)/u)
  assert.doesNotMatch(
    reportSnapshot,
    /toPrintRow\('Besiktningsman', assignmentParties\.inspectorName/u
  )
})

test('legacy mutable media is not copied into organization cards', () => {
  assert.match(migration, /Legacy media paths may be overwritten by the old global profile editor/u)
  assert.doesNotMatch(migration, /nullif\(btrim\(profile\.(?:avatar|logo|signature)_path\)/u)
  assert.match(
    migration,
    /revoke insert, update, delete on table public\.assignment_links from anon, authenticated/u
  )
})
