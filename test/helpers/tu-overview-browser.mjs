import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testTuOverview(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  async function ready() {
    await page.waitForSelector('.tu-overview[aria-busy="false"]')
    await page.evaluate(() => document.fonts.ready)
  }
  async function layout(label) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: page overflow`)
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.obo-toolbar, .obo-table td, .obo-check, .obo-actions a, .obh-actions')]
      .filter(node => node.checkVisibility() && node.scrollWidth > node.clientWidth + 1).map(node => node.className)), [], `${label}: content overflow`)
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.obo button, .obo select, .obo input:not([type=checkbox]), .obo a, .obh-actions button, .obh-actions a')]
      .filter(node => node.checkVisibility() && node.getBoundingClientRect().height < 44).map(node => node.outerHTML)), [], `${label}: touch targets`)
  }
  try {
    for (const width of [320, 390, 768, 960, 1280, 1440, 1920]) {
      await page.setViewport({ width, height: 1000 })
      await page.goto(`${base}/tu`, { waitUntil: 'networkidle0' })
      await ready()
      await layout(`${width}`)
      assert.equal((await page.$$('.obo-table tr[data-row-id]')).length, 10)
      assert.equal(await page.$eval('.obo-table tr[data-row-id]', node => getComputedStyle(node).display === 'table-row'), width >= 960)
      const links = await page.$$eval('.obo a, .obh-list-links a', nodes => nodes.map(node => node.getAttribute('href')))
      assert.ok(links.every(link => link.includes('orgId=11111111-1111-4111-8111-111111111111')))
      assert.ok(links.every(link => link.startsWith('/tu/') || link.startsWith('/api/report-v2/')))
      assert.equal(await page.$eval('.obo-pagination', node => node.textContent.includes('1–10 av 15 uppdrag')), true)
      await page.screenshot({ path: resolve(output, `tu-home-${width}.png`), fullPage: width >= 960 })
      for (const [selector, heading] of [
        ['.obh-actions > button:first-child', 'Ny teknisk utredning'],
        ['.obh-actions > button:nth-child(2)', 'Ny teknisk utredning'],
        ['.tu-start-investigation', 'Starta utredning?'],
      ]) {
        await page.click(selector)
        await page.waitForSelector('[role="dialog"]')
        assert.ok(await page.$eval('[role="dialog"]', (node, title) => node.textContent.includes(title), heading), `${width}: ${selector} opens ${heading}`)
        await page.click('[role="dialog"] button[aria-label="Stäng"]')
        await page.waitForSelector('[role="dialog"]', { hidden: true })
      }
      assert.equal(await page.evaluate(() => window.__tuOverviewTest.writes), 0, 'Opening a dialog never creates/sends anything')
    }
    await page.setViewport({ width: 1440, height: 1000 })
    await page.goto(`${base}/tu`, { waitUntil: 'networkidle0' })
    await ready()
    await page.click('button[aria-label="Nästa sida"]')
    await page.waitForFunction(() => document.querySelector('.obo-pagination').textContent.includes('11–15 av 15'))
    assert.equal((await page.$$('.obo-pdf-link')).length, 4)
    await page.type('input[aria-label="Sök uppdrag"]', 'Långgatan')
    await page.waitForFunction(() => document.querySelectorAll('tr[data-row-id]').length === 1)
    assert.equal(await page.$eval('tr[data-row-id]', node => node.dataset.rowId), 'assignment:assignment-2')
    await page.click('.obo-row-toggle')
    assert.match(await page.$eval('.obo-row-details', node => node.textContent), /Godkänt uppdrag att starta/)
    await page.click('button[aria-label="Rensa sökning"]')
    await page.click('.obo-filter-buttons button:nth-child(3)')
    await page.waitForFunction(() => document.querySelectorAll('tr[data-row-id]').length === 4)
    await page.click('.obo-filter-buttons button:first-child')
    await page.click('.obo-check:not(:last-child) input')
    await page.waitForFunction(() => document.querySelectorAll('tr[data-row-id]').length === 1)
    await page.click('.obo-check:not(:last-child) input')
    await page.select('.obo-page-size select', '25')
    assert.equal((await page.$$('tr[data-row-id]')).length, 15)
    await page.click('.obo-check:last-child input')
    await page.waitForFunction(() => document.querySelectorAll('tr[data-row-id]').length === 16)
    await page.select('.obo-sort select', 'customer')
    assert.equal(await page.$eval('.obo-customer', node => node.textContent), 'Anna Andersson')
    await page.evaluate(() => { window.__tuOverviewTest.wrongOrg = true; window.__tuOverviewTest.empty = true })
    await page.click('button[aria-label="Uppdatera uppdragslistan"]')
    await page.waitForSelector('.obo-error')
    assert.equal((await page.$$('tr[data-row-id]')).length, 16, 'Foreign organization response does not replace existing rows')
    await page.evaluate(() => { window.__tuOverviewTest.wrongOrg = false; window.__tuOverviewTest.empty = false })
    await page.click('.obo-error button')
    await page.waitForSelector('.obo-error', { hidden: true })
    await page.goto(`${base}/tu?state=empty`, { waitUntil: 'networkidle0' })
    await ready()
    assert.match(await page.$eval('.obo-empty', node => node.textContent), /Inga TU-uppdrag ännu/)
    await page.screenshot({ path: resolve(output, 'tu-home-empty.png') })
    await page.goto(`${base}/tu?state=error`, { waitUntil: 'networkidle0' })
    await ready()
    assert.match(await page.$eval('.obo-error', node => node.textContent), /Kunde inte uppdatera uppdragslistan/)
    assert.equal(await page.$eval('body', node => node.textContent.includes('internal diagnostics')), false)
    await page.screenshot({ path: resolve(output, 'tu-home-error.png') })
    await page.evaluate(() => { window.__tuOverviewTest.fail = false; window.__tuOverviewTest.delay = 300 })
    await page.click('.obo-error button')
    await page.waitForSelector('.tu-overview[aria-busy="true"]')
    assert.equal(await page.$eval('button[aria-label="Uppdatera uppdragslistan"]', node => node.disabled), true)
    await ready()
    assert.equal((await page.$$('tr[data-row-id]')).length, 10)
    assert.deepEqual(errors, [])
    console.log('TU overview: 7 viewports, dialogs, scoped links, filters, search, paging, PDF links, empty/error/loading/retry and organization mismatch passed.')
  } finally { await browser.close() }
}
