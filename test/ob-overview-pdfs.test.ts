import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as PdfModule from '../src/lib/ob/overviewPdfs'

const source = readFileSync(new URL('../src/lib/ob/overviewPdfs.ts', import.meta.url), 'utf8')
const compiled = { exports: {} }
new Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(compiled.exports)
const { loadOverviewPdfIds } = compiled.exports as typeof PdfModule

const report = (id: string, overrides = {}) => ({
  id, pdf_status: 'pending', pdf_storage_bucket: null, pdf_storage_path: null, ...overrides,
})
function fixture(rows: unknown[], legacy: string[] = [], fail = false) {
  const calls: URL[] = []
  const client = createClient('https://synthetic.invalid', 'synthetic', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(String(input)); calls.push(url)
      assert.equal(url.origin, 'https://synthetic.invalid')
      if (fail) return Response.json({ message: 'test failure' }, { status: 500 })
      return Response.json(url.pathname.endsWith('/inspections') ? rows : legacy
        .filter(id => url.searchParams.get('id')?.includes(id)).map(id => ({ id })))
    } },
  })
  return { client, calls }
}

test('PDF metadata is scoped to the visible page, organization and newest 25 active reports', async () => {
  const f = fixture([
    { id: 'stored', inspection_report_links: [report('ready', { pdf_status: 'ready', pdf_storage_bucket: 'reports', pdf_storage_path: 'saved.pdf' })] },
    { id: 'legacy', inspection_report_links: [report('base64')] },
    { id: 'processing', inspection_report_links: [report('wait', { pdf_status: 'processing' })] },
    { id: 'missing-file', inspection_report_links: [report('missing', { pdf_status: 'ready' })] },
    { id: 'foreign', inspection_report_links: [report('foreign-ready', { pdf_status: 'ready', pdf_storage_bucket: 'reports', pdf_storage_path: 'no.pdf' })] },
  ], ['base64'])
  const ready = await loadOverviewPdfIds(f.client, 'my-org', ['stored', 'legacy', 'processing', 'missing-file'])
  assert.deepEqual([...ready], ['stored', 'legacy'])
  assert.equal(f.calls.length, 2)
  const query = f.calls[0].searchParams
  assert.equal(query.get('id'), 'in.(stored,legacy,processing,missing-file)')
  assert.equal(query.get('inspection_report_links.org_id'), 'eq.my-org')
  assert.equal(query.get('inspection_report_links.revoked_at'), 'is.null')
  assert.equal(query.get('inspection_report_links.limit'), '25')
  assert.equal(query.get('inspection_report_links.order'), 'created_at.desc')
  assert.doesNotMatch(query.get('select')!, /pdf_base64|snapshot|token/)
  const legacy = f.calls[1].searchParams
  assert.equal(legacy.get('org_id'), 'eq.my-org')
  assert.equal(legacy.get('revoked_at'), 'is.null')
  assert.equal(legacy.get('select'), 'id')
  assert.deepEqual(legacy.getAll('pdf_base64'), ['not.is.null', 'neq.'])
  assert.doesNotMatch(legacy.get('id')!, /ready|foreign/)
})

test('PDF lookup never fetches the entire list and fails closed on errors', async () => {
  const f = fixture([])
  assert.deepEqual([...await loadOverviewPdfIds(f.client, 'org', [])], [])
  assert.equal(f.calls.length, 0)
  await assert.rejects(loadOverviewPdfIds(f.client, 'org', Array(51).fill('id')), /För många/)
  assert.equal(f.calls.length, 0)
  await assert.rejects(loadOverviewPdfIds(fixture([], [], true).client, 'org', ['id']), /PDF-status/)
})

test('legacy metadata lookup batches IDs without ever loading PDF bodies', async () => {
  const ids = Array.from({ length: 50 }, (_, i) => `inspection-${i}`)
  const f = fixture(ids.map(id => ({ id, inspection_report_links:
    Array.from({ length: 25 }, (_, n) => report(`${id}-report-${n}`)) })))
  await loadOverviewPdfIds(f.client, 'org', ids)
  assert.equal(f.calls.length, 1 + Math.ceil(1250 / 80))
  assert.ok(f.calls.slice(1).every(url => url.searchParams.get('id')!.split(',').length <= 80))
  assert.ok(f.calls.every(url => !url.searchParams.get('select')!.includes('pdf_base64')))
})
