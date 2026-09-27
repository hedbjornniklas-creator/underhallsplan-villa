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
const output = resolve('tmp/ob-report-building-layout')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({ mode: 'development', devtool: false,
  entry: { view: resolve('test/fixtures/report-building-layout.tsx'), settings: resolve('test/fixtures/report-settings-page.tsx') }, output: { path: output, filename: '[name].js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/content/standardtexts/loadStandardText': resolve('test/fixtures/report-preview-texts.ts'),
    '@/lib/report/loadAppendixText': resolve('test/fixtures/report-preview-texts.ts'),
    '@/lib/supabaseClient': resolve('test/fixtures/report-settings-client.tsx'),
    '@/components/Protected': resolve('test/fixtures/report-settings-client.tsx'),
    '@/components/besiktapp/ProfileStartReturn': resolve('test/fixtures/report-settings-client.tsx'),
    '@/components/settings/FortnoxConnectionCard': resolve('test/fixtures/report-settings-client.tsx'),
    '@/components/settings/SettingsNav': resolve('test/fixtures/report-settings-client.tsx'),
    'next/navigation': resolve('test/fixtures/report-settings-client.tsx'),
    '@': resolve('src'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })).css
const texts = {}
for (const name of await readdir('src/content/standardtexts')) {
  if (name.endsWith('.txt')) texts[name.slice(0, -4)] = await readFile(`src/content/standardtexts/${name}`, 'utf8')
}
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
  if (path === '/view.js' || path === '/settings.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(await readFile(resolve(output, path.slice(1)))); return }
  if (extname(path)) {
    const file = resolve('public', `.${path}`)
    if (!file.startsWith(resolve('public') + sep)) { res.writeHead(403); res.end(); return }
    try { res.setHeader('Content-Type', extname(file) === '.png' ? 'image/png' : 'application/octet-stream'); res.end(await readFile(file)) }
    catch { res.writeHead(404); res.end() }
    return
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ÖB rapportlayout - testuppgifter</title><style>${css}</style></head><body><div id="root"></div><script>window.reportTexts=${JSON.stringify(texts).replaceAll('<', '\\u003c')}</script><script src="/${path === '/settings' ? 'settings' : 'view'}.js"></script></body></html>`)
})
const serve = process.argv.includes('--serve')
const portIndex = process.argv.indexOf('--port')
await new Promise((ok, fail) => { server.once('error', fail); server.listen(portIndex < 0 ? 0 : Number(process.argv[portIndex + 1]), '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
if (serve) console.log(`Synthetic report preview: ${base}`)
else {
  let browser
  try {
    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
      userDataDir: await mkdtemp(resolve(output, 'chrome-')) })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setRequestInterception(true)
    page.on('request', request => new URL(request.url()).origin === base ? request.continue() : request.abort())
    await page.setViewport({ width: 1360, height: 1000 })
    for (const scenario of ['', '?website', '?website&long', '?legacy', '?stress']) {
      await page.goto(base + '/' + scenario, { waitUntil: 'networkidle0' })
      await page.waitForFunction(() => document.querySelector('[data-report-pagination-ready="1"]'))
      const result = await page.evaluate(() => {
        const pages = [...document.querySelectorAll('.report-page')]
        return pages.map(p => ({ text: p.innerText, height: p.getBoundingClientRect().height,
          intro: [...p.querySelectorAll('[data-report-building-introduction]')].map(n => n.textContent),
          entries: [...p.querySelectorAll('[data-report-entry]')].map(n => ({ id: n.dataset.reportEntry, type: n.dataset.reportBlock, text: n.innerText,
            bottom: n.getBoundingClientRect().bottom - p.getBoundingClientRect().top })),
          images: [...p.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 1),
        }))
      })
      assert.ok(result.length > 5)
      const allText = result.map(p => p.text).join('\n')
      if (!scenario.includes('legacy')) {
        assert.doesNotMatch(allText, /www\.webbadress\.se|Bilaga 4: Garage/)
        assert.equal(allText.includes('https://foretag.example.se'), scenario.includes('website'))
        const garageIndex = result.findIndex(p => p.intro.length)
        const appendixIndex = result.findIndex((p, i) => i > 1 && p.text.includes('BILAGA 1:'))
        assert.ok(garageIndex > 0 && garageIndex < appendixIndex)
        assert.equal(result[garageIndex].intro[0], '')
        for (const p of result) {
          const last = p.entries.at(-1)
          assert.ok(!last || !['heading', 'inspectionFloorHeader'].includes(last.type), `Orphan heading: ${last?.text}`)
          assert.ok(p.height < 1130, `Oversized A4 page: ${p.height}`)
          assert.ok(p.images, 'Broken image')
        }
        if (!scenario.includes('stress')) {
          for (const name of ['HUVUD-MARK', 'HUVUD-TAK', 'HUVUD-KÖK', 'HUVUD-TEKNIK', 'HUVUD-BADRUM', 'HUVUD-SOVRUM', 'Garage-TAK', 'Garage-TEKNIK', 'Garage-KÖK', 'Garage-SOVRUM']) {
            const p = result.find(p => p.entries.some(e => e.text.includes(name)))
            assert.ok(p, `Missing ${name}`)
            const entry = p.entries.find(e => e.text.includes(name))
            const prefix = entry.id.replace(/-note-\d+$/, '')
            assert.ok(p.entries.some(e => e.id.startsWith(prefix + '-photos-')), `Detached photo: ${name}`)
          }
        }
      } else assert.match(allText, /Bilaga 4: Garage/)
      if (!scenario) {
        await page.pdf({ path: resolve(output, 'two-buildings-test.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true })
        const garageIndex = result.findIndex(p => p.intro.length)
        await page.locator('.report-page').wait() // Ensure pages remain mounted after printing.
        await (await page.$$('.report-page'))[garageIndex].screenshot({ path: resolve(output, 'garage.png') })
      }
      console.log(JSON.stringify({ scenario: scenario || 'empty website', pages: result.length }))
    }
    await page.goto(base + '/settings', { waitUntil: 'networkidle0' })
    let input = await page.evaluateHandle(() => [...document.querySelectorAll('label')].find(n => n.textContent.includes('Hemsida (valfritt)')).querySelector('input'))
    await input.type('https://foretag.example.se')
    await page.waitForFunction(() => window.profileSaves.at(-1)?.company_website === 'https://foretag.example.se')
    await page.reload({ waitUntil: 'networkidle0' })
    input = await page.evaluateHandle(() => [...document.querySelectorAll('label')].find(n => n.textContent.includes('Hemsida (valfritt)')).querySelector('input'))
    assert.equal(await input.evaluate(n => n.value), 'https://foretag.example.se')
    await input.click({ clickCount: 3 })
    await page.keyboard.press('Backspace')
    await page.waitForFunction(() => window.profileSaves.at(-1)?.company_website === null)
    await input.type('javascript:alert(1)')
    await page.waitForFunction(() => document.body.innerText.includes('Ange en giltig hemsida'))
    assert.equal(await page.evaluate(() => window.profileSaves.length), 1)
    await input.click({ clickCount: 3 })
    await page.keyboard.press('Backspace')
    await page.setViewport({ width: 390, height: 844 })
    await page.waitForFunction(() => !document.body.innerText.includes('Ange en giltig hemsida'))
    await page.screenshot({ path: resolve(output, 'settings-mobile.png'), fullPage: true })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile settings overflow')
    await page.goto(base + '/settings?missing-column', { waitUntil: 'networkidle0' })
    assert.match(await page.locator('body').waitHandle().then(n => n.evaluate(e => e.innerText)), /Hemsida blir tillgängligt/)
    assert.deepEqual(errors, [])
  } finally { await browser?.close(); await new Promise(ok => server.close(ok)) }
}
