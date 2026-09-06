import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Node's strip-types runner requires the TypeScript extension.
import { getPublicLoginDestination, getPublicProductHref, isPublicRenoPage, PUBLIC_PRODUCTS } from '../src/lib/publicNavigation.ts'

test('anonymous product links retain the intended destination through the existing login routes', () => {
  for (const product of ['besiktapp', 'renoapp'] as const) {
    const url = new URL(getPublicProductHref(product, false), 'https://example.test')
    assert.equal(url.pathname, product === 'besiktapp' ? '/login' : '/renoapp/login')
    assert.equal(url.searchParams.get('next'), PUBLIC_PRODUCTS[product].appHref)
  }
})

test('authenticated product links go directly to canonical apps', () => {
  assert.equal(getPublicProductHref('besiktapp', true), '/dashboard-v1')
  assert.equal(getPublicProductHref('renoapp', true), '/renoapp/app')
})

test('generic login keeps the original destination allowlist and rejects external or unexpected targets', () => {
  for (const allowed of ['/dashboard-v1', '/renoapp/app', '/mina-uppdrag']) {
    assert.equal(getPublicLoginDestination(allowed), allowed)
  }
  for (const rejected of [undefined, null, '', '/admin', '//example.test', 'https://example.test', '/dashboard-v1/other', ['/dashboard-v1']]) {
    assert.equal(getPublicLoginDestination(rejected), '/app')
  }
})

test('public headers replace only public RenoApp entry headers, never private or personal-link pages', () => {
  for (const path of ['/renoapp', '/renoapp/apply', '/renoapp/login', '/renoapp/request-access']) {
    assert.equal(isPublicRenoPage(path), true)
  }
  for (const path of ['/renoapp/app', '/renoapp/app/cases', '/renoapp/brf/example/apply', '/renoapp/invite', '/renoapp/apply/token', '/admin/renoapp']) {
    assert.equal(isPublicRenoPage(path), false)
  }
})
