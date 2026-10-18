import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

type Node = { type: unknown; props: Record<string, any> }
function harness(result: Response | Error) {
  const hooks: any[] = [], events: string[] = [], feedback: any[] = []
  let cursor = 0, requests = 0
  const jsx = (type: unknown, props: Node['props']) => ({ type, props })
  const deps: Record<string, unknown> = {
    react: {
      useId: () => 'confirmation', useEffect: () => {},
      useRef: (initial: unknown) => hooks[cursor++] ??= { current: initial },
      useState: (initial: unknown) => {
        const index = cursor++
        if (!(index in hooks)) hooks[index] = initial
        return [hooks[index], (value: unknown) => { hooks[index] = value }]
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': {},
    '@/components/ui/AppToastProvider': { useToast: () => ({ show: (message: unknown, options: unknown) => {
      events.push('toast'); feedback.push({ message: message instanceof Error ? message.message : message, options })
    } }) },
    '@/lib/tu/assignmentProgress': {
      canTuAssignmentAction: (_: unknown, action: string) => action === 'send',
      tuSendLabel: () => 'Send', TU_ACTION_LABELS: {},
    },
  }
  const code = ts.transpileModule(readFileSync('src/components/tu/TuAssignmentActions.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} as { default: (props: unknown) => Node } }
  new Function('require', 'module', 'exports', 'fetch', 'window', code)(
    (name: string) => { assert.ok(name in deps, name); return deps[name] }, loaded, loaded.exports,
    async () => { requests++; if (result instanceof Error) throw result; return result },
    { dispatchEvent: () => true },
  )
  function nodes(value: any): Node[] {
    if (Array.isArray(value)) return value.flatMap(nodes)
    if (!value || typeof value !== 'object' || !value.props) return []
    return [value, ...nodes(value.props.children)]
  }
  function render() {
    cursor = 0
    const tree = nodes(loaded.exports.default({
      assignment: { id: 'test', org_id: 'org', status: 'draft', updated_at: 'version', customer_email: 'customer@example.test' },
      onChanged: async () => { events.push('refresh') }, onNavigate: () => { events.push('navigate') },
    }))
    const dialog = tree.find(node => node.type === 'dialog')!
    dialog.props.ref.current = { showModal: () => {}, close: () => { events.push('close') } }
    return tree
  }
  async function send() {
    render().find(node => node.type === 'button')!.props.onClick()
    const confirm = render().filter(node => node.type === 'button').at(-1)!
    confirm.props.onClick()
    // The UI handler intentionally returns void; settle its asynchronous request.
    await new Promise(resolve => setImmediate(resolve))
  }
  return { send, events, feedback, requests: () => requests }
}

test('action failure closes the dialog before a dark readable toast and refreshes status once', async () => {
  const message = 'Bekräftelsen kunde inte skickas. Kontrollera företagets visitkort.'
  const view = harness(Response.json({ error: message }, { status: 409 }))
  await view.send()
  assert.deepEqual(view.events, ['close', 'toast', 'refresh'])
  assert.deepEqual(view.feedback, [{ message, options: { tone: 'error', appearance: 'dark', durationMs: 12000 } }])
  assert.equal(view.requests(), 1)
})

test('unknown network outcome and malformed response never display success or resend automatically', async () => {
  for (const response of [new Error('private diagnostic'), new Response('<html>Gateway timeout</html>', { status: 502 }), Response.json({})]) {
    const view = harness(response)
    await view.send()
    assert.equal(view.feedback.length, 1)
    assert.equal(view.feedback[0].options.tone, 'error')
    assert.match(view.feedback[0].message, /kontrollera utskicken/)
    assert.doesNotMatch(view.feedback[0].message, /private|Gateway|html/)
    assert.equal(view.requests(), 1)
    assert.deepEqual(view.events, ['close', 'toast', 'refresh'])
  }
})

test('successful and partially successful actions retain their distinct feedback', async () => {
  for (const warning of [false, true]) {
    const view = harness(Response.json({ message: 'Resultat', warning }))
    await view.send()
    assert.equal(view.feedback[0].options.tone, warning ? 'warning' : 'success')
    assert.equal(view.feedback[0].options.durationMs, warning ? 12000 : 4000)
    assert.deepEqual(view.events, ['close', 'toast', 'refresh'])
  }
})
