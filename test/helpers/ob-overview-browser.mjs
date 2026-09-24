import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testOverview(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  async function ready() {
    await page.waitForSelector('.obo-table tbody tr')
    await page.evaluate(() => document.fonts.ready)
  }
  async function layout(label) {
    await page.screenshot({ path: resolve(output, 'latest-check.png'), fullPage: true })
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(node => {
      const rect = node.getBoundingClientRect()
      return node.checkVisibility() && (rect.right > innerWidth + 1 || rect.left < -1)
    }).map(node => `${node.tagName}.${node.className}`).slice(0, 20))
    if (overflow.length) console.log(label, overflow)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: page overflow`)
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.obo, .obo-workspace, .obo-toolbar, .obo-table td, .obo-check, .obo-actions a')]
      .filter(node => node.checkVisibility() && node.scrollWidth > node.clientWidth + 1).map(node => node.className)), [], `${label}: content overflow`)
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.obo button, .obo select, .obo input:not([type=checkbox]), .obo a')]
      .filter(node => node.checkVisibility() && node.getBoundingClientRect().height < 44).map(node => node.outerHTML)), [], `${label}: touch targets`)
    assert.equal(await page.$eval('.obo', node => getComputedStyle(node).fontFamily.includes('ObOverviewManrope')), true)
    assert.equal(await page.$eval('.obo-page-size select', node => {
      const style = getComputedStyle(node)
      const context = document.createElement('canvas').getContext('2d')
      context.font = style.font
      const textWidth = context.measureText(node.selectedOptions[0].textContent).width
      return node.clientWidth >= textWidth + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 20
    }), true, `${label}: full page-size value fits beside the native arrow`)
  }
  try {
    for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920]) {
      await page.setViewport({ width, height: 1000 })
      await page.goto(`${base}/ob`, { waitUntil: 'networkidle0' })
      await ready()
      await layout(`width ${width}`)
      assert.equal(await page.$eval('.obo-shortcuts-content', node => node.checkVisibility()), width >= 1024)
      if (width < 1024) {
        await page.click('.obo-shortcuts-toggle')
        assert.equal(await page.$eval('.obo-shortcuts-content', node => node.checkVisibility()), true)
        assert.equal(await page.$eval('a[href="/ob/assignments"]', node => node.checkVisibility()), true)
        assert.equal(await page.$eval('a[href="/inspections"]', node => node.checkVisibility()), true)
        await page.click('.obo-shortcuts-toggle')
      }
      assert.equal(await page.$eval('[data-row-id="inspection:inspection-1"]', node => node.textContent.includes('Inväntar kund') && node.textContent.includes('Pågår')), true)
      const links = await page.$$eval('[data-row-id="inspection:inspection-1"] a', nodes => nodes.map(node => node.getAttribute('href')))
      assert.deepEqual(links, ['/properties/property-1/ob/inspection-1', '/ob/assignments/assignment-1'])
      if (width >= 1280) {
        const metrics = await page.evaluate(() => ({
          heights: [...document.querySelectorAll('.obo-table tr[data-row-id]')].map(row => row.getBoundingClientRect().height),
          fonts: [...document.querySelectorAll('.obo-table td, .obo-table .obo-cell-text')].filter(node => node.checkVisibility()).map(node => getComputedStyle(node).fontSize),
          width: document.querySelector('.obo-workspace').getBoundingClientRect().width,
        }))
        assert.ok(Math.max(...metrics.heights) - Math.min(...metrics.heights) < 1, `width ${width}: consistent row heights`)
        assert.ok(Math.max(...metrics.heights) <= 56, `width ${width}: compact rows`)
        assert.deepEqual([...new Set(metrics.fonts)], ['14px'], `width ${width}: consistent table typography`)
        assert.ok(metrics.width >= width * .93, `width ${width}: use available page width`)
        assert.equal(await page.$eval('.obo-actions a > span', node => node.checkVisibility()), false, 'Desktop actions use labelled icons')
      } else {
        assert.equal(await page.$eval('.obo-actions a > span', node => node.checkVisibility()), true, 'Reflowed actions retain visible text')
      }
      await page.screenshot({ path: resolve(output, `overview-${width}.png`), fullPage: true })
      if (width === 390) await page.screenshot({ path: resolve(output, 'overview-mobile-390.png') })
      if (width >= 1280) {
        await page.$eval('.obo-heading', node => node.scrollIntoView())
        await page.screenshot({ path: resolve(output, `overview-dense-${width}.png`) })
      }
    }
    const actionRow = '[data-row-id="assignment:assignment-2"]'
    await page.focus(`${actionRow} .obo-row-toggle`)
    await page.keyboard.press('Enter')
    assert.equal(await page.$eval(`${actionRow} .obo-row-toggle`, node => node.getAttribute('aria-expanded')), 'true')
    assert.match(await page.$eval('.obo-row-details', node => node.textContent), /Acceptera uppdraget/)
    await layout('expanded action details')
    await page.keyboard.press('Enter')
    assert.equal((await page.$$('.obo-detail-row')).length, 0)
    await page.goto(`${base}/ob?density=stress`, { waitUntil: 'networkidle0' })
    await ready()
    await page.select('.obo-page-size select', '25')
    const longRow = '[data-row-id="inspection:inspection-1"]'
    const heights = await page.$$eval('.obo-table tr[data-row-id]', nodes => nodes.map(node => node.getBoundingClientRect().height))
    assert.ok(Math.max(...heights) - Math.min(...heights) < 1, 'Long text and missing values must not resize collapsed rows')
    await page.click(`${longRow} .obo-row-toggle`)
    assert.match(await page.$eval('.obo-row-details', node => node.textContent), /mycket-langt-kundnamn.*@example.invalid/)
    assert.match(await page.$eval('.obo-row-details', node => node.textContent), /Arbetet är pausat/)
    await layout('long text details')
    await page.screenshot({ path: resolve(output, 'overview-details-1920.png'), fullPage: true })
    await page.goto(`${base}/ob`, { waitUntil: 'networkidle0' })
    await ready()
    for (const width of [320, 390, 1440]) {
      await page.setViewport({ width, height: 1000 })
      await page.evaluate(() => document.documentElement.setAttribute('data-large-text', ''))
      await layout(`200 percent ${width}`)
      await page.screenshot({ path: resolve(output, `overview-large-${width}.png`), fullPage: true })
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-large-text'))
    await page.setViewport({ width: 1440, height: 1000 })
    await page.click('[aria-label="Nästa sida"]')
    assert.match(await page.$eval('.obo-pagination', node => node.textContent), /11–13 av 13/)
    await page.type('[aria-label="Sök uppdrag"]', 'lindvägen')
    assert.equal((await page.$$('.obo-table tbody tr')).length, 1)
    assert.match(await page.$eval('.obo-pagination', node => node.textContent), /1–1 av 1/)
    await page.click('[aria-label="Rensa sökning"]')
    await page.click('.obo-filter-buttons button:nth-child(3)')
    assert.equal((await page.$$('.obo-table tbody tr')).length, 9)
    await page.click('.obo-filter-buttons button:first-child')
    await page.click('.obo-check input')
    assert.equal((await page.$$('.obo-table tbody tr')).length, 3)
    await page.click('.obo-check input')
    await page.type('[aria-label="Sök uppdrag"]', 'not-a-real-customer')
    await page.waitForSelector('.obo-empty')
    assert.match(await page.$eval('.obo-empty', node => node.textContent), /Inga uppdrag matchar/)
    await page.click('.obo-empty button')
    await page.evaluate(() => { window.__obOverviewTest.fail = true })
    await page.click('[aria-label="Uppdatera uppdragslistan"]')
    await page.waitForSelector('.obo-error')
    assert.match(await page.$eval('.obo-error', node => node.textContent), /senast hämtade/)
    assert.equal((await page.$$('.obo-table tbody tr')).length, 10)
    await page.evaluate(() => { window.__obOverviewTest.fail = false; window.__obOverviewTest.empty = true })
    await page.click('.obo-error button')
    await page.waitForFunction(() => document.querySelector('.obo-empty')?.textContent.includes('Inga ÖB-uppdrag ännu'))
    await page.evaluate(() => { window.__obOverviewTest.empty = false; window.__obOverviewTest.delay = 200 })
    await page.click('[aria-label="Uppdatera uppdragslistan"]')
    assert.equal(await page.$eval('.obo', node => node.getAttribute('aria-busy')), 'true')
    await ready()
    const initialReads = await page.evaluate(() => window.__obOverviewTest.reads)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForFunction(count => window.__obOverviewTest.reads > count, {}, initialReads)
    await page.waitForFunction(() => document.querySelector('.obo').getAttribute('aria-busy') === 'false')
    await page.focus('[aria-label="Sök uppdrag"]')
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'SELECT')
    assert.equal(await page.evaluate(() => window.__obOverviewTest.writes), 0)
    await page.goto(`${base}/ob?state=error`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.obo-error')
    assert.equal((await page.$$('.obo-empty')).length, 0, 'Initial failure must not look like an empty list')
    await page.evaluate(() => { window.__obOverviewTest.fail = false })
    await page.click('.obo-error button')
    await ready()
    await page.evaluate(() => { window.__obOverviewTest.fail = true; window.__obOverviewTest.delay = 500; window.dispatchEvent(new Event('focus')) })
    await page.evaluate(() => { window.__obOverviewTest.fail = false; window.__obOverviewTest.delay = 0; window.dispatchEvent(new Event('focus')) })
    await page.waitForFunction(() => document.querySelector('.obo').getAttribute('aria-busy') === 'false')
    await new Promise(resolve => setTimeout(resolve, 600))
    assert.equal((await page.$$('.obo-error')).length, 0, 'Aborted stale response cannot overwrite the latest successful refresh')
    assert.deepEqual(errors, [])
    console.log('OB overview browser checks passed: 9 widths, uniform compact rows, consistent typography, full-width desktop, keyboard details, long text, 200% text, shortcuts, search, filters, pagination, links, refresh, errors, empty state; no writes.')
  } finally { await browser.close() }
}
