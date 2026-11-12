import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as overview from '../src/lib/action-cases/projectOverview.ts'
import { money } from '../src/lib/action-cases/customerOffers.ts'
import { scheduleStatuses } from '../src/lib/action-cases/projectSchedule.ts'

const code = ts.transpileModule(readFileSync(new URL('../src/components/tasks/ProjectOverview.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText

test('source editors invalidate the overview without changing their own refresh key or mounting', () => {
  const source = readFileSync(new URL('../src/components/tasks/ActionCaseProject.tsx', import.meta.url), 'utf8')
  assert.match(source, /refreshKey=\{questionsRefresh \+ overviewRefresh\}/)
  assert.match(source, /onWorkspaceChanged=\{overviewChanged\}/)
  assert.match(source, /onShared=\{receiveSchedule\}/)
  assert.match(source, /if \(scheduleLoaded.current\) overviewChanged\(\)/)
  assert.match(source, /<ProjectQuestions[^>]*refreshKey=\{questionsRefresh\}/)
  assert.match(source, /scheduleDirty=\{scheduleDirty\}/)
})

function harness() {
  const hooks = [], effects = [], requests = []
  let cursor = 0, now = 100_000
  let props = { project: { id: 'one', items: [], attachments: [] }, offer: null, active: true, refreshKey: 0 }
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [hooks[index].value, value => { hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value }]
    },
    useRef(value) { const index = cursor++; return hooks[index] ??= { current: value } },
    useEffect(effect, deps) {
      const index = cursor++, previous = hooks[index]
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects.push(() => {
        previous?.cleanup?.()
        hooks[index] = { deps, cleanup: effect() }
      })
    },
  }
  const jsx = (type, props) => ({ type, props })
  const deps = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': {},
    '@/lib/action-cases/customerOffers': { money },
    '@/lib/action-cases/projectOverview': overview,
    '@/lib/action-cases/projectSchedule': { scheduleStatuses },
    './ProjectManagerField': () => null, './ProjectCompletion': () => null, './project-overview.css': {},
  }
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', 'fetch', 'Date', 'window', code)(name => {
    assert.ok(name in deps, name); return deps[name]
  }, mod, mod.exports, (url, options) => new Promise(resolve => {
    requests.push({ url, options, finish(status = 200) {
      resolve({ ok: status === 200, json: async () => url.endsWith('/questions')
        ? { questions: [], assignees: [], userId: 'me', managerId: null }
        : { rows: [], available: true } })
    } })
  }), class extends Date { static now() { return now } }, { setInterval: () => 1, clearInterval() {} })
  return {
    requests,
    render(patch = {}) {
      props = { ...props, ...patch }; cursor = 0
      const tree = mod.exports.default(props)
      while (effects.length) effects.shift()()
      return tree
    },
    resources: () => hooks.filter(hook => hook.value && typeof hook.value === 'object' && 'loading' in hook.value).map(hook => hook.value),
    advance: ms => { now += ms },
    async finish(status = 200, start = 0) { requests.slice(start).forEach(request => request.finish(status)); await new Promise(resolve => setImmediate(resolve)) },
  }
}

test('rapid overview revisits keep loaded data and do not repeat either request', async () => {
  const h = harness(); h.render()
  assert.equal(h.requests.length, 2)
  await h.finish()
  h.render({ active: false }); h.render({ active: true })
  assert.equal(h.requests.length, 2)
  assert.ok(h.resources().every(resource => resource.data && !resource.loading))
  assert.ok(h.requests.every(request => request.options.cache === 'no-store'))
})

test('an expired overview refreshes in the background, then clears data on access/read failure', async () => {
  const h = harness(); h.render(); await h.finish()
  h.render({ active: false }); h.advance(30_001); h.render({ active: true })
  assert.equal(h.requests.length, 4)
  assert.ok(h.resources().every(resource => resource.data && !resource.loading), 'no blank loading screen during revalidation')
  await h.finish(403, 2)
  assert.ok(h.resources().every(resource => resource.data === null && resource.error))
  h.render({ active: false }); h.render({ active: true })
  assert.equal(h.requests.length, 6, 'a failed refresh is never marked fresh')
  await h.finish(200, 4)
  assert.ok(h.resources().every(resource => resource.data && !resource.error))
})

test('permission/refresh changes invalidate immediately and late aborted results cannot refill the overview', async () => {
  const h = harness(); h.render(); await h.finish()
  h.render({ refreshKey: 1 })
  assert.equal(h.requests.length, 4)
  assert.ok(h.resources().every(resource => resource.data === null && resource.loading))
  h.render({ active: false })
  assert.ok(h.requests.slice(2).every(request => request.options.signal.aborted))
  await h.finish(200, 2)
  assert.ok(h.resources().every(resource => resource.data === null))
  h.render({ active: true })
  assert.equal(h.requests.length, 6)
  await h.finish(200, 4)
  assert.ok(h.resources().every(resource => resource.data))
})

test('a different project never reuses the previous project overview', async () => {
  const h = harness(); h.render(); await h.finish()
  h.render({ project: { id: 'two', items: [], attachments: [] } })
  assert.equal(h.requests.length, 4)
  assert.ok(h.requests.slice(2).every(request => request.url.includes('/two/')))
  assert.ok(h.resources().every(resource => resource.data === null && resource.loading))
  await h.finish(200, 2)
})

test('manual refresh bypasses freshness and never reuses a previously successful result after failure', async () => {
  const h = harness(); h.render(); await h.finish()
  const find = node => {
    if (!node || typeof node !== 'object') return null
    if (node.props?.['aria-label'] === 'Uppdatera översikten') return node
    for (const child of [node.props?.children].flat()) { const found = find(child); if (found) return found }
    return null
  }
  find(h.render()).props.onClick()
  h.render()
  assert.equal(h.requests.length, 4)
  assert.ok(h.resources().every(resource => resource.data === null && resource.loading))
  await h.finish(500, 2)
  h.render({ active: false }); h.render({ active: true })
  assert.equal(h.requests.length, 6)
  await h.finish(200, 4)
})

test('question and schedule edits invalidate the overview, including saves completed in another tab', async () => {
  for (const key of ['questionsDirty', 'scheduleDirty']) {
    const h = harness(); h.render(); await h.finish()
    h.render({ active: false, [key]: true })
    h.render({ active: true })
    assert.equal(h.requests.length, 2, 'do not reload while a local write is still pending')
    h.render({ [key]: false })
    assert.equal(h.requests.length, 4, 'read the saved state even inside the freshness interval')
    await h.finish(200, 2)
    h.render({ active: false, [key]: true }); h.render({ [key]: false }); h.render({ active: true })
    assert.equal(h.requests.length, 6, 'a completed background save cannot restore the earlier freshness marker')
    await h.finish(200, 4)
  }
})
