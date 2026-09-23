// Actual Uppdrag components, synthetic data and blocked external traffic.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/uppdrag-brand-ui')
await mkdir(output, { recursive: true })
await writeFile(resolve(output, '.gitignore'), '*\n')
await new Promise((done, reject) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/uppdrag-brand-view.tsx'),
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/components/Protected': resolve('test/fixtures/uppdrag-brand-navigation.tsx'),
    '@/lib/supabaseClient': resolve('test/fixtures/renoapp-brand-supabase.ts'),
    '@/lib/action-cases/server': resolve('test/fixtures/uppdrag-brand-data.ts'),
    '@/lib/action-cases/rfqDeliveryServer': resolve('test/fixtures/uppdrag-brand-data.ts'),
    'next/navigation': resolve('test/fixtures/uppdrag-brand-navigation.tsx'),
    '@': resolve('src'),
  } },
  module: { rules: [
    { test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') },
    { test: /\.css$/, type: 'asset/source' },
  ] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString('errors-only'))) : done()))
const { css: base } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const theme = await readFile('src/components/tasks/uppdrag-theme.css', 'utf8')
postcss.parse(theme).walkRules(rule => assert.ok(rule.selectors.every(selector => selector.startsWith('.uppdrag-scope')), `Unscoped selector: ${rule.selector}`))
for (const path of ['src/app/(dashboard)/uppdrag/layout.tsx', 'src/app/mina-uppdrag/layout.tsx', 'src/app/signe/layout.tsx', 'src/app/offertunderlag/layout.tsx', 'src/app/atgardsarende/layout.tsx']) {
  assert.match(await readFile(path, 'utf8'), /<UppdragScope/, path)
}
const js = await readFile(resolve(output, 'view.js'))
const exampleImage = await readFile('public/landing/besiktning-editorial-v2.png')
const writes = []
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  const json = value => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)) }
  if (request.method !== 'GET') { writes.push(`${request.method} ${path}`); json({}); return }
  if (path === '/api/mina-uppdrag/activation/brand-test') {
    json({ recipientIdentityId: 'brand-person', email: 'anna@example.test', displayName: 'Anna Exempel', status: 'invited', hasAccount: false, expiresAt: '2027-01-01', task: { id: 'brand-task', title: 'Montera innervägg', organizationName: 'Exempelbygg AB' }, currentUser: { email: null, matchesRecipient: false, emailVerified: false } }); return
  }
  if (path.startsWith('/api/action-cases/')) { response.setHeader('Content-Type', 'image/png'); response.end(exampleImage); return }
  if (path.startsWith('/api/')) { json({}); return }
  if (path === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  const asset = new Map([['/uppdrag/brand/logo.svg', 'image/svg+xml'], ['/uppdrag/brand/symbol.svg', 'image/svg+xml'], ['/uppdrag/brand/manrope.ttf', 'font/ttf']]).get(path)
  if (asset) { response.setHeader('Content-Type', asset); response.end(await readFile(resolve('public', path.slice(1)))); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${base}${theme}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(done => server.listen(process.env.PREVIEW_PORT ? Number(process.env.PREVIEW_PORT) : 0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
if (process.argv.includes('--serve')) {
  console.log(`Synthetic Uppdrag preview: ${origin}/uppdrag`)
} else {
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  const errors = [], unexpectedRequests = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (new URL(request.url()).origin === origin || (request.url().startsWith('data:image/') && request.resourceType() === 'image')) request.continue()
    else { unexpectedRequests.push(request.url()); request.abort() }
  })
  async function click(text) { await page.locator(`::-p-xpath(//button[normalize-space(.)="${text}"])`).click() }
  async function checkLayout(label) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label} page overflow`)
    for (const dialog of await page.$$('[role=dialog]')) {
      assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `${label} dialog overflow`)
      assert.match(await dialog.evaluate(el => getComputedStyle(el).fontFamily), /Uppdrag Manrope/)
    }
    assert.deepEqual(errors, [], label)
  }
  const routes = ['/uppdrag', '/mina-uppdrag', '/mina-uppdrag/logga-in', '/mina-uppdrag/aktivera/brand-test', '/mina-uppdrag/uppdrag/brand-task', '/signe/brand-test', '/offertunderlag/brand-test', '/atgardsarende/brand-test']
  for (const width of process.env.TEST_VIEWPORTS?.split(',').map(Number) ?? [1440, 1024, 390, 344]) {
    await page.setViewport({ width, height: 900 })
    for (const path of routes) {
      console.log(`Checking ${width}px ${path}`)
      await page.goto(origin + path, { waitUntil: 'networkidle0' })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForSelector('h1')
      await checkLayout(`${width}px ${path}`)
      assert.match(await page.$eval('.uppdrag-scope', el => getComputedStyle(el).fontFamily), /Uppdrag Manrope/)
      assert.ok(await page.$eval('.uppdrag-brand img', img => img.complete && img.naturalWidth > 0), `${path} logo`)
      assert.ok(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Uppdrag Manrope' && font.status === 'loaded')), 'Local font loaded')
      await page.screenshot({ path: resolve(output, `${width}-${path.replaceAll('/', '_')}.png`), fullPage: true })
      if (path === '/uppdrag') {
        await click('Statistik'); await checkLayout('Statistics')
        await click('Åtgärdsärenden')
        await page.locator('::-p-xpath(//button[contains(., "Träpanel vid entrén")])').click()
        await page.waitForSelector('[role=dialog]')
        await click('Kalkyl'); await checkLayout('Costing portal')
        assert.equal(await page.$eval('[aria-pressed=true]', el => getComputedStyle(el).backgroundColor), 'rgb(255, 247, 214)')
        await page.screenshot({ path: resolve(output, `${width}-costing.png`), fullPage: true })
        await page.locator('button[aria-label="Stäng åtgärd"]').click()
        await click('Aktuellt')
        if (width >= 640) { await click('Nytt uppdrag'); await checkLayout('New task') }
      }
      if (path === '/mina-uppdrag') { await click('Min statistik'); await checkLayout('Recipient statistics') }
      if (path === '/signe/brand-test') {
        await click('Mina uppdrag'); await page.waitForSelector('[role=dialog]')
        await checkLayout('Account portal'); await page.screenshot({ path: resolve(output, `${width}-account.png`), fullPage: true })
      }
    }
    await page.goto(origin + '/requests?parts&packages&allCosts', { waitUntil: 'networkidle0' })
    await click('Begär offert')
    await page.waitForSelector('[role=dialog]')
    await checkLayout('Quote request portal')
    await page.screenshot({ path: resolve(output, `${width}-request.png`), fullPage: true })
    await page.locator('[aria-label="Granska entre.png"]').click()
    await page.waitForSelector('[aria-label="Granska bild"]')
    await page.waitForFunction(() => document.querySelector('[aria-label="Granska bild"] img')?.naturalWidth > 0)
    await checkLayout('Image portal')
    await page.screenshot({ path: resolve(output, `${width}-image.png`) })
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => document.querySelector('[aria-label="Granska bild"] header')?.textContent.includes('2 / 3'))
    await page.keyboard.press('Escape')
    await page.waitForSelector('[aria-label="Granska bild"]', { hidden: true })
    console.log(`PASS ${width}px: eight routes, brand assets, task/costing/quote/account panels and statistics`)
  }
  await page.goto(origin + '/mina-uppdrag/logga-in', { waitUntil: 'networkidle0' })
  assert.equal(await page.$eval('button[type=submit]', el => getComputedStyle(el).backgroundColor), 'rgb(37, 42, 45)')
  await page.locator('input[type=email]').fill('test@example.test')
  await page.locator('input[type=password]').fill('invalid-password')
  await page.locator('button[type=submit]').click()
  await page.waitForSelector('[role=alert]')
  assert.match(await page.$eval('[role=alert]', el => el.textContent), /E-postadressen eller lösenordet är fel/)
  await click('Glömt lösenordet?'); await checkLayout('Password reset')
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
  assert.equal(await page.$eval('.uppdrag-page', el => getComputedStyle(el).backgroundColor), 'rgb(244, 246, 246)')
  await page.focus('input[type=email]')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('input[type=email]')).outlineColor === 'rgb(32, 105, 97)', { timeout: 3000 })
  assert.equal(await page.$eval('input[type=email]', el => getComputedStyle(el).outlineColor), 'rgb(32, 105, 97)')
  await page.emulateMediaFeatures([])
  for (const path of ['/signe/brand-test?expired', '/offertunderlag/brand-test?expired', '/atgardsarende/brand-test?expired', '/mina-uppdrag/uppdrag/brand-task?denied']) {
    await page.goto(origin + path, { waitUntil: 'networkidle0' }); await checkLayout(path)
    assert.ok(await page.$('.uppdrag-brand'))
  }
  await page.goto(origin + '/legacy', { waitUntil: 'networkidle0' })
  assert.equal(await page.$('.uppdrag-scope'), null)
  assert.notEqual(await page.$eval('button', el => getComputedStyle(el).backgroundColor), 'rgb(37, 42, 45)')
  assert.doesNotMatch(await page.$eval('button', el => getComputedStyle(el).fontFamily), /Uppdrag Manrope/)
  assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(unexpectedRequests, [])
  console.log('PASS errors, expired/denied links, password reset and isolation; no backend writes')
} finally { await browser.close(); await new Promise(done => server.close(done)) }
}
