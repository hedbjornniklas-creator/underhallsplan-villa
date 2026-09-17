import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/app/renoapp/brf/[slug]/apply/page.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function expression(name: string) {
  let result = ''
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) result = node.initializer!.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(result, `Missing ${name}`)
  return result
}
function run(code: string, context: Record<string, unknown>) {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(context), js)(...Object.values(context))
}

test('only this tab\'s confirmed open draft is editable without a second fetch', () => {
  const code = `const isLocallyCreatedDraft = ${expression('isLocallyCreatedDraft')}; return ${expression('isReadOnlyCase')}`
  const base = { slug: 'test', activeDraftToken: 'token', draftInfo: null }
  const local = { slug: 'test', token: 'token', status: 'draft' }
  assert.equal(run(code, { ...base, createdDraft: local }), false)
  for (const createdDraft of [null, { ...local, status: 'submitted' }, { ...local, slug: 'other' }, { ...local, token: 'other' }]) {
    assert.equal(run(code, { ...base, createdDraft }), true)
  }
  for (const state of ['expired', 'revoked']) {
    assert.equal(run(code, { ...base, createdDraft: local, draftInfo: { state, case: { status: 'draft' } } }), true)
  }
  assert.equal(run(code, { ...base, createdDraft: null, draftInfo: { state: 'open', case: { status: 'need_info' } } }), false)
})

test('first confirmed draft save updates URL without router navigation or losing other URL parts', () => {
  const start = source.indexOf('      const nextDraftToken =')
  const end = source.indexOf("      if (mode === 'submit')", start)
  assert.ok(start > 0 && end > start)
  const updates: unknown[] = []
  const history: unknown[][] = []
  const navigations: string[] = []
  run(source.slice(start, end), {
    payload: { status: 'draft', resumeUrl: '/renoapp/brf/test/apply?draft=token%2B1' },
    mode: 'draft', activeDraftToken: '', createdDraft: null, slug: 'test',
    window: { location: { href: 'https://example.test/renoapp/brf/test/apply?source=email#contact' }, history: { replaceState: (...args: unknown[]) => history.push(args) } },
    setCreatedDraft: (value: unknown) => updates.push(value), setActiveDraftToken: (value: unknown) => updates.push(value),
    router: { replace: (value: string) => navigations.push(value) },
  })
  assert.deepEqual(navigations, [])
  assert.deepEqual(updates, [{ slug: 'test', token: 'token+1', status: 'draft' }, 'token+1'])
  assert.equal(String(history[0][2]), 'https://example.test/renoapp/brf/test/apply?source=email&draft=token%2B1#contact')
})

test('configuration and draft hydration skip only the matching locally created draft', () => {
  const guards: string[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') {
      const callback = node.arguments[0]
      if (ts.isArrowFunction(callback) && ts.isBlock(callback.body)) {
        const first = callback.body.statements[0]
        if (first && ts.isIfStatement(first) && first.expression.getText(ast).includes('createdDraft')) guards.push(first.expression.getText(ast))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(guards.length, 2)
  const base = { slug: 'test', initialDraftToken: 'token', activeDraftToken: 'token' }
  for (const createdDraft of [null, { slug: 'other', token: 'token', status: 'draft' }, { slug: 'test', token: 'other', status: 'draft' }]) {
    for (const guard of guards) assert.ok(!run(`return ${guard}`, { ...base, createdDraft }))
  }
  const createdDraft = { slug: 'test', token: 'token', status: 'draft' }
  for (const guard of guards) assert.equal(run(`return ${guard}`, { ...base, createdDraft }), true)
  assert.equal(run(`return ${guards[1]}`, { ...base, createdDraft: { ...createdDraft, status: 'submitted' } }), false)
})

test('save status never reports saved while edits are pending, blocked or failed', () => {
  const base = { completionConflict: false, autosaveFailed: false, submitting: false,
    savingDraft: false, autosaving: false, uploadingTargetId: null, deletingDocumentId: null,
    activeDraftToken: 'token', hasValidApplicantEmail: true, draftFingerprint: 'current', lastSavedDraftFingerprint: 'current' }
  const status = (changes: Record<string, unknown> = {}) => run(`return ${expression('draftSaveStatus')}`, { ...base, ...changes })
  assert.equal(status(), 'Alla ändringar sparade')
  assert.match(status({ lastSavedDraftFingerprint: 'old' }), /väntar/)
  for (const field of ['autosaving', 'savingDraft', 'uploadingTargetId', 'deletingDocumentId']) assert.equal(status({ [field]: true }), 'Sparar...')
  assert.match(status({ autosaveFailed: true }), /kunde inte sparas/)
  assert.match(status({ completionConflict: true }), /pausat/)
  assert.match(status({ hasValidApplicantEmail: false }), /inte sparade/)
  assert.match(status({ activeDraftToken: '' }), /starta autosparandet/)
})

test('draft receipt has no self-navigation and save status remains visible after the first save', () => {
  assert.doesNotMatch(source, /href=\{submitResult\.resumeUrl\}/)
  assert.match(source, /Utkast sparat/)
  assert.match(source, /Ärendenummer: \{submitResult.caseNumber\}/)
  assert.match(source, /\(activeDraftToken \|\| autosaveEligible \|\| savingDraft\) && !isReadOnlyCase/)
  assert.match(source, /role="status" aria-live="polite"/)
})
