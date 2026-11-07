import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/eb/server.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true)
const builder = ast.statements.find(statement => ts.isFunctionDeclaration(statement)
  && statement.name?.text === 'buildProjectItems')!
const code = ts.transpileModule(builder.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

test('internal project reads attach billing in bulk without changing work, delivery or report fields', async () => {
  const input = [{ id: 'project-a', org_id: 'org-a' }, { id: 'project-b', org_id: 'org-a' }]
  const original = input.map((project, index) => ({
    id: project.id, title: `Entreprenad ${index}`, status: 'ongoing',
    inspections: [{ inspectionId: `inspection-${index}`, status: 'completed',
      reportLockedAt: '2026-11-01T10:00:00Z', reportDeliveryStatus: 'sent', reportPdfStatus: 'ready' }],
  }))
  const snapshot = structuredClone(original)
  const marked = { status: 'invoiced', invoiceNumber: 'F-1', revision: 1 }
  const unavailable = { status: 'unavailable', invoiceNumber: null, revision: 0 }
  let bulkCalls = 0
  const dependencies = {
    fetchDetailsForProjects: async () => [],
    fetchInspectionsByIds: async () => new Map(),
    fetchLatestReportLinksByInspectionIds: async () => new Map(),
    fetchLatestEbUnlocks: async () => new Map(),
    fetchReportDeliveriesByInspectionIds: async () => new Map(),
    mapProject: (project: { id: string }) => original.find(item => item.id === project.id),
    loadEbInspectionBillingForProjects: async (value: unknown) => {
      bulkCalls++
      assert.deepEqual(value, { orgId: 'org-a', projects: original })
      return new Map([['inspection-0', marked]])
    },
    unavailableEbInspectionBilling: () => unavailable,
  }
  const build = new Function(...Object.keys(dependencies), `${code}; return buildProjectItems`)(
    ...Object.values(dependencies),
  ) as (rows: typeof input) => Promise<typeof original>
  const result = await build(input)
  assert.equal(bulkCalls, 1)
  assert.deepEqual(original, snapshot, 'existing summaries are not mutated')
  assert.deepEqual(result, original.map((project, index) => ({ ...project,
    inspections: project.inspections.map(inspection => ({ ...inspection, billing: index ? unavailable : marked })),
  })))
})
