import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

// Synthetic loopback-only report. No production, database, delivery or mail.
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/eb-inspection-reuse-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/eb-inspection-reuse-preview.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    'next/link': resolve('test/helpers/eb-overview-navigation.tsx'),
    'next/navigation': resolve('test/helpers/eb-overview-navigation.tsx'), '@': resolve('src'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const js = await readFile(resolve(output, 'view.js'))
const logo = await readFile('public/report-assets/BesiktApp.png')
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#e2e8f0"/><path d="M320 60L270 160L340 240L300 400" stroke="#475569" fill="none" stroke-width="8"/></svg>'
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
  if (path === '/view.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); return }
  if (path === '/photo.svg' || path === '/api/image-proxy') { response.setHeader('Content-Type', 'image/svg+xml'); response.end(svg); return }
  if (path === '/report-assets/BesiktApp.png') { response.setHeader('Content-Type', 'image/png'); response.end(logo); return }
  if (path === '/favicon.ico') { response.writeHead(204); response.end(); return }
  if (path !== '/') { response.writeHead(404); response.end(); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body style="margin:0"><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const base = `http://127.0.0.1:${server.address().port}`
  const origin = 'Bild från tidigare slutbesiktning 1 · 2026-09-03'
  for (const width of [390, 1440]) {
    await page.setViewport({ width, height: 1000 })
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.waitForSelector('#photo-appendix')
    assert.equal(await page.$eval('#photo-appendix', (node, origin) => node.textContent.split(origin).length - 1, origin), 1)
    assert.ok(await page.$eval('#photo-appendix', node => node.textContent.includes('Ny bild från detta tillfälle.')))
    await page.$eval('button[aria-label="Visa 2 bilder för notering 1"]', node => node.click())
    await page.waitForSelector('[aria-label="Bild 1 av 2"]')
    assert.ok(await page.$eval('[aria-label="Bild 1 av 2"]', (node, origin) => node.textContent.includes(origin), origin))
    await page.keyboard.press('ArrowRight')
    await page.waitForSelector('[aria-label="Bild 2 av 2"]')
    assert.equal(await page.$eval('[aria-label="Bild 2 av 2"]', (node, origin) => node.textContent.includes(origin), origin), false,
      'A new photo must not inherit the old photo label')
    await page.keyboard.press('Escape')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No mobile horizontal overflow')
    await page.screenshot({ path: resolve(output, `reuse-public-${width}.png`), fullPage: true })
  }
  await page.setViewport({ width: 1280, height: 1000 })
  await page.goto(`${base}/?print=1`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(origin => [...document.querySelectorAll('.eb-report-photo-figure')].some(node => node.textContent.includes(origin)), {}, origin)
  const figures = await page.$$eval('.eb-report-photo-figure', nodes => nodes.map(node => node.textContent))
  assert.ok(figures.some(text => text.includes(origin) && text.includes('Bildtexten har ändrats')),
    'The PDF layout keeps original provenance even after caption edits')
  assert.ok(figures.some(text => text.includes('Ny bild från detta tillfälle.') && !text.includes(origin)))
  await page.screenshot({ path: resolve(output, 'reuse-print.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: prior-photo origin survives edited captions in public, lightbox and print layouts; new photos stay unmarked (390/1440).')
} finally {
  await browser.close()
  await new Promise(ok => server.close(ok))
}
