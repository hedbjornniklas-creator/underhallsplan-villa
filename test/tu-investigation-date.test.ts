import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import * as jsxRuntime from 'react/jsx-runtime'
import ts from 'typescript'
import type * as TuServer from '../src/lib/tu/server'

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function load<T>(source: string, dependencies: Record<string, unknown> = {}): T {
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', code)((id: string) => {
    if (id in dependencies) return dependencies[id]
    throw new Error(`Unexpected dependency: ${id}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}

const ORG = 'org-a'
const ID = 'inspection-a'
const serverSource = read('src/lib/tu/server.ts')
const serverAst = ts.createSourceFile('server.ts', serverSource, ts.ScriptTarget.Latest, true)
type Row = Record<string, unknown>
type Call = { table: string; payload: Row; filters: Record<string, unknown> }

function harness(options: { date?: string | null; number?: string | null; locked?: boolean; failDate?: boolean } = {}) {
  const draft = { sections: [
    { id: 'parties', key: 'assignment_parties', title: 'Parter', text: 'Manuellt redigerade parter.' },
    { id: 'scope', key: 'assignment_scope', title: 'Uppdrag', text: 'Manuellt redigerad omfattning.' },
    { id: 'result', key: 'observed_execution', title: 'Resultat', text: 'Manuellt redigerat resultat.' },
  ] }
  const rows: Record<string, Row[]> = {
    technical_investigation_details: [{
      org_id: ORG, inspection_id: ID, property_id: null, assignment_id: 'assignment-a',
      report_draft: structuredClone(draft), report_locked_at: options.locked ? '2026-10-01' : null,
      property_object_type: 'villa', scope_description: 'Uppdragets omfattning',
    }],
    inspections: [{ id: ID, inspection_family: 'TU', date: options.date ?? null, assignment_number: options.number ?? null }],
  }
  const writes: Call[] = []
  const assignment = { id: 'assignment-a', preferred_date: '2026-10-01', status: 'accepted' }
  const admin = { from(table: string) {
    const filters: Record<string, unknown> = {}
    const matches: Array<(row: Row) => boolean> = []
    let payload: Row | undefined
    let insert = false
    const result = () => {
      if (!(table in rows)) throw new Error(`Unexpected table: ${table}`)
      let found = rows[table].filter(row => matches.every(match => match(row)))
      if (payload) {
        writes.push({ table, payload: structuredClone(payload), filters: { ...filters } })
        if (options.failDate && table === 'inspections' && 'date' in payload) {
          return { data: null, error: { message: 'private database diagnostic' } }
        }
        if (insert) {
          found = [{ id: 'new-inspection', ...payload }]
          rows[table].push(...found)
        } else {
          for (const row of found) Object.assign(row, structuredClone(payload))
        }
      }
      return { data: structuredClone(found), error: null }
    }
    const query = {
      select() { return query },
      update(value: Row) { payload = value; return query },
      insert(value: Row) { payload = value; insert = true; return query },
      eq(key: string, value: unknown) { filters[key] = value; matches.push(row => row[key] === value); return query },
      is(key: string, value: unknown) { return query.eq(key, value) },
      like(key: string, pattern: string) { matches.push(row => String(row[key]).startsWith(pattern.slice(0, -1))); return query },
      async maybeSingle() { const response = result(); return { ...response, data: response.data?.[0] ?? null } },
      async single() { return query.maybeSingle() },
      then(resolve: (value: ReturnType<typeof result>) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve, reject)
      },
    }
    return query
  } }
  const dependencies: Record<string, unknown> = {}
  for (const statement of serverAst.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      dependencies[statement.moduleSpecifier.text] = {}
    }
  }
  for (const name of ['inspections/assignmentNumber', 'tu/assignmentSchedule', 'tu/authoring', 'tu/workflowProfiles', 'tu/customerRole']) {
    dependencies[`@/lib/${name}`] = load(read(`src/lib/${name}.ts`))
  }
  dependencies['@/lib/supabase/admin'] = { createSupabaseAdminClient: () => admin }
  dependencies['@/lib/assignments/server'] = { getAssignmentById: async () => structuredClone(assignment) }
  const server = load<typeof TuServer & { createInspectionForTu: (input: Row) => Promise<unknown> }>(
    `${serverSource}\nexport { createInspectionForTu };`, dependencies
  )
  const update = (patch: Parameters<typeof server.updateTuInvestigationDraft>[0]['patch']) =>
    server.updateTuInvestigationDraft({ orgId: ORG, inspectionId: ID, updatedBy: 'user-a', patch })
  return { server, rows, draft, writes, assignment, update }
}

test('saving a previously missing date creates a number and preserves authored text and the confirmation', async () => {
  const h = harness()
  const saved = await h.update({ inspectionDate: '2026-10-17' })
  assert.equal(saved?.date, '2026-10-17')
  assert.equal(saved?.assignmentNumber, '2026-1017-01')
  assert.deepEqual(h.rows.technical_investigation_details[0].report_draft, h.draft)
  for (const section of h.draft.sections) {
    assert.equal(saved?.reportDraft.sections.find(item => item.key === section.key)?.text, section.text)
  }
  assert.equal(h.assignment.preferred_date, '2026-10-01')
  assert.equal(h.writes.some(call => 'report_draft' in call.payload || call.table === 'assignments'), false)
  assert.equal(h.writes.find(call => 'date' in call.payload)?.filters.inspection_family, 'TU')
})

test('changing the date preserves an existing assignment number', async () => {
  const h = harness({ date: '2026-10-01', number: '2026-1001-07' })
  assert.equal((await h.update({ inspectionDate: '2026-10-17' }))?.assignmentNumber, '2026-1001-07')
  assert.equal(h.writes.some(call => 'assignment_number' in call.payload), false)
})

test('a missing number is generated from the submitted date, not the old date during the initial read', async () => {
  const h = harness({ date: '2026-10-01' })
  assert.equal((await h.update({ inspectionDate: '2026-10-17' }))?.assignmentNumber, '2026-1017-01')
})

test('number allocation includes moved investigations and excludes other inspection families', async () => {
  const h = harness()
  h.rows.inspections.push(
    { id: 'moved', inspection_family: 'TU', date: '2026-10-20', assignment_number: '2026-1017-04' },
    { id: 'ob', inspection_family: 'OB', date: '2026-10-17', assignment_number: '2026-1017-90' },
  )
  assert.equal((await h.update({ inspectionDate: '2026-10-17' }))?.assignmentNumber, '2026-1017-05')
  await h.server.createInspectionForTu({ propertyId: 'property-a', date: '2026-10-17' })
  assert.equal(h.rows.inspections.at(-1)?.assignment_number, '2026-1017-06')
})

test('empty dates remain optional and clearing the date never clears an assigned number', async () => {
  const blank = harness()
  const saved = await blank.update({ inspectionDate: '' })
  assert.equal(saved?.date, null)
  assert.equal(saved?.assignmentNumber, null)
  const numbered = harness({ date: '2026-10-01', number: '2026-1001-07' })
  assert.equal((await numbered.update({ inspectionDate: null }))?.assignmentNumber, '2026-1001-07')
})

test('unrelated report edits do not clear the inspection date', async () => {
  const h = harness({ date: '2026-10-01', number: '2026-1001-07' })
  assert.equal((await h.update({ title: 'Ny rubrik' }))?.date, '2026-10-01')
  assert.equal(h.writes.some(call => 'date' in call.payload), false)
})

test('invalid calendar dates are rejected before reads can allocate a number or any data is changed', async () => {
  for (const inspectionDate of ['2026-02-29', '2026-04-31', '17/10/2026', '2026-13-01', '0026-10-17']) {
    const h = harness({ date: '2026-10-01' })
    await assert.rejects(h.update({ inspectionDate }), /TU_INSPECTION_DATE_INVALID/)
    assert.equal(h.writes.length, 0)
  }
  assert.equal((await harness().update({ inspectionDate: '2028-02-29' }))?.date, '2028-02-29')
})

test('locked investigations cannot be changed or assigned a number on read', async () => {
  const h = harness({ date: '2026-10-01', locked: true })
  await assert.rejects(h.update({ inspectionDate: '2026-10-17' }), /TU_REPORT_LOCKED/)
  assert.equal((await h.server.getTuInvestigationById({ orgId: ORG, inspectionId: ID }))?.assignmentNumber, null)
  assert.equal(h.writes.length, 0)
})

test('foreign investigations cannot be changed', async () => {
  const h = harness()
  await assert.rejects(h.server.updateTuInvestigationDraft({
    orgId: 'org-b', inspectionId: ID, updatedBy: 'user-b', patch: { inspectionDate: '2026-10-17' },
  }), /TU_INVESTIGATION_NOT_FOUND/)
  assert.equal(h.writes.length, 0)
})

test('a failed date write is not reported as successful', async () => {
  const h = harness({ failDate: true })
  await assert.rejects(h.update({ inspectionDate: '2026-10-17' }), /TU_INSPECTION_DATE_SAVE_FAILED/)
  assert.equal(h.rows.inspections[0].date, null)
  assert.equal(h.writes.some(call => 'assignment_number' in call.payload), false)
})

test('PATCH validates the date type, passes it through, and returns useful errors', async () => {
  const h = harness({ failDate: true })
  const route = load<{ PATCH: (request: Request, context: unknown) => Promise<Response> }>(
    read('src/app/api/tu/investigations/[inspectionId]/route.ts'), {
      'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
      '@/lib/tu/server': { ...h.server, requireTuContext: async () => ({ orgId: ORG, userId: 'user-a' }) },
    }
  )
  for (const [inspectionDate, status, message] of [
    [{ date: '2026-10-17' }, 400, 'Ange ett giltigt besiktningsdatum'],
    ['2026-02-29', 400, 'Ange ett giltigt besiktningsdatum'],
    ['2026-10-17', 500, 'Besiktningsdatumet kunde inte sparas'],
  ] as const) {
    const response = await route.PATCH(new Request(`https://example.test/api?orgId=${ORG}`, {
      method: 'PATCH', body: JSON.stringify({ inspectionDate }),
    }), { params: Promise.resolve({ inspectionId: ID }) })
    assert.equal(response.status, status)
    const body = await response.json()
    assert.ok(body.error.startsWith(message))
    assert.doesNotMatch(body.error, /private database|TU_INSPECTION/)
  }
})

test('PATCH returns the saved date and generated number for the existing editor save queue', async () => {
  const h = harness()
  const route = load<{ PATCH: (request: Request, context: unknown) => Promise<Response> }>(
    read('src/app/api/tu/investigations/[inspectionId]/route.ts'), {
      'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
      '@/lib/tu/server': { ...h.server, requireTuContext: async () => ({ orgId: ORG, userId: 'user-a' }) },
    }
  )
  const response = await route.PATCH(new Request(`https://example.test/api?orgId=${ORG}`, {
    method: 'PATCH', body: JSON.stringify({ inspectionDate: '2026-10-17', scopeDescription: 'Uppdragets omfattning' }),
  }), { params: Promise.resolve({ inspectionId: ID }) })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.investigation.date, '2026-10-17')
  assert.equal(body.investigation.assignmentNumber, '2026-1017-01')
  assert.equal((await h.server.getTuInvestigationById({ orgId: ORG, inspectionId: ID }))?.assignmentNumber, '2026-1017-01')
})

test('print and digital report use the actual inspection date before the originally booked date', () => {
  for (const path of ['src/lib/tu/reportSnapshot.ts', 'src/app/(dashboard)/tu/investigations/[inspectionId]/print/page.tsx']) {
    const source = read(path)
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let expression = ''
    function find(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'inspectionDate') expression = node.initializer!.getText(ast)
      ts.forEachChild(node, find)
    }
    find(ast)
    assert.ok(expression)
    const resolve = new Function('investigation', 'assignment', 'formatInspectionDate', `return ${expression}`)
    assert.equal(resolve({ inspection: { date: '2026-10-17' } }, { preferred_date: '2026-10-01' }, (date: string) => date), '2026-10-17')
    assert.equal(resolve({ inspection: { date: null } }, { preferred_date: '2026-10-01' }, (date: string) => date), '2026-10-01')
  }
})

test('assignment dialog prefills an editable date field and sends it with the existing save action', () => {
  const source = read('src/components/tu/TuInvestigationEditorClient.tsx')
  const ast = ts.createSourceFile('editor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const formFunction = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'buildAssignmentScopeForm')!
  const { buildAssignmentScopeForm } = load<{ buildAssignmentScopeForm: (investigation: unknown) => Row }>(`${formFunction.getText(ast)}\nexport { buildAssignmentScopeForm };`)
  const form = buildAssignmentScopeForm({ inspection: { date: '2026-10-17' } })
  assert.equal(form.inspectionDate, '2026-10-17')
  assert.equal(buildAssignmentScopeForm({ inspection: { date: null } }).inspectionDate, '')
  let dateInput = ''
  function find(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.getText(ast).includes('value={assignmentScopeForm.inspectionDate}')) dateInput = node.getText(ast)
    ts.forEachChild(node, find)
  }
  find(ast)
  assert.ok(dateInput)
  const { render } = load<{ render: (form: Row, saving: boolean) => Parameters<typeof renderToStaticMarkup>[0] }>(
    `export function render(assignmentScopeForm, assignmentScopeSaving) { return ${dateInput}; }`, { 'react/jsx-runtime': jsxRuntime }
  )
  const html = renderToStaticMarkup(render(form, false))
  assert.match(html, /type="date"/)
  assert.match(html, /value="2026-10-17"/)
  assert.doesNotMatch(html, /\s(?:disabled|readonly)=/i)
  assert.match(renderToStaticMarkup(render(form, true)), /\sdisabled=/)
  assert.match(source, /await savePatch\(\{\s*inspectionDate: assignmentScopeForm\.inspectionDate/)
})
