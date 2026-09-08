import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

// Synthetic data only. The private endpoint renews a session from its bearer;
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
let failOrder = false, failOffer = false, failTransport = false, retryable = false, transientLookup = false
let sessionValid = true, buyerValid = true, leakUnauthorizedOffer = false, nonJsonUnauthorized = false
let offerRequests = 0, offerDelay = 0, failedOrderRequests = 0, sessionRenewals = 0
const server = createServer(async (request, response) => {
  const route = new URL(request.url, 'http://127.0.0.1').pathname
  if (route === '/mock-share') {
    let body = ''; for await (const chunk of request) body += chunk
    shares.push(JSON.parse(body)); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true })); return
  }
  if (route === '/mock-report.pdf') { response.setHeader('Content-Type', 'application/pdf'); response.end('%PDF-1.4\n% Synthetic fixture\n%%EOF'); return }
  if (route === portalUrl) { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<main id="mock-private-portal">Privat testportal</main>'); return }
  if (/^\/api\/eb\/customer\/[^/]+\/follow-up$/.test(route)) {
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store')
    const verified = !route.includes('/other-buyer-') && buyerValid
    if (verified && !sessionValid) {
      sessionValid = true; sessionRenewals += 1
      response.setHeader('Set-Cookie', 'mock-customer-session=personal-link; HttpOnly; SameSite=Strict; Path=/')
    }
    if (request.method === 'GET') {
      offerRequests += 1
      if (offerDelay) await new Promise(ok => setTimeout(ok, offerDelay))
      response.statusCode = failOffer ? 503 : 200
      response.end(JSON.stringify(failOffer ? { error: 'Unavailable' } : transientLookup ? { verified: false, offer: null, retryable: true } : { verified, offer: verified || leakUnauthorizedOffer ? offer : null, accessAvailable: verified, retryable })); return
    }
    let body = ''; for await (const chunk of request) body += chunk
    const payload = JSON.parse(body); posts.push(payload)
    await new Promise(ok => setTimeout(ok, 350))
    if (!verified) { response.statusCode = 401; response.end(nonJsonUnauthorized ? '<html>Unauthorized</html>' : JSON.stringify({ error: 'Personlig beställarlänk krävs.' })) }
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
    if (failTransport && request.method() === 'POST' && request.postData()?.includes('order')) { failedOrderRequests += 1; return request.abort('failed') }
    return request.continue()
  })
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  const url = `http://127.0.0.1:${server.address().port}`
  async function reset() {
    await page.deleteCookie({ name: 'mock-customer-session', url }); posts.length = 0; shares.length = 0
    Object.assign(offer, structuredClone(initialOffer))
    failOrder = false; failOffer = false; failTransport = false; retryable = false; transientLookup = false
    sessionValid = true; buyerValid = true; leakUnauthorizedOffer = false; nonJsonUnauthorized = false; offerDelay = 0; failedOrderRequests = 0; sessionRenewals = 0
  }
  async function assertNoCheckout() {
    const text = await page.$eval('main', node => node.textContent)
    assert.doesNotMatch(text, /599 kr|Köp åtgärdsuppföljning|Beställ med betalningsskyldighet|Engångspris|Tillval efter|Testbolaget AB|Vad ingår i priset|Engångskod|Verifiera kod|Bekräfta din e-postadress|För beställaren|Skicka min beställarlänk/)
    for (const name of ['invoiceName', 'name', 'customerType', 'code', 'email']) assert.equal(await page.$(`[name=${name}]`), null, `${name} must not exist without personal access`)
    assert.equal(await page.$('input[type=checkbox]'), null)
    assert.equal(await page.$('[data-testid=follow-up-toolbar]'), null, 'unavailable or unauthorized reports must not expose a follow-up toolbar entry')
  }
  async function assertDisabledToolbar() {
    await page.waitForSelector('[data-testid=follow-up-toolbar] button')
    assert.equal(await page.$eval('[data-testid=follow-up-toolbar] button', node => node.disabled), true)
    assert.equal(await page.$eval('[data-testid=follow-up-toolbar] button', node => node.textContent.trim()), 'Åtgärdsuppföljning')
    assert.match(await page.$eval('[data-testid=follow-up-toolbar]', node => node.textContent), /Aktiveras efter köp/)
    assert.equal(await page.$eval('[data-testid=follow-up-toolbar]', node => Boolean(node.closest('#digital-follow-up'))), false, 'toolbar entry is separate from the purchase panel')
    const before = posts.length
    await page.$eval('[data-testid=follow-up-toolbar] button', node => { node.click(); node.click() })
    assert.equal(posts.length, before); assert.equal(await page.$('dialog[open]'), null, 'disabled header entry must not initiate checkout or access')
  }
  async function assertActivePanel() {
    assert.match(await page.$eval('#digital-follow-up h2', node => node.textContent), /^Åtgärdsuppföljningen är aktiverad$/)
    assert.doesNotMatch(await page.$eval('#digital-follow-up', node => node.textContent), /599 kr|Beställ med betalningsskyldighet|Engångspris|Tillval efter|Köp åtgärdsuppföljning|portalen/i)
    assert.equal(await page.$('#digital-follow-up dialog'), null, 'active access must not retain an unused checkout modal')
    assert.equal(await page.$('[name=invoiceName]'), null); assert.equal(await page.$('input[type=checkbox]'), null)
    assert.doesNotMatch(await page.$eval('[data-testid=follow-up-toolbar]', node => node.textContent), /Aktiveras efter köp/)
  }
  async function assertPrivateLinkNavigationRecovery() {
    const before = posts.length
    await page.evaluate(() => {
      for (const link of document.querySelectorAll('[data-testid=follow-up-toolbar] a, #digital-follow-up > div a')) {
        link.addEventListener('click', event => event.preventDefault())
      }
      const toolbar = document.querySelector('[data-testid=follow-up-toolbar] a')
      toolbar.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }))
    })
    assert.equal(await page.$eval('[data-testid=follow-up-toolbar] a', node => node.getAttribute('aria-busy')), 'false', 'modified anchor clicks must not lock the original report')
    await page.evaluate(() => {
      const toolbar = document.querySelector('[data-testid=follow-up-toolbar] a')
      const panel = document.querySelector('#digital-follow-up > div a')
      toolbar.click(); toolbar.click(); panel.click()
    })
    await page.waitForFunction(() => document.querySelector('[data-testid=follow-up-toolbar] a')?.getAttribute('aria-busy') === 'true')
    assert.equal(await page.$eval('#digital-follow-up > div a', node => node.getAttribute('aria-disabled')), 'true', 'private anchors share navigation busy feedback and guard')
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })))
    assert.equal(await page.$eval('[data-testid=follow-up-toolbar] a', node => node.getAttribute('aria-busy')), 'true', 'only a real bfcache restore resets pending navigation')
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    await page.waitForFunction(() => document.querySelector('[data-testid=follow-up-toolbar] a')?.getAttribute('aria-busy') === 'false')
    assert.equal(await page.$eval('#digital-follow-up > div a', node => node.getAttribute('aria-disabled')), 'false')
    assert.equal(await page.$eval('[data-testid=follow-up-toolbar] a', node => node.textContent.trim()), 'Åtgärdsuppföljning')
    assert.equal(posts.length, before, 'direct private links and browser-back recovery never create an access request or new order')
  }
  async function openCheckout() { await page.locator('#digital-follow-up > div button').filter(node => node.textContent.includes('Köp') || node.textContent.includes('Öppna')).click(); await page.waitForSelector('dialog[open]') }
  async function personalAccess({ open = true, view = 'buyer-report' } = {}) {
    await page.goto(`${url}?view=${view}&customer=1`, { waitUntil: 'networkidle0' })
    assert.equal(await page.$('dialog[open]'), null, 'arrival never opens checkout automatically')
    if (open) { await page.waitForSelector('#digital-follow-up'); await openCheckout() }
  }
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
  async function assertSafeSharingAndPdf() {
    const pdfUrl = await page.$eval('a[href="/mock-report.pdf"]', node => node.getAttribute('href'))
    assert.equal(pdfUrl, '/mock-report.pdf'); assert.doesNotMatch(pdfUrl, /bestallare|atgarder|test-buyer-secret/)
    await clickButton('Dela utlåtande')
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copiedReportUrl = value } } }))
    await clickButton('Kopiera länk'); await page.waitForFunction(() => window.__copiedReportUrl)
    assert.equal(await page.evaluate(() => window.__copiedReportUrl), `${url}/public-report`, 'the private buyer view must only copy the public, read-only report link')
    await page.type('input[placeholder="namn@epost.se"]', 'recipient@example.invalid'); await clickButton('Skicka länk')
    await page.waitForFunction(() => document.body.textContent.includes('Länken skickades till recipient@example.invalid.'))
    assert.deepEqual(shares.at(-1), { email: 'recipient@example.invalid' }, 'sharing must never carry a buyer or remediation token')
    await clickButton('Stäng')
  }

  for (const width of [1440, 390]) {
    await reset(); await page.setViewport({ width, height: 844 }); const beforeOfferLoad = offerRequests; await personalAccess({ open: false })
    await page.waitForSelector('#digital-follow-up'); assert.equal(posts.length, 0)
    assert.equal(offerRequests, beforeOfferLoad + 1, 'toolbar and panel share one offer request')
    await assertDisabledToolbar()
    assert.equal(await page.$eval('#digital-follow-up > div button', node => node.textContent), 'Köp åtgärdsuppföljning – 599 kr inkl. moms')
    assert.equal(await page.evaluate(() => document.querySelector('#digital-follow-up').parentElement.previousElementSibling === document.querySelector('h1').closest('section')), true, 'prominent buyer offer is directly under the report hero')
    await assertNoOverflow(); await page.screenshot({ path: resolve(output, `buyer-report-${width}.png`), fullPage: true }); await openCheckout()
    assert.equal(await page.$('[name=email]'), null, 'a personal link opens checkout without email verification'); assert.equal(await page.$('[name=code]'), null)
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('dialog h2')), true)
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
    await assertActivePanel()
    assert.equal(await page.$eval('[data-testid=follow-up-toolbar] a', node => node.getAttribute('href')), portalUrl, 'purchase immediately enables the header link without reload or a second access request')
    assert.equal(await page.$eval('[data-testid=follow-up-toolbar] a', node => node.textContent.trim()), 'Åtgärdsuppföljning')
    assert.notEqual(new URL(page.url()).pathname, portalUrl, 'purchase confirmation stays on the report')
    assert.equal(posts.filter(post => post.action === 'access').length, 0)
    await assertPrivateLinkNavigationRecovery()
    await assertSafeSharingAndPdf(); await page.screenshot({ path: resolve(output, `buyer-active-${width}.png`), fullPage: true })
    await page.emulateMediaType('print'); assert.equal(await page.$eval('#digital-follow-up', node => getComputedStyle(node).display), 'none'); await page.emulateMediaType('screen'); await assertNoOverflow()
    console.log(`PASS ${width}px: one shared offer; disabled header before buy; immediate active header/compact panel after order; anchor navigation busy/bfcache recovery; safe buyer sharing/PDF; consents; duplicate guard; retry; print`)
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
    await reset(); await page.setViewport({ width, height: 844 })
    await page.setCookie({ name: 'mock-customer-session', value: 'personal-link', url, httpOnly: true })
    const beforePublic = offerRequests
    await page.goto(`${url}?view=report-actions&customer=1`, { waitUntil: 'networkidle0' })
    await assertNoCheckout(); assert.equal(await page.$('dialog[open]'), null); assert.equal(await page.$('#digital-follow-up'), null)
    assert.equal(offerRequests, beforePublic, 'public reports never fetch a buyer offer, even with an ambient buyer cookie and customer flag')
    assert.match(await page.$eval('#section-summons', node => node.textContent), /Originalrapporten förblir tillgänglig utan köp/)
    const pdf = await page.$eval('a[href="/mock-report.pdf"]', async node => { const response = await fetch(node.href); return { status: response.status, content: await response.text() } })
    assert.equal(pdf.status, 200); assert.match(pdf.content, /^%PDF/)
    await clickButton('Dela utlåtande'); await page.type('input[placeholder="namn@epost.se"]', 'recipient@example.invalid'); await clickButton('Skicka länk')
    await page.waitForFunction(() => document.body.textContent.includes('Länken skickades till recipient@example.invalid.')); assert.deepEqual(shares, [{ email: 'recipient@example.invalid' }])
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copiedReportUrl = value } } }))
    await clickButton('Kopiera länk'); await page.waitForFunction(() => window.__copiedReportUrl); assert.equal(await page.evaluate(() => window.__copiedReportUrl), `${url}/public-report`)
    await clickButton('Stäng'); await assertNoCheckout(); await assertNoOverflow(); assert.equal(posts.length, 0)
    await page.screenshot({ path: resolve(output, `public-report-${width}.png`), fullPage: true })
    console.log(`PASS ${width}px public report: no offer/entry/fetch even with buyer cookie; report/PDF/sharing accessible; clean copied URL`)
  }

  await reset(); buyerValid = false; leakUnauthorizedOffer = true; await personalAccess({ open: false }); await assertNoCheckout()
  assert.notEqual(await page.$('#digital-follow-up-access-error'), null)
  console.log('PASS fail-closed: an unauthorized private response never reveals an accidentally included offer')
  await reset(); await personalAccess(); await fillBuyer(); await consent(); failTransport = true
  await page.$eval('button[type=submit]', node => { node.click(); node.click() }); await page.waitForSelector('[role=alert]')
  assert.equal(failedOrderRequests, 1); assert.equal(posts.length, 0); assert.equal(await page.$eval('[name=name]', node => node.value), 'Testkund')
  assert.match(await page.$eval('[role=alert]', node => node.textContent), /Anslutningen avbröts/)
  assert.equal(await page.$$eval('input[type=checkbox]', nodes => nodes.filter(node => node.checked).length), 4)
  failTransport = false; await page.$eval('button[type=submit]', node => node.click()); await page.waitForSelector(`a[href="${portalUrl}"]`)
  assert.equal(posts.length, 1); assert.equal(failedOrderRequests, 1)
  console.log('PASS transport failure: buyer fields/consents retained; one guarded request and deliberate retry')
  await reset(); await personalAccess(); await fillBuyer(); await consent(); sessionValid = false
  await page.$eval('button[type=submit]', node => node.click()); await page.waitForSelector(`a[href="${portalUrl}"]`)
  assert.equal(sessionRenewals, 1); assert.equal(posts.length, 1)
  assert.equal(posts[0].name, 'Testkund'); assert.equal(posts[0].consumerWithdrawalAcknowledged, true)
  assert.equal(await page.$('[name=email]'), null); assert.equal(await page.evaluate(() => document.cookie.includes('mock-customer-session')), false)
  assert.equal((await page.cookies()).find(cookie => cookie.name === 'mock-customer-session')?.httpOnly, true)
  console.log('PASS short session expiry: private bearer transparently renews session and submits existing fields/consents without email or re-entry')
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
  await reset(); offer.retryable = true; await personalAccess(); await fillBuyer(); await consent(); await page.locator('button[aria-label="Stäng"]').click()
  transientLookup = true
  await page.$eval('#digital-follow-up-retry button', node => node.click()); await page.waitForFunction(() => !document.querySelector('#digital-follow-up-retry button')?.disabled)
  assert.equal(await page.$('#digital-follow-up-access-error'), null); await openCheckout()
  assert.equal(await page.$eval('[name=name]', node => node.value), 'Testkund'); assert.equal(await page.$$eval('input[type=checkbox]', nodes => nodes.filter(node => node.checked).length), 4)
  assert.equal(posts.length, 0)
  await personalAccess({ open: false }); await assertNoCheckout(); assert.notEqual(await page.$('#digital-follow-up-retry'), null); assert.equal(await page.$('#digital-follow-up-access-error'), null)
  transientLookup = false; offer.retryable = false; await clickButton('Försök igen'); await page.waitForSelector('#digital-follow-up'); assert.equal(await page.$('dialog[open]'), null)
  console.log('PASS retryable verified:false: existing draft/consents remain intact; first load shows retry, never expired-link guidance')
  await reset(); offer.termsVersion = '2099-new-version'; await personalAccess({ open: false }); await assertNoCheckout()
  assert.match(await page.$eval('#digital-follow-up-terms-changed', node => node.textContent), /Köpvillkoren har uppdaterats/)
  assert.equal(await page.$('button[type=submit]'), null); assert.equal(posts.length, 0)
  assert.equal(await page.$$eval('button', nodes => nodes.some(node => node.textContent === 'Ladda om sidan')), true)
  console.log('PASS newer server terms: stale client cannot display/approve old wording under the new version; explicit reload required')
  await reset(); await personalAccess(); await fillBuyer(); await consent(); buyerValid = false; nonJsonUnauthorized = true
  await page.$eval('button[type=submit]', node => node.click()); await page.waitForSelector('#digital-follow-up-access-error'); await assertNoCheckout()
  assert.match(await page.$eval('#digital-follow-up-access-error', node => node.textContent), /gått ut eller återkallats, kontakta besiktningsföretaget/); assert.equal(posts.filter(post => post.action === 'order').length, 1)
  assert.equal(await page.$('dialog[open]'), null)
  buyerValid = true; await clickButton('Försök igen'); await page.waitForSelector('#digital-follow-up'); await openCheckout()
  assert.equal(await page.$eval('[name=name]', node => node.value), 'Testkund'); assert.equal(await page.$$eval('input[type=checkbox]', nodes => nodes.filter(node => node.checked).length), 0)
  assert.equal(posts.filter(post => post.action === 'order').length, 1)
  console.log('PASS genuinely invalid bearer: non-JSON 401 hides checkout; private guidance/retry; renewed authority clears consents and never orders')
  await reset(); await personalAccess(); await page.goto(`${url}?view=switch-report`, { waitUntil: 'networkidle0' })
  await page.locator('#digital-follow-up button').filter(node => node.textContent.includes('Köp')).click(); await fillBuyer(); await page.locator('button[aria-label="Stäng"]').click(); offerDelay = 500
  await clickButton('Byt testrapport'); await assertNoCheckout(); await page.waitForSelector('#digital-follow-up-access-error'); await assertNoCheckout()
  console.log('PASS report navigation: previous private view and draft disappear immediately')

  for (const reason of ['INTERNAL-ERROR-SENTINEL', null]) {
    await reset(); offer.available = false; offer.reason = reason
    await personalAccess({ open: false, view: 'buyer-empty' }); assert.equal(await page.$('#digital-follow-up'), null); assert.equal(await page.$('#digital-follow-up-retry'), null); assert.equal(await page.$('#digital-follow-up-access-error'), null)
    await assertNoCheckout(); assert.doesNotMatch(await page.$eval('main', node => node.textContent), /INTERNAL-ERROR/)
    assert.equal(await page.evaluate(() => document.querySelector('h1').closest('section').nextElementSibling.querySelector('summary')?.textContent), 'Visa innehåll', 'unavailable offers do not leave an empty panel wrapper or spacing'); assert.equal(posts.length, 0)
  }
  console.log('PASS unavailable private service: no sales banner, operational reason, checkout, POST or empty spacing')
  await reset(); offer.available = false; retryable = true; await personalAccess({ open: false }); await page.waitForSelector('#digital-follow-up-retry'); await assertNoCheckout()
  const beforeRetry = offerRequests; offer.available = true; retryable = false; offerDelay = 350
  await page.$eval('#digital-follow-up-retry button', node => { node.click(); node.click() }); await page.waitForSelector('#digital-follow-up'); assert.equal(await page.$('dialog[open]'), null); assert.equal(offerRequests, beforeRetry + 1); assert.equal(posts.length, 0)
  console.log('PASS transient private failure: one retry request; recovery restores box without auto-opening checkout')
  await reset(); failOffer = true; await personalAccess({ open: false })
  assert.match(await page.$eval('main', node => node.textContent), /Beställaråtkomsten kunde inte laddas/); assert.match(await page.$eval('#section-summons', node => node.textContent), /Originalrapporten förblir tillgänglig utan köp/)
  failOffer = false; await clickButton('Försök igen'); await page.waitForSelector('#digital-follow-up'); assert.equal(await page.$('dialog[open]'), null)
  const previousRequests = offerRequests; await page.goto(`${url}?view=preview`, { waitUntil: 'networkidle0' }); assert.equal(await page.$('#digital-follow-up'), null); assert.equal(offerRequests, previousRequests)
  await assertNoCheckout()
  await page.goto(`${url}?view=buyer-expired`, { waitUntil: 'networkidle0' }); await assertNoCheckout(); assert.equal(offerRequests, previousRequests)
  console.log('PASS load failure: report accessible; retry recovers; internal preview makes no customer request')
  for (const width of [1440, 390]) {
    await reset(); offer.alreadyActive = true; offer.available = false; await page.setViewport({ width, height: 844 }); await personalAccess({ open: false })
    await assertActivePanel()
    assert.equal(await page.$('[name=email]'), null)
    assert.equal(await page.$eval('[data-testid=follow-up-toolbar] button', node => node.disabled), false, 'already-purchased access remains enabled when new sales are disabled')
    assert.equal(posts.length, 0); await assertNoOverflow()
    await page.screenshot({ path: resolve(output, `buyer-revisit-${width}.png`), fullPage: true })
    await page.evaluate(() => {
      const toolbar = document.querySelector('[data-testid=follow-up-toolbar] button')
      const panel = document.querySelector('#digital-follow-up > div button')
      toolbar.click(); toolbar.click(); panel.click()
    })
    await page.waitForFunction(() => document.querySelector('[data-testid=follow-up-toolbar] button')?.disabled && document.querySelector('#digital-follow-up > div button')?.disabled)
    assert.match(await page.$eval('[data-testid=follow-up-toolbar] button', node => node.textContent), /Öppnar/)
    assert.match(await page.$eval('#digital-follow-up > div button', node => node.textContent), /Öppnar åtgärdsuppföljningen/)
    assert.equal(await page.$('dialog[open]'), null)
    await page.waitForSelector('#mock-private-portal'); assert.equal(new URL(page.url()).pathname, portalUrl); assert.deepEqual(posts, [{ action: 'access' }])
    await personalAccess({ open: false }); await clickButton('Öppna åtgärdsuppföljningen'); await page.waitForSelector('#mock-private-portal')
    assert.deepEqual(posts, [{ action: 'access' }, { action: 'access' }])
    console.log(`PASS ${width}px existing customer: active toolbar and compact panel despite disabled new sales; both share busy/double-click guard; safe access redirect; no modal/new order/automatic navigation`)
  }
  await reset(); offer.alreadyActive = true; failOrder = true; await personalAccess({ open: false }); await clickButton('Åtgärdsuppföljning')
  await page.waitForSelector('#digital-follow-up > p[role=alert]'); assert.match(await page.$eval('#digital-follow-up > p[role=alert]', node => node.textContent), /Testkonflikt/)
  assert.equal(await page.$('dialog[open]'), null); assert.deepEqual(posts, [{ action: 'access' }]); assert.notEqual(new URL(page.url()).pathname, portalUrl)
  assert.equal(await page.$eval('[data-testid=follow-up-toolbar] button', node => node.disabled), false)
  failOrder = false; await clickButton('Öppna åtgärdsuppföljningen'); await page.waitForSelector('#mock-private-portal'); assert.deepEqual(posts, [{ action: 'access' }, { action: 'access' }])
  console.log('PASS existing access failure: inline error and explicit retry, no hidden modal or new order')
  assert.deepEqual(errors, [])
} finally { await browser?.close(); await new Promise(ok => server.close(ok)) }
