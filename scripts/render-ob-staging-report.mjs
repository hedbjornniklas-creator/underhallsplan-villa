import assert from 'node:assert/strict'
import { readFile, writeFile, realpath, access } from 'node:fs/promises'
import { relative, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServerClient } from '@supabase/ssr'
import { stagingEnvironment, validateStagingKeys } from './lib/ob-staging-app.mjs'

const folder = fileURLToPath(new URL('../.cache/ob-staging-app/', import.meta.url))
const keys = validateStagingKeys(JSON.parse(await readFile(join(folder, 'keys.json'), 'utf8')))
const fixture = JSON.parse(await readFile(join(folder, 'fixtures.json'), 'utf8'))
const running = JSON.parse(await readFile(join(folder, 'running.json'), 'utf8'))
assert.equal(fixture.project, keys.url)
assert.equal(running.project, new URL(keys.url).hostname)
assert.equal(running.url, `http://127.0.0.1:${running.port}`)
const app = await realpath(running.app)
const child = relative(await realpath(folder), app)
assert.ok(child.startsWith('app-') && !child.includes('..') && !isAbsolute(child))
const env = stagingEnvironment(process.env, keys, running.port)
// The existing PDF renderer gets a clean environment and a disposable Chrome profile.
env.PUPPETEER_EXECUTABLE_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
await access(env.PUPPETEER_EXECUTABLE_PATH)
env.PUPPETEER_PROFILE_ROOT_DIR = join(folder, 'pdf-browser-profiles')
env.REPORT_READY_TIMEOUT_MS = '90000'
env.REPORT_TIMING_LOGS = '0'
for (const key of Object.keys(process.env)) delete process.env[key]
Object.assign(process.env, env)

const probe = await fetch(`${running.url}/staging`, { redirect: 'error' })
assert.equal(probe.headers.get('x-ob-test-project'), running.project)
const cookies = new Map()
const db = createServerClient(keys.url, keys.anonKey, { cookies: {
  getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
  setAll: all => all.forEach(c => cookies.set(c.name, c.value)),
} })
assert.equal((await db.auth.signInWithPassword({ email: fixture.owner.email, password: fixture.owner.password })).error, null)
const headers = { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
const url = `${running.url}/utlatande/${fixture.property}/${fixture.inspection}?embed=1&pdf=1`
const preview = await fetch(url, { headers, redirect: 'error' })
assert.equal(preview.status, 200, 'The real draft report page must render before PDF generation')
const html = await preview.text()
for (const value of ['Huvudbyggnad', 'G\u00e4sthus', 'Tr\u00e4panel', 'Pl\u00e5t', 'Testgatan']) {
  assert.ok(html.includes(value), `Missing report content: ${value}`)
}
console.log('PASS Real authenticated report page includes both buildings and distinct conditions')
// Reuse the application renderer unchanged, not the obsolete React-PDF path.
const { renderPreviewPdf } = await import(pathToFileURL(join(app, 'src/lib/report/pdfV2/renderPreviewPdf.ts')).href)
const pdf = await renderPreviewPdf({ url, mainDocumentHeaders: headers, timeoutMs: 150000, traceId: 'staging-multi-building' })
assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), '%PDF-')
const output = join(folder, 'multi-building-test.pdf')
await writeFile(output, pdf)
console.log(`PASS Test PDF rendered: ${pdf.length} bytes`)
console.log(output)
