import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as quotes from '../src/lib/action-cases/quotes.ts'
import * as domain from '../src/lib/action-cases/domain.ts'

function compile(name, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(`../src/lib/action-cases/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (dependency) => dependencies[dependency] ?? {})
  return mod.exports
}
const requests = compile('quoteRequests', { './quotes': quotes })
const packages = compile('quotePackages', { './quotes': quotes, './quoteRequests': requests })
const stamp = '2026-09-09T10:00:00.123456Z'
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

async function workspace({ legacy = false, packageState = 'active', stalePart = false, regular = false, sourcePatch = {}, omitPart = false } = {}) {
  const tables = {
    action_cases: [{ id: id(1), org_id: id(9), title: 'Wall', customer_name: 'Customer', property_address: 'Address', status: 'quote_ready', created_at: stamp, updated_at: stamp }],
    action_case_items: [{ id: id(2), action_case_id: id(1), org_id: id(9), title: 'Wall', scope: 'Build wall', status: 'ready_for_quote', estimated_cost: 900, customer_price: 1080, sort_order: 100, updated_at: stamp }],
    action_case_cost_lines: [{ id: id(3), action_case_item_id: id(2), action_case_id: id(1), category: 'subcontractor', description: 'Build', quantity: 1, unit: 'uppdrag', unit_cost: 900, markup_percent: 20, vat_rate: 25, price_source: 'subcontractor', is_verified: true, pricing_method: 'quotes', selected_quote_id: id(6), work_part_id: legacy ? null : id(5), updated_at: stamp }],
    action_case_work_parts: [{ id: id(5), action_case_item_id: id(2), action_case_id: id(1), title: stalePart ? 'Changed carpentry' : 'Carpentry', scope: 'Timber frame', sort_order: 100, updated_at: stamp }],
    action_case_quote_requests: [{ id: id(4), action_case_id: id(1), supplier_name: 'UE', supplier_email: 'ue@example.test', subject: 'Wall', message: '', other_requirements: '', body: 'Frozen body', requirements: [], attachment_ids: [], lines: [{ costLineId: id(3), itemId: id(2), itemTitle: 'Wall', scope: 'Build wall', description: 'Build', ...(legacy ? {} : { workPartId: id(5), workPartTitle: 'Carpentry', workPartScope: 'Timber frame' }) }], price_presentation: 'grouped', response_mode: regular || legacy ? 'itemized' : 'pending', sent_at: stamp, delivery_status: 'sent', updated_at: stamp }],
    action_case_work_quotes: [{ id: id(6), cost_line_id: id(3), amount: 900, supplier_name: 'UE', scope_snapshot: 'Build wall', description_snapshot: 'Build', checked: true, package_request_id: regular || legacy ? null : id(4), request_id: regular || legacy ? id(4) : null, updated_at: stamp },
      ...(!regular && !legacy ? [{ id: id(8), cost_line_id: id(3), package_request_id: id(4), amount: 700, checked: true, scope_snapshot: 'Build wall', description_snapshot: 'Build', updated_at: stamp }] : [])],
    action_case_quote_packages: regular || legacy ? [] : [{ request_id: id(4), group_key: `${id(2)}:${id(5)}`, action_case_id: id(1), action_case_item_id: id(2), work_part_id: id(5), quote_id: id(6), anchor_line_id: id(3), amount: 900, covered_line_ids: [], state: packageState, updated_at: stamp }],
  }
  Object.assign(tables.action_case_quote_requests[0].lines[0], sourcePatch)
  if (omitPart) for (const key of ['workPartId', 'workPartTitle', 'workPartScope']) delete tables.action_case_quote_requests[0].lines[0][key]
  const reads = []
  const admin = { from(table) {
    let columns = ''
    const record = { table, filters: [] }; reads.push(record)
    const result = () => legacy && ['action_case_work_parts', 'action_case_quote_packages'].includes(table)
      ? { data: null, error: { code: '42P01' } }
      : legacy && table === 'action_case_quote_requests' && columns.includes('price_presentation')
        ? { data: null, error: { code: '42703' } }
        : { data: tables[table] ?? [], error: null }
    const chain = {
      select(value) { columns = value; record.columns = value; return chain },
      eq(...args) { record.filters.push(args); return chain },
      in(...args) { record.filters.push(args); return chain },
      order() { return chain }, then(resolve) { return Promise.resolve(result()).then(resolve) },
    }
    return chain
  } }
  const server = compile('server', { '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin }, './quotes': quotes,
    './quoteRequests': requests, './quotePackages': packages, './domain': domain })
  const data = await server.getActionCaseWorkspace({ orgId: id(9), userId: id(10) })
  return { data, reads }
}

test('active group anchors retain their price without masquerading as independent per-line quotes', async () => {
  const { data, reads } = await workspace()
  const item = data.cases[0].items[0], line = item.costLines[0]
  assert.equal(line.unitCost, 900)
  assert.equal(item.estimatedCost, 900)
  assert.equal(line.quotes.length, 1, 'historical derived group prices must not be selectable alternatives')
  assert.equal(line.quotes[0].packageGroupKey, `${id(2)}:${id(5)}`)
  assert.equal(line.quotes[0].requestId, id(4))
  assert.equal(data.cases[0].quotePackages.length, 1)
  assert.equal(item.workParts[0].title, 'Carpentry')
  assert.ok(reads.filter((read) => ['action_case_work_parts', 'action_case_quote_packages'].includes(read.table)).every((read) => read.filters.some(([key, value]) => key === 'org_id' && value === id(9))))
})

test('old schemas load legacy requests without requiring new grouping columns', async () => {
  const { data } = await workspace({ legacy: true })
  assert.equal(data.cases[0].quoteRequests[0].pricePresentation, 'itemized')
  assert.deepEqual(data.cases[0].items[0].workParts, [])
  assert.deepEqual(data.cases[0].quotePackages, [])
  assert.equal(data.cases[0].items[0].costLines[0].unitCost, 900)
})

test('changed work-part scope invalidates previously selected itemized prices in the read model', async () => {
  const { data } = await workspace({ regular: true, stalePart: true })
  const item = data.cases[0].items[0]
  assert.equal(item.costLines[0].unitCost, null)
  assert.equal(item.status, 'waiting_subcontractor')
  assert.equal(data.cases[0].status, 'pricing')
})

test('removed and superseded group quotes do not appear as manually selectable offers', async () => {
  const { data } = await workspace({ packageState: 'removed' })
  assert.deepEqual(data.cases[0].items[0].costLines[0].quotes, [])
  assert.equal(data.cases[0].items[0].costLines[0].unitCost, null)
})

test('item identity, title, scope and description snapshots invalidate stale selected itemized prices', async () => {
  for (const sourcePatch of [{ itemId: id(12) }, { itemTitle: 'Old wall title' }, { scope: 'Old scope' }, { description: 'Old description' }]) {
    const { data } = await workspace({ regular: true, sourcePatch })
    const item = data.cases[0].items[0]
    assert.equal(item.costLines[0].unitCost, null)
    assert.equal(item.costLines[0].verified, false)
    assert.equal(item.estimatedCost, null)
    assert.equal(item.status, 'waiting_subcontractor')
    assert.equal(data.cases[0].status, 'pricing')
  }
})

test('legacy unassigned request snapshots do not authorize a subsequently assigned work part', async () => {
  const { data } = await workspace({ regular: true, omitPart: true })
  assert.equal(data.cases[0].items[0].costLines[0].unitCost, null)
  assert.equal(data.cases[0].items[0].status, 'waiting_subcontractor')
})

function attachmentDeletion({ deleteError = null, missingDeleted = false, storageError = null } = {}) {
  const calls = [], filters = []
  const admin = {
    from(table) {
      let deleting = false
      const chain = {
        select() { return chain }, eq(...args) { filters.push([table, ...args]); return chain },
        delete() { deleting = true; return chain },
        insert() { calls.push('event'); return Promise.resolve({ error: null }) },
        maybeSingle() {
          if (table === 'action_cases') return Promise.resolve({ data: { id: id(1) }, error: null })
          if (deleting) { calls.push('database'); return Promise.resolve({ data: deleteError || missingDeleted ? null : { id: id(20) }, error: deleteError }) }
          return Promise.resolve({ data: { storage_bucket: 'action-case-files', file_path: 'tenant/case/quote.pdf', file_name: 'quote.pdf' }, error: null })
        },
      }
      return chain
    },
    storage: { from() { return { remove: async () => { calls.push('storage'); return { error: storageError } } } } },
  }
  const server = compile('server', { '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin } })
  return { calls, filters, run: () => server.deleteActionCaseAttachment({ orgId: id(9), userId: id(10) }, { caseId: id(1), attachmentId: id(20) }) }
}

test('attachment database constraints protect current and historical quote files before storage removal', async () => {
  for (const deleteError of [
    { code: 'P0001', message: 'ACTION_CASE_PACKAGE_USE_RPC' },
    { code: 'P0001', message: 'ACTION_CASE_PACKAGE_REMOVE_FIRST' },
    { code: '23503', message: 'Referenced document' },
  ]) {
    const deletion = attachmentDeletion({ deleteError })
    await assert.rejects(deletion.run, /ACTION_CASE_FILE_IN_USE/)
    assert.deepEqual(deletion.calls, ['database'])
    assert.ok(deletion.filters.some(([table, key, value]) => table === 'action_case_attachments' && key === 'org_id' && value === id(9)))
  }
  const failed = attachmentDeletion({ deleteError: { code: 'XX000', message: 'Database unavailable' } })
  await assert.rejects(failed.run, /ACTION_CASE_FILE_DELETE_FAILED/)
  assert.deepEqual(failed.calls, ['database'])
  const raced = attachmentDeletion({ missingDeleted: true })
  await assert.rejects(raced.run, /ACTION_CASE_FILE_NOT_FOUND/)
  assert.deepEqual(raced.calls, ['database'])
})

test('an unreferenced attachment is deleted in the database before storage and audit', async () => {
  const deletion = attachmentDeletion()
  await deletion.run()
  assert.deepEqual(deletion.calls, ['database', 'storage', 'event'])
})

test('failed storage cleanup is logged without pretending deletion succeeded', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  const deletion = attachmentDeletion({ storageError: { message: 'Storage unavailable' } })
  await assert.rejects(deletion.run, /ACTION_CASE_FILE_DELETE_FAILED/)
  assert.deepEqual(deletion.calls, ['database', 'storage'])
  assert.equal(log.mock.calls[0].arguments[0], 'ACTION_CASE_FILE_STORAGE_CLEANUP_FAILED')
  assert.equal(log.mock.calls[0].arguments[1].attachmentId, id(20))
})
