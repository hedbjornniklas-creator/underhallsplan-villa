import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

// Synthetic data only. No Supabase, Resend, real purchase API or external
// browser requests. The mock keeps verification in an HttpOnly cookie.
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/eb-follow-up-ui')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/eb-follow-up-order.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? new Error(stats.toString('errors-only'))) : ok()))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const js = await readFile(resolve(output, 'view.js'))
const offer = { available: true, reason: null, retryable: false, alreadyActive: false, priceOre: 59900, netPriceOre: 47920, vatOre: 11980, vatRate: 25,
  termsVersion: '2026-09-07', serviceDescription: 'Digital uppföljning. Ingen besiktning ingår.',
  seller: { name: 'Testbolaget AB', orgNumber: 'TEST', address: 'Testgatan 1', email: 'seller@example.invalid' } }
const portalUrl = '/atgarder/test-only-private-token-with-more-than-20-characters'
const posts = []
const shares = []
let failOrder = false
let failOffer = false
let accessAvailable = true
let retryable = false
let sessionValid = true
let leakPublicOffer = false
let falseVerification = false
let nonJsonUnauthorized = false
let offerRequests = 0
let offerDelay = 0
const server = createServer(async (request, response) => {
  if (request.url === '/mock-share') {
    let body = ''; for await (const chunk of request) body += chunk
    shares.push(JSON.parse(body))
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ ok: true })); return
  }
  if (request.url === '/mock-report.pdf') {
    response.setHeader('Content-Type', 'application/pdf')
    response.end('%PDF-1.4\n% Synthetic download fixture only\n%%EOF'); return
  }
  if (request.url === '/mock-follow-up' || request.url === '/mock-follow-up-other') {
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    const verified = request.url !== '/mock-follow-up-other' && sessionValid && /(?:^|;\s*)mock-customer-session=verified(?:;|$)/.test(request.headers.cookie ?? '')
    if (request.method === 'GET') {
      offerRequests += 1
      if (offerDelay) await new Promise(ok => setTimeout(ok, offerDelay))
      response.statusCode = failOffer ? 503 : 200
      response.end(JSON.stringify(failOffer ? { error: 'Unavailable' } : { verified, offer: verified || leakPublicOffer ? offer : null, accessAvailable, retryable })); return
    }
    let body = ''; for await (const chunk of request) body += chunk
    const payload = JSON.parse(body); posts.push(payload)
    // Exercise repeated clicks and busy feedback without any external effects.
    await new Promise(ok => setTimeout(ok, 350))
    if (payload.action === 'request_code') response.end(JSON.stringify({ challengeId: 'mock-challenge', message: 'En testkod har begärts.' }))
    else if (payload.action === 'verify_code') {
      if (payload.code !== '123456') { response.statusCode = 401; response.end(JSON.stringify({ error: 'Koden är felaktig eller har gått ut.' })) }
      else if (falseVerification) response.end(JSON.stringify({ verified: false, offer }))
      else {
        response.setHeader('Set-Cookie', 'mock-customer-session=verified; HttpOnly; SameSite=Strict; Path=/')
        sessionValid = true
        response.end(JSON.stringify({ verified: true, offer }))
      }
    } else if (!verified) { response.statusCode = 401; response.end(nonJsonUnauthorized ? '<html>Unauthorized</html>' : JSON.stringify({ error: 'Verifiering krävs.' })) }
    else if (failOrder) { response.statusCode = 409; response.end(JSON.stringify({ error: 'Testkonflikt — försök igen.' })) }
    else {
      offer.alreadyActive = true
      response.end(JSON.stringify({ portalUrl, message: payload.action === 'access' ? 'Teståtkomsten är öppnad.' : 'Testbeställningen är sparad.' }))
    }
    return
  }
  if (request.url === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  if (request.url === '/test-logo.svg') {
    response.setHeader('Content-Type', 'image/svg+xml')
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><text x="0" y="15">Testlogotyp</text></svg>'); return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  await page.setRequestInterception(true)
  page.on('request', request => new URL(request.url()).hostname === '127.0.0.1' ? request.continue() : request.abort())
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  const url = `http://127.0.0.1:${server.address().port}`
  async function reset() {
    await page.deleteCookie({ name: 'mock-customer-session', url })
    posts.length = 0; shares.length = 0
    Object.assign(offer, { available: true, alreadyActive: false, retryable: false, reason: null })
    failOrder = false; failOffer = false; accessAvailable = true; retryable = false
    sessionValid = true; leakPublicOffer = false; falseVerification = false; nonJsonUnauthorized = false; offerDelay = 0
  }
  async function assertNoCheckout() {
    const text = await page.$eval('main', node => node.textContent)
    assert.doesNotMatch(text, /599 kr|Köp åtgärdsuppföljning|Beställ för|Engångspris|Tillval efter|Testbolaget AB|Vad ingår i priset/)
    assert.equal(await page.$('[name=invoiceName]'), null, 'billing must not exist in the DOM before verification')
    assert.equal(await page.$('[name=name]'), null)
    assert.equal(await page.$('input[type=checkbox]'), null)
  }
  async function requestCode({ email = 'customer@example.invalid', doubleClick = false } = {}) {
    if (email) await page.type('[name=email]', email)
    await page.$eval('button[type=submit]', (node, twice) => { node.click(); if (twice) node.click() }, doubleClick)
    await page.waitForFunction(() => document.querySelector('button[type=submit]')?.disabled)
    if (doubleClick) {
      await page.keyboard.press('Escape')
      assert.notEqual(await page.$('dialog[open]'), null, 'busy requests prevent accidental dialog dismissal')
    }
    await page.waitForSelector('[name=code]')
    await page.waitForFunction(() => !document.querySelector('button[type=submit]')?.disabled)
  }
  async function enterCode(code = '123456') {
    await page.$eval('[name=code]', node => node.select())
    await page.type('[name=code]', code)
    await page.$eval('button[type=submit]', node => { node.click(); node.click() })
    await page.waitForFunction(() => document.querySelector('button[type=submit]')?.disabled)
    await page.waitForFunction(() => !document.querySelector('button[type=submit]')?.disabled)
  }
  async function fillBuyer() {
    const values = { name: 'Testkund', invoiceName: 'Testkund', invoiceAddress: 'Testvägen 1', invoicePostalCode: '12345', invoiceCity: 'Teststad' }
    for (const [name, value] of Object.entries(values)) await page.type(`[name=${name}]`, value)
  }
  async function consent() {
    for (const checkbox of await page.$$('input[type=checkbox]')) await checkbox.click()
  }
  async function assertNoOverflow() {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    if (await page.$('dialog[open]')) assert.equal(await page.$eval('dialog[open]', node => node.scrollWidth > node.clientWidth), false)
  }
  async function openEntry() {
    await page.locator('#digital-follow-up button').filter(node => node.textContent.includes('För beställaren')).click()
    await page.waitForSelector('dialog[open]')
  }
  async function clickButton(label) {
    for (const button of await page.$$('button')) {
      if (await button.evaluate((node, expected) => node.textContent.trim() === expected, label)) {
        await button.click()
        return
      }
    }
    assert.fail(`Missing button: ${label}`)
  }

  for (const width of [1440, 390]) {
    await reset()
    await page.setViewport({ width, height: 844 })
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.waitForSelector('#digital-follow-up')
    await assertNoCheckout()
    assert.match(await page.$eval('#digital-follow-up > button', node => node.textContent), /^För beställaren$/)
    await page.screenshot({ path: resolve(output, `entry-${width}.png`) })
    await openEntry()
    assert.equal(await page.evaluate(() => document.activeElement.name), 'email')
    await assertNoCheckout()
    await page.keyboard.press('Escape')
    assert.equal(await page.$('dialog[open]'), null)
    await openEntry()
    await requestCode({ doubleClick: true })
    assert.equal(posts.length, 1, 'double click must request only one code')
    assert.equal(posts[0].action, 'request_code')
    await page.waitForFunction(() => document.activeElement.name === 'code')
    await assertNoCheckout()
    await page.screenshot({ path: resolve(output, `verify-${width}.png`) })
    await assertNoOverflow()

    await enterCode('000000')
    await page.waitForSelector('[role=alert]')
    assert.equal(posts.length, 2, 'verification also guards against double click')
    assert.equal(posts[1].action, 'verify_code')
    assert.match(await page.$eval('[role=alert]', node => node.textContent), /Koden är felaktig/)
    await assertNoCheckout()
    await enterCode()
    await page.waitForSelector('[name=invoiceName]')
    assert.equal(posts.length, 3)
    assert.deepEqual(posts[2], { action: 'verify_code', challengeId: 'mock-challenge', code: '123456' })
    assert.equal(await page.evaluate(() => document.cookie.includes('mock-customer-session')), false, 'verification cookie is HttpOnly')
    assert.equal((await page.cookies()).find(cookie => cookie.name === 'mock-customer-session')?.httpOnly, true)
    assert.equal(await page.$('[name=code]'), null, 'code is discarded after verification')
    assert.equal(await page.$('[name=email]'), null, 'checkout uses the server customer identity')
    await page.waitForFunction(() => document.activeElement === document.querySelector('dialog h2'))
    await page.screenshot({ path: resolve(output, `checkout-start-${width}.png`) })
    assert.match(await page.$eval('#digital-follow-up', node => node.textContent), /599 kr inkl\. moms/)
    const offerText = await page.$eval('#digital-follow-up > div', node => node.textContent)
    assert.match(offerText, /Samla kommentarer, före- och åtgärdsbilder\./)
    assert.doesNotMatch(offerText, /utan att ändra utlåtandet|Ingen prenumeration/)
    await fillBuyer()
    assert.equal(await page.$$eval('input[type=checkbox]', nodes => nodes.filter(node => node.checked).length), 0)
    await page.$eval('button[type=submit]', node => node.click())
    assert.equal(posts.length, 3, 'unchecked required consent must block ordering')
    await consent()
    await assertNoOverflow()
    await page.screenshot({ path: resolve(output, `checkout-${width}.png`) })
    failOrder = true
    await page.$eval('button[type=submit]', node => { node.click(); node.click() })
    await page.waitForSelector('[role=alert]')
    assert.equal(posts.length, 4)
    assert.equal(await page.$eval('[name=name]', node => node.value), 'Testkund', 'API failure must retain entered details')
    failOrder = false
    await page.$eval('button[type=submit]', node => node.click())
    await page.waitForSelector(`a[href="${portalUrl}"]`)
    assert.equal(posts.length, 5)
    const order = posts[4]
    assert.equal(order.action, 'order')
    assert.equal(order.confirmedPriceOre, 59900)
    assert.equal(order.acceptTerms, true)
    assert.equal(order.acceptInvoice, true)
    assert.equal(order.requestImmediateStart, true)
    assert.equal('code' in order || 'challengeId' in order || 'email' in order, false, 'order identity must come from the session')
    assert.equal(await page.$('dialog[open]'), null)
    await page.emulateMediaType('print')
    assert.equal(await page.$eval('#digital-follow-up', node => getComputedStyle(node).display), 'none')
    await page.emulateMediaType('screen')
    await assertNoOverflow()
    console.log(`PASS ${width}px: neutral entry, no checkout before verified code, wrong code, HttpOnly session, focus/keyboard, double click, consents, order retry, price, private link, print`)
  }

  for (const width of [1440, 390]) {
    await reset()
    await page.setViewport({ width, height: 844 })
    await page.goto(`${url}?view=report`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('#digital-follow-up')
    assert.equal(await page.$$eval('#digital-follow-up', nodes => nodes.length), 1, 'report has one neutral customer entry')
    assert.equal(await page.evaluate(() => {
      const entry = document.querySelector('#digital-follow-up')
      const hero = document.querySelector('h1').closest('section')
      const firstSection = document.querySelector('#section-summons')
      return Boolean(hero.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING)
        && Boolean(entry.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING)
        && entry.parentElement.previousElementSibling === hero
    }), true, 'customer entry stays after the hero, before report contents')
    await assertNoCheckout()
    assert.match(await page.$eval('#section-summons', node => node.textContent), /Originalrapporten förblir tillgänglig utan köp/)
    await assertNoOverflow()
    await page.screenshot({ path: resolve(output, `public-report-${width}.png`), fullPage: true })
    console.log(`PASS ${width}px public report: one discreet customer entry, no offer or invoice fields, report remains accessible, no overflow`)
  }
  await page.goto(`${url}?view=report-no-defects`, { waitUntil: 'networkidle0' })
  assert.equal(await page.$$eval('#digital-follow-up', nodes => nodes.length), 1)
  assert.equal(await page.$('#section-defects_appendices'), null)

  for (const width of [1440, 390]) {
    await reset()
    await page.setViewport({ width, height: 844 })
    await page.goto(`${url}?view=report-actions&customer=1`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('dialog[open]')
    await assertNoCheckout()
    await page.keyboard.press('Escape')
    const pdf = await page.$eval('a[href="/mock-report.pdf"]', async node => {
      const response = await fetch(node.href)
      return { status: response.status, type: response.headers.get('Content-Type'), content: await response.text() }
    })
    assert.equal(pdf.status, 200)
    assert.equal(pdf.type, 'application/pdf')
    assert.match(pdf.content, /^%PDF/)
    await clickButton('Dela utlåtande')
    await page.type('input[placeholder="namn@epost.se"]', 'recipient@example.invalid')
    await clickButton('Skicka länk')
    await page.waitForFunction(() => document.body.textContent.includes('Länken skickades till recipient@example.invalid.'))
    assert.deepEqual(shares, [{ email: 'recipient@example.invalid' }])
    // Capture clipboard writes inside this synthetic page, never the real
    // machine clipboard, and verify private/customer-entry parameters stay out.
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async value => { window.__copiedReportUrl = value } },
    }))
    await clickButton('Kopiera länk')
    await page.waitForFunction(() => window.__copiedReportUrl)
    assert.equal(await page.evaluate(() => window.__copiedReportUrl), `${url}/public-report`)
    await clickButton('Stäng')
    await assertNoCheckout()
    await assertNoOverflow()
    assert.equal(posts.length, 0, 'public PDF and sharing need no customer code or checkout request')
    console.log(`PASS ${width}px public actions: PDF and share work without verification; copied URL excludes customer/private parameters`)
  }

  // Defense in depth: neither an accidental public offer nor a non-verified
  // successful HTTP response is authority to reveal checkout.
  await reset(); leakPublicOffer = true
  await page.goto(url, { waitUntil: 'networkidle0' })
  await assertNoCheckout()
  await openEntry(); await requestCode()
  falseVerification = true
  await enterCode()
  await assertNoCheckout()
  assert.match(await page.$eval('[role=alert]', node => node.textContent), /kunde inte verifieras/)
  console.log('PASS fail-closed: public payload offer and verified:false never reveal checkout')

  // An expired server session hides checkout immediately, retains an in-memory
  // draft, and requires a fresh code plus fresh consent before any new order.
  await reset()
  await page.goto(url, { waitUntil: 'networkidle0' })
  await openEntry(); await requestCode(); await enterCode(); await fillBuyer(); await consent()
  sessionValid = false; nonJsonUnauthorized = true
  await page.$eval('button[type=submit]', node => node.click())
  await page.waitForSelector('[name=email]')
  await assertNoCheckout()
  assert.match(await page.$eval('[role=alert]', node => node.textContent), /verifiering har gått ut/)
  assert.equal(await page.$('[name=code]'), null)
  await requestCode({ email: '' }); await enterCode()
  assert.equal(await page.$eval('[name=name]', node => node.value), 'Testkund')
  assert.equal(await page.$eval('[name=invoiceAddress]', node => node.value), 'Testvägen 1')
  assert.equal(await page.$$eval('input[type=checkbox]', nodes => nodes.filter(node => node.checked).length), 0)
  assert.equal(posts.filter(post => post.action === 'order').length, 1, 'reverification never automatically places an order')
  await consent()
  await page.$eval('button[type=submit]', node => node.click())
  await page.waitForSelector(`a[href="${portalUrl}"]`)
  console.log('PASS expired session: hides price/checkout, requires fresh verification and consent, retains hidden draft, no automatic order')

  await reset()
  await page.goto(`${url}?view=switch-report`, { waitUntil: 'networkidle0' })
  await openEntry(); await requestCode(); await enterCode(); await fillBuyer()
  await page.locator('button[aria-label="Stäng"]').click()
  offerDelay = 500
  await page.locator('button').filter(node => node.textContent === 'Byt testrapport').click()
  await assertNoCheckout()
  await page.waitForSelector('#digital-follow-up')
  await openEntry()
  assert.equal(await page.$eval('[name=email]', node => node.value), '')
  await assertNoCheckout()
  console.log('PASS report navigation: previous verification and draft disappear before the new report loads')

  await reset()
  await page.goto(url, { waitUntil: 'networkidle0' })
  await openEntry(); await requestCode()
  await page.type('[name=email]', '.changed')
  assert.equal(await page.$('[name=code]'), null, 'changing email invalidates the pending code')
  assert.match(await page.$eval('button[type=submit]', node => node.textContent), /Skicka engångskod/)
  await assertNoCheckout()
  console.log('PASS email change: discards old code challenge and never unlocks checkout')

  for (const reason of [
    'Digital åtgärdsuppföljning är inte tillgänglig för nya beställningar just nu.',
    'Öppna den senast publicerade versionen av utlåtandet för att beställa.',
    'Tjänsten är ännu inte klar för beställning. Kontakta besiktningsföretaget.',
    'Utlåtandet innehåller inga noteringar att följa upp.',
    null,
  ]) {
    await reset(); accessAvailable = false; offer.available = false; offer.reason = reason
    await page.goto(`${url}?view=report-empty`, { waitUntil: 'networkidle0' })
    assert.equal(await page.$('#digital-follow-up'), null, 'no customer entry when the server says it is unavailable')
    assert.equal(await page.$('#digital-follow-up-retry'), null)
    await assertNoCheckout()
    if (reason) assert.equal((await page.$eval('main', node => node.textContent)).includes(reason), false)
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('h1').closest('section').nextElementSibling).display), 'none', 'hidden entry leaves no empty spacing')
    assert.match(await page.$eval('#section-summons', node => node.textContent), /Originalrapporten förblir tillgänglig utan köp/)
    assert.equal(posts.length, 0)
  }
  await page.screenshot({ path: resolve(output, 'unavailable-390.png'), fullPage: true })
  console.log('PASS unavailable public access: no entry, offer, operational reason, checkout, POST or empty spacing')

  await reset()
  await page.goto(url, { waitUntil: 'networkidle0' })
  await openEntry(); await requestCode()
  offer.available = false; offer.reason = 'INTERNAL-ERROR-SENTINEL'
  await enterCode()
  await assertNoCheckout()
  assert.match(await page.$eval('dialog[open]', node => node.textContent), /är inte tillgänglig för den här rapporten/)
  assert.doesNotMatch(await page.$eval('dialog[open]', node => node.textContent), /INTERNAL-ERROR/)
  assert.equal(await page.$('button[type=submit]'), null)
  assert.deepEqual(posts.map(post => post.action), ['request_code', 'verify_code'])
  console.log('PASS offer becomes unavailable after verification: neutral message, no purchase fields or order')

  await reset(); accessAvailable = false; retryable = true
  await page.goto(`${url}?view=report`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('#digital-follow-up-retry')
  assert.equal(await page.$('#digital-follow-up'), null)
  await assertNoCheckout()
  await page.emulateMediaType('print')
  assert.equal(await page.$eval('#digital-follow-up-retry', node => getComputedStyle(node).display), 'none')
  await page.emulateMediaType('screen')
  await page.screenshot({ path: resolve(output, 'retry-390.png') })
  const beforeRetry = offerRequests
  accessAvailable = true; retryable = false; offerDelay = 350
  await page.$eval('#digital-follow-up-retry button', node => { node.click(); node.click() })
  await page.waitForFunction(() => document.querySelector('#digital-follow-up-retry button')?.disabled)
  await page.waitForSelector('#digital-follow-up')
  await assertNoCheckout()
  assert.equal(offerRequests, beforeRetry + 1, 'retry must not submit parallel requests')
  assert.equal(posts.length, 0)
  offerDelay = 0
  console.log('PASS transient failure: discreet retry, no offer, one request, recovery shows only neutral entry')

  await reset(); failOffer = true
  await page.goto(`${url}?view=report`, { waitUntil: 'networkidle0' })
  assert.match(await page.$eval('main', node => node.textContent), /Beställaråtkomsten kunde inte laddas/)
  assert.match(await page.$eval('#section-summons', node => node.textContent), /Originalrapporten förblir tillgänglig utan köp/)
  failOffer = false
  await page.locator('button').filter(node => node.textContent.includes('Försök igen')).click()
  await page.waitForSelector('#digital-follow-up')
  await assertNoCheckout()
  const previousRequests = offerRequests
  await page.goto(`${url}?view=preview`, { waitUntil: 'networkidle0' })
  assert.equal(await page.$('#digital-follow-up'), null)
  assert.equal(offerRequests, previousRequests, 'internal preview must not invent a public endpoint')
  console.log('PASS load failure: public report accessible, retry recovers; internal preview makes no customer request')

  for (const width of [1440, 390]) {
    await reset(); offer.alreadyActive = true; offer.available = false
    await page.setViewport({ width, height: 844 })
    await page.goto(url, { waitUntil: 'networkidle0' })
    await assertNoCheckout()
    await openEntry(); await requestCode(); await enterCode()
    assert.doesNotMatch(await page.$eval('dialog[open]', node => node.textContent), /599 kr|Beställ för/)
    assert.equal(await page.$('[name=invoiceName]'), null)
    await page.screenshot({ path: resolve(output, `existing-access-${width}.png`) })
    await page.$eval('button[type=submit]', node => { node.click(); node.click() })
    await page.waitForSelector(`a[href="${portalUrl}"]`)
    assert.deepEqual(posts.map(item => item.action), ['request_code', 'verify_code', 'access'])
    assert.deepEqual(posts[2], { action: 'access' })
    // A previously verified customer can recover access after page reload,
    // including when new orders have been disabled.
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.locator('#digital-follow-up button').filter(node => node.textContent.includes('Öppna')).click()
    assert.equal(await page.$('[name=email]'), null)
    await page.$eval('button[type=submit]', node => node.click())
    await page.waitForSelector(`a[href="${portalUrl}"]`)
    assert.deepEqual(posts.map(item => item.action), ['request_code', 'verify_code', 'access', 'access'])
    await assertNoOverflow()
    console.log(`PASS ${width}px existing customer: verification before access, no price/billing/new order, cookie recovery after reload`)
  }

  await reset()
  await page.goto(`${url}?customer=1`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('dialog[open]')
  await assertNoCheckout()
  assert.equal(await page.evaluate(() => document.activeElement.name), 'email')
  assert.equal(posts.length, 0, 'explicit customer entry only opens the neutral dialog')
  console.log('PASS explicit customer entry: opens neutral verification dialog without auto-request or checkout')
  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  await new Promise(ok => server.close(ok))
}
