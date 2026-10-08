import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// @ts-expect-error Node's strip-types runner requires explicit TypeScript extensions.
import { organizationContextHarness, organizationA, organizationB, elementText } from './helpers/organization-context-harness.ts'

const queryA = `orgId=${organizationA.id}`
const queryB = `orgId=${organizationB.id}`

test('one shared context request serves both the topbar and the OB boundary after session initialization', async () => {
  const view = organizationContextHarness()
  assert.equal(view.render('/ob', queryA).props.role, 'status')
  assert.equal(view.requests.length, 0, 'Wait for the current browser identity before fetching')
  await view.settle()
  assert.equal(view.requests.length, 1)
  assert.equal(view.requests[0].options.cache, 'no-store')
  assert.equal(view.requests[0].options.credentials, 'same-origin')
  assert.equal(view.context().organization, null)
  await view.finish(0)
  assert.equal(view.render().props.value.id, organizationA.id)
  assert.match(elementText(view.switcher()), /A/)
  assert.equal(view.context().organization.id, organizationA.id)
  assert.equal(view.requests.length, 1)
  view.dispose()
})

test('same workspace page changes and unrelated query parameters do not repeat organization reads', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', queryA)
  await view.finish(0)
  for (const [path, query] of [['/ob/assignments', queryA], ['/inspections', `${queryA}&search=road&sort=date`],
    ['/ob/assignments/new', `${queryA}&tab=customer`], ['/ob', `filter=active&${queryA}`]]) {
    assert.equal(view.render(path, query).props.value.id, organizationA.id)
    assert.equal(view.requests.length, 1, `${path}: shared workspace still applies`)
  }
  view.dispose()
})

test('canonicalizing a missing orgId reuses the verified result without another request or loading flash', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', 'filter=active')
  await view.finish(0)
  assert.equal(view.render().props.value.id, organizationA.id)
  assert.deepEqual(view.replacements, [`/ob?filter=active&${queryA}`])
  assert.equal(view.render('/ob', `filter=active&${queryA}`).props.value.id, organizationA.id)
  assert.equal(view.requests.length, 1)
  view.dispose()
})

test('canonicalization follows the current same-context route, never the route captured when the request began', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', 'filter=active')
  view.render('/inspections', 'search=roof')
  assert.equal(view.requests.length, 1)
  await view.finish(0)
  view.render()
  assert.deepEqual(view.replacements, [`/inspections?search=roof&${queryA}`])
  view.dispose()
})

test('changing organization hides the old form and topbar immediately and ignores an out-of-order reply', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', queryA)
  assert.equal(view.render('/ob', queryB).props.role, 'status')
  assert.equal(view.context().organization, null)
  assert.equal(view.requests[0].signal.aborted, true)
  assert.equal(view.requests.length, 2)
  await view.finish(1, organizationB)
  assert.equal(view.render().props.value.id, organizationB.id)
  await view.finish(0, organizationA)
  assert.equal(view.render().props.value.id, organizationB.id)
  assert.equal(view.context().organization.id, organizationB.id)
  assert.deepEqual(view.replacements, [])
  view.dispose()
})

test('each different persisted OB entity requires fresh validation even within the same organization', async () => {
  const view = organizationContextHarness()
  await view.ready('/properties/p/ob/first', queryA)
  assert.equal(view.requests[0].url.searchParams.get('inspectionId'), 'first')
  await view.finish(0)
  assert.equal(view.render().props.value.id, organizationA.id)
  assert.equal(view.render('/properties/p/ob/first', `${queryA}&step=report`).props.value.id, organizationA.id)
  assert.equal(view.requests.length, 1)
  assert.equal(view.render('/properties/p/ob/second', queryA).props.role, 'status')
  assert.equal(view.context().organization, null)
  assert.equal(view.requests[1].url.searchParams.get('inspectionId'), 'second')
  await view.finish(1)
  view.render()
  assert.equal(view.render('/ob/assignments/second', queryA).props.role, 'status')
  assert.equal(view.requests[2].url.searchParams.get('assignmentId'), 'second')
  assert.equal(view.requests[2].url.searchParams.has('inspectionId'), false)
  view.dispose()
})

test('a different module surface cannot borrow the OB workspace result', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', queryA)
  await view.finish(0)
  view.render('/tu', queryA)
  assert.equal(view.context().organization, null)
  assert.equal(view.requests.length, 2)
  assert.equal(view.requests[1].url.searchParams.get('surface'), 'tu')
  view.dispose()
})

test('duplicate organization selectors fail closed, including duplicates of the same ID', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', queryA)
  await view.finish(0)
  assert.equal(view.render().props.value.id, organizationA.id)
  for (const query of [`${queryA}&${queryB}`, `${queryA}&${queryA}`]) {
    assert.equal(view.render('/ob', query).type, 'main')
    assert.equal(view.context().invalidSelection, true)
    assert.equal(view.context().organization, null)
    assert.equal(view.requests.length, 1)
  }
  view.dispose()
})

test('correcting a duplicate selector requires fresh validation instead of reviving a previous context', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', queryA)
  await view.finish(0)
  assert.equal(view.render().props.value.id, organizationA.id)
  assert.equal(view.render('/ob', `${queryA}&${queryA}`).type, 'main')
  assert.equal(view.render('/ob', queryA).props.role, 'status')
  assert.equal(view.requests.length, 2)
  await view.finish(1)
  assert.equal(view.render().props.value.id, organizationA.id)
  view.dispose()
})

test('logout clears both consumers, cancels pending work and cannot be undone by its late reply', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', queryA)
  view.auth('SIGNED_OUT', null)
  assert.equal(view.context().organization, null)
  view.render()
  assert.equal(view.requests[0].signal.aborted, true)
  await view.finish(0)
  assert.notEqual(view.render().type, 'Provider')
  assert.equal(view.context().organization, null)
  view.advance(60_000)
  view.focus()
  await view.settle()
  assert.equal(view.requests.length, 1, 'Focus never reloads organization access after logout')
  view.dispose()
})

test('a changed account with the same organization must authenticate its own context from scratch', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', queryA)
  await view.finish(0)
  assert.equal(view.render().props.value.id, organizationA.id)
  view.auth('SIGNED_IN', 'person-b')
  assert.notEqual(view.render().type, 'Provider')
  assert.equal(view.context().organization, null)
  assert.equal(view.requests.length, 2)
  view.requests[1].finish({ error: 'Du saknar tillgång till organisationen.' }, false)
  await view.settle()
  assert.equal(view.render().type, 'main')
  assert.equal(view.context().organization, null)
  view.dispose()
})

test('same-user token refresh does not repeat the organization request', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', queryA)
  await view.finish(0)
  view.render()
  view.auth('TOKEN_REFRESHED', 'person-a')
  assert.equal(view.render().props.value.id, organizationA.id)
  assert.equal(view.requests.length, 1)
  view.dispose()
})

test('logout and same-account sign-in in one React batch still require a fresh context', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', queryA)
  await view.finish(0)
  assert.equal(view.render().props.value.id, organizationA.id)
  view.auth('SIGNED_OUT', null)
  view.auth('SIGNED_IN', 'person-a')
  assert.notEqual(view.render().type, 'Provider')
  assert.equal(view.context().organization, null)
  assert.equal(view.requests.length, 2)
  await view.finish(1)
  assert.equal(view.render().props.value.id, organizationA.id)
  view.dispose()
})

test('returning to an earlier organization during the next load does not resurrect its previous snapshot', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', queryA)
  await view.finish(0)
  assert.equal(view.render().props.value.id, organizationA.id)
  assert.equal(view.render('/ob', queryB).props.role, 'status')
  assert.equal(view.render('/ob', queryA).props.role, 'status')
  assert.equal(view.requests.length, 3)
  assert.equal(view.requests[1].signal.aborted, true)
  await view.finish(1, organizationB)
  assert.equal(view.render().props.role, 'status')
  await view.finish(2)
  assert.equal(view.render().props.value.id, organizationA.id)
  view.dispose()
})

test('focus revalidation is throttled, keeps the active form mounted, and preserves it after a network failure', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', queryA)
  await view.finish(0)
  const original = view.render()
  view.focus()
  view.render()
  assert.equal(view.requests.length, 1)
  view.advance(60_000)
  view.focus()
  const refreshing = view.render()
  assert.equal(view.requests.length, 2)
  assert.equal(refreshing.type, 'Provider')
  assert.equal(refreshing.key, original.key)
  assert.equal(refreshing.props.value.id, organizationA.id)
  view.focus()
  view.render()
  assert.equal(view.requests.length, 2, 'Only one in-flight revalidation')
  view.requests[1].reject(new TypeError('Network unavailable'))
  const preserved = await view.settle()
  assert.equal(preserved.type, 'Provider')
  assert.equal(preserved.key, original.key)
  view.dispose()
})

test('focus removes a revoked workspace on an authorization failure instead of retaining cached permissions', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', queryA)
  await view.finish(0)
  view.render()
  view.advance(60_000)
  view.focus()
  view.render()
  view.requests[1].finish({ error: 'Du saknar tillgång till organisationen.' }, false, 403)
  assert.equal((await view.settle()).type, 'main')
  assert.equal(view.context().organization, null)
  assert.deepEqual(view.context().organizations, [])
  view.dispose()
})

test('background 5xx preserves an open form but a malformed 200 reply clears the context', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', queryA)
  await view.finish(0)
  const original = view.render()
  view.advance(60_000)
  view.focus()
  view.render()
  view.requests[1].finish({ error: 'Tillfälligt serverfel.' }, false, 503)
  const retained = await view.settle()
  assert.equal(retained.type, 'Provider')
  assert.equal(retained.key, original.key)
  assert.equal(retained.props.value.id, organizationA.id)
  view.advance(60_000)
  view.focus()
  view.render()
  view.requests[2].finish({ organization: organizationA, organizations: [] })
  assert.equal((await view.settle()).type, 'main')
  assert.equal(view.context().organization, null)
  view.dispose()
})

test('the real shared-context switcher still honors dirty-form and pending-write navigation guards', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob/assignments/new', queryA)
  await view.finish(0)
  view.render()
  type Node = { type: unknown; props: { children?: unknown; role?: string; onClick?: () => void } }
  const flatten = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(flatten)
    : node && typeof node === 'object' && 'props' in node
      ? [node as Node, ...flatten((node as Node).props.children)] : []
  const open = flatten(view.switcher()).find(node => node.type === 'button')
  assert.ok(open?.props.onClick)
  open.props.onClick()
  view.render()
  const otherOrganization = flatten(view.switcher()).filter(node => node.props.role === 'menuitemradio')[1]
  assert.ok(otherOrganization?.props.onClick)
  view.guard(true, false)
  otherOrganization.props.onClick()
  assert.deepEqual(view.pushes, [])
  view.setConfirmation(true)
  view.guard(false, true)
  otherOrganization.props.onClick()
  assert.deepEqual(view.pushes, [], 'Pending writes always prevent switching')
  view.guard(true, false)
  otherOrganization.props.onClick()
  assert.deepEqual(view.pushes, [`/ob?${queryB}`])
  assert.equal(view.requests.length, 1, 'Opening the shared switcher issues no extra context request')
  view.dispose()
})

test('mismatched or incomplete context responses cannot authorize the selected workspace', async () => {
  for (const body of [
    { organization: organizationB, organizations: [organizationA, organizationB] },
    { organization: organizationA, organizations: [organizationB] },
    { organization: organizationA },
    { organizations: [organizationA] },
    null,
  ]) {
    const view = organizationContextHarness()
    await view.ready('/ob', queryA)
    view.requests[0].finish(body)
    assert.equal((await view.settle()).type, 'main')
    assert.equal(view.context().organization, null)
    assert.deepEqual(view.replacements, [])
    view.dispose()
  }
})

test('leaving organization-aware pages cancels an in-flight context and ignores its late response', async () => {
  const view = organizationContextHarness()
  await view.ready('/ob', queryA)
  view.render('/account', '')
  assert.equal(view.context().selectionKey, null)
  assert.equal(view.context().organization, null)
  assert.equal(view.requests[0].signal.aborted, true)
  await view.finish(0)
  view.render()
  assert.equal(view.context().organization, null)
  assert.deepEqual(view.replacements, [])
  view.dispose()
})

test('shared workspace state is mounted once per application shell and never persisted as an authorization cache', () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  for (const path of ['src/components/DashboardLayoutShell.tsx', 'src/app/(app)/layout.tsx']) {
    assert.match(read(path), /<OrganizationContextProvider[\s>]/)
  }
  assert.doesNotMatch(read('src/components/organizations/OrganizationContextProvider.tsx'), /localStorage|sessionStorage/)
  for (const path of ['src/components/ob/ObOrganizationBoundary.tsx', 'src/components/organizations/ActiveOrganizationSwitcher.tsx']) {
    assert.match(read(path), /useOrganizationContext\(/)
    assert.doesNotMatch(read(path), /fetch\(/, `${path} must consume the shared request, not issue its own`)
  }
})
