import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { EbInspectionReport } from '../src/lib/eb/server'
import type * as Snapshots from '../src/lib/eb/reportSnapshot'
import type * as Policy from '../src/lib/eb/remediationPolicy'
import type * as OrderApi from '../src/app/api/reports/public/[token]/follow-up/route'
import type * as CronApi from '../src/app/api/cron/eb/follow-up/route'
import type * as Remediation from '../src/lib/eb/remediation'

const require = createRequire(import.meta.url)
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// Execute production modules with only their I/O boundaries replaced. Missing
// dependencies fail closed: these tests must never contact a live service.
function load<T>(path: string, dependencies: Record<string, unknown>, expose: string[] = []): T {
  const source = `${read(path)}\n${expose.map(name => `exports.${name} = ${name};`).join('\n')}`
  const output = ts.transpileModule(source, { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name === '@/lib/eb/reportNoteDisplay') return load('src/lib/eb/reportNoteDisplay.ts', {})
    if (name.startsWith('node:') || ['react', 'react/jsx-runtime', 'lucide-react', 'next/server'].includes(name)) return require(name)
    throw new Error(`Unexpected integration test dependency: ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}

const snapshots = load<typeof Snapshots>('src/lib/eb/reportSnapshot.ts', {})
const secret = 'PRIVATE-BILLING-SENTINEL'
const token = 'valid-public-report-token-with-at-least-20-characters'

function reportFixture(): EbInspectionReport {
  const billing = {
    invoiceName: secret, invoiceOrgNo: secret, invoiceReference: secret, invoiceEmail: secret,
    invoiceAddress: secret, invoicePostalCode: secret, invoiceCity: secret,
  }
  const inspection = {
    ...billing, inspectionId: 'inspection', variant: 'SLB', variantLabel: 'Slutbesiktning',
    sequenceNo: 1, date: '2026-09-03', inspectionTime: '10:00',
    assignmentNumber: 'EB 2026-0903-01', reportLockedAt: '2026-09-07T10:00:00Z',
    reportDistributionDate: '2026-09-07', previousInspections: [],
  }
  const project = {
    ...billing, id: 'project', title: 'Testvilla', propertyDesignation: 'TESTVILLAN 1',
    address: 'Testvägen 1', clientName: 'Beställaren', clientEmail: secret, clientPhone: secret,
    contractorName: 'Entreprenören', contractorEmail: secret, contractorPhone: secret,
    standardAgreement: 'Konsumententreprenad', agreementItems: [{ comment: secret }], inspections: [inspection],
  }
  const sourceProject = Object.fromEntries(Object.entries(project).filter(([key]) => key !== 'inspections'))
  return {
    project, inspection,
    reportDraft: { sections: [{ key: 'scope', title: 'Besiktningens omfattning', text: 'FASTSTÄLLD ORIGINALTEXT',
      contentMode: 'editable', relevant: true, status: 'done', sbrPoint: '2' }], noteHeadings: [],
    sourceSnapshot: { project: structuredClone(sourceProject), inspectorText: 'Besiktningsman: Testperson', branding: {} } },
    notes: [{ id: 'note', noteNumber: 1, noteText: 'FASTSTÄLLT FEL', markerKey: 'E' }],
    participants: [{ name: 'Entreprenören', email: secret, phone: secret, receivesReport: false }],
    projectAttachments: [], inspectionDocuments: [], remediationAssignees: [{ email: secret }],
    checkpoints: [], images: [], markers: [], disciplines: [], statuses: [], suggestions: [{ text: secret }],
    branding: {},
  } as unknown as EbInspectionReport
}

type PublicPage = {
  default: (props: { params: Promise<{ token: string }>; searchParams?: Promise<{ pdf?: string; customer?: string }> }) => Promise<ReactElement<Record<string, unknown>>>
}
type ReportContent = {
  default: (props: { publicToken: string; isPdfRender?: boolean; buyerFollowUpEndpoint?: string; buyerAccessExpired?: boolean }) => Promise<ReactElement<Record<string, unknown>>>
}

function publicPageFixture() {
  const original = reportFixture()
  const state = { revoked: false, missing: false }
  // Deliberately use a legacy unsanitized saved payload to test the public
  // boundary, not only the sanitizer used when making new snapshots.
  const payload = { ...snapshots.createEbReportSnapshotPayloadV1(original), report: original }
  const reads: string[] = []
  const publicView = () => createElement('main', null, 'Det kostnadsfria utlåtandet')
  const content = load<ReportContent>('src/components/report/PublicReportPageContent.tsx', {
    'next/link': { __esModule: true, default: () => null },
    'next/navigation': { notFound: () => { throw new Error('NOT_FOUND') }, redirect: () => { throw new Error('UNEXPECTED_LOGIN') } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: (table: string) => {
      reads.push(table)
      assert.equal(table, 'inspection_report_links', 'Reading the free report must not require a purchase or buyer account')
      const query = { select: () => query, eq: (key: string, value: string) => {
        assert.equal(key, 'token_hash'); assert.equal(value, `hashed:${token}`); return query
      }, maybeSingle: async () => ({ error: null, data: state.missing ? null : {
        id: 'report-link', snapshot_payload: payload, created_at: payload.createdAt,
        revoked_at: state.revoked ? '2026-09-08T10:00:00Z' : null,
        pdf_status: 'ready', pdf_storage_bucket: 'reports', pdf_storage_path: 'frozen.pdf',
      } }) }
      return query
    } }) },
    '@/lib/assignments/tokens': { hashAssignmentToken: (value: string) => `hashed:${value}` },
    '@/lib/report/reportSnapshotPayload': { isReportSnapshotPayloadV1: () => false },
    '@/lib/eb/reportSnapshot': snapshots,
    '@/lib/tu/reportSnapshot': { isTuReportSnapshotPayloadV1: () => false },
    '@/components/report/ReportSnapshotView': { __esModule: true, default: () => null },
    '@/components/report/ReportSnapshotPrintDocument': { __esModule: true, default: () => null, isPrintableReportSnapshot: () => false },
    '@/components/report/ReportShareButton': { __esModule: true, default: () => null },
    '@/components/eb/EbPublicReportSnapshotView': { __esModule: true, default: publicView },
    '@/components/tu/TuPublicReportSnapshotView': { __esModule: true, default: () => null },
  })
  const wrapper = load<PublicPage>('src/app/rapport/[token]/page.tsx', {
    '@/components/report/PublicReportPageContent': { __esModule: true, default: content.default },
  })
  const page: PublicPage = { default: async props => {
    const element = await wrapper.default(props)
    assert.equal(element.type, content.default)
    return content.default(element.props as Parameters<ReportContent['default']>[0])
  } }
  return { page, content, state, payload, original, reads, publicView }
}

test('a valid report bearer link still opens the full free report without an account or a purchase', async () => {
  const f = publicPageFixture()
  const element = await f.page.default({ params: Promise.resolve({ token }) })
  assert.equal(element.type, f.publicView)
  assert.match(renderToStaticMarkup(element), /kostnadsfria utlåtandet/)
  const report = element.props.report as EbInspectionReport
  assert.equal(report.reportDraft.sections[0].text, 'FASTSTÄLLD ORIGINALTEXT')
  assert.equal(report.notes[0].noteText, 'FASTSTÄLLT FEL')
  assert.equal(element.props.pdfDownloadUrl, `/api/reports/public/${token}?download=1`)
  assert.deepEqual(f.reads, ['inspection_report_links'])
})

test('public report props redact billing and private contacts even from old snapshots, without altering their source', async () => {
  const f = publicPageFixture()
  const element = await f.page.default({ params: Promise.resolve({ token }) })
  assert.doesNotMatch(JSON.stringify(element.props), new RegExp(secret))
  assert.equal(f.original.project.invoiceName, secret)
  assert.equal(f.original.inspection.invoiceEmail, secret)
  assert.equal(f.original.notes[0].noteText, 'FASTSTÄLLT FEL')
})

test('the public route cannot enable buyer controls through customer=1 and never reads ambient buyer sessions', async () => {
  const f = publicPageFixture()
  const element = await f.page.default({ params: Promise.resolve({ token }), searchParams: Promise.resolve({ customer: '1' }) })
  assert.equal(element.props.followUpEndpoint, undefined)
  assert.equal(element.props.customerAutoOpen, undefined)
  assert.deepEqual(f.reads, ['inspection_report_links'])
})

test('buyer report reuses the same frozen content and only clean public URLs for sharing, PDF and documents', async () => {
  const f = publicPageFixture()
  const endpoint = '/api/eb/customer/private-buyer-secret/follow-up'
  const ordinary = await f.page.default({ params: Promise.resolve({ token }) })
  const buyer = await f.content.default({ publicToken: token, buyerFollowUpEndpoint: endpoint })
  assert.deepEqual(buyer.props.report, ordinary.props.report)
  assert.equal(buyer.props.followUpEndpoint, endpoint)
  for (const key of ['shareUrl', 'shareEndpoint', 'pdfDownloadUrl', 'pdfStatusEndpoint', 'deliveryDocuments']) {
    assert.deepEqual(buyer.props[key], ordinary.props[key])
    assert.doesNotMatch(JSON.stringify(buyer.props[key]), /private-buyer-secret|customer=1/)
  }
  const expired = await f.content.default({ publicToken: token, buyerFollowUpEndpoint: endpoint, buyerAccessExpired: true })
  assert.match(renderToStaticMarkup(expired), /beställarlänk har gått ut/)
  assert.doesNotMatch(JSON.stringify(expired.props), /private-buyer-secret/)
})

test('unknown or revoked free report links never disclose report or follow-up content', async () => {
  const f = publicPageFixture()
  f.state.missing = true
  await assert.rejects(f.page.default({ params: Promise.resolve({ token }) }), /NOT_FOUND/)
  f.state.missing = false
  f.state.revoked = true
  const element = await f.page.default({ params: Promise.resolve({ token }) })
  assert.match(renderToStaticMarkup(element), /Länken är inte längre aktiv/)
  assert.doesNotMatch(JSON.stringify(element.props), /FASTSTÄLLD|FASTSTÄLLT|PRIVATE-BILLING/)
})

test('the delivered report is a deep frozen-in-time copy, not a live project/note view', () => {
  const live = reportFixture()
  const payload = snapshots.createEbReportSnapshotPayloadV1(live)
  live.notes[0].noteText = 'LIVE CHANGED NOTE'
  live.reportDraft.sections[0].text = 'LIVE CHANGED TEXT'
  live.project.title = 'LIVE CHANGED PROJECT'
  assert.equal(payload.report.notes[0].noteText, 'FASTSTÄLLT FEL')
  assert.equal(payload.report.reportDraft.sections[0].text, 'FASTSTÄLLD ORIGINALTEXT')
  assert.equal(payload.report.project.title, 'Testvilla')
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(secret))
})

test('paid follow-up roles separate customer coordination from a contractor claim, never legal approval', () => {
  const policy = load<typeof Policy>('src/lib/eb/remediationPolicy.ts', {})
  assert.equal(policy.ebRemediationCanManage('customer_owner', true), true)
  assert.equal(policy.ebRemediationCanManage('contractor_admin', true), false)
  assert.deepEqual(policy.ebRemediationAllowedStatuses('customer_owner', true), ['returned'])
  for (const role of ['contractor_admin', 'assignee'] as const) {
    const statuses = policy.ebRemediationAllowedStatuses(role, true)
    assert.ok(statuses.includes('reported_remedied'))
    assert.ok(statuses.includes('cannot_remedy'))
    assert.equal(statuses.some(status => /approved|accepted|godkänd/.test(status)), false)
    assert.equal(policy.ebRemediationCanManage(role, true), false)
  }
  assert.deepEqual(policy.ebRemediationAllowedStatuses('contractor_viewer', true), [])
  assert.equal(policy.ebRemediationCanComment('contractor_viewer'), false)
})

test('legacy portal permissions keep the existing contractor review workflow', () => {
  const policy = load<typeof Policy>('src/lib/eb/remediationPolicy.ts', {})
  assert.equal(policy.ebRemediationCanManage('contractor_admin', false), true)
  assert.deepEqual(policy.ebRemediationAllowedStatuses('assignee', false), [
    'in_progress', 'ready_for_review', 'cannot_remedy',
  ])
  assert.ok(policy.ebRemediationAllowedStatuses('contractor_admin', false).includes('reported_remedied'))
  assert.equal(policy.ebRemediationCanManage('customer_owner', false), false)
  assert.deepEqual(policy.ebRemediationAllowedStatuses('contractor_viewer', false), [])
})

function orderRouteFixture() {
  const calls: Array<{ name: string; input: unknown }> = []
  const state = { fail: '' }
  const api = load<typeof OrderApi>('src/app/api/reports/public/[token]/follow-up/route.ts', {
    '@/lib/eb/followUpServer': {
      getEbFollowUpCustomerState: async (value: string) => {
        calls.push({ name: 'offer', input: value })
        return { verified: false, offer: null, accessAvailable: true }
      },
      requestEbFollowUpCustomerLink: async (input: unknown) => {
        calls.push({ name: 'request_link', input })
        return { message: 'Kontrollera din e-post.' }
      },
      completeEbFollowUpOrder: async (input: unknown) => {
        calls.push({ name: 'complete', input })
        if (state.fail) throw new Error(state.fail)
        return { orderId: 'order', portalUrl: '/atgarder/private-token' }
      },
      verifyEbFollowUpCustomerCode: async (input: unknown) => {
        calls.push({ name: 'verify', input })
        return { verified: true, offer: { priceOre: 59900 } }
      },
    },
    '@/lib/eb/customerSession': { assertEbCustomerRequestOrigin: () => undefined },
  })
  const context = { params: Promise.resolve({ token }) }
  const post = (body: unknown) => api.POST(new Request(`https://hushub.test/api/reports/public/${token}/follow-up`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
  }), context)
  return { api, calls, state, context, post }
}

test('legacy reading endpoint never unlocks an offer or order; old link recovery remains non-purchasing', async () => {
  const f = orderRouteFixture()
  const response = await f.api.GET()
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Cache-Control') ?? '', /no-store/)
  assert.deepEqual(await response.json(), { verified: false, offer: null, accessAvailable: false, retryable: false })
  assert.equal(f.calls.length, 0)
  for (const action of ['request_code', 'verify_code']) assert.equal((await f.post({ action })).status, 400)
  const code = await f.post({ action: 'request_link', email: 'buyer@example.test' })
  assert.equal(code.status, 200)
  assert.equal(f.calls[0].name, 'request_link')
  assert.equal(f.calls.some(call => call.name === 'complete'), false)
  const input = { action: 'order', challengeId: 'challenge', code: '123456', confirmedPriceOre: 59900,
    acceptTerms: true, requestImmediateStart: true, acceptInvoice: true, termsVersion: '2026-09-07' }
  const result = await f.post(input)
  assert.equal(result.status, 401)
  assert.equal((await f.post({ action: 'access' })).status, 401)
  assert.equal(f.calls.length, 1, 'An ambient buyer cookie must not route public-link requests into checkout')
  assert.match(result.headers.get('Cache-Control') ?? '', /private/)
})

test('purchase HTTP input/error paths reject oversized or malformed requests and never expose backend secrets', async () => {
  const f = orderRouteFixture()
  for (const [input, status] of [['{', 400], ['[]', 400], ['null', 400], ['x'.repeat(12001), 413], [{ action: 'delete' }, 400]] as const) {
    assert.equal((await f.post(input)).status, status)
  }
  assert.equal(f.calls.length, 0)
  for (const error of ['EB_FOLLOW_UP_VERIFICATION_REQUIRED', `DATABASE_ERROR:${secret}`]) {
    f.state.fail = error
    const response = await f.post({ action: 'order' })
    assert.equal(response.status, 401)
    assert.doesNotMatch(await response.text(), /PRIVATE-BILLING|DATABASE_ERROR/)
    assert.match(response.headers.get('Cache-Control') ?? '', /no-store/)
  }
})

test('the durable mail dispatcher is protected even in development and cannot be triggered by an anonymous GET', async () => {
  const previous = process.env.CRON_SECRET
  let calls = 0
  const api = load<typeof CronApi>('src/app/api/cron/eb/follow-up/route.ts', {
    '@/lib/eb/followUpDelivery': { processEbFollowUpEmails: async () => {
      calls += 1; return { claimed: 1, sent: 1, failed: 0 }
    } },
  })
  try {
    delete process.env.CRON_SECRET
    assert.equal((await api.GET(new Request('https://hushub.test/cron'))).status, 503)
    process.env.CRON_SECRET = 'test-only-secret'
    for (const authorization of ['', 'Bearer wrong', 'Bearer test-only-secrex']) {
      const response = await api.GET(new Request('https://hushub.test/cron', { headers: { authorization } }))
      assert.equal(response.status, 401)
    }
    assert.equal(calls, 0)
    const success = await api.GET(new Request('https://hushub.test/cron', { headers: { authorization: 'Bearer test-only-secret' } }))
    assert.equal(success.status, 200)
    assert.equal(calls, 1)
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = previous
  }
})

function workspaceFixture() {
  const savedReport = reportFixture()
  const liveProject = { ...savedReport.project, orgId: 'org', title: 'LIVE PROJECT CHANGED', inspections: [
    { ...savedReport.inspection, date: '2099-12-31' },
  ] }
  const common = { org_id: 'org', eb_project_id: 'project', inspection_id: 'inspection' }
  const taskRow = (id: string, orderId: string | null, assignee: string) => ({ ...common,
    id, follow_up_order_id: orderId, eb_note_id: id, remediation_assignee_id: assignee,
    status: 'assigned', included: true, assignment_managed_by: 'contractor',
    note_snapshot: { noteText: `FROZEN ${id}`, noteNumber: 1, inspectionVariant: 'SLB' },
    original_images: [{ id: `original-${id}`, filePath: `immutable/${id}.jpg`, storageBucket: 'eb-follow-up-originals' }],
  })
  const accessRow = (role: string, orderId: string | null, assignee: string | null) => ({ ...common,
    id: role, token_hash: `hashed:${role.padEnd(35, '-')}`, follow_up_order_id: orderId,
    role, remediation_assignee_id: assignee, display_name: role, email: `${role}@example.test`,
    expires_at: '2099-01-01T00:00:00Z', revoked_at: null,
  })
  const tables: Record<string, Array<Record<string, unknown>>> = {
    eb_follow_up_orders: [{ ...common, id: 'paid', status: 'active', accepted_at: '2026-09-07T10:00:00Z',
      withdrawal_requested_at: null, report_snapshot: snapshots.createEbReportSnapshotPayloadV1(savedReport), buyer_snapshot: { invoiceName: secret } }],
    eb_remediation_tasks: [taskRow('mine', 'paid', 'worker'), taskRow('other-worker', 'paid', 'second'),
      taskRow('other-order', 'other-paid', 'worker'), taskRow('legacy', null, 'legacy-worker')],
    eb_remediation_assignees: ['worker', 'second', 'legacy-worker'].map(id => ({ ...common, id, name: id,
      email: `${id}@example.test`, follow_up_order_id: id === 'legacy-worker' ? null : 'paid' })),
    eb_remediation_access_links: [accessRow('customer_owner', 'paid', null), accessRow('assignee', 'paid', 'worker'),
      accessRow('contractor_admin', null, null)],
    eb_remediation_events: ['mine', 'other-worker', 'other-order', 'legacy'].map(task_id => ({ ...common,
      id: `event-${task_id}`, task_id, event_type: 'comment', actor_email: secret, message: `COMMENT ${task_id}`, created_at: '2026-09-07T10:00:00Z' })),
    eb_remediation_images: ['mine', 'other-worker', 'other-order', 'legacy'].map(task_id => ({ ...common,
      id: `after-${task_id}`, task_id, storage_bucket: 'eb-remediation-images', file_path: `${task_id}.jpg` })),
    eb_notes: [{ ...common, id: 'post-purchase-live-note', note_text: 'NEW LIVE NOTE MUST NOT ENTER PURCHASED WORKSPACE' }], eb_disciplines: [],
  }
  const writes: string[] = [], signed: string[] = []
  const admin = {
    from: (table: string) => {
      assert.ok(table in tables, table)
      let rows = tables[table]
      const query = {
        select: () => query, order: () => query,
        eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query },
        is: (key: string, value: unknown) => { rows = rows.filter(row => (row[key] ?? null) === value); return query },
        in: (key: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[key])); return query },
        update: (values: Record<string, unknown>) => {
          assert.equal(table, 'eb_remediation_access_links')
          assert.deepEqual(Object.keys(values), ['last_used_at'])
          writes.push(table); return query
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
      }
      return query
    },
    storage: { from: (bucket: string) => ({ createSignedUrls: async (paths: string[]) => {
      signed.push(...paths.map(path => `${bucket}/${path}`))
      return { data: paths.map(path => ({ signedUrl: `https://storage.example.test/${bucket}/${path}` })) }
    } }) },
  }
  const service = load<typeof Remediation>('src/lib/eb/remediation.ts', {
    sharp: () => { throw new Error('No image transformations while reading') },
    '@/lib/assignments/tokens': { hashAssignmentToken: (value: string) => `hashed:${value}` },
    '@/lib/assignments/mailer': { sendAssignmentEmail: () => { throw new Error('No email while reading') } },
    '@/lib/eb/server': { getEbProjectById: async () => liveProject },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/eb/reportSnapshot': snapshots,
    '@/lib/eb/remediationPolicy': load('src/lib/eb/remediationPolicy.ts', {}),
    '@/lib/eb/remediationDefaults': load('src/lib/eb/remediationDefaults.ts', {}),
    '@/lib/eb/followUpDelivery': {}, '@/lib/eb/followUpServer': {},
    '@/lib/eb/ownerAuth': { assertEbRemediationOwnerSession: async () => undefined },
  })
  const workspace = async (role: string) => {
    const value = await service.getEbRemediationWorkspaceByToken(role.padEnd(35, '-'))
    assert.ok(value)
    return value
  }
  return { workspace, tables, writes, signed, savedReport, liveProject }
}

test('actual paid worker workspace contains only its assigned frozen tasks, original photos and events, without billing or owner contacts', async () => {
  const f = workspaceFixture()
  const workspace = await f.workspace('assignee')
  assert.equal(workspace.project.title, 'Testvilla')
  assert.equal(workspace.inspection?.date, '2026-09-03')
  assert.deepEqual(workspace.tasks.map(task => task.id), ['mine'])
  assert.deepEqual(workspace.assignees.map(assignee => assignee.id), ['worker'])
  assert.deepEqual(workspace.events.map(event => event.id), ['event-mine'])
  assert.equal(workspace.events[0].actorEmail, null)
  assert.deepEqual(workspace.accessLinks, [])
  assert.equal(workspace.originalImages.length, 1)
  assert.ok(f.signed.every(path => path.includes('mine.jpg')))
  assert.doesNotMatch(JSON.stringify(workspace), new RegExp(secret))
  assert.doesNotMatch(JSON.stringify(workspace), /LIVE PROJECT CHANGED|2099-12-31|other-worker|other-order/)
})

test('older purchased tasks display frozen report numbers and order without rewriting evidence or closing recipient gaps', async () => {
  const f = workspaceFixture()
  const frozen = snapshots.getEbInspectionReportFromSnapshot(f.tables.eb_follow_up_orders[0].report_snapshot)!
  const note = frozen.notes[0]
  frozen.notes = [
    { ...note, id: 'mine', noteNumber: 1, sortOrder: 300, noteText: 'Senare rapportpunkt.' },
    { ...note, id: 'other-worker', noteNumber: 2, sortOrder: 100, noteText: 'Första rapportpunkten.' },
    { ...note, id: 'not-followed', noteNumber: 81, sortOrder: 200, noteText: '' },
  ]
  // Simulate an old order whose source note was subsequently deleted. The
  // immutable original id still resolves it to the same frozen report point.
  f.tables.eb_remediation_tasks[0].eb_note_id = null
  f.tables.eb_remediation_tasks[0].original_note_id = 'mine'
  f.tables.eb_remediation_tasks[1].note_snapshot = {
    ...(f.tables.eb_remediation_tasks[1].note_snapshot as Record<string, unknown>), originalNoteId: 'other-worker',
  }
  const before = JSON.stringify(f.tables.eb_remediation_tasks)
  const reportBefore = JSON.stringify(f.tables.eb_follow_up_orders[0].report_snapshot)
  const owner = await f.workspace('customer_owner')
  assert.deepEqual(owner.tasks.map(task => [task.id, task.snapshot.noteNumber]), [['other-worker', 1], ['mine', 3]])
  const worker = await f.workspace('assignee')
  assert.deepEqual(worker.tasks.map(task => [task.id, task.snapshot.noteNumber]), [['mine', 3]], 'Do not number a recipient subset from 1')
  assert.equal(worker.tasks[0].snapshot.noteText, 'FROZEN mine', 'Saved task evidence must not be replaced by another text')
  assert.equal(JSON.stringify(f.tables.eb_remediation_tasks), before)
  assert.equal(JSON.stringify(f.tables.eb_follow_up_orders[0].report_snapshot), reportBefore)
  assert.ok(f.writes.every(table => table === 'eb_remediation_access_links'))
})

test('paid owner and legacy portal scopes do not inherit one another, nor a second purchased version', async () => {
  const f = workspaceFixture()
  const owner = await f.workspace('customer_owner')
  assert.deepEqual(owner.tasks.map(task => task.id), ['mine', 'other-worker'])
  assert.deepEqual(owner.assignees.map(assignee => assignee.id), ['worker', 'second'])
  assert.equal(owner.accessLinks.some(link => link.role === 'customer_owner'), false)
  const legacy = await f.workspace('contractor_admin')
  assert.deepEqual(legacy.tasks.map(task => task.id), ['legacy'])
  assert.deepEqual(legacy.assignees.map(assignee => assignee.id), ['legacy-worker'])
  assert.equal(legacy.followUp, null)
  assert.equal(legacy.project.title, 'LIVE PROJECT CHANGED')
  assert.deepEqual(f.writes, ['eb_remediation_access_links', 'eb_remediation_access_links'])
})

test('revoked paid portal links never expose task, history or photo content and generate no signed asset URLs', async () => {
  const f = workspaceFixture()
  f.tables.eb_remediation_access_links.find(row => row.role === 'assignee')!.revoked_at = '2026-09-07T11:00:00Z'
  const workspace = await f.workspace('assignee')
  assert.equal(workspace.state, 'revoked')
  assert.deepEqual(workspace.tasks, [])
  assert.deepEqual(workspace.events, [])
  assert.deepEqual(workspace.images, [])
  assert.deepEqual(workspace.originalImages, [])
  assert.deepEqual(f.signed, [])
  assert.deepEqual(f.writes, [])
})

test('purchased workspaces inherit only the frozen report deadline without overwriting per-task dates or writing on read', async () => {
  const f = workspaceFixture()
  const frozen = snapshots.getEbInspectionReportFromSnapshot(f.tables.eb_follow_up_orders[0].report_snapshot)!
  frozen.inspection.defaultRemedyDeadline = '2026-10-01'
  f.liveProject.inspections[0].defaultRemedyDeadline = '2099-12-30'
  f.tables.eb_remediation_tasks[0].due_date = '2026-10-15'
  const owner = await f.workspace('customer_owner')
  assert.equal(owner.inspection?.defaultRemedyDeadline, '2026-10-01')
  assert.equal(owner.tasks[0].dueDate, '2026-10-15')
  assert.equal(owner.tasks[1].dueDate, null, 'The inherited display default must not manufacture a stored task deadline')
  const worker = await f.workspace('assignee')
  assert.equal(worker.inspection?.defaultRemedyDeadline, '2026-10-01')
  assert.deepEqual(f.writes, ['eb_remediation_access_links', 'eb_remediation_access_links'])
  frozen.inspection.defaultRemedyDeadline = null
  const missing = await f.workspace('customer_owner')
  assert.equal(missing.inspection?.defaultRemedyDeadline, null, 'A newer live project date is not substituted for missing frozen facts')
})

test('contractor contact suggestions are confined to the open paid buyer workspace and matched frozen identity', async () => {
  const f = workspaceFixture()
  f.liveProject.contractorEmail = 'company-contact@example.test'
  f.liveProject.contractorPhone = '010-123456'
  const owner = await f.workspace('customer_owner')
  assert.equal(owner.contractorSuggestions?.[0].email, 'company-contact@example.test')
  assert.equal(owner.contractorSuggestions?.[0].source, 'project')
  assert.equal((await f.workspace('assignee')).contractorSuggestions, undefined)
  assert.equal((await f.workspace('contractor_admin')).contractorSuggestions, undefined)

  f.liveProject.contractorName = 'Replacement company after the report was frozen'
  assert.equal((await f.workspace('customer_owner')).contractorSuggestions?.[0].email, null)
  const access = f.tables.eb_remediation_access_links.find(row => row.role === 'customer_owner')!
  access.expires_at = '2000-01-01T00:00:00Z'
  const expired = await f.workspace('customer_owner')
  assert.equal(expired.contractorSuggestions, undefined)
  assert.equal(expired.inspection?.defaultRemedyDeadline, undefined)
  access.expires_at = '2099-01-01T00:00:00Z'
  access.revoked_at = '2026-09-08T10:00:00Z'
  assert.equal((await f.workspace('customer_owner')).contractorSuggestions, undefined)
})
