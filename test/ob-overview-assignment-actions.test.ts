import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type { ObOverviewItem } from '../src/lib/ob/overview'

type Node = { type: unknown; props: Record<string, unknown> }
type Props = { assignment: NonNullable<ObOverviewItem['assignment']>; orgId: string; address: string; onChanged: () => Promise<void> }
function harness() {
  const hooks: unknown[] = [], writes: { url: string; body: unknown }[] = [], warnings: string[] = []
  let cursor = 0, refreshed = 0, closed = 0
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props })
  const deps: Record<string, unknown> = {
    react: {
      useId: () => 'dialog-title',
      useState(initial: unknown) {
        const index = cursor++
        hooks[index] ??= initial
        return [hooks[index], (value: unknown) => { hooks[index] = value }]
      },
      useRef(initial: unknown) { return hooks[cursor++] ??= { current: initial } },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': {},
    '@/components/ui/AppToastProvider': { useToast: () => ({ warning: (message: string) => warnings.push(message), success: () => {}, error: () => {} }) },
    './ObOrganizationBoundary': { useObOrganizationSwitchGuard: () => {}, withObOrganization: (path: string, org: string) => `${path}?orgId=${org}` },
  }
  const compiled = ts.transpileModule(readFileSync('src/components/ob/ObOverviewAssignmentActions.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} as { default: (props: Props) => Node } }
  new Function('require', 'module', 'exports', 'fetch', compiled)(
    (name: string) => { assert.ok(name in deps, name); return deps[name] }, loaded, loaded.exports,
    async (url: string, options: { body: string }) => {
      writes.push({ url, body: JSON.parse(options.body) })
      return { ok: true, json: async () => ({}) }
    },
  )
  function render(assignment: Props['assignment'], orgId = 'org-a') {
    cursor = 0
    const root = loaded.exports.default({ assignment, orgId, address: 'Testgatan 1', onChanged: async () => { refreshed++ } })
    const children = root.props.children as Node[]
    const dialog = children[2]
    ;(dialog.props.ref as { current: unknown }).current = { showModal: () => {}, close: () => { closed++ } }
    const buttons = (dialog.props.children as Node[]).at(-1)!.props.children as Node[]
    return { open: children[0].props.onClick as () => void, confirm: buttons[1].props.onClick as () => void }
  }
  return { render, writes, warnings, refreshed: () => refreshed, closed: () => closed }
}

test('an unchanged confirmed target writes only its archive field and refreshes', async () => {
  const view = harness()
  const row = { id: 'original', status: 'draft', archived: false }
  view.render(row).open()
  view.render(row).confirm()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(view.writes.length, 1)
  assert.equal(view.writes[0].url, '/api/ob/assignments/original?orgId=org-a')
  assert.deepEqual(Object.keys(view.writes[0].body as object), ['archived_at'])
  assert.equal(view.refreshed(), 1)
})

test('background changes cannot silently retarget an open confirmation dialog', () => {
  const original = { id: 'original', status: 'draft', archived: false }
  for (const change of [{ row: { ...original, id: 'replacement' }, org: 'org-a' },
    { row: { ...original, status: 'booked' }, org: 'org-a' },
    { row: { ...original, archived: true }, org: 'org-a' },
    { row: original, org: 'org-b' }]) {
    const view = harness()
    view.render(original).open()
    view.render(change.row, change.org).confirm()
    assert.deepEqual(view.writes, [])
    assert.equal(view.refreshed(), 0)
    assert.equal(view.closed(), 1)
    assert.match(view.warnings[0], /har ändrats/)
  }
})
