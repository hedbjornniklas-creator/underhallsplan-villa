import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

// Synthetic, loopback-only fixture. No real report delivery, database or mail.
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/eb-report-delivery-ui')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/eb-report-delivery.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? new Error(stats.toString('errors-only'))) : ok()))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const js = await readFile(resolve(output, 'view.js'))
let customer = { email: null, established: false, purchased: false }
let unavailable = false
const posts = []
const metadata = () => ({
  reportLockedAt: '2026-09-08T09:00:00Z', hasActiveLink: true, hasBeenSent: false,
  pdfStatus: 'ready', deliveryStatus: 'finalized',
  defaultRecipientEmail: unavailable ? null : customer.email,
  defaultExtraRecipients: ['contractor@example.test'],
  deliveryCustomer: unavailable ? null : customer, customerContactUnavailable: unavailable,
})
const server = createServer(async (request, response) => {
  if (request.url.startsWith('/api/eb/')) {
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    if (request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk
      const payload = JSON.parse(body); posts.push(payload)
      await new Promise(ok => setTimeout(ok, 200))
      customer = { email: payload.primary_recipient, established: true, purchased: false }
      response.end(JSON.stringify({ ...metadata(), sentRecipients: [customer.email], failedRecipients: [] })); return
    }
    response.end(JSON.stringify(metadata())); return
  }
  if (request.url === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
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
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const url = `http://127.0.0.1:${server.address().port}`
  async function open() {
    await page.goto(url)
    await page.waitForSelector('#eb-delivery-customer')
    await page.waitForFunction(() => !document.body.textContent.includes('Hämtar leveransstatus...'))
  }
  async function sendButton() {
    return page.evaluateHandle(() => [...document.querySelectorAll('button')].find(node => node.textContent === 'Skicka utlåtandet'))
  }
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 1100 })
    customer = { email: null, established: false, purchased: false }; unavailable = false; posts.length = 0
    await open()
    assert.equal(await page.$eval('#eb-delivery-customer', node => node.value), '')
    assert.equal(await page.$eval('#eb-delivery-customer', node => node.readOnly), false)
    const content = await page.$eval('[role=dialog]', node => node.textContent)
    assert.match(content, /Beställare – huvudmottagare/)
    assert.match(content, /Beställarens e-postadress. Övriga mottagare anges nedan./)
    assert.match(content, /Övriga mottagare/)
    assert.doesNotMatch(content, /Extra mottagare/)
    assert.equal(await (await sendButton()).evaluate(node => node.disabled), true)
    assert.equal(await page.$eval('textarea', node => node.value), 'contractor@example.test')
    await page.type('#eb-delivery-customer', 'New.Customer@example.test')
    await page.screenshot({ path: resolve(output, `customer-${width}.png`), fullPage: true })
    await (await sendButton()).evaluate(node => node.click())
    await page.waitForFunction(() => document.querySelector('#eb-delivery-customer').readOnly)
    assert.equal(posts.length, 1)
    assert.equal(posts[0].primary_recipient, 'new.customer@example.test')
    assert.deepEqual(posts[0].extra_recipients, ['contractor@example.test'])
    assert.equal(await page.$eval('#eb-delivery-customer', node => node.value), 'new.customer@example.test')
    const correction = await page.$('a[href$="/follow-up-customer"]')
    assert.ok(correction)
    assert.equal(await correction.evaluate(node => node.textContent.trim()), 'Ändra beställaradress')

    customer = { email: 'frozen-owner@example.test', established: true, purchased: true }
    await open()
    assert.equal(await page.$eval('#eb-delivery-customer', node => node.readOnly), true)
    assert.equal(await page.$eval('#eb-delivery-customer', node => node.value), customer.email)
    assert.equal(await page.$('a[href$="/follow-up-customer"]'), null)
    assert.match(await page.$eval('[role=dialog]', node => node.textContent), /genomfört köp/)
    assert.equal(await page.$eval('textarea', node => node.disabled), false)
    await page.screenshot({ path: resolve(output, `purchased-${width}.png`), fullPage: true })

    unavailable = true
    await open()
    assert.equal(await page.$eval('#eb-delivery-customer', node => node.disabled), true)
    assert.equal(await (await sendButton()).evaluate(node => node.disabled), true)
    assert.match(await page.$eval('[role=dialog]', node => node.textContent), /Beställaruppgifterna kunde inte läsas/)
    unavailable = false
    await page.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent === 'Hämta beställaruppgifter igen').click())
    await page.waitForFunction(() => document.querySelector('#eb-delivery-customer') && !document.querySelector('#eb-delivery-customer').disabled)
    assert.equal(await page.$eval('#eb-delivery-customer', node => node.value), customer.email)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    const beforeUnlock = posts.length
    await page.goto(`${url}/?unlock`)
    await page.waitForFunction(() => document.activeElement?.getAttribute('placeholder') === 'Anledning, minst 10 tecken')
    assert.equal(posts.length, beforeUnlock, 'opening the shortcut must not unlock or send anything')
    const confirmUnlock = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(node => node.textContent === 'Lås upp utlåtandet'))
    assert.equal(await confirmUnlock.evaluate(node => node.disabled), true)
    await page.type('textarea[placeholder="Anledning, minst 10 tecken"]', 'Komplettera noteringarna')
    assert.equal(await confirmUnlock.evaluate(node => node.disabled), false)
    assert.equal(posts.length, beforeUnlock, 'a reason still requires explicit confirmation')
    await page.screenshot({ path: resolve(output, `unlock-shortcut-${width}.png`), fullPage: true })
    await page.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent === 'Avbryt').click())
    assert.equal(await page.$('textarea[placeholder="Anledning, minst 10 tecken"]'), null)
    assert.equal(posts.length, beforeUnlock)
  }
  assert.deepEqual(errors, [])
  console.log('EB delivery UI passed: typed customer, separate contractor, saved and purchased read-only contact, retry; desktop + mobile.')
} finally {
  await browser?.close()
  await new Promise(ok => server.close(ok))
}
