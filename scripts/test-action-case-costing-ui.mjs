// Isolated production component, synthetic data, no external calls or customer writes.
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
const output = await mkdtemp(join(tmpdir(), 'action-case-costing-ui-'))
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/action-case-costing.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? new Error(stats.toString('errors-only'))) : ok()))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const js = await readFile(resolve(output, 'view.js'))
const server = createServer((request, response) => {
  if (request.url === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  await page.setRequestInterception(true)
  page.on('request', (request) => new URL(request.url()).hostname === '127.0.0.1' ? request.continue() : request.abort())
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  const url = `http://127.0.0.1:${server.address().port}`
  async function click(label) {
    const handle = await page.evaluateHandle((text) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === text), label)
    assert.ok(await handle.evaluate((node) => Boolean(node)), `Button ${label}`)
    await handle.asElement().click(); await handle.dispose()
  }
  async function noOverflow() {
    const result = await page.$eval('[role=dialog]', (node) => ({ width: node.clientWidth, scroll: node.scrollWidth, right: node.getBoundingClientRect().right, viewport: innerWidth }))
    assert.ok(result.scroll <= result.width + 1, JSON.stringify(result))
    assert.ok(result.right <= result.viewport + 1)
  }
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 900 })
    await page.goto(url, { waitUntil: 'networkidle0' })
    await click('Gå till kalkyl')
    await click('Föreslå kalkyl med AI')
    await page.waitForFunction(() => document.body.textContent.includes('AI bearbetar omfattningen'))
    await page.waitForFunction(() => document.body.textContent.includes('AI-förslag att granska'))
    await page.locator('label').filter((node) => node.textContent === 'Välj alla').click()
    await click('Lägg till valda (2)')
    await page.waitForFunction(() => !document.body.textContent.includes('AI-förslag att granska'))
    assert.match(await page.$eval('[role=dialog]', (node) => node.textContent), /2 saknar pris/)
    assert.match(await page.$eval('[role=dialog]', (node) => node.textContent), /Ej komplett/)
    await noOverflow()
    await page.screenshot({ path: resolve(output, `costing-${width}.png`), fullPage: true })
    await page.click('[aria-label="Redigera Bortforsling av byggavfall"]')
    await page.locator('form input[name=quantity]').fill('5')
    await page.locator('form input[name=unitCost]').fill('100')
    await page.locator('form input[type=checkbox]').click()
    await noOverflow()
    await page.screenshot({ path: resolve(output, `edit-${width}.png`), fullPage: true })
    await click('Spara rad')
    await page.waitForSelector('form', { hidden: true })
    const actions = JSON.parse(await page.$eval('[data-testid=actions]', (node) => node.textContent))
    assert.deepEqual(actions, ['generate_cost_suggestions', 'apply_cost_suggestions', 'update_cost_line'])
    await click('Stäng åtgärd')
    await page.waitForSelector('[role=dialog]', { hidden: true })
  }
  await page.goto(`${url}/?fail=1`, { waitUntil: 'networkidle0' })
  await click('Gå till kalkyl'); await click('Föreslå kalkyl med AI')
  await page.waitForSelector('[role=alert]')
  assert.equal(await page.$eval('[role=alert]', (node) => { const box = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(box.x + 10, box.y + 10)) }), true, 'Shared error toast is above the sheet')
  assert.equal(await page.$('[role=dialog] form'), null)
  assert.deepEqual(errors, [])
  console.log(`Desktop/mobile cost workflow and shared error toast passed. Screenshots: ${output}`)
} finally {
  await browser?.close()
  await new Promise((ok) => server.close(ok))
}
