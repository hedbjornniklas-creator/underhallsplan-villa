import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import puppeteer from 'puppeteer-core'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/ob-billing-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({ mode: 'development', devtool: false,
  entry: resolve('test/fixtures/ob-billing-preview.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/lib/supabaseClient': resolve('test/fixtures/ob-forms-client.ts'),
    'next/link': resolve('test/fixtures/ob-overview-navigation.tsx'),
    'next/navigation': resolve('test/fixtures/ob-overview-navigation.tsx'), '@': resolve('src'),
  } }, module: { rules: [
    { test: /[.]tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') },
    { test: /[.]css$/, type: 'asset/source' },
  ] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const css = await postcss([tailwind()]).process((await readFile('src/app/globals.css', 'utf8'))
  .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/ob";\n@source "../components/ui";'), { from: resolve('src/app/globals.css') })
const script = await readFile(resolve(output, 'view.js'))
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'")
  if (request.url === '/view.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))

const panel = '[aria-label="Intern fakturamarkering"]'
const checkbox = panel + ' input[type=checkbox]'
const number = panel + ' input:not([type=checkbox])'
async function ready() { await page.waitForSelector(panel); await page.waitForFunction(() => !document.querySelector('[aria-label="Intern fakturamarkering"]').textContent.includes('Hämtar fakturastatus')) }
async function fresh(query = '') { await page.goto(base + '/properties/10000000-0000-4000-8000-000000000099/ob/10000000-0000-4000-8000-000000000001?' + query, { waitUntil: 'networkidle0' }); await ready() }
async function saved(revision) { await page.waitForFunction(n => window.__obBillingTest.billing.revision === n, {}, revision); await page.waitForSelector(checkbox + ':not([disabled])') }
async function typeNumber(value) { await page.click(number, { clickCount: 3 }); await page.type(number, value) }
async function clickText(text) { await page.evaluate(text => [...document.querySelectorAll('button')].find(node => node.checkVisibility() && node.textContent.trim() === text)?.click(), text) }
try {
  for (const width of [390, 1440]) {
    await page.setViewport({ width, height: 1000 }); await fresh('workflowblocked')
    assert.equal(await page.$eval(checkbox, n => n.disabled), false, 'Workflow lock never substitutes owner permission')
    assert.equal(await page.$eval(checkbox, n => n.checked), false)
    await typeNumber('2026-1043')
    await page.click(panel + ' label:first-of-type', { offset: { x: 90, y: 20 } })
    await saved(1)
    assert.equal(await page.evaluate(() => window.__obBillingTest.writes.length), 1)
    assert.equal(await page.$eval(checkbox, n => n.checked), true)
    assert.match(await page.$eval(panel, n => n.textContent), /Testperson/)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: resolve(output, 'ob-billing-' + width + '.png'), fullPage: false })
    await page.click(checkbox); await saved(2)
    assert.equal(await page.$eval(checkbox, n => n.checked), false)
    assert.equal(await page.$eval(number, n => n.value), '2026-1043')
    console.log('OB billing ' + width + ': locked report, org-scoped checkbox+label, number, audit display and unmark passed.')
  }
  await fresh('readonly')
  assert.equal(await page.$$eval(panel + ' input', nodes => nodes.length), 0, 'Read-only colleagues have no editable billing controls or invoice number')
  assert.match(await page.$eval(panel, n => n.textContent), /Endast läsning/)
  const readonlyDto = await page.evaluate(async () => (await (await fetch('/api/ob/inspections/10000000-0000-4000-8000-000000000001/billing?orgId=11111111-1111-4111-8111-111111111111')).json()).billing)
  assert.deepEqual(Object.keys(readonlyDto), ['status'])
  assert.equal(await page.evaluate(() => window.__obBillingTest.writes.length), 0)
  await fresh('unavailable')
  assert.equal(await page.$eval(checkbox, n => n.disabled), true)
  assert.match(await page.$eval(panel + ' [role=alert]', n => n.textContent), /Databasstödet/)
  await fresh()
  await page.evaluate(() => { window.__obBillingTest.fail = 500; window.__obBillingTest.delay = 200 })
  await page.click(checkbox)
  assert.equal(await page.$eval(checkbox, n => n.checked), false)
  await page.waitForSelector(panel + ' [role=alert]')
  assert.equal(await page.$eval(checkbox, n => n.checked), false)
  await page.evaluate(() => { window.__obBillingTest.fail = 0 })
  await clickText('Försök spara igen'); await saved(1)
  await page.evaluate(() => { window.__obBillingTest.billing.revision++; window.__obBillingTest.delay = 0 })
  await typeNumber('KONFLIKT'); await page.keyboard.press('Enter')
  await page.waitForSelector(panel + ' [role=alert]')
  assert.match(await page.$eval(panel + ' [role=alert]', n => n.textContent), /ändrades av någon annan/)
  await page.click('#leave-delivery'); await page.waitForSelector(panel, { hidden: true })
  await page.click('#show-delivery'); await ready()
  assert.equal(await page.$eval(number, n => n.value), 'KONFLIKT', 'Section change never discards conflicted draft')
  await clickText('Hämta aktuell status'); await page.waitForSelector(panel + ' [role=alert]', { hidden: true })
  await page.evaluate(() => { window.__obBillingTest.delay = 300 })
  await typeNumber('SIDBYTE'); await page.click('#leave-delivery')
  await page.waitForFunction(() => window.__obBillingTest.billing.invoiceNumber === 'SIDBYTE')
  await page.click('#show-delivery'); await ready()
  assert.equal(await page.$eval(number, n => n.value), 'SIDBYTE')
  assert.equal(await page.evaluate(() => window.__obBillingTest.writes.filter(r => r.body.invoiceNumber === 'SIDBYTE').length), 1, 'Section blur and portal flush do not double-write')
  await typeNumber('OSPARAT')
  const guarded = await page.evaluate(() => {
    const original = window.confirm; window.confirm = () => false
    const event = new Event('hushub:before-organization-switch', { cancelable: true }); window.dispatchEvent(event)
    window.confirm = original; return event.defaultPrevented
  })
  assert.equal(guarded, true, 'Dirty invoice number participates in organization-switch guard')
  await page.keyboard.press('Enter'); await page.waitForFunction(() => window.__obBillingTest.billing.invoiceNumber === 'OSPARAT')
  await page.waitForSelector(checkbox + ':not([disabled])')
  await typeNumber('NAVIGATION'); await page.click('#other-inspection')
  await page.waitForFunction(() => document.querySelector('#current-inspection').textContent.endsWith('000000000002'))
  assert.equal(await page.evaluate(() => window.__obBillingTest.billing.invoiceNumber), 'NAVIGATION', 'Link navigation waits for invoice number')
  await fresh()
  await page.evaluate(() => { window.__obBillingTest.fail = 500 })
  await typeNumber('NAVIGATIONSFEL'); await page.click('#other-inspection')
  await page.waitForSelector(panel + ' [role=alert]')
  assert.ok(await page.$eval('#current-inspection', n => n.textContent.endsWith('000000000001')), 'Failed save prevents leaving inspection')
  assert.equal(await page.$eval(number, n => n.value), 'NAVIGATIONSFEL')
  await page.evaluate(() => { window.__obBillingTest.fail = 0 })
  await page.click('#other-inspection')
  await page.waitForFunction(() => document.querySelector('#current-inspection').textContent.endsWith('000000000002'))
  await ready()
  assert.equal(await page.$eval(number, n => n.value), '', 'New inspection never inherits previous invoice number')
  await fresh()
  await page.evaluate(() => { window.__obBillingTest.delay = 500 })
  await typeNumber('GAMMALT-SVAR'); await page.keyboard.press('Enter'); await page.click('#forced-inspection')
  await ready(); await page.waitForFunction(() => window.__obBillingTest.billing.invoiceNumber === 'GAMMALT-SVAR')
  assert.equal(await page.$eval(number, n => n.value), '', 'Late response cannot affect the newly mounted inspection')
  await fresh()
  const send = await page.$('button.obm-primary')
  assert.ok(send); await send.click()
  await page.waitForFunction(() => window.__obBillingTest.writes.some(r => r.url.endsWith('/report-delivery')))
  assert.equal(await page.evaluate(() => window.__obBillingTest.writes.filter(r => r.url.includes('/billing')).length), 0, 'Sending never sets billing')
  assert.equal(await page.evaluate(() => window.__obBillingTest.billing.status), 'not_invoiced')
  assert.deepEqual(errors, [])
  console.log('OB billing: read-only, migration unavailable, error/retry, 409, persistent section draft, pending flush, org guard and send-is-independent passed.')
} catch (error) {
  console.error(await page.evaluate(() => ({ focus: document.activeElement?.outerHTML, state: window.__obBillingTest, text: document.body.innerText.slice(-3500) })))
  await page.screenshot({ path: resolve(output, 'ob-billing-error.png'), fullPage: true }); throw error
} finally { await browser.close(); server.close() }
