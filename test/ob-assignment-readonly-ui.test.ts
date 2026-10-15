import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
// @ts-expect-error Node strip-types requires the explicit extension.
import { canEditObAssignment } from '../src/lib/ob/assignmentEditLock.ts'

type Node = { type: unknown; props: Record<string, unknown> }
type Slot = { value?: unknown; dependencies?: unknown[]; cleanup?: () => void }
const source = readFileSync('src/app/(dashboard)/ob/assignments/[id]/page.tsx', 'utf8')
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText + '\nexports.TestContent = AssignmentDetailsContent;'

function harness(status: string, canEdit: boolean | undefined) {
  const slots: Slot[] = [], effects: Array<() => void> = [], calls: Array<{ url: string; method: string }> = []
  const timers = new Map<number, () => void>()
  let timerSequence = 0
  let cursor = 0
  const equal = (a: unknown[] | undefined, b: unknown[] | undefined) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++
      const slot = slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slot.value, (value: unknown) => { slot.value = typeof value === 'function' ? value(slot.value) : value }]
    },
    useRef(initial: unknown) {
      const slot = slots[cursor++] ??= { value: { current: initial } }
      return slot.value
    },
    useMemo(factory: () => unknown, dependencies: unknown[]) {
      const index = cursor++
      if (!slots[index] || !equal(slots[index].dependencies, dependencies)) slots[index] = { value: factory(), dependencies }
      return slots[index].value
    },
    useCallback(callback: unknown, dependencies: unknown[]) {
      return hooks.useMemo(() => callback, dependencies)
    },
    useEffect(run: () => void | (() => void), dependencies: unknown[]) {
      const index = cursor++
      if (!slots[index] || !equal(slots[index].dependencies, dependencies)) effects.push(() => {
        slots[index]?.cleanup?.()
        const cleanup = run()
        slots[index] = { dependencies, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
      })
    },
    useId: () => 'field-id',
  }
  let row = { id: 'assignment', canEdit, status, assignment_type: 'OB', assignment_details: {},
    customer_name: 'Colleague customer', customer_email: 'customer@example.test', currency: 'SEK', price_amount: 2500,
    last_sent_at: status === 'draft' ? null : '2026-10-01', inspection_id: 'inspection', property_id: 'property', orderer_role: 'buyer',
    archived_at: null, accepted_at: null, booked_at: null }
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props })
  const dependencies: Record<string, unknown> = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'next/navigation': { useParams: () => ({ id: 'assignment' }), useRouter: () => ({ push: () => {} }) },
    '@/components/ob/ObOrganizationBoundary': { default: 'boundary', useObOrganization: () => ({ id: 'org' }),
      useObOrganizationSwitchGuard: () => {}, withObOrganization: (url: string) => `${url}?orgId=org` },
    '@/lib/ob/inspectionProfile': { resolveObInspectionProfile: () => 'buyer', obInspectionProfileLabel: () => 'Köpare' },
    '@/lib/ob/objectType': { parseObObjectType: () => 'property', resolveObObjectType: () => 'property' },
    '@/lib/ob/assignmentEditLock': { canEditObAssignment },
  }
  const compiled = { exports: {} as { TestContent: () => Node } }
  new Function('require', 'module', 'exports', 'fetch', 'setTimeout', 'clearTimeout', code)((name: string) => dependencies[name] ?? {}, compiled, compiled.exports,
    async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' })
      if (canEdit !== true) assert.equal(init?.method ?? 'GET', 'GET', 'read-only loading may not autosave or invoke actions')
      if (init?.method === 'PATCH') row = { ...row, ...JSON.parse(String(init.body)), canEdit: true }
      return Response.json({ assignment: row, addonOrders: [] })
    }, (run: () => void) => { const id = ++timerSequence; timers.set(id, run); return id }, (id: number) => timers.delete(id))
  return { calls, async autosave() {
    assert.equal(timers.size, 1, 'an owner field change schedules exactly one save')
    const pending = [...timers.values()]
    timers.clear()
    pending.forEach(run => run())
    await new Promise<void>(resolve => setImmediate(resolve))
  }, async render() {
    let tree: Node
    for (let attempt = 0; attempt < 3; attempt++) {
      cursor = 0
      tree = compiled.exports.TestContent()
      effects.splice(0).forEach(run => run())
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    return tree!
  } }
}

function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object' || !('props' in value)) return []
  const node = value as Node
  return [node, ...nodes(node.props.children)]
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(' ')
  if (value && typeof value === 'object' && 'props' in value) return text((value as Node).props.children)
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

test('colleague assignments render only read actions across workflow states and never autosave', async () => {
  for (const status of ['draft', 'sent', 'ordered', 'booked', 'completed', 'expired', 'cancelled']) {
    for (const canEdit of [false, undefined]) {
      const h = harness(status, canEdit)
      const tree = await h.render(), all = nodes(tree)
      assert.match(text(tree), /Endast läsning/)
      assert.match(text(tree), /Colleague customer/)
      assert.equal(all.some(node => ['input', 'textarea', 'select'].includes(String(node.type))), false)
      assert.deepEqual(all.filter(node => node.type === 'button').map(node => text(node.props.children)), ['Tillbaka till ÖB'])
      const links = all.filter(node => node.type === 'a').map(node => node.props.href)
      assert.deepEqual(links, [...(status === 'draft' ? [] : ['/api/ob/assignments/assignment/pdf?orgId=org']), '/utlatande/property/inspection?orgId=org'])
      assert.deepEqual(h.calls, [{ url: '/api/ob/assignments/assignment?orgId=org', method: 'GET' }])
    }
  }
})

test('an owner draft stays editable after autosave replaces the assignment row', async () => {
  const h = harness('draft', true)
  const initial = await h.render()
  const field = nodes(initial).find(node => node.props.label === 'Adress')!
  assert.ok(field)
  ;(field.props.onChange as (value: string) => void)('Saved owner address')
  await h.render()
  await h.autosave()
  const saved = await h.render()
  assert.doesNotMatch(text(saved), /Kollegans ÖB-uppdrag/)
  const data = nodes(saved).find(node => node.type === 'fieldset' && node.props['aria-label'] === 'Uppdragsdata')!
  assert.equal(data.props.disabled, false)
  assert.equal(nodes(saved).find(node => node.props.label === 'Adress')?.props.value, 'Saved owner address')
  assert.deepEqual(h.calls.map(call => call.method), ['GET', 'PATCH'])
})
