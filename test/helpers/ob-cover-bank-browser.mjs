import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function testCoverBank(page, base, output) {
  async function openBuilding(query = '') {
    await page.goto(base + '/buildings' + query)
    await page.locator('button').filter(button => button.textContent.includes('Lägg till byggnad')).click()
    await page.waitForSelector('dialog[open]')
    await page.type('dialog input[maxlength="100"]', 'Garage')
    await page.select('dialog select', 'garage')
    await page.click('dialog footer button')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    await page.locator('nav button:nth-child(2)').click()
  }
  for (const width of [320, 390, 1280]) {
    await page.setViewport({ width, height: 844 })
    await openBuilding()
    await page.click('section[aria-label="Byggnadsbild"] button:nth-child(3)')
    await page.waitForSelector('dialog input[type="radio"]')
    assert.equal(await page.$eval('dialog footer button', el => el.disabled), true)
    await page.click('dialog input[type="radio"]')
    await page.waitForFunction(() => [...document.querySelectorAll('dialog img')].every(img => img.complete && img.naturalWidth > 0))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: resolve(output, `cover-bank-${width}.png`), fullPage: true })
    await page.click('dialog footer button')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    await page.waitForSelector('section[aria-label="Byggnadsbild"] img')
  }
  for (const [query, text] of [['empty-bank', 'Inga bilder'], ['failed-bank', 'Bildbanken kunde inte hämtas']]) {
    await openBuilding('?' + query)
    await page.click('section[aria-label="Byggnadsbild"] button:nth-child(3)')
    await page.waitForFunction(text => document.querySelector('dialog')?.textContent.includes(text), {}, text)
    assert.equal(await page.$eval('dialog footer button', el => el.disabled), true)
    await page.click('dialog button[aria-label="Tillbaka"]')
    assert.equal(await page.$('section[aria-label="Byggnadsbild"] img'), null)
  }
  await openBuilding('?locked')
  assert.equal(await page.$$eval('section[aria-label="Byggnadsbild"] button', buttons => buttons.every(button => button.disabled)), true)
  console.log('PASS: scoped cover bank, selection, independent cover upload, cancel, empty/error/locked states and responsive layouts.')
}
