import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { resolve } from 'node:path'

export async function testUnlock(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => request.url().startsWith(base) || request.url().startsWith('data:') ? request.continue() : request.abort())
  const open = async () => {
    await page.waitForSelector('.ob-delivery-state button')
    await page.click('.ob-delivery-state button')
    await page.waitForSelector('dialog[open]')
  }
  try {
    for (const width of [320, 390, 1280]) {
      await page.setViewport({ width, height: 900 })
      await page.goto(`${base}/round?section=delivery&locked`, { waitUntil: 'networkidle0' })
      await open()
      assert.equal(await page.$eval('dialog footer .obm-primary', node => node.disabled), true)
      await page.type('dialog textarea', 'Kort')
      assert.equal(await page.$eval('dialog footer .obm-primary', node => node.disabled), true)
      await page.keyboard.press('Escape')
      assert.equal((await page.$$('dialog[open]')).length, 0)
      assert.equal(await page.evaluate(() => window.__obFormTest.writes.length), 0)
      await open()
      await page.type('dialog textarea', 'Komplettera uppgift om garaget')
      await page.evaluate(() => { window.__obFormTest.failSaves = true })
      await page.click('dialog footer .obm-primary')
      await page.waitForFunction(() => document.querySelector('dialog')?.textContent.includes('Du får bara låsa upp dina egna besiktningar.'))
      assert.equal(await page.$eval('.ob-delivery-state', node => node.textContent.includes('Nuvarande läge: Låst')), true)
      assert.equal(await page.$eval('dialog textarea', node => node.value), 'Komplettera uppgift om garaget')
      await page.evaluate(() => { window.__obFormTest.failSaves = false; window.__obFormTest.saveDelay = 600 })
      await page.screenshot({ path: resolve(output, `unlock-${width}.png`) })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      assert.equal(await page.$eval('dialog', node => node.scrollWidth > node.clientWidth + 1), false)
      if (width >= 768) assert.ok(await page.$eval('dialog', node => node.getBoundingClientRect().height) < 550, 'desktop confirmation stays compact')
      await page.click('dialog footer .obm-primary')
      assert.equal(await page.$eval('dialog footer .obm-primary', node => node.disabled), true)
      await page.keyboard.press('Escape')
      assert.equal((await page.$$('dialog[open]')).length, 1, 'busy dialog cannot be dismissed')
      await page.waitForFunction(() => !document.querySelector('dialog[open]'))
      assert.equal(await page.$eval('.ob-delivery-state', node => node.textContent.includes('Nuvarande läge: Upplåst')), true)
      assert.equal((await page.$$('.ob-delivery-state button')).length, 0)
      assert.deepEqual(await page.evaluate(() => window.__obFormTest.writes), [{
        table: 'inspection_lock_events', operation: 'unlock', values: { reason: 'Komplettera uppgift om garaget' },
      }])
      assert.equal(await page.$eval('.ob-delivery-workspace a[href*="/pdf"]', node => node.getAttribute('href')), '/api/report-v2/10000000-0000-4000-8000-000000000001/pdf')
    }
    assert.deepEqual(errors, [])
    console.log('Delivery unlock: 320/390/1280, reason, cancel, denial, retained text, duplicate prevention, parent lock state, unchanged PDF link passed; synthetic writes only.')
  } finally { await browser.close() }
}
