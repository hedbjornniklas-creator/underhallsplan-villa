import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type { EbInspectionReport } from '../src/lib/eb/server'
import type * as Snapshots from '../src/lib/eb/reportSnapshot'
import type * as DeliveryRoute from '../src/app/api/eb/projects/[projectId]/inspections/[inspectionId]/report-delivery/route'
import type * as Customer from '../src/lib/eb/followUpCustomer'
import type * as EmailTemplates from '../src/lib/inspections/reportEmailTemplates'

// Execute the production helper and POST flow with all I/O replaced. An
// unexpected dependency fails closed; no database, PDF worker or mail is used.
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected publication test dependency: ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}

const snapshots = load<typeof Snapshots>('src/lib/eb/reportSnapshot.ts', {})
const customer = load<typeof Customer>('src/lib/eb/followUpCustomer.ts', { 'server-only': {} })
const emailTemplates = load<typeof EmailTemplates>('src/lib/inspections/reportEmailTemplates.ts', { 'server-only': {} })
const lockedAt = '2026-09-08T09:12:34.567+00:00'
const previousLockedAt = '2026-09-01T08:00:00.000+00:00'

function reportFixture(): EbInspectionReport {
  const inspection = {
    inspectionId: 'inspection', status: 'draft', reportLockedAt: null,
    reportLockedBy: null, reportDistributionDate: null, reportDeliveryStatus: 'not_sent',
    reportLastSentAt: null, date: '2026-09-07', assignmentNumber: 'EB-2026-01',
  }
  return {
    project: { id: 'project', title: 'Frozen project', address: 'Testvägen 1',
      ownerProfileId: 'inspector', clientName: 'Beställare', clientEmail: 'buyer@example.test',
      inspections: [inspection], agreementItems: [] },
    inspection, participants: [], projectAttachments: [], remediationAssignees: [],
    reportDraft: { sections: [{ key: 'scope', text: 'FROZEN REPORT TEXT' }], sourceSnapshot: null },
    notes: [{ id: 'note', noteText: 'FROZEN NOTE' }], images: [{ id: 'image', filePath: 'frozen.jpg' }],
    inspectionDocuments: [], checkpoints: [], markers: [], disciplines: [], statuses: [],
    suggestions: [], branding: {},
  } as unknown as EbInspectionReport
}

function snapshotReport(value: unknown) {
  assert.ok(snapshots.isEbReportSnapshotPayloadV1(value))
  return value
}

test('publication timestamp updates both inspection copies without replacing frozen content or mutating the source', () => {
  const payload = snapshots.createEbReportSnapshotPayloadV1(reportFixture())
  const otherInspection = { ...payload.report.inspection, inspectionId: 'other', reportLockedAt: previousLockedAt }
  payload.report.project.inspections.push(otherInspection)
  const original = structuredClone(payload)
  const published = snapshotReport(snapshots.withEbReportLockTimestamp(payload, lockedAt))

  const expected = structuredClone(original)
  expected.report.inspection.reportLockedAt = lockedAt
  expected.report.project.inspections[0].reportLockedAt = lockedAt
  assert.deepEqual(published, expected)
  assert.deepEqual(payload, original)
  assert.equal(published.report.project.inspections[1], otherInspection)
  assert.equal(published.report.notes, payload.report.notes)
  assert.equal(published.report.reportDraft, payload.report.reportDraft)
  assert.equal(published.deliveryDocuments, payload.deliveryDocuments)
})

test('missing/invalid timestamps and unknown snapshot schemas cannot invent publication metadata', () => {
  const payload = snapshots.createEbReportSnapshotPayloadV1(reportFixture())
  for (const timestamp of ['', 'not-a-timestamp']) {
    assert.equal(snapshots.withEbReportLockTimestamp(payload, timestamp), payload)
  }
  for (const payload of [null, {}, { schemaVersion: 'eb_v1' }]) {
    assert.equal(snapshots.withEbReportLockTimestamp(payload, lockedAt), payload)
  }
})

test('recording subsequent delivery metadata retains the confirmed publication timestamp', () => {
  const payload = snapshots.createEbReportSnapshotPayloadV1(reportFixture())
  const published = snapshots.withEbReportLockTimestamp(payload, lockedAt)
  const delivered = snapshotReport(snapshots.withEbReportDeliveryTimestamp(published, '2026-09-08T22:30:00.000Z'))
  assert.equal(delivered.report.inspection.reportLockedAt, lockedAt)
  assert.equal(delivered.report.project.inspections[0].reportLockedAt, lockedAt)
  assert.equal(delivered.report.inspection.reportDistributionDate, '2026-09-09')
  assert.equal(delivered.report.notes[0].noteText, 'FROZEN NOTE')
})

type Row = Record<string, unknown>
type QueryResult = { data: Row | Row[] | null; error: { message: string } | null }
type FixtureOptions = {
  frozen?: boolean
  frozenLockedAt?: string | null
  lockError?: boolean
  lockResult?: unknown
  publicationError?: boolean
  missingPublicationRow?: boolean
  sendError?: boolean
  unlockAfterSnapshot?: boolean
  unlockHistoryError?: boolean
  frozenCreatedAt?: string
  deliveryCustomer?: string | null
  extraRecipients?: string[]
}

function routeFixture(options: FixtureOptions = {}) {
  const live = reportFixture()
  if (options.frozen) {
    live.inspection.reportLockedAt = lockedAt
    live.inspection.status = 'completed'
  }
  const frozen = snapshots.createEbReportSnapshotPayloadV1(live)
  frozen.createdAt = options.frozenCreatedAt ?? '2026-09-01T07:00:00.000Z'
  frozen.report.inspection.reportLockedAt = options.frozenLockedAt ?? null
  frozen.report.project.inspections[0].reportLockedAt = options.frozenLockedAt ?? null
  const frozenOriginal = structuredClone(frozen)
  if (options.frozen) {
    live.notes[0].noteText = 'CHANGED LIVE NOTE'
    live.reportDraft.sections[0].text = 'CHANGED LIVE REPORT'
  }
  const previousLink: Row = {
    id: 'previous-link', org_id: 'org', inspection_id: 'inspection', token_hash: 'old-hash',
    snapshot_payload: frozen, snapshot_schema_version: 'eb_v1',
    created_at: '2026-09-01T07:00:00.000Z', revoked_at: null, pdf_status: 'ready',
    pdf_storage_bucket: 'reports', pdf_storage_path: 'frozen.pdf',
  }
  const links: Row[] = [previousLink]
  const outbound: Row[] = []
  const sentMessages: Row[] = []
  const events: string[] = []
  const scheduled: Array<() => Promise<void>> = []
  const insertedSnapshots: unknown[] = []
  let reportReads = 0
  const expectedPublishedLockedAt = options.frozenLockedAt || (
    options.frozen && (options.unlockAfterSnapshot || options.unlockHistoryError ||
      !Number.isFinite(Date.parse(frozen.createdAt)) || Date.parse(frozen.createdAt) > Date.parse(lockedAt))
      ? null : lockedAt
  )

  const admin = {
    rpc: async (name: string, input: Record<string, unknown>) => {
      assert.equal(name, 'lock_eb_inspection_report')
      assert.deepEqual(input, { p_org_id: 'org', p_project_id: 'project',
        p_inspection_id: 'inspection', p_performed_by: 'inspector' })
      events.push('lock')
      if (options.lockError) return { data: null, error: { message: 'LOCK_FAILED' } }
      const result = 'lockResult' in options ? options.lockResult : lockedAt
      if (typeof result === 'string' && Number.isFinite(Date.parse(result))) {
        live.inspection.reportLockedAt = result
        live.inspection.status = 'completed'
      }
      return { data: result, error: null }
    },
    from: (table: string) => {
      let operation = 'select'
      let patch: Row = {}
      let single = false
      let lockHistoryCheck = false
      let rowLimit = Infinity
      const filters: Array<(row: Row) => boolean> = []
      const execute = (): QueryResult => {
        if (table === 'inspection_report_links') {
          if (operation === 'insert') {
            assert.ok(patch.revoked_at, 'The inserted link must be inactive until publication is confirmed')
            events.push('stage')
            insertedSnapshots.push(structuredClone(patch.snapshot_payload))
            const row = { ...structuredClone(patch), id: 'new-link', created_at: '2026-09-08T09:12:34.500Z' }
            links.push(row)
            return { data: row, error: null }
          }
          const matches = links.filter(row => filters.every(filter => filter(row)))
          if (operation === 'update') {
            if ('revoked_at' in patch && patch.revoked_at === null) {
              events.push('publish')
              const payload = snapshotReport(patch.snapshot_payload)
              assert.equal(payload.report.inspection.reportLockedAt, expectedPublishedLockedAt)
              if (options.publicationError) return { data: null, error: { message: 'PUBLICATION_FAILED' } }
              if (options.missingPublicationRow) return { data: null, error: null }
            } else if ('revoked_at' in patch) {
              events.push(matches.some(row => row.id === 'previous-link') ? 'revoke-previous' : 'revoke-new')
            } else if ('snapshot_payload' in patch) {
              events.push('delivery-metadata')
            }
            for (const row of matches) Object.assign(row, structuredClone(patch))
          }
          const rows = matches.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, rowLimit)
          return { data: single ? rows[0] ?? null : rows, error: null }
        }
        if (table === 'outbound_messages') {
          if (operation === 'insert') {
            events.push('outbound')
            const row = { ...patch, id: `message-${outbound.length}`, created_at: '2026-09-08T09:12:35.000Z' }
            outbound.push(row)
            return { data: row, error: null }
          }
          const rows = outbound.filter(row => filters.every(filter => filter(row)))
          if (operation === 'update') for (const row of rows) Object.assign(row, patch)
          return { data: single ? rows[0] ?? null : rows, error: null }
        }
        if (table === 'eb_inspection_details') {
          assert.equal(operation, 'update')
          live.inspection.reportDistributionDate = patch.report_distribution_date as string
          return { data: null, error: null }
        }
        if (table === 'profiles') return { data: { email: 'inspector@example.test' }, error: null }
        if (table === 'inspection_lock_events' && lockHistoryCheck) {
          events.push('check-lock-history')
          assert.equal(single, true)
          const currentUnlock = { org_id: 'org', inspection_id: 'inspection', action: 'unlock' }
          assert.ok(filters.every(filter => filter(currentUnlock)))
          for (const changed of [{ org_id: 'other' }, { inspection_id: 'other' }, { action: 'lock' }]) {
            assert.equal(filters.every(filter => filter({ ...currentUnlock, ...changed })), false)
          }
          if (options.unlockHistoryError) return { data: null, error: { message: 'AUDIT_UNAVAILABLE' } }
          return { data: options.unlockAfterSnapshot ? { id: 'unlock' } : null, error: null }
        }
        if (table === 'eb_participants' || table === 'inspection_lock_events') return { data: [], error: null }
        throw new Error(`Unexpected publication test table ${table}`)
      }
      const query = {
        select: () => query,
        insert: (value: Row) => { operation = 'insert'; patch = value; return query },
        update: (value: Row) => { operation = 'update'; patch = value; return query },
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query },
        neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return query },
        is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return query },
        gte: (key: string, value: unknown) => {
          assert.equal(table, 'inspection_lock_events')
          assert.equal(key, 'performed_at')
          assert.equal(value, frozen.createdAt, 'History must use the original snapshot time, not the resend time')
          lockHistoryCheck = true
          return query
        },
        order: () => query,
        limit: (limit: number) => { rowLimit = limit; return query },
        single: () => { single = true; return Promise.resolve(execute()) },
        maybeSingle: () => { single = true; return Promise.resolve(execute()) },
        then: (resolve: (result: QueryResult) => unknown) => Promise.resolve(execute()).then(resolve),
      }
      return query
    },
  }

  const route = load<typeof DeliveryRoute>(
    'src/app/api/eb/projects/[projectId]/inspections/[inspectionId]/report-delivery/route.ts', {
      'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
        after: (callback: () => Promise<void>) => {
          const active = links.find(row => row.id === 'new-link' && row.revoked_at === null)
          assert.ok(active, 'PDF work cannot be scheduled for an unpublished link')
          assert.equal(snapshotReport(active.snapshot_payload).report.inspection.reportLockedAt, expectedPublishedLockedAt)
          events.push('schedule-pdf'); scheduled.push(callback)
        } },
      '@/lib/access/server': { requireModuleAccess: async () => undefined },
      '@/lib/assignments/server': { requireOrgContext: async () => ({ orgId: 'org', userId: 'inspector', orgName: 'Test' }) },
      '@/lib/assignments/tokens': { generateAssignmentToken: () => 'new-public-token', hashAssignmentToken: () => 'new-hash' },
      '@/lib/eb/reportSnapshot': snapshots,
      '@/lib/eb/followUpCustomer': {
        resolveEbFollowUpDeliveryCustomer: async (input: Row) => {
          assert.equal(input.orgId, 'org')
          assert.equal(input.projectId, 'project')
          assert.equal(input.inspectionId, 'inspection')
          return options.deliveryCustomer ?? null
        },
        ebFollowUpCustomerEntryUrl: customer.ebFollowUpCustomerEntryUrl,
      },
      '@/lib/eb/server': {
        getEbProjectById: async () => structuredClone(live.project),
        getEbInspectionReport: async () => { reportReads++; return structuredClone(live) },
      },
      '@/lib/inspections/reportEmailTemplates': emailTemplates,
      '@/lib/assignments/mailer': { sendAssignmentEmail: async (input: Row) => {
        sentMessages.push(input)
        events.push('send')
        const active = links.find(row => row.id === 'new-link' && row.revoked_at === null)
        assert.ok(active, 'No delivery is allowed before publication metadata is saved')
        assert.equal(snapshotReport(active.snapshot_payload).report.inspection.reportLockedAt, expectedPublishedLockedAt)
        if (options.sendError) throw new Error('SEND_FAILED')
        return { provider: 'mock', providerMessageId: 'mock-message' }
      } },
      '@/lib/report/pdfJobs': { runInspectionReportPdfBatch: async () => { events.push('run-pdf') } },
      '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    }
  )
  return {
    links, previousLink, frozenOriginal, events, insertedSnapshots, scheduled, live, sentMessages,
    reportReads: () => reportReads,
    created: () => { const link = links.find(row => row.id === 'new-link'); assert.ok(link); return link },
    post: async (action: 'lock_only' | 'send_and_lock' | 'resend') => {
      const previousFrom = process.env.ASSIGNMENTS_MAIL_FROM
      process.env.ASSIGNMENTS_MAIL_FROM = 'test@example.test'
      try {
        return await route.POST(new Request('https://example.test/api/delivery', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, primary_recipient: 'buyer@example.test', extra_recipients: options.extraRecipients }),
        }), { params: Promise.resolve({ projectId: 'project', inspectionId: 'inspection' }) })
      } finally {
        if (previousFrom === undefined) delete process.env.ASSIGNMENTS_MAIL_FROM
        else process.env.ASSIGNMENTS_MAIL_FROM = previousFrom
      }
    },
  }
}

test('lock-only publication stages privately, persists the RPC timestamp, then revokes the previous version and queues PDF', async () => {
  const f = routeFixture()
  const response = await f.post('lock_only')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).reportLockedAt, lockedAt)
  assert.deepEqual(f.events, ['stage', 'lock', 'publish', 'revoke-previous', 'schedule-pdf'])
  assert.equal(snapshotReport(f.insertedSnapshots[0]).report.inspection.reportLockedAt, null)
  const persisted = snapshotReport(f.created().snapshot_payload)
  assert.equal(persisted.report.inspection.reportLockedAt, lockedAt)
  assert.equal(persisted.report.project.inspections[0].reportLockedAt, lockedAt)
  assert.equal(f.created().revoked_at, null)
  assert.ok(f.previousLink.revoked_at)
  assert.equal(f.reportReads(), 1)
})

test('send-and-lock persists publication before mail and later delivery metadata cannot overwrite its timestamp', async () => {
  const f = routeFixture()
  assert.equal((await f.post('send_and_lock')).status, 200)
  const persisted = snapshotReport(f.created().snapshot_payload)
  assert.equal(persisted.report.inspection.reportLockedAt, lockedAt)
  assert.equal(persisted.report.project.inspections[0].reportLockedAt, lockedAt)
  assert.equal(persisted.report.inspection.reportDeliveryStatus, 'sent')
  assert.ok(persisted.report.inspection.reportLastSentAt)
  assert.equal(persisted.report.notes[0].noteText, 'FROZEN NOTE')
  assert.deepEqual(f.events, ['stage', 'lock', 'publish', 'revoke-previous', 'outbound', 'send', 'delivery-metadata', 'schedule-pdf'])
})

test('EB delivery sends customer management entry only to the designated address, not every report recipient', async () => {
  for (const deliveryCustomer of ['buyer@example.test', 'extra-customer@example.test', null]) {
    const f = routeFixture({ deliveryCustomer, extraRecipients: ['contractor@example.test', 'extra-customer@example.test'] })
    const response = await f.post('send_and_lock')
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(f.sentMessages.length, 3)
    assert.doesNotMatch(body.publicLink, /customer=/, 'Shared/public API output must remain a plain report URL')
    for (const message of f.sentMessages) {
      const content = String(message.html) + String(message.text)
      if (message.to === deliveryCustomer) {
        assert.match(content, /Hantera din besiktning/)
        assert.match(content, /customer=1/)
      } else {
        assert.doesNotMatch(content, /Hantera din besiktning|customer=/)
      }
    }
  }
})

test('resending an old snapshot backfills missing lock metadata without fetching live report content', async () => {
  const f = routeFixture({ frozen: true })
  assert.equal((await f.post('resend')).status, 200)
  const persisted = snapshotReport(f.created().snapshot_payload)
  assert.equal(persisted.report.inspection.reportLockedAt, lockedAt)
  assert.equal(persisted.report.project.inspections[0].reportLockedAt, lockedAt)
  assert.equal(persisted.report.notes[0].noteText, 'FROZEN NOTE')
  assert.equal(persisted.report.reportDraft.sections[0].text, 'FROZEN REPORT TEXT')
  assert.equal(persisted.createdAt, f.frozenOriginal.createdAt)
  assert.deepEqual(f.previousLink.snapshot_payload, f.frozenOriginal)
  assert.equal(f.previousLink.revoked_at, null)
  assert.equal(f.reportReads(), 0)
  assert.equal(f.events.includes('lock'), false)
})

test('resending a timestamped frozen report preserves its original publication timestamp', async () => {
  const f = routeFixture({ frozen: true, frozenLockedAt: previousLockedAt })
  assert.equal((await f.post('resend')).status, 200)
  const persisted = snapshotReport(f.created().snapshot_payload)
  assert.equal(persisted.report.inspection.reportLockedAt, previousLockedAt)
  assert.equal(persisted.report.project.inspections[0].reportLockedAt, previousLockedAt)
  assert.deepEqual(f.previousLink.snapshot_payload, f.frozenOriginal)
  assert.equal(f.reportReads(), 0)
})

test('resending a legacy snapshot cannot attach a newer lock after unlock/relock or unverifiable history', async () => {
  for (const options of [
    { unlockAfterSnapshot: true }, { unlockHistoryError: true },
    { frozenCreatedAt: '' }, { frozenCreatedAt: 'invalid' },
    { frozenCreatedAt: '2026-09-08T09:13:00.000Z' },
  ]) {
    const f = routeFixture({ frozen: true, ...options })
    assert.equal((await f.post('resend')).status, 200)
    const persisted = snapshotReport(f.created().snapshot_payload)
    assert.equal(persisted.report.inspection.reportLockedAt, null)
    assert.equal(persisted.report.project.inspections[0].reportLockedAt, null)
    assert.equal(persisted.report.notes[0].noteText, 'FROZEN NOTE')
    assert.equal(persisted.createdAt, f.frozenOriginal.createdAt)
    assert.deepEqual(f.previousLink.snapshot_payload, f.frozenOriginal)
    assert.equal(f.reportReads(), 0)
    assert.equal(f.events.includes('lock'), false)
  }
})

test('failed locks never stamp or activate a new link, revoke the previous version, send mail or queue PDF', async () => {
  const f = routeFixture({ lockError: true })
  assert.equal((await f.post('send_and_lock')).status, 500)
  assert.equal(snapshotReport(f.created().snapshot_payload).report.inspection.reportLockedAt, null)
  assert.ok(f.created().revoked_at)
  assert.equal(f.previousLink.revoked_at, null)
  assert.deepEqual(f.events, ['stage', 'lock', 'revoke-new'])
  assert.equal(f.scheduled.length, 0)
})

test('missing or invalid RPC timestamps fail closed instead of fabricating a successful lock time', async () => {
  for (const lockResult of [null, undefined, '', 'invalid', { lockedAt }]) {
    const f = routeFixture({ lockResult })
    assert.equal((await f.post('lock_only')).status, 500)
    assert.equal(snapshotReport(f.created().snapshot_payload).report.inspection.reportLockedAt, null)
    assert.ok(f.created().revoked_at)
    assert.equal(f.previousLink.revoked_at, null)
    assert.equal(f.events.includes('publish'), false)
    assert.equal(f.scheduled.length, 0)
  }
})

test('failed or missing publication persistence keeps the staged link revoked with no mail or PDF work', async () => {
  for (const options of [{ publicationError: true }, { missingPublicationRow: true }]) {
    const f = routeFixture(options)
    assert.equal((await f.post('send_and_lock')).status, 500)
    assert.equal(f.live.inspection.reportLockedAt, lockedAt, 'The successful database lock is not undone or invented')
    assert.ok(f.created().revoked_at)
    assert.equal(f.previousLink.revoked_at, null)
    assert.equal(snapshotReport(f.created().snapshot_payload).report.inspection.reportLockedAt, null)
    assert.deepEqual(f.events, ['stage', 'lock', 'publish', 'revoke-new'])
    assert.equal(f.scheduled.length, 0)
  }
})

test('a failed resend revokes only its new copy and does not queue PDF work', async () => {
  const f = routeFixture({ frozen: true, sendError: true })
  const response = await f.post('resend')
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.publicLink, null)
  assert.equal(body.failedRecipients.length, 1)
  assert.ok(f.created().revoked_at)
  assert.equal(f.previousLink.revoked_at, null)
  assert.deepEqual(f.previousLink.snapshot_payload, f.frozenOriginal)
  assert.equal(f.scheduled.length, 0)
})

test('failed first delivery retains the confirmed locked version for retry and PDF generation', async () => {
  const f = routeFixture({ sendError: true })
  const response = await f.post('send_and_lock')
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.ok(body.publicLink)
  assert.equal(body.failedRecipients.length, 1)
  assert.equal(f.created().revoked_at, null)
  assert.equal(snapshotReport(f.created().snapshot_payload).report.inspection.reportLockedAt, lockedAt)
  assert.equal(f.scheduled.length, 1)
})
