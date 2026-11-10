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
const output = resolve('tmp/tu-billing-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({ mode: 'development', devtool: false,
  entry: resolve('test/fixtures/tu-billing-preview.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } },
  module: { rules: [
    { test: /[.]tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') },
    { test: /[.]css$/, type: 'asset/source' },
  ] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const css = await postcss([tailwind()]).process((await readFile('src/app/globals.css', 'utf8'))
  .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tu";\n@source "../components/ui";\n@source "../../test/fixtures/tu-billing-preview.tsx";'), { from: resolve('src/app/globals.css') })
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
async function ready() {
  await page.waitForSelector(panel)
  await page.waitForFunction(() => !document.querySelector('[aria-label="Intern fakturamarkering"]').textContent.includes('Hämtar fakturastatus'))
}
async function fresh(query = '') { await page.goto(base + '/tu/investigations/10000000-0000-4000-8000-000000000001?' + query, { waitUntil: 'networkidle0' }); await ready() }
async function saved(revision) { await page.waitForFunction(n => window.__tuBillingTest.billing.revision === n, {}, revision); await page.waitForSelector(checkbox + ':not([disabled])') }
async function typeNumber(value) { await page.click(number, { clickCount: 3 }); await page.type(number, value) }
async function clickText(text) {
  assert.ok(await page.evaluate(text => {
    const button = [...document.querySelectorAll('button')].find(node => node.checkVisibility() && node.textContent.trim() === text)
    button?.click(); return Boolean(button)
  }, text), `Visible button: ${text}`)
}
async function orgGuard() {
  return page.evaluate(() => {
    const event = new Event('hushub:before-organization-switch', { cancelable: true })
    window.dispatchEvent(event); return event.defaultPrevented
  })
}
try {
  for (const width of [390, 960, 1440]) {
    await page.setViewport({ width, height: 1000 }); await fresh()
    assert.match(await page.$eval('#report-lock', node => node.textContent), /låst/)
    assert.equal(await page.$eval(checkbox, node => node.disabled), false, 'A locked report never disables independent internal billing')
    await typeNumber('2026-1043')
    await page.click(panel + ' label:first-of-type', { offset: { x: 90, y: 20 } })
    await saved(1)
    assert.equal(await page.evaluate(() => window.__tuBillingTest.writes.length), 1, 'Number and checkbox combine into one revision update')
    assert.equal(await page.$eval(checkbox, node => node.checked), true)
    assert.match(await page.$eval(panel, node => node.textContent), /Testperson/)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: resolve(output, `tu-billing-${width}.png`), fullPage: false })
    await page.click(checkbox); await saved(2)
    assert.equal(await page.$eval(checkbox, node => node.checked), false)
    assert.equal(await page.$eval(number, node => node.value), '2026-1043', 'Unmark retains the optional invoice number')
    assert.ok(await page.evaluate(() => window.__tuBillingTest.writes.every(row => /\/billing\?orgId=11111111-1111-4111-8111-111111111111$/.test(row.url))))
  }
  await fresh()
  await page.click(checkbox); await saved(1)
  assert.equal(await page.evaluate(() => window.__tuBillingTest.billing.invoiceNumber), null, 'Invoice number is optional')
  await fresh('readonly')
  assert.equal(await page.$$eval(panel + ' input', nodes => nodes.length), 0)
  assert.match(await page.$eval(panel, node => node.textContent), /Endast läsning/)
  const readonly = await page.evaluate(async () => (await (await fetch('/api/tu/investigations/10000000-0000-4000-8000-000000000001/billing?orgId=11111111-1111-4111-8111-111111111111')).json()).billing)
  assert.deepEqual(Object.keys(readonly), ['status'])
  await fresh('unavailable')
  assert.equal(await page.$eval(checkbox, node => node.disabled), true)
  assert.match(await page.$eval(panel + ' [role=alert]', node => node.textContent), /Databasstödet/)
  await fresh()
  await page.evaluate(() => { window.__tuBillingTest.fail = 500; window.__tuBillingTest.delay = 200 })
  await page.click(checkbox)
  assert.equal(await page.$eval(checkbox, node => node.checked), false, 'No optimistic mark before confirmation')
  await page.waitForSelector(panel + ' [role=alert]')
  assert.equal(await page.$eval(checkbox, node => node.checked), false)
  await page.evaluate(() => { window.__tuBillingTest.fail = 0 })
  await clickText('Försök spara igen'); await saved(1)
  await page.evaluate(() => { window.__tuBillingTest.billing.revision++; window.__tuBillingTest.delay = 0 })
  await typeNumber('KONFLIKT'); await page.keyboard.press('Enter')
  await page.waitForSelector(panel + ' [role=alert]')
  assert.match(await page.$eval(panel + ' [role=alert]', node => node.textContent), /ändrades av någon annan/)
  await page.click('#leave-delivery')
  assert.ok(await page.$(panel), 'A conflicted draft blocks a guarded section change')
  assert.equal(await page.$eval(number, node => node.value), 'KONFLIKT')
  await page.click('#force-hide'); await page.waitForSelector(panel, { hidden: true })
  await page.click('#show-delivery'); await ready()
  assert.equal(await page.$eval(number, node => node.value), 'KONFLIKT', 'Portal remount preserves the conflicted draft')
  await clickText('Hämta aktuell status'); await page.waitForSelector(panel + ' [role=alert]', { hidden: true })
  await page.evaluate(() => { window.__tuBillingTest.delay = 300 })
  await typeNumber('SIDBYTE'); await page.click('#leave-delivery')
  await page.waitForSelector(panel, { hidden: true })
  await page.waitForFunction(() => window.__tuBillingTest.billing.invoiceNumber === 'SIDBYTE')
  await page.click('#show-delivery'); await ready()
  assert.equal(await page.$eval(number, node => node.value), 'SIDBYTE')
  assert.equal(await page.evaluate(() => window.__tuBillingTest.writes.filter(row => row.body.invoiceNumber === 'SIDBYTE').length), 1)
  await typeNumber('OSPARAT')
  assert.equal(await orgGuard(), true, 'Dirty number blocks organization switch')
  await page.keyboard.press('Enter'); await page.waitForFunction(() => window.__tuBillingTest.billing.invoiceNumber === 'OSPARAT')
  await page.waitForSelector(checkbox + ':not([disabled])')
  await page.evaluate(() => { window.__tuBillingTest.delay = 500 })
  await page.click(checkbox)
  assert.equal(await orgGuard(), true, 'An in-flight save blocks organization switch')
  await saved(5)
  assert.equal(await orgGuard(), false, 'Saved billing does not prevent organization switch')
  await typeNumber('NAVIGATION'); await page.click('#other-investigation')
  await page.waitForFunction(() => document.querySelector('#current-scope').textContent.endsWith('000000000002'))
  await ready()
  assert.equal(await page.evaluate(() => window.__tuBillingTest.billing.invoiceNumber), 'NAVIGATION')
  assert.equal(await page.$eval(number, node => node.value), '', 'The next investigation never inherits the invoice number')
  await fresh()
  await page.evaluate(() => { window.__tuBillingTest.fail = 500 })
  await typeNumber('NAVIGATIONSFEL'); await page.click('#other-investigation')
  await page.waitForSelector(panel + ' [role=alert]')
  assert.ok(await page.$eval('#current-scope', node => node.textContent.endsWith('000000000001')))
  assert.equal(await page.$eval(number, node => node.value), 'NAVIGATIONSFEL')
  await page.evaluate(() => { window.__tuBillingTest.fail = 0 })
  await page.click('#other-investigation')
  await page.waitForFunction(() => document.querySelector('#current-scope').textContent.endsWith('000000000002'))
  await fresh()
  await page.evaluate(() => { window.__tuBillingTest.delay = 500 })
  await typeNumber('GAMMALT-SVAR'); await page.keyboard.press('Enter'); await page.click('#forced-org')
  await ready(); await page.waitForFunction(() => window.__tuBillingTest.billing.invoiceNumber === 'GAMMALT-SVAR')
  assert.equal(await page.$eval(number, node => node.value), '', 'Late responses cannot populate another organization')
  assert.equal(await page.evaluate(() => window.__tuBillingTest.changed.length), 0, 'An unmounted panel cannot publish an old update into its successor')
  await page.goto(base + '/tu/investigations/10000000-0000-4000-8000-000000000001?slowload', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(panel)
  await page.waitForFunction(() => window.__tuBillingTest.reads.length === 1)
  await page.click('#forced-investigation')
  await ready()
  assert.ok(await page.$eval('#current-scope', node => node.textContent.endsWith('000000000002')))
  assert.equal(await page.$eval(number, node => node.value), '')
  assert.deepEqual(errors, [])
  console.log('TU billing: three layouts, locked report, optional number, mark/unmark, readonly/unavailable, save/retry/conflict, persistent portal, navigation flush, organization guards and late-response isolation passed.')
} catch (error) {
  console.error(await page.evaluate(() => ({ scope: document.querySelector('#current-scope')?.textContent, state: window.__tuBillingTest, text: document.body.innerText.slice(-2500) })))
  await page.screenshot({ path: resolve(output, 'tu-billing-error.png'), fullPage: true }); throw error
} finally { await browser.close(); server.close() }
