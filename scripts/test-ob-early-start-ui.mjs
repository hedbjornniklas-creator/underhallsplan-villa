import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

// Render the real components with synthetic endpoints. No real auth, mail or database writes.
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/ob-early-start-ui')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  entry: resolve('test/fixtures/ob-early-start.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/components/Protected': resolve('test/fixtures/ob-early-start-navigation.tsx'),
    'next/navigation': resolve('test/fixtures/ob-early-start-navigation.tsx'),
    'next/link': resolve('test/helpers/preview-link.tsx'), '@': resolve('src'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? new Error(stats.toString('errors-only'))) : ok()))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const js = await readFile(resolve(output, 'view.js'))
let assignment, workflow, readFails = false, reviewFails = false
const posts = []
function reset() {
  assignment = { id: 'test-assignment', org_id: 'test-org', status: 'sent', assignment_type: 'OB',
    customer_name: 'Testkund', customer_email: 'customer@example.invalid', currency: 'SEK', price_amount: 2500,
    orderer_role: 'seller', property_address: 'Testgatan 1', archived_at: null, accepted_at: null, inspection_id: null,
    created_at: '2026-09-10T08:00:00Z', updated_at: '2026-09-10T08:00:00Z', last_sent_at: '2026-09-10T08:00:00Z' }
  workflow = { inspectionId: 'test-inspection', assignmentId: assignment.id, status: 'sent',
    startedAt: '2026-09-10T08:00:00Z', startReason: 'Kunden har inte hunnit godkänna.',
    acceptedAt: null, bookedAt: null, initialSnapshot: { customer_name: 'Testkund', addons: [] },
    currentSnapshot: { customer_name: 'Uppdaterad Testkund', addons: [{ key: 'area', name: 'Areamätning', price: 500, currency: 'SEK' }], terms_document_hash: 'a'.repeat(64) },
    reviewToken: 'test-review-token', needsReview: true, paused: false, canDeliver: false, reason: 'Inväntar kundens godkännande.' }
  posts.length = 0; readFails = false; reviewFails = false
}
reset()
const server = createServer(async (request, response) => {
  const route = new URL(request.url, 'http://127.0.0.1').pathname
  if (route.startsWith('/api/')) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (route.endsWith('/assignment-workflow') && request.method === 'GET') {
      response.statusCode = readFails ? 503 : 200
      response.end(JSON.stringify(readFails ? { error: 'Uppdragsstatus kunde inte kontrolleras.' } : { workflow })); return
    }
    if (request.method === 'GET') { response.end(JSON.stringify({ assignment, addonOrders: [] })); return }
    let raw = ''; for await (const chunk of request) raw += chunk
    const payload = JSON.parse(raw || '{}'); posts.push({ route, payload })
    await new Promise(ok => setTimeout(ok, 150))
    if (route.endsWith('/convert')) response.end(JSON.stringify({ propertyId: 'test-property', inspectionId: 'test-inspection' }))
    else if (route.endsWith('/assignment-workflow')) {
      if (reviewFails) { response.statusCode = 409; response.end(JSON.stringify({ error: 'Uppdragsbekräftelsen har ändrats. Uppdatera sidan.' })); return }
      workflow = { ...workflow, canDeliver: true, needsReview: false, reason: null }
      response.end(JSON.stringify({ workflow }))
    } else { response.statusCode = 400; response.end(JSON.stringify({ error: 'Unexpected test write' })) }
    return
  }
  if (route === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
let browser, page
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.setRequestInterception(true)
  page.on('request', request => new URL(request.url()).hostname === '127.0.0.1' ? request.continue() : request.abort())
  const base = `http://127.0.0.1:${server.address().port}`
  async function click(label) {
    for (const button of await page.$$('button')) {
      if (await button.evaluate((node, expected) => node.textContent.trim() === expected, label)) {
        await button.click(); return
      }
    }
    assert.fail(`Missing button: ${label}`)
  }
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  for (const width of [1440, 390]) {
    reset(); await page.setViewport({ width, height: 900 })
    await page.goto(base, { waitUntil: 'networkidle0' })
    await click('Starta före godkännande'); await page.waitForSelector('dialog[open]')
    assert.equal(await page.$eval('dialog button:last-child', node => node.disabled), true)
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA')
    await page.keyboard.press('Escape'); assert.equal(await page.$('dialog[open]'), null)
    await click('Starta före godkännande')
    await page.type('dialog textarea', 'Kunden har inte hunnit godkänna.')
    assert.equal(await page.$eval('dialog button:last-child', node => node.disabled), true)
    await page.click('dialog input[type=checkbox]')
    assert.equal(await overflow(), false)
    assert.equal(await page.$eval('dialog', node => node.scrollWidth > node.clientWidth), false)
    await page.screenshot({ path: resolve(output, `start-${width}.png`) })
    await page.$eval('dialog button:last-child', node => node.click())
    await page.waitForFunction(() => document.body.dataset.navigation?.includes('test-inspection'))
    assert.deepEqual(posts.map(item => item.payload), [{ earlyStartReason: 'Kunden har inte hunnit godkänna.', confirmEarlyStart: true }])

    await page.goto(`${base}/boundary`, { waitUntil: 'networkidle0' })
    assert.equal(await page.$eval('#test-note', node => node.matches(':disabled')), false)
    assert.equal(await page.$('details'), null)
    workflow = { ...workflow, acceptedAt: '2026-09-10T09:00:00Z', bookedAt: '2026-09-10T09:05:00Z', status: 'booked', reason: 'Kundens uppgifter och tillägg behöver stämmas av mot besiktningen.' }
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForSelector('details'); await page.click('summary')
    assert.equal(await page.$eval('details button', node => node.disabled), true)
    await page.click('details input[type=checkbox]')
    assert.equal(await overflow(), false)
    await page.screenshot({ path: resolve(output, `review-${width}.png`), fullPage: true })
    reviewFails = true; await click('Bekräfta avstämning'); await page.waitForSelector('[role=alert]')
    assert.equal(await page.$eval('#test-note', node => node.matches(':disabled')), true)
    reviewFails = false; await page.click('[aria-label="Uppdatera uppdragsstatus"]')
    await page.waitForFunction(() => !document.querySelector('[role=alert]'))
    await click('Bekräfta avstämning')
    await page.waitForFunction(() => document.body.textContent.includes('Uppdrag godkänt och avstämt'))
    assert.equal(posts.at(-1).payload.confirmed, true)
    assert.equal(posts.at(-1).payload.reviewToken, 'test-review-token')
    workflow = { ...workflow, paused: true, canDeliver: false, reason: 'Arbetet är pausat.' }
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForFunction(() => document.querySelector('#test-note').matches(':disabled'))
    await page.screenshot({ path: resolve(output, `paused-${width}.png`) })
    readFails = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForSelector('[role=alert]'); assert.equal(await page.$eval('#test-note', node => node.matches(':disabled')), true)
    reset()
    await page.goto(`${base}/boundary?round`, { waitUntil: 'networkidle0' })
    assert.equal(await page.$eval('body', node => node.textContent.includes('Startad före godkännande')), false)
    assert.equal(await page.$eval('#test-note', node => node.matches(':disabled')), false)
    workflow = { ...workflow, paused: true }
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForFunction(() => document.querySelector('#test-note').matches(':disabled'))
    readFails = true
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForSelector('[role=alert]')
    assert.equal(await page.$eval('#test-note', node => node.matches(':disabled')), true)
  }
  reset()
  assignment.inspection_id = workflow.inspectionId
  assignment.property_id = 'test-property'
  await page.goto(base, { waitUntil: 'networkidle0' })
  const bookingButtonDisabled = () => page.$$eval('button', nodes => nodes.find(node => node.textContent.trim() === 'Acceptera uppdrag').disabled)
  assert.equal(await bookingButtonDisabled(), true)
  assignment.status = 'ordered'; assignment.accepted_at = '2026-09-10T09:00:00Z'
  workflow = { ...workflow, status: 'ordered', acceptedAt: assignment.accepted_at }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(node => node.textContent.trim() === 'Acceptera uppdrag')?.disabled)
  assert.equal(await bookingButtonDisabled(), false, 'late approval refreshes the assignment actions as well as the workflow panel')
  assert.deepEqual(errors, [])
  console.log('PASS: desktop/mobile start consent, Escape, review conflicts, draft editing, pause, failure-closed behavior and overflow.')
} catch (error) {
  if (page) {
    console.error(await page.$eval('body', node => node.innerText))
    await page.screenshot({ path: resolve(output, 'failure.png') })
  }
  throw error
} finally { await browser?.close(); await new Promise(ok => server.close(ok)) }
