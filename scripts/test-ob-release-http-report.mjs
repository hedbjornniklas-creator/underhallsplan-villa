import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, open } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { stagingEnvironment, validateStagingKeys } from './lib/ob-staging-app.mjs'
import { startReportTestGateway } from './lib/ob-report-test-gateway.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const folder = join(root, '.cache/ob-staging-app')
const read = async name => JSON.parse(await readFile(join(folder, name)))
const keys = validateStagingKeys(await read('keys.json'))
const fixture = await read('fixtures.json'), source = await read('delivery-latest.json')
const android = await read('android-fixture.json')
assert.equal(source.project, keys.url)
assert.equal(fixture.project, keys.url)
assert.equal(source.completed, true)
assert.notEqual(source.inspection, fixture.inspection)
assert.notEqual(source.inspection, android.inspection)
const candidate = JSON.parse(await readFile(join(root, '.cache/ob-release/candidate-latest.json')))
assert.equal(candidate.status, 'local-checks-passed')
assert.equal(candidate.project, keys.url)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
for (const file of candidate.files) assert.equal(hash(await readFile(join(candidate.app, file.path))), file.sha256)
const run = { project: keys.url, sourceInspection: source.inspection, checks: [], renders: [],
  completed: false, emailSent: false, productionTouched: false, createdLink: null, startedAt: new Date().toISOString() }
const output = join(root, '.cache/ob-release', 'http-report-' + Date.now())
await mkdir(output)
const temporary = createServer()
await new Promise(resolve => temporary.listen(0, '127.0.0.1', resolve))
const port = temporary.address().port
await new Promise(resolve => temporary.close(resolve))
const origin = 'http://127.0.0.1:' + port
let token
const imageUrls = []
const gateway = await startReportTestGateway({ root, output, target: origin,
  identity: () => ({ linkId: run.createdLink, token, imageUrls }) })
const env = { ...stagingEnvironment(process.env, keys, port), NODE_ENV: 'production', REPORT_TIMING_LOGS: '1',
  APP_BASE_URL: gateway.origin,
  ASSIGNMENTS_MAIL_FROM: 'OB HTTP test <sender@example.invalid>',
  PUPPETEER_EXECUTABLE_PATH: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  PUPPETEER_PROFILE_ROOT_DIR: join(output, 'browser-profiles') }
assert.ok(!env.RESEND_API_KEY && !env.SMTP_HOST, 'No mail transport permitted')
const serverLog = await open(join(output, 'server.log'), 'wx')
const child = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'start', candidate.app,
  '--hostname', '127.0.0.1', '--port', String(port)], { cwd: candidate.app, env, windowsHide: true, stdio: ['ignore', serverLog.fd, serverLog.fd] })
let exitCode = null
const childExit = new Promise(resolve => child.once('exit', code => { exitCode = code; resolve(code) }))
const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  assert.ok([keys.url, origin, gateway.origin].includes(url.origin), 'Unexpected test destination')
  return realFetch(input, init)
}
const admin = createClient(keys.url, keys.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const checked = async request => { const { data, error } = await request; assert.ok(!error, error?.message); return data }
const pass = name => { run.checks.push(name); console.log('PASS ' + name) }
let original, baselineLinks
try {
  for (let i = 0; ; i++) {
    assert.ok(exitCode === null, 'Isolated HTTP app exited')
    try { const response = await fetch(origin + '/login'); if (response.ok) break } catch {}
    assert.ok(i < 60, 'Isolated HTTP app did not start')
    await delay(500)
  }
  original = await checked(admin.from('inspection_report_links').select('*').eq('id', source.linkId).single())
  assert.equal(original.inspection_id, source.inspection)
  assert.equal(original.pdf_sha256, source.pdfSha256)
  const property = await checked(admin.from('properties').select('name').eq('id', source.property).single())
  assert.match(property.name, /^TEST /)
  assert.equal((await fetch(gateway.origin + '/api/ob/inspections/' + source.inspection + '/buildings')).status, 404)
  pass('Temporary HTTPS gateway rejects inspection editing and unrelated routes')
  baselineLinks = await checked(admin.from('inspection_report_links').select('id,revoked_at').eq('inspection_id', source.inspection))
  assert.ok(baselineLinks.every(link => link.revoked_at), 'Do not disrupt an active test delivery')
  const cookiesFor = async person => {
    const cookies = new Map()
    const db = createServerClient(keys.url, keys.anonKey, { cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: values => values.forEach(c => cookies.set(c.name, c.value)),
    } })
    assert.equal((await db.auth.signInWithPassword({ email: person.email, password: person.password })).error, null)
    return [...cookies].map(([k, v]) => k + '=' + v).join('; ')
  }
  const ownerCookie = await cookiesFor(fixture.owner), strangerCookie = await cookiesFor(fixture.stranger)
  const api = origin + '/api/ob/inspections/' + source.inspection + '/report-delivery'
  const status = async cookie => fetch(api, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'error' })
  assert.equal((await status(ownerCookie)).status, 200)
  assert.ok([401, 403].includes((await status(null)).status))
  assert.equal((await status(strangerCookie)).status, 403)
  pass('Real HTTP report status enforces owner and anonymous/colleague isolation')
  async function download(expectedHash, name) {
    const response = await fetch(gateway.origin + '/api/reports/public/' + token, { redirect: 'manual' })
    assert.ok([302, 307].includes(response.status), 'Expected signed PDF redirect')
    const location = new URL(response.headers.get('location'))
    assert.equal(location.origin, keys.url)
    assert.ok(location.pathname.startsWith('/storage/v1/object/sign/inspection-reports/'))
    const file = await fetch(location, { redirect: 'error' })
    assert.equal(file.status, 200)
    const bytes = Buffer.from(await file.arrayBuffer())
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    assert.equal(hash(bytes), expectedHash)
    await writeFile(join(output, name + '.pdf'), bytes)
    return { bytes: bytes.length, sha256: hash(bytes) }
  }
  const coldStarted = Date.now()
  const created = await fetch(api, { method: 'POST', redirect: 'error', headers: {
    Cookie: ownerCookie, 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ action: 'send_open', primary_recipient: 'recipient@example.invalid' }) })
  assert.equal(created.status, 502, 'Missing primary-recipient transport must be reported')
  const createdBody = await created.json()
  const newLinks = (await checked(admin.from('inspection_report_links').select('id').eq('inspection_id', source.inspection)))
    .filter(link => !baselineLinks.some(old => old.id === link.id))
  assert.equal(newLinks.length, 1, 'Expected one new synthetic snapshot')
  run.createdLink = newLinks[0].id
  assert.match(run.createdLink, /^[a-f0-9-]{36}$/)
  assert.equal(createdBody.sentRecipients.length, 0)
  assert.equal(createdBody.failedRecipients.length, 1, 'Transport is intentionally not configured')
  // The intentional mail failure does not return the bearer URL. Assign a
  // known token to this new synthetic link only, then test the real HTTP reader.
  token = randomBytes(32).toString('base64url')
  await checked(admin.from('inspection_report_links').update({ token_hash: hash(token) }).eq('id', run.createdLink))
  const fresh = await checked(admin.from('inspection_report_links').select('snapshot_payload').eq('id', run.createdLink).single())
  function allowSyntheticImages(value) {
    if (typeof value === 'string' && value.startsWith(keys.url + '/storage/v1/object/public/inspection-images/')) {
      const url = new URL(value)
      assert.ok(url.pathname.startsWith('/storage/v1/object/public/inspection-images/' + source.inspection + '/'))
      if (!imageUrls.includes(value)) imageUrls.push(value)
    } else if (value && typeof value === 'object') Object.values(value).forEach(allowSyntheticImages)
  }
  allowSyntheticImages(fresh.snapshot_payload)
  assert.ok(imageUrls.length > 0, 'Synthetic report must exercise actual image loading')
  pass('Actual HTTP delivery freezes a fresh snapshot and reports the intentional mail transport failure')
  let frozenSnapshot
  for (const mode of ['cold', 'warm']) {
    const started = mode === 'cold' ? coldStarted : Date.now()
    {
      const response = await fetch(api, { method: 'POST', redirect: 'error',
        headers: { Cookie: ownerCookie, 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ action: 'regenerate_pdf' }) })
      assert.equal(response.status, 200, 'HTTP PDF regeneration rejected')
    }
    let row
    for (let attempt = 0; ; attempt++) {
      row = await checked(admin.from('inspection_report_links').select('pdf_status,pdf_error,pdf_storage_path,pdf_sha256,snapshot_payload')
        .eq('id', run.createdLink).single())
      if (row.pdf_status === 'ready') break
      assert.notEqual(row.pdf_status, 'failed', 'PDF worker failed: ' + row.pdf_error)
      assert.ok(attempt < 100, 'HTTP PDF worker did not finish')
      await delay(1500)
    }
    assert.ok(row.pdf_storage_path.includes(run.createdLink), 'Worker must not overwrite original report object')
    if (mode === 'cold') frozenSnapshot = row.snapshot_payload
    else assert.deepEqual(row.snapshot_payload, frozenSnapshot)
    run.renders.push({ mode, elapsedMs: Date.now() - started, ...await download(row.pdf_sha256, mode) })
    pass(mode + ' real HTTP PDF worker and signed download passed')
  }
  await checked(admin.from('inspection_report_links').update({ revoked_at: new Date().toISOString() }).eq('id', run.createdLink))
  const revoked = await fetch(gateway.origin + '/api/reports/public/' + token, { redirect: 'manual' })
  assert.equal(revoked.status, 404)
  assert.equal(await revoked.text(), 'Not found', 'The actual route, not the gateway, must deny the revoked token')
  assert.equal((await fetch(origin + '/api/reports/public/' + randomBytes(32).toString('base64url'), { redirect: 'manual' })).status, 404)
  pass('New public downloads are denied after revocation and for unknown tokens')
  assert.deepEqual(await checked(admin.from('inspection_report_links').select('*').eq('id', source.linkId).single()), original)
  run.completed = true
} catch (error) { run.error = error.message; process.exitCode = 1 }
finally {
  try {
    if (baselineLinks) {
      const links = await checked(admin.from('inspection_report_links').select('id').eq('inspection_id', source.inspection))
      for (const link of links.filter(link => !baselineLinks.some(old => old.id === link.id))) {
        await checked(admin.from('inspection_report_links').update({ revoked_at: new Date().toISOString() }).eq('id', link.id))
      }
    }
  } catch (error) {
    run.cleanupError = error.message; run.completed = false; process.exitCode = 1
  } finally {
    child.kill()
    await childExit
    await gateway.close()
    await serverLog.close()
    globalThis.fetch = realFetch
  }
  run.completedAt = new Date().toISOString()
  await writeFile(join(output, 'manifest.json'), JSON.stringify(run, null, 2))
  await writeFile(join(root, '.cache/ob-release/http-report-latest.json'), JSON.stringify({ ...run, output }, null, 2))
  console.log(JSON.stringify({ completed: run.completed, checks: run.checks.length, renders: run.renders,
    emailSent: false, productionTouched: false, output, error: run.error?.split('\n')[0] }))
}
