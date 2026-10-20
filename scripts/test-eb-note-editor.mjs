import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

// Loopback-only synthetic React editor: never use real report IDs, storage or mail.
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/eb-note-editor-preview')
await mkdir(output, { recursive: true })
const navigation = resolve('test/helpers/eb-note-editor-preview-navigation.tsx')
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/eb-note-editor-preview.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    'next/link': navigation, 'next/navigation': navigation, '@/components/Protected': navigation, '@': resolve('src'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const sourceCss = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";',
  '@import "tailwindcss" source(none);\n@source "../components/eb";\n@source "../components/ob/DebouncedTextarea.tsx";')
const { css } = await postcss([tailwind()]).process(sourceCss, { from: resolve('src/app/globals.css') })
const js = await readFile(resolve(output, 'view.js'))
const server = createServer((request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'none'")
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
  if (request.url === '/view.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); return }
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return }
  if (request.url !== '/') { response.writeHead(404); response.end(); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0"><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const base = `http://127.0.0.1:${server.address().port}`
  const editor = '.fixed > aside'
  const text = `${editor} form textarea[required]`
  async function fresh() {
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.waitForSelector('#eb-review-notes article[role=button]')
  }
  async function open() {
    await page.$eval('#eb-review-notes article[role=button]:last-child button[aria-label=Redigera]', node => node.click())
    await page.waitForSelector(text)
    assert.equal(await page.$eval(`${editor} h2`, node => node.textContent), 'BES 31')
  }
  async function type(value) {
    await page.focus(text)
    await page.keyboard.down('Control')
    await page.keyboard.press('A')
    await page.keyboard.up('Control')
    await page.type(text, value, { delay: 0 })
  }
  async function close() { await page.click(`${editor} button[aria-label="Stäng"]`) }
  async function closed() { await page.waitForSelector(text, { hidden: true }) }
  await fresh()
  await open()
  await type('Sista ändringen före snabb stängning.')
  await close()
  await closed()
  assert.equal(await page.evaluate(() => window.__ebEditorTest.saved['note-39']), 'Sista ändringen före snabb stängning.')
  await open()
  assert.equal(await page.$eval(text, node => node.value), 'Sista ändringen före snabb stängning.')
  await close()
  await closed()

  await fresh()
  await open()
  await page.evaluate(() => { window.__ebEditorTest.holdNext = true })
  await type('Äldre pågående autosparning.')
  await page.waitForFunction(() => window.__ebEditorTest.writes.length === 1)
  await type('Nyaste texten måste vinna.')
  await close()
  assert.equal(await page.$eval(text, node => node.value), 'Nyaste texten måste vinna.')
  assert.equal(await page.evaluate(() => window.__ebEditorTest.writes.length), 1)
  await page.evaluate(() => window.__ebEditorTest.pending.shift()())
  await closed()
  assert.equal(await page.evaluate(() => window.__ebEditorTest.saved['note-39']), 'Nyaste texten måste vinna.')

  await fresh()
  await open()
  await page.evaluate(() => { window.__ebEditorTest.failNext = true })
  await type('Texten ska finnas kvar efter sparfel.')
  await close()
  await page.waitForFunction(() => document.body.innerText.includes('Simulerat sparfel'))
  assert.equal(await page.$eval(text, node => node.value), 'Texten ska finnas kvar efter sparfel.')
  assert.equal(await page.$eval(`${editor} h2`, node => node.textContent), 'BES 31')
  await page.screenshot({ path: resolve(output, 'save-error-retains-text.png'), fullPage: false })
  await close()
  await closed()
  assert.equal(await page.evaluate(() => window.__ebEditorTest.saved['note-39']), 'Texten ska finnas kvar efter sparfel.')
  assert.deepEqual(errors, [])
  console.log('PASS: real React editor shows31, saves immediate X close, serializes an older autosave, retains text on error and retries successfully.')
} finally {
  await browser.close()
  await new Promise(ok => server.close(ok))
}
