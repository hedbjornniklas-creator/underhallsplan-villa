import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

test('delivery retains report preview after removal of the separate review step', () => {
  const source = readFileSync(new URL('../src/components/ob/ObWizard.tsx', import.meta.url), 'utf8')
  const delivery = source.slice(source.indexOf("case 'delivery':"), source.indexOf("case 'grunddata':"))
  assert.doesNotMatch(source, /ObStepGranska|case 'review':|\| 'review'|availableSections/)
  assert.equal(existsSync(new URL('../src/components/ob/ObStepGranska.tsx', import.meta.url)), false)
  assert.match(source, /const iframeSrc = hasValidIds \? `\$\{reportHref\}\?embed=1&pdf=1`/)
  assert.match(source, /const reportDeliveryPreviewHref = iframeSrc/)
  assert.match(delivery, /Förhandsgranska utlåtande/)
  assert.match(delivery, /<iframe\s+title="Utlåtande för granskning"\s+src=\{reportDeliveryPreviewHref\}/)
  assert.match(delivery, /href=\{reportDeliveryPreviewHref\}/)
})

test('delivery opens the frozen customer report, never the live print preview', () => {
  const source = readFileSync(new URL('../src/components/ob/ObWizard.tsx', import.meta.url), 'utf8')
  const delivery = source.slice(source.indexOf("case 'delivery':"))
  assert.match(delivery, /hasValidIds \? \(/)
  assert.match(delivery, /deliveryMeta\?\.digitalReportUrl \? <Link\s+href=\{deliveryMeta.digitalReportUrl\}\s+target="_blank"\s+rel="noopener noreferrer"/)
  assert.match(delivery, /Öppna kundens digitala utlåtande/)
  assert.match(delivery, /Inget publicerat digitalt utlåtande ännu/)
  assert.ok(delivery.indexOf('Öppna kundens digitala utlåtande') < delivery.indexOf('Huvudmottagare'))
  const page = readFileSync(new URL('../src/app/ob/inspections/[id]/digital/page.tsx', import.meta.url), 'utf8')
  assert.match(page, /requireObInspectionContext\(id, orgId\)/)
  assert.doesNotMatch(page, /requireOrgContext\(/)
  assert.match(page, /getObPublishedReport/)
  assert.match(page, /<ReportSnapshotView snapshot=\{snapshot\}/)
  assert.doesNotMatch(page, /buildReportData|iframe|ReportSnapshotPrintDocument/)
})
