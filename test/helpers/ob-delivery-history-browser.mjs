import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testDeliveryHistory(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setRequestInterception(true)
    page.on('request', request => request.url().startsWith(base) || /^(data|blob):/.test(request.url()) ? request.continue() : request.abort())
    await page.evaluateOnNewDocument(() => {
      window.__copiedReportLinks = []
      window.__denyCopy = false
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async value => { if (window.__denyCopy) throw Error('Synthetic denied clipboard'); window.__copiedReportLinks.push(value) },
      } })
    })
    for (const width of [320,390,1280]) {
      await page.setViewport({ width, height: 900 })
      await page.goto(`${base}/round?section=delivery&delivery-history&locked&completed`, { waitUntil: 'networkidle0' })
      const copy = 'button[title="Kopiera kundlänk till det publicerade utlåtandet"]'
      await page.waitForFunction(() => !document.querySelector('button[title^="Kopiera kundlänk"]')?.disabled)
      assert.ok((await page.$eval('.ob-delivery-overview',node=>node.textContent)).includes('2026-11-06 08:24'))
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      await page.click(copy)
      await page.waitForFunction(()=>document.querySelector('.ob-copy-feedback')?.textContent==='Länk kopierad')
      const copied=await page.evaluate(()=>window.__copiedReportLinks)
      assert.equal(copied.length,1); assert.ok(copied[0].includes('/rapport/')); assert.ok(!copied[0].includes('/ob/inspections'))
      assert.deepEqual(await page.evaluate(()=>window.__obFormTest.writes),[])
      await page.screenshot({path:resolve(output,`delivery-history-${width}.png`),fullPage:false})
      await page.evaluate(()=>{window.__denyCopy=true})
      await page.click(copy); await page.waitForSelector('input[aria-label="Kundlänk"]')
      assert.equal(await page.$eval('input[aria-label="Kundlänk"]',node=>node.value),copied[0])
      const older=await page.$$('button'); let found=false
      for(const button of older)if((await button.evaluate(node=>node.textContent)).includes('Visa äldre')){await button.click();found=true;break}
      assert.ok(found)
      await page.waitForFunction(()=>document.querySelector('.ob-delivery-timeline')?.textContent.includes('Syntetiskt leveransfel'))
      assert.ok(await page.$('a[href*="report=synthetic-older"][href*="archive=1"]'))
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      assert.deepEqual(await page.evaluate(()=>window.__obFormTest.writes),[])
      await page.screenshot({path:resolve(output,`delivery-history-expanded-${width}.png`),fullPage:true})
    }
    assert.deepEqual(errors,[])
    console.log('Delivery UI passed at 320/390/1280: preloaded public copy link, denied clipboard fallback, Swedish timestamps, older history, exact-version PDF, no overflow and zero production writes.')
  } finally { await browser.close() }
}
