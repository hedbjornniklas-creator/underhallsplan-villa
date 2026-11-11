import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testTuCustomers(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const click = async text => {
    const buttons = await page.$$('button')
    for (const button of buttons) if ((await button.evaluate(el => el.textContent)).trim() === text) { await button.click(); return }
    throw Error('Missing button ' + text)
  }
  const field = async label => {
    const handle = await page.evaluateHandle(label => [...document.querySelectorAll('label')].find(el => {
      const copy = el.cloneNode(true); copy.querySelectorAll('input,select,textarea').forEach(node => node.remove())
      return copy.textContent.trim() === label
    })?.querySelector('input,select,textarea'), label)
    assert.ok(handle.asElement(), 'Missing field ' + label)
    return handle.asElement()
  }
  const select = async (label, value) => { const el = await field(label); await el.select(value); await el.dispose() }
  const fill = async (label, value) => { const el = await field(label); await el.click({ clickCount: 3 }); await el.type(value); await el.dispose() }
  const value = async label => { const el = await field(label); const result = await el.evaluate(node => node.value); await el.dispose(); return result }
  const overflow = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'page overflow')
    assert.deepEqual(await page.$$eval('button,input,select', els => els.filter(el => el.offsetWidth > 0 && el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 2).map(el => el.textContent)), [], 'button overflow')
  }
  try {
    for (const width of [390, 1440]) {
      await page.setViewport({ width, height: 950 })
      for (const kind of ['consumer', 'business', 'association']) {
        await page.goto(`${base}/tu?screen=accept&kind=${kind}&object=${kind === 'consumer' ? 'apartment' : 'villa'}`, { waitUntil: 'networkidle0' })
        await page.waitForSelector('select[aria-label="Beställartyp"]')
        assert.equal(await value('Beställartyp'), kind)
        assert.equal(await page.$eval('select[aria-label="Beställartyp"]', el => el.disabled), true)
        assert.match(await page.evaluate(() => document.body.innerText), /Totalt inkl\. moms/)
        if (kind === 'consumer') assert.match(await page.evaluate(() => document.body.innerText), /14 dagars ångerrätt/)
        else assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /14 dagars ångerrätt/)
        await fill('Fakturareferens', 'Projekt 42')
        await fill('Faktura-e-post (om annan)', 'faktura@example.test')
        await overflow()
        await page.screenshot({ path: resolve(output, `accept-${kind}-${width}.png`), fullPage: true })
        const checks = await page.$$('input[type=checkbox]')
        for (const checkbox of checks) if (!(await checkbox.evaluate(el => el.disabled))) await checkbox.click()
        await click('Godkänn uppdrag')
        await page.waitForFunction(() => window.__tuCustomerPreview.requests.length > 0)
        const body = await page.evaluate(() => window.__tuCustomerPreview.requests[0].body)
        assert.equal(body.tuCustomer.kind, kind)
        assert.equal(body.tuCustomer.invoiceReference, 'Projekt 42')
        assert.equal(body.invoiceEmail, 'faktura@example.test')
        assert.equal(body.representativeConfirmed, kind !== 'consumer')
      }
      await page.goto(`${base}/tu?screen=customer&kind=association`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('select[aria-label="Beställartyp"]')
      assert.equal(await page.$eval('button', el => el.disabled), true, 'unchanged customer is clean regardless of JSON key order')
      await fill('Kontaktperson', 'Ny kontakt')
      assert.equal(await page.evaluate(() => window.dispatchEvent(new Event('hushub:before-organization-switch', { cancelable: true }))), false, 'unsaved customer prevents leaving')
      await click('Spara beställaruppgifter')
      await page.waitForFunction(() => document.querySelector('button').disabled)
      assert.equal(await page.evaluate(() => window.dispatchEvent(new Event('hushub:before-organization-switch', { cancelable: true }))), true, 'saved customer allows leaving')
      assert.equal(await value('Kontaktperson'), 'Ny kontakt')
      await page.screenshot({ path: resolve(output, `customer-${width}.png`), fullPage: true })

      await page.goto(`${base}/tu?screen=edit&kind=association`, { waitUntil: 'networkidle0' })
      await click('Redigera uppgifter')
      await page.waitForSelector('dialog[open]')
      await select('Prisangivelse', 'exclusive')
      await fill('Pris exkl. moms, SEK', '5000')
      await fill('Fakturareferens', 'Ny referens')
      await overflow()
      await page.screenshot({ path: resolve(output, `edit-${width}.png`), fullPage: true })
      await click('Spara uppgifter')
      await page.waitForSelector('dialog[open]', { hidden: true })
      const edited = await page.evaluate(() => window.__tuCustomerPreview.requests[0].body)
      assert.equal(edited.tuPricing.gross, 6250)
      assert.equal(edited.tuCustomer.invoiceReference, 'Ny referens')

      await page.goto(`${base}/tu?kind=association`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('dialog[open]')
      assert.equal(await value('Beställartyp'), 'association')
      const mode = await page.$$eval('dialog[open] button', buttons => buttons.map(el => el.textContent.trim()).find(text => /uppdragsbekräftelse/i.test(text)))
      assert.ok(mode)
      await click(mode)
      assert.equal(await value('Prisangivelse'), 'inclusive')
      await select('Beställartyp', 'business')
      assert.equal(await value('Prisangivelse'), 'exclusive')
      await fill('Pris exkl. moms, SEK', '5000')
      await select('Beställartyp', 'association')
      assert.equal(await value('Pris exkl. moms, SEK'), '5000', 'changing category does not reinterpret an entered price')
      await overflow()
      await page.screenshot({ path: resolve(output, `create-${width}.png`), fullPage: true })
    }
    assert.deepEqual(errors, [])
    console.log('TU customer browser: public acceptance, editing, category defaults and overflow passed at 390/1440px')
  } finally { await browser.close() }
}
