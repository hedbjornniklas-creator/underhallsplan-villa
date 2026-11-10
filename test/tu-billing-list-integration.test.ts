import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const path = 'src/lib/tu/server.ts'
const ast = ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const functions = ['buildSummary', 'listTuInvestigations', 'getTuInvestigationById'].map(name => {
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name)
  assert.ok(node, `Exercise actual TU server function: ${name}`)
  return node.getText(ast)
})
type Row = Record<string, unknown>
const lockedAt = '2026-11-10T09:00:00Z'

function fixture() {
  const tables: Record<string, Row[]> = {
    technical_investigation_details: [
      { inspection_id: 'i-a', org_id: 'org-a', property_id: 'p-a', assignment_id: null, inspector_profile_id: null,
        report_locked_at: lockedAt, title: 'Utredning A', report_draft: { sections: [] } },
      { inspection_id: 'i-b', org_id: 'org-a', property_id: null, assignment_id: null, report_locked_at: null },
      { inspection_id: 'i-foreign', org_id: 'org-b', property_id: null, report_locked_at: lockedAt },
    ],
    inspections: [{ id: 'i-a', status: 'completed', date: '2026-11-10', assignment_number: 'TU-1' },
      { id: 'i-b', status: 'draft', date: null }],
    properties: [{ id: 'p-a', address: 'Testgatan 1' }],
  }
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  const billingCalls: Row[] = []
  const statuses = new Map<string, Row>([['i-a', { status: 'invoiced', invoiceNumber: 'PRIVATE', updatedByName: 'PRIVATE ACTOR' }]])
  const admin = {
    from(table: string) {
      assert.ok(table in tables, `Billing list integration cannot mutate or read report/delivery/billing tables directly: ${table}`)
      const filters: Array<[string, unknown]> = []
      const result = () => tables[table].filter(row => filters.every(([key, value]) =>
        Array.isArray(value) ? value.includes(row[key]) : row[key] === value))
      const log = () => reads.push({ table, filters })
      const query = {
        select() { return query },
        eq(key: string, value: unknown) { filters.push([key, value]); return query },
        in(key: string, values: unknown[]) { filters.push([key, values]); return query },
        order() { return query },
        async maybeSingle() { log(); return { data: result()[0] ?? null, error: null } },
        then(resolve: (value: { data: Row[]; error: null }) => unknown) {
          log(); return Promise.resolve({ data: result(), error: null as null }).then(resolve)
        },
      }
      return query
    },
  }
  const dependencies = {
    createSupabaseAdminClient: () => admin,
    getTuInvestigationBillingStatuses: async (input: Row) => { billingCalls.push(input); return statuses },
    resolveTuDetailObjectType: () => 'villa',
    ensureTuInspectionAssignmentNumber: () => { throw Error('A locked or explicit read-only report getter must not assign a number') },
    getAssignmentById: () => { throw Error('Fixture has no assignment') },
    getTuInspectorProfile: async () => null,
    cleanText: (value: unknown) => typeof value === 'string' ? value.trim() || null : null,
    normalizeTuReportDraft: (value: unknown) => value,
    buildTuAssignmentPartiesText: () => '',
    upsertAssignmentPartiesSectionText: (value: unknown) => value,
    upsertAssignmentScopeSectionText: (value: unknown) => value,
    resolveTuReportAuthoringMode: () => 'sectioned',
    resolveTuWorkflowProfile: () => 'default',
  }
  const code = ts.transpileModule(functions.join('\n'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText
  const loaded = new Function('exports', ...Object.keys(dependencies), `${code}; return { listTuInvestigations, getTuInvestigationById };`)(
    {}, ...Object.values(dependencies),
  ) as {
    listTuInvestigations(orgId: string): Promise<Row[]>
    getTuInvestigationById(input: { orgId: string; inspectionId: string; ensureAssignmentNumber: boolean }): Promise<Row | null>
  }
  return { ...loaded, reads, billingCalls, statuses, tables }
}

test('TU list attaches status-only billing in bulk after exact organization scoping, without changing source records', async () => {
  const f = fixture()
  const before = structuredClone(f.tables)
  const items = await f.listTuInvestigations('org-a')
  assert.equal(items.length, 2)
  assert.deepEqual(f.billingCalls, [{ orgId: 'org-a', inspectionIds: ['i-a', 'i-b'] }])
  assert.deepEqual(items.map(item => item.billing), [{ status: 'invoiced' }, { status: 'unavailable' }])
  assert.equal(items[0].status, 'completed')
  assert.equal(items[0].reportLockedAt, lockedAt)
  assert.equal(items[1].status, 'draft')
  assert.equal(JSON.stringify(items).includes('PRIVATE'), false, 'No invoice number or actor leaks through list projections')
  assert.deepEqual(f.tables, before)
  assert.ok(f.reads.some(read => read.table === 'technical_investigation_details'
    && read.filters.some(([key, value]) => key === 'org_id' && value === 'org-a')))
  f.statuses.clear()
  assert.ok((await f.listTuInvestigations('org-a')).every(item => (item.billing as Row).status === 'unavailable'))
  f.billingCalls.length = 0
  assert.deepEqual(await f.listTuInvestigations('empty-org'), [])
  assert.equal(f.billingCalls.length, 0, 'An empty scoped list does not request unrelated billing')
})

test('the actual TU details/report getter never reads or exposes billing, whether the report is locked or open', async () => {
  const f = fixture()
  const before = structuredClone(f.tables)
  for (const inspectionId of ['i-a', 'i-b']) {
    const detail = await f.getTuInvestigationById({ orgId: 'org-a', inspectionId, ensureAssignmentNumber: false })
    assert.ok(detail)
    assert.equal(Object.hasOwn(detail, 'billing'), false)
    assert.equal(JSON.stringify(detail).includes('PRIVATE'), false)
  }
  assert.equal(f.billingCalls.length, 0, 'Print, snapshots, AI and public delivery keep the existing billing-free details path')
  assert.deepEqual(f.tables, before)
})
