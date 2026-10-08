// Synthetic UI tests only: no external traffic, real accounts or permission writes.
import assert from 'node:assert/strict'
import { readFile, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = await mkdtemp(join(tmpdir(), 'platform-organization-administration-ui-'))
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/platform-organization-admin-ui.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { 'next/link$': resolve('test/fixtures/organization-admin-ui-mocks.tsx'), '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? new Error(stats.toString('errors-only'))) : ok()))
const script = await readFile(join(output, 'view.js'))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const server = createServer((request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'")
  response.setHeader('Content-Type', request.url === '/view.js' ? 'application/javascript' : 'text/html; charset=utf-8')
  response.end(request.url === '/view.js' ? script : `<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="background:#fafaf9"><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
if (process.argv.includes('--serve-only')) {
  console.log(`Synthetic platform organization UI: http://127.0.0.1:${server.address().port}/?both`)
  console.log('Modes: ?ob-only, ?both, ?legacy. No external API traffic or real permission writes.')
  await new Promise(() => {})
}
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const url = `http://127.0.0.1:${server.address().port}`
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', (request) => { void (request.url().startsWith(url) ? request.continue() : request.abort()) })
  async function open(query = '') {
    page.once('dialog', (dialog) => dialog.accept())
    await page.goto(`${url}/${query}`)
    page.removeAllListeners('dialog')
    await page.waitForSelector('aside li button')
  }
  async function clickText(text, selector = 'button') {
    const handle = await page.evaluateHandle((text, selector) => [...document.querySelectorAll(selector)].find((node) => node.textContent.trim() === text), text, selector)
    assert.ok(await handle.evaluate((node) => Boolean(node)), `Element: ${text}`)
    await handle.asElement().click(); await handle.dispose()
  }
  async function selectOrg(index = 0) { await page.click(`aside li:nth-child(${index + 1}) button`); await page.waitForSelector('h2'); await page.waitForFunction(() => document.body.textContent.includes('Organisationens moduler')) }
  async function field(label, value) {
    const handle = await page.evaluateHandle((text) => [...document.querySelectorAll('label')].find((node) => node.firstChild?.textContent.trim() === text)?.querySelector('input'), label)
    assert.ok(await handle.evaluate((node) => Boolean(node)), `Field: ${label}`)
    await handle.asElement().click({ clickCount: 3 }); await handle.asElement().type(value); await handle.dispose()
  }
  async function checkbox(label, selector = 'main') {
    const handle = await page.evaluateHandle((text, scope) => [...document.querySelectorAll(`${scope} label`)].find(node => node.textContent.trim() === text)?.querySelector('input[type="checkbox"]'), label, selector)
    assert.ok(await handle.evaluate(node => Boolean(node)), `Checkbox: ${label}`)
    await handle.asElement().click(); await handle.dispose()
  }
  const calls = () => page.evaluate(() => window.platformOrganizationUiCalls)
  const writes = async () => (await calls()).filter((call) => call.method !== 'GET')
  const settled = () => page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))

  await open()
  await clickText('Skapa organisation')
  assert.equal(await page.$eval('form input[type="checkbox"]', (node) => node.checked), false)
  await field('Organisationsnamn', 'Ny organisation')
  await page.select('form select', 'user-a')
  page.once('dialog', (dialog) => dialog.dismiss())
  await clickText('Granska och skapa organisation')
  assert.equal((await writes()).length, 0)
  page.once('dialog', async (dialog) => { assert.match(dialog.message(), /ingen ÖB- eller TU-behörighet automatiskt/); await dialog.accept() })
  await clickText('Granska och skapa organisation')
  await settled()
  const created = (await writes())[0]
  assert.equal(created.body.adminProfileId, 'user-a')
  assert.deepEqual(created.body.modules, [])
  assert.match(created.body.requestId, /^[0-9a-f-]{36}$/)
  console.log('PASS create explicitly reviewed, no default operational grants')

  await open('?retry-create')
  await clickText('Skapa organisation')
  await field('Organisationsnamn', 'Försök igen')
  await page.select('form select', 'user-a')
  page.once('dialog', (dialog) => dialog.accept())
  await clickText('Granska och skapa organisation')
  await page.waitForSelector('[role="alert"]')
  assert.equal(await page.$eval('form input', (node) => node.matches(':disabled')), true)
  page.once('dialog', (dialog) => dialog.accept())
  await clickText('Försök skapa igen med samma uppgifter')
  await settled()
  const retries = await writes()
  assert.equal(retries.length, 2)
  assert.deepEqual(retries[0].body, retries[1].body)
  console.log('PASS unknown create outcome freezes payload and reuses idempotency key')

  await open()
  await selectOrg()
  await page.select('article:nth-child(2) select', 'admin')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.click('aside li:nth-child(2) button')
  assert.equal(await page.$eval('article:nth-child(2) select', (node) => node.value), 'admin')
  assert.equal(await page.$eval('aside li:first-child button', (node) => node.getAttribute('aria-pressed')), 'true')
  page.once('dialog', async (dialog) => { assert.match(dialog.message(), /BBSAB Test/); assert.match(dialog.message(), /Fortnox/); await dialog.accept() })
  await page.click('article:nth-child(2) button')
  await settled()
  const memberWrite = (await writes())[0]
  assert.equal(memberWrite.url, '/api/admin/organizations/org-a/members')
  assert.deepEqual(memberWrite.body.expected, { role: 'inspector', isActive: true, modules: [] })
  assert.equal(memberWrite.body.role, 'admin')
  console.log('PASS unsaved orgswitch is cancellable; member write has scoped optimistic baseline')

  await open('?concurrent')
  await selectOrg()
  await checkbox('TU-behörighet', 'article:nth-child(2)')
  await checkbox('TU-behörighet', 'article:first-child')
  page.once('dialog', (dialog) => dialog.accept())
  await page.click('article:first-child button')
  await settled()
  page.once('dialog', (dialog) => dialog.accept())
  await page.click('article:nth-child(2) button')
  await settled()
  const concurrentWrites = await writes()
  assert.equal(concurrentWrites.at(-1).body.expected.role, 'inspector', 'Retained edit must not replace its old baseline with concurrent admin role')
  console.log('PASS another unsaved member retains original expected state across save refresh')

  await open('?conflict')
  await selectOrg()
  await page.select('article:nth-child(2) select', 'admin')
  page.once('dialog', (dialog) => dialog.accept())
  await page.click('article:nth-child(2) button')
  await page.waitForSelector('[role="alert"]')
  assert.equal(await page.$eval('article:nth-child(2) select', (node) => node.value), 'admin')
  console.log('PASS conflicting save keeps draft')

  await open('?refresh-error')
  await selectOrg()
  await page.select('article:nth-child(2) select', 'admin')
  page.once('dialog', (dialog) => dialog.accept())
  await page.click('article:nth-child(2) button')
  await page.waitForFunction(() => document.body.textContent.includes('Hämta aktuella uppgifter'))
  assert.equal(await page.$$eval('article', (nodes) => nodes.length), 0)
  await clickText('Hämta aktuella uppgifter')
  await settled()
  assert.equal(await page.$eval('article:nth-child(2) select', (node) => node.value), 'admin')
  assert.equal((await writes()).length, 1)
  console.log('PASS failed post-save refresh cannot repeat stale write; read retry restores state')

  await open('?stale')
  await page.click('aside li:first-child button')
  await page.click('aside li:nth-child(2) button')
  await settled()
  await new Promise((resolve) => setTimeout(resolve, 500))
  assert.equal(await page.$eval('h2', (node) => node.textContent), 'SVEA Test')
  assert.equal(await page.$$eval('article', (nodes) => nodes.length), 0)
  console.log('PASS stale slow organization response cannot replace new selection')

  await open()
  await selectOrg()
  await checkbox('Tekniska utredningar (TU)')
  page.once('dialog', async (dialog) => { assert.match(dialog.message(), /TU-behörigheter i denna organisation tas bort/); assert.match(dialog.message(), /återkallas i sin helhet/); await dialog.accept() })
  await clickText('Granska och spara moduler')
  await settled()
  const moduleWrite = (await writes())[0]
  assert.equal(moduleWrite.url, '/api/admin/organizations/org-a')
  assert.deepEqual(moduleWrite.body, { moduleSetVersion: 2, expectedModules: ['technical_investigations'], modules: [] })
  console.log('PASS TU disable confirmation warns about invitations and uses expected scope')

  await open('?legacy')
  await selectOrg()
  assert.ok(await page.evaluate(() => document.body.textContent.includes('Äldre behörigheter kan finnas.')))
  assert.equal(await page.$eval('form input[type="checkbox"]', (node) => node.disabled), true)
  page.once('dialog', async (dialog) => { assert.match(dialog.message(), /äldre globala behörigheter ger inte åtkomst här/); await dialog.accept() })
  await clickText('Granska och fastställ modulval')
  await settled()
  assert.deepEqual((await writes())[0].body, { moduleSetVersion: 2, expectedModules: [], modules: [] })
  assert.equal(await page.evaluate(() => document.body.textContent.includes('organisationsstyrt val för ÖB är ännu inte fastställt')), true)
  assert.ok(await page.$$eval('button', nodes => nodes.find(node => node.textContent.trim() === 'Granska och spara moduler').disabled), 'Unmanaged OB does not make unchanged TU perpetually saveable')
  console.log('PASS legacy organization can establish TU off while leaving absent OB management untouched')

  await open()
  await selectOrg()
  await page.select('form select', 'user-c')
  page.once('dialog', (dialog) => dialog.accept())
  await clickText('Granska och lägg till medlem')
  await settled()
  assert.deepEqual((await writes())[0].body, { profileId: 'user-c', expected: null, role: 'inspector', isActive: true, modules: [], moduleSetVersion: 2 })
  console.log('PASS existing user addition has no default TU or administrator grant')

  await open('?both')
  await selectOrg()
  await checkbox('Överlåtelsebesiktning (ÖB)')
  page.once('dialog', async dialog => { assert.match(dialog.message(), /ÖB-behörigheter i denna organisation tas bort/); assert.doesNotMatch(dialog.message(), /TU-behörigheter i denna organisation tas bort/); await dialog.accept() })
  await clickText('Granska och spara moduler')
  await settled()
  assert.deepEqual((await writes())[0].body, { moduleSetVersion: 2, expectedModules: ['inspections', 'technical_investigations'], modules: ['technical_investigations'] })
  assert.equal(await page.$$eval('article:first-child label', nodes => nodes.find(node => node.textContent.trim() === 'TU-behörighet').querySelector('input').checked), true)
  console.log('PASS disabling OB preserves TU independently and warns about whole mixed invitation revocation')

  await page.setViewport({ width: 1440, height: 1000 })
  await open()
  await selectOrg()
  await page.screenshot({ path: join(output, 'organizations-desktop.png'), fullPage: true })
  await page.setViewport({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'organizations-mobile.png'), fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile view must not overflow')
  assert.deepEqual(errors, [])
  console.log(`11 UI scenarios passed; screenshots: ${output}`)
} finally {
  if (browser) await browser.close()
  await new Promise((ok) => server.close(ok))
}
