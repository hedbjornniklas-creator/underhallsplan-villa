import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testHomeGuide(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => request.url().startsWith(base) || request.url().startsWith('data:') ? request.continue() : request.abort())
  async function ready() {
    await page.waitForSelector('.obo-table tbody tr')
    await page.waitForFunction(() => document.querySelector('.obo-guide-content')?.textContent.includes('Namn, e-post och företagsnamn finns sparade.'))
    await page.evaluate(() => document.fonts.ready)
  }
  async function layout(label) {
    const result = await page.evaluate(() => {
      const title = document.querySelector('.obo-home-heading h1')
      const trigger = document.querySelector('.obo-guide-trigger')
      const a = title.getBoundingClientRect(), b = trigger.getBoundingClientRect()
      return { overflow: document.documentElement.scrollWidth > innerWidth,
        overlap: a.right > b.left, titleOverflow: title.scrollWidth > title.clientWidth + 1,
        target: b.height >= 48 && b.width >= 48,
        connected: document.getElementById(trigger.getAttribute('aria-controls'))?.classList.contains('obo-guide-content'),
      }
    })
    assert.deepEqual(result, { overflow: false, overlap: false, titleOverflow: false, target: true, connected: true }, label)
  }
  try {
    for (const width of [320, 390, 768, 1280, 1920]) {
      await page.setViewport({ width, height: 900 })
      await page.goto(`${base}/ob`, { waitUntil: 'networkidle0' })
      await ready()
      assert.equal(await page.$eval('.obo-guide-content', e => e.hidden), true)
      await layout(`closed ${width}`)
      await page.screenshot({ path: resolve(output, `guide-closed-${width}.png`) })
      await page.focus('.obo-guide-trigger')
      await page.keyboard.press('Enter')
      assert.equal(await page.$eval('.obo-guide-trigger', e => e.getAttribute('aria-expanded')), 'true')
      assert.equal(await page.$eval('.obo-guide-content', e => e.checkVisibility()), true)
      await layout(`open ${width}`)
      await page.screenshot({ path: resolve(output, `guide-open-${width}.png`), fullPage: true })
      await page.evaluate(() => document.documentElement.setAttribute('data-large-text', ''))
      await layout(`200% ${width}`)
      await page.keyboard.press('Enter')
      assert.equal(await page.$eval('.obo-guide-content', e => e.hidden), true)
    }
    await page.goto(`${base}/ob?missing-profile`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.querySelector('.obo-guide-trigger')?.getAttribute('aria-expanded') === 'true')
    await page.click('.obo-guide-trigger')
    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.querySelector('.obo-guide-content')?.textContent.includes('Lägg till'))
    assert.equal(await page.$eval('.obo-guide-content', e => e.hidden), true, 'Saved closed preference survives a missing profile')
    assert.deepEqual(await page.evaluate(() => window.__obHomeTest.writes), [])
    assert.deepEqual(await page.evaluate(() => window.__obHomeTest.requests), [])
    assert.deepEqual(errors, [])
    console.log('Home guide: five widths, keyboard, 200% text, compact closed header, open panel, profile guidance and remembered preference passed; no writes or emails.')
  } finally { await browser.close() }
}
