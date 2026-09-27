import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve, extname, sep } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import puppeteer from 'puppeteer-core'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/ob-report-snapshot-buildings')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({ mode: 'development', devtool: false,
  entry: resolve('test/fixtures/report-snapshot-buildings.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/content/standardtexts/loadStandardText': resolve('test/fixtures/report-preview-texts.ts'),
    '@/lib/report/loadAppendixText': resolve('test/fixtures/report-preview-texts.ts'),
    'next/link': resolve('test/helpers/preview-link.tsx'),
    '@': resolve('src'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
console.log('Customer view compiled')
const cssSource = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/report";')
const css = (await postcss([tailwind()]).process(cssSource, { from: resolve('src/app/globals.css') })).css
const texts = {}
for (const name of await readdir('src/content/standardtexts')) {
  if (name.endsWith('.txt')) texts[name.slice(0, -4)] = await readFile(`src/content/standardtexts/${name}`, 'utf8')
}
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
  if (path === '/view.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(await readFile(resolve(output, 'view.js'))); return }
  if (extname(path)) {
    const file = resolve('public', `.${path}`)
    if (!file.startsWith(resolve('public') + sep)) { res.writeHead(403); res.end(); return }
    try { res.setHeader('Content-Type', extname(file) === '.png' ? 'image/png' : 'application/octet-stream'); res.end(await readFile(file)) }
    catch { res.writeHead(404); res.end() }
    return
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Digitalt utlåtande - testuppgifter</title><style>${css}</style></head><body><div id="root"></div><script>window.reportTexts=${JSON.stringify(texts).replaceAll('<', '\\u003c')}</script><script src="/view.js"></script></body></html>`)
})
const portIndex = process.argv.indexOf('--port')
await new Promise((ok, fail) => { server.once('error', fail); server.listen(portIndex < 0 ? 0 : Number(process.argv[portIndex + 1]), '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
if (process.argv.includes('--serve')) console.log(`Synthetic customer report preview: ${base}`)
else {
  let browser
  try {
    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
      userDataDir: await mkdtemp(resolve(output, 'chrome-')) })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
    await page.setRequestInterception(true)
    page.on('request', request => new URL(request.url()).origin === base ? request.continue() : request.abort())
    for (const width of [375, 390, 768, 1280, 1600]) {
      await page.setViewport({ width, height: 900 })
      await page.goto(base, { waitUntil: 'networkidle0' })
      await page.waitForSelector('[data-snapshot-building="garage"]')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`)
      const buildings = await page.$$eval('[data-snapshot-building]', sections => sections.map(section => {
        const images = [...section.querySelectorAll('img')]
        const heading = section.querySelector('h2')
        const image = section.querySelector('img[alt^="Byggnadsbild:"]')?.getBoundingClientRect()
        const bounds = section.getBoundingClientRect()
        return { text: section.innerText, headingFits: heading.scrollWidth <= heading.clientWidth,
          imagesLoaded: images.every(img => img.complete && img.naturalWidth > 0),
          centered: !image || Math.abs((image.left + image.right) / 2 - (bounds.left + bounds.right) / 2) < 1,
        }
      }))
      assert.equal(buildings.length, 2)
      for (const building of buildings) assert.ok(building.headingFits && building.imagesLoaded && building.centered, JSON.stringify(building))
      assert.match(buildings[0].text, /Garagets frysta risktext/)
      assert.match(buildings[0].text, /Garagets frysta FTU-text/)
      assert.match(buildings[0].text, /Möblering: fullt möblerad/)
      assert.match(buildings[1].text, /Möblering: omöblerad/)
      assert.doesNotMatch(buildings[1].text, /Risk:|FTU:/)
      const garage = await page.$('[data-snapshot-building="garage"]')
      await garage.evaluate(element => element.scrollIntoView())
      if (width === 390 || width === 1280) await page.screenshot({ path: resolve(output, `garage-${width}.png`) })
      const photo = await page.$('[data-snapshot-building="garage"] button[title="Visa bilden"]')
      await photo.click()
      await page.waitForSelector('[role="dialog"]')
      assert.ok(await page.$eval('[role="dialog"] img', img => img.complete && img.naturalWidth > 0))
      await page.keyboard.press('Escape')
      await page.waitForSelector('[role="dialog"]', { hidden: true })
      await page.goto(base + '?single', { waitUntil: 'networkidle0' })
      assert.equal((await page.$$('[data-snapshot-building]')).length, 0)
      assert.match(await page.$eval('body', body => body.innerText), /Huvudbyggnadens sparade köksnotering/)
      console.log(JSON.stringify({ viewport: width, multiBuilding: 'passed', photoDialog: 'passed', singleBuilding: 'passed' }))
    }
    assert.deepEqual(errors, [])
  } finally { await browser?.close(); await new Promise(ok => server.close(ok)) }
}
