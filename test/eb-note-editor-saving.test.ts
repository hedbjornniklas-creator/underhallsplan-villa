import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type { EbInspectionReport, EbNote } from '../src/lib/eb/server'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const componentPath = 'src/components/eb/EbInspectionRoundClient.tsx'
const component = () => ts.createSourceFile(componentPath, read(componentPath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText
function evaluate<T>(source: string, bindings: Record<string, unknown>): T {
  const context = { exports: {}, ...bindings }
  return new Function(...Object.keys(context), `${compile(source)}; return value;`)(...Object.values(context)) as T
}
function declarations(ast: ts.SourceFile, names: string[]) {
  const found = new Map<string, { source: string; position: number }>()
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) {
      found.set(node.name.text, { source: `const ${node.getText(ast)};`, position: node.getStart(ast) })
    }
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      found.set(node.name.text, { source: node.getText(ast).replace(/^export\s+/, ''), position: node.getStart(ast) })
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  for (const name of names) assert.ok(found.has(name), `Missing actual source implementation: ${name}`)
  return [...found.values()].sort((left, right) => left.position - right.position).map(entry => entry.source).join('\n')
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}
async function settle() { for (let tick = 0; tick < 8; tick += 1) await Promise.resolve() }

// Run the existing shared queue itself. React lifecycle and HTTP boundaries are
// controlled; its real active/pending refs and drain ordering remain unchanged.
function queueHook() {
  const ast = ts.createSourceFile('queue.ts', read('src/hooks/useAutosaveQueue.ts'), ts.ScriptTarget.Latest, true)
  const slots: Array<{ current: unknown }> = []
  let cursor = 0
  const useRef = (value: unknown) => slots[cursor++] ?? (slots[cursor - 1] = { current: value })
  const queue = evaluate<(options: object) => unknown>(`${declarations(ast, ['useAutosaveQueue'])}; const value = useAutosaveQueue;`, {
    useRef,
    useState: (initial: unknown) => {
      const slot = useRef(initial)
      return [slot.current, (next: unknown) => { slot.current = typeof next === 'function' ? next(slot.current) : next }]
    },
    useEffect: (callback: () => unknown) => { callback() },
    useCallback: (callback: unknown) => callback,
  })
  return (options: object) => { cursor = 0; return queue(options) }
}

function fixture() {
  const note: EbNote = {
    id: 'note-39', projectId: 'project', inspectionId: 'inspection', disciplineId: 'building', noteNumber: 39,
    location: 'Vägg', room: 'Kök', placeDetail: '', markerKey: 'E', statusKey: 'open', noteText: 'Tidigare sparad text.',
    remediationAssigneeId: null, remediationAssigneeName: null, responsibleParty: null, tradeGroup: null,
    investigationResponsibleParty: null, investigationResponsibleNote: null, investigationCostParty: null,
    investigationDueDate: null, deductionAmount: null, sortOrder: 3900, createdAt: '2026-10-20T08:00:00Z', updatedAt: null,
    disciplineLabel: 'Bygg', disciplineLittera: 'SLB2', markerLabel: 'Fel', statusLabel: 'Kvarstår',
  }
  const round = { project: { id: 'project', notePrefix: 'BES' }, inspection: { inspectionId: 'inspection', reportLockedAt: null },
    notes: [note], images: [], disciplines: [{ id: 'building', key: 'building', label: 'Bygg', isActive: true, sortOrder: 100 }],
    markers: [{ key: 'E' }], statuses: [{ key: 'open', isDefault: true }], suggestions: [], remediationAssignees: [],
  } as unknown as EbInspectionReport
  return { note, round }
}

type Form = Record<string, string>
type Helpers = {
  formFromNote: (note: EbNote) => Form
  createInitialForm: (round: EbInspectionReport) => Form
  noteFormFingerprint: (form: Form) => string
}
type Handlers = {
  updateField: (key: string, value: string) => void
  closeEditor: () => Promise<void>
  handleSubmit: (event: { preventDefault: () => void }) => Promise<void>
  handleSaveAndNew: () => Promise<void>
  handleEdit: (note: EbNote) => Promise<void>
  handleNewNote: () => Promise<void>
  saveCurrentNote: () => Promise<EbNote | null>
  runNoteAutosaveEffect: () => unknown
}
function harness(newNote = false) {
  const ast = component()
  const helpers = evaluate<Helpers>(`${declarations(ast, ['formFromNote', 'createInitialForm', 'noteFormFingerprint'])};
    const value = { formFromNote, createInitialForm, noteFormFingerprint };`, {})
  const { note, round } = fixture()
  const initial = newNote ? helpers.createInitialForm(round) : helpers.formFromNote(note)
  const state = { form: initial, editingNote: newNote ? null : note as EbNote | null, editorOpen: true,
    saving: false, noteEditorError: null as string | null, noteEditorTransitionPending: false, activeDisciplineId: 'building' }
  const refs = {
    latestNoteFormRef: { current: initial }, editingNoteRef: { current: state.editingNote }, editorOpenRef: { current: true },
    editorSessionRef: { current: 1 }, initialNoteFormFingerprintRef: { current: helpers.noteFormFingerprint(initial) },
    editorTransitionPromiseRef: { current: null }, noteSavePromiseRef: { current: null },
    noteAutosaveTimerRef: { current: null }, lastAutosavedNoteFormRef: { current: helpers.noteFormFingerprint(initial) },
    deletingNoteRef: { current: false },
  }
  const requests: Array<{ url: string; method: string; body: Record<string, unknown>; response: ReturnType<typeof deferred<Response>> }> = []
  const errors: unknown[] = []
  const navigations: string[] = []
  const persisted: EbNote[] = []
  const timers = new Map<number, () => void>()
  let nextTimer = 1
  const useAutosaveQueue = queueHook()
  const names = ['replaceNoteForm', 'replaceEditingNote', 'clearNoteAutosaveTimer', 'resetForm', 'dismissEditor', 'openNoteEditor',
    'saveNotePatch', 'noteAutosave', 'saveCurrentNote', 'finishEditorTransition', 'closeEditor', 'handleSubmit',
    'handleSaveAndNew', 'handleEdit', 'handleNewNote', 'updateField']
  let effect: string | undefined
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' &&
      node.arguments[0]?.getText(ast).includes('noteAutosaveTimerRef') && node.arguments[0].getText(ast).includes('700')) {
      effect = node.arguments[0].getText(ast)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(effect, 'Use the actual 700 ms autosave effect')
  const source = `${declarations(ast, names)};
    const { enqueue: enqueueNoteAutosave, resetError: resetNoteAutosaveError } = noteAutosave;
    const runNoteAutosaveEffect = ${effect};
    const value = { ${names.filter(name => !['saveNotePatch', 'noteAutosave'].includes(name)).join(', ')}, runNoteAutosaveEffect };`
  const render = () => evaluate<Handlers>(source, {
    ...helpers, ...refs, ...state, round, useAutosaveQueue,
    isLocked: false, lockedMessage: 'Låst besiktning', notesBasePath: '/notes', pathname: '/perform',
    router: { replace: (path: string) => { navigations.push(path) } },
    setForm: (next: Form | ((previous: Form) => Form)) => { state.form = typeof next === 'function' ? next(state.form) : next },
    setEditingNote: (next: EbNote | null | ((previous: EbNote | null) => EbNote | null)) => {
      state.editingNote = typeof next === 'function' ? next(state.editingNote) : next
    },
    setEditorOpen: (value: boolean) => { state.editorOpen = value },
    setSaving: (value: boolean) => { state.saving = value },
    setNoteEditorError: (value: string | null) => { state.noteEditorError = value },
    setNoteEditorTransitionPending: (value: boolean) => { state.noteEditorTransitionPending = value },
    setActiveDisciplineId: (value: string | ((previous: string) => string)) => {
      state.activeDisciplineId = typeof value === 'function' ? value(state.activeDisciplineId) : value
    },
    showError: (error: unknown) => { errors.push(error) },
    upsertNoteInState: (saved: EbNote) => { round.notes = [...round.notes.filter(row => row.id !== saved.id), saved] },
    useCallback: (callback: unknown) => callback,
    setTimeout: (callback: () => void) => { const id = nextTimer++; timers.set(id, callback); return id },
    clearTimeout: (id: number) => { timers.delete(id) },
    fetch: (url: string, options: { method: string; body: string }) => {
      const response = deferred<Response>()
      requests.push({ url, method: options.method, body: JSON.parse(options.body), response })
      return response.promise
    },
  })
  render()
  const type = (text: string) => {
    render().updateField('noteText', text)
    render().runNoteAutosaveEffect()
  }
  const succeed = (index: number) => {
    const request = requests[index]
    assert.ok(request, `Missing request ${index}`)
    const saved = { ...note, ...request.body, id: request.method === 'POST' ? 'new-note-one' : request.url.split('/').at(-1)! } as EbNote
    persisted.push(saved)
    request.response.resolve(Response.json({ note: saved }))
  }
  return { state, refs, round, note, requests, errors, navigations, persisted, timers, render, type, succeed,
    fail: (index: number) => requests[index].response.resolve(Response.json({ error: 'Testfel vid sparning' }, { status: 500 })),
    runTimers: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()) },
  }
}

test('typing then immediately closing saves the latest form before closing and cancels the pending debounce', async () => {
  const f = harness()
  f.type('Den senaste texten före stängning.')
  assert.equal(f.timers.size, 1)
  const closing = f.render().closeEditor()
  await settle()
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].body.noteText, 'Den senaste texten före stängning.')
  assert.equal(f.requests[0].url, '/notes/note-39')
  assert.equal(f.requests[0].method, 'PATCH')
  assert.equal(f.state.editorOpen, true)
  assert.equal(f.state.form.noteText, 'Den senaste texten före stängning.')
  assert.equal(f.timers.size, 0)
  f.succeed(0)
  await closing
  assert.equal(f.state.editorOpen, false)
  assert.equal(f.persisted.at(-1)?.noteText, 'Den senaste texten före stängning.')
})

test('an older in-flight autosave finishes before the explicit latest save so stale text cannot win', async () => {
  const f = harness()
  f.type('Äldre text i autosparning.')
  f.runTimers()
  await settle()
  assert.equal(f.requests.length, 1)
  f.type('Nyare text som måste vinna.')
  const closing = f.render().closeEditor()
  await settle()
  assert.equal(f.requests.length, 1, 'The final PATCH must not run in parallel with the older PATCH')
  assert.equal(f.state.editorOpen, true)
  f.succeed(0)
  await settle()
  assert.equal(f.requests.length, 2)
  assert.equal(f.requests[1].body.noteText, 'Nyare text som måste vinna.')
  assert.equal(f.requests[1].body.remediationAssigneeCommit, true)
  f.succeed(1)
  await closing
  assert.equal(f.persisted.at(-1)?.noteText, 'Nyare text som måste vinna.')
  assert.equal(f.state.editorOpen, false)
})

test('rapid X and backdrop close events share one final commit, including a new note POST', async () => {
  const f = harness(true)
  f.type('En ny notering, endast en gång.')
  const close = f.render().closeEditor
  const first = close()
  const second = close()
  await settle()
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].method, 'POST')
  f.succeed(0)
  await Promise.all([first, second])
  assert.equal(f.requests.length, 1)
  assert.equal(f.round.notes.filter(note => note.id === 'new-note-one').length, 1)
  assert.equal(f.state.editorOpen, false)
})

test('a failed final save keeps the editor and entered text open and a retry saves the same note ID', async () => {
  const f = harness()
  f.type('Texten får inte försvinna vid fel.')
  const failed = f.render().closeEditor()
  await settle()
  f.fail(0)
  await failed
  assert.equal(f.state.editorOpen, true)
  assert.equal(f.state.form.noteText, 'Texten får inte försvinna vid fel.')
  assert.equal(f.state.editingNote?.id, 'note-39')
  assert.ok(f.state.noteEditorError)
  const retry = f.render().closeEditor()
  await settle()
  assert.equal(f.requests[1].url, '/notes/note-39')
  f.succeed(1)
  await retry
  assert.equal(f.state.editorOpen, false)
})

test('an untouched empty new-note editor closes without creating a note', async () => {
  const f = harness(true)
  await f.render().closeEditor()
  assert.equal(f.requests.length, 0)
  assert.equal(f.state.editorOpen, false)
})

for (const action of ['save-close', 'save-new'] as const) {
  test(`${action} uses the same serialized final commit and only changes the editor after success`, async () => {
    const f = harness()
    f.type('Sparad med den synliga knappen.')
    const handlers = f.render()
    const saving = action === 'save-close' ? handlers.handleSubmit({ preventDefault() {} }) : handlers.handleSaveAndNew()
    await settle()
    assert.equal(f.state.editorOpen, true)
    assert.equal(f.requests.length, 1)
    assert.equal(f.requests[0].body.noteText, 'Sparad med den synliga knappen.')
    f.succeed(0)
    await saving
    assert.equal(f.state.editorOpen, action === 'save-new')
    assert.equal(f.state.editingNote, null)
    if (action === 'save-new') assert.equal(f.state.form.noteText, '')
  })
}

test('switching to another note saves the dirty current note before changing selection', async () => {
  const f = harness()
  const nextNote = { ...f.note, id: 'note-next', noteNumber: 40, noteText: 'Nästa notering.' }
  f.type('Ändringen innan nästa notering.')
  const switching = f.render().handleEdit(nextNote)
  await settle()
  assert.equal(f.state.editingNote?.id, 'note-39')
  assert.equal(f.navigations.length, 0)
  assert.equal(f.requests[0].url, '/notes/note-39')
  f.succeed(0)
  await switching
  assert.equal(f.state.editingNote?.id, 'note-next')
  assert.equal(f.state.form.noteText, 'Nästa notering.')
  assert.equal(f.persisted.at(-1)?.noteText, 'Ändringen innan nästa notering.')
})

test('a new note already being created is not POSTed twice and any newer text is saved under its returned ID', async () => {
  const f = harness(true)
  f.type('Första versionen vid POST.')
  const pending = f.render().saveCurrentNote()
  await settle()
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].method, 'POST')
  f.type('Nyare text innan första svaret kom.')
  const closing = f.render().closeEditor()
  await settle()
  assert.equal(f.requests.length, 1)
  f.succeed(0)
  await settle()
  assert.equal(f.requests.length, 2)
  assert.equal(f.requests[1].method, 'PATCH')
  assert.equal(f.requests[1].url, '/notes/new-note-one')
  assert.equal(f.requests[1].body.noteText, 'Nyare text innan första svaret kom.')
  f.succeed(1)
  await Promise.all([pending, closing])
  assert.equal(f.requests.filter(request => request.method === 'POST').length, 1)
  assert.equal(f.persisted.at(-1)?.id, 'new-note-one')
  assert.equal(f.persisted.at(-1)?.noteText, 'Nyare text innan första svaret kom.')
  assert.equal(f.state.editorOpen, false)
})

test('a changed new draft without note text stays open rather than being treated as an untouched empty editor', async () => {
  const f = harness(true)
  f.render().updateField('room', 'Källare')
  await f.render().closeEditor()
  assert.equal(f.requests.length, 0)
  assert.equal(f.state.editorOpen, true)
  assert.equal(f.state.form.noteText, '')
  assert.equal(f.state.form.room, 'Källare')
  assert.equal(f.state.editingNote, null)
  assert.ok(f.state.noteEditorError)
})

test('a failed save while switching notes retains the current selection, dirty text and route', async () => {
  const f = harness()
  f.type('Text som inte sparats ännu.')
  const switching = f.render().handleEdit({ ...f.note, id: 'note-next', noteText: 'Nästa notering.' })
  await settle()
  f.fail(0)
  await switching
  assert.equal(f.state.editorOpen, true)
  assert.equal(f.state.editingNote?.id, 'note-39')
  assert.equal(f.state.form.noteText, 'Text som inte sparats ännu.')
  assert.deepEqual(f.navigations, [])
})

test('an older failed autosave does not prevent the queued latest close-save succeeding', async () => {
  const f = harness()
  f.type('Äldre autosparning som misslyckas.')
  f.runTimers()
  await settle()
  f.type('Den senaste versionen kan sparas.')
  const closing = f.render().closeEditor()
  await settle()
  f.fail(0)
  await settle()
  assert.equal(f.requests.length, 2)
  assert.equal(f.requests[1].body.noteText, 'Den senaste versionen kan sparas.')
  f.succeed(1)
  await closing
  assert.equal(f.state.editorOpen, false)
  assert.equal(f.state.noteEditorError, null)
  assert.equal(f.persisted.at(-1)?.noteText, 'Den senaste versionen kan sparas.')
})

test('closing or switching during an active deletion does not send a racing PATCH or change selection', async () => {
  const f = harness()
  f.type('Text medan radering pågår.')
  f.refs.deletingNoteRef.current = true
  await f.render().closeEditor()
  await f.render().handleEdit({ ...f.note, id: 'note-next', noteText: 'Nästa notering.' })
  assert.equal(f.requests.length, 0)
  assert.equal(f.state.editorOpen, true)
  assert.equal(f.state.editingNote?.id, 'note-39')
  assert.equal(f.state.form.noteText, 'Text medan radering pågår.')
  assert.deepEqual(f.navigations, [])
})

test('a stale debounce callback cannot save the next new draft onto the previously edited note', async () => {
  const f = harness()
  f.type('Den färdiga texten i förra noteringen.')
  const staleCallback = [...f.timers.values()][0]
  assert.ok(staleCallback)
  const closing = f.render().closeEditor()
  await settle()
  f.succeed(0)
  await closing
  await f.render().handleNewNote()
  f.type('Text i en ny, ännu osparad notering.')
  staleCallback()
  await settle()
  assert.equal(f.requests.length, 1)
  assert.equal(f.state.editingNote, null)
  assert.equal(f.state.editorOpen, true)
  assert.equal(f.state.form.noteText, 'Text i en ny, ännu osparad notering.')
})
