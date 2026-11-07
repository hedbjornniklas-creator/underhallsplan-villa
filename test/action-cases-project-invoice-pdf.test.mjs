import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { PDFDocument } from 'pdf-lib'
import { renderInvoiceBasisPdf } from '../src/lib/action-cases/invoiceBasisPdf.ts'
import { emptyInvoiceBasis } from '../src/lib/action-cases/projectCompletion.ts'

const record = () => ({ id: randomUUID(), revision: 3, body: { ...emptyInvoiceBasis({ issuer: 'Fiktiv avsandare AB', recipient: 'Fiktiv kund' }), date: '2026-11-07', lines: Array.from({ length: 24 }, (_, i) => ({ id: randomUUID(), description: `Fiktivt arbete ${i + 1}`, quantity: 10, unit: 'tim', unitPriceOre: i ? 60000 : 0, vatRate: 25 })) }, updatedAt: '2026-11-07' })
test('the shared PDF renderer produces branded paginated invoice support, preserving source rows', async () => {
  const r = record(), before = JSON.stringify(r), pdf = await PDFDocument.load(await renderInvoiceBasisPdf(r, 'Testprojekt'))
  assert.equal(pdf.getTitle(), 'Fakturaunderlag'); assert.equal(pdf.getAuthor(), 'Fiktiv avsandare AB')
  assert.equal(pdf.getForm().getFields().length, 0); assert.ok(pdf.getPageCount() >= 2)
  for (const page of pdf.getPages()) { assert.equal(Math.round(page.getWidth()), 595); assert.equal(Math.round(page.getHeight()), 842) }
  assert.equal(JSON.stringify(r), before)
  r.body.lines[0].unitPriceOre = null
  await assert.rejects(renderInvoiceBasisPdf(r, 'Testprojekt'), /INCOMPLETE/)
})
const routeCode = ts.transpileModule(readFileSync(new URL('../src/app/api/action-cases/[caseId]/invoice-basis/[basisId]/pdf/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options = {}) {
  const r = record(), caseId = randomUUID(), ctx = { orgId: randomUUID(), userId: randomUUID() }, calls = [], reads = []
  const db = { from(table) { const read = { table, filters: [] }; reads.push(read); const q = { select() { return q }, eq(...args) { read.filters.push(args); return q }, async single() { return { data: table === 'action_cases' ? { title: 'Testprojekt' } : { revision: options.changed ? 4 : 3 } } } }; return q } }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', routeCode)(name => {
    if (name === 'next/server') return { NextResponse: Response }
    if (name.includes('customerOffersHttp')) return { customerOfferContext: async () => { calls.push('auth'); if (options.denied) throw Error('FORBIDDEN'); return ctx }, customerOfferError: e => Response.json({ error: e.message }, { status: 409 }) }
    if (name.includes('projectCompletionServer')) return { getProjectCompletion: async (actual, project) => { assert.deepEqual(actual, ctx); assert.equal(project, caseId); calls.push('workspace'); return { bases: [r] } } }
    if (name.endsWith('projectCompletion')) return { administrationUuid: value => /^[0-9a-f-]{36}$/.test(value) }
    if (name.includes('invoiceBasisPdf')) return { renderInvoiceBasisPdf: async () => { calls.push('render'); return Buffer.from('%PDF-test') } }
    if (name.includes('supabase/admin')) return { createSupabaseAdminClient: () => db }
    throw Error(name)
  }, module, module.exports)
  return { run: (revision = 3) => module.exports.GET(new Request(`http://localhost/pdf?revision=${revision}`), { params: Promise.resolve({ caseId, basisId: r.id }) }), calls, reads, ctx, caseId }
}
test('PDF download authenticates first, scopes post-render checks, and uses the saved revision', async () => {
  const h = harness(), result = await h.run()
  assert.equal(result.status, 200); assert.equal(result.headers.get('Content-Type'), 'application/pdf')
  assert.match(result.headers.get('Content-Disposition'), /Fakturaunderlag-20261107-/)
  assert.deepEqual(h.calls, ['auth', 'workspace', 'render'])
  for (const r of h.reads) assert.ok(r.filters.some(([field, value]) => field === 'org_id' && value === h.ctx.orgId))
  const wrong = harness(); assert.equal((await wrong.run(2)).status, 409); assert.ok(!wrong.calls.includes('render'))
  assert.equal((await harness({ changed: true }).run()).status, 409)
  const denied = harness({ denied: true }); assert.equal((await denied.run()).status, 409); assert.deepEqual(denied.calls, ['auth'])
})
