import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function testImageImport(page, base, output) {
  const files = [resolve('public/landing/Hushub_favicon.png'), resolve('public/landing/Hushub-check.png')]
  const picker = 'input[aria-label="V\u00e4lj bilder att bearbeta"]'
  async function pending() {
    const button = await page.$('nav button:last-child')
    await button.click()
    await page.waitForSelector(picker)
  }
  async function choose() {
    const choosing = page.waitForFileChooser()
    await page.click('.obm-import-images button')
    return choosing
  }
  for (const width of [320, 390, 1280]) {
    await page.setViewport({ width, height: 820 })
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.reload({ waitUntil: 'networkidle0' })
    await pending()
    assert.equal(await page.$eval(picker, node => node.multiple && !node.hasAttribute('capture')), true)
    const countBefore = await page.evaluate(async () => (await window.__obMobileTest.imageQueue()).length)
    const cancelled = await choose()
    assert.equal(cancelled.isMultiple(), true)
    await cancelled.cancel()
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.filter(call => call.kind === 'import').length), 0)
    await page.evaluate(() => { window.__obMobileTest.delayMs = 120 })
    const chooser = await choose()
    await chooser.accept(files)
    await page.waitForFunction(() => document.querySelector('.obm-import-images button').disabled)
    await page.waitForFunction(() => !document.querySelector('.obm-import-images button').disabled)
    assert.equal(await page.evaluate(() => window.__obMobileTest.images.filter(image => image.local_queue_id).length), 2)
    assert.ok(await page.evaluate(async previous => {
      const rows = await window.__obMobileTest.imageQueue()
      return rows.length === previous + 2 && rows.every(row => row.sourceArea === null &&
        Object.values(row.origin).every(value => value === null) && row.link.control_item_id === null && row.blob.size > 0)
    }, countBefore))
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: resolve(output, `image-import-${width}.png`) })
    // Resetting the input allows a deliberate selection of the same files again.
    const second = await choose()
    await second.accept(files)
    await page.waitForFunction(() => window.__obMobileTest.images.filter(image => image.local_queue_id).length === 4)
    await page.waitForFunction(() => !document.querySelector('.obm-import-images button').disabled)
    await page.evaluate(() => { window.__obMobileTest.failSaves = true })
    const failed = await choose()
    await failed.accept(files)
    await page.waitForFunction(() => !document.querySelector('.obm-import-images button').disabled && document.querySelector('[role="alert"]')?.textContent.includes('0 av 2'))
    assert.equal(await page.evaluate(() => window.__obMobileTest.images.filter(image => image.local_queue_id).length), 4)
  }
  for (const query of ['locked', 'paused']) {
    await page.goto(`${base}/?${query}`, { waitUntil: 'networkidle0' })
    if (query === 'locked') await pending()
    // The paused inspection restores the pending view, with its enclosing fieldset disabled.
    assert.equal(await page.$eval('.obm-import-images button', button => button.matches(':disabled')), true)
  }
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
}
