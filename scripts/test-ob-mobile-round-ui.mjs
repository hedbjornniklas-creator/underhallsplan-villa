import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import puppeteer from 'puppeteer-core'
import { testRoundParity } from '../test/helpers/ob-round-parity-browser.mjs'
import { testFloorEditor } from '../test/helpers/ob-floor-browser.mjs'
import { testImageImport } from '../test/helpers/ob-image-import-browser.mjs'

// The production component, but synthetic records and callbacks. No database or auth access.
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/ob-mobile-round-ui')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  entry: { view: resolve('test/fixtures/ob-mobile-round.tsx'), navigation: resolve('test/fixtures/ob-round-page.tsx') },
  output: { path: output, filename: '[name].js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/lib/supabaseClient': resolve('test/fixtures/ob-mobile-round-client.ts'),
    '@/components/Protected': resolve('test/fixtures/ob-round-navigation.tsx'),
    '@/components/ob/ObWizard': resolve('test/fixtures/ob-round-wizard.tsx'),
    'next/navigation': resolve('test/fixtures/ob-round-navigation.tsx'),
    'next/link': resolve('test/helpers/preview-link.tsx'),
    './mobile-round.css': false, '@': resolve('src'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const globalCss = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const css = `${globalCss.css}\n${await readFile('src/components/ob/mobile-round.css', 'utf8')}`
const js = await readFile(resolve(output, 'view.js'))
const navigationJs = await readFile(resolve(output, 'navigation.js'))
const photo = await readFile('public/landing/Background1.png')
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  response.setHeader('Cache-Control', 'no-store')
  // Synthetic preview callback only. Production persistence is exercised by SQL/API tests.
  if (request.method === 'POST' && url.pathname === '/api/ob/inspections/synthetic-mobile-inspection/floors') {
    let text = ''; for await (const chunk of request) text += chunk
    const body = JSON.parse(text)
    response.setHeader('Content-Type', 'application/json')
    if (!body.levels.some(row => row.level === 1)) {
      response.writeHead(409); response.end(JSON.stringify({ error: 'Planet har rum och kan inte tas bort.' })); return
    }
    response.end(JSON.stringify({ data: { levels: body.levels, revision: body.revision + 1 } })); return
  }
  if (request.method === 'GET' && url.pathname === '/api/ob/inspections/synthetic-mobile-inspection/assignment-workflow') {
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ workflow: null })); return
  }
  if (request.method === 'GET' && url.pathname === '/api/ob/inspections/synthetic-mobile-inspection/addon-orders') {
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ addonOrders: [] })); return
  }
  if (request.method !== 'GET' || url.pathname.startsWith('/api')) {
    response.writeHead(405); response.end('No data writes in this preview'); return
  }
  if (url.pathname === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  if (url.pathname === '/navigation.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(navigationJs); return }
  if (url.pathname === '/photo.png') { response.setHeader('Content-Type', 'image/png'); response.end(photo); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (url.pathname === '/preview') {
    if (url.searchParams.has('levels')) {
      response.end('<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>OB plan - testuppgifter</title><style>html,body{margin:0;height:100%;background:#edf1f2}iframe{display:block;width:min(100%,390px);height:100dvh;margin:auto;border:0;background:white}</style></head><body><iframe src="/?levels" title="OB med ny planindelning"></iframe></body></html>'); return
    }
    response.end('<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ÖB mobilrunda · testuppgifter</title><style>html,body{margin:0;height:100%;background:#edf1f2}iframe{display:block;width:min(100%,390px);height:100dvh;margin:auto;border:0;background:white}</style></head><body><iframe src="/" title="ÖB mobilrunda med testuppgifter"></iframe></body></html>')
    return
  }
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ÖB mobilrunda · syntetisk förhandsvisning</title><style>${css}</style></head><body><div id="root"></div><script src="/${url.pathname === '/navigation' ? 'navigation' : 'view'}.js"></script></body></html>`)
})
const serve = process.argv.includes('--serve')
const portArg = process.argv.indexOf('--port')
await new Promise((ok, fail) => { server.once('error', fail); server.listen(portArg < 0 ? 0 : Number(process.argv[portArg + 1]), '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
if (serve) {
  console.log(`Synthetic mobile-round preview: ${base}`)
} else {
  let browser, page
  const errors = [], external = []
  try {
    browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: await mkdtemp(resolve(output, 'chrome-')) })
    page = await browser.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.setRequestInterception(true)
    page.on('request', request => {
      if (new URL(request.url()).origin === base) void request.continue()
      else { external.push(request.url()); void request.abort() }
    })
    await testImageImport(page, base, output)
    if (!process.argv.includes('--images-only')) await testFloorEditor(page, base, output)
    if (process.argv.includes('--floors-only') || process.argv.includes('--images-only')) {
      assert.deepEqual(errors, [])
      assert.deepEqual(external, [])
      console.log('PASS: multi-image import, durable local queue, cancellation, failures, locked/paused states and 320-1280px layouts. No external requests.')
    } else {
    async function click(text, parent = '') {
      for (const button of await page.$$(`${parent} button`)) {
        const label = await button.evaluate(node => node.textContent.trim())
        if (label === text || (parent === 'nav' && label.endsWith(text))) { await button.click(); return }
      }
      throw Error(`Missing button: ${text}`)
    }
    async function fresh(query = '') {
      await page.goto(base, { waitUntil: 'networkidle0' })
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
      await page.goto(base + query, { waitUntil: 'networkidle0' })
    }
    async function noOverflow() {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal document overflow')
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('.obm-sheet[open],.obm-sheet-body,.obm-root')].every(node => node.scrollWidth <= node.clientWidth + 1)), 'horizontal component overflow')
    }
    async function fill(selector, value) {
      await page.click(selector)
      await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control')
      await page.type(selector, value)
    }
    for (const width of [320, 360, 390, 430, 1280]) {
      await page.setViewport({ width, height: 820 })
      await fresh()
      assert.ok(await page.evaluate(() => {
        const title = document.querySelector('.obm-place-header-row h1').getBoundingClientRect()
        const mode = document.querySelector('.obm-segment').getBoundingClientRect()
        return title.right <= mode.left && Math.abs(title.y - mode.y) < 20
      }), 'title is left of the area selector')
      assert.equal(await page.$$eval('.obm-place-controls label', nodes => nodes.some(node => node.textContent.trim() === 'Plan')), false)
      await noOverflow()
      await page.screenshot({ path: resolve(output, `places-${width}.png`) })
      await page.select('select[aria-label="Plan"]', 'plan2')
      await page.click('.obm-place-row')
      assert.equal(await page.$('.obm-inspection-header'), null)
      await noOverflow()
      await page.screenshot({ path: resolve(output, `room-${width}.png`) })
      await page.click('[aria-label="Till platser"]')
      await click('Utsida')
      await page.click('.obm-place-row')
      await page.waitForSelector('[data-note-id="outside-note"]')
      assert.equal(await page.$('.obm-inspection-header'), null)
      await page.click('[aria-label="Till platser"]')
      await click('Att bearbeta', 'nav')
      assert.ok(await page.$('.obm-inspection-header'))
      await page.click('[data-note-id="empty-note"]')
      await page.waitForSelector('dialog[open] textarea')
      assert.equal(await page.$eval('dialog textarea', node => getComputedStyle(node).fontSize), '16px')
      assert.equal(await page.$eval('body', node => getComputedStyle(node).overflowY), 'hidden')
      await noOverflow()
      await page.screenshot({ path: resolve(output, `editor-${width}.png`) })
      await page.click('dialog [aria-label="Tillbaka"]')
      await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    }
    await page.setViewport({ width: 390, height: 820 })
    await fresh()
    await page.click('.obm-place-row')
    await page.type('[aria-label="Sök notering"]', 'plåt')
    await page.waitForSelector('[data-outcome-id="outcome-1"]')
    await fill('[aria-label="Sök notering"]', 'Sidindelad')
    await page.waitForSelector('[data-outcome-id="last-outcome"]')
    await page.click('[aria-label="Lägg till: Sidindelad kontroll"]')
    await page.waitForFunction(() => window.__obMobileTest.notes.some(note => note.selected_outcome_id === 'last-outcome'))
    await page.click('[aria-label="Rensa sökning"]')
    await click('Fri notering')
    await page.waitForSelector('dialog[aria-label="Notering"] textarea')
    await fill('dialog textarea', 'Ny notering på rätt plats')
    await page.click('dialog [aria-label="Tillbaka"]')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    assert.ok(await page.evaluate(() => window.__obMobileTest.notes.some(note => note.note === 'Ny notering på rätt plats' && note.interior_room_id === 'room-1')))
    assert.equal(await page.evaluate(() => window.__obMobileTest.hasDrafts()), false)

    // A slow save followed by newer typing must persist the newest snapshot last.
    await page.click('[data-note-id="note-1"]')
    await page.evaluate(() => { window.__obMobileTest.delayMs = 1200 })
    await fill('dialog textarea', 'Första ändringen')
    await page.waitForFunction(() => window.__obMobileTest.calls.some(call => call.patch?.note === 'Första ändringen'))
    await fill('dialog textarea', 'Senaste ändringen')
    await click('Klart', 'dialog')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    assert.equal(await page.evaluate(() => window.__obMobileTest.notes.find(note => note.id === 'note-1').note), 'Senaste ändringen')

    // Failed save: back stays in the editor; reload restores the local draft and retries.
    await page.click('[data-note-id="note-1"]')
    await page.evaluate(() => { window.__obMobileTest.delayMs = 0; window.__obMobileTest.failSaves = true })
    await fill('dialog textarea', 'Text som ska överleva ett sparfel')
    await page.click('dialog [aria-label="Tillbaka"]')
    await page.waitForSelector('dialog [role="alert"]')
    assert.equal(await page.evaluate(() => window.__obMobileTest.hasDrafts()), true)
    const failureScreenshot = resolve(output, 'save-failure.png')
    await page.screenshot({ path: failureScreenshot })
    page.once('dialog', dialog => void dialog.accept())
    await page.reload({ waitUntil: 'networkidle0' })
    await page.click('[data-note-id="note-1"]')
    await page.waitForFunction(() => window.__obMobileTest.notes.find(note => note.id === 'note-1').note === 'Text som ska överleva ett sparfel')
    assert.equal(await page.$eval('dialog textarea', node => node.value), 'Text som ska överleva ett sparfel')
    await page.click('dialog [aria-label="Tillbaka"]')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    assert.equal(await page.evaluate(() => window.__obMobileTest.hasDrafts()), false)

    await click('Att bearbeta', 'nav')
    await page.click('.obm-image-row')
    await page.waitForSelector('dialog[aria-label="Koppla bild"]')
    assert.equal(await page.$('dialog select'), null, 'wrapped radio list replaces the native select')
    await page.type('[aria-label="Sök notering att koppla"]', 'överleva')
    await page.click('input[type="radio"]')
    await noOverflow()
    await page.screenshot({ path: resolve(output, 'link-image.png') })
    await click('Koppla till notering', 'dialog')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    assert.equal(await page.evaluate(() => window.__obMobileTest.images[0].control_item_id), 'note-1')
    assert.equal(await page.$('.obm-image-row'), null)
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.filter(call => call.kind === 'link').length), 1)

    await fresh('?queued')
    await click('Att bearbeta', 'nav')
    await page.click('.obm-image-row')
    await page.waitForSelector('dialog input[type="radio"]')
    await page.click('dialog input[type="radio"]')
    assert.equal(await page.$eval('dialog footer button', node => node.disabled), true)
    await page.evaluate(() => window.__obMobileTest.completeUpload())
    await page.waitForFunction(() => !document.querySelector('dialog footer button').disabled)
    await click('Koppla till notering', 'dialog')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    assert.equal(await page.evaluate(() => window.__obMobileTest.images[0].control_item_id), 'note-1', 'image picker resolves the fresh server image after upload')

    await testRoundParity({ page, click, fresh, fill, noOverflow, output })
    await fresh('?locked')
    await page.click('.obm-place-row')
    assert.equal(await page.$eval('.obm-room-actions button', node => node.disabled), true)
    await page.click('[data-note-id="note-1"]')
    assert.equal(await page.$eval('dialog textarea', node => node.readOnly), true)
    assert.equal(await page.$eval('dialog .obm-photo-actions button', node => node.disabled), true)
    await page.click('dialog [aria-label="Tillbaka"]')
    assert.deepEqual(await page.evaluate(() => window.__obMobileTest.calls), [])
    await fresh('?paused')
    assert.equal(await page.$eval('.obm-place-row', node => node.matches(':disabled')), true)

    async function openStepMenu() {
      await page.evaluate(() => [...document.querySelectorAll('button[aria-label="Öppna stegmeny"]')].find(button => button.getBoundingClientRect().width > 0).click())
      await page.waitForSelector('[role="dialog"]')
    }
    async function chooseSection(label) {
      await page.evaluate(label => [...document.querySelectorAll('[role="dialog"] button')].find(button => button.firstElementChild?.textContent === label).click(), label)
    }
    async function selectedSection() { return page.$eval('[data-selected-ob-section]', node => node.dataset.selectedObSection) }
    for (const width of [390, 1280]) {
      await page.setViewport({ width, height: 820 })
      await page.goto(base + '/navigation', { waitUntil: 'networkidle0' })
      assert.equal(await selectedSection(), 'grunddata')
      await openStepMenu()
      assert.ok(await page.$eval('[role="dialog"]', node => node.textContent.includes('ÖB-runda (ny)')))
      await page.screenshot({ path: resolve(output, `step-menu-${width}.png`) })
      await chooseSection('ÖB-runda (ny)')
      await page.waitForSelector('[data-selected-ob-section="runda-ny"]')
      assert.equal(await page.$eval('main', node => node.dataset.obMobileRound), 'true')
      assert.ok(await page.$('body.ob-round-fullscreen'))
      assert.equal(await page.$eval('[data-inspection-id]', node => node.dataset.inspectionId), 'synthetic-mobile-inspection')
      await openStepMenu(); await chooseSection('ÖB-runda')
      await page.waitForSelector('[data-selected-ob-section="runda"]')
      assert.equal(await page.$eval('main', node => node.dataset.obMobileRound), 'false')
      assert.ok(await page.$('body.ob-round-fullscreen'))
      await page.evaluate(() => localStorage.setItem('ob:text-draft:v1:ob:synthetic-mobile-inspection:pending', 'test draft'))
      await openStepMenu()
      page.once('dialog', dialog => void dialog.dismiss())
      await chooseSection('ÖB-runda (ny)')
      assert.equal(await selectedSection(), 'runda', 'cancelled unsaved-text warning keeps the old round mounted')
      page.once('dialog', dialog => void dialog.accept())
      await chooseSection('ÖB-runda (ny)')
      await page.waitForSelector('[data-selected-ob-section="runda-ny"]')
      await page.evaluate(() => localStorage.removeItem('ob:text-draft:v1:ob:synthetic-mobile-inspection:pending'))
      await openStepMenu(); await chooseSection('Granska')
      await page.waitForSelector('[data-selected-ob-section="review"]')
      assert.equal(await page.$('body.ob-round-fullscreen'), null)
      await noOverflow()
    }
    await page.goto(base + '/navigation?round=mobile-v2&apartment', { waitUntil: 'networkidle0' })
    assert.equal(await selectedSection(), 'runda-ny', 'new round deep link works without environment flags')
    await openStepMenu()
    assert.equal(await page.$eval('[role="dialog"]', node => node.textContent.includes('Byggnad - utsida')), false)
    assert.ok(await page.$eval('[role="dialog"]', node => node.textContent.includes('ÖB-runda (ny)')))
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    console.log('PASS: mobile/desktop layouts, real step menu with both rounds, switching/draft guard, deep link, apartment menu, paginated search, autosave/recovery, image linking, locked/paused states. No external requests.')
    }
  } catch (error) {
    if (page) {
      console.error(await page.$eval('body', node => node.innerText))
      await page.screenshot({ path: resolve(output, 'failure.png') })
    }
    throw error
  } finally {
    await browser?.close()
    await new Promise(ok => server.close(ok))
  }
}
