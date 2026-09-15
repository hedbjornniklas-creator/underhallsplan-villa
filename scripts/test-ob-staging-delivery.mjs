import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { stagingEnvironment, validateStagingKeys } from './lib/ob-staging-app.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const folder = join(root, '.cache/ob-staging-app')
const keys = validateStagingKeys(JSON.parse(await readFile(join(folder, 'keys.json'), 'utf8')))
const fixture = JSON.parse(await readFile(join(folder, 'fixtures.json'), 'utf8'))
const running = JSON.parse(await readFile(join(folder, 'running.json'), 'utf8'))
assert.equal(fixture.project, keys.url)
assert.equal(running.project, new URL(keys.url).hostname)
assert.equal(running.url, `http://127.0.0.1:${running.port}`)
const env = stagingEnvironment(process.env, keys, running.port)
Object.assign(env, { ASSIGNMENTS_MAIL_FROM: 'OB Test <sender@example.invalid>', REPORT_TIMING_LOGS: '1',
  PUPPETEER_EXECUTABLE_PATH: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  PUPPETEER_PROFILE_ROOT_DIR: join(folder, 'pdf-browser-profiles'), REPORT_READY_TIMEOUT_MS: '90000' })
for (const key of Object.keys(process.env)) delete process.env[key]
Object.assign(process.env, env)
const fetchReal = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  assert.ok([keys.url, running.url].includes(url.origin), `Unexpected test network destination: ${url.origin}`)
  return fetchReal(input, init)
}
assert.equal((await fetch(`${running.url}/staging`, { redirect: 'error' })).headers.get('x-ob-test-project'), running.project)
const admin = createClient(keys.url, keys.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(keys.url, keys.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
async function identity(person) {
  const cookies = new Map()
  const db = createServerClient(keys.url, keys.anonKey, { cookies: {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll: values => values.forEach(c => cookies.set(c.name, c.value)),
  } })
  assert.equal((await db.auth.signInWithPassword({ email: person.email, password: person.password })).error, null)
  const user = await db.auth.getUser()
  assert.equal(user.error, null)
  assert.equal(user.data.user.id, person.id)
  return { db, id: person.id, headers: { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } }
}
const owner = await identity(fixture.owner), stranger = await identity(fixture.stranger)
let actor = owner
const run = { project: keys.url, property: randomUUID(), inspection: randomUUID(), checks: [], completed: false }
const output = join(folder, `delivery-${Date.now()}`)
await mkdir(output)
await writeFile(join(output, 'manifest.json'), JSON.stringify(run, null, 2), { flag: 'wx' })
async function checked(request) {
  const { data, error } = await request
  assert.equal(error, null, error?.message)
  return data
}
const originalTables = ['ob_inspection_buildings', 'ob_inspection_structure', 'ob_building_conditions',
  'inspection_interior_rooms', 'inspection_control_items', 'inspection_images', 'inspection_report_links']
async function originalSnapshot() {
  const result = {}
  for (const table of originalTables) result[table] = await checked(admin.from(table).select('*').eq('inspection_id', fixture.inspection))
  return result
}
const before = await originalSnapshot()
const pass = message => { run.checks.push(message); console.log(`PASS ${message}`) }
async function building(operation, payload, expected = 200, as = owner) {
  const response = await fetch(`${running.url}/api/ob/inspections/${run.inspection}/buildings`, {
    method: operation ? 'POST' : 'GET', headers: { ...as.headers, 'Content-Type': 'application/json' }, redirect: 'error',
    ...(operation ? { body: JSON.stringify({ operation, payload: { ...payload, requestId: randomUUID() } }) } : {}),
  })
  const result = await response.json()
  assert.equal(response.status, expected, JSON.stringify(result))
  return result.data
}

// Execute production TS modules unchanged. Only framework request context and
// mail transport are adapted; all report/DB/PDF/Storage/authorization logic runs.
const deferred = [], emails = [], modules = new Map(), require = createRequire(import.meta.url)
const overrides = {
  'server-only': {},
  'next/server': { ...require('next/server'), after: callback => deferred.push(callback) },
  '@/lib/supabase/server': { createSupabaseServerClient: () => actor.db },
  '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
  '@/lib/assignments/mailer': { sendAssignmentEmail: async input => {
    assert.equal(input.to, 'recipient@example.invalid')
    assert.ok(input.html.includes('http://127.0.0.1:'))
    emails.push(input)
    return { provider: 'staging-local-capture', providerMessageId: randomUUID() }
  } },
}
function load(path) {
  const file = resolve(root, path)
  assert.ok(file.startsWith(join(root, 'src') + '\\'))
  if (modules.has(file)) return modules.get(file).exports
  const compiled = { exports: {} }
  modules.set(file, compiled)
  const source = readFileSync(file, 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  const dependency = name => {
    if (name in overrides) return overrides[name]
    if (!name.startsWith('@/') && !name.startsWith('.')) return require(name)
    const target = name.startsWith('@/') ? join(root, 'src', name.slice(2)) : resolve(dirname(file), name)
    const found = [target, target + '.ts', target + '.tsx', join(target, 'index.ts')].find(value => existsSync(value) && /\.(ts|tsx|json)$/.test(value))
    assert.ok(found, `Unresolved test dependency: ${name}`)
    return found.endsWith('.json') ? JSON.parse(readFileSync(found, 'utf8')) : load(found)
  }
  new Function('require', 'module', 'exports', '__dirname', '__filename', output)(dependency, compiled, compiled.exports, dirname(file), file)
  return compiled.exports
}
const delivery = load('src/app/api/ob/inspections/[id]/report-delivery/route.ts')
const download = load('src/app/api/reports/public/[token]/route.ts')
let linkId = null
try {
  await checked(admin.from('properties').insert({ id: run.property, owner: owner.id,
    name: 'TEST - fryst tvabyggnadsutlatande', address: 'Testgatan 6', city: 'Teststad' }))
  await checked(admin.from('inspections').insert({ id: run.inspection, property_id: run.property, type: 'OB',
    inspection_family: 'OB', date: '2026-09-13', inspector_name: 'OB Test owner', status: 'Utkast' }))
  const preview = await building()
  await building('activate', { name: 'TEST Huvudbyggnad', buildingId: null, categoryKey: 'boverket:010101:v2',
    purposeCatalogueVersion: 1, activationToken: preview.activationToken, confirmed: true })
  const state = await building('add', { name: 'TEST Gasthus', buildingId: null, categoryKey: 'boverket:010106:v4' })
  const png = await readFile(join(root, 'public/report-assets/mock-company-logo.png'))
  const notes = []
  for (const [index, part] of state.parts.entries()) {
    const [condition] = await checked(admin.from('ob_building_conditions').select('*').eq('building_part_id', part.id))
    await building('row', { table: 'ob_building_conditions', partId: part.id, id: condition.id, revision: condition.ob_revision,
      operation: 'update', row: { building_year: 1980 + index * 40, furnishing_level: index ? 'fullt_moblerad' : 'omoblerad' } })
    const room = await building('row', { table: 'inspection_interior_rooms', partId: part.id, id: randomUUID(), operation: 'insert',
      row: { floor_label: 'plan0', room_type_key: 'hall', room_label: `TEST Hall ${index + 1}` } })
    const note = await building('row', { table: 'inspection_control_items', partId: part.id, id: randomUUID(), operation: 'insert',
      row: { interior_room_id: room.id, title: `TEST Notering ${index + 1}`, note: `FRYST TEST HUS ${index + 1}: separat notering.` } })
    notes.push(note)
    const imageId = randomUUID(), path = `${run.inspection}/round/release/${imageId}.png`
    await checked(owner.db.storage.from('inspection-images').upload(path, png, { contentType: 'image/png', upsert: false }))
    await building('row', { table: 'inspection_images', partId: part.id, id: imageId, operation: 'insert', row: {
      file_path: path, label: `TEST Bild ${index + 1}`, interior_room_id: room.id, control_item_id: note.id,
      processing_status: 'linked', source_area: 'interior', origin_building_part_id: part.id,
      origin_interior_room_id: room.id, origin_floor_label: room.floor_label, origin_room_label: room.room_label,
      origin_room_type_key: room.room_type_key,
    } })
  }
  pass('Separate synthetic two-building inspection with independent conditions, notes and uploaded images')
  const request = () => new Request(`${running.url}/api/ob/inspections/${run.inspection}/report-delivery`, {
    method: 'POST', body: JSON.stringify({ action: 'send_and_complete', primary_recipient: 'recipient@example.invalid' }),
  })
  actor = stranger
  assert.equal((await delivery.POST(request(), { params: Promise.resolve({ id: run.inspection }) })).status, 403)
  assert.equal(emails.length, 0)
  actor = owner
  pass('Delivery rejects a different inspector before creating a report or sending mail')
  const response = await delivery.POST(request(), { params: Promise.resolve({ id: run.inspection }) })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  linkId = result.linkId
  run.linkId = linkId
  assert.equal(result.inspectionStatus, 'completed')
  assert.ok(result.inspectionLockedAt)
  assert.equal(emails.length, 1)
  assert.equal(deferred.length, 1)
  await writeFile(join(output, 'captured-email.json'), JSON.stringify(emails, null, 2))
  const frozen = await checked(admin.from('inspection_report_links').select('*').eq('id', linkId).single())
  await writeFile(join(output, 'frozen-snapshot.json'), JSON.stringify(frozen.snapshot_payload, null, 2))
  assert.equal(frozen.snapshot_payload.reportData.obBuildingClassifications.length, 2)
  assert.deepEqual(frozen.snapshot_payload.reportData.obBuildingClassifications.map(part => part.purpose.version), [2, 4])
  for (const marker of ['FRYST TEST HUS 1:', 'FRYST TEST HUS 2:', 'TEST Huvudbyggnad', 'TEST Gasthus']) {
    assert.ok(JSON.stringify(frozen.snapshot_payload).includes(marker), marker)
  }
  pass('Real delivery handler freezes both buildings and classifications, captures mail locally and locks the inspection')
  await building('row', { table: 'inspection_control_items', partId: notes[1].building_part_id, id: notes[1].id,
    revision: notes[1].ob_revision, operation: 'update', row: { note: 'Must not change a locked report' } }, 409)
  await checked(admin.from('properties').update({ name: 'TEST Updated property name' }).eq('id', run.property))
  assert.deepEqual((await checked(admin.from('inspection_report_links').select('snapshot_payload').eq('id', linkId).single())).snapshot_payload, frozen.snapshot_payload)
  pass('Locked note changes are rejected; a separate property edit does not change the frozen snapshot')
  assert.equal((await fetch(`${running.url}/internal/report-render/${linkId}`, { redirect: 'error' })).status, 404)
  pass('Internal frozen-report render page denies unsigned requests')
  await deferred[0]()
  const stored = await checked(admin.from('inspection_report_links').select('*').eq('id', linkId).single())
  assert.equal(stored.pdf_status, 'ready', stored.pdf_error)
  assert.ok(stored.pdf_storage_bucket && stored.pdf_storage_path)
  const pdf = Buffer.from(await (await checked(admin.storage.from(stored.pdf_storage_bucket).download(stored.pdf_storage_path))).arrayBuffer())
  assert.equal(createHash('sha256').update(pdf).digest('hex'), stored.pdf_sha256)
  assert.equal(pdf.length, stored.pdf_size_bytes)
  await writeFile(join(output, 'frozen-report.pdf'), pdf)
  run.pdfSha256 = stored.pdf_sha256
  run.pdfBytes = pdf.length
  assert.equal((await checked(admin.storage.getBucket(stored.pdf_storage_bucket))).public, false)
  assert.ok((await anon.storage.from(stored.pdf_storage_bucket).download(stored.pdf_storage_path)).error)
  assert.ok((await stranger.db.storage.from(stored.pdf_storage_bucket).download(stored.pdf_storage_path)).error)
  pass('Real PDF worker renders the frozen snapshot, stores a hash-verified private PDF and denies direct foreign downloads')
  const token = new URL(result.publicLink).pathname.split('/').pop()
  const publicRequest = new Request(`${running.url}/api/reports/public/${token}?download=1`)
  const publicResponse = await download.GET(publicRequest, { params: Promise.resolve({ token }) })
  assert.equal(publicResponse.status, 302)
  const signedUrl = publicResponse.headers.get('location')
  assert.equal(new URL(signedUrl).origin, keys.url)
  const downloaded = await fetch(signedUrl, { redirect: 'error' })
  assert.equal(downloaded.status, 200)
  assert.equal(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex'), stored.pdf_sha256)
  assert.equal((await download.GET(publicRequest, { params: Promise.resolve({ token: randomUUID() }) })).status, 404)
  pass('Actual public-token handler downloads the identical PDF and rejects unknown tokens')
  await checked(admin.from('inspection_report_links').update({ revoked_at: new Date().toISOString() }).eq('id', linkId))
  assert.equal((await download.GET(publicRequest, { params: Promise.resolve({ token }) })).status, 404)
  pass('Revoking the test report blocks new token downloads')
  assert.deepEqual(await originalSnapshot(), before)
  pass('Original click-test inspection remains unchanged')
  run.completed = true
} finally {
  // A failed response can still have created a link. Revoke only this run's links.
  await checked(admin.from('inspection_report_links').update({ revoked_at: new Date().toISOString() }).eq('inspection_id', run.inspection))
  await writeFile(join(output, 'manifest.json'), JSON.stringify(run, null, 2))
  await writeFile(join(folder, 'delivery-latest.json'), JSON.stringify({ ...run, output }, null, 2))
  globalThis.fetch = fetchReal
}
console.log(JSON.stringify({ ...run, output }))
