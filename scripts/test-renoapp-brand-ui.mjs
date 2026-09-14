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
const output = resolve('tmp/renoapp-brand-ui')
await mkdir(output, { recursive: true })
await new Promise((done, reject) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/renoapp-brand-view.tsx'),
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    react: resolve('node_modules/react'), 'react-dom': resolve('node_modules/react-dom'),
    '@/lib/supabaseClient': resolve('test/fixtures/renoapp-brand-supabase.ts'),
    '@': resolve('src'), 'next/navigation': resolve('test/fixtures/renoapp-brand-navigation.ts'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString('errors-only'))) : done()))
const { css: base } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const theme = await readFile('src/components/renoapp/renoapp-theme.css', 'utf8')
postcss.parse(theme).walkRules(rule => assert.ok(rule.selectors.every(selector => selector.startsWith('.renoapp-scope')), `Unscoped selector: ${rule.selector}`))
const css = base + await readFile('src/components/public/public.css', 'utf8') + theme
const js = await readFile(resolve(output, 'view.js'))
const brf = { id: 'brf-test', name: 'Testföreningen med ett längre namn', slug: 'brand-test', role: 'board', isPublicApplyEnabled: true, isPublicApplyListed: true }
const context = { accessibleBrfs: [brf, { ...brf, id: 'second', name: 'Andra föreningen' }], activeBrfId: brf.id, viewerName: 'Testperson', stats: { newCases: 3, needInfoCases: 1, handledCases: 8 } }
const writes = []
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  const json = value => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)) }
  if (request.method !== 'GET') { writes.push({ path, method: request.method }); json({}); return }
  if (path === '/api/renoapp/app/context') { json(context); return }
  if (path === '/api/renoapp/app/brf') { json({ items: [brf] }); return }
  if (path === '/api/renoapp/app/users') { json({ items: [{ brf, members: [{ profileId: 'test', fullName: 'Testperson', email: 'test@example.test', role: 'board', receivesGeneralInfoEmails: true, receivesCaseEventEmails: true }], pendingInvites: [] }] }); return }
  if (path === '/api/renoapp/invites/brand-test') {
    json({ mode: 'brf_onboarding', state: 'open', brf,
      invite: { email: 'test@example.test', fullName: 'Testperson', role: 'board', kind: 'brf_activation', expiresAt: '2027-01-01' },
      currentUser: { email: null, matchesInvite: false }, activationMemberInvite: null }); return
  }
  if (path.startsWith('/api/')) { json({ current: null, versions: [] }); return }
  if (path === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  const asset = new Map([['/renoapp/brand/logo.svg', ['logo.svg', 'image/svg+xml']], ['/renoapp/brand/manrope.ttf', ['manrope.ttf', 'font/ttf']]]).get(path)
  if (asset) { response.setHeader('Content-Type', asset[1]); response.end(await readFile(resolve('public/renoapp/brand', asset[0]))); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.setRequestInterception(true)
  page.on('request', request => new URL(request.url()).origin === origin ? request.continue() : request.abort())
  for (const width of process.env.TEST_VIEWPORTS?.split(',').map(Number) ?? [344, 390, 768, 1440]) {
    await page.setViewport({ width, height: 844 })
    for (const path of ['/renoapp/login', '/renoapp/app', '/renoapp/app/brf', '/renoapp/app/users', '/renoapp/invite/brand-test']) {
      await page.goto(origin + path, { waitUntil: 'networkidle0' })
      await page.evaluate(() => document.fonts.ready)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px ${path} overflow`)
      assert.deepEqual(errors, [], `${width}px ${path} runtime errors`)
      await page.waitForSelector('.renoapp-scope')
      assert.match(await page.$eval('.renoapp-scope', el => getComputedStyle(el).fontFamily), /RenoApp Manrope/)
      assert.ok(await page.$eval('.reno-brand img', img => img.complete && img.naturalWidth > 0))
      await page.screenshot({ path: resolve(output, `${width}-${path.replaceAll('/', '_')}.png`), fullPage: true })
      if (width < 1100 && !path.includes('/invite/')) {
        assert.ok(await page.$eval('.reno-header', el => el.getBoundingClientRect().height <= 76))
        await page.locator('button[aria-label="Öppna meny"]').click()
        await page.waitForSelector('dialog[open]')
        assert.equal(await page.$eval('body', el => el.style.overflow), 'hidden')
        assert.equal(await page.$eval('dialog', el => el.scrollWidth > el.clientWidth), false)
        await page.screenshot({ path: resolve(output, `${width}-menu-${path.endsWith('login') ? 'public' : 'portal'}.png`) })
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => !document.querySelector('dialog').open)
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Öppna meny')
        assert.equal(await page.$eval('body', el => el.style.overflow), '')
      }
    }
    console.log(`PASS ${width}px: login, portal, BRF, users, activation, logo, font and menu`)
  }
  await page.setViewport({ width: 344, height: 844 })
  await page.goto(origin + '/renoapp/app', { waitUntil: 'networkidle0' })
  await page.locator('button[aria-label="Öppna meny"]').click()
  await page.setViewport({ width: 1440, height: 844 })
  await page.waitForFunction(() => !document.querySelector('dialog').open)
  assert.equal(await page.$eval('body', el => el.style.overflow), '')
  await page.goto(origin + '/renoapp/login', { waitUntil: 'networkidle0' })
  assert.equal(await page.$eval('button[type="submit"]', el => getComputedStyle(el).backgroundColor), 'rgb(71, 103, 134)')
  await page.locator('input[type="email"]').fill('test@example.test')
  await page.locator('input[type="password"]').fill('test-password')
  await page.locator('button[type="submit"]').click()
  await page.waitForSelector('[role="alert"]')
  assert.match(await page.$eval('[role="alert"]', el => el.textContent), /E-postadressen eller lösenordet är fel/)
  await page.locator('::-p-xpath(//button[contains(., "Glömt lösenordet")])').click()
  await page.screenshot({ path: resolve(output, 'password-reset.png'), fullPage: true })
  assert.deepEqual(errors, [], 'Password reset runtime errors')
  await page.waitForFunction(() => document.body.textContent.includes('Återställ lösenord'))
  assert.match(await page.$eval('button[type="submit"]', el => getComputedStyle(el).backgroundColor), /71, 103, 134/)
  await page.goto(origin + '/legacy', { waitUntil: 'networkidle0' })
  assert.equal(await page.$('.reno-auth'), null)
  assert.notEqual(await page.$eval('button[type="submit"]', el => getComputedStyle(el).backgroundColor), 'rgb(71, 103, 134)')
  assert.deepEqual(errors, [])
  assert.deepEqual(writes, [], 'Visual QA must not create invites, change settings or send mail')
  console.log('PASS scope isolation, desktop resize, login error and reset; no backend writes')
} finally { await browser.close(); await new Promise(done => server.close(done)) }
