import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve, extname, sep } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import puppeteer from 'puppeteer-core'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/pdfs/ob-status-2026-10-02/report-layout')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({ mode: 'development', devtool: false,
  entry: resolve('test/fixtures/status-report-layout.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/content/standardtexts/loadStandardText': resolve('test/fixtures/report-preview-texts.ts'),
    '@/lib/report/loadAppendixText': resolve('test/fixtures/report-preview-texts.ts'),
    '@': resolve('src'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
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
    try { res.setHeader('Content-Type', ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' })[extname(file)] ?? 'application/octet-stream'); res.end(await readFile(file)) }
    catch { res.writeHead(404); res.end() }
    return
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>STB - syntetiskt badrumstest</title><style>${css}</style></head><body><div id="root"></div><script>window.reportTexts=${JSON.stringify(texts).replaceAll('<', '\\u003c')}</script><script src="/view.js"></script></body></html>`)
})
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
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
  for (const scenario of ['', '?unknown-furnishing', '?apartment', '?apartment&rental']) {
    await page.goto(base + '/' + scenario, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.querySelector('[data-report-pagination-ready="1"]'))
    const result = await page.evaluate(() => [...document.querySelectorAll('.report-page')].map(p => ({
      text: p.innerText, height: p.getBoundingClientRect().height,
      entries: [...p.querySelectorAll('[data-report-entry]')].map(n => ({ type: n.dataset.reportBlock,
        text: n.innerText, bottom: n.getBoundingClientRect().bottom - p.getBoundingClientRect().top })),
      images: [...p.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 1),
      brokenImages: [...p.querySelectorAll('img')].filter(img => !img.complete || img.naturalWidth <= 1).map(img => img.src),
    })))
    const allText = result.map(p => p.text).join('\n')
    for (const value of ['STATUSBESIKTNING', 'Okulär statusbesiktning av badrummet på plan 1.',
      'Rekommendation', 'Övriga kommentarer', 'Begär installationsanvisning och dokumentation för golvbrunnen.',
      'BILAGA 1: VILLKOR FÖR STATUSBESIKTNING', 'till uppdragsgivaren 2026-10-01.']) assert.ok(allText.includes(value), value)
    assert.doesNotMatch(allText, /OB RISK MUST NOT LEAK|OB FTU MUST NOT LEAK|Riskanalys|BILAGA 2|BILAGA 3|UTVÄNDIGT/)
    assert.match(allText, /SBR:s mall för statusbesiktning\. Version 2026\.2/)
    assert.doesNotMatch(allText, /© 2025|Version 2025\.1/)
    // The verbatim STB terms mention that FTU is excluded. Only the notes must
    // exclude the OB FTU section, without removing words from those terms.
    const beforeTerms = result.slice(0, result.findIndex((p, i) => i > 1 && p.text.includes('BILAGA 1:')))
      .map(p => p.text).join('\n')
    assert.doesNotMatch(beforeTerms, /Fortsatt teknisk utredning/)
    assert.equal(allText.includes('delvis möblerad'), !scenario.includes('unknown-furnishing'))
    assert.doesNotMatch(allText, /fullt möblerad/)
    if (scenario.includes('apartment')) {
      for (const value of ['Lägenhetsnummer:', '1203', 'Lägenhetsinnehavare:', 'Testinnehavaren', 'LGH: 1203']) assert.ok(allText.includes(value), value)
      assert.doesNotMatch(allText, /LÄGENHETSBESIKTNING|Bostadsrättsinnehavare|Fastighetsbeteckning/)
      if (scenario.includes('rental')) assert.doesNotMatch(allText, /Bostadsrättsförening|BRF:/)
      else assert.ok(allText.includes('BRF Testföreningen'))
    }
    const labelsFit = await page.$$eval('[data-report-inspection-segment="recommendation"], [data-report-inspection-segment="comment"]', nodes => nodes.every(node => {
      const row = node.firstElementChild?.children[1]?.firstElementChild
      const label = row?.firstElementChild
      const body = row?.children[1]
      return !!label && !!body && label.scrollWidth <= label.clientWidth && label.getBoundingClientRect().right <= body.getBoundingClientRect().left
    }))
    assert.ok(labelsFit, 'STB labels must not overlap the note body')
    for (const p of result) {
      assert.ok(p.height < 1130, `Oversized A4 page: ${p.height}`)
      const last = p.entries.at(-1)
      assert.ok(!last || !['heading', 'inspectionFloorHeader'].includes(last.type), `Orphan heading: ${last?.text}`)
      assert.ok(p.images, `Broken image: ${p.brokenImages.join(', ')}`)
    }
    if (!scenario || scenario === '?apartment') {
      const suffix = scenario ? '-apartment' : ''
      await page.pdf({ path: resolve(output, `Utlåtande STB TEST-01${suffix}.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true })
      await writeFile(resolve(output, `qa-pages${suffix}.json`), JSON.stringify(result, null, 2))
      const pages = await page.$$('.report-page')
      for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: resolve(output, `page${suffix}-${i + 1}.png`) })
    }
    console.log(JSON.stringify({ scenario: scenario || 'STB bathroom', pages: result.length, frozenTerms: 'passed', recommendations: 'passed', noObRiskFtu: 'passed' }))
  }
  assert.deepEqual(errors, [])
} finally { await browser?.close(); await new Promise(ok => server.close(ok)) }
console.log(resolve(output, 'Utlåtande STB TEST-01.pdf'))
