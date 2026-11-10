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
  const rows = () => page.$$eval('tr[data-row-id]', nodes => nodes.map(node => node.dataset.rowId))
  async function chooseFilter(value) {
    if (await page.$eval('.obo-filter-select', node => node.checkVisibility())) await page.select('.obo-filter-select select', value)
    else await page.click(`.obo-filter-buttons button:nth-child(${({ all: 1, active: 2, closed: 3, 'to-invoice': 4 })[value]})`)
  }
  async function layout(label) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: page overflow`)
    assert.deepEqual(await page.$$eval('.obo-address', nodes => nodes.filter(node => node.checkVisibility() && node.getBoundingClientRect().width < 100)
      .map(node => ({ row: node.closest('tr')?.dataset.rowId, width: node.getBoundingClientRect().width }))), [], `${label}: addresses retain readable width`)
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
      assert.equal(await page.$eval('.obo-table tr[data-row-id]', node => getComputedStyle(node).display === 'table-row'),
        !await page.$eval('.obo-filter-select', node => node.checkVisibility()), `${width}: row layout follows the responsive filter controls`)
      const links = await page.$$eval('.obo a, .obh-list-links a', nodes => nodes.map(node => node.getAttribute('href')))
      assert.ok(links.every(link => link.includes('orgId=11111111-1111-4111-8111-111111111111')))
      assert.ok(links.every(link => link.startsWith('/tu/') || (link.startsWith('/tu?') && link.includes('copyFrom=')) || link.startsWith('/api/report-v2/') || link.startsWith('/settings/profil?')))
      assert.equal(await page.$eval('.obo-pagination', node => node.textContent.includes('1–10 av 15 uppdrag')), true)
      await page.screenshot({ path: resolve(output, `tu-home-${width}.png`), fullPage: width >= 960 })
      for (const [selector, heading, confirmation] of [
        ['.obh-actions > button:first-child', 'Ny teknisk utredning', false],
        ['.obh-actions > button:first-child', 'Ny teknisk utredning', true],
        ['.tu-start-investigation', 'Starta utredning?', false],
      ]) {
        await page.click(selector)
        await page.waitForSelector('[role="dialog"]')
        assert.ok(await page.$eval('[role="dialog"]', (node, title) => node.textContent.includes(title), heading), `${width}: ${selector} opens ${heading}`)
        if (confirmation) {
          assert.ok(await page.$eval('[role="dialog"]', node => {
            const choice = [...node.querySelectorAll('button')].find(button => /uppdragsbekräftelse/i.test(button.textContent))
            choice?.click(); return Boolean(choice)
          }), `${width}: the unified create dialog offers a confirmation mode`)
          await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some(node => node.textContent.trim() === 'Spara utkast'))
        }
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
    assert.match(await page.$eval('.obo-row-details', node => node.textContent), /Acceptera uppdraget/)
    await page.click('button[aria-label="Rensa sökning"]')
    await page.click('.obo-filter-buttons button:nth-child(3)')
    await page.waitForFunction(() => document.querySelectorAll('tr[data-row-id]').length === 4)
    await page.click('.obo-filter-buttons button:first-child')
    await page.click('.obo-check:not(:last-child) input')
    await page.waitForFunction(() => document.querySelectorAll('tr[data-row-id]').length === 2)
    assert.deepEqual(await page.$$eval('tr[data-row-id]', rows => rows.map(row => row.dataset.rowId).sort()), ['assignment:assignment-2', 'assignment:assignment-4'])
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

    for (const width of [390, 960, 1440]) {
      await page.setViewport({ width, height: 1000 })
      await page.goto(`${base}/tu?state=billing`, { waitUntil: 'networkidle0' })
      await ready()
      assert.equal((await rows()).length, 10)
      for (const [index, expected] of [[1, 19], [2, 18], [3, 1], [4, 12]]) {
        assert.equal(await page.$eval(`.obo-filter-buttons button:nth-child(${index}) span`, node => Number(node.textContent)), expected,
          `${width}: billing counts are computed before pagination`)
      }
      await chooseFilter('active')
      await page.select('.obo-page-size select', '25')
      assert.equal((await rows()).length, 18)
      for (const id of ['inspection-1', 'inspection-12', 'unavailable', 'unknown', 'ongoing-invoiced']) {
        assert.ok((await rows()).includes(`investigation:${id}`), `${width}: ${id} remains current until completed and invoiced`)
      }
      assert.equal((await rows()).includes('investigation:invoiced'), false)
      assert.equal(await page.$eval('tr[data-row-id="investigation:inspection-12"]', node => node.dataset.marker), 'active')
      assert.match(await page.$eval('tr[data-row-id="investigation:inspection-12"] td:nth-child(6)', node => node.textContent), /Låst/,
        'Invoice grouping never changes the actual investigation status')
      assert.match(await page.$eval('tr[data-row-id="investigation:unknown"] .tu-billing-status', node => node.textContent), /Ej tillgänglig/)
      assert.match(await page.$eval('tr[data-row-id="assignment:assignment-2"] .tu-billing-status', node => node.textContent), /–/,
        'An assignment without an investigation cannot be invoice-marked')
      assert.equal(await page.$$eval('.tu-billing-status input, .tu-billing-status button', nodes => nodes.length), 0, 'List billing status is read-only')
      for (const privateValue of ['TU-INTERNAL-NUMBER-MUST-NOT-APPEAR', 'TU-PRIVATE-BILLING-ACTOR']) {
        assert.equal(await page.$eval('.tu-overview', (node, value) => node.outerHTML.includes(value), privateValue), false,
          `${width}: invoice number and actor do not leak into list markup`)
      }
      await layout(`Billing current ${width}`)
      await page.screenshot({ path: resolve(output, `tu-billing-${width}.png`), fullPage: width >= 960 })
      const billingRow = await page.$('tr[data-row-id="investigation:inspection-12"]')
      await billingRow.screenshot({ path: resolve(output, `tu-billing-row-${width}.png`) })
      await chooseFilter('closed')
      assert.deepEqual(await rows(), ['investigation:invoiced'])
      assert.equal(await page.$eval('tr[data-row-id="investigation:invoiced"]', node => node.dataset.marker), 'closed')
      await chooseFilter('to-invoice')
      await page.select('.obo-page-size select', '10')
      assert.equal((await rows()).length, 10)
      assert.match(await page.$eval('.obo-pagination', node => node.textContent), /1–10 av 12 uppdrag/)
      assert.match(await page.$eval('.tu-billing-unavailable', node => node.textContent), /2/)
      const first = await rows()
      await page.click('button[aria-label="Nästa sida"]')
      assert.equal((await rows()).length, 2)
      assert.equal(new Set([...first, ...await rows()]).size, 12)
      assert.match(await page.$eval('.obo-pagination', node => node.textContent), /11–12 av 12 uppdrag/)
      assert.equal(await page.evaluate(() => window.__tuOverviewTest.writes), 0, 'List billing filters never create invoices, reopen or edit investigations')
      await layout(`Att fakturera ${width}`)
    }
    console.log('TU billing: 390/960/1440 layouts, current vs invoiced, unknown status, standalone assignments, read-only/private metadata and 12-row pagination passed.')
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
