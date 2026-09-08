import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/renoapp/server.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true)
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'patchRenoAppAdminQuestionDetails')!
const code = ts.transpileModule(declaration.getText(ast), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const questionId = '00000000-0000-4000-8000-000000000001'
const optionId = '00000000-0000-4000-8000-000000000002'

function setup({ authorized = true, missing = false } = {}) {
  const calls: Array<[string, unknown]> = []
  let row: Record<string, unknown> = {}
  const query = {
    update: (patch: object) => { calls.push(['update', patch]); row = { ...row, ...patch }; return query },
    eq: (key: string, value: string) => { calls.push(['eq', [key, value]]); if (key === 'id') row.id = value; return query },
    select: (columns: string) => { calls.push(['select', columns]); return query },
    single: async () => ({ data: missing ? null : row, error: missing ? { message: 'not found' } : null }),
  }
  const admin = { from: (table: string) => { calls.push(['from', table]); return query } }
  const patch = new Function('exports', 'requireRenoAppAdminProfile', 'createSupabaseAdminClient', 'normalizeTerminologyText',
    `${code}; return patchRenoAppAdminQuestionDetails`)(
    {}, async () => { if (!authorized) throw new Error('FORBIDDEN') }, () => admin,
    (value: string | null) => value?.trim() || null,
  ) as (input: { questionId: string; optionId?: string; fields: Record<string, unknown> }) => Promise<{ id: string; fields: Record<string, unknown> }>
  return { patch, calls }
}

test('question text update writes exactly one row, never options, triggers or keys', async () => {
  const { patch, calls } = setup()
  const saved = await patch({ questionId, fields: { label: '  Updated question  ', helpText: '', sortOrder: 20, isActive: false } })
  assert.deepEqual(calls, [
    ['from', 'renoapp_apply_questions'],
    ['update', { label: 'Updated question', help_text: null, sort_order: 20, is_active: false }],
    ['eq', ['id', questionId]],
    ['select', 'id,label,help_text,response_type,sort_order,is_active'],
  ])
  assert.equal(saved.id, questionId)
  assert.equal(saved.fields.label, 'Updated question')
  assert.equal(saved.fields.isActive, false)
})

test('answer update is scoped to both answer and owning question', async () => {
  const { patch, calls } = setup()
  const saved = await patch({ questionId, optionId, fields: { label: 'Yes', description: 'Detail', sortOrder: 0 } })
  assert.deepEqual(calls, [
    ['from', 'renoapp_apply_question_options'],
    ['update', { label: 'Yes', description: 'Detail', sort_order: 100 }],
    ['eq', ['id', optionId]], ['eq', ['question_id', questionId]],
    ['select', 'id,label,description,sort_order,is_active'],
  ])
  assert.equal(saved.id, optionId)
})

test('authorization is required before any database write', async () => {
  const { patch, calls } = setup({ authorized: false })
  await assert.rejects(patch({ questionId, fields: { label: 'Blocked' } }), /FORBIDDEN/)
  assert.deepEqual(calls, [])
})

test('narrow update rejects structural fields and inherited property names', async () => {
  for (const key of ['key', 'id', 'metadata', 'options', 'triggers', 'questionId', 'constructor', '__proto__']) {
    const { patch, calls } = setup()
    await assert.rejects(patch({ questionId, fields: Object.fromEntries([[key, 'forbidden']]) }), /FLOW_FIELD_INVALID/)
    assert.deepEqual(calls, [])
  }
})

test('invalid details and identifiers are rejected before accessing the database', async () => {
  for (const fields of [{}, { label: ' ' }, { label: null }, { isActive: 'true' }, { sortOrder: 1.5 },
    { sortOrder: Infinity }, { responseType: 'text' }, { helpText: [] }]) {
    const { patch, calls } = setup()
    await assert.rejects(patch({ questionId, fields }), /FLOW_FIELD_INVALID|QUESTION_LABEL_REQUIRED/)
    assert.deepEqual(calls, [])
  }
  for (const input of [{ questionId: 'invalid' }, { questionId, optionId: '' }]) {
    const { patch, calls } = setup()
    await assert.rejects(patch({ ...input, fields: { label: 'Name' } }), /FLOW_FIELD_INVALID/)
    assert.deepEqual(calls, [])
  }
})

test('missing or mismatched answer does not report a successful save', async () => {
  const { patch } = setup({ missing: true })
  await assert.rejects(patch({ questionId, optionId, fields: { label: 'Answer' } }), /FLOW_FIELD_SAVE_FAILED/)
})
