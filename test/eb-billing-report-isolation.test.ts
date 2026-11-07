import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type { EbInspectionReport } from '../src/lib/eb/server'
import type * as Snapshots from '../src/lib/eb/reportSnapshot'

const source = readFileSync(new URL('../src/lib/eb/reportSnapshot.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText
const compiledModule = { exports: {} }
new Function('require', 'module', 'exports', compiled)((name: string) => {
  throw new Error(`Unexpected snapshot dependency: ${name}`)
}, compiledModule, compiledModule.exports)
const snapshots = compiledModule.exports as typeof Snapshots

function fixture(): EbInspectionReport {
  const inspection = {
    inspectionId: 'inspection', status: 'completed', reportLockedAt: '2026-11-07T09:00:00Z',
    reportDeliveryStatus: 'sent', reportLastSentAt: '2026-11-07T09:05:00Z',
    reportDistributionDate: '2026-11-07', date: '2026-11-06',
    billing: { status: 'invoiced', invoiceNumber: 'PRIVATE-INVOICE-123',
      invoicedAt: '2026-11-07T10:00:00Z', updatedAt: '2026-11-07T10:00:00Z',
      updatedByName: 'PRIVATE-ACCOUNTING-USER', revision: 3 },
  }
  return {
    project: { id: 'project', title: 'Test', inspections: [inspection, { ...inspection, inspectionId: 'other' }] },
    inspection, participants: [], notes: [], images: [], projectAttachments: [],
    reportDraft: { sections: [], sourceSnapshot: null }, branding: {},
  } as unknown as EbInspectionReport
}

test('private accounting status is removed from every public inspection copy without mutating internal data', () => {
  const report = fixture()
  const original = structuredClone(report)
  const published = snapshots.sanitizeEbReportForPublicDelivery(report)
  assert.equal(Object.hasOwn(published.inspection, 'billing'), false)
  assert.ok(published.project.inspections.every(inspection => !Object.hasOwn(inspection, 'billing')))
  assert.doesNotMatch(JSON.stringify(published), /PRIVATE-INVOICE|PRIVATE-ACCOUNTING-USER|invoicedAt|updatedByName/)
  assert.equal(published.inspection.status, 'completed')
  assert.equal(published.inspection.reportLockedAt, original.inspection.reportLockedAt)
  assert.equal(published.inspection.reportDeliveryStatus, 'sent')
  assert.deepEqual(report, original)
})

test('new frozen report payloads never persist manual billing metadata or depend on invoice changes', () => {
  const report = fixture()
  const first = snapshots.createEbReportSnapshotPayloadV1(report)
  assert.doesNotMatch(JSON.stringify(first), /billing|PRIVATE-INVOICE|PRIVATE-ACCOUNTING-USER/)
  report.inspection.billing = {
    status: 'not_invoiced', invoiceNumber: null, invoicedAt: null,
    updatedAt: '2026-11-07T11:00:00Z', updatedByName: 'OTHER-ACCOUNTING-USER', revision: 4,
  }
  const second = snapshots.createEbReportSnapshotPayloadV1(report)
  assert.deepEqual(second.report, first.report)
  assert.deepEqual(second.meta, first.meta)
  assert.equal(report.inspection.billing.status, 'not_invoiced')
})
