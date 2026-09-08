import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

// Synthetic data only. A mock personal-link landing sets an HttpOnly cookie;
// no real email, database, purchase or external browser request is used.
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/eb-follow-up-ui')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/eb-follow-up-order.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? new Error(stats.toString('errors-only'))) : ok()))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const js = await readFile(resolve(output, 'view.js'))
const offer = { available: true, reason: null, retryable: false, alreadyActive: false, priceOre: 59900, netPriceOre: 47920, vatOre: 11980, vatRate: 25,
  termsVersion: '2026-09-08.2', serviceDescription: 'Digital uppföljning. Ingen besiktning ingår.',
  seller: { name: 'Testbolaget AB', orgNumber: 'TEST', address: 'Testgatan 1', email: 'seller@example.invalid' } }
const initialOffer = structuredClone(offer)
const portalUrl = '/atgarder/test-only-private-token-with-more-than-20-characters'
const posts = [], shares = []
let failOrder = false, failOffer = false, failLink = false, accessAvailable = true, retryable = false
let sessionValid = true, leakPublicOffer = false, nonJsonUnauthorized = false
let offerRequests = 0, offerDelay = 0, failedLinkRequests = 0
const server = createServer(async (request, response) => {
  const route = new URL(request.url, 'http://127.0.0.1').pathname
  if (route === '/mock-buyer-link') {
    sessionValid = true
    response.writeHead(303, { 'Set-Cookie': 'mock-customer-session=personal-link; HttpOnly; SameSite=Strict; Path=/', Location: '/?customer=1', 'Cache-Control': 'no-store' })
    response.end(); return
  }
  if (route === '/mock-share') {
    let body = ''; for await (const chunk of request) body += chunk
    shares.push(JSON.parse(body)); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true })); return
  }
  if (route === '/mock-report.pdf') { response.setHeader('Content-Type', 'application/pdf'); response.end('%PDF-1.4\n% Synthetic fixture\n%%EOF'); return }
  if (route === '/mock-follow-up' || route === '/mock-follow-up-other') {
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store')
    const verified = route !== '/mock-follow-up-other' && sessionValid && /(?:^|;\s*)mock-customer-session=personal-link(?:;|$)/.test(request.headers.cookie ?? '')
    if (request.method === 'GET') {
      offerRequests += 1
      if (offerDelay) await new Promise(ok => setTimeout(ok, offerDelay))
      response.statusCode = failOffer ? 503 : 200
      response.end(JSON.stringify(failOffer ? { error: 'Unavailable' } : { verified, offer: verified || leakPublicOffer ? offer : null, accessAvailable, retryable })); return
    }
    let body = ''; for await (const chunk of request) body += chunk
    const payload = JSON.parse(body); posts.push(payload)
    await new Promise(ok => setTimeout(ok, 350))
    if (payload.action === 'request_link') response.end(JSON.stringify({ message: 'Om adressen stämmer skickas en personlig beställarlänk. Ingen beställning görs.', ...(leakPublicOffer ? { verified: true, offer } : {}) }))
    else if (!verified) { response.statusCode = 401; response.end(nonJsonUnauthorized ? '<html>Unauthorized</html>' : JSON.stringify({ error: 'Personlig beställarlänk krävs.' })) }
    else if (failOrder) { response.statusCode = 409; response.end(JSON.stringify({ error: 'Testkonflikt — försök igen.' })) }
    else { offer.alreadyActive = true; response.end(JSON.stringify({ portalUrl, message: payload.action === 'access' ? 'Teståtkomsten är öppnad.' : 'Testbeställningen är sparad.' })) }
    return
  }
  if (route === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  if (route === '/test-logo.svg') { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><text x="0" y="15">Testlogotyp</text></svg>'); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (new URL(request.url()).hostname !== '127.0.0.1') return request.abort()
    if (failLink && request.method() === 'POST' && request.postData()?.includes('request_link')) { failedLinkRequests += 1; return request.abort('failed') }
    return request.continue()
  })
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  const url = `http://127.0.0.1:${server.address().port}`
  async function reset() {
    await page.deleteCookie({ name: 'mock-customer-session', url }); posts.length = 0; shares.length = 0
    Object.assign(offer, structuredClone(initialOffer))
    failOrder = false; failOffer = false; failLink = false; accessAvailable = true; retryable = false
    sessionValid = true; leakPublicOffer = false; nonJsonUnauthorized = false; offerDelay = 0; failedLinkRequests = 0
  }
  async function assertNoCheckout() {
    const text = await page.$eval('main', node => node.textContent)
    assert.doesNotMatch(text, /599 kr|Köp åtgärdsuppföljning|Beställ med betalningsskyldighet|Engångspris|Tillval efter|Testbolaget AB|Vad ingår i priset|Engångskod|Verifiera kod|Bekräfta din e-postadress/)
    for (const name of ['invoiceName', 'name', 'customerType', 'code']) assert.equal(await page.$(`[name=${name}]`), null, `${name} must not exist without personal access`)
    assert.equal(await page.$('input[type=checkbox]'), null)
  }
  async function openEntry() { await page.locator('#digital-follow-up button').filter(node => node.textContent.includes('För beställaren')).click(); await page.waitForSelector('dialog[open]') }
  async function personalAccess() { await page.goto(`${url}/mock-buyer-link`, { waitUntil: 'networkidle0' }); await page.waitForSelector('dialog[open]') }
  async function fillBuyer(customerType = 'consumer') {
    await page.select('[name=customerType]', customerType)
    for (const [name, value] of Object.entries({ name: 'Testkund', invoiceName: 'Testkund', invoiceAddress: 'Testvägen 1', invoicePostalCode: '12345', invoiceCity: 'Teststad' })) await page.type(`[name=${name}]`, value)
  }
  async function consent() { for (const checkbox of await page.$$('input[type=checkbox]')) if (!await checkbox.evaluate(node => node.checked)) await checkbox.click() }
  async function submitTwice() { await page.$eval('button[type=submit]', node => { node.click(); node.click() }); await page.waitForFunction(() => document.querySelector('button[type=submit]')?.disabled) }
  async function assertNoOverflow() {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    if (await page.$('dialog[open]')) assert.equal(await page.$eval('dialog[open]', node => node.scrollWidth > node.clientWidth), false)
  }
  async function clickButton(label) {
    for (const button of await page.$$('button')) if (await button.evaluate((node, expected) => node.textContent.trim() === expected, label)) { await button.click(); return }
    assert.fail(`Missing button: ${label}`)
  }

  for (const width of [1440, 390]) {
    await reset(); await page.setViewport({ width, height: 844 }); await page.goto(url, { waitUntil: 'networkidle0' }); await page.waitForSelector('#digital-follow-up')
    await assertNoCheckout(); await openEntry(); assert.equal(await page.evaluate(() => document.activeElement.name), 'email')
    await page.type('[name=email]', 'customer@example.invalid'); await submitTwice(); await page.keyboard.press('Escape')
    assert.notEqual(await page.$('dialog[open]'), null, 'busy requests prevent accidental dismissal')
    await page.waitForSelector('[role=status]'); await page.waitForFunction(() => !document.querySelector('button[type=submit]')?.disabled)
    assert.deepEqual(posts, [{ action: 'request_link', email: 'customer@example.invalid' }], 'requesting a link neither verifies nor orders')
    await assertNoCheckout(); await assertNoOverflow(); await page.screenshot({ path: resolve(output, `entry-${width}.png`) })
    await page.keyboard.press('Escape'); assert.equal(await page.$('dialog[open]'), null)
    await personalAccess()
    assert.equal(await page.$('[name=email]'), null, 'a personal link opens checkout without email verification'); assert.equal(await page.$('[name=code]'), null)
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('dialog h2')), true)
    assert.equal(await page.evaluate(() => document.cookie.includes('mock-customer-session')), false)
    assert.equal((await page.cookies()).find(cookie => cookie.name === 'mock-customer-session')?.httpOnly, true)
    assert.equal(await page.$eval('[name=customerType]', node => node.value), '', 'customer type must be chosen explicitly')
    assert.equal(await page.$('input[type=checkbox]'), null); assert.equal(await page.$eval('button[type=submit]', node => node.disabled), true)
    await page.screenshot({ path: resolve(output, `checkout-start-${width}.png`) }); await fillBuyer()
    assert.equal(await page.$$eval('input[type=checkbox]', nodes => nodes.length), 4)
    assert.equal(await page.$$eval('input[type=checkbox]', nodes => nodes.filter(node => node.checked).length), 0)
    assert.equal(await page.$$eval('input[type=checkbox]', nodes => nodes.every(node => node.required && node.closest('label'))), true)
    const terms = await page.$eval('[data-testid=follow-up-terms]', node => node.textContent)
    assert.match(terms, /Testbolaget AB/); assert.match(terms, /599 kr inkl\. moms/); assert.match(terms, /Ångerrätt för privatkund/); assert.match(terms, /14 dagar/)
    assert.equal(await page.$eval('[data-testid=follow-up-terms]', node => Boolean(node.closest('details'))), false, 'full terms are not collapsed')
    assert.match(await page.$eval('[name=requestImmediateStart]', node => node.closest('label').textContent), /uttryckligen.*innan ångerfristen på 14 dagar.*inte bort min ångerrätt/s)
    assert.match(await page.$eval('[name=acceptInvoice]', node => node.closest('label').textContent), /betalningsskyldigheten på 599 kr inkl\. moms mot faktura/)
    await page.$eval('[data-testid=withdrawal-form]', node => { node.closest('details').open = true })
    assert.match(await page.$eval('[data-testid=withdrawal-form]', node => node.textContent), /Till: Testbolaget AB.*seller@example.invalid/s)
    assert.equal(await page.$eval('a[href*="konsumentverket"]', node => node.href), 'https://publikationer.konsumentverket.se/mallar-och-blanketter/angerblankett')
    const beforeOrder = posts.length
    await page.$eval('button[type=submit]', node => node.click()); assert.equal(posts.length, beforeOrder)
    await consent()
    for (const name of ['acceptTerms', 'consumerWithdrawalAcknowledged', 'requestImmediateStart', 'acceptInvoice']) {
      await page.click(`[name=${name}]`); assert.equal(await page.$eval('button[type=submit]', node => node.disabled), true, `${name} is required`); await page.click(`[name=${name}]`)
    }
    await assertNoOverflow(); await page.screenshot({ path: resolve(output, `checkout-${width}.png`) })
    failOrder = true; await submitTwice(); await page.waitForSelector('[role=alert]')
    assert.equal(posts.length, beforeOrder + 1); assert.equal(await page.$eval('[name=name]', node => node.value), 'Testkund')
    failOrder = false; await page.$eval('button[type=submit]', node => node.click()); await page.waitForSelector(`a[href="${portalUrl}"]`)
    const order = posts.at(-1)
    assert.equal(order.action, 'order'); assert.equal(order.customerType, 'consumer'); assert.equal(order.confirmedPriceOre, 59900); assert.equal(order.termsVersion, offer.termsVersion)
    for (const name of ['acceptTerms', 'consumerWithdrawalAcknowledged', 'requestImmediateStart', 'acceptInvoice']) assert.equal(order[name], true)
    assert.equal(['code', 'challengeId', 'email'].some(key => key in order), false); assert.equal(order.invoiceOrgNo, null); assert.equal(await page.$('dialog[open]'), null)
    await page.emulateMediaType('print'); assert.equal(await page.$eval('#digital-follow-up', node => getComputedStyle(node).display), 'none'); await page.emulateMediaType('screen'); await assertNoOverflow()
    console.log(`PASS ${width}px: no OTP; personal-link checkout; explicit customer type; four separate unchecked consents; terms/form; price; focus; duplicate guard; retry; print`)
  }

  await reset(); await personalAccess(); await fillBuyer('business')
  assert.equal(await page.$$eval('input[type=checkbox]', nodes => nodes.length), 3); assert.equal(await page.$('[name=consumerWithdrawalAcknowledged]'), null); assert.equal(await page.$('[data-testid=withdrawal-form]'), null)
  assert.match(await page.$eval('[data-testid=follow-up-terms]', node => node.textContent), /Den lagstadgade ångerrätten för konsumenter gäller inte köp för företag/)
  await page.type('[name=invoiceOrgNo]', 'TEST-ORG'); await consent(); await page.select('[name=customerType]', 'consumer')
  assert.equal(await page.$$eval('input[type=checkbox]', nodes => nodes.filter(node => node.checked).length), 0, 'changing customer type resets all consent'); assert.equal(await page.$('[name=invoiceOrgNo]'), null)
  await page.select('[name=customerType]', 'business'); assert.equal(await page.$eval('[name=invoiceOrgNo]', node => node.value), '')
  await consent(); await page.$eval('button[type=submit]', node => node.click()); await page.waitForSelector(`a[href="${portalUrl}"]`)
  assert.equal(posts.at(-1).customerType, 'business'); assert.equal(posts.at(-1).consumerWithdrawalAcknowledged, false)
  console.log('PASS business: own terms/three consents; no consumer form; changing customer type invalidates prior consent')

  for (const width of [1440, 390]) {
    await reset(); await page.setViewport({ width, height: 844 }); await page.goto(`${url}?view=report-actions&customer=1`, { waitUntil: 'networkidle0' }); await page.waitForSelector('dialog[open]')
    await assertNoCheckout(); await page.keyboard.press('Escape'); assert.equal(await page.$$eval('#digital-follow-up', nodes => nodes.length), 1)
    assert.match(await page.$eval('#section-summons', node => node.textContent), /Originalrapporten förblir tillgänglig utan köp/)
    const pdf = await page.$eval('a[href="/mock-report.pdf"]', async node => { const response = await fetch(node.href); return { status: response.status, content: await response.text() } })
    assert.equal(pdf.status, 200); assert.match(pdf.content, /^%PDF/)
    await clickButton('Dela utlåtande'); await page.type('input[placeholder="namn@epost.se"]', 'recipient@example.invalid'); await clickButton('Skicka länk')
    await page.waitForFunction(() => document.body.textContent.includes('Länken skickades till recipient@example.invalid.')); assert.deepEqual(shares, [{ email: 'recipient@example.invalid' }])
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copiedReportUrl = value } } }))
    await clickButton('Kopiera länk'); await page.waitForFunction(() => window.__copiedReportUrl); assert.equal(await page.evaluate(() => window.__copiedReportUrl), `${url}/public-report`)
    await clickButton('Stäng'); await assertNoCheckout(); await assertNoOverflow(); assert.equal(posts.length, 0)
    await page.screenshot({ path: resolve(output, `public-report-${width}.png`), fullPage: true })
    console.log(`PASS ${width}px public report: neutral entry; report/PDF/sharing accessible; copied link excludes private access`)
  }

  await reset(); leakPublicOffer = true; await page.goto(url, { waitUntil: 'networkidle0' }); await assertNoCheckout(); await openEntry()
  await page.type('[name=email]', 'customer@example.invalid'); await page.$eval('button[type=submit]', node => node.click()); await page.waitForSelector('[role=status]'); await assertNoCheckout()
  console.log('PASS fail-closed: public offer and request-link response cannot unlock checkout')
  await reset(); failLink = true; await page.goto(url, { waitUntil: 'networkidle0' }); await openEntry()
  await page.type('[name=email]', 'customer@example.invalid'); await page.$eval('button[type=submit]', node => { node.click(); node.click() }); await page.waitForSelector('[role=alert]')
  assert.equal(failedLinkRequests, 1); assert.equal(posts.length, 0); assert.equal(await page.$eval('[name=email]', node => node.value), 'customer@example.invalid')
  assert.match(await page.$eval('[role=alert]', node => node.textContent), /Anslutningen avbröts/); await assertNoCheckout()
  failLink = false; await page.$eval('button[type=submit]', node => node.click()); await page.waitForSelector('[role=status]')
  assert.equal(posts.length, 1); assert.equal(failedLinkRequests, 1); await assertNoCheckout()
  console.log('PASS link network failure: input retained, no duplicate request, retry remains non-purchasing')
  await reset(); offer.retryable = true; await personalAccess(); await fillBuyer(); await consent()
  await page.locator('button[aria-label="Stäng"]').click()
  offer.priceOre = 69900; offer.seller.name = 'Nytt testbolag AB'
  await page.$eval('#digital-follow-up-retry button', node => node.click())
  await page.waitForFunction(() => document.querySelector('#digital-follow-up')?.textContent.includes('699 kr'))
  await page.locator('#digital-follow-up button').filter(node => node.textContent.includes('Köp')).click()
  assert.equal(await page.$$eval('input[type=checkbox]', nodes => nodes.filter(node => node.checked).length), 0)
  assert.match(await page.$eval('[data-testid=follow-up-terms]', node => node.textContent), /Nytt testbolag AB/)
  assert.equal(await page.$eval('[name=name]', node => node.value), 'Testkund'); assert.equal(posts.length, 0)
  console.log('PASS changed offer: refreshed seller/price invalidates all consents while retaining buyer draft')
  await reset(); offer.termsVersion = '2099-new-version'; await personalAccess(); await assertNoCheckout()
  assert.match(await page.$eval('dialog[open]', node => node.textContent), /Köpvillkoren har uppdaterats/)
  assert.equal(await page.$('button[type=submit]'), null); assert.equal(posts.length, 0)
  assert.equal(await page.$$eval('button', nodes => nodes.some(node => node.textContent === 'Ladda om sidan')), true)
  console.log('PASS newer server terms: stale client cannot display/approve old wording under the new version; explicit reload required')
  await reset(); await personalAccess(); await fillBuyer(); await consent(); sessionValid = false; nonJsonUnauthorized = true
  await page.$eval('button[type=submit]', node => node.click()); await page.waitForSelector('[name=email]'); await assertNoCheckout()
  assert.match(await page.$eval('[role=alert]', node => node.textContent), /beställaråtkomst har gått ut/); assert.equal(posts.filter(post => post.action === 'order').length, 1)
  await personalAccess(); await page.select('[name=customerType]', 'consumer'); assert.equal(await page.$$eval('input[type=checkbox]', nodes => nodes.filter(node => node.checked).length), 0)
  assert.equal(posts.filter(post => post.action === 'order').length, 1)
  console.log('PASS expired private session: non-JSON 401 hides checkout; renewed access needs fresh consent and never orders')
  await reset(); await personalAccess(); await page.goto(`${url}?view=switch-report`, { waitUntil: 'networkidle0' })
  await page.locator('#digital-follow-up button').filter(node => node.textContent.includes('Köp')).click(); await fillBuyer(); await page.locator('button[aria-label="Stäng"]').click(); offerDelay = 500
  await clickButton('Byt testrapport'); await assertNoCheckout(); await page.waitForSelector('#digital-follow-up'); await openEntry()
  assert.equal(await page.$eval('[name=email]', node => node.value), ''); await assertNoCheckout()
  console.log('PASS report navigation: previous private view and draft disappear immediately')

  for (const reason of ['INTERNAL-ERROR-SENTINEL', null]) {
    await reset(); accessAvailable = false; offer.available = false; offer.reason = reason
    await page.goto(`${url}?view=report-empty`, { waitUntil: 'networkidle0' }); assert.equal(await page.$('#digital-follow-up'), null); assert.equal(await page.$('#digital-follow-up-retry'), null)
    await assertNoCheckout(); assert.doesNotMatch(await page.$eval('main', node => node.textContent), /INTERNAL-ERROR/)
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('h1').closest('section').nextElementSibling).display), 'none'); assert.equal(posts.length, 0)
  }
  console.log('PASS unavailable public access: no offer, operational reason, checkout, POST or empty spacing')
  await reset(); offer.available = false; offer.reason = 'INTERNAL-ERROR-SENTINEL'; await personalAccess(); await assertNoCheckout()
  assert.match(await page.$eval('dialog[open]', node => node.textContent), /är inte tillgänglig för den här rapporten/); assert.doesNotMatch(await page.$eval('dialog[open]', node => node.textContent), /INTERNAL-ERROR/)
  assert.equal(await page.$('button[type=submit]'), null); assert.equal(posts.length, 0)
  console.log('PASS private unavailable offer: neutral message, no checkout or leaked operational reason')
  await reset(); accessAvailable = false; retryable = true; await page.goto(`${url}?view=report`, { waitUntil: 'networkidle0' }); await page.waitForSelector('#digital-follow-up-retry'); await assertNoCheckout()
  const beforeRetry = offerRequests; accessAvailable = true; retryable = false; offerDelay = 350
  await page.$eval('#digital-follow-up-retry button', node => { node.click(); node.click() }); await page.waitForSelector('#digital-follow-up'); await assertNoCheckout(); assert.equal(offerRequests, beforeRetry + 1); assert.equal(posts.length, 0)
  console.log('PASS transient failure: one retry request; recovery shows only neutral entry')
  await reset(); failOffer = true; await page.goto(`${url}?view=report`, { waitUntil: 'networkidle0' })
  assert.match(await page.$eval('main', node => node.textContent), /Beställaråtkomsten kunde inte laddas/); assert.match(await page.$eval('#section-summons', node => node.textContent), /Originalrapporten förblir tillgänglig utan köp/)
  failOffer = false; await clickButton('Försök igen'); await page.waitForSelector('#digital-follow-up'); await assertNoCheckout()
  const previousRequests = offerRequests; await page.goto(`${url}?view=preview`, { waitUntil: 'networkidle0' }); assert.equal(await page.$('#digital-follow-up'), null); assert.equal(offerRequests, previousRequests)
  console.log('PASS load failure: report accessible; retry recovers; internal preview makes no customer request')
  for (const width of [1440, 390]) {
    await reset(); offer.alreadyActive = true; offer.available = false; await page.setViewport({ width, height: 844 }); await personalAccess()
    assert.doesNotMatch(await page.$eval('dialog[open]', node => node.textContent), /599 kr|Beställ med betalningsskyldighet/); assert.equal(await page.$('[name=invoiceName]'), null); assert.equal(await page.$('[name=email]'), null)
    await submitTwice(); await page.waitForSelector(`a[href="${portalUrl}"]`); assert.deepEqual(posts, [{ action: 'access' }])
    await page.goto(`${url}?customer=1`, { waitUntil: 'networkidle0' }); await page.waitForSelector('dialog[open]'); await page.$eval('button[type=submit]', node => node.click()); await page.waitForSelector(`a[href="${portalUrl}"]`)
    assert.deepEqual(posts, [{ action: 'access' }, { action: 'access' }]); await assertNoOverflow()
    console.log(`PASS ${width}px existing customer: no code/price/billing/new order; private cookie recovery`)
  }
  assert.deepEqual(errors, [])
} finally { await browser?.close(); await new Promise(ok => server.close(ok)) }
