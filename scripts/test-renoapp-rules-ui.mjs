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
const output = resolve('tmp/renoapp-rules-ui')
await mkdir(output, { recursive: true })
await new Promise((done, reject) => webpack({
  mode: 'development', devtool: false,
  entry: resolve('test/fixtures/renoapp-rules-editor.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/lib/supabaseClient': resolve('test/fixtures/renoapp-rules-storage.ts'), '@': resolve('src'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString('errors-only'))) : done()))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const js = await readFile(resolve(output, 'view.js'))
const server = createServer((request, response) => {
  if (request.url === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
let browser, page
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const toggle = () => page.locator('input[type="checkbox"]').click()
  const save = async () => {
    await page.locator('::-p-xpath(//button[contains(., "Spara")])').click()
    await page.waitForSelector('[role="status"]')
  }
  const reload = () => page.reload({ waitUntil: 'networkidle0' })
  for (const width of [1440, 1024, 390]) {
    await page.setViewport({ width, height: 1000 })
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await reload()
    assert.equal(await page.$eval('input[type="checkbox"]', input => input.checked), false)
    await page.waitForSelector('textarea', { hidden: true })
    await toggle()
    await page.locator('textarea').fill('Föreningens regler: skydda hissen och följ arbetstiderna.')
    assert.equal(await page.evaluate(() => sessionStorage.getItem('rules-editor')), null)
    await toggle()
    await toggle()
    assert.match(await page.$eval('textarea', input => input.value), /skydda hissen/)
    await save()
    await reload()
    assert.equal(await page.$eval('input[type="checkbox"]', input => input.checked), true)
    await page.screenshot({ path: resolve(output, `enabled-${width}.png`), fullPage: true })
    await toggle()
    await save()
    await reload()
    assert.equal(await page.$eval('input[type="checkbox"]', input => input.checked), false)
    await page.screenshot({ path: resolve(output, `disabled-${width}.png`), fullPage: true })
    await toggle()
    assert.match(await page.$eval('textarea', input => input.value), /skydda hissen/)
    await save()
    await page.evaluate(() => {
      const pdf = { id: 'saved-pdf', brfId: 'test', version: 3, format: 'pdf', body: null, fileName: 'Föreningens regler.pdf', publishedAt: '2026-09-07' }
      sessionStorage.setItem('rules-editor', JSON.stringify({ rules: pdf, savedRules: pdf }))
    })
    await reload()
    await page.locator('summary').click()
    const pdfLinks = await page.$$eval('details a', links => links.map(link => ({ text: link.textContent, target: link.target, download: new URL(link.href).searchParams.has('download') })))
    assert.deepEqual(pdfLinks, [{ text: 'Öppna PDF', target: '_blank', download: false }])
    await page.screenshot({ path: resolve(output, `pdf-${width}.png`), fullPage: true })
    await toggle()
    await save()
    await reload()
    await toggle()
    assert.match(await page.$eval('section', section => section.textContent), /Sparad PDF: Föreningens regler.pdf/)
    await save()
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('rules-editor-requests')).at(-1).reuseVersionId), 'saved-pdf')
    assert.equal(await page.evaluate(() => sessionStorage.getItem('rules-editor-uploaded')), null)
    await page.evaluate(() => sessionStorage.setItem('rules-editor-failure', 'error'))
    await toggle()
    await page.locator('::-p-xpath(//button[contains(., "Spara")])').click()
    await page.waitForSelector('[role="alert"]')
    assert.ok(await page.evaluate(() => JSON.parse(sessionStorage.getItem('rules-editor')).rules))
    await page.evaluate(() => sessionStorage.removeItem('rules-editor-failure'))
    await reload()
    assert.equal(await page.$eval('input[type="checkbox"]', input => input.checked), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    console.log(`PASS ${width}px: explicit save, reload, text/PDF off/on, retained content, failed save and no overflow`)
  }
  await page.evaluate(() => sessionStorage.setItem('rules-editor-failure', 'conflict'))
  await toggle()
  await page.locator('::-p-xpath(//button[contains(., "Spara")])').click()
  await page.waitForSelector('[role="alert"]')
  assert.match(await page.$eval('[role="alert"]', element => element.textContent), /annan användare/)
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('rules-editor')).rules.id), 'changed-version')
  assert.deepEqual(errors, [])
  console.log('PASS concurrent changes are reported without overwriting published rules')
} catch (error) {
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true })
  throw error
} finally {
  await browser?.close()
  await new Promise(done => server.close(done))
}
