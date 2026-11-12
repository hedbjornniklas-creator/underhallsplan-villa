import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import * as domain from '../src/lib/action-cases/projectDiary.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ctx = { orgId: id(1), userId: id(2) }, caseId = id(3), questionId = id(4)
function load(path, deps) {
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', code)(key => { assert.ok(key in deps, key); return deps[key] }, module, module.exports)
  return module.exports
}
const library = load('../src/lib/action-cases/projectImageLibrary.ts', { './attachmentImages': load('../src/lib/action-cases/attachmentImages.ts', {}) })
const entry = n => ({ id: id(n), current_body: { name: 'Testperson', company: 'Testbygg', itemId: id(8), text: 'Private diary body must not leave the server' }, current_item_title: 'Hall', current_work_date: '2026-11-01', received_at: '2026-11-01T17:00:00Z', current_photo_ids: [id(n + 100)] })
const photo = e => ({ id: e.current_photo_ids[0], entry_id: e.id, name: 'hall.jpg', content_type: 'image/jpeg', size_bytes: 12, sha256: 'a'.repeat(64) })
function diaryFixture(entries = [entry(10)]) {
  const calls = [], state = { entries, photos: entries.map(photo), member: true, project: true, failure: null }
  const db = { from(table) {
    const filters = [], call = { table, filters }; calls.push(call)
    const result = () => {
      if (table === 'action_cases') return { data: state.project ? { id: caseId } : null }
      if (table === 'org_members') return { data: state.member ? { profile_id: ctx.userId } : null }
      if (state.failure) return { error: state.failure }
      const rows = table === 'action_case_diary_current' ? state.entries : state.photos
      return { data: rows.filter(row => filters.every(([op, key, val]) => key in row ? op === 'eq' ? row[key] === val : op === 'in' ? val.includes(row[key]) : true : true)) }
    }
    const q = { select(value) { call.select = value; return q }, eq(key, val) { filters.push(['eq', key, val]); return q }, in(key, val) { filters.push(['in', key, val]); return q }, neq(key, val) { filters.push(['neq', key, val]); return q }, or(value) { call.or = value; return q }, order() { return q }, limit(n) { call.limit = n; return q }, async maybeSingle() { const r = result(); return { ...r, data: Array.isArray(r.data) ? r.data[0] || null : r.data } }, then(resolve) { return Promise.resolve(result()).then(resolve) } }
    return q
  } }
  const server = load('../src/lib/action-cases/projectDiaryServer.ts', { 'server-only': {}, 'node:crypto': crypto, qrcode: {}, './projectDiaryImage': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, './projectDiary': domain, './projectDiaryLinks': {} })
  return { server, calls, state }
}
test('library reads current manifests only, preserves their order and returns no diary text or upload credentials', async () => {
  const e = entry(10), f = diaryFixture([e]); e.current_photo_ids.push(id(111)); f.state.photos.unshift({ ...photo(e), id: id(111) }, { ...photo(e), id: id(999) })
  const result = await f.server.getDiaryImages(ctx, caseId)
  assert.deepEqual(result.images.map(p => p.id), e.current_photo_ids)
  assert.equal(result.images[0].personName, 'Testperson'); assert.equal(result.images[0].itemTitle, 'Hall')
  assert.equal(JSON.stringify(result).includes('Private diary body'), false)
  assert.equal(result.nextCursor, null)
  const current = f.calls.find(c => c.table === 'action_case_diary_current')
  assert.ok(current.filters.some(f => f[1] === 'org_id' && f[2] === ctx.orgId))
  assert.ok(current.filters.some(f => f[1] === 'action_case_id' && f[2] === caseId))
  assert.equal(f.calls.some(c => /uploads|links|revisions/.test(c.table)), false)
})
test('library authenticates membership and project before reading images', async () => {
  for (const field of ['member', 'project']) {
    const f = diaryFixture(); f.state[field] = false
    await assert.rejects(f.server.getDiaryImages(ctx, caseId), /NOT_FOUND/)
    assert.equal(f.calls.some(c => c.table === 'action_case_diary_current'), false)
  }
})
test('library pages ten entries and batches a 200-image manifest into bounded metadata requests', async () => {
  const entries = Array.from({ length: 11 }, (_, n) => entry(n + 10)), f = diaryFixture(entries)
  for (let n = 0; n < 10; n++) entries[n].current_photo_ids = Array.from({ length: 20 }, (_, i) => id(1000 + n * 20 + i))
  f.state.photos = entries.flatMap(e => e.current_photo_ids.map(p => ({ ...photo(e), id: p })))
  const page = await f.server.getDiaryImages(ctx, caseId)
  assert.equal(page.images.length, 200); assert.ok(page.nextCursor)
  const queries = f.calls.filter(c => c.table === 'action_case_diary_photos')
  assert.equal(queries.length, 2)
  for (const q of queries) assert.ok(q.filters.find(f => f[1] === 'id')[2].length <= 100)
  await f.server.getDiaryImages(ctx, caseId, page.nextCursor)
  assert.match(f.calls.filter(c => c.table === 'action_case_diary_current').at(-1).or, /id.lt/)
})
test('bad cursors and inconsistent manifests fail without exposing orphan photos', async () => {
  const f = diaryFixture()
  for (const c of ['invalid!', 'a'.repeat(513), Buffer.from(JSON.stringify({ date: '2026-11-01', id: id(4), stamp: 'x),id.gt.0' })).toString('base64url')]) await assert.rejects(f.server.getDiaryImages(ctx, caseId, c), /DIARY_INVALID/)
  f.state.photos = []
  await assert.rejects(f.server.getDiaryImages(ctx, caseId), /DIARY_PHOTO/)
})
test('single-image lookup rejects removed photos and photos belonging to another project', async () => {
  const f = diaryFixture(), p = f.state.photos[0]
  assert.equal((await f.server.getCurrentDiaryImage(ctx, caseId, p.id)).id, p.id)
  f.state.entries[0].current_photo_ids = []
  await assert.rejects(f.server.getCurrentDiaryImage(ctx, caseId, p.id), /NOT_FOUND/)
  f.state.entries = []
  await assert.rejects(f.server.getCurrentDiaryImage(ctx, caseId, p.id), /NOT_FOUND/)
})
test('mixed image library namespaces diary ids without changing project grants or creating attachments', () => {
  const attachment = { id: id(10), type: 'image', grantedParticipantIds: [id(2)], fileName: 'project.jpg' }
  const diary = { id: id(10), name: 'diary.jpg', contentType: 'image/jpeg', size: 12, workDate: '2026-11-01', personName: 'Anna', company: 'Bygg', itemTitle: 'Hall' }
  const images = library.projectLibraryImages(caseId, [attachment, { id: id(11), type: 'document', fileName: 'doc.pdf' }], [diary])
  assert.equal(images.length, 2); assert.notEqual(images[0].id, images[1].id)
  assert.deepEqual(images[0].grantedParticipantIds, [id(2)]); assert.deepEqual(images[1].grantedParticipantIds, [])
  assert.match(images[1].url, /\/diary\/photos\//); assert.match(images[1].caption, /Anna.*Bygg.*Hall/)
  assert.equal(attachment.source, undefined)
})

function copyFixture() {
  const calls = [], bytes = Buffer.from('photo bytes'), state = { allowed: true, closed: false, attachment: null, source: true, uploadError: false, registerError: false, registeredDespiteError: false, corrupt: false }
  const image = { id: id(110), name: 'hall.jpg', contentType: 'image/jpeg', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), workDate: '2026-11-01', personName: 'Test', company: 'Bygg', itemTitle: 'Hall' }
  const db = { from(table) {
    const q = { select() { return q }, eq(...filter) { calls.push([table, ...filter]); return q }, in(...filter) { calls.push([table, ...filter]); return q }, async maybeSingle() { return { data: table === 'action_case_questions' ? { body: { status: state.closed ? 'closed' : 'open' } } : state.attachment } } }; return q
  }, storage: { from(bucket) { return { async download(path) { calls.push(['download', bucket, path]); return { data: new Blob([state.corrupt ? 'wrong' : bytes]) } }, async upload(path, value, options) { calls.push(['upload', bucket, path, value, options]); return { error: state.uploadError ? { message: 'existing' } : null } } } } } }
  const server = load('../src/lib/action-cases/questionDiaryImagesServer.ts', { 'server-only': {}, 'node:crypto': crypto, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, './projectDiary': domain, './projectImageLibrary': library, './questionDialogueServer': { async requireQuestionParticipant(...args) { calls.push(['auth', ...args]); if (!state.allowed) throw Error('PROJECT_QUESTION_NOT_FOUND') } }, './projectDiaryServer': { DIARY_BUCKET: 'project-diary-files', async getCurrentDiaryImage(...args) { calls.push(['current', ...args]); if (!state.source) throw Error('PROJECT_DIARY_NOT_FOUND'); return image } }, './server': { async completeActionCaseUpload(context, value) {
    calls.push(['register', context, value]); if (!state.registerError || state.registeredDespiteError) state.attachment = { id: id(400), file_name: value.fileName, title: value.title, content_type: value.contentType, file_size_bytes: value.fileSize }
    if (state.registerError) throw Error('PROJECT_QUESTION_FAILED')
  } } })
  return { server, calls, state, image }
}
test('selected photo becomes a question-private snapshot without a project grant, mail, or original mutation', async () => {
  const f = copyFixture(), result = await f.server.attachDiaryImageToQuestion(ctx, caseId, questionId, f.image.id)
  assert.equal(result.id, id(400)); assert.deepEqual(result.grantedParticipantIds, [])
  const copy = f.calls.find(c => c[0] === 'upload'), register = f.calls.find(c => c[0] === 'register')
  assert.equal(copy[1], 'project-question-files'); assert.equal(copy[4].upsert, false)
  assert.match(copy[2], new RegExp(`/questions/${questionId}/diary-`))
  assert.equal(register[2].questionId, questionId); assert.deepEqual(register[2].participantIds, [])
  assert.equal(f.calls.filter(c => c[0] === 'upload').length, 1)
  const retry = await f.server.attachDiaryImageToQuestion(ctx, caseId, questionId, f.image.id)
  assert.equal(retry.id, result.id); assert.equal(f.calls.filter(c => c[0] === 'upload').length, 1)
})
test('question permission and closed-state checks precede any original read or transfer', async () => {
  for (const field of ['allowed', 'closed']) {
    const f = copyFixture(); f.state[field] = field === 'closed'
    await assert.rejects(f.server.attachDiaryImageToQuestion(ctx, caseId, questionId, f.image.id), /QUESTION_(NOT_FOUND|CLOSED)/)
    assert.equal(f.calls.some(c => ['current', 'upload', 'download'].includes(c[0])), false)
  }
})
test('copy retries recover an existing byte-identical destination or an acknowledged registration after response loss', async () => {
  for (const field of ['uploadError', 'registeredDespiteError']) {
    const f = copyFixture(); f.state[field] = true; if (field === 'registeredDespiteError') f.state.registerError = true
    assert.equal((await f.server.attachDiaryImageToQuestion(ctx, caseId, questionId, f.image.id)).id, id(400))
  }
})
test('removed originals, altered bytes and failed registration produce no sharing or deletion', async () => {
  for (const field of ['source', 'corrupt', 'registerError']) {
    const f = copyFixture(); f.state[field] = field !== 'source'
    await assert.rejects(f.server.attachDiaryImageToQuestion(ctx, caseId, questionId, f.image.id), /PROJECT_/)
    assert.equal(f.calls.some(c => c[0] === 'remove' || /send|share|mail/.test(c[0])), false)
  }
})
test('diary picker is internal only and uses the established grid and full-screen image viewer', () => {
  const picker = readFileSync(new URL('../src/components/tasks/QuestionDiaryImagePicker.tsx', import.meta.url), 'utf8')
  const dialogue = readFileSync(new URL('../src/components/tasks/QuestionDialogue.tsx', import.meta.url), 'utf8')
  assert.match(picker, /ActionCaseAttachmentPicker/); assert.match(picker, /selectionLimit=\{remaining\}/)
  assert.match(dialogue, /!publicView && project/); assert.match(dialogue, /audience !== 'responsible' && diaryPicker/)
  assert.doesNotMatch(picker, /operation: 'share'|operation: 'reply'/)
})

test('copy endpoint requires module context and same-origin JSON before handling the chosen photo', async () => {
  const calls = []; let authenticated = true
  const route = load('../src/app/api/action-cases/[caseId]/questions/[questionId]/diary-photos/route.ts', {
    '@/lib/action-cases/customerOffersHttp': { async customerOfferContext() { if (!authenticated) throw Error('NO_ACCESS'); return ctx }, customerOfferError: e => ({ status: 403, error: e.message }) },
    '@/lib/action-cases/projectDiaryHttp': { diaryJson: body => ({ body }), diaryError: e => ({ status: 400, error: e.message }), async diaryRequestBody(req) { if (req.headers.get('origin') !== new URL(req.url).origin) throw Error('PROJECT_DIARY_ORIGIN'); return req.json() } },
    '@/lib/action-cases/questionDiaryImagesServer': { async attachDiaryImageToQuestion(...args) { calls.push(args); return { id: id(500) } } },
  })
  const req = origin => new Request(`https://hushub.se/api/action-cases/${caseId}/questions/${questionId}/diary-photos`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ photoId: id(110), participantIds: [id(999)] }) })
  const params = { params: Promise.resolve({ caseId, questionId }) }
  assert.equal((await route.POST(req('https://other.invalid'), params)).status, 400); assert.equal(calls.length, 0)
  authenticated = false
  assert.equal((await route.POST(req('https://hushub.se'), params)).status, 403); assert.equal(calls.length, 0)
  authenticated = true
  assert.equal((await route.POST(req('https://hushub.se'), params)).body.file.id, id(500))
  assert.deepEqual(calls[0], [ctx, caseId, questionId, id(110)])
  assert.equal(route.GET, undefined)
})
