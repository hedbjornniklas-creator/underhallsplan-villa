import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type { OrganizationCustomerWorkspace } from '../src/lib/customers/domain'
import type {
  AssignmentCustomerBinding,
  AssignmentCustomerDraft,
} from '../src/components/customers/AssignmentCustomerSelector'

const selectorPath = 'src/components/customers/AssignmentCustomerSelector.tsx'
const dashboardPath = 'src/components/tu/TuDashboardClient.tsx'
const selectorSource = readFileSync(new URL(`../${selectorPath}`, import.meta.url), 'utf8')
const dashboardSource = readFileSync(new URL(`../${dashboardPath}`, import.meta.url), 'utf8')
const selectorCode = ts.transpileModule(selectorSource, {
  fileName: selectorPath,
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText

type ElementNode = {
  type: string | symbol | ((props: Record<string, unknown>) => unknown)
  props: Record<string, unknown>
  key: string | null
}

function isElement(value: unknown): value is ElementNode {
  return Boolean(value && typeof value === 'object' && 'type' in value && 'props' in value)
}

function children(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(children)
  if (value === null || value === undefined || typeof value === 'boolean') return []
  return [value]
}

function visit(value: unknown, callback: (node: ElementNode) => void): void {
  for (const child of children(value)) {
    if (!isElement(child)) continue
    if (typeof child.type === 'function') {
      visit(child.type(child.props), callback)
      continue
    }
    callback(child)
    visit(child.props.children, callback)
  }
}

function findAll(value: unknown, predicate: (node: ElementNode) => boolean) {
  const matches: ElementNode[] = []
  visit(value, (node) => {
    if (predicate(node)) matches.push(node)
  })
  return matches
}

function textContent(value: unknown): string {
  return children(value)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child)
      return isElement(child) ? textContent(child.props.children) : ''
    })
    .join('')
}

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'

function workspace(canManage = true): OrganizationCustomerWorkspace {
  return {
    organization: {
      id: ORGANIZATION_ID,
      name: 'Pilotorganisationen',
      isDefault: true,
      canManage,
    },
    organizations: [],
    customers: [
      {
        id: CUSTOMER_ID,
        customerNumber: '1001',
        customerType: 'private',
        name: 'Befintlig Kund',
        identityNumber: null,
        email: 'samma@example.test',
        phone: '0700000000',
        address: 'Kundgatan 1',
        addressLine2: null,
        postalCode: '111 11',
        city: 'Stockholm',
        countryCode: 'SE',
        invoiceSameAsCustomer: true,
        invoiceName: null,
        invoiceEmail: null,
        invoiceAddress: null,
        invoiceAddressLine2: null,
        invoicePostalCode: null,
        invoiceCity: null,
        invoiceCountryCode: null,
        invoiceReference: null,
        fortnoxCustomerNumber: null,
        isActive: true,
        version: 4,
        createdAt: '2026-09-11T08:00:00.000Z',
        updatedAt: '2026-09-11T08:00:00.000Z',
      },
    ],
  }
}

const DRAFT: AssignmentCustomerDraft = {
  customerType: 'consumer',
  identityNumber: '',
  name: 'Ny Kund',
  email: 'samma@example.test',
  phone: '0711111111',
  address: 'Nygatan 2',
  postalCode: '222 22',
  city: 'Uppsala',
  invoiceEmail: '',
}

function selectorHarness(input: {
  workspace: OrganizationCustomerWorkspace
  draft?: AssignmentCustomerDraft
  value?: AssignmentCustomerBinding | null
}) {
  type StateSlot = { kind: 'state'; value: unknown }
  type EffectSlot = {
    kind: 'effect'
    dependencies: readonly unknown[] | undefined
    cleanup?: () => void
  }
  type Slot = StateSlot | EffectSlot
  type PendingEffect = {
    index: number
    dependencies: readonly unknown[] | undefined
    run: () => void | (() => void)
  }

  const slots: Array<Slot | undefined> = []
  const effects: PendingEffect[] = []
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
  const changes: Array<AssignmentCustomerBinding | null> = []
  const usedCustomers: unknown[] = []
  let cursor = 0

  function useState<T>(initial: T | (() => T)): [T, (next: T | ((value: T) => T)) => void] {
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
        ? (next as (value: T) => T)(state.value as T)
        : next
    }]
  }

  function useMemo<T>(factory: () => T) {
    cursor++
    return factory()
  }

  function useEffect(run: PendingEffect['run'], dependencies?: readonly unknown[]) {
    const index = cursor++
    const previous = slots[index]
    const unchanged =
      previous?.kind === 'effect' &&
      previous.dependencies?.length === dependencies?.length &&
      previous.dependencies?.every((item, dependencyIndex) =>
        Object.is(item, dependencies?.[dependencyIndex])
      )
    if (!unchanged) effects.push({ index, dependencies, run })
  }

  const Fragment = Symbol('Fragment')
  const jsx = (type: ElementNode['type'], props: Record<string, unknown>, key?: string) => ({
    type,
    props,
    key: key ?? null,
  }) satisfies ElementNode

  const fetchMock = async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init })
    return Response.json({ workspace: input.workspace })
  }
  const compiled = { exports: {} as { default: (props: Record<string, unknown>) => unknown } }
  new Function('require', 'module', 'exports', 'fetch', selectorCode)(
    (name: string) => {
      if (name === 'react') return { useEffect, useMemo, useState }
      if (name === 'react/jsx-runtime') return { Fragment, jsx, jsxs: jsx }
      throw new Error(`Unexpected selector dependency: ${name}`)
    },
    compiled,
    compiled.exports,
    fetchMock
  )

  function render() {
    cursor = 0
    return compiled.exports.default({
      organizationId: ORGANIZATION_ID,
      value: input.value ?? null,
      draft: input.draft ?? DRAFT,
      disabled: false,
      onChange: (value: AssignmentCustomerBinding | null) => changes.push(value),
      onUseCustomer: (customer: unknown) => usedCustomers.push(customer),
    })
  }

  async function settle() {
    let tree = render()
    for (let index = 0; index < 3; index += 1) {
      for (const effect of effects.splice(0)) {
        const previous = slots[effect.index]
        if (previous?.kind === 'effect') previous.cleanup?.()
        const cleanup = effect.run()
        slots[effect.index] = {
          kind: 'effect',
          dependencies: effect.dependencies,
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        }
      }
      await new Promise<void>((resolve) => setImmediate(resolve))
      tree = render()
    }
    return tree
  }

  return { changes, fetchCalls, settle, usedCustomers }
}

test('customer selector loads the current organization and never silently matches an email', async () => {
  const harness = selectorHarness({ workspace: workspace() })
  const tree = await harness.settle()

  assert.equal(harness.fetchCalls.length, 1)
  assert.equal(
    harness.fetchCalls[0].url,
    `/api/settings/customers?orgId=${ORGANIZATION_ID}`
  )
  assert.equal(harness.fetchCalls[0].init?.cache, 'no-store')
  assert.equal(harness.fetchCalls[0].init?.credentials, 'same-origin')
  assert.ok(harness.fetchCalls[0].init?.signal instanceof AbortSignal)
  assert.deepEqual(harness.changes, [], 'matching draft email must not select a customer')
  assert.match(textContent(tree), /Ingen kund väljs automatiskt utifrån namn eller e-post/)
})

test('an explicit existing-customer choice returns id/version and asks the parent to fill fields', async () => {
  const expectedWorkspace = workspace()
  const harness = selectorHarness({ workspace: expectedWorkspace })
  const tree = await harness.settle()
  const select = findAll(tree, (node) => node.type === 'select')[0]
  assert.ok(select)

  ;(select.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: CUSTOMER_ID },
  })

  assert.deepEqual(harness.usedCustomers, [expectedWorkspace.customers[0]])
  assert.deepEqual(harness.changes, [
    { mode: 'existing', customerId: CUSTOMER_ID, customerVersion: 4 },
  ])
})

test('creating a customer is an explicit action with the assignment identity in the contract', async () => {
  const businessDraft: AssignmentCustomerDraft = {
    ...DRAFT,
    customerType: 'business',
    identityNumber: '556123-4567',
  }
  const harness = selectorHarness({ workspace: workspace(), draft: businessDraft })
  const tree = await harness.settle()
  const create = findAll(
    tree,
    (node) => node.type === 'button' && textContent(node) === 'Skapa ny kund'
  )[0]
  assert.ok(create)

  ;(create.props.onClick as () => void)()

  assert.deepEqual(harness.changes, [
    {
      mode: 'create',
      customerType: 'business',
      identityNumber: '556123-4567',
    },
  ])
})

test('an active TU user can choose or create even when the manual registry is read-only', async () => {
  const harness = selectorHarness({ workspace: workspace(false) })
  const tree = await harness.settle()

  assert.equal(findAll(tree, (node) => node.type === 'select').length, 1)
  assert.equal(
    findAll(
      tree,
      (node) => node.type === 'button' && textContent(node) === 'Skapa ny kund'
    ).length,
    1
  )
  assert.doesNotMatch(textContent(tree), /organisationsadministratör/i)
})

test('TU submit payload carries the explicit binding and customer edits invalidate a prior choice', () => {
  assert.match(dashboardSource, /customerBinding:\s*customerBinding\.mode === ['"]create['"]/)
  assert.match(dashboardSource, /identityNumber:\s*normalizedIdentity/)
  assert.match(dashboardSource, /CUSTOMER_BINDING_FORM_KEYS\.has\(key\)/)
  assert.match(dashboardSource, /setCustomerBinding\(null\)/)
  assert.match(dashboardSource, /form\.customerType === ['"]business['"] && !normalizedIdentity/)
  assert.match(dashboardSource, /payload\.deliveryFailed === true/)
  assert.match(dashboardSource, /Försök igen från det sparade uppdraget/)
  assert.doesNotMatch(dashboardSource, /find\([^\n]*customerEmail/)
})
