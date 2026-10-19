import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Node's strip-types runner requires the TypeScript extension.
import { authLoginUrl, isProtectedAppPath, safeAuthReturnPath } from '../src/lib/auth/returnPath.ts'
// @ts-expect-error Node's strip-types runner requires the TypeScript extension.
import { getRenoAppReturnPath } from '../src/lib/renoapp/brfLifecycle.ts'

const ID = 'f5a870d5-2671-4ab2-977c-55fef662a880'

test('all protected modules retain their detail page, organization, selected view and anchor', () => {
  const paths = [
    '/app', '/dashboard-v1', '/ob', `/ob/assignments/${ID}`, '/eb',
    `/eb/projects/${ID}/inspections/${ID}/perform`, `/tu/investigations/${ID}`,
    `/fuktsakerhet/projekt/${ID}`, `/uppdrag/${ID}`, `/properties/${ID}/ob/${ID}`,
    '/inspections', '/settings/organisation', '/admin/renoapp/flow-builder',
    '/renoapp/app', `/renoapp/app/cases/${ID}`, `/renoapp/review/${ID}`,
    '/mina-uppdrag', `/mina-uppdrag/uppdrag/${ID}`, `/utlatande/${ID}/${ID}`,
  ]
  for (const path of paths) {
    assert.equal(isProtectedAppPath(path), true, path)
    const destination = `${path}?orgId=${ID}&tab=documents&view=contract#board-decision`
    assert.equal(safeAuthReturnPath(destination), destination)
  }
})

test('public, token, login, reset, activation, API and asset paths never enter session recovery', () => {
  for (const path of [
    '/', '/login', '/auth/reset-password', '/auth/session-unavailable', '/api/tu/assignments', '/besiktapp',
    '/renoapp', '/renoapp/apply', '/renoapp/login', '/renoapp/request-access', '/renoapp/invite/token',
    '/renoapp/case/token', '/renoapp/review/not-a-uuid', '/mina-uppdrag/logga-in',
    '/mina-uppdrag/aktivera/token', '/mina-uppdrag/uppdrag/token', '/mina-uppdrag/other',
    '/organisation/inbjudan', '/settings/organisation/skapa/other', '/accept/token', '/rapport/token',
    '/dashboard-v1/other', '/app/other', '/tu/public/token', '/tu/login', '/tu/api/data',
    '/ob/logo.png', '/renoapp/app/style.css', '/admin/script.js', '/tu/manifest.json', '/_next/static/chunk.js',
    '/utlatande/token', `/utlatande/${ID}/not-a-uuid`, `/utlatande/${ID}/${ID}/other`,
  ]) {
    assert.equal(isProtectedAppPath(path), false, path)
    if (path !== '/organisation/inbjudan') assert.equal(safeAuthReturnPath(path), '/app', path)
  }
})

test('untrusted origins, traversal, encoded separators, controls and malformed encodings fail closed', () => {
  for (const value of [
    undefined, null, [], {}, 7, '', ' /tu', '/tu ', 'https://hushub.se/tu', '//evil.test/tu',
    'javascript:alert(1)', '\\evil.test', '/\\evil.test', '/tu\\assignments', '/tu/../admin',
    '/tu/./assignments', '/tu//assignments', '/tu/%2e%2e/admin', '/tu/%252e%252e/admin',
    '/tu/%2fassignment', '/tu/%252fassignment', '/tu/%5cassignment', '/tu/%255cassignment',
    '/tu\n', '/tu\t', '/tu?orgId=one%0Atwo', '/tu?tab=%C2%85', '/tu?tab=%', '/tu?tab=%E0%A4',
  ]) assert.equal(safeAuthReturnPath(value), '/app', String(value))
})

test('nested redirect and authentication values are removed while future UI selection state is preserved', () => {
  const value = `/tu/investigations/${ID}?orgId=${ID}&next=%2Fadmin&redirect_uri=https%3A%2F%2Fevil.test&returnTo=%2Fob&callbackUrl=%2Flogin&access_token=secret&refreshToken=secret&token_hash=secret&code=secret&password=secret&futureFilter=pending&tag=one&tag=two#observations`
  assert.equal(safeAuthReturnPath(value), `/tu/investigations/${ID}?orgId=${ID}&futureFilter=pending&tag=one&tag=two#observations`)
  assert.equal(safeAuthReturnPath('/tu?next=https://evil.test#access_token=secret'), '/tu')
  assert.equal(safeAuthReturnPath('/tu?q=Skadad%20v%C3%A4gg'), '/tu?q=Skadad+v%C3%A4gg')
  assert.equal(safeAuthReturnPath('/tu?custom=https%3A%2F%2Fevil.test&another=%252Fadmin&tab=report'), '/tu?tab=report')
})

test('existing organization invitation and creation destinations remain exact and token-free', () => {
  for (const path of ['/organisation/inbjudan', '/settings/organisation/skapa']) {
    assert.equal(safeAuthReturnPath(path), path)
    for (const suffix of ['?orgId=other', '?next=%2Ftu', '#invite=secret', '/other']) {
      assert.equal(safeAuthReturnPath(`${path}${suffix}`), '/app')
    }
  }
})

test('authenticated report printing keeps its visit and print options without allowing public report tokens', () => {
  const report = `/utlatande/${ID}/${ID}?orgId=${ID}&embed=1&pdf=1&autoprint=1`
  assert.equal(safeAuthReturnPath(report), report)
  assert.equal(new URL(authLoginUrl(report), 'https://hushub.test').searchParams.get('next'), report)
  assert.equal(safeAuthReturnPath('/rapport/personal-token'), '/app')
})

test('invalid fallbacks cannot create an open redirect', () => {
  assert.equal(safeAuthReturnPath(null, '/renoapp/app'), '/renoapp/app')
  assert.equal(safeAuthReturnPath(null, '//evil.test'), '/app')
  assert.equal(safeAuthReturnPath(null, '/login?next=%2Ftu'), '/app')
})

test('login links select the product login and encode the complete safe destination exactly once', () => {
  const destinations = [
    [`/tu/assignments/${ID}?orgId=${ID}&tab=report#review`, '/login'],
    [`/uppdrag/${ID}?view=contract`, '/login'],
    [`/renoapp/app/cases/${ID}?tab=documents#board-decision`, '/renoapp/login'],
    [`/renoapp/review/${ID}`, '/renoapp/login'],
    [`/mina-uppdrag/uppdrag/${ID}?view=documents`, '/mina-uppdrag/logga-in'],
    ['/mina-uppdrag', '/mina-uppdrag/logga-in'],
  ]
  for (const [destination, login] of destinations) {
    const url = new URL(authLoginUrl(destination), 'https://hushub.se')
    assert.equal(url.pathname, login)
    assert.equal(url.searchParams.get('next'), destination)
  }
  assert.equal(authLoginUrl('//evil.test'), '/login?next=%2Fapp')
})

test('RenoApp login preserves protected RenoApp detail pages and existing exact invitation links', () => {
  for (const path of [`/renoapp/app/cases/${ID}?tab=documents#board-decision`, `/renoapp/review/${ID}`, '/renoapp/invite/abc_DEF-123']) {
    assert.equal(getRenoAppReturnPath(path), path)
  }
  for (const path of ['/tu', '/admin', '/renoapp/app/../login', '/renoapp/invite/token?next=%2Fadmin', '/renoapp/invite/token#secret']) {
    assert.equal(getRenoAppReturnPath(path), '/renoapp/app')
  }
})
