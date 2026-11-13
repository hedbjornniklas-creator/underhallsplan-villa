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
      const copy = el.cloneNode(true); copy.querySelectorAll('input,select,textarea,[aria-hidden="true"]').forEach(node => node.remove())
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
        const termsHeading = { consumer: 'privatperson', business: 'företag', association: 'förening' }[kind]
        assert.match(await page.$eval('h2', el => el.textContent), new RegExp(`Villkor för teknisk utredning - ${termsHeading}`, 'i'))
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

      await page.goto(`${base}/tu?screen=edit&kind=association&status=sent`, { waitUntil: 'networkidle0' })
      await click('Redigera uppgifter')
      await page.waitForSelector('dialog[open]')
      for (const label of ['Beställartyp', 'Organisationsnummer', 'E-post']) {
        const el = await field(label); assert.equal(await el.evaluate(node => node.disabled), true, label + ' locked after sending'); await el.dispose()
      }
      await fill('Objektadress', 'Grev Magnigatan 3')
      await fill('Utredningens omfattning', 'Utökad omfattning')
      await fill('Kontaktperson', 'Ny kontaktperson')
      await fill('Pris inkl. moms, SEK', '7500')
      await overflow()
      await page.$eval('dialog', el => { el.scrollTop = 0 })
      await page.screenshot({ path: resolve(output, `edit-sent-${width}.png`), fullPage: true })
      await click('Spara uppgifter')
      await page.waitForSelector('dialog[open]', { hidden: true })
      assert.equal(await page.evaluate(() => window.__tuCustomerPreview.requests.length), 1, 'save must not send an email')
      await page.waitForFunction(() => window.dispatchEvent(new Event('hushub:before-organization-switch', { cancelable: true })))
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Redigera uppgifter')
        const rect = button.getBoundingClientRect()
        return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      })
      await click('Redigera uppgifter')
      await page.waitForSelector('dialog[open]')
      assert.equal(await value('Objektadress'), 'Grev Magnigatan 3')
      assert.equal(await value('Kontaktperson'), 'Ny kontaktperson')
      assert.equal(await value('Pris inkl. moms, SEK'), '7500')
      await click('Avbryt')
      await page.goto(`${base}/tu?screen=edit&status=approved`, { waitUntil: 'networkidle0' })
      assert.equal(await page.$('button'), null, 'approved confirmation cannot be edited')

      await page.goto(`${base}/tu?screen=accept&kind=association&stale=1`, { waitUntil: 'networkidle0' })
      for (const checkbox of await page.$$('input[type=checkbox]')) if (!(await checkbox.evaluate(el => el.disabled))) await checkbox.click()
      await click('Godkänn uppdrag')
      await page.waitForFunction(() => document.body.innerText.includes('Hämta aktuella uppgifter'))
      assert.equal(await page.$$eval('button', els => els.find(el => el.textContent.trim() === 'Godkänn uppdrag').disabled), true)
      await overflow()
      await page.screenshot({ path: resolve(output, `stale-accept-${width}.png`), fullPage: true })
      await click('Hämta aktuella uppgifter')
      await page.waitForFunction(() => !document.body.innerText.includes('Hämta aktuella uppgifter'))
      assert.equal(await value('Utredningens omfattning'), 'Ny omfattning efter redigering')
      assert.equal(await page.$$eval('input[type=checkbox]', els => els.some(el => el.checked)), false, 'changed content requires fresh consent')
      for (const checkbox of await page.$$('input[type=checkbox]')) if (!(await checkbox.evaluate(el => el.disabled))) await checkbox.click()
      await click('Godkänn uppdrag')
      await page.waitForFunction(() => window.__tuCustomerPreview.requests.length === 2)
      const accepted = await page.evaluate(() => window.__tuCustomerPreview.requests[1].body)
      assert.equal(accepted.tuEditRevision, 1)
      assert.equal(accepted.scopeDescription, 'Ny omfattning efter redigering')
      assert.equal(accepted.propertyAddress, 'Rattad gata 3')

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
      for (const kind of ['consumer', 'business', 'association']) {
        await select('Beställartyp', kind)
        const name = await field(kind === 'consumer' ? 'Beställarens namn' : 'Företagets eller föreningens namn')
        assert.equal(await name.evaluate(el => el.required), true, 'customer name is required')
        assert.equal(await name.evaluate(el => el.getAttribute('aria-required')), 'true')
        assert.equal(await name.evaluate(el => el.closest('label').querySelector('[aria-hidden="true"]')?.textContent), '*', 'customer name has a visible required marker')
        await name.dispose()
      }
      await overflow()
      await page.screenshot({ path: resolve(output, `create-${width}.png`), fullPage: true })

      for (const screen of width === 1440 ? ['digital', 'print'] : ['digital']) {
        await page.goto(`${base}/tu?screen=${screen}&kind=association`, { waitUntil: 'networkidle0' })
        if (screen === 'print') await page.waitForSelector('[data-tu-print-pagination-ready="1"]')
        else await page.waitForSelector('dl')
        const text = await page.evaluate(() => document.body.innerText)
        for (const expected of ['Exempelforeningen', 'Förening', 'Org.nr', '769600-0000', 'Kontaktperson', 'Anna Exempel', 'Kontaktpersonens roll', 'Erik Besiktningsman', 'Besiktningsmannens egen text.']) {
          assert.ok(text.toLocaleLowerCase('sv-SE').includes(expected.toLocaleLowerCase('sv-SE')), `${screen} missing ${expected}`)
        }
        await overflow()
        assert.deepEqual(await page.$$eval('dl dt,dl dd', elements => elements.filter(el => el.clientWidth && el.scrollWidth > el.clientWidth + 2).map(el => el.textContent)), [], 'party row overflow')
        await page.screenshot({ path: resolve(output, `${screen}-${width}.png`), fullPage: true })
      }
    }
    assert.deepEqual(errors, [])
    console.log('TU customer browser: public acceptance, editing, category defaults, report details and overflow passed at 390/1440px')
  } catch (error) {
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true })
    throw error
  } finally { await browser.close() }
}
