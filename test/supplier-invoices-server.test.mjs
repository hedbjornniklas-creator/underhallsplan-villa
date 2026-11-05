import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import * as domain from '../src/lib/supplier-invoices/domain.ts'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ctx = { orgId: id(1), userId: id(2) }
function draft(overrides = {}) {
  return { supplierName: 'Trävaror AB', supplierOrgNumber: '', invoiceNumber: 'F-123', invoiceDate: '2026-11-01', dueDate: '2026-11-30',
    documentKind: 'invoice', creditReferenceInvoiceId: null, currency: 'SEK', netAmountOre: 100000, vatAmountOre: 25000,
    approvalStatus: 'registered', paymentStatus: 'unpaid', paidOn: null, notes: '', sourceText: '', allocations: [], ...overrides }
}
const row = (n, org = ctx.orgId) => ({ id: id(n), org_id: org, revision: 1, body: draft({ invoiceNumber: `F-${n}` }),
  source: 'manual', external_id: null, created_at: '2026-11-01T08:00:00Z', updated_at: '2026-11-01T09:00:00Z' })

function load(file, dependencies) {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected import: ${name}`)
  }, module, module.exports)
  return module.exports
}

function harness(options = {}) {
  const reads = [], calls = [], uploaded = [], removed = [], signed = []
  let rpcCalled = false
  const db = {
    from(table) {
      const read = { table, filters: [], range: null, orders: [] }; reads.push(read)
      const result = () => {
        const filters = Object.fromEntries(read.filters)
        if (options.schemaError) return { error: { code: '42P01' } }
        let rows = table === 'supplier_invoices' ? (options.invoices ?? [row(3)]) : (options.files ?? [])
        if (table === 'supplier_invoice_attachments' && rpcCalled && options.uncertainCommitted) {
          rows = [{ id: filters.id, org_id: ctx.orgId, invoice_id: id(3) }]
        }
        if (table === 'supplier_invoice_attachments' && rpcCalled && options.uncertainRead) return { error: { code: 'network' } }
        rows = rows.filter((r) => read.filters.every(([key, value]) => r[key] === value))
        if (read.range) rows = rows.slice(read.range[0], read.range[1] + 1)
        return { data: read.single ? (rows[0] ?? null) : rows, error: null }
      }
      const query = {
        select(columns) { read.columns = columns; return query },
        eq(key, value) { read.filters.push([key, value]); return query },
        order(key) { read.orders.push(key); return query },
        range(a, b) { read.range = [a, b]; return query },
        maybeSingle() { read.single = true; return query },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) },
      }
      return query
    },
    async rpc(name, args) { rpcCalled = true; calls.push({ name, args }); return { data: { id: args.p_invoice_id, revision: 1 }, error: options.rpcError ?? null } },
    storage: { from(bucket) { return {
      async upload(path, bytes, metadata) { uploaded.push({ bucket, path, bytes, metadata }); return { error: options.uploadError ?? null } },
      async remove(paths) { removed.push({ bucket, paths }); return { error: null } },
      async createSignedUrl(path, seconds, opts) { signed.push({ bucket, path, seconds, opts }); return { data: { signedUrl: 'https://storage.example.test/private' }, error: null } },
    } } },
  }
  const server = load('src/lib/supplier-invoices/server.ts', { 'server-only': {}, 'node:crypto': crypto,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, './domain': domain })
  return { server, reads, calls, uploaded, removed, signed }
}

test('workspace reads all pages and never includes another organization or storage paths', async () => {
  const invoices = Array.from({ length: 501 }, (_, i) => row(i + 10))
  invoices.push(row(900, id(9)))
  const h = harness({ invoices, files: [{ id: id(6), invoice_id: id(10), org_id: ctx.orgId, file_name: 'faktura.pdf',
    content_type: 'application/pdf', file_size_bytes: 50, file_path: 'secret/internal', created_at: '2026-11-01T00:00:00Z' }] })
  const workspace = await h.server.getSupplierInvoiceWorkspace(ctx)
  assert.equal(workspace.invoices.length, 501)
  assert.ok(!workspace.invoices.some((i) => i.id === id(900)))
  assert.equal(workspace.invoices.find((i) => i.id === id(10)).attachments[0].fileName, 'faktura.pdf')
  assert.ok(!JSON.stringify(workspace).includes('secret/internal'))
  assert.ok(h.reads.every((read) => read.filters.some(([k, v]) => k === 'org_id' && v === ctx.orgId)))
  assert.equal(h.reads.filter((r) => r.table === 'supplier_invoices').length, 2)
})

test('save uses authenticated identity, optimistic revision and whitelisted draft data', async () => {
  const h = harness()
  await h.server.saveSupplierInvoice(ctx, { operation: 'save', id: id(3), expectedRevision: 0,
    orgId: id(99), source: 'fortnox', invoice: draft({ source: 'fortnox', externalId: '123', orgId: id(99) }) })
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.calls[0], { name: 'write_supplier_invoice', args: {
    p_org_id: ctx.orgId, p_user_id: ctx.userId, p_invoice_id: id(3), p_expected_revision: 0, p_body: draft(),
  } })
  for (const bad of [-1, 1.1, '1', null]) await assert.rejects(h.server.saveSupplierInvoice(ctx, { operation: 'save', id: id(3), expectedRevision: bad, invoice: draft() }), /INVOICE_INVALID/)
})

test('known DB conflicts and absent schema retain friendly error codes', async () => {
  for (const message of ['INVOICE_STALE', 'INVOICE_DUPLICATE', 'INVOICE_REFERENCE_INVALID']) {
    const h = harness({ rpcError: { code: 'P0001', message } })
    await assert.rejects(h.server.saveSupplierInvoice(ctx, { operation: 'save', id: id(3), expectedRevision: 0, invoice: draft() }), new RegExp(message))
  }
  await assert.rejects(harness({ schemaError: true }).server.getSupplierInvoiceWorkspace(ctx), /INVOICE_SCHEMA_REQUIRED/)
})

test('attachment signatures and MIME must agree before private upload', async () => {
  const h = harness()
  await assert.rejects(h.server.uploadSupplierInvoiceAttachment(ctx, id(3), new File(['<html>'], 'invoice.pdf', { type: 'application/pdf' })), /INVOICE_FILE_INVALID/)
  await assert.rejects(h.server.uploadSupplierInvoiceAttachment(ctx, id(3), new File(['%PDF-1.7\n'], 'invoice.jpg', { type: 'image/jpeg' })), /INVOICE_FILE_INVALID/)
  assert.equal(h.uploaded.length, 0)
  await h.server.uploadSupplierInvoiceAttachment(ctx, id(3), new File(['%PDF-1.7\n'], 'invoice.pdf', { type: 'application/pdf' }))
  assert.equal(h.uploaded[0].bucket, 'supplier-invoice-files')
  assert.ok(h.uploaded[0].path.startsWith(`${ctx.orgId}/${id(3)}/`))
  assert.equal(h.calls[0].name, 'add_supplier_invoice_attachment')
  assert.equal(h.calls[0].args.p_content_type, 'application/pdf')
})

test('unknown invoice is checked before any object upload', async () => {
  const h = harness({ invoices: [row(3, id(9))] })
  await assert.rejects(h.server.uploadSupplierInvoiceAttachment(ctx, id(3), new File(['%PDF-1.7'], 'invoice.pdf')), /INVOICE_NOT_FOUND/)
  assert.equal(h.uploaded.length, 0)
})

test('failed metadata cleans up only a definitively unregistered private object', async () => {
  const h = harness({ rpcError: { code: 'P0001', message: 'INVOICE_FILE_LIMIT' } })
  await assert.rejects(h.server.uploadSupplierInvoiceAttachment(ctx, id(3), new File(['%PDF-1.7'], 'invoice.pdf')), /INVOICE_FILE_LIMIT/)
  assert.equal(h.removed.length, 1)
  assert.deepEqual(h.removed[0].paths, [h.uploaded[0].path])
})

test('lost RPC response preserves committed or uncertain attachment objects', async () => {
  const committed = harness({ rpcError: { code: 'network' }, uncertainCommitted: true })
  await committed.server.uploadSupplierInvoiceAttachment(ctx, id(3), new File(['%PDF-1.7'], 'invoice.pdf'))
  assert.equal(committed.removed.length, 0)
  const uncertain = harness({ rpcError: { code: 'network' }, uncertainRead: true })
  await assert.rejects(uncertain.server.uploadSupplierInvoiceAttachment(ctx, id(3), new File(['%PDF-1.7'], 'invoice.pdf')), /INVOICE_FAILED/)
  assert.equal(uncertain.removed.length, 0)
})

test('download checks both invoice and attachment organization before short-lived signed URL', async () => {
  const file = { id: id(6), invoice_id: id(3), org_id: ctx.orgId, file_path: 'private-path', file_name: 'faktura.pdf' }
  const h = harness({ files: [file] })
  assert.equal(await h.server.getSupplierInvoiceAttachmentUrl(ctx, id(3), id(6)), 'https://storage.example.test/private')
  assert.deepEqual(h.signed[0], { bucket: 'supplier-invoice-files', path: 'private-path', seconds: 60, opts: { download: 'faktura.pdf' } })
  const denied = harness({ files: [{ ...file, org_id: id(9) }] })
  await assert.rejects(denied.server.getSupplierInvoiceAttachmentUrl(ctx, id(3), id(6)), /INVOICE_FILE_NOT_FOUND/)
  assert.equal(denied.signed.length, 0)
})

test('HTTP context requires task module access in the active organization', async () => {
  const access = []
  const http = load('src/lib/supplier-invoices/http.ts', {
    'next/server': { NextResponse: { json: (body, init) => ({ body, ...init }) } },
    '@/lib/assignments/server': { requireOrgContext: async () => ctx },
    '@/lib/access/server': { requireModuleAccess: async (input) => { access.push(input) } },
  })
  assert.deepEqual(await http.supplierInvoiceContext(), ctx)
  assert.deepEqual(access, [{ productKey: 'dashboard', moduleKey: 'tasks', scopeType: 'organization', scopeId: ctx.orgId }])
  await assert.rejects(http.supplierInvoiceRequestBody(new Request('https://hushub.se/api/supplier-invoices', { method: 'POST', headers: { Origin: 'https://other.test' }, body: '{}' })), /INVOICE_ORIGIN_INVALID/)
  assert.equal(http.supplierInvoiceError(new Error('INVOICE_DUPLICATE')).status, 409)
  assert.equal(http.supplierInvoiceError(new Error('INVOICE_REFERENCE_IN_USE')).status, 409)
  assert.deepEqual(http.supplierInvoiceError(new Error('secret database path')).body, { code: 'INVOICE_FAILED', error: 'Fakturan kunde inte hanteras just nu. Försök igen.' })
})

const nextServer = { NextResponse: {
  json: (body, init) => Response.json(body, init),
  redirect: (url, init = {}) => new Response(null, { status: 307, ...init, headers: { Location: url, ...init.headers } }),
} }
function httpHarness(options = {}) {
  return load('src/lib/supplier-invoices/http.ts', {
    'next/server': nextServer,
    '@/lib/assignments/server': { requireOrgContext: async () => {
      if (options.authError) throw new Error(options.authError)
      return ctx
    } },
    '@/lib/access/server': { requireModuleAccess: async () => {
      if (options.accessError) throw new Error(options.accessError)
    } },
  })
}

test('invoice API authenticates and checks module access before reading or mutating', async () => {
  for (const [options, status] of [[{ authError: 'UNAUTHORIZED' }, 401], [{ accessError: 'MODULE_ACCESS_REQUIRED' }, 403]]) {
    let reads = 0, writes = 0
    const route = load('src/app/api/supplier-invoices/route.ts', { 'next/server': nextServer,
      '@/lib/supplier-invoices/http': httpHarness(options),
      '@/lib/supplier-invoices/server': { getSupplierInvoiceWorkspace: async () => { reads++; return { invoices: [] } }, saveSupplierInvoice: async () => { writes++ } },
    })
    assert.equal((await route.GET()).status, status)
    assert.equal((await route.POST(new Request('https://hushub.se/api/supplier-invoices', { method: 'POST', body: '{}' }))).status, status)
    assert.equal(reads, 0); assert.equal(writes, 0)
  }
})

test('invoice API rejects bad bodies and cross-origin writes and returns refreshed uncached workspace', async () => {
  const saves = [], reads = []
  const route = load('src/app/api/supplier-invoices/route.ts', { 'next/server': nextServer,
    '@/lib/supplier-invoices/http': httpHarness(),
    '@/lib/supplier-invoices/server': { getSupplierInvoiceWorkspace: async (context) => { reads.push(context); return { invoices: [] } },
      saveSupplierInvoice: async (context, body) => { saves.push({ context, body }); return { id: body.id, revision: 1 } } },
  })
  for (const body of ['null', '[]', 'no-json', 'x'.repeat(150001)]) {
    assert.equal((await route.POST(new Request('https://hushub.se/api/supplier-invoices', { method: 'POST', body }))).status, 400)
  }
  assert.equal((await route.POST(new Request('https://hushub.se/api/supplier-invoices', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' }))).status, 403)
  assert.equal(saves.length, 0)
  const payload = { operation: 'save', id: id(3), expectedRevision: 0, invoice: draft() }
  const response = await route.POST(new Request('https://hushub.se/api/supplier-invoices', { method: 'POST', headers: { Origin: 'https://hushub.se' }, body: JSON.stringify(payload) }))
  assert.equal(response.status, 200)
  assert.deepEqual(saves, [{ context: ctx, body: payload }])
  assert.deepEqual(reads, [ctx])
  assert.deepEqual(await response.json(), { invoices: [], saved: { id: id(3), revision: 1 } })
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
})

test('save acknowledgement preserves the committed revision when readback races another writer', async () => {
  const readbackInvoice = { ...row(3), revision: 8, notes: 'Another writer changed the invoice after this save.' }
  const route = load('src/app/api/supplier-invoices/route.ts', { 'next/server': nextServer,
    '@/lib/supplier-invoices/http': httpHarness(),
    '@/lib/supplier-invoices/server': {
      saveSupplierInvoice: async () => ({ id: id(3), revision: 7 }),
      getSupplierInvoiceWorkspace: async () => ({ invoices: [readbackInvoice] }),
    },
  })
  const response = await route.POST(new Request('https://hushub.se/api/supplier-invoices', {
    method: 'POST', body: JSON.stringify({ operation: 'save', id: id(3), expectedRevision: 6, invoice: draft() }),
  }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.invoices[0].revision, 8)
  assert.deepEqual(body.saved, { id: id(3), revision: 7 })
})

test('attachment API validates multipart payload and forwards only file plus authenticated identity', async () => {
  const uploads = []
  const route = load('src/app/api/supplier-invoices/[invoiceId]/attachments/route.ts', { 'next/server': nextServer,
    '@/lib/supplier-invoices/http': httpHarness(),
    '@/lib/supplier-invoices/server': { getSupplierInvoiceWorkspace: async () => ({ invoices: [] }),
      uploadSupplierInvoiceAttachment: async (...args) => { uploads.push(args) } },
  })
  const params = { params: Promise.resolve({ invoiceId: id(3) }) }
  assert.equal((await route.POST(new Request('https://hushub.se/api/supplier-invoices/attachments', { method: 'POST', body: '{}' }), params)).status, 400)
  assert.equal((await route.POST(new Request('https://hushub.se/api/supplier-invoices/attachments', { method: 'POST', headers: { 'Content-Length': String(5 * 1024 * 1024) }, body: '{}' }), params)).status, 400)
  assert.equal(uploads.length, 0)
  const form = new FormData(); form.set('file', new File(['%PDF-1.7'], 'invoice.pdf', { type: 'application/pdf' }))
  const response = await route.POST(new Request('https://hushub.se/api/supplier-invoices/attachments', { method: 'POST', body: form }), params)
  assert.equal(response.status, 200)
  assert.equal(uploads.length, 1)
  assert.deepEqual(uploads[0].slice(0, 2), [ctx, id(3)])
  assert.equal(uploads[0][2].name, 'invoice.pdf')
})

test('attachment download API redirects only after authenticated authorization', async () => {
  const downloads = []
  const route = load('src/app/api/supplier-invoices/[invoiceId]/attachments/[attachmentId]/route.ts', { 'next/server': nextServer,
    '@/lib/supplier-invoices/http': httpHarness(),
    '@/lib/supplier-invoices/server': { getSupplierInvoiceAttachmentUrl: async (...args) => { downloads.push(args); return 'https://storage.example.test/signed' } },
  })
  const response = await route.GET(new Request('https://hushub.se/api/supplier-invoices/attachments/file'), { params: Promise.resolve({ invoiceId: id(3), attachmentId: id(6) }) })
  assert.equal(response.status, 307)
  assert.deepEqual(downloads, [[ctx, id(3), id(6)]])
  assert.equal(response.headers.get('Location'), 'https://storage.example.test/signed')
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
})
