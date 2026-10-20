import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import * as domain from '../src/lib/action-cases/customerOffers.ts'
import * as planning from '../src/lib/action-cases/customerPlanning.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const bytes = Buffer.from('%PDF-1.7\n' + 'FIKTIVT TESTUNDERLAG\n'.repeat(12))
const item = { id: id(3), title: 'Fönster', scope: 'Test', status: 'planned', budgetOre: null, decisionBy: '' }
const ctx = { orgId: id(1), userId: id(2) }, caseId = id(4)
const ref = { optionId: item.id, fileId: id(5) }
const source = { id: id(5), file_name: 'Fönster.pdf', content_type: 'application/pdf', file_size_bytes: bytes.length, storage_bucket: 'action-case-files', file_path: `${ctx.orgId}/${caseId}/source.pdf` }
const code = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/customerChoiceFilesServer.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options = {}) {
  const calls = [], reads = [], uploads = [], removed = [], storage = new Map()
  const manifest = { id: id(6), optionId: item.id, sourceId: ref.fileId, fileName: source.file_name, fileSizeBytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), path: `${ctx.orgId}/${caseId}/choices/${id(6)}.pdf` }
  let saved = { revision: 2, option_files: [ref], shared_option_files: options.reuse ? [manifest] : [] }
  storage.set(`action-case-files/${source.file_path}`, options.badPdf ? Buffer.from('not a PDF') : bytes)
  if (options.reuse) storage.set(`${domain.CUSTOMER_OFFER_BUCKET}/${manifest.path}`, bytes)
  const db = {
    from(table) {
      const read = { table, filters: [] }; reads.push(read)
      const result = () => {
        if (options.uncertain && calls.some(c => c.name === 'write_customer_planning')) return { error: { message: 'network' } }
        if (table === 'action_case_customer_planning') return options.missing ? { error: { code: '42703' } } : { data: { ...saved, revision: options.stale ? 1 : saved.revision, shared_categories: [{}], participant_id: id(7) } }
        if (table === 'action_case_attachments') return { data: [{ ...source, ...options.source }] }
        if (table === 'action_case_work_quotes') return { data: options.privateQuote ? [{ document_id: source.id }] : [] }
        if (table === 'action_case_quote_requests') return { data: [] }
        if (table === 'action_cases') return { data: options.wrongCase ? null : { id: caseId } }
        throw Error(table)
      }
      const chain = { select(columns) { read.columns = columns; return chain }, eq(...filter) { read.filters.push(filter); return chain }, in(...filter) { read.filters.push(filter); return chain }, maybeSingle: async () => result(), then: done => Promise.resolve(result()).then(done) }
      return chain
    },
    async rpc(name, args) {
      calls.push({ name, ...args })
      if (name === 'assert_customer_choice_file_refs') return options.missing ? { error: { code: '42883' } } : { data: null }
      if (name === 'read_customer_choice_file') return options.revoked ? { error: { message: 'CUSTOMER_CHOICE_CLOSED' } } : { data: { orgId: ctx.orgId, caseId, file: manifest } }
      if (options.committed) saved.shared_option_files = args.p_data.sharedFiles
      if (options.writeFailed || options.uncertain || options.committed || options.pendingCommit) return { error: { code: options.writeFailed ? 'P0001' : 'transport', message: 'CUSTOMER_OFFER_STALE' } }
      if (args.p_operation === 'share') saved.shared_option_files = args.p_data.sharedFiles
      return { data: null }
    },
    storage: { from(bucket) { return {
      async download(path) { const value = storage.get(`${bucket}/${path}`); return value ? { data: new Blob([options.corruptCopy && bucket === domain.CUSTOMER_OFFER_BUCKET ? Buffer.from('bad') : value]) } : { error: { message: 'missing' } } },
      async upload(path, value, opts) { uploads.push({ bucket, path, opts }); storage.set(`${bucket}/${path}`, value); return options.uploadFailed ? { error: { message: 'failed' } } : { data: {} } },
      async remove(paths) { removed.push(...paths); paths.forEach(p => storage.delete(`${bucket}/${p}`)); return {} }
    } } }
  }
  const deps = { 'server-only': {}, 'node:crypto': crypto, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, '@/lib/assignments/tokens': { hashAssignmentToken: token => crypto.createHash('sha256').update(token).digest('hex') }, './customerOffers': domain, './customerPlanning': planning }
  deps['./customerSharingServer'] = { async requireCustomerSectionForToken() { if (options.hidden) throw Error('CUSTOMER_SHARING_HIDDEN') } }
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name] }, mod, mod.exports)
  const share = () => mod.exports.writeCustomerChoiceFiles(ctx, caseId, 'share', { revision: 2, items: [item], optionFiles: [ref], confirmed: true }, [item])
  return { ...mod.exports, share, calls, reads, uploads, removed, manifest }
}

test('sharing verifies actual PDF bytes, uploads an immutable copy and writes only independent planning', async () => {
  const h = harness(); await h.share()
  assert.equal(h.uploads.length, 1)
  assert.equal(h.uploads[0].bucket, domain.CUSTOMER_OFFER_BUCKET)
  assert.equal(h.uploads[0].opts.upsert, false)
  const write = h.calls.find(c => c.name === 'write_customer_planning')
  assert.equal(write.p_data.sharedFiles[0].sha256, crypto.createHash('sha256').update(bytes).digest('hex'))
  assert.equal(write.p_data.sharedFiles[0].sourceId, ref.fileId)
  assert.deepEqual(h.removed, [])
  for (const read of h.reads) { assert.ok(read.filters.some(([key, value]) => key === 'org_id' && value === ctx.orgId)); assert.ok(read.filters.some(([key, value]) => key === 'action_case_id' && value === caseId)) }
  assert.ok(h.calls.every(c => !/contract|offer|mail/.test(c.name)))
})

test('identical shared copies are reused without storage writes or changing their IDs', async () => {
  const h = harness({ reuse: true }); await h.share()
  assert.deepEqual(h.uploads, [])
  assert.deepEqual(h.calls.find(c => c.name === 'write_customer_planning').p_data.sharedFiles, [h.manifest])
})

test('non-PDF bytes, private quotes, wrong storage scopes and missing schema fail before a share', async () => {
  for (const options of [{ badPdf: true }, { privateQuote: true }, { source: { storage_bucket: 'other' } }, { source: { file_path: '../elsewhere' } }, { source: { file_size_bytes: bytes.length + 1 } }, { missing: true }, { stale: true }]) {
    const h = harness(options)
    await assert.rejects(h.share(), /CUSTOMER_(CHOICE|OFFER)_/)
    assert.equal(h.calls.some(c => c.name === 'write_customer_planning'), false)
    assert.deepEqual(h.uploads, [])
  }
})

test('failed writes clean up proven orphans but uncertain or committed shares retain copies', async () => {
  for (const options of [{ writeFailed: true }, { uploadFailed: true }, { corruptCopy: true }]) {
    const h = harness(options); await assert.rejects(h.share()); assert.equal(h.removed.length, 1)
  }
  for (const options of [{ uncertain: true }, { committed: true }, { pendingCommit: true }]) {
    const h = harness(options); await assert.rejects(h.share()); assert.deepEqual(h.removed, [])
  }
})

test('saving refs and private costing does not copy, grant, email or touch contracts', async () => {
  const h = harness()
  await h.writeCustomerChoiceFiles(ctx, caseId, 'save', { revision: 2, items: [item], optionFiles: [ref], costing: { [item.id]: {} } }, [item])
  assert.equal(h.calls.at(-1).name, 'save_customer_planning_costing')
  assert.deepEqual(h.uploads, []); assert.deepEqual(h.removed, [])
})

test('downloads check the link on every access, verify bytes and emit safe noncached filenames', async () => {
  const h = harness({ reuse: true })
  const file = await h.customerChoiceFile({ token: 'A'.repeat(43), fileId: id(6) })
  assert.deepEqual(file.bytes, bytes)
  assert.notEqual(h.calls[0].p_token_hash, 'A'.repeat(43))
  const response = h.customerChoiceFileResponse(file, true)
  assert.match(response.headers.get('content-disposition'), /^attachment;.*filename\*=UTF-8''F%C3%B6nster.pdf/)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  const revoked = harness({ revoked: true }); await assert.rejects(revoked.customerChoiceFile({ token: 'A'.repeat(43), fileId: id(6) }), /CLOSED/)
  const corrupt = harness({ reuse: true, corruptCopy: true }); await assert.rejects(corrupt.customerChoiceFile({ token: 'A'.repeat(43), fileId: id(6) }), /FILES/)
  const wrong = harness({ wrongCase: true }); await assert.rejects(wrong.customerChoiceFile({ ctx, caseId, fileId: id(6) }), /NOT_FOUND/)
})

test('hidden choices deny an old direct PDF link before file RPC or storage access', async () => {
  const h = harness({ hidden: true, reuse: true })
  await assert.rejects(h.customerChoiceFile({ token: 'A'.repeat(43), fileId: id(6) }), /SHARING_HIDDEN/)
  assert.deepEqual(h.calls, []); assert.deepEqual(h.reads, [])
})
