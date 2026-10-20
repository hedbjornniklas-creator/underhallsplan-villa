import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { EbInspectionRound, EbNote } from '../src/lib/eb/server'

const require = createRequire(import.meta.url)
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const compile = (source: string) => ts.transpileModule(source, { fileName: 'test.tsx', compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText
const paths = ['src/components/eb/EbInspectionRoundClient.tsx', 'src/components/eb/EbInspectionMobileRoundClient.tsx']

function evaluate<T>(source: string, bindings: Record<string, unknown>): T {
  const context = { exports: {}, ...bindings }
  return new Function(...Object.keys(context), `${compile(source)}; return value;`)(...Object.values(context)) as T
}

function functions<T>(path: string, names: string[], bindings: Record<string, unknown> = {}): T {
  const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
  assert.equal(declarations.length, names.length)
  return evaluate<T>(`${declarations.map(node => node.getText(ast).replace(/^export\s+/, '')).join('\n')}
    const value = { ${names.join(', ')} };`, bindings)
}

function variable(path: string, name: string) {
  const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, `Missing actual component variable ${name}`)
  return found.getText(ast)
}

type DisplayHelpers = {
  sortEbReportNotes: (notes: EbNote[]) => EbNote[]
  ebReportNoteDisplayIndex: (round: Pick<EbInspectionRound, 'notes' | 'project' | 'checkpoints'>) => Map<string, number>
  ebReportCheckpointDisplayIndex: (points: EbInspectionRound['checkpoints']) => Map<string, number>
}
const display = functions<DisplayHelpers>('src/lib/eb/reportNoteDisplay.ts', [
  'sortEbReportNotes', 'ebReportNoteDisplayIndex', 'ebReportCheckpointDisplayIndex',
])
type EditorHelpers = {
  getNoteLabel: (round: EbInspectionRound, note: EbNote | null, next: number, index: Map<string, number>) => string
  sortNotes: (notes: EbNote[]) => EbNote[]
  formFromNote: (note: EbNote) => Record<string, string>
  noteFormFingerprint: (form: Record<string, string>) => string
}
function editor(path: string) {
  const helpers = functions<EditorHelpers>(path, ['getNoteLabel', 'sortNotes', 'formFromNote', 'noteFormFingerprint'], display)
  const memo = <T>(name: string, round: EbInspectionRound, extra: Record<string, unknown> = {}) => evaluate<T>(
    `const value = ${variable(path, name)};`, { ...display, ...helpers, round,
      checkpoints: round.checkpoints, orderedNotes: helpers.sortNotes(round.notes),
      useMemo: (callback: () => unknown) => callback(), ...extra })
  return { ...helpers, memo }
}

function fixture(removeFirstEight = true): EbInspectionRound {
  const notes = Array.from({ length: 39 }, (_, index) => ({
    id: `note-${index + 1}`, projectId: 'project', inspectionId: 'inspection', disciplineId: index % 2 ? 'building' : 'plumbing',
    noteNumber: index + 1, location: 'Vägg', room: 'Kök', placeDetail: '', markerKey: 'E', statusKey: 'open',
    noteText: `Notering med lagrat nummer ${index + 1}`, remediationAssigneeId: null, remediationAssigneeName: null,
    responsibleParty: null, tradeGroup: null, investigationResponsibleParty: null, investigationResponsibleNote: null,
    investigationCostParty: null, investigationDueDate: null, deductionAmount: null, sortOrder: (index + 1) * 100,
    createdAt: '2026-10-20T08:00:00Z', updatedAt: null, disciplineLabel: 'Bygg', disciplineLittera: 'SLB2',
    markerLabel: 'Fel', statusLabel: 'Kvarstår',
  }))
  return { project: { id: 'project', notePrefix: 'BES', projectTemplateKey: null },
    inspection: { inspectionId: 'inspection', reportLockedAt: null },
    notes: removeFirstEight ? notes.slice(8) : notes, checkpoints: [], images: [],
  } as unknown as EbInspectionRound
}

for (const path of paths) {
  const label = path.includes('Mobile') ? 'mobile' : 'desktop'

  test(`${label}: the row, edit heading and deletion confirmation call raw note 39 number 31`, async () => {
    const round = fixture()
    const api = editor(path)
    const index = api.memo<Map<string, number>>('displayNumberByNoteId', round)
    const note = round.notes.find(note => note.noteNumber === 39)!
    const next = api.memo<number>('nextNoteNumber', round)
    assert.equal(index.get(note.id), 31)
    assert.equal(api.getNoteLabel(round, note, next, index), 'BES 31')
    const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let heading: ts.Node | undefined
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'h2' && node.getText(ast).includes('getNoteLabel')) heading = node
      ts.forEachChild(node, visit)
    }
    visit(ast)
    assert.ok(heading, 'Exercise the real edit heading and its arguments, not a substitute label')
    const html = renderToStaticMarkup(evaluate(`const value = (${heading.getText(ast)});`, {
      ...api, require, round, editingNote: note, nextNoteNumber: next, displayNumberByNoteId: index,
    }))
    assert.match(html, />BES 31<\/h2>/)
    let confirmation = ''
    const deleteNote = evaluate<(note: EbNote) => Promise<void>>(`const value = ${variable(path, 'handleDelete')};`, {
      ...api, round, displayNumberByNoteId: index, nextNoteNumber: next,
      isLocked: false, deletingId: null, deletingNoteRef: { current: false }, queuedImagesByNoteId: new Map(),
      editorTransitionPromiseRef: { current: null }, noteSavePromiseRef: { current: null }, noteAutosaveStatus: 'idle',
      clearNoteAutosaveTimer: () => undefined,
      window: { confirm: (text: string) => { confirmation = text; return false } },
    })
    await deleteNote(note)
    assert.equal(confirmation, 'Radera BES 31?')
    assert.equal(note.id, 'note-39')
    assert.equal(note.noteNumber, 39, 'Display numbering must not renumber stored notes')
  })

  test(`${label}: reordering follows the report and filtering keeps global numbers rather than restarting at one`, () => {
    const round = fixture()
    round.notes = [...round.notes].reverse()
    const moved = round.notes.find(note => note.id === 'note-39')!
    moved.sortOrder = 850
    const api = editor(path)
    assert.deepEqual(api.sortNotes(round.notes).map(note => note.id), display.sortEbReportNotes(round.notes).map(note => note.id))
    const index = api.memo<Map<string, number>>('displayNumberByNoteId', round)
    const filtered = api.memo<EbNote[]>('filteredNotes', round, { activeDisciplineId: 'building' })
    assert.deepEqual(filtered.map(note => note.id), display.sortEbReportNotes(round.notes).filter(note => note.disciplineId === 'building').map(note => note.id))
    assert.equal(index.get(moved.id), 1)
    assert.equal(index.get(filtered[0].id), 3, 'The first building note follows two plumbing notes in the complete report')
    assert.equal(api.getNoteLabel(round, filtered[0], 32, index), 'BES 3')
  })

  test(`${label}: next-note preview is 32 after eight deletions while the stored identity sequence remains 40`, async () => {
    const round = fixture()
    const api = editor(path)
    const next = api.memo<number>('nextNoteNumber', round)
    assert.equal(next, 32)
    assert.equal(api.getNoteLabel(round, null, next, api.memo('displayNumberByNoteId', round)), 'BES 32')
    const calls: Array<{ method: string; args: unknown[] }> = []
    const builder = {
      select: (...args: unknown[]) => { calls.push({ method: 'select', args }); return builder },
      eq: (...args: unknown[]) => { calls.push({ method: 'eq', args }); return builder },
      not: (...args: unknown[]) => { calls.push({ method: 'not', args }); return builder },
      order: (...args: unknown[]) => { calls.push({ method: 'order', args }); return builder },
      limit: async () => ({ data: [{ note_number: 39 }], error: null }),
    }
    const storage = functions<{ getNextEbNoteNumber: (input: object) => Promise<number> }>('src/lib/eb/server.ts', ['getNextEbNoteNumber'], {
      createSupabaseAdminClient: () => ({ from: () => builder }),
    })
    assert.equal(await storage.getNextEbNoteNumber({ orgId: 'org', projectId: 'project', inspectionId: 'inspection' }), 40)
    assert.ok(calls.some(call => call.method === 'order' && call.args[0] === 'note_number'))
    assert.equal(round.notes.at(-1)?.noteNumber, 39)
  })

  test(`${label}: drainage uses control-point numbers and never substitutes an unmapped stored number`, () => {
    const round = fixture()
    round.project.projectTemplateKey = 'drainage_foundation'
    round.checkpoints = [
      { title: 'Första kontrollen', groupKey: 'walls', sortOrder: 100, noteId: null },
      { title: 'Andra kontrollen', groupKey: 'walls', sortOrder: 200, noteId: 'note-39' },
      { title: 'Dokument', groupKey: 'documents', sortOrder: 1, noteId: 'note-38' },
    ] as EbInspectionRound['checkpoints']
    const api = editor(path)
    const index = api.memo<Map<string, number>>('displayNumberByNoteId', round)
    assert.equal(api.getNoteLabel(round, round.notes.find(note => note.id === 'note-39')!, 32, index), 'BES 2')
    assert.equal(api.getNoteLabel(round, round.notes.find(note => note.id === 'note-38')!, 32, index), 'BES -')
    assert.equal(index.has('note-38'), false)
  })

  test(`${label}: editing number 31 retains the real note ID and normal form and PATCH payload`, async () => {
    const round = fixture()
    const note = round.notes.find(note => note.id === 'note-39')!
    const api = editor(path)
    let selected: EbNote | null = null
    let form: Record<string, string> = {}
    const bindings = {
      ...api, saving: false, pathname: '/perform', router: { replace: () => undefined },
      setEditingNote: (value: EbNote) => { selected = value }, setEditorOpen: () => undefined,
      setActiveDisciplineId: () => undefined, lastAutosavedNoteFormRef: { current: '' },
      setForm: (value: Record<string, string>) => { form = value },
      replaceForm: (value: Record<string, string>) => { form = value }, openNoteSheet: () => undefined,
      activeDraftIdRef: { current: '' }, setActiveDraftId: () => undefined,
      serverNotesRef: { current: new Map() }, lastQueuedFingerprintRef: { current: new Map() },
      editorTransitionPromiseRef: { current: null }, editingNoteRef: { current: null }, editorOpenRef: { current: false },
      deletingNoteRef: { current: false },
      editorSessionRef: { current: 0 }, initialNoteFormFingerprintRef: { current: '' },
      latestNoteFormRef: { current: {} }, noteAutosaveTimerRef: { current: null }, setNoteEditorError: () => undefined,
    }
    const desktopHelpers = label === 'desktop'
      ? ['replaceNoteForm', 'replaceEditingNote', 'clearNoteAutosaveTimer', 'openNoteEditor']
        .map(name => `const ${name} = ${variable(path, name)};`).join('\n') : ''
    const edit = evaluate<(note: EbNote) => Promise<void> | void>(`${desktopHelpers}\nconst value = ${variable(path, 'handleEdit')};`, bindings)
    await edit(note)
    assert.equal(selected, note)
    assert.deepEqual(form, api.formFromNote(note))
    assert.equal('noteNumber' in form, false)
    const requests: Array<{ url: string; method: string; body: Record<string, unknown> }> = []
    const save = evaluate<(payload: object) => Promise<unknown>>(`const value = ${variable(path, label === 'mobile' ? 'saveNoteBatch' : 'saveNotePatch')};`, {
      useCallback: (callback: unknown) => callback, notesBasePath: '/notes', round,
      serverNotesRef: { current: new Map([[note.id, note]]) }, noteSaveJobsRef: { current: new Map() },
      upsertNoteInState: () => undefined, removeStoredNoteSaveJob: () => undefined,
      fetch: async (url: string, options: { method: string; body: string }) => {
        requests.push({ url, method: options.method, body: JSON.parse(options.body) })
        return Response.json({ note })
      },
    })
    await save(label === 'mobile'
      ? { [note.id]: { draftId: note.id, disciplineId: note.disciplineId, fingerprint: 'form', form } }
      : { noteId: note.id, disciplineId: note.disciplineId, form })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, '/notes/note-39')
    assert.equal(requests[0].method, 'PATCH')
    assert.deepEqual(requests[0].body, { ...form, disciplineId: note.disciplineId, remediationAssigneeCommit: false })
    assert.equal('noteNumber' in requests[0].body, false)
    assert.equal('clientNoteId' in requests[0].body, false)
  })

  test(`${label}: deleting eight earlier notes then opening note 39 immediately recalculates number 31 without a reload`, async () => {
    let round = fixture(false)
    const api = editor(path)
    const requests: string[] = []
    const errors: unknown[] = []
    for (let number = 1; number <= 8; number += 1) {
      const note = round.notes.find(note => note.id === `note-${number}`)!
      const remove = evaluate<(note: EbNote) => Promise<void>>(`const value = ${variable(path, 'handleDelete')};`, {
        ...api, round, displayNumberByNoteId: api.memo('displayNumberByNoteId', round),
        nextNoteNumber: api.memo('nextNoteNumber', round), isLocked: false, deletingId: null,
        editorTransitionPromiseRef: { current: null }, noteSavePromiseRef: { current: null }, noteAutosaveStatus: 'idle',
        clearNoteAutosaveTimer: () => undefined,
        deletingNoteRef: { current: false }, window: { confirm: () => true },
        notesBasePath: '/notes', setDeletingId: () => undefined,
        noteHeadingsRef: { current: [] }, reportSectionsRef: { current: [] }, reportDraftUpdatedAtRef: { current: null },
        resetReportDraftAutosaveError: () => undefined, enqueueReportDraftAutosave: async () => undefined,
        clearPendingNoteOrderSave: () => undefined, notesRef: { current: round.notes }, lastSavedNotesRef: { current: round.notes },
        orderedNotes: api.sortNotes(round.notes),
        setRound: (update: (round: EbInspectionRound) => EbInspectionRound) => { round = update(round) },
        replaceNoteHeadings: () => undefined, reconcileNoteHeadingsAfterDeletedNote: () => [], editingNote: null,
        queuedImagesByNoteId: new Map(), imageUploadQueue: { discardItem: async () => undefined },
        serverNotesRef: { current: new Map() }, noteSaveJobsRef: { current: new Map() },
        noteSavePromisesRef: { current: new Map() }, lastQueuedFingerprintRef: { current: new Map() },
        removeStoredNoteSaveJob: () => undefined, showError: (error: unknown) => { errors.push(error) },
        fetch: async (url: string, options: { method: string }) => {
          assert.equal(options.method, 'DELETE')
          requests.push(url)
          return Response.json({ ok: true })
        },
      })
      await remove(note)
    }
    assert.deepEqual(errors, [])
    assert.equal(requests.length, 8)
    assert.equal(round.notes.length, 31)
    assert.equal(round.notes.some(note => note.id === 'note-1'), false)
    const target = round.notes.find(note => note.id === 'note-39')!
    const index = api.memo<Map<string, number>>('displayNumberByNoteId', round)
    assert.equal(api.getNoteLabel(round, target, api.memo('nextNoteNumber', round), index), 'BES 31')
    assert.equal(target.id, 'note-39')
    assert.equal(target.noteNumber, 39)
    assert.equal(api.formFromNote(target).noteText, 'Notering med lagrat nummer 39')
  })
}
