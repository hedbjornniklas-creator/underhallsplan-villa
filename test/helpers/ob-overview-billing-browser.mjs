import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testOverviewBilling(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const ready = () => page.waitForSelector('.ob-billing-overview[aria-busy="false"]')
  const ids = () => page.$$eval('tr[data-row-id]', nodes => nodes.map(node => node.dataset.rowId))
  async function filter(value, width) {
    if (width < 1200) await page.select('.obo-filter-select select', value)
    else await page.click('.obo-filter-buttons button:nth-child(' + ({ all: 1, active: 2, closed: 3, 'to-invoice': 4 })[value] + ')')
    await ready()
    await page.waitForFunction(value => [...document.querySelectorAll('.obo-filter-buttons button')].some(node => node.getAttribute('aria-pressed') === 'true' && node.textContent.startsWith(value)), {}, ({ all: 'Alla', active: 'Aktuella', closed: 'Avslutade', 'to-invoice': 'Att fakturera' })[value])
  }
  try {
    for (const width of [390, 1440]) {
      await page.setViewport({ width, height: 1000 })
      await page.goto(base + '/ob?state=billing', { waitUntil: 'networkidle0' }); await ready()
      await filter('to-invoice', width)
      await page.waitForFunction(() => document.querySelectorAll('tr[data-row-id]').length === 2)
      assert.deepEqual(new Set(await ids()), new Set(['inspection:inspection-3', 'inspection:legacy-0']))
      assert.equal(await page.$$eval('tr[data-row-id] input[type=checkbox]', nodes => nodes.length), 0)
      assert.equal(await page.$eval('.obo-table', node => node.outerHTML.includes('MUST-NOT-SHOW-IN-LIST')), false)
      assert.equal(await page.$eval('tr[data-row-id="inspection:inspection-3"]', node => node.textContent.includes('Klar') && node.textContent.includes('Ej fakturerad')), true)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      assert.deepEqual(await page.$$eval('.obo-table td', nodes => nodes.filter(node => node.checkVisibility() && node.scrollWidth > node.clientWidth + 1).map(node => node.className)), [])
      await page.screenshot({ path: resolve(output, 'ob-to-invoice-' + width + '.png'), fullPage: true })
      await filter('active', width)
      await page.waitForFunction(() => document.querySelector('tr[data-row-id="inspection:inspection-3"]'))
      assert.ok((await ids()).includes('inspection:legacy-0'))
      await filter('closed', width)
      await page.waitForFunction(() => !document.querySelector('tr[data-row-id="inspection:inspection-3"]'))
      assert.equal((await ids()).includes('inspection:legacy-0'), false)
      assert.equal((await ids()).includes('inspection:legacy-1'), false, 'Unavailable billing never means invoiced')
    }
    await page.goto(base + '/ob?state=billing-unavailable', { waitUntil: 'networkidle0' }); await ready()
    assert.match(await page.$eval('.obo-error', node => node.textContent), /Databasstödet/)
    assert.equal((await ids()).length, 0)
    assert.deepEqual(errors, [])
    console.log('OB overview billing: mobile/desktop, current retains unbilled completed, closed only invoiced, independent to-invoice, read-only status and legacy unavailable passed.')
  } finally { await browser.close() }
}
