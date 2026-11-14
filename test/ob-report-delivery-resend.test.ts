import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function harness({ missing = false, denied = false, failed = false } = {}) {
  const calls = { mail: [] as unknown[], inserts: [] as string[], updates: [] as string[], builds: 0, jobs: 0 }
  const inspectionId = '10000000-0000-4000-8000-000000000001'
  const reportId = '10000000-0000-4000-8000-000000000002'
  const orgId = '10000000-0000-4000-8000-000000000003'
  const snapshot = { inspectionSide: 'seller', reportSpec: [], reportData: { mock: {
    inspections: { client_name: 'Frozen customer', date: '2026-10-28' },
    properties: { address: 'Frozen address' }, profile: { email: 'inspector@example.invalid' }, appendices: {},
  } } }
  const frozen = { snapshot, tokenHash: 'a'.repeat(64), pdfBase64: '', pdfStoragePath: 'frozen.pdf', pdfStatus: 'ready' }
  const messages: any[] = []
  const admin = { from(table: string) {
    let operation = 'read', payload: any
    const result = () => {
      if (operation === 'insert') { calls.inserts.push(table); messages.push({ ...payload, id: 'message' }); return { data: { id: 'message' }, error: null } }
      if (operation === 'update') { calls.updates.push(table); Object.assign(messages[0], payload); return { data: null, error: null } }
      const data = table === 'inspections' ? { id: inspectionId, property_id: 'property', status: 'completed', locked_at: '2026-11-06T08:00:00Z', customer_email: 'customer@example.invalid' }
        : table === 'properties' ? { id: 'property' }
        : table === 'assignments' ? null
        : table === 'outbound_messages' ? messages
        : table === 'inspection_lock_events' ? []
        : table === 'inspection_report_links' ? { id: reportId, token_hash: frozen.tokenHash, org_id: orgId,
          inspection_id: inspectionId, snapshot_payload: snapshot, pdf_status: 'ready', pdf_storage_bucket: 'inspection-reports',
          pdf_storage_path: 'frozen.pdf', created_at: '2026-11-06T07:00:00Z' } : null
      return { data, error: null }
    }
    const q: any = { select: () => q, eq: () => q, is: () => q, not: () => q, or: () => q, order: () => q, limit: () => q,
      insert: (value: any) => { operation='insert'; payload=value; return q },
      update: (value: any) => { operation='update'; payload=value; return q },
      single: async () => result(), maybeSingle: async () => result(),
      then: (resolve: any) => { const r = result(); return Promise.resolve({ ...r, data: r.data == null || Array.isArray(r.data) ? r.data : [r.data] }).then(resolve) } }
    return q
  }, rpc: () => { throw Error('Resend must not lock or complete') } }
  const deps: Record<string, unknown> = {
    '@/lib/ob/organizationBindings': { requireObInspectionContext: async () => { if (denied) throw Error('UNAUTHORIZED'); return { orgId, userId: 'owner', orgName: 'Frozen company' } } },
    '@/lib/ob/organizationHttp': { obRequestOrgId: () => orgId, obOrganizationFailure: (e: Error) => e.message === 'UNAUTHORIZED' ? Response.json({}, { status: 401 }) : null },
    'next/server': { NextResponse: { json: Response.json }, after: () => { calls.jobs++ } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/ob/assignmentWorkflowServer': { getObAssignmentWorkflow: async () => null },
    'node:crypto': { randomUUID: () => 'dispatch-id' },
    '@/lib/assignments/tokens': { hashAssignmentToken: () => 'b'.repeat(64), generateAssignmentToken: () => { throw Error('No fresh token on resend') } },
    '@/lib/assignments/mailer': { sendAssignmentEmail: async (mail: unknown) => { calls.mail.push(mail); if (failed) throw Error('Synthetic mail failure'); return { provider: 'synthetic', providerMessageId: 'synthetic-message' } } },
    '@/lib/report/pdfJobs': { runInspectionReportPdfBatch: () => { throw Error('No PDF job on resend') } },
    '@/lib/report/reportSnapshotPayload': { createReportSnapshotPayloadV1: () => { throw Error('No new snapshot') } },
    '@/lib/report/pdfV2/buildReportDataV2': { buildReportDataV2: () => { calls.builds++; throw Error('No live report build') } },
    '@/lib/report/reportSpec': { buildReportSpec: () => { throw Error('No new report spec') } },
    '@/lib/inspections/reportEmailTemplates': { buildInspectionReportDeliveryEmail: (input: any) => {
      assert.equal(input.propertyAddress, 'Frozen address'); assert.equal(input.customerName, 'Frozen customer')
      return { subject: 'Synthetic report', text: input.detailsUrl, html: input.detailsUrl }
    } },
    '@/lib/ob/publishedReport': { getLatestObPublishedReportId: async () => missing ? null : reportId,
      getObPublishedReportRecord: async () => frozen, obPublishedReportHref: () => '/internal/frozen' },
    '@/lib/ob/wordExportLink': { obWordExportHref: () => '/word/frozen' },
    '@/lib/ob/inspectionProfile': { resolveObInspectionProfile: () => 'seller' },
    '@/lib/ob/reportShareToken': { createObReportShareToken: () => 'ob1.signed-synthetic-link' },
    '@/lib/ob/reportDeliveryHistoryServer': { readObDeliveryTimeline: async () => ({ entries: [], nextCursor: null, overview: {} }) },
    '@/lib/organizations/administrationHttp': { ORGANIZATION_RESPONSE_HEADERS: { 'Cache-Control': 'private, no-store' } },
  }
  const output = ts.transpileModule(readFileSync('src/app/api/ob/inspections/[id]/report-delivery/route.ts','utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} as { POST: (r: Request,c: unknown) => Promise<Response> } }
  new Function('require','module','exports', output)((name: string) => { assert.ok(name in deps, name); return deps[name] }, module,module.exports)
  return { calls, snapshot, messages, run: () => module.exports.POST(new Request('https://example.invalid/api/report-delivery', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resend', primary_recipient: 'customer@example.invalid' }),
  }), { params: Promise.resolve({ id: inspectionId }) }) }
}

test('resend sends the selected frozen version without publication, rebuilding, revocation or lock changes', async () => {
  const old = process.env.ASSIGNMENTS_MAIL_FROM
  process.env.ASSIGNMENTS_MAIL_FROM='inspector@example.invalid'
  try {
    const h = harness(); const before=structuredClone(h.snapshot)
    const r=await h.run(); const payload=await r.json()
    assert.equal(r.status,200,JSON.stringify(payload))
    assert.equal(h.calls.mail.length,1); assert.equal(h.calls.builds,0); assert.equal(h.calls.jobs,0)
    assert.deepEqual(h.calls.inserts,['outbound_messages']); assert.deepEqual(h.calls.updates,['outbound_messages'])
    assert.equal(h.messages[0].inspection_id,'10000000-0000-4000-8000-000000000001')
    assert.equal(h.messages[0].report_link_id,'10000000-0000-4000-8000-000000000002')
    assert.equal(h.messages[0].assignment_id,null)
    assert.ok(payload.inspectionLockedAt); assert.equal(payload.canDownloadPdf,true)
    assert.deepEqual(h.snapshot,before)
    const failed = harness({failed:true}); assert.equal((await failed.run()).status,502)
    assert.equal(failed.messages[0].status,'failed'); assert.equal(failed.calls.jobs,0)
    assert.equal((await harness({missing:true}).run()).status,409)
    const denied = harness({denied:true}); assert.equal((await denied.run()).status,401); assert.equal(denied.calls.mail.length,0)
  } finally { if(old===undefined)delete process.env.ASSIGNMENTS_MAIL_FROM; else process.env.ASSIGNMENTS_MAIL_FROM=old }
})
