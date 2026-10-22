import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { choiceOfferForEditing } from '../src/lib/action-cases/choiceOffer.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ctx = { orgId: id(1), userId: id(2) }, caseId = id(3)
const item = { id: id(4), title: 'Fiktivt alternativ', scope: 'Montage.', budgetOre: 12300, status: 'planned', decisionBy: '' }
item.offer = choiceOfferForEditing(item)
const code = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/choiceOfferPdfServer.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options = {}) {
  const reads = [], renders = [], calls = []
  const planning = { available: true, revision: 4, items: [item], categories: [{ title: 'Fönster', specification: 'Gemensamma krav.', optionIds: [item.id] }], optionFiles: options.files ? [{ optionId: item.id, fileId: id(5) }] : [], internal_costing: 'PRIVATE COSTS NEVER EXPORT' }
  const db = { from(table) {
    const read = { table, filters: [] }; reads.push(read)
    const result = () => {
      if (table === 'action_cases') return { data: { property_address: 'Fiktiv testadress 1' } }
      if (table === 'organizations') return { data: { name: 'Exempelbygg AB' } }
      if (table === 'action_case_attachments') return { data: options.missingFile ? [] : [{ id: id(5), file_name: 'Fiktiv offert.pdf', content_type: options.badFile ? 'text/html' : 'application/pdf' }] }
      if (table === 'action_case_customer_planning') return { data: { revision: options.concurrent ? 5 : 4 } }
      throw Error(`Unexpected read: ${table}`)
    }
    const chain = { select(value) { read.columns = value; return chain }, eq(...filter) { read.filters.push(filter); return chain }, in(...filter) { read.filters.push(filter); return chain }, maybeSingle: async () => result(), then: done => Promise.resolve(result()).then(done) }
    return chain
  } }
  const deps = { 'server-only': {}, 'node:crypto': crypto, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db },
    './customerOffers': { offerId(value) { if (!/^[0-9a-f-]{36}$/.test(value)) throw Error('CUSTOMER_OFFER_INVALID'); return value } },
    './customerOffersServer': { async getCustomerPlanning(context, project) { calls.push({ context, project }); if (options.forbidden) throw Error('CUSTOMER_OFFER_NOT_FOUND'); return planning } },
    './choiceOfferPdf': { async renderChoiceOfferPdf(value) { renders.push(value); if (options.renderFail) throw Error('renderer'); return Buffer.from('%PDF-TEST') } } }
  const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name] }, mod, mod.exports)
  return { download: (revision = 4, optionId = item.id) => mod.exports.downloadChoiceOfferPdf(ctx, caseId, optionId, revision), reads, renders, calls }
}
test('export authorizes first, reads only this tenant/project and sends no private worksheet to PDF', async () => {
  const h = harness({ files: true }), result = await h.download()
  assert.ok(result.bytes.toString().startsWith('%PDF')); assert.match(result.fileName, /v4\.pdf$/)
  assert.deepEqual(h.calls, [{ context: ctx, project: caseId }])
  const input = h.renders[0]
  assert.deepEqual(input.files, ['Fiktiv offert.pdf']); assert.match(input.reference, /v4-/)
  assert.doesNotMatch(JSON.stringify(input), /internal_costing|PRIVATE COSTS/)
  for (const read of h.reads) {
    assert.ok(read.filters.some(([key, value]) => key === (read.table === 'organizations' ? 'id' : 'org_id') && value === ctx.orgId))
    if (read.table === 'action_case_attachments' || read.table === 'action_case_customer_planning') assert.ok(read.filters.some(([key, value]) => key === 'action_case_id' && value === caseId))
  }
  assert.ok(h.reads.every(read => !/contract|offer|signing/.test(read.table)))
})
test('wrong access, foreign option, missing revision and stale revisions fail without rendering', async () => {
  const denied = harness({ forbidden: true }); await assert.rejects(denied.download(), /NOT_FOUND/); assert.deepEqual(denied.reads, [])
  for (const [revision, optionId, pattern] of [[-1, item.id, /INVALID/], [NaN, item.id, /INVALID/], [3, item.id, /STALE/], [4, id(9), /NOT_FOUND/]]) {
    const h = harness(); await assert.rejects(h.download(revision, optionId), pattern); assert.deepEqual(h.renders, [])
  }
})
test('missing attachments, rendering failures and concurrent saves do not produce a misleading download', async () => {
  for (const options of [{ files: true, missingFile: true }, { files: true, badFile: true }, { renderFail: true }, { concurrent: true }]) await assert.rejects(harness(options).download(), /CUSTOMER_CHOICE_(FILES|PDF_FAILED|PDF_STALE)/)
})
test('PDF endpoint is authenticated, GET-only, no-store and rejects a missing revision', () => {
  const source = readFileSync(new URL('../src/app/api/action-cases/[caseId]/customer-planning/[optionId]/pdf/route.ts', import.meta.url), 'utf8')
  assert.match(source, /customerOfferContext\(\)/); assert.match(source, /private, no-store/)
  assert.match(source, /if \(!raw/); assert.doesNotMatch(source, /export async function POST|sendAssignmentEmail|storage\.from/)
})
