import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function testImagePreview(page, base, output) {
  const viewer = 'dialog[aria-label="Bild"]'
  async function fresh(query = '') {
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.goto(base + '/' + query, { waitUntil: 'networkidle0' })
    await page.click('nav button:last-child')
    await page.waitForSelector('.obm-image-thumb img')
  }
  async function open() {
    await page.click('.obm-image-thumb img')
    await page.waitForSelector(`${viewer} .obm-image-viewer img`)
    await page.waitForFunction(() => document.querySelector('.obm-image-viewer img').naturalWidth > 0)
  }
  for (const [width, height] of [[320, 820], [390, 820], [1280, 820], [820, 390]]) {
    await page.setViewport({ width, height })
    await fresh()
    await page.$eval('.obm-image-thumb', node => node.scrollIntoView({ block: 'center' }))
    const original = await page.$eval('.obm-image-thumb img', node => node.src)
    const scroll = await page.evaluate(() => scrollY)
    await open()
    assert.equal(await page.$('dialog[aria-label="Koppla bild"]'), null)
    assert.equal(await page.$eval('.obm-image-viewer img', node => node.src), original)
    assert.equal(await page.$eval('body', node => getComputedStyle(node).overflowY), 'hidden')
    assert.ok(await page.$eval('.obm-image-viewer img', node => {
      const rect = node.getBoundingClientRect()
      return node.complete && rect.width > 200 && rect.height > 150 &&
        rect.top >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth &&
        getComputedStyle(node).objectFit === 'contain'
    }))
    assert.ok(await page.$$eval('.obm-sheet,.obm-sheet-body', rows => rows.every(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1)))
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0)
    await page.screenshot({ path: resolve(output, `image-preview-${width}x${height}.png`) })
    await page.click(`${viewer} [aria-label="Tillbaka"]`)
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    assert.ok(Math.abs(await page.evaluate(() => scrollY) - scroll) < 2)
    // Keyboard activation enlarges too; opening the link screen does not save anything.
    await page.focus('.obm-image-thumb')
    await page.keyboard.press('Enter')
    await page.waitForSelector(viewer)
    await page.click(`${viewer} footer button`)
    await page.waitForSelector('dialog[aria-label="Koppla bild"]')
    assert.equal(await page.$(viewer), null)
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0)
    await page.click('dialog [aria-label="Tillbaka"]')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    await page.click('.obm-image-link')
    await page.waitForSelector('dialog[aria-label="Koppla bild"]')
    await page.click('dialog [aria-label="Tillbaka"]')
    await open()
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  }
  for (const query of ['?locked', '?queued']) {
    await fresh(query)
    await open()
    assert.equal(await page.$eval(`${viewer} footer button`, node => node.disabled), true)
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0)
    await page.click(`${viewer} [aria-label="Tillbaka"]`)
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  }
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  console.log('PASS: image enlargement, fit/scroll on phone/desktop/landscape, keyboard/back/Escape, link navigation and locked/queued images without data writes.')
}
