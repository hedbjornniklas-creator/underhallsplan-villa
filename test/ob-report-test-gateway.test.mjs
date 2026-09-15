import test from 'node:test'
import assert from 'node:assert/strict'
import { allowReportTestPath } from '../scripts/lib/ob-report-test-gateway.mjs'

test('report HTTPS entry exposes only current synthetic render/link and static assets', () => {
  const identity = { linkId: 'test-link', token: 'test-token' }
  for (const path of ['/internal/report-render/test-link', '/api/reports/public/test-token', '/_next/static/chunks/app.js']) {
    assert.equal(allowReportTestPath(path, identity), true)
  }
  for (const path of ['/admin', '/properties', '/api/ob/inspections/123/buildings', '/staging', '/_next/image', '/internal/report-render/other', '/api/reports/public/other']) {
    assert.equal(allowReportTestPath(path, identity), false)
  }
  assert.equal(allowReportTestPath('/internal/report-render/test-link', {}), false)
})

test('report image proxy is restricted to exact synthetic snapshot URLs', () => {
  const url = 'https://staging.invalid/storage/v1/object/public/inspection-images/test/photo.png'
  const identity = { imageUrls: [url] }
  const query = '?url=' + encodeURIComponent(url)
  assert.equal(allowReportTestPath('/api/image-proxy', identity, query + '&max=900'), true)
  assert.equal(allowReportTestPath('/api/image-proxy', {}, query), false)
  assert.equal(allowReportTestPath('/api/image-proxy', identity, query + '&url=https://other.invalid'), false)
  assert.equal(allowReportTestPath('/api/image-proxy', identity, query + '&extra=1'), false)
  assert.equal(allowReportTestPath('/api/image-proxy', identity, '?url=https://production.invalid'), false)
  assert.equal(allowReportTestPath('/_next/static/../server/file', {}), false)
  assert.equal(allowReportTestPath('/_next/static/%2e%2e/server/file', {}), false)
  assert.equal(allowReportTestPath('/_next/static/chunks/app/internal/report-render/%5BlinkId%5D/page.js', {}), true)
  assert.equal(allowReportTestPath('/report-assets/footer-mark.png', {}), true)
  assert.equal(allowReportTestPath('/report-assets/private.pdf', {}), false)
})
