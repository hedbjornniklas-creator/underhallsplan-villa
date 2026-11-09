import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
export async function testGizmoBranding(base, output) {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    for (const width of [1440, 390, 344]) {
      await page.setViewport({ width, height: 950 }); await page.goto(`${base}/uppdrag`, { waitUntil: 'networkidle0' }); await page.evaluate(() => document.fonts.ready)
      await page.waitForSelector('[aria-label="Välj modul"]')
      assert.equal(await page.$eval('.uppdrag-brand-name', el => el.textContent), 'Gizmo')
      assert.equal(await page.$eval('.uppdrag-brand-image', img => img.complete && img.naturalWidth > 0), true)
      assert.equal(await page.$eval('.gizmo-route-loading', el => el.textContent.includes('Öppnar Gizmo')), true)
      await page.click('[aria-label="Välj modul"]')
      const gizmo = await page.$eval('a[role=menuitem][href="/uppdrag"]', el => el.textContent)
      assert.match(gizmo, /Gizmo/); assert.match(gizmo, /GZ/); assert.doesNotMatch(gizmo, /Uppdrag/)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No overflow at ${width}`)
      assert.equal(await page.$eval('a[href="/mina-uppdrag"]', el => el.getAttribute('href')), '/mina-uppdrag')
      await page.screenshot({ path: resolve(output, `gizmo-${width}.png`), fullPage: true })
    }
    await page.setViewport({ width: 390, height: 950 }); await page.goto(`${base}/email.html`, { waitUntil: 'networkidle0' })
    assert.ok(await page.evaluate(() => document.body.textContent.includes('Gizmo') && document.body.textContent.includes('från HusHub')))
    assert.equal(await page.$eval('a', el => el.getAttribute('href')), 'https://hushub.se/signe/fictitious-token')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: resolve(output, 'gizmo-email-mobile.png'), fullPage: true })
    assert.deepEqual(errors, [])
    console.log('UI passed: real module selector, Gizmo wordmark, local image/font, original routes, loading and new email at desktop and mobile sizes. No project mutations or deliveries.')
  } catch (error) { console.error('Synthetic preview errors:', errors); throw error }
  finally { await browser.close() }
}
