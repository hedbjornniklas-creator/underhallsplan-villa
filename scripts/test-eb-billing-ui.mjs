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
const output = resolve('tmp/eb-billing-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/eb-billing-preview.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/lib/supabaseClient': resolve('test/helpers/eb-overview-client.ts'),
    'next/link': resolve('test/helpers/eb-overview-navigation.tsx'),
    'next/navigation': resolve('test/helpers/eb-overview-navigation.tsx'), '@': resolve('src'),
  } },
  module: { rules: [
    { test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') },
    { test: /\.css$/, type: 'asset/source' },
  ] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const css = await postcss([tailwind()]).process((await readFile('src/app/globals.css', 'utf8'))
  .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/eb";\n@source "../components/ui";'), { from: resolve('src/app/globals.css') })
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
const checkbox = `${panel} input[type=checkbox]`
const number = `${panel} input:not([type=checkbox])`
const dialog = '.fixed.inset-0.z-\\[100\\]'
async function clickText(text) {
  assert.ok(await page.evaluate(text => {
    const node = [...document.querySelectorAll('button,summary')].find(node => node.checkVisibility() && node.textContent.trim() === text)
    node?.click(); return Boolean(node)
  }, text), `Visible button: ${text}`)
}
async function openBilling() {
  await clickText('Hantera')
  await clickText('Fakturering')
  await page.waitForSelector(`${checkbox}:not([disabled])`)
}
async function saved(revision) { await page.waitForFunction(revision => window.__ebBillingTest.billing.revision === revision, {}, revision); await page.waitForSelector(`${checkbox}:not([disabled])`) }
async function fresh(locked = true) { await page.goto(`${base}/?locked=${locked}`, { waitUntil: 'networkidle0' }); await page.waitForSelector('summary'); await openBilling() }
async function typeNumber(value) { await page.click(number, { clickCount: 3 }); await page.type(number, value) }
try {
  for (const width of [390, 1440]) {
    await page.setViewport({ width, height: 1000 })
    await fresh()
    assert.equal(await page.$eval(checkbox, node => node.checked), false)
    assert.equal(await page.$eval('[role=tab][aria-selected=true]', node => node.textContent), 'Fakturering')
    assert.equal(await page.$$eval('[role=tab]:not([disabled])', nodes => nodes.length), 1, 'Only billing tab editable on a locked report')
    assert.equal(await page.$eval('#inspection-details-billing fieldset', node => node.disabled), true, 'Locked billing recipient/report fields remain read-only')
    assert.equal(await page.$eval(dialog, node => Boolean(node.querySelector('button[type=submit]'))), false, 'Locked report cannot submit ordinary metadata')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}: page overflow`)
    assert.equal(await page.$eval(dialog, node => node.firstElementChild.scrollWidth > node.firstElementChild.clientWidth + 1), false, `${width}: dialog overflow`)
    assert.equal(await page.evaluate(() => window.__ebBillingTest.reads.some(url => /\/(invitation|documents)$/.test(url))), false, 'Locked billing does not load report-editing data')
    await typeNumber('2026-1043')
    if (width === 390) await page.click(`${panel} label:first-of-type`, { offset: { x: 90, y: 20 } })
    else await page.click(checkbox)
    await saved(1)
    assert.equal(await page.evaluate(() => window.__ebBillingTest.writes.length), 1, 'Editing number then checking sends one combined update')
    assert.equal(await page.$eval(checkbox, node => node.checked), true)
    assert.equal(await page.$eval(number, node => node.value), '2026-1043')
    assert.match(await page.$eval(panel, node => node.textContent), /Testperson/)
    await page.screenshot({ path: resolve(output, `eb-billing-locked-${width}.png`) })
    await page.click(checkbox)
    await saved(2)
    assert.equal(await page.$eval(checkbox, node => node.checked), false)
    assert.equal(await page.$eval(number, node => node.value), '2026-1043', 'Reversing mark retains invoice number for manual correction')
    assert.ok(await page.evaluate(() => window.__ebBillingTest.writes.every(item => item.url.endsWith('/billing'))))
    console.log(`EB billing ${width}: locked report accessible, read-only fields, mark/unmark, combined number update, audit display, layout passed.`)
  }
  await fresh()
  await page.evaluate(() => { window.__ebBillingTest.delay = 350; window.__ebBillingTest.fail = 500 })
  await page.click(checkbox)
  assert.equal(await page.$eval(checkbox, node => node.checked), false, 'No optimistic checked state before confirmation')
  await page.waitForSelector(`${checkbox}[disabled]`)
  await page.waitForSelector(`${panel} [role=alert]`)
  assert.equal(await page.$eval(checkbox, node => node.checked), false, 'Save failure leaves confirmed state unchanged')
  await page.evaluate(() => { window.__ebBillingTest.fail = 0 })
  await clickText('Försök spara igen')
  await saved(1)
  await page.evaluate(() => { window.__ebBillingTest.billing.revision++; window.__ebBillingTest.delay = 0 })
  await typeNumber('STÅR KVAR')
  await page.keyboard.press('Enter')
  await page.waitForSelector(`${panel} [role=alert]`)
  assert.match(await page.$eval(`${panel} [role=alert]`, node => node.textContent), /ändrades av någon annan/)
  assert.equal(await page.$eval(number, node => node.value), 'STÅR KVAR', '409 does not discard typed draft')
  await clickText('Hämta aktuell status')
  await page.waitForSelector(`${panel} [role=alert]`, { hidden: true })
  console.log('EB billing: slow saves, confirmed state only, error/retry, stale revision and explicit reload passed.')

  for (const method of ['cross', 'escape', 'tab']) {
    console.log(`EB billing: testing stale ${method}…`)
    await fresh(method !== 'tab')
    await page.evaluate(() => { window.__ebBillingTest.billing.revision++ })
    await typeNumber(`KONFLIKT-${method}`)
    await page.keyboard.press('Enter')
    await page.waitForSelector(`${panel} [role=alert]`)
    if (method === 'cross') await page.click(`${dialog} button[aria-label=Stäng]`)
    if (method === 'escape') await page.keyboard.press('Escape')
    if (method === 'tab') await page.click('#inspection-details-tab-time')
    await page.waitForFunction(() => window.__ebBillingTest.writes.length >= 2)
    await page.waitForSelector(`${panel} [role=alert]`)
    assert.equal(await page.$eval(number, node => node.value), `KONFLIKT-${method}`, 'Stale close/tab preserves invoice-number draft')
  }
  console.log('EB billing: 409 followed by cross/Escape/tab preserves the draft and keeps the billing panel open.')

  for (const method of ['cross', 'escape', 'overlay']) {
    await fresh()
    await page.evaluate(() => { window.__ebBillingTest.delay = 250 })
    await typeNumber(`SNABB-${method}`)
    if (method === 'cross') await page.click(`${dialog} button[aria-label=Stäng]`)
    if (method === 'escape') await page.keyboard.press('Escape')
    if (method === 'overlay') await page.mouse.click(2, 2)
    await page.waitForFunction(() => window.__ebBillingTest.billing.revision === 1)
    await page.waitForSelector(panel, { hidden: true })
    await openBilling()
    assert.equal(await page.$eval(number, node => node.value), `SNABB-${method}`)
  }
  await fresh()
  await page.evaluate(() => { window.__ebBillingTest.fail = 500 })
  await typeNumber('MISSLYCKAD')
  await page.keyboard.press('Escape')
  await page.waitForSelector(`${panel} [role=alert]`)
  assert.equal(await page.$eval(number, node => node.value), 'MISSLYCKAD', 'Failed close keeps dialog and text')
  await page.waitForSelector(`${dialog} button[aria-label=Stäng]:not([disabled])`)
  await page.waitForFunction(() => document.activeElement?.matches('[aria-label="Intern fakturamarkering"] input:not([type=checkbox])'))
  await page.evaluate(() => { window.__ebBillingTest.fail = 0 })
  await page.keyboard.press('Escape')
  await page.waitForSelector(panel, { hidden: true })
  console.log('EB billing: cross/Escape/overlay flush number, failed closing retains draft and retry succeeds.')

  await fresh(false)
  await typeNumber('FLIKBYTE')
  await page.click('#inspection-details-tab-time')
  await page.waitForFunction(() => window.__ebBillingTest.billing.revision === 1)
  await page.waitForSelector('#inspection-details-time')
  await page.click('#inspection-details-tab-billing')
  await page.waitForSelector(`${checkbox}:not([disabled])`)
  assert.equal(await page.$eval(number, node => node.value), 'FLIKBYTE')
  assert.deepEqual(errors, [])
  console.log('EB billing: unlocked report tab changes retain invoice number. All UI tests passed; no external requests or production writes.')
} catch (error) {
  console.error(await page.evaluate(() => ({ focus: document.activeElement?.outerHTML, state: window.__ebBillingTest, text: document.body.innerText.slice(-4000) })))
  await page.screenshot({ path: resolve(output, 'eb-billing-error.png'), fullPage: true })
  throw error
} finally { await browser.close(); server.close() }
