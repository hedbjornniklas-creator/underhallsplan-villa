import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('delivery opens the frozen customer report, never the live print preview', () => {
  const source = readFileSync(new URL('../src/components/ob/ObWizard.tsx', import.meta.url), 'utf8')
  const delivery = source.slice(source.indexOf("case 'delivery':"))
  assert.match(delivery, /hasValidIds \? \(/)
  assert.match(delivery, /deliveryMeta\?\.digitalReportUrl \? <Link\s+href=\{deliveryMeta.digitalReportUrl\}\s+target="_blank"\s+rel="noopener noreferrer"/)
  assert.match(delivery, /Öppna kundens digitala utlåtande/)
  assert.match(delivery, /Inget publicerat digitalt utlåtande ännu/)
  assert.ok(delivery.indexOf('Öppna kundens digitala utlåtande') < delivery.indexOf('Huvudmottagare'))
  const page = readFileSync(new URL('../src/app/ob/inspections/[id]/digital/page.tsx', import.meta.url), 'utf8')
  assert.match(page, /requireOrgContext\(\)/)
  assert.match(page, /getObPublishedReport/)
  assert.match(page, /<ReportSnapshotView snapshot=\{snapshot\}/)
  assert.doesNotMatch(page, /buildReportData|iframe|ReportSnapshotPrintDocument/)
})
