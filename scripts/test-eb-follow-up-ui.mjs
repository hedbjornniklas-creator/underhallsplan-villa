import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

// This harness serves synthetic data only. It never calls Supabase, Resend or
// the real purchase API, and rejects every non-local browser request.
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
const offer = { available: true, reason: null, alreadyActive: false, priceOre: 59900, netPriceOre: 47920, vatOre: 11980, vatRate: 25,
  termsVersion: '2026-09-07', serviceDescription: 'Digital uppföljning. Ingen besiktning ingår.',
  seller: { name: 'Testbolaget AB', orgNumber: 'TEST', address: 'Testgatan 1', email: 'seller@example.invalid' } }
const portalUrl = '/atgarder/test-only-private-token-with-more-than-20-characters'
const posts = []
let failOrder = false
let failOffer = false
let offerRequests = 0
const server = createServer(async (request, response) => {
  if (request.url === '/mock-follow-up') {
    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'GET') {
      offerRequests += 1
      response.statusCode = failOffer ? 503 : 200
      response.end(JSON.stringify(failOffer ? { error: 'Unavailable' } : { offer })); return
    }
    let body = ''; for await (const chunk of request) body += chunk
    const payload = JSON.parse(body); posts.push(payload)
    // Delay the mock response to exercise repeated clicks and busy feedback.
    await new Promise(ok => setTimeout(ok, 350))
    if (payload.action === 'request_code') response.end(JSON.stringify({ challengeId: 'mock-challenge', message: 'En testkod har begärts.' }))
    else if (failOrder) { response.statusCode = 409; response.end(JSON.stringify({ error: 'Testkonflikt — försök igen.' })) }
    else response.end(JSON.stringify({ portalUrl, message: 'Testbeställningen är sparad.' }))
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
  for (const width of [1440, 390]) {
    posts.length = 0; offer.alreadyActive = false; failOrder = false
    await page.setViewport({ width, height: 844 })
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.waitForSelector('#digital-follow-up')
    assert.match(await page.$eval('#digital-follow-up', node => node.textContent), /599 kr inkl\. moms/)
    await page.screenshot({ path: resolve(output, `offer-${width}.png`) })
    await page.locator('#digital-follow-up button').filter(node => node.textContent.includes('Köp åtgärdsuppföljning')).click()
    await page.waitForSelector('dialog[open]')
    assert.equal(await page.evaluate(() => document.activeElement.name), 'email')
    await page.keyboard.press('Escape')
    assert.equal(await page.$('dialog[open]'), null)
    await page.locator('#digital-follow-up button').filter(node => node.textContent.includes('Köp åtgärdsuppföljning')).click()
    await page.type('[name=email]', 'customer@example.invalid')
    await page.$eval('button[type=submit]', node => { node.click(); node.click() })
    await page.waitForFunction(() => document.querySelector('button[type=submit]')?.disabled)
    await page.waitForSelector('[name=code]')
    assert.equal(posts.length, 1, 'double click must request only one code')
    assert.equal(posts[0].action, 'request_code')
    assert.equal(await page.$eval('dialog', node => node.scrollWidth > node.clientWidth), false)
    const values = { code: '123456', name: 'Testkund', invoiceName: 'Testkund', invoiceAddress: 'Testvägen 1', invoicePostalCode: '12345', invoiceCity: 'Teststad' }
    for (const [name, value] of Object.entries(values)) await page.type(`[name=${name}]`, value)
    assert.equal(await page.$$eval('input[type=checkbox]', nodes => nodes.filter(node => node.checked).length), 0)
    await page.$eval('button[type=submit]', node => node.click())
    assert.equal(posts.length, 1, 'unchecked required consent must block ordering')
    for (const checkbox of await page.$$('input[type=checkbox]')) await checkbox.click()
    await page.screenshot({ path: resolve(output, `checkout-${width}.png`) })
    failOrder = true
    await page.$eval('button[type=submit]', node => { node.click(); node.click() })
    await page.waitForSelector('[role=alert]')
    assert.equal(posts.length, 2)
    assert.equal(await page.$eval('[name=name]', node => node.value), 'Testkund', 'API failure must retain entered details')
    failOrder = false
    await page.$eval('button[type=submit]', node => node.click())
    await page.waitForSelector(`a[href="${portalUrl}"]`)
    assert.equal(posts.length, 3)
    assert.equal(posts[2].confirmedPriceOre, 59900)
    assert.equal(posts[2].acceptTerms, true)
    assert.equal(posts[2].acceptInvoice, true)
    assert.equal(posts[2].requestImmediateStart, true)
    assert.equal(await page.$('dialog[open]'), null)
    await page.emulateMediaType('print')
    assert.equal(await page.$eval('#digital-follow-up', node => getComputedStyle(node).display), 'none')
    await page.emulateMediaType('screen')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    console.log(`PASS ${width}px: offer, dialog/keyboard, double click, consents, error retention, price, private link, print hidden`)
  }
  for (const width of [1440, 390]) {
    offer.alreadyActive = false
    await page.setViewport({ width, height: 844 })
    await page.goto(`${url}?view=report`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('#digital-follow-up')
    assert.equal(await page.$$eval('#digital-follow-up', nodes => nodes.length), 1, 'the report must show one purchase card')
    assert.equal(await page.evaluate(() => {
      const card = document.querySelector('#digital-follow-up')
      const hero = document.querySelector('h1').closest('section')
      const firstSection = document.querySelector('#section-summons')
      return Boolean(hero.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING)
        && Boolean(card.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING)
        && card.parentElement.previousElementSibling === hero
    }), true, 'purchase card must appear directly after the hero, before report contents')
    assert.match(await page.$eval('#digital-follow-up', node => node.textContent), /Köp åtgärdsuppföljning/)
    assert.match(await page.$eval('#section-summons', node => node.textContent), /Originalrapporten förblir tillgänglig utan köp/)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: resolve(output, `public-report-${width}.png`), fullPage: true })
    console.log(`PASS ${width}px report: single purchase card immediately after hero, free report accessible, no overflow`)
  }
  await page.goto(`${url}?view=report-no-defects`, { waitUntil: 'networkidle0' })
  assert.equal(await page.$$eval('#digital-follow-up', nodes => nodes.length), 1)
  assert.equal(await page.$('#section-defects_appendices'), null)

  posts.length = 0; offer.available = false
  const unavailableCases = [
    ['report', 'Digital åtgärdsuppföljning är inte tillgänglig för nya beställningar just nu.'],
    ['report', 'Öppna den senast publicerade versionen av utlåtandet för att beställa.'],
    ['report', 'Tjänsten är ännu inte klar för beställning. Kontakta besiktningsföretaget.'],
    ['report-empty', 'Utlåtandet innehåller inga noteringar att följa upp.'],
    ['report', null],
  ]
  for (const [view, reason] of unavailableCases) {
    offer.reason = reason
    await page.goto(`${url}?view=${view}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('#digital-follow-up [role=status]')
    assert.equal(await page.$eval('#digital-follow-up [role=status]', node => node.textContent), reason || unavailableCases[0][1])
    assert.equal(await page.$eval('#digital-follow-up button', node => node.disabled), true)
    await page.$eval('#digital-follow-up button', node => node.click())
    assert.equal(await page.$('dialog[open]'), null, 'unavailable offer must not open checkout')
    assert.match(await page.$eval('#section-summons', node => node.textContent), /Originalrapporten förblir tillgänglig utan köp/)
    assert.equal(posts.length, 0, 'unavailable offer must not send a purchase or code request')
    await page.emulateMediaType('print')
    assert.equal(await page.$eval('#digital-follow-up', node => getComputedStyle(node).display), 'none')
    await page.emulateMediaType('screen')
  }
  await page.screenshot({ path: resolve(output, 'unavailable-390.png'), fullPage: true })
  console.log('PASS unavailable: server reasons and fallback are visible, no checkout/POST, report accessible, print hidden')

  offer.available = true; offer.reason = null; failOffer = true
  await page.goto(`${url}?view=report`, { waitUntil: 'networkidle0' })
  assert.match(await page.$eval('main', node => node.textContent), /Åtgärdsuppföljning kunde inte hämtas/)
  assert.match(await page.$eval('#section-summons', node => node.textContent), /Originalrapporten förblir tillgänglig utan köp/)
  failOffer = false
  await page.locator('button').filter(node => node.textContent.includes('Försök igen')).click()
  await page.waitForSelector('#digital-follow-up')
  const previousRequests = offerRequests
  await page.goto(`${url}?view=preview`, { waitUntil: 'networkidle0' })
  assert.equal(await page.$('#digital-follow-up'), null)
  assert.equal(offerRequests, previousRequests, 'internal preview without endpoint must not invent a public purchase endpoint')
  console.log('PASS load failure: free report accessible, retry recovers; internal preview makes no offer request')

  posts.length = 0; offer.alreadyActive = true; offer.available = false
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.locator('#digital-follow-up button').filter(node => node.textContent.includes('Öppna')).click()
  await page.type('[name=email]', 'customer@example.invalid')
  await page.$eval('button[type=submit]', node => node.click())
  await page.waitForSelector('[name=code]')
  await page.type('[name=code]', '123456')
  assert.equal(await page.$('[name=invoiceName]'), null)
  await page.$eval('button[type=submit]', node => node.click())
  await page.waitForSelector(`a[href="${portalUrl}"]`)
  assert.deepEqual(posts.map(item => item.action), ['request_code', 'access'])
  assert.deepEqual(errors, [])
  console.log('PASS recovery: existing customer access works with new sales disabled and never places another order')
} finally {
  await browser?.close()
  await new Promise(ok => server.close(ok))
}
