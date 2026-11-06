import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import * as crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import sharp from 'sharp'
import * as domain from '../src/lib/action-cases/projectDiary.ts'
import * as links from '../src/lib/action-cases/projectDiaryLinks.ts'
import { uploadDiaryPhoto } from '../src/lib/action-cases/projectDiaryUpload.ts'
import { validateDiaryImage } from '../src/lib/action-cases/projectDiaryImage.ts'

const json = (body, status = 200) => Response.json(body, { status })
const size = domain.DIARY_PHOTO_PART_BYTES
function load(path, deps) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const m = { exports: {} }; new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name] }, m, m.exports); return m.exports
}
const photo = bytes => ({ id: randomUUID(), name: 'test.jpg', size: bytes.length, contentType: 'image/jpeg', file: new Blob([bytes], { type: 'image/jpeg' }) })

test('blocked direct storage upload falls back to bounded same-origin parts with identical original bytes', async () => {
  const bytes = Buffer.alloc(size * 2 + 700, 47), input = photo(bytes), calls = [], parts = [], progress = []
  const fetcher = async (url, options) => {
    calls.push(String(url))
    if (options.method === 'PUT') { assert.equal(options.body instanceof Blob, true); assert.equal(options.body instanceof File, false); throw new TypeError('Failed to fetch') }
    if (String(url).includes('/parts/')) {
      const index = Number(String(url).split('/').at(-1)), value = Buffer.from(await options.body.arrayBuffer())
      assert.ok(value.length <= size); assert.equal(options.headers['Content-Type'], 'application/octet-stream')
      parts[index] = value; return json({ id: input.id, part: index })
    }
    const data = JSON.parse(options.body)
    assert.equal(data.id, input.id)
    if (data.operation === 'prepare') return json({ id: input.id, ready: false, uploadUrl: 'https://storage.invalid/one-use-url' })
    if (data.operation === 'complete') return json({ code: 'PROJECT_DIARY_PHOTO', error: 'Bilden saknas.' }, 400)
    assert.equal(data.operation, 'complete_relay'); assert.deepEqual(Buffer.concat(parts), bytes)
    return json({ id: input.id })
  }
  await uploadDiaryPhoto({ endpoint: '/api/dagbok/test', photo: input, signal: new AbortController().signal, fetcher, onProgress: text => progress.push(text) })
  assert.equal(parts.length, 3); assert.ok(progress.includes('Laddar upp via Hushub · 3/3'))
  assert.ok(calls.every(url => url.includes('/photos') || url === 'https://storage.invalid/one-use-url'))
  assert.deepEqual(Buffer.from(await input.file.arrayBuffer()), bytes)
})

test('a committed direct upload with a lost response is completed without another transfer', async () => {
  const input = photo(Buffer.from('test')), operations = []
  await uploadDiaryPhoto({ endpoint: '/api/dagbok/test', photo: input, signal: new AbortController().signal, fetcher: async (_url, options) => {
    if (options.method === 'PUT') throw new TypeError('Failed to fetch')
    const data = JSON.parse(options.body); operations.push(data.operation)
    return json(data.operation === 'prepare' ? { id: input.id, ready: false, uploadUrl: 'https://storage.invalid/upload' } : { id: input.id })
  } })
  assert.deepEqual(operations, ['prepare', 'complete'])
})

test('lost relay acknowledgement retries the same photo ID and does not send the diary entry', async () => {
  const input = photo(Buffer.alloc(100)), ids = []; let sealed = false, first = true
  const fetcher = async (url, options) => {
    if (options.method === 'PUT') throw new TypeError('Failed to fetch')
    if (String(url).includes('/parts/')) return json({ id: input.id, part: 0 })
    const data = JSON.parse(options.body); ids.push(data.id)
    if (data.operation === 'prepare') return json({ id: input.id, ready: sealed, uploadUrl: 'https://storage.invalid/upload' })
    if (data.operation === 'complete') return json({ error: 'Saknas' }, 400)
    assert.equal(data.operation, 'complete_relay'); sealed = true
    if (first) { first = false; throw new TypeError('Failed to fetch') }
    return json({ id: input.id })
  }
  const options = { endpoint: '/api/dagbok/test', photo: input, signal: new AbortController().signal, fetcher }
  await assert.rejects(uploadDiaryPhoto(options), /Anslutningen avbröts.*Texten finns kvar/)
  await uploadDiaryPhoto(options)
  assert.ok(ids.every(id => id === input.id))
})

test('abort never starts a fallback and an unreadable gallery file has an actionable Swedish error', async () => {
  const controller = new AbortController(), input = photo(Buffer.alloc(20)); let calls = 0
  controller.abort()
  await assert.rejects(uploadDiaryPhoto({ endpoint: '/api/dagbok/test', photo: input, signal: controller.signal, fetcher: async () => { calls++; throw Error() } }))
  assert.equal(calls, 0)
  input.file = { async arrayBuffer() { throw new DOMException('File changed', 'NotReadableError') } }
  await assert.rejects(uploadDiaryPhoto({ endpoint: '/api/dagbok/test', photo: input, signal: new AbortController().signal, fetcher: async () => json({ id: input.id, uploadUrl: 'https://storage.invalid/upload' }) }), /Bilden kunde inte läsas från telefonen/)
})

test('timed out direct transfer uses the fallback, but authorization failures stop it', async () => {
  const input = photo(Buffer.alloc(20)); let transferred = 0
  const fetcher = async (url, options) => {
    if (options.method === 'PUT') return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), { once: true }))
    if (String(url).includes('/parts/')) { transferred++; return json({ id: input.id, part: 0 }) }
    const data = JSON.parse(options.body)
    return json(data.operation === 'prepare' ? { id: input.id, uploadUrl: 'https://storage.invalid/upload' } : data.operation === 'complete' ? { error: 'Saknas' } : { id: input.id }, data.operation === 'complete' ? 400 : 200)
  }
  await uploadDiaryPhoto({ endpoint: '/api/dagbok/test', photo: input, signal: new AbortController().signal, fetcher, timeoutMs: 5 })
  assert.equal(transferred, 1)
  await assert.rejects(uploadDiaryPhoto({ endpoint: '/api/dagbok/test', photo: input, signal: new AbortController().signal, fetcher: async (_url, options) => {
    if (options.method === 'PUT') throw new TypeError('Failed to fetch')
    const data = JSON.parse(options.body)
    return data.operation === 'prepare' ? json({ id: input.id, uploadUrl: 'https://storage.invalid/upload' }) : json({ error: 'Länken är stängd.' }, 403)
  } }), /Länken är stängd/)
})

async function fixture() {
  const orgId = randomUUID(), caseId = randomUUID(), userId = randomUUID(), fileId = randomUUID(), calls = [], objects = new Map()
  const tiny = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#f2d76a' } }).jpeg().toBuffer()
  const bytes = Buffer.concat([tiny, Buffer.alloc(size * 2 + 31 - tiny.length)])
  const upload = { id: fileId, org_id: orgId, action_case_id: caseId, owner_key: `profile:${userId}`, name: 'test.jpg', content_type: 'image/jpeg', size_bytes: bytes.length, state: 'pending', expires_at: new Date(Date.now() + 60000).toISOString() }
  let failSeal = false
  const db = {
    from(table) {
      assert.ok(['action_cases', 'org_members', 'action_case_diary_uploads'].includes(table))
      const filters = [], q = { select() { return q }, eq(key, value) { filters.push([key, value]); return q }, async maybeSingle() {
        if (table === 'action_cases') return { data: { id: caseId, org_id: orgId } }
        if (table === 'org_members') return { data: { profile_id: userId } }
        calls.push(['lookup', filters]); return { data: filters.every(([key, value]) => upload[key] === value) ? { ...upload } : null }
      } }; return q
    },
    async rpc(name, args) {
      assert.equal(name, 'project_diary_people_command'); assert.equal(args.p_operation, 'seal_photo')
      calls.push(['seal', args.p_data]); upload.state = 'ready'
      return failSeal ? { error: { message: 'PROJECT_DIARY_FAILED' } } : { data: { id: fileId, name: upload.name } }
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'project-diary-files')
      return {
        async upload(path, value, options) { assert.equal(options.upsert, false); assert.equal(options.contentType, upload.content_type); if (objects.has(path)) return { error: {} }; objects.set(path, Buffer.from(value)); calls.push(['upload', path]); return {} },
        async download(path) { return objects.has(path) ? { data: new Blob([objects.get(path)]) } : { error: {} } },
        async remove(paths) { paths.forEach(path => objects.delete(path)); return {} },
      }
    } },
  }
  const server = load('../src/lib/action-cases/projectDiaryServer.ts', { 'server-only': {}, 'node:crypto': crypto, qrcode: {}, './projectDiaryImage': { validateDiaryImage }, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, './projectDiary': domain, './projectDiaryLinks': links })
  const identity = { ctx: { orgId, userId }, caseId }, prefix = `${orgId}/${caseId}`
  const part = index => bytes.subarray(index * size, Math.min(bytes.length, (index + 1) * size))
  return { server, identity, fileId, bytes, upload, calls, objects, prefix, part, failNextSeal() { failSeal = true } }
}

test('relay archives byte-identical original only after all scoped, bounded parts are present', async () => {
  const f = await fixture()
  await f.server.storeDiaryPhotoPart(f.identity, f.fileId, 0, f.part(0))
  await assert.rejects(f.server.completeRelayedDiaryPhoto(f.identity, f.fileId), /PROJECT_DIARY_UPLOAD/)
  assert.equal(f.calls.some(call => call[0] === 'seal'), false)
  await f.server.storeDiaryPhotoPart(f.identity, f.fileId, 0, f.part(0))
  assert.equal(f.objects.size, 1)
  await f.server.storeDiaryPhotoPart(f.identity, f.fileId, 2, f.part(2))
  await f.server.storeDiaryPhotoPart(f.identity, f.fileId, 1, f.part(1))
  const result = await f.server.completeRelayedDiaryPhoto(f.identity, f.fileId)
  assert.equal(result.id, f.fileId)
  assert.deepEqual(f.objects.get(`${f.prefix}/images/${f.fileId}`), f.bytes)
  assert.equal(f.objects.size, 1)
  assert.equal(f.calls.find(call => call[0] === 'seal')[1].sha256, createHash('sha256').update(f.bytes).digest('hex'))
})

test('relay rejects another owner/project, expired uploads, conflicting retries and wrong part sizes', async () => {
  const f = await fixture()
  for (const index of [-1, 0.5, 3, 4]) await assert.rejects(f.server.storeDiaryPhotoPart(f.identity, f.fileId, index, Buffer.alloc(1)), /PROJECT_DIARY_PHOTO/)
  await assert.rejects(f.server.storeDiaryPhotoPart(f.identity, f.fileId, 0, Buffer.alloc(size - 1)), /PROJECT_DIARY_PHOTO/)
  const owner = f.upload.owner_key; f.upload.owner_key = `profile:${randomUUID()}`
  await assert.rejects(f.server.storeDiaryPhotoPart(f.identity, f.fileId, 0, f.part(0)), /PROJECT_DIARY_PHOTO/)
  f.upload.owner_key = owner
  await assert.rejects(f.server.completeRelayedDiaryPhoto({ ...f.identity, caseId: randomUUID() }, f.fileId), /PROJECT_DIARY_PHOTO/)
  f.upload.expires_at = new Date(Date.now() - 1).toISOString()
  await assert.rejects(f.server.storeDiaryPhotoPart(f.identity, f.fileId, 0, f.part(0)), /PROJECT_DIARY_PHOTO/)
  f.upload.expires_at = new Date(Date.now() + 60000).toISOString()
  await f.server.storeDiaryPhotoPart(f.identity, f.fileId, 0, f.part(0))
  await assert.rejects(f.server.storeDiaryPhotoPart(f.identity, f.fileId, 0, Buffer.alloc(size, 1)), /PROJECT_DIARY_UPLOAD/)
  assert.deepEqual(f.objects.get(`${f.prefix}/incoming/${f.fileId}.part-0`), f.part(0))
})

test('corrupt staged bytes never become an archived image, and an ambiguous seal preserves originals for safe retry', async () => {
  const corrupt = await fixture()
  for (let i = 0; i < 3; i++) await corrupt.server.storeDiaryPhotoPart(corrupt.identity, corrupt.fileId, i, Buffer.alloc(corrupt.part(i).length, 1))
  await assert.rejects(corrupt.server.completeRelayedDiaryPhoto(corrupt.identity, corrupt.fileId), /PROJECT_DIARY_PHOTO/)
  assert.equal(corrupt.objects.has(`${corrupt.prefix}/images/${corrupt.fileId}`), false)
  const f = await fixture()
  for (let i = 0; i < 3; i++) await f.server.storeDiaryPhotoPart(f.identity, f.fileId, i, f.part(i))
  f.failNextSeal()
  await assert.rejects(f.server.completeRelayedDiaryPhoto(f.identity, f.fileId), /PROJECT_DIARY_FAILED/)
  assert.equal(f.objects.size, 4)
  assert.equal((await f.server.completeRelayedDiaryPhoto(f.identity, f.fileId)).id, f.fileId)
  assert.equal(f.objects.size, 1); assert.equal(f.calls.filter(c => c[0] === 'seal').length, 1)
})

test('same-origin relay body is bounded even without Content-Length and rejects empty or cross-origin payloads', async () => {
  const http = load('../src/lib/action-cases/projectDiaryHttp.ts', { 'next/server': {}, '@/lib/assignments/tokens': {}, './projectDiaryLinks': links, './projectDiary': domain })
  const request = (body, origin = 'https://hushub.se') => new Request('https://hushub.se/api/dagbok/test/photos/id/parts/0', { method: 'POST', headers: { origin, 'content-type': 'application/octet-stream' }, body })
  assert.equal((await http.diaryPhotoPartBody(request(Buffer.alloc(size)))).length, size)
  await assert.rejects(http.diaryPhotoPartBody(request(Buffer.alloc(size + 1))), /PROJECT_DIARY_TOO_LARGE/)
  await assert.rejects(http.diaryPhotoPartBody(request(Buffer.alloc(0))), /PROJECT_DIARY_PHOTO/)
  await assert.rejects(http.diaryPhotoPartBody(request(Buffer.alloc(1), 'https://other.invalid')), /PROJECT_DIARY_ORIGIN/)
})

test('QR relay routes use the existing device cookie and never accept an owner from the body', async () => {
  const calls = [], input = Buffer.from('bounded part'), token = 'existing-qr-link', photoId = randomUUID()
  const http = {
    diaryJson: body => ({ status: 200, body }), diaryError: e => ({ status: 400, error: e.message }),
    diaryRequestCookie: (_request, value) => { assert.equal(value, token); return 'existing-device-cookie' },
    diaryPhotoPartBody: async () => input,
  }
  const route = load('../src/app/api/dagbok/[token]/photos/[photoId]/parts/[part]/route.ts', {
    '@/lib/action-cases/projectDiaryHttp': http,
    '@/lib/action-cases/projectDiaryServer': { storeDiaryPhotoPart: async (...args) => { calls.push(args); return { id: photoId, part: 1 } } },
  })
  const request = new Request('https://hushub.se/api/dagbok/test/photos/id/parts/1', { method: 'POST', body: input })
  const result = await route.POST(request, { params: Promise.resolve({ token, photoId, part: '1' }) })
  assert.equal(result.status, 200)
  assert.deepEqual(calls, [[{ token, device: 'existing-device-cookie' }, photoId, 1, input]])
  for (const part of ['-1', '4', '01', '../1', '1.0']) assert.equal((await route.POST(request, { params: Promise.resolve({ token, photoId, part }) })).status, 400)
  assert.equal(calls.length, 1)
})

test('internal relay routes require authenticated module context before reading or accepting photo bytes', async () => {
  let denied = true, reads = 0, writes = 0
  const ctx = { orgId: randomUUID(), userId: randomUUID() }, caseId = randomUUID(), photoId = randomUUID()
  const route = load('../src/app/api/action-cases/[caseId]/diary/photos/[photoId]/parts/[part]/route.ts', {
    '@/lib/action-cases/customerOffersHttp': { customerOfferContext: async () => { if (denied) throw Error('MODULE_ACCESS_REQUIRED'); return ctx } },
    '@/lib/action-cases/projectDiaryHttp': { diaryJson: body => body, diaryError: e => ({ error: e.message }), diaryPhotoPartBody: async () => { reads++; return Buffer.from('part') } },
    '@/lib/action-cases/projectDiaryServer': { storeDiaryPhotoPart: async (...args) => { writes++; assert.deepEqual(args[0], { ctx, caseId }); return { id: photoId, part: 0 } } },
  })
  const args = [new Request('https://hushub.se/api/test', { method: 'POST' }), { params: Promise.resolve({ caseId, photoId, part: '0' }) }]
  assert.equal((await route.POST(...args)).error, 'MODULE_ACCESS_REQUIRED'); assert.equal(reads, 0); assert.equal(writes, 0)
  denied = false; assert.equal((await route.POST(...args)).id, photoId); assert.equal(reads, 1); assert.equal(writes, 1)
})
