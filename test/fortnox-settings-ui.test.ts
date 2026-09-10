import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as ComponentModule from '../src/components/settings/FortnoxConnectionCard'
// @ts-expect-error Node's strip-types runner requires the source extension.
import * as fortnoxDomain from '../src/lib/fortnox/domain.ts'

const componentPath = 'src/components/settings/FortnoxConnectionCard.tsx'
const settingsPagePath = 'src/app/(dashboard)/ob/settings/page.tsx'
const componentSource = readFileSync(new URL(`../${componentPath}`, import.meta.url), 'utf8')
const settingsPageSource = readFileSync(new URL(`../${settingsPagePath}`, import.meta.url), 'utf8')
const componentCode = ts.transpileModule(componentSource, {
  fileName: componentPath,
  compilerOptions: {
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText

type ElementNode = {
  type: string | symbol | ((props: Record<string, unknown>) => unknown)
  key: string | null
  props: Record<string, unknown>
}

type FetchCall = {
  url: string
  init: RequestInit | undefined
}

type Organization = {
  id: string
  name: string
  organizationNumber: string | null
  isDefault: boolean
  canManage: boolean
  connection: null | {
    companyName: string
    organizationNumber: string
    grantedScopes: string[]
    status: 'connected' | 'needs_reauthorization'
    connectedAt: string
    lastVerifiedAt: string
  }
}

const FIRST_ORG_ID = '11111111-1111-4111-8111-111111111111'
const DEFAULT_ORG_ID = '22222222-2222-4222-8222-222222222222'

function organization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: FIRST_ORG_ID,
    name: 'Första organisationen AB',
    organizationNumber: '556123-4567',
    isDefault: false,
    canManage: true,
    connection: null,
    ...overrides,
  }
}

function payload(organizations: Organization[], configured = true) {
  return { configured, organizations }
}

function isElement(value: unknown): value is ElementNode {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'type' in value &&
      'props' in value
  )
}

function children(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(children)
  if (value === null || value === undefined || typeof value === 'boolean') return []
  return [value]
}

function visitTree(value: unknown, visitor: (node: ElementNode) => void): void {
  for (const child of children(value)) {
    if (!isElement(child)) continue
    if (typeof child.type === 'function') {
      visitTree(child.type(child.props), visitor)
      continue
    }
    visitor(child)
    visitTree(child.props.children, visitor)
  }
}

function findElements(
  tree: unknown,
  predicate: (node: ElementNode) => boolean
): ElementNode[] {
  const matches: ElementNode[] = []
  visitTree(tree, (node) => {
    if (predicate(node)) matches.push(node)
  })
  return matches
}

function findElement(tree: unknown, predicate: (node: ElementNode) => boolean) {
  const matches = findElements(tree, predicate)
  assert.equal(matches.length, 1, `Expected exactly one matching element, found ${matches.length}`)
  return matches[0]
}

function textContent(value: unknown): string {
  return children(value)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child)
      if (!isElement(child)) return ''
      if (typeof child.type === 'function') return textContent(child.type(child.props))
      return textContent(child.props.children)
    })
    .join('')
}

function sameDependencies(left: readonly unknown[] | undefined, right: readonly unknown[] | undefined) {
  if (!left || !right || left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

function componentHarness(input: {
  href?: string
  statusPayload: ReturnType<typeof payload>
  patchOrganizationNumber?: string
  verificationConnection?: NonNullable<Organization['connection']>
  externalNavigationBlocked?: boolean
}) {
  type StateSlot = { kind: 'state'; value: unknown }
  type RefSlot = { kind: 'ref'; value: { current: unknown } }
  type EffectSlot = {
    kind: 'effect'
    dependencies: readonly unknown[] | undefined
    cleanup?: () => void
  }
  type Slot = StateSlot | RefSlot | EffectSlot
  type PendingEffect = {
    index: number
    dependencies: readonly unknown[] | undefined
    run: () => void | (() => void)
  }

  const slots: Array<Slot | undefined> = []
  const pendingEffects: PendingEffect[] = []
  const calls: FetchCall[] = []
  const history: string[] = []
  let cursor = 0

  function useState<T>(initial: T | (() => T)): [T, (next: T | ((current: T) => T)) => void] {
    const index = cursor++
    let slot = slots[index]
    if (!slot) {
      slot = {
        kind: 'state',
        value: typeof initial === 'function' ? (initial as () => T)() : initial,
      }
      slots[index] = slot
    }
    assert.equal(slot.kind, 'state')
    const state = slot as StateSlot
    return [state.value as T, (next) => {
      state.value = typeof next === 'function'
        ? (next as (current: T) => T)(state.value as T)
        : next
    }]
  }

  function useRef<T>(initial: T) {
    const index = cursor++
    let slot = slots[index]
    if (!slot) {
      slot = { kind: 'ref', value: { current: initial } }
      slots[index] = slot
    }
    assert.equal(slot.kind, 'ref')
    return (slot as RefSlot).value as { current: T }
  }

  function useMemo<T>(factory: () => T) {
    cursor++
    return factory()
  }

  function useEffect(run: PendingEffect['run'], dependencies?: readonly unknown[]) {
    const index = cursor++
    const previous = slots[index]
    if (!previous || previous.kind !== 'effect' || !sameDependencies(previous.dependencies, dependencies)) {
      pendingEffects.push({ index, dependencies, run })
    }
  }

  const Fragment = Symbol('Fragment')
  const jsx = (type: ElementNode['type'], props: Record<string, unknown>, key?: string) => ({
    type,
    props,
    key: key ?? null,
  }) satisfies ElementNode

  const location = { href: input.href ?? 'https://hushub.se/settings' }
  const windowMock = {
    location,
    history: {
      replaceState(_state: unknown, _title: string, path: string) {
        history.push(path)
        location.href = new URL(path, location.href).toString()
      },
    },
  }

  const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
    const normalizedUrl = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
    calls.push({ url: normalizedUrl, init })
    if (normalizedUrl === '/api/integrations/fortnox/status') {
      return Response.json(input.statusPayload)
    }
    if (normalizedUrl === '/api/integrations/fortnox/organization-number') {
      return Response.json({ organizationNumber: input.patchOrganizationNumber ?? '556777-8880' })
    }
    if (normalizedUrl === '/api/integrations/fortnox/verify') {
      if (!input.verificationConnection) {
        throw new Error('A verification response fixture is required')
      }
      return Response.json({ connection: input.verificationConnection })
    }
    throw new Error(`Unexpected fetch from Fortnox settings component: ${normalizedUrl}`)
  }

  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', 'fetch', 'window', componentCode)(
    (name: string) => {
      if (name === 'react') return { useEffect, useMemo, useRef, useState }
      if (name === 'react/jsx-runtime') return { Fragment, jsx, jsxs: jsx }
      if (name === '@/lib/fortnox/domain') return fortnoxDomain
      throw new Error(`Unexpected component dependency: ${name}`)
    },
    compiledModule,
    compiledModule.exports,
    fetchMock,
    windowMock
  )
  const Component = (compiledModule.exports as typeof ComponentModule).default

  function render() {
    cursor = 0
    return Component({ externalNavigationBlocked: input.externalNavigationBlocked ?? false })
  }

  function flushEffects() {
    for (const effect of pendingEffects.splice(0)) {
      const previous = slots[effect.index]
      if (previous?.kind === 'effect') previous.cleanup?.()
      const cleanup = effect.run()
      slots[effect.index] = {
        kind: 'effect',
        dependencies: effect.dependencies,
        cleanup: typeof cleanup === 'function' ? cleanup : undefined,
      }
    }
  }

  async function settle() {
    for (let index = 0; index < 4; index += 1) {
      render()
      flushEffects()
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    return render()
  }

  return { calls, history, render, flushEffects, settle }
}

test('settings page mounts one self-contained Fortnox card outside profile company fields', () => {
  assert.match(
    settingsPageSource,
    /import FortnoxConnectionCard from ['"]@\/components\/settings\/FortnoxConnectionCard['"]/
  )
  assert.match(
    settingsPageSource,
    /<FortnoxConnectionCard\s+externalNavigationBlocked=\{profileSavePending\}\s*\/>/
  )
  const cardIndex = settingsPageSource.indexOf('<FortnoxConnectionCard')
  assert.ok(cardIndex > settingsPageSource.indexOf("handleChange('company_orgno'"))
  assert.ok(cardIndex < settingsPageSource.indexOf('Certifieringar och medlemskap', cardIndex))
  assert.doesNotMatch(componentSource, /company_orgno/)
  assert.doesNotMatch(componentSource, /\bprofile\b/i)
  assert.match(
    settingsPageSource,
    /const profileSavePending\s*=\s*loading \|\| saving \|\| serializeProfileForm\(form\) !== savedSnapshot/
  )
})

test('pending page changes block external Fortnox navigation until autosave is complete', async () => {
  const harness = componentHarness({
    statusPayload: payload([organization()]),
    externalNavigationBlocked: true,
  })
  const tree = await harness.settle()
  const form = findElement(tree, (node) => node.type === 'form')
  const submit = findElement(form, (node) => node.type === 'button' && node.props.type === 'submit')

  assert.equal(submit.props.disabled, true)
  assert.equal(textContent(submit), 'Väntar på sparning…')
  assert.match(textContent(tree), /Vänta tills andra ändringar på sidan har sparats/)
})

test('status GET chooses the default organization and explicit selection drives the native POST contract', async () => {
  const first = organization()
  const selectedByDefault = organization({
    id: DEFAULT_ORG_ID,
    name: 'Standardbolaget AB',
    organizationNumber: '556765-4321',
    isDefault: true,
  })
  const harness = componentHarness({ statusPayload: payload([first, selectedByDefault]) })
  let tree = await harness.settle()

  assert.equal(harness.calls.length, 1)
  assert.equal(harness.calls[0].url, '/api/integrations/fortnox/status')
  assert.equal(harness.calls[0].init?.cache, 'no-store')
  assert.equal(harness.calls[0].init?.credentials, 'same-origin')
  assert.ok(harness.calls[0].init?.signal instanceof AbortSignal)

  let select = findElement(tree, (node) => node.type === 'select')
  assert.equal(select.props.value, DEFAULT_ORG_ID)
  let form = findElement(tree, (node) => node.type === 'form')
  assert.equal(form.props.method, 'post')
  assert.equal(form.props.action, '/api/integrations/fortnox/connect')
  let hidden = findElement(form, (node) => node.type === 'input' && node.props.type === 'hidden')
  assert.equal(hidden.props.name, 'orgId')
  assert.equal(hidden.props.value, DEFAULT_ORG_ID)
  const submit = findElement(form, (node) => node.type === 'button' && node.props.type === 'submit')
  assert.equal(submit.props.disabled, false)
  assert.equal('onClick' in submit.props, false)

  ;(select.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: FIRST_ORG_ID },
  })
  tree = harness.render()
  harness.flushEffects()
  tree = harness.render()
  select = findElement(tree, (node) => node.type === 'select')
  form = findElement(tree, (node) => node.type === 'form')
  hidden = findElement(form, (node) => node.type === 'input' && node.props.type === 'hidden')
  assert.equal(select.props.value, FIRST_ORG_ID)
  assert.equal(hidden.props.value, FIRST_ORG_ID)
  assert.equal(harness.calls.length, 1, 'native connect form must not be replaced by fetch')
})

test('a valid callback orgId overrides the default, is scrubbed from the URL and shows exact connected text', async () => {
  const connected = organization({
    id: FIRST_ORG_ID,
    name: 'STYR i HusHub',
    connection: {
      companyName: 'STYR Projekt Stockholm AB',
      organizationNumber: '556123-4567',
      grantedScopes: ['companyinformation', 'customer', 'invoice'],
      status: 'connected',
      connectedAt: '2026-09-09T08:00:00.000Z',
      lastVerifiedAt: '2026-09-09T09:00:00.000Z',
    },
  })
  const fallback = organization({
    id: DEFAULT_ORG_ID,
    name: 'Annat standardbolag',
    organizationNumber: '556765-4321',
    isDefault: true,
  })
  const harness = componentHarness({
    href: `https://hushub.se/settings?keep=1&fortnox=connected&orgId=${FIRST_ORG_ID}#profile`,
    statusPayload: payload([connected, fallback]),
  })
  const tree = await harness.settle()

  assert.equal(findElement(tree, (node) => node.type === 'select').props.value, FIRST_ORG_ID)
  assert.ok(textContent(tree).includes('Fortnox anslutet – STYR Projekt Stockholm AB'))
  assert.ok(textContent(tree).includes('Företagsinformation, Kundregister, Fakturor'))
  assert.ok(textContent(tree).includes('Fortnox har anslutits och verifierats.'))
  assert.equal(harness.history[0], '/settings?keep=1#profile')
  const form = findElement(tree, (node) => node.type === 'form')
  assert.equal(
    findElement(form, (node) => node.type === 'input' && node.props.name === 'orgId').props.value,
    FIRST_ORG_ID
  )
  assert.equal(textContent(findElement(form, (node) => node.type === 'button')), 'Återanslut Fortnox')
})

test('a connected callback notice is withheld unless status confirms the same organization', async () => {
  const otherConnectedOrganization = organization({
    id: DEFAULT_ORG_ID,
    name: 'Annat anslutet bolag',
    organizationNumber: '556765-4321',
    isDefault: true,
    connection: {
      companyName: 'Annat Fortnox-bolag AB',
      organizationNumber: '556765-4321',
      grantedScopes: ['companyinformation', 'customer', 'invoice'],
      status: 'connected',
      connectedAt: '2026-09-09T08:00:00.000Z',
      lastVerifiedAt: '2026-09-09T09:00:00.000Z',
    },
  })
  const harness = componentHarness({
    href: `https://hushub.se/settings?fortnox=connected&orgId=${FIRST_ORG_ID}`,
    statusPayload: payload([organization(), otherConnectedOrganization]),
  })
  const tree = await harness.settle()
  const content = textContent(tree)

  assert.equal(findElement(tree, (node) => node.type === 'select').props.value, FIRST_ORG_ID)
  assert.equal(content.includes('Fortnox har anslutits och verifierats.'), false)
  assert.ok(
    content.includes(
      'Returen från Fortnox mottogs, men anslutningen kunde inte bekräftas för organisationen.'
    )
  )
})

test('an admin can verify the current connection and refresh its visible status', async () => {
  const verifiedConnection: NonNullable<Organization['connection']> = {
    companyName: 'Verifierat Fortnox-bolag AB',
    organizationNumber: '556123-4567',
    grantedScopes: ['companyinformation', 'customer', 'invoice'],
    status: 'connected',
    connectedAt: '2026-09-09T08:00:00.000Z',
    lastVerifiedAt: '2026-09-09T10:30:00.000Z',
  }
  const harness = componentHarness({
    statusPayload: payload([
      organization({
        connection: {
          ...verifiedConnection,
          companyName: 'Tidigare namn AB',
          status: 'needs_reauthorization',
          lastVerifiedAt: '2026-09-09T09:00:00.000Z',
        },
      }),
    ]),
    verificationConnection: verifiedConnection,
  })
  let tree = await harness.settle()
  const verify = findElement(
    tree,
    (node) => node.type === 'button' && textContent(node) === 'Kontrollera anslutning'
  )

  assert.equal(verify.props.type, 'button')
  assert.equal(verify.props.disabled, false)
  ;(verify.props.onClick as () => void)()
  await new Promise<void>((resolve) => setImmediate(resolve))
  tree = await harness.settle()

  assert.equal(harness.calls.length, 2)
  assert.equal(harness.calls[1].url, '/api/integrations/fortnox/verify')
  assert.equal(harness.calls[1].init?.method, 'POST')
  assert.equal(harness.calls[1].init?.credentials, 'same-origin')
  assert.deepEqual(harness.calls[1].init?.headers, { 'Content-Type': 'application/json' })
  assert.deepEqual(JSON.parse(String(harness.calls[1].init?.body)), { orgId: FIRST_ORG_ID })
  assert.ok(textContent(tree).includes('Fortnox anslutet – Verifierat Fortnox-bolag AB'))
  assert.ok(textContent(tree).includes('Fortnox-anslutningen har verifierats.'))
})

test('callback failure categories show distinct allowlisted Swedish guidance', async () => {
  const cases = [
    ['login_required', 'Du behöver logga in i HusHub igen'],
    ['hushub_access_denied', 'administratörsbehörighet för organisationen i HusHub'],
    ['fortnox_access_denied', 'Fortnox nekade auktoriseringen'],
    ['permission_or_license_missing', 'nödvändig behörighet eller licens i Fortnox'],
    ['scope_missing', 'behörigheter som behövs för företagsinformation, kunder och fakturor'],
    ['state_invalid', 'ogiltigt, har gått ut eller har redan använts'],
    ['callback_invalid', 'Returen från Fortnox är ogiltig'],
    ['superseded', 'ersattes av ett nyare'],
  ] as const

  for (const [status, expectedText] of cases) {
    const harness = componentHarness({
      href: `https://hushub.se/settings?fortnox=${status}&orgId=${FIRST_ORG_ID}`,
      statusPayload: payload([organization()]),
    })
    const tree = await harness.settle()
    assert.ok(textContent(tree).includes(expectedText), status)
    assert.equal(harness.history[0], '/settings')
  }
})

test('organization number is saved through its own PATCH and never through the connect form', async () => {
  const harness = componentHarness({
    statusPayload: payload([organization({ organizationNumber: null })]),
    patchOrganizationNumber: '556777-8880',
  })
  let tree = await harness.settle()
  let input = findElement(
    tree,
    (node) => node.type === 'input' && node.props.id === 'fortnox-organization-number'
  )
  ;(input.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: '5567778880' },
  })
  tree = harness.render()
  const save = findElement(
    tree,
    (node) => node.type === 'button' && textContent(node) === 'Spara org.nr'
  )
  assert.equal(save.props.type, 'button')
  assert.equal(save.props.disabled, false)
  ;(save.props.onClick as () => void)()
  await new Promise<void>((resolve) => setImmediate(resolve))
  tree = await harness.settle()

  assert.equal(harness.calls.length, 2)
  assert.equal(harness.calls[1].url, '/api/integrations/fortnox/organization-number')
  assert.equal(harness.calls[1].init?.method, 'PATCH')
  assert.equal(harness.calls[1].init?.credentials, 'same-origin')
  assert.deepEqual(harness.calls[1].init?.headers, { 'Content-Type': 'application/json' })
  assert.deepEqual(JSON.parse(String(harness.calls[1].init?.body)), {
    orgId: FIRST_ORG_ID,
    organizationNumber: '556777-8880',
  })
  assert.equal(harness.calls.some((call) => call.init?.method === 'POST'), false)
  input = findElement(
    tree,
    (node) => node.type === 'input' && node.props.id === 'fortnox-organization-number'
  )
  assert.equal(input.props.value, '556777-8880')
  assert.ok(textContent(tree).includes('Organisationens organisationsnummer har sparats.'))
})

test('non-admins have copyable read-only status and no connect or organization-number mutation controls', async () => {
  const harness = componentHarness({
    statusPayload: payload([
      organization({
        canManage: false,
        connection: {
          companyName: 'Läsbart Fortnox-bolag AB',
          organizationNumber: '556123-4567',
          grantedScopes: ['companyinformation', 'customer', 'invoice'],
          status: 'connected',
          connectedAt: '2026-09-09T08:00:00.000Z',
          lastVerifiedAt: '2026-09-09T09:00:00.000Z',
        },
      }),
    ]),
  })
  const tree = await harness.settle()
  const input = findElement(
    tree,
    (node) => node.type === 'input' && node.props.id === 'fortnox-organization-number'
  )
  assert.equal(input.props.disabled, false)
  assert.equal(input.props.readOnly, true)
  assert.equal(findElements(tree, (node) => node.type === 'form').length, 0)
  assert.equal(
    findElements(tree, (node) => node.type === 'button' && textContent(node) === 'Spara org.nr').length,
    0
  )
  assert.equal(
    findElements(
      tree,
      (node) => node.type === 'button' && textContent(node) === 'Kontrollera anslutning'
    ).length,
    0
  )
  assert.ok(
    textContent(tree).includes(
      'Du kan se statusen, men endast en organisationsadministratör kan ändra anslutningen.'
    )
  )
})

test('admin connect stays disabled until configuration and the canonical saved org number are ready', async () => {
  const missingNumber = componentHarness({
    statusPayload: payload([organization({ organizationNumber: null })]),
  })
  const missingTree = await missingNumber.settle()
  const missingSubmit = findElement(
    missingTree,
    (node) => node.type === 'button' && node.props.type === 'submit'
  )
  assert.equal(missingSubmit.props.disabled, true)
  assert.ok(textContent(missingTree).includes('Spara organisationens organisationsnummer innan du ansluter Fortnox.'))

  const unconfigured = componentHarness({
    statusPayload: payload([organization()], false),
  })
  const unconfiguredTree = await unconfigured.settle()
  assert.equal(
    findElement(unconfiguredTree, (node) => node.type === 'button' && node.props.type === 'submit').props.disabled,
    true
  )
  assert.ok(textContent(unconfiguredTree).includes('Serverns Fortnox-konfiguration saknas.'))

  const dirty = componentHarness({ statusPayload: payload([organization()]) })
  let dirtyTree = await dirty.settle()
  const orgNumberInput = findElement(
    dirtyTree,
    (node) => node.type === 'input' && node.props.id === 'fortnox-organization-number'
  )
  ;(orgNumberInput.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: '5569990000' },
  })
  dirtyTree = dirty.render()
  assert.equal(
    findElement(dirtyTree, (node) => node.type === 'button' && node.props.type === 'submit').props.disabled,
    true
  )
  assert.ok(textContent(dirtyTree).includes('Spara organisationsnumret innan du fortsätter till Fortnox.'))

  ;(orgNumberInput.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: '' },
  })
  dirtyTree = dirty.render()
  const emptyInput = findElement(
    dirtyTree,
    (node) => node.type === 'input' && node.props.id === 'fortnox-organization-number'
  )
  assert.equal(emptyInput.props['aria-invalid'], true)
  assert.ok(
    textContent(dirtyTree).includes(
      'Ange ett giltigt organisationsnummer i formatet XXXXXX-XXXX.'
    )
  )
})
