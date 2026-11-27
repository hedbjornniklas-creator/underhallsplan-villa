// Real editors and autosave hook; loopback-only fictional transport, no production writes.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import puppeteer from 'puppeteer-core'
import { normalizeCostLine } from '../src/lib/action-cases/costing.ts'

const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/calculation-row-ui')
const preview = process.argv.includes('--preview')
const evidence = resolve(process.env.GIZMO_ROW_EVIDENCE ?? 'C:/Users/hedbj/underhallsplan-villa/output/gizmo-calculation-row-20261127')
await mkdir(output, { recursive: true }); await mkdir(evidence, { recursive: true })
if (!preview) await new Promise((done, fail) => webpack({ mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) }), new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })],
  entry: resolve('test/fixtures/calculation-row-view.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/supabaseClient$': resolve('test/helpers/instruction-supabase-stub.ts'), '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : done()))
const source = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks";')
let css = preview ? await readFile(resolve(output, 'style.css'), 'utf8') : (await postcss([tailwind()]).process(source, { from: resolve('src/app/globals.css') })).css
if (!preview) {
  for (const file of ['uppdrag-theme.css', 'action-case-costs.css']) css += '\n' + await readFile(`src/components/tasks/${file}`, 'utf8')
  await writeFile(resolve(output, 'style.css'), css)
}
const js = await readFile(resolve(output, 'view.js'))
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let item, failNext = false, mutations = 0, saves = 0, version = 0
function reset() {
  failNext = false; mutations = 0; saves = 0; version = 0
  item = { id: id(2), title: 'Testmoment', scope: 'Oförändrad omfattning', status: 'pricing_needed', updatedAt: '2026-11-27T08:00:00.000Z',
    scopeNotesAvailable: true, costLines: [
      { id: id(3), description: 'Montering', category: 'own_labor', unit: 'tim', quantity: 4, unitCost: 500, markupPercent: 20, pricingMethod: 'direct', quotes: [], vatRate: 25, quantityBasis: 'provided', priceSource: 'manual', verified: false, updatedAt: '2026-11-27T08:00:00.000Z' },
      { id: id(4), description: 'Befintligt material', category: 'material', unit: 'st', quantity: 1, unitCost: 0, markupPercent: 0, pricingMethod: 'direct', quotes: [], vatRate: 25, quantityBasis: 'provided', priceSource: 'manual', verified: false },
    ] }
}
reset()
const bytes = async req => { const parts = []; for await (const chunk of req) parts.push(chunk); return Buffer.concat(parts).toString('utf8') }
const server = createServer(async (req, res) => {
  const path = new URL(req.url, `http://${req.headers.host}`).pathname
  const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
  try {
    if (path === '/view.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(js) }
    if (path === '/style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css) }
    if (path.startsWith('/uppdrag/brand/')) return res.end(await readFile(resolve('public', path.slice(1))))
    if (path === '/test/item') return json(item)
    if (path === '/api/action-cases' && req.method === 'POST') {
      const { action, payload } = JSON.parse(await bytes(req)); assert.equal(action, 'save_calculation'); saves++
      await new Promise(done => setTimeout(done, 350))
      if (failNext) { failNext = false; return json({ error: 'Fiktivt sparfel' }, 503) }
      assert.equal(payload.expectedUpdatedAt, item.updatedAt)
      const before = item.updatedAt, data = payload.data
      const updatedAt = new Date(Date.UTC(2026, 10, 27, 8, 0, ++version)).toISOString()
      if (payload.operation === 'delete_line') item.costLines = item.costLines.filter(line => line.id !== data.id)
      else if (payload.operation === 'line') {
        const previous = item.costLines.find(line => line.id === data.id)
        const next = { ...previous, ...normalizeCostLine(data), id: data.id, updatedAt }
        item.costLines = previous ? item.costLines.map(line => line.id === data.id ? next : line) : [...item.costLines, next]
      } else throw Error(`Unexpected operation ${payload.operation}`)
      item.updatedAt = updatedAt
      return json({ requestId: payload.requestId, caseId: id(1), expectedUpdatedAt: before, updatedAt, item })
    }
    if (path === '/test/action') {
      const { name, payload } = JSON.parse(await bytes(req)); mutations++
      assert.equal(name, 'work_quote'); assert.equal(payload.operation, 'method'); assert.equal(payload.method, 'direct'); assert.equal(payload.costLineId, id(3))
      item.costLines[0] = { ...item.costLines[0], pricingMethod: 'direct', category: 'own_labor', selectedQuoteId: null, quantity: 4, unit: 'tim', unitCost: 500 }
      return json(item)
    }
    if (path !== '/') return json({ error: 'Not found' }, 404)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html lang="sv"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/view.js"></script></html>')
  } catch (error) { json({ error: error.message }, 500) }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const url = `http://127.0.0.1:${server.address().port}`
if (preview) { console.log(`Fictional calculation preview: ${url}`); await new Promise(() => {}) }
let browser, page
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  page = await browser.newPage()
  const errors = [], external = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', req => { const target = new URL(req.url()), allowed = target.origin === url || target.protocol === 'data:'; if (!allowed) external.push(req.url()); void (allowed ? req.continue() : req.abort()) })
  const button = text => ({ click: async () => {
    await page.waitForFunction(text => [...document.querySelectorAll('button')].some(node => node.textContent.trim() === text && !node.disabled), {}, text)
    const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text), text)
    assert.ok(await handle.evaluate(node => Boolean(node)), `Button ${text}`)
    await page.waitForFunction(node => !node.disabled, {}, handle)
    await handle.asElement().click(); await handle.dispose()
  } })
  const open = () => page.locator('[aria-label="Redigera Montering"]').click()
  const hasForm = () => page.$('form input[name="description"]')
  const noOverflow = async () => {
    const layout = await page.$eval('[role="dialog"]', node => ({ width: node.clientWidth, scroll: node.scrollWidth, offenders: [...node.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > node.getBoundingClientRect().right + 1).map(el => ({ tag: el.tagName, class: el.className, text: el.textContent.slice(0, 90), width: el.getBoundingClientRect().width })).slice(0, 10) }))
    assert.ok(layout.scroll <= layout.width, JSON.stringify(layout))
  }
  for (const width of [344, 1365, 390]) {
    reset(); await page.setViewport({ width, height: 980 }); await page.goto(url, { waitUntil: 'networkidle0' })
    await open(); await page.waitForSelector('form input[name="description"]')
    assert.ok(await hasForm()); assert.equal(await page.$('.gizmo-cost-row-header [role="status"]') !== null, true)
    assert.equal(await page.$$eval('button', nodes => nodes.some(node => /Stäng rad|Stäng detaljer/.test(node.textContent))), false)
    assert.equal(await page.$eval('.gizmo-cost-row-header [aria-label^="Ta bort rad:"]', node => node.parentElement.className), 'gizmo-cost-row-header')
    await button('Leverantörsofferter').click(); await page.waitForSelector('[aria-label^="Prisunderlag för"]')
    assert.ok(await hasForm()); await button('Leverantörsofferter').click()
    assert.ok(await hasForm()); assert.equal(await page.$('[aria-label^="Prisunderlag för"]'), null)
    await noOverflow()
    await page.$eval('.gizmo-cost-row-header', node => node.scrollIntoView({ block: 'start' }))
    const header = await page.$eval('.gizmo-cost-row-header', node => {
      const title = node.querySelector('.gizmo-cost-row-toggle').getBoundingClientRect(), status = node.querySelector('[role="status"]').getBoundingClientRect(), remove = node.querySelector('.gizmo-cost-row-delete').getBoundingClientRect()
      return { overlaps: title.right > status.left || status.right > remove.left, sameLine: Math.abs(title.top - remove.top) < 10 }
    })
    assert.equal(header.overlaps, false); assert.equal(header.sameLine, true)
    await page.screenshot({ path: resolve(evidence, `row-${width}.png`), fullPage: true })
    await button('Redigera kalkylrad').click(); assert.equal(await hasForm(), null)
    assert.equal(await page.$eval('[aria-label="Redigera Montering"]', node => document.activeElement === node), true)
    await open(); await open(); assert.equal(await hasForm(), null)
    assert.equal(saves, 0); assert.equal(mutations, 0)
    await open()
    await page.locator('input[name="reservePercent"]').fill('5'); await page.locator('input[name="markupPercent"]').fill('10')
    await page.waitForFunction(() => { const row = JSON.parse(document.querySelector('[data-testid="saved-item"]').textContent).costLines[0]; return row.reservePercent === 5 && row.markupPercent === 10 })
    assert.match(await page.$eval('td[data-label="Kundpris exkl. moms"]', node => node.textContent), /2\s?310,00/)
    await page.locator('input[name="quantity"]').fill('8')
    await button('Redigera kalkylrad').click()
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="saved-item"]').textContent).costLines[0].quantity === 8)
    await open(); assert.equal(await page.$eval('input[name="quantity"]', node => node.value), '8')
    failNext = true; await page.locator('input[name="quantity"]').fill('9')
    await page.waitForFunction(() => document.querySelector('.gizmo-cost-row-header')?.textContent.includes('Kunde inte spara'))
    await button('Redigera kalkylrad').click()
    await page.locator('.gizmo-cost-name button[title="Fiktivt sparfel"]').click()
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="saved-item"]').textContent).costLines[0].quantity === 9)
    await open(); await button('Leverantörsofferter').click(); await button('Registrera offert').click()
    await page.locator('input[name="supplierName"]').fill('Fiktiv leverantör')
    assert.equal(await page.$eval('[aria-label="Redigera Montering"]', node => node.disabled), true)
    assert.equal(await page.$eval('.gizmo-cost-row-quotes > button', node => node.disabled), true)
    await button('Avbryt').click()
    await page.locator('[aria-label="Ta bort rad: Montering"]').click()
    assert.equal(item.costLines.length, 2); await button('Avbryt').click(); assert.equal(item.costLines.length, 2)
    await page.locator('[aria-label="Ta bort rad: Montering"]').click(); await button('Ta bort').click()
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="saved-item"]').textContent).costLines.length === 1)
    assert.equal(item.scope, 'Oförändrad omfattning'); assert.equal(item.costLines[0].unitCost, 0); assert.equal(mutations, 0)
    await noOverflow(); console.log(`Passed calculation row at ${width}px`)
  }
  reset()
  item.costLines[0] = { ...item.costLines[0], pricingMethod: 'quotes', category: 'subcontractor', unit: 'uppdrag', quantity: 1, unitCost: 3000, selectedQuoteId: id(5), quotes: [{ id: id(5), supplierName: 'Testleverantör', amount: 3000, checked: true, coveredLineIds: [], deliveryStatus: 'draft', scopeSnapshot: item.scope, descriptionSnapshot: 'Montering' }] }
  await page.goto(url, { waitUntil: 'networkidle0' }); await page.waitForSelector('[aria-label="Redigera Montering"]'); await open()
  assert.equal(await hasForm(), null)
  await button('Använd egen kalkyl').click()
  await page.waitForSelector('form input[name="description"]')
  assert.equal(await page.$eval('input[name="quantity"]', node => node.value), '4')
  assert.equal(await page.$eval('input[name="unitCost"]', node => node.value), '500')
  await button('Leverantörsofferter (1)').click(); assert.ok(await hasForm()); assert.equal(mutations, 1)
  reset(); await page.goto(`${url}/?locked=1`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[aria-label="Redigera Montering"]')
  assert.equal(await page.$eval('[aria-label="Redigera Montering"]', node => node.disabled), true)
  assert.equal(saves, 0); assert.equal(mutations, 0); assert.deepEqual(errors, []); assert.deepEqual(external, [])
  await writeFile(resolve(evidence, 'result.json'), JSON.stringify({ passed: true, widths: [1365, 390, 344], realAutosaveHook: true, reserveBeforeFee: true, productionWrites: 0, externalRequests: 0, lockedContractProtected: true }, null, 2))
  console.log(`UI passed. Evidence: ${evidence}`)
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(evidence, 'failure.png'), fullPage: true }).catch(() => undefined)
    await writeFile(resolve(evidence, 'failure.txt'), await page.$eval('body', node => node.innerText)).catch(() => undefined)
  }
  throw error
} finally { await browser?.close(); await new Promise(done => server.close(done)) }
