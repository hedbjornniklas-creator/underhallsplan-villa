import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
import type { RenoAppCaseDetail, RenoAppCaseListItem } from '../src/lib/renoapp/server'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('independent application migration is repeatable, preserves legacy rows and permits repeated numbers', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create table public.renovation_cases (
      id text primary key, brf_id text, case_number text unique,
      unit_id text, applicant_contact_id text);
      alter table public.renovation_cases enable row level security;
      insert into public.renovation_cases values ('legacy','brf','OLD','unit','contact');`)
    const sql = read('docs/db/2026-09-29_02_renoapp_independent_applications.sql')
    await db.exec(sql)
    await db.exec(sql)
    const legacy = (await db.query<Record<string, unknown>>('select * from renovation_cases')).rows[0]
    assert.equal(legacy.unit_id, 'unit')
    assert.equal(legacy.applicant_contact_id, 'contact')
    assert.equal(legacy.applicant_name, null)
    assert.equal(legacy.unit_number_skatteverket, null)
    assert.equal((await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid = 'public.renovation_cases'::regclass"
    )).rows[0].relrowsecurity, true)
    for (const id of ['first', 'second']) {
      await db.query(`insert into renovation_cases
        (id,brf_id,case_number,applicant_name,applicant_email,applicant_phone,unit_number_internal,unit_number_skatteverket)
        values ($1,'brf',$1,'Applicant','same@example.test','0700000000','11','0101')`, [id])
    }
    await db.exec("update renovation_cases set applicant_name='Changed', unit_number_skatteverket='1102' where id='first'")
    const other = (await db.query<Record<string, unknown>>("select * from renovation_cases where id='second'")).rows[0]
    assert.equal(other.applicant_name, 'Applicant')
    assert.equal(other.unit_number_skatteverket, '0101')
    assert.equal(other.unit_id, null)
    assert.equal(other.applicant_contact_id, null)
    assert.equal((await db.query('select id from renovation_cases')).rows.length, 3)
  } finally { await db.close() }
})

function boardFixture() {
  const row = {
    id: 'case', brf_id: 'brf', case_number: 'CASE-1', status: 'review',
    applicant_name: 'Case applicant', applicant_email: 'case@example.test', applicant_phone: '0700000000',
    unit_number_internal: '253', unit_number_skatteverket: '1101',
    // Even stale legacy references must not become a fallback source.
    unit_id: 'shared-unit', applicant_contact_id: 'shared-contact', action_type_id: null,
  }
  const allowed = new Set(['renovation_cases', 'brf_associations', 'renovation_case_documents',
    'renovation_case_decisions', 'case_access_links', 'renoapp_action_type_participant_roles',
    'renoapp_case_requirement_decisions'])
  const admin = { from(table: string) {
    assert.ok(allowed.has(table), `Unexpected shared-data lookup: ${table}`)
    const rows = table === 'renovation_cases' ? [row] : table === 'brf_associations'
      ? [{ id: 'brf', name: 'Test association', slug: 'test' }] : []
    const query = {
      select() { return query }, eq() { return query }, in() { return query },
      order() { return query }, limit() { return query },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(resolve) },
    }
    return query
  } }
  const empty = async () => []
  const dependencies = {
    exports: {}, createSupabaseAdminClient: () => admin,
    requireRenoAppViewerContext: async () => ({ accessibleBrfIds: ['brf'] }),
    applyBrfScope: (query: unknown) => query,
    listCaseActionTypes: empty, listCaseQuestionAnswers: empty, listActiveApplyQuestions: empty,
    listCaseParticipants: empty, listActiveParticipantRoles: empty, listActiveReviewFlags: empty,
    listActiveReviewFlagLinks: empty, listCaseMessages: empty, loadActiveActionTypesByIds: empty,
    buildCaseReviewFlags: () => [], buildCaseUnderlagItems: () => [], getCaseClarifications: empty,
    getLatestCompletion: async () => null, getCaseRulesAcceptance: async () => null,
  }
  function load<T>(name: string): T {
    const ast = ts.createSourceFile('server.ts', read('src/lib/renoapp/server.ts'), ts.ScriptTarget.Latest, true)
    const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.ok(fn)
    const code = ts.transpileModule(fn.getText(ast), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText
    return new Function(...Object.keys(dependencies), `${code};return ${name}`)(...Object.values(dependencies)) as T
  }
  return { row,
    list: load<() => Promise<RenoAppCaseListItem[]>>('listRenoAppCases'),
    detail: load<(id: string, brfIds: string[]) => Promise<RenoAppCaseDetail>>('loadRenoAppCaseDetail'),
  }
}

test('board list and detail use case-owned data only and retain association access control', async () => {
  const f = boardFixture()
  assert.deepEqual((await f.list())[0].applicant, { name: 'Case applicant', email: 'case@example.test' })
  const detail = await f.detail('case', ['brf'])
  assert.deepEqual(detail.applicant, { id: null, name: 'Case applicant', email: 'case@example.test', phone: '0700000000' })
  assert.deepEqual(detail.unit, { id: null, unitNumberInternal: '253', unitNumberSkatteverket: '1101', status: null })
  assert.deepEqual(detail.currentContacts, [])
  await assert.rejects(f.detail('case', ['other-brf']), /CASE_NOT_FOUND/)
})

test('missing case-owned fields stay missing rather than reading previous applications or shared records', async () => {
  const f = boardFixture()
  Object.assign(f.row, { applicant_name: null, applicant_email: null, applicant_phone: null,
    unit_number_internal: null, unit_number_skatteverket: null })
  assert.deepEqual((await f.list())[0].applicant, { name: null, email: null })
  const detail = await f.detail('case', ['brf'])
  assert.equal(detail.applicant.email, null)
  assert.equal(detail.unit.unitNumberSkatteverket, null)
})
