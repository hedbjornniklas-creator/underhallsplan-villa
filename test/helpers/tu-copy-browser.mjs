import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testTuCopy(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  const field = (label) => page.evaluate(label => {
    const el = [...document.querySelectorAll('dialog[open] label')].find(el => el.querySelector('span')?.textContent.replace('*', '').trim() === label)
    return el?.querySelector('input,textarea,select')?.value
  }, label)
  const clickText = async text => {
    const buttons = await page.$$('dialog[open] button')
    for (const button of buttons) {
      if ((await button.evaluate(el => el.textContent)).trim() === text) { await button.click(); return }
    }
    throw Error(`Button not found: ${text}`)
  }
  const check = async text => {
    const checkbox = await page.evaluateHandle(text => [...document.querySelectorAll('dialog[open] label')].find(el => el.textContent.includes(text))?.querySelector('input[type=checkbox]'), text)
    await checkbox.asElement().click()
    await checkbox.dispose()
  }
  try {
    for (const width of [390, 1440]) {
      await page.setViewport({ width, height: 900 })
      await page.goto(`${base}/tu?state=copy`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('dialog[open]')
      assert.equal(await page.evaluate(() => window.__tuOverviewTest.writes), 0)
      assert.equal(await field('Namn'), 'Anna Exempel')
      assert.equal(await field('Objektadress'), 'Testvägen 12')
      assert.equal(await field('Datum'), '')
      assert.equal(await field('Tid'), '')
      assert.equal(await field('Utredningens omfattning'), '')
      assert.equal(await field('Fakturanamn'), 'Anna Exempel')
      assert.equal(await field('Fakturaadress'), 'Kundgatan 1, Teststad')
      assert.equal(await page.$eval('dialog[open]', el => el.scrollWidth > el.clientWidth + 1), false, `${width}: modal overflow`)
      assert.deepEqual(await page.$$eval('dialog[open] button', els => els.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent)), [])
      await page.screenshot({ path: resolve(output, `tu-copy-${width}.png`) })
      await check('Återanvänd uppdragets omfattning')
      assert.equal(await field('Utredningens omfattning'), 'Utred fukt i källaren.')
      await check('Återanvänd uppdragets omfattning')
      assert.equal(await field('Utredningens omfattning'), '')
      // Native modal traps keyboard focus and supports Escape.
      await page.keyboard.press('Escape')
      await page.waitForSelector('dialog[open]', { hidden: true })
      assert.equal(await page.evaluate(() => window.__tuOverviewTest.writes), 0)
      await page.click('.obh-actions > button:first-child')
      await page.waitForSelector('dialog[open]')
      assert.equal(await field('Namn'), '', 'Cancelling reuse does not seed an unrelated new investigation')
    }
    await page.goto(`${base}/tu?state=copy`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('dialog[open]')
    const modeLabels = await page.$$eval('dialog[open] button', buttons => buttons.map(b => b.textContent.trim()))
    const confirmation = modeLabels.find(label => /uppdragsbekräftelse/i.test(label))
    assert.ok(confirmation)
    await clickText(confirmation)
    await page.waitForSelector('dialog[open] select option[value="33333333-3333-4333-8333-333333333333"]')
    assert.equal(await field('Befintlig kund'), '33333333-3333-4333-8333-333333333333')
    assert.equal(await field('Pris inkl. moms, SEK'), '')
    await check('Återanvänd pris')
    assert.equal(await field('Pris inkl. moms, SEK'), '5900')
    assert.equal(await page.$eval('dialog[open]', el => [...el.querySelectorAll('button')].some(b => b.textContent.trim() === 'Skicka uppdragsbekräftelse')), false)
    await clickText('Spara utkast')
    await page.waitForFunction(() => window.__tuOverviewTest.submissions.length === 1)
    const confirmationRequest = await page.evaluate(() => window.__tuOverviewTest.submissions[0])
    assert.equal(confirmationRequest.url, '/api/tu/assignments')
    assert.equal(confirmationRequest.body.customerBinding.mode, 'existing')
    assert.equal(confirmationRequest.body.priceAmount, '5900')
    assert.equal(confirmationRequest.body.preferredDate, '')
    assert.equal(confirmationRequest.body.invoiceName, 'Anna Exempel')

    await page.goto(`${base}/tu?state=copy`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('dialog[open]')
    const nameInput = await page.evaluateHandle(() => [...document.querySelectorAll('dialog[open] label')].find(el => el.querySelector('span')?.textContent.trim() === 'Namn')?.querySelector('input'))
    await nameInput.asElement().type(' ändrat')
    await nameInput.dispose()
    await clickText(confirmation)
    await page.waitForSelector('dialog[open] select option[value="33333333-3333-4333-8333-333333333333"]')
    assert.equal(await field('Befintlig kund'), '', 'Edited customer data needs an explicit registry choice')
    assert.equal(await field('Namn'), 'Anna Exempel ändrat')

    await page.goto(`${base}/tu?state=copy`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('dialog[open]')
    await page.evaluate(() => { window.__tuOverviewTest.failSave = true })
    await clickText('Skapa utredning')
    await page.waitForSelector('dialog[open] [role="alert"]')
    assert.equal(await field('Namn'), 'Anna Exempel', 'A failed save preserves input')
    await page.evaluate(() => { window.__tuOverviewTest.failSave = false })
    await clickText('Skapa utredning')
    await page.waitForSelector('dialog[open]', { hidden: true })
    const request = await page.evaluate(() => window.__tuOverviewTest.submissions.at(-1))
    assert.equal(request.url, '/api/tu/investigations')
    assert.equal(request.body.date, '')
    assert.equal(request.body.time, '')
    assert.equal(request.body.scopeDescription, '')
    assert.equal(request.body.customerDetails.invoiceName, 'Anna Exempel')
    for (const key of ['assignmentId', 'propertyId', 'reportDraft', 'accepted_at', 'report_locked_at']) assert.equal(key in request.body, false)

    await page.goto(`${base}/tu?state=inactive-template`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('dialog[open]')
    assert.equal(await field('Mall för utlåtandet'), '')
    assert.equal(await page.$eval('dialog[open]', el => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === 'Skapa utredning')?.disabled), true)
    assert.deepEqual(errors, [])
    console.log('TU copy: mobile/desktop, empty dates, optional scope/price, customer link, draft-only confirmation, fresh report payload, retry, inactive template and Escape passed.')
  } finally { await browser.close() }
}
