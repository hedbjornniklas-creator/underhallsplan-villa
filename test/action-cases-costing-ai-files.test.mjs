import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import sharp from 'sharp'

const mod = { exports: {} }
const code = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/costingAiFiles.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
new Function('module', 'exports', 'require', code)(mod, mod.exports, (name) => name === 'sharp' ? sharp : {})
const base = { org_id: 'org', action_case_id: 'case', action_case_item_id: 'item', attachment_type: 'document', file_name: 'scope.pdf', title: null, content_type: 'application/pdf', file_size_bytes: 12, storage_bucket: 'action-case-files' }
const file = (id, changes = {}) => ({ ...base, id, file_path: `org/case/${id}`, ...changes })
function harness(files, data = Buffer.from('%PDF-1.7 TEST'), downloadError = false) {
  const downloads = [], filters = []
  const admin = { from(table) {
    assert.equal(table, 'action_case_attachments')
    let rows = files
    const chain = { select(columns) {
      const schema = readFileSync(new URL('../docs/db/2026-09-08_02_action_case_files_and_participants.sql', import.meta.url), 'utf8')
      for (const column of columns.split(',')) assert.match(schema, new RegExp(`\\b${column}\\s+\\w+`))
      return chain
    }, eq(key, value) { filters.push([key, value]); rows = rows.filter((r) => r[key] === value); return chain }, in(key, values) { rows = rows.filter((r) => values.includes(r[key])); return chain }, order() { return chain }, limit(n) { return Promise.resolve({ data: rows.slice(0, n), error: null }) } }
    return chain
  }, storage: {
    from(bucket) {
      return { download: async (path) => {
        downloads.push([bucket, path])
        return { data: new Blob([data]), error: downloadError ? {} : null }
      } }
    },
  } }
  return { downloads, filters, load: (selected) => mod.exports.loadCostingAiFiles(admin, { orgId: 'org', caseId: 'case' }, { id: 'item', scope_attachment_ids: selected }) }
}
test('selected document bytes are sent, unrelated files are never downloaded', async () => {
  const h = harness([file('yes'), file('no')])
  const content = await h.load(['yes'])
  assert.deepEqual(h.downloads, [['action-case-files', 'org/case/yes']])
  assert.equal(content[1].file_data, `data:application/pdf;base64,${Buffer.from('%PDF-1.7 TEST').toString('base64')}`)
  assert.deepEqual(h.filters, [['org_id', 'org'], ['action_case_id', 'case']])
  assert.equal((await h.load([])).length, 0)
})
test('images use decoded, resized pixel content and private file identifiers', async () => {
  const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: 'red' } }).png().toBuffer()
  const h = harness([file('image', { attachment_type: 'image', file_name: 'photo.png', content_type: 'image/png' })], png)
  const content = await h.load(['image'])
  const metadata = await sharp(Buffer.from(content[1].image_url.split(',')[1], 'base64')).metadata()
  assert.equal(content[1].detail, 'high'); assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.width, 1600)
  assert.match(content[0].text, /image/)
})
test('legacy item files still load, but cross-tenant, cross-case, missing, wrong paths and unreadable files fail closed', async () => {
  const legacy = harness([file('yes'), file('no', { action_case_item_id: 'other' })])
  await legacy.load(null); assert.equal(legacy.downloads.length, 1)
  for (const change of [{ org_id: 'other' }, { action_case_id: 'other' }, { file_path: 'other/case/id' }, { storage_bucket: 'other' }]) {
    const h = harness([file('bad', change)])
    await assert.rejects(h.load(['bad']), /FILE_UNREADABLE/); assert.equal(h.downloads.length, 0)
  }
  await assert.rejects(harness([]).load(['missing']), /FILE_UNREADABLE/)
  await assert.rejects(harness([file('bad')], Buffer.from('x'), true).load(['bad']), /FILE_UNREADABLE/)
  await assert.rejects(harness([file('bad', { attachment_type: 'image' })]).load(['bad']), /FILE_UNREADABLE/)
})
test('size/count limits fail before download and every supported document format sends bytes', async () => {
  const many = harness(Array.from({ length: 21 }, (_, n) => file(String(n))))
  await assert.rejects(many.load(null), /FILES_TOO_LARGE/); assert.equal(many.downloads.length, 0)
  const large = harness([file('big', { file_size_bytes: 26 * 1024 * 1024 })])
  await assert.rejects(large.load(['big']), /FILES_TOO_LARGE/); assert.equal(large.downloads.length, 0)
  for (const content_type of ['text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) {
    const content = await harness([file('doc', { content_type })]).load(['doc'])
    assert.ok(content[1].file_data.startsWith(`data:${content_type};base64,`))
  }
})
