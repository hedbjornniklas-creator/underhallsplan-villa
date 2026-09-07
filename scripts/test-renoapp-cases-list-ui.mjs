import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/renoapp-cases-list-ui')
await mkdir(output, { recursive: true })
await new Promise((done, reject) => webpack({
  mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/renoapp-cases-list.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { 'next/navigation': resolve('test/fixtures/renoapp-navigation.ts') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString('errors-only'))) : done()))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const js = await readFile(resolve(output, 'view.js'))
const server = createServer((request, response) => {
  if (request.url === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  const rowOrder = () => page.$$eval('tbody tr', rows => rows.map(row => row.querySelector('td').textContent.trim()))
  const expected = [7, 5, 8, 2, 4, 6, 1, 3, 0].map(index => `RA-2026-0907-0${index}`)
  for (const width of [1440, 1024, 390]) {
    await page.setViewport({ width, height: 1000 })
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('tbody tr')
    assert.deepEqual(await rowOrder(), expected)
    assert.match(await page.$eval('tbody', node => node.textContent), /Renoveringsansökan/)
    assert.doesNotMatch(await page.$eval('tbody', node => node.textContent), /Ã/)
    assert.ok(await page.$eval('input[aria-label="Sök ärenden"]', input => {
      const box = input.closest('section').getBoundingClientRect()
      const field = input.getBoundingClientRect()
      return field.left - box.left >= 16 && field.top - box.top >= 16
    }))
    await page.screenshot({ path: resolve(output, `list-${width}.png`), fullPage: true })
    console.log(`PASS ${width}px: inset controls, corrected title, status order with newest first within groups`)
  }
  await page.evaluate(() => localStorage.setItem('renoapp:cases:list:view:v1', JSON.stringify({ search: '', statusFilter: 'all', sortField: 'submittedAt', sortDirection: 'desc', pageSize: 10 })))
  await page.reload({ waitUntil: 'networkidle0' })
  assert.deepEqual(await rowOrder(), expected)
  assert.equal(await page.$eval('select', node => node.value), '10')
  await page.locator('::-p-xpath(//button[contains(., "Ansökningsdatum")])').click()
  await page.reload({ waitUntil: 'networkidle0' })
  assert.deepEqual(await rowOrder(), [...expected].sort().reverse())
  await page.locator('::-p-xpath(//button[contains(., "Rensa filter")])').click()
  assert.deepEqual(await rowOrder(), expected)
  assert.deepEqual(errors, [])
  const source = await readFile('src/lib/renoapp/server.ts', 'utf8')
  assert.match(source, /if \(actionTypes.length === 0\) return 'Renoveringsansökan'/)
  console.log('PASS old preference migration, page-size preservation, explicit date sort persistence, reset and new default title')
} finally {
  await browser?.close()
  await new Promise(done => server.close(done))
}
