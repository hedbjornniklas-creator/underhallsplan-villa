import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('delivery exposes the existing authenticated digital report in a separate tab', () => {
  const source = readFileSync(new URL('../src/components/ob/ObWizard.tsx', import.meta.url), 'utf8')
  const delivery = source.slice(source.indexOf("case 'delivery':"))
  assert.match(source, /`\/utlatande\/\$\{propertyId\}\/\$\{inspectionId\}`/)
  assert.match(delivery, /hasValidIds \? \(/)
  assert.match(delivery, /<Link\s+href=\{reportHref\}\s+target="_blank"\s+rel="noopener noreferrer"/)
  assert.match(delivery, /Öppna digitalt utlåtande/)
  assert.ok(delivery.indexOf('Öppna digitalt utlåtande') < delivery.indexOf('Huvudmottagare'))
})
