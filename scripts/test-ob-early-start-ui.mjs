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
    acceptedAt: null, bookedAt: null, initialSnapshot: { customer_name: 'Testkund', customer_phone: null, addons: [] },
    currentSnapshot: { customer_name: 'Uppdaterad Testkund', customer_phone: '0701234567', addons: [{ key: 'area', name: 'Areamätning', price: 500, currency: 'SEK' }], terms_document_hash: 'a'.repeat(64) },
    inspectionSnapshot: { customer_name: 'Besiktningsmannens namn', customer_phone: null },
    reconciliationToken: 'test-reconciliation-token', inspectionLocked: false,
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
    if (route.endsWith('/fixture-grunddata')) {
      if (payload.fail) { response.statusCode = 500; response.end(JSON.stringify({ error: 'Synthetic failed Grunddata save' })); return }
      workflow = { ...workflow, inspectionSnapshot: { ...workflow.inspectionSnapshot, customer_name: payload.customer_name },
        reconciliationToken: `${workflow.reconciliationToken}-name-saved` }
      response.end(JSON.stringify({ saved: true }))
    } else if (route.endsWith('/convert')) response.end(JSON.stringify({ propertyId: 'test-property', inspectionId: 'test-inspection' }))
    else if (route.endsWith('/assignment-workflow')) {
      if (reviewFails) { response.statusCode = 409; response.end(JSON.stringify({ error: 'Uppdragsbekräftelsen har ändrats. Uppdatera sidan.' })); return }
      assert.equal(payload.reviewToken, workflow.reviewToken)
      assert.equal(payload.reconciliationToken, workflow.reconciliationToken)
      assert.equal(payload.confirmed, true)
      assert.ok(Array.isArray(payload.fields))
      const inspectionSnapshot = { ...workflow.inspectionSnapshot }
      for (const field of payload.fields) inspectionSnapshot[field] = workflow.currentSnapshot[field]
      workflow = { ...workflow, inspectionSnapshot,
        reconciliationToken: `${workflow.reconciliationToken}-updated`, canDeliver: true, needsReview: false, reason: null }
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
  const fieldCheckbox = label => `input[aria-label="Använd kundens uppgift: ${label}"]`
  const confirmation = 'input[aria-label="Bekräfta avstämningen"]'
  const saveLabel = 'Uppdatera Grunddata och bekräfta avstämning'
  const setAccepted = () => {
    workflow = { ...workflow, acceptedAt: '2026-09-10T09:00:00Z', bookedAt: '2026-09-10T09:05:00Z', status: 'booked', reason: 'Kundens uppgifter och tillägg behöver stämmas av mot besiktningen.' }
  }
  async function expectDisabledButton(label, expected = true) {
    assert.equal(await page.$$eval('button', (buttons, text) => buttons.find(button => button.textContent.trim() === text)?.disabled, label), expected, label)
  }
  async function openComparison() {
    await page.waitForSelector('details')
    if (!await page.$eval('details', node => node.open)) await page.click('summary')
    await page.waitForFunction(() => !document.querySelector('details')?.textContent.includes('Hämtar aktuell jämförelse...'))
  }
  for (const width of [1440, 390, 320]) {
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
    await page.type('#test-note', 'En redan påbörjad notering.')
    assert.equal(await page.$('details'), null)
    setAccepted()
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await openComparison()
    assert.equal(await page.$eval('#test-note', node => node.matches(':disabled')), true, 'Grunddata editing pauses while comparing customer data')
    await expectDisabledButton(saveLabel)
    assert.equal(await page.$eval(fieldCheckbox('Telefon'), node => node.checked), true, 'new phone defaults to import when Grunddata is empty')
    assert.equal(await page.$eval(fieldCheckbox('Kund'), node => node.checked), false, 'inspector-edited name is not overwritten by default')
    assert.ok(await page.$eval('details', node => node.textContent.includes('Besiktningsmannens namn')), 'comparison shows current Grunddata, not the initial assignment value')
    await page.click(confirmation)
    assert.equal(await overflow(), false)
    assert.equal(await page.$eval('details', node => node.scrollWidth > node.clientWidth), false)
    await page.screenshot({ path: resolve(output, `review-${width}.png`), fullPage: true })
    reviewFails = true; await click(saveLabel); await page.waitForSelector('[role=alert]')
    assert.equal(await page.$eval('#test-note', node => node.matches(':disabled')), true)
    assert.equal(await page.$eval(confirmation, node => node.checked), false, 'a stale review must be explicitly confirmed again')
    assert.equal(await page.$eval('#test-phone', node => node.textContent), '', 'a failed import must not optimistically change Grunddata')
    assert.equal(await page.$eval('#test-updated-fields', node => node.textContent), '')
    await expectDisabledButton(saveLabel)
    workflow = { ...workflow, reviewToken: 'fresh-review-token', reconciliationToken: 'fresh-reconciliation-token' }
    reviewFails = false; await page.click('[aria-label="Uppdatera uppdragsstatus"]')
    await page.waitForFunction(() => !document.querySelector('[role=alert]'))
    await expectDisabledButton(saveLabel)
    await page.click(confirmation)
    await click(saveLabel)
    await page.waitForFunction(() => document.body.textContent.includes('Uppdrag godkänt och avstämt'))
    assert.equal(posts.at(-1).payload.confirmed, true)
    assert.equal(posts.at(-1).payload.reviewToken, 'fresh-review-token')
    assert.equal(posts.at(-1).payload.reconciliationToken, 'fresh-reconciliation-token')
    assert.deepEqual(posts.at(-1).payload.fields, ['customer_phone'])
    assert.equal(workflow.inspectionSnapshot.customer_phone, '0701234567')
    assert.equal(workflow.inspectionSnapshot.customer_name, 'Besiktningsmannens namn')
    assert.equal(await page.$eval('#test-phone', node => node.textContent), '0701234567', 'successful reconciliation refreshes the displayed Grunddata without reload')
    assert.equal(await page.$eval('#test-customer', node => node.textContent), 'Besiktningsmannens namn')
    assert.equal(await page.$eval('#test-updated-fields', node => node.textContent), 'customer_phone')
    assert.equal(await page.$eval('#test-note', node => node.value), 'En redan påbörjad notering.', 'reconciliation does not reload or discard inspection edits')
    assert.ok(await page.$eval('summary', node => node.textContent.includes('Jämför kundens uppgifter med Grunddata')), 'already acknowledged reviews remain reopenable')
    await openComparison()
    assert.equal(await page.$eval(fieldCheckbox('Kund'), node => node.checked), false)
    await page.click(fieldCheckbox('Kund'))
    await page.click(confirmation)
    await click(saveLabel)
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(node => node.textContent.trim() === 'Sparar...'))
    assert.deepEqual(posts.at(-1).payload.fields, ['customer_name'], 'a conflict is imported only by an explicit choice')
    assert.equal(workflow.inspectionSnapshot.customer_name, 'Uppdaterad Testkund')
    assert.equal(await page.$eval('#test-customer', node => node.textContent), 'Uppdaterad Testkund')
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
  reset(); setAccepted()
  await page.goto(`${base}/boundary`, { waitUntil: 'networkidle0' })
  await openComparison()
  await page.click(fieldCheckbox('Telefon'))
  await page.click(confirmation)
  await click('Bekräfta avstämning')
  await page.waitForFunction(() => document.body.textContent.includes('Uppdrag godkänt och avstämt'))
  assert.deepEqual(posts.at(-1).payload.fields, [], 'acknowledgement without import leaves Grunddata untouched')
  assert.equal(workflow.inspectionSnapshot.customer_phone, null)
  assert.equal(workflow.inspectionSnapshot.customer_name, 'Besiktningsmannens namn')
  await page.reload({ waitUntil: 'networkidle0' })
  await openComparison()
  assert.equal(await page.$eval(fieldCheckbox('Telefon'), node => node.checked), true, 'previously acknowledged missing phone can still be imported after reopening the inspection')
  await page.click(confirmation)
  await click(saveLabel)
  await page.waitForFunction(() => document.querySelector('#test-phone').textContent === '0701234567')
  assert.deepEqual(posts.at(-1).payload.fields, ['customer_phone'])
  reset(); setAccepted(); workflow.inspectionLocked = true
  await page.goto(`${base}/boundary`, { waitUntil: 'networkidle0' })
  await openComparison()
  assert.equal(await page.$eval(fieldCheckbox('Telefon'), node => node.disabled), true, 'locked inspection cannot import customer details')
  assert.equal(posts.length, 0)
  reset(); setAccepted()
  delete workflow.inspectionSnapshot; delete workflow.reconciliationToken; delete workflow.inspectionLocked
  await page.goto(`${base}/boundary`, { waitUntil: 'networkidle0' })
  await openComparison()
  assert.equal(await page.$$eval('input[aria-label^="Använd kundens uppgift:"]', nodes => nodes.every(node => node.disabled)), true, 'old backend must not expose editable import controls')
  assert.equal(await page.$$eval('details button', nodes => nodes.every(node => node.disabled)), true, 'migration absence must not pretend to import Grunddata')
  assert.equal(posts.length, 0)
  reset(); setAccepted()
  await page.goto(`${base}/boundary?failed-grunddata`, { waitUntil: 'networkidle0' })
  await page.click('#test-customer-name-input', { clickCount: 3 })
  await page.type('#test-customer-name-input', 'Besiktningsmannens nya kundnamn')
  await openComparison()
  await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent.includes('En ändring i Grunddata kunde inte sparas.'))
  assert.equal(await page.$eval('#test-name-save-status', node => node.textContent), 'failed')
  assert.equal(await page.$eval('#test-customer-name-input', node => node.value), 'Besiktningsmannens nya kundnamn', 'failed blur save must preserve the typed name')
  assert.equal(await page.$eval('#test-customer', node => node.textContent), 'Besiktningsmannens namn', 'failed save must not update saved props')
  await expectDisabledButton(saveLabel)
  assert.equal(posts.filter(item => item.route.endsWith('/assignment-workflow')).length, 0, 'unsaved Grunddata cannot be reconciled')
  await page.click('summary')
  assert.equal(await page.$eval('#test-customer-name-input', node => node.matches(':disabled')), false, 'closing failed comparison must allow the inspector to retry the save')
  await page.click('#test-allow-name-save')
  await page.focus('#test-customer-name-input')
  await openComparison()
  await page.waitForFunction(() => !document.querySelector('[role=alert]'))
  assert.equal(await page.$eval('#test-name-save-status', node => node.textContent), 'saved')
  assert.equal(await page.$eval('#test-customer', node => node.textContent), 'Besiktningsmannens nya kundnamn')
  assert.ok(await page.$eval('details', node => node.textContent.includes('Besiktningsmannens nya kundnamn')), 'retry success refreshes comparison against the newly saved name')
  assert.equal(await page.$eval(fieldCheckbox('Kund'), node => node.checked), false)
  assert.equal(await page.$eval(fieldCheckbox('Telefon'), node => node.checked), true)
  await page.click(confirmation)
  await click(saveLabel)
  await page.waitForFunction(() => document.querySelector('#test-phone').textContent === '0701234567')
  assert.deepEqual(posts.filter(item => item.route.endsWith('/assignment-workflow')).map(item => item.payload.fields), [['customer_phone']])
  assert.equal(workflow.inspectionSnapshot.customer_name, 'Besiktningsmannens nya kundnamn')
  assert.equal(await page.$eval('#test-customer-name-input', node => node.value), 'Besiktningsmannens nya kundnamn')
  assert.equal(await overflow(), false)
  await page.screenshot({ path: resolve(output, 'grunddata-save-recovery-320.png') })
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
  console.log('PASS: desktop/mobile start consent, selective Grunddata import, explicit conflicts, stale-review and failed-save recovery, reopened reconciliation, locked/migration safeguards, draft editing, pause and overflow.')
} catch (error) {
  if (page) {
    console.error(await page.$eval('body', node => node.innerText))
    await page.screenshot({ path: resolve(output, 'failure.png') })
  }
  throw error
} finally { await browser?.close(); await new Promise(ok => server.close(ok)) }
