import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import sharp from 'sharp'
import * as crypto from 'node:crypto'
import * as domain from '../src/lib/action-cases/projectDiary.ts'
import * as links from '../src/lib/action-cases/projectDiaryLinks.ts'
import { validateDiaryImage } from '../src/lib/action-cases/projectDiaryImage.ts'

const id = () => randomUUID(), key = 'fictitious-diary-test-secret-not-a-live-credential'
const body = () => ({ ...domain.emptyDiaryBody('Testperson', 'Testbygg'), workDate: '2026-01-02', startTime: '07:00', endTime: '16:00', breakMinutes: 60, text: 'Montering i fiktivt projekt.' })
function load(path, deps) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const m = { exports: {} }; new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name] }, m, m.exports); return m.exports
}
test('normalization distinguishes work date, real calendar dates, same-day working time and zero breaks', () => {
  assert.equal(domain.diaryMinutes(body()), 480)
  assert.equal(domain.diaryMinutes({ ...body(), breakMinutes: 0 }), 540)
  assert.equal(domain.diaryToday(new Date('2026-11-03T23:30:00Z')), '2026-11-04')
  for (const patch of [{ workDate: '2026-02-30' }, { workDate: '2099-01-01' }, { endTime: '06:00' }, { breakMinutes: 540 }, { breakMinutes: 0.5 }, { text: '' }, { company: '' }, { amount: 123 }]) assert.throws(() => domain.normalizeDiaryBody({ ...body(), ...patch }))
  assert.deepEqual(domain.diaryPersonInput({ name: ' Anna   Exempel ', company: ' Testbygg AB ' }), { name: 'Anna Exempel', company: 'Testbygg AB' })
  assert.throws(() => domain.diaryPersonEntryRequest({ requestId: id(), body: body(), photoIds: [] }), /DIARY_PERSON/)
  const photo = id()
  assert.throws(() => domain.diaryEntryRequest({ requestId: id(), body: body(), photoIds: [photo, photo] }))
  assert.throws(() => domain.diaryPhotoRequest({ id: photo, name: 'x.svg', contentType: 'image/svg+xml', size: 10 }))
  assert.equal(domain.diaryPhotoRequest({ id: photo, name: '../x.jpg', contentType: 'image/jpeg', size: 10 }).name, '.._x.jpg')
})
test('QR capabilities and anonymous upload owners are project-bound, without asserting a person identity', () => {
  const a = id(), nonce = id(), token = links.diaryLinkToken(a, nonce, key)
  assert.deepEqual(links.parseDiaryLink(token, key), { id: a, nonce })
  for (const altered of [token + '.extra', token.replace(nonce, id()), token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'), 'bad']) assert.throws(() => links.parseDiaryLink(altered, key))
  assert.throws(() => links.parseDiaryLink(token, key + 'other'))
  const old = process.env.PROJECT_DIARY_LINK_SECRET; process.env.PROJECT_DIARY_LINK_SECRET = key
  try {
    const device = 'a'.repeat(43)
    assert.equal(links.diaryDeviceHash(token, device).length, 64)
    assert.notEqual(links.diaryDeviceHash(token, device), links.diaryDeviceHash(links.diaryLinkToken(a, id(), key), device))
    assert.notEqual(links.diaryDeviceHash(token, device), links.diaryDeviceHash(token, 'b'.repeat(43)))
    assert.throws(() => links.diaryDeviceHash(token, undefined), /DIARY_DEVICE/)
  } finally { if (old === undefined) delete process.env.PROJECT_DIARY_LINK_SECRET; else process.env.PROJECT_DIARY_LINK_SECRET = old }
})
test('the actual QR PNG is nonblank and decodes to exactly the private project link', async () => {
  const url = `https://hushub.se/dagbok/${links.diaryLinkToken(id(), id(), key)}`
  const png = await QRCode.toBuffer(url, { width: 360, margin: 4, errorCorrectionLevel: 'M' })
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.ok(data.some(x => x === 0)); assert.ok(data.some(x => x === 255))
  assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, url)
})
test('real image decoding rejects HTML, disguised formats, truncated files, incorrect length and oversized files', async () => {
  for (const [format, mime] of [['jpeg','image/jpeg'], ['png','image/png'], ['webp','image/webp']]) {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#efca48' } }).toFormat(format).toBuffer()
    await validateDiaryImage(png, mime, png.length)
    await assert.rejects(validateDiaryImage(png, mime === 'image/png' ? 'image/jpeg' : 'image/png', png.length), /DIARY_PHOTO/)
    await assert.rejects(validateDiaryImage(png.subarray(0, 30), mime, 30), /DIARY_PHOTO/)
    await assert.rejects(validateDiaryImage(png, mime, png.length + 1), /DIARY_PHOTO/)
  }
  const fake = Buffer.from('<html>not an image</html>')
  await assert.rejects(validateDiaryImage(fake, 'image/jpeg', fake.length), /DIARY_PHOTO/)
  const big = Buffer.alloc(domain.DIARY_MAX_PHOTO_BYTES + 1)
  await assert.rejects(validateDiaryImage(big, 'image/png', big.length), /DIARY_PHOTO/)
})
test('HTTP boundaries reject cross-origin requests, malformed JSON and unbounded streaming bodies', async () => {
  const http = load('../src/lib/action-cases/projectDiaryHttp.ts', { 'next/server': { NextResponse: { json: (body, init) => ({ body, ...init }) } }, '@/lib/assignments/tokens': {}, './projectDiaryLinks': links })
  const request = (value, origin = 'https://hushub.se') => new Request('https://hushub.se/api/dagbok/test', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: value })
  assert.deepEqual(await http.diaryRequestBody(request('{"operation":"entry"}')), { operation: 'entry' })
  await assert.rejects(http.diaryRequestBody(request('{}', 'https://other.invalid')), /DIARY_ORIGIN/)
  await assert.rejects(http.diaryRequestBody(request('[]')), /DIARY_INVALID/)
  await assert.rejects(http.diaryRequestBody(request('{"text":"' + 'x'.repeat(33000) + '"}')), /DIARY_TOO_LARGE/)
  assert.equal(http.diaryError(new Error('private provider details')).body.error.includes('provider'), false)
  assert.equal(http.diaryError(new Error('PROJECT_DIARY_SCHEMA')).status, 503)
})
test('technical device cookie contains no name or email and preserves an existing upload owner', () => {
  const oldKey = process.env.PROJECT_DIARY_LINK_SECRET; process.env.PROJECT_DIARY_LINK_SECRET = key
  try {
    const http = load('../src/lib/action-cases/projectDiaryHttp.ts', { 'next/server': {}, '@/lib/assignments/tokens': { generateAssignmentToken: () => 'a'.repeat(43) }, './projectDiaryLinks': links }), calls = []
    const response = { cookies: { set: (...args) => calls.push(args) } }, token = links.diaryLinkToken(id(), id())
    http.rememberDiaryDevice(response, { cookies: { get: () => undefined } }, token)
    assert.equal(calls[0][2].httpOnly, true); assert.equal(calls[0][2].sameSite, 'lax'); assert.equal(calls[0][1], 'a'.repeat(43))
    http.rememberDiaryDevice(response, { cookies: { get: () => ({ value: 'b'.repeat(43) }) } }, token)
    assert.equal(calls[1][1], 'b'.repeat(43)); assert.equal(calls[1][0].startsWith('hh_diary_device_'), true)
  } finally { if (oldKey === undefined) delete process.env.PROJECT_DIARY_LINK_SECRET; else process.env.PROJECT_DIARY_LINK_SECRET = oldKey }
})
test('public routes allow person selection, retire old code requests and never expose history', async () => {
  let people = 0, submits = 0
  const http = { diaryJson: (body, status = 200) => ({ body, status }), diaryError: e => ({ status: e.message === 'PROJECT_DIARY_RELOAD' ? 410 : 400, error: e.message }), diaryRequestBody: r => r.json(), diaryRequestCookie: () => 'device', rememberDiaryDevice: () => {} }
  const route = load('../src/app/api/dagbok/[token]/route.ts', { '@/lib/action-cases/projectDiaryHttp': http, '@/lib/action-cases/projectDiaryServer': {
    async getDiaryPublic() { return { project: { title: 'Test' }, people: [], items: [] } },
    async addDiaryPerson() { people++; return { id: id(), name: 'Test', company: 'AB' } },
    async submitDiaryEntry() { submits++; return { id: id() } }
  } })
  const params = { params: Promise.resolve({ token: 'test' }) }, request = operation => new Request('https://hushub.se/api/dagbok/test', { method: 'POST', body: JSON.stringify({ operation, email: 'test@example.invalid' }) })
  const response = await route.POST(request('person'), params)
  assert.equal(people, 1); assert.equal(response.body.code, undefined); assert.equal(response.body.cookie, undefined)
  for (const operation of ['request_code','verify_code','logout']) assert.equal((await route.POST(request(operation), params)).status, 410)
  for (const operation of ['correction', 'link', 'cleanup']) assert.equal((await route.POST(request(operation), params)).status, 400)
  assert.equal(submits, 0)
})

function serverWith(db) {
  return load('../src/lib/action-cases/projectDiaryServer.ts', {
    'server-only': {}, 'node:crypto': crypto, qrcode: { default: QRCode }, './projectDiaryImage': { validateDiaryImage },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => db },
    './projectDiary': domain, './projectDiaryLinks': links
  })
}
test('public directory reads no identities or mailbox services and uses only the dedicated context RPC', async () => {
  const old = process.env.PROJECT_DIARY_LINK_SECRET; process.env.PROJECT_DIARY_LINK_SECRET = key
  try {
    const linkId = id(), nonce = id(), caseId = id(), calls = []
    const db = { async rpc(name, args) { calls.push({ name, args }); return { data: { project: { id: caseId, title: 'Fiktivt projekt' }, people: [], items: [] } } } }
    const result = await serverWith(db).getDiaryPublic(links.diaryLinkToken(linkId, nonce))
    assert.deepEqual(Object.keys(result).sort(), ['items','people','project'])
    assert.deepEqual(calls, [{ name: 'project_diary_people_context', args: { p_link_id: linkId, p_nonce: nonce } }])
    const source = readFileSync(new URL('../src/lib/action-cases/projectDiaryServer.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /sendTaskAccessLinkEmail|buildTaskEmailHtml|beginDiaryCode|verifyDiaryCode/)
  } finally { if (old === undefined) delete process.env.PROJECT_DIARY_LINK_SECRET; else process.env.PROJECT_DIARY_LINK_SECRET = old }
})
test('image completion archives original bytes on a distinct immutable path before sealing, and never writes contract/cost tables', async () => {
  const orgId = id(), caseId = id(), userId = id(), fileId = id(), calls = [], stored = new Map()
  const bytes = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#ead24c' } }).png().toBuffer()
  const incoming = `${orgId}/${caseId}/incoming/${fileId}`, final = `${orgId}/${caseId}/images/${fileId}`
  stored.set(incoming, bytes)
  const upload = { id: fileId, org_id: orgId, action_case_id: caseId, owner_key: `profile:${userId}`, name: 'test.png', content_type: 'image/png', size_bytes: bytes.length, state: 'pending', expires_at: new Date(Date.now() + 60000).toISOString() }
  const db = { from(table) { assert.ok(['action_cases','org_members','action_case_diary_uploads'].includes(table)); const q = { select() { return q }, eq(...args) { calls.push(['filter',table,...args]); return q }, async maybeSingle() { return { data: table === 'action_cases' ? { id: caseId, org_id: orgId } : table === 'org_members' ? { profile_id: userId } : upload } } }; return q }, async rpc(name, args) { assert.equal(name, 'project_diary_people_command'); assert.equal(args.p_operation, 'seal_photo'); assert.deepEqual(stored.get(final), bytes); calls.push(['seal', args.p_data]); return { data: { id: fileId, name: upload.name } } }, storage: { from(bucket) { assert.equal(bucket, 'project-diary-files'); return { async download(path) { return stored.has(path) ? { data: new Blob([stored.get(path)]) } : { error: {} } }, async upload(path, value, options) { assert.equal(options.upsert, false); calls.push(['archive', path]); if (stored.has(path)) return { error: {} }; stored.set(path, Buffer.from(value)); return {} }, async remove(paths) { paths.forEach(p => stored.delete(p)); calls.push(['remove',paths]); return {} } } } } }
  const server = serverWith(db), identity = { ctx: { orgId, userId }, caseId }
  const receipt = await server.completeDiaryPhoto(identity, fileId)
  assert.equal(receipt.id, fileId); assert.deepEqual(stored.get(final), bytes); assert.equal(stored.has(incoming), false)
  assert.ok(calls.findIndex(c => c[0] === 'archive') < calls.findIndex(c => c[0] === 'seal'))
  assert.equal(calls.find(c => c[0] === 'seal')[1].sha256, crypto.createHash('sha256').update(bytes).digest('hex'))
  assert.ok(calls.some(c => c[0] === 'filter' && c[2] === 'owner_key' && c[3] === `profile:${userId}`))
})

test('internal diary mutations require organization and module context before any read or command', async () => {
  for (const deny of ['UNAUTHORIZED','MODULE_ACCESS_REQUIRED',null]) {
    const calls = [], next = { NextResponse: { json: (body, init) => ({ body, ...init }) }, after: fn => calls.push(['cleanup', fn]) }
    const ctx = { orgId: id(), userId: id() }, caseId = id()
    const http = load('../src/lib/action-cases/projectDiaryHttp.ts', { 'next/server': next, '@/lib/assignments/tokens': {}, './projectDiaryLinks': links })
    const context = load('../src/lib/action-cases/customerOffersHttp.ts', { 'next/server': next, '@/lib/assignments/server': { async requireOrgContext() { if (deny === 'UNAUTHORIZED') throw Error(deny); return ctx } }, '@/lib/access/server': { async requireModuleAccess() { if (deny === 'MODULE_ACCESS_REQUIRED') throw Error(deny) } } })
    const route = load('../src/app/api/action-cases/[caseId]/diary/route.ts', { 'next/server': next, '@/lib/action-cases/customerOffersHttp': context, '@/lib/action-cases/projectDiaryHttp': http, '@/lib/action-cases/projectDiaryServer': { async submitDiaryEntry(...args) { calls.push(args); return { id: id() } }, async cleanupDiaryUploads() {}, async correctDiaryEntry() {}, async getProjectDiary() {}, async setDiaryLink() {} } })
    const request = new Request(`https://hushub.se/api/action-cases/${caseId}/diary`, { method: 'POST', headers: { origin: 'https://hushub.se', 'content-type': 'application/json' }, body: '{"operation":"entry"}' })
    const result = await route.POST(request, { params: Promise.resolve({ caseId }) })
    if (deny) { assert.equal(result.status, deny === 'UNAUTHORIZED' ? 401 : 403); assert.equal(calls.length, 0) }
    else { assert.equal(result.status, 200); assert.deepEqual(calls[0][0], { ctx, caseId }); assert.equal(calls.length, 1) }
  }
})
