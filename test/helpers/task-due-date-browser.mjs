import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testTaskDueDate(base, output) {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  const fill = async (selector, value) => page.$eval(selector, (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  const start = async () => { await page.waitForSelector('[aria-label="Ändra slutdatum"]'); await page.click('[aria-label="Ändra slutdatum"]'); await page.waitForSelector('form[aria-label="Ändra uppgiftens slutdatum"]') }
  const save = async () => { await page.click('[aria-label="Spara slutdatum"]'); await page.waitForSelector('[aria-label="Ändra slutdatum"]') }
  try {
    await page.setViewport({ width: 1440, height: 1000 }); await page.goto(base, { waitUntil: 'networkidle0' })
    assert.equal(await page.evaluate(() => window.fixture.calls.length), 0)
    await start(); await page.click('form[aria-label="Ändra uppgiftens slutdatum"] input[type=checkbox]')
    await fill('input[aria-label="Nytt slutdatum"]', '2030-01-10'); await fill('form input[type=time]', '16:00'); await save()
    assert.equal(await page.evaluate(() => window.fixture.data().dueAt), '2030-01-10T15:00:00.000Z')
    assert.ok(await page.evaluate(() => document.body.textContent.includes('Avstängd')))
    await page.reload({ waitUntil: 'networkidle0' }); await start()
    assert.equal(await page.$eval('input[aria-label="Nytt slutdatum"]', input => input.value), '2030-01-10')
    await fill('input[aria-label="Nytt slutdatum"]', '2030-01-09'); await save()
    await start(); await fill('input[aria-label="Nytt slutdatum"]', '2030-01-20'); await page.evaluate(() => window.fixture.fail())
    await page.click('[aria-label="Spara slutdatum"]'); await page.waitForFunction(() => document.body.textContent.includes('Fiktivt sparfel'))
    assert.equal(await page.$eval('input[aria-label="Nytt slutdatum"]', input => input.value), '2030-01-20')
    await save()
    await start(); await fill('input[aria-label="Nytt slutdatum"]', '2030-01-21'); await page.evaluate(() => window.fixture.conflict())
    await page.click('[aria-label="Spara slutdatum"]'); await page.waitForFunction(() => document.body.textContent.includes('annan flik'))
    assert.equal(await page.$eval('input[aria-label="Nytt slutdatum"]', input => input.value), '2030-01-21')
    await page.click('form button:has(svg.lucide-refresh-cw)'); await page.waitForSelector('[aria-label="Ändra slutdatum"]')
    await start(); await fill('input[aria-label="Nytt slutdatum"]', '2030-01-22')
    for (const width of [1440, 390, 344]) {
      await page.setViewport({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No overflow at ${width}`)
      assert.ok(await page.$eval('[aria-label="Nytt slutdatum"]', input => input.getBoundingClientRect().right <= innerWidth + 1), `Date fits at ${width}`)
      await page.screenshot({ path: resolve(output, `due-date-${width}.png`), fullPage: true })
    }
    page.once('dialog', dialog => dialog.dismiss())
    await page.click('header button[aria-label="Stäng"]'); assert.equal(await page.$eval('input[aria-label="Nytt slutdatum"]', input => input.value), '2030-01-22')
    page.once('dialog', dialog => dialog.accept())
    await page.click('header button[aria-label="Stäng"]'); await page.waitForFunction(() => !document.querySelector('[aria-label="Ändra slutdatum"]'))
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Öppna uppgiften').click())
    await start(); await page.click('form[aria-label="Ändra uppgiftens slutdatum"] input[type=checkbox]'); await save()
    assert.equal(await page.evaluate(() => window.fixture.data().dueAt), null)
    await page.reload({ waitUntil: 'networkidle0' })
    assert.equal(await page.evaluate(() => window.fixture.data().dueAt), null)
    assert.deepEqual(errors, [])
    console.log('UI passed: add, earlier, later, clear, reload, retry, conflict, discard guard, desktop and 2 mobile widths. Fictitious tasks only.')
  } finally { await browser.close() }
}
