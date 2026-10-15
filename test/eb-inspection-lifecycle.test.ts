import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
// @ts-expect-error Node strip-types uses the explicit TypeScript extension.
import { getEbInspectionLifecycle } from '../src/lib/eb/inspectionLifecycle.ts'

const lockedAt = '2026-10-12T10:00:00Z'

test('EB work completion is independent of project completion and approval decision', () => {
  assert.equal(getEbInspectionLifecycle({ status: 'draft' }, 'completed').isOpen, true)
  const completed = getEbInspectionLifecycle({ status: 'draft', reportLockedAt: lockedAt, reportDeliveryStatus: 'sent', reportPdfStatus: 'ready' })
  assert.equal(completed.workStatus, 'completed')
  assert.equal(completed.isOpen, false)
  assert.equal(completed.needsAttention, false)
  assert.equal(completed.deliveryLabel, 'Skickat')
  assert.equal(getEbInspectionLifecycle({ status: 'completed' }).isOpen, false, 'a missing lock alone cannot reopen legacy completed work')
})

test('EB reopening requires audit evidence and does not treat an old delivery as the new draft', () => {
  const reopened = getEbInspectionLifecycle({ status: 'completed', reportReopenedAt: lockedAt, reportLastSentAt: lockedAt, reportDeliveryStatus: 'sent' })
  assert.equal(reopened.isOpen, true)
  assert.equal(reopened.workLabel, 'Under ändring')
  assert.equal(reopened.deliveryLabel, 'Tidigare version skickad')
  assert.equal(reopened.deliveryAction, null)
  const relocked = getEbInspectionLifecycle({ status: 'ongoing', reportReopenedAt: lockedAt, reportLockedAt: lockedAt, reportDeliveryStatus: 'not_sent' })
  assert.equal(relocked.isOpen, false)
  assert.equal(relocked.isReopened, false)
  assert.equal(relocked.deliveryAction, 'Leverera utlåtandet')
})

test('EB completed delivery problems stay actionable while completed PDF processing does not reopen a visit', () => {
  for (const inspection of [
    { reportDeliveryStatus: 'not_sent' },
    { reportDeliveryStatus: 'failed' },
    { reportDeliveryStatus: 'sent', reportPdfStatus: 'failed' },
  ]) {
    const result = getEbInspectionLifecycle({ status: 'completed', reportLockedAt: lockedAt, ...inspection })
    assert.equal(result.isOpen, false)
    assert.equal(result.needsAttention, true)
    assert.ok(result.deliveryAction)
  }
  const processing = getEbInspectionLifecycle({ reportLockedAt: lockedAt, reportDeliveryStatus: 'sent', reportPdfStatus: 'processing' })
  assert.equal(processing.needsAttention, false)
  assert.equal(processing.deliveryLabel, 'Skickat · PDF förbereds')
  const sending = getEbInspectionLifecycle({ reportLockedAt: lockedAt, reportDeliveryStatus: 'sending', reportPdfStatus: 'ready' })
  assert.equal(sending.deliveryLabel, 'Utskick pågår')
  assert.equal(sending.needsAttention, false)
})

test('EB archived and cancelled work is suppressed, even when old delivery failed', () => {
  for (const status of ['archived', 'Arkiverad', 'cancelled', 'avbokad']) {
    const inspection = { status: 'draft', reportLockedAt: lockedAt, reportDeliveryStatus: 'failed' }
    const result = getEbInspectionLifecycle(inspection, status)
    assert.equal(result.isOpen, false)
    assert.equal(result.needsAttention, false)
    assert.equal(getEbInspectionLifecycle({ ...inspection, status }).isOpen, false)
  }
})

type Row = Record<string, unknown>
type AuditApi = {
  fetchLatestEbUnlocks: (orgId: string, ids: string[]) => Promise<Map<string, string>>
  fetchReportDeliveriesByInspectionIds: (ids: string[], links: Map<string, Row>) => Promise<Map<string, { status: string; lastSentAt: string | null }>>
}

function auditService(rows: Record<string, Row[]>) {
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  const createSupabaseAdminClient = () => ({ from(table: string) {
    const read = { table, filters: [] as Array<[string, unknown]> }
    reads.push(read)
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { read.filters.push([key, value]); return query },
      in: (key: string, value: string[]) => { read.filters.push([key, value]); return query },
      order: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve),
    }
    return query
  } })
  const source = readFileSync(new URL('../src/lib/eb/server.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true)
  const names = ['fetchLatestEbUnlocks', 'fetchReportDeliveriesByInspectionIds', 'isMissingRelationError']
  const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
  const compiled = ts.transpileModule(selected.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const api = new Function('createSupabaseAdminClient', `${compiled}; return {${names.join(',')}}`)(createSupabaseAdminClient) as AuditApi
  return { api, reads }
}

test('EB reopening read scopes audit to organization, inspection ids and actual unlock actions', async () => {
  const { api, reads } = auditService({ inspection_lock_events: [
    { inspection_id: 'i', performed_at: '2026-10-12T12:00:00Z' },
    { inspection_id: 'i', performed_at: lockedAt },
  ] })
  assert.equal((await api.fetchLatestEbUnlocks('org', ['i'])).get('i'), '2026-10-12T12:00:00Z')
  assert.deepEqual(reads[0].filters, [['org_id', 'org'], ['inspection_id', ['i']], ['action', 'unlock']])
  assert.equal((await api.fetchLatestEbUnlocks('org', [])).size, 0)
  assert.equal(reads.length, 1)
})

test('EB current-revision delivery keeps partial failures visible and successful retries replace older attempts', async () => {
  const time = '2026-10-12T12:00:00Z'
  const { api } = auditService({ outbound_messages: [
    { inspection_id: 'i', recipient_email: 'customer@example.test', status: 'sent', sent_at: time, created_at: time },
    { inspection_id: 'i', recipient_email: 'contractor@example.test', status: 'failed', created_at: time },
    { inspection_id: 'i', recipient_email: 'customer@example.test', status: 'failed', created_at: lockedAt },
    { inspection_id: 'old', recipient_email: 'customer@example.test', status: 'sent', created_at: lockedAt },
  ] })
  const rows = await api.fetchReportDeliveriesByInspectionIds(['i', 'old', 'missing'], new Map([
    ['i', { created_at: lockedAt }], ['old', { created_at: time }],
  ]))
  assert.equal(rows.get('i')?.status, 'failed')
  assert.equal(rows.get('i')?.lastSentAt, time)
  assert.equal(rows.get('old')?.status, 'not_sent')
  assert.equal(rows.get('missing')?.status, 'not_sent')
  const retry = auditService({ outbound_messages: [
    { inspection_id: 'i', recipient_email: 'CUSTOMER@example.test', status: 'sent', sent_at: time, created_at: time },
    { inspection_id: 'i', recipient_email: 'customer@example.test', status: 'failed', created_at: lockedAt },
  ] })
  assert.equal((await retry.api.fetchReportDeliveriesByInspectionIds(['i'], new Map([['i', { created_at: lockedAt }]]))).get('i')?.status, 'sent')
})
