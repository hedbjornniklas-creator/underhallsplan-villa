import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testStatusAssignmentObjectType(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = [], external = [], writes = [], approvals = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (request.url().startsWith('data:') || request.url().startsWith('blob:') || new URL(request.url()).origin === base) {
      if (request.method() === 'PATCH') writes.push(JSON.parse(request.postData()))
      if (request.method() === 'POST' && request.url().includes('/accept/')) approvals.push(JSON.parse(request.postData()))
      void request.continue()
    } else { external.push(request.url()); void request.abort() }
  })
  const labels = () => page.$$eval('label', nodes => nodes.map(node => node.textContent.trim()))
  async function fill(label, value) {
    const handle = await page.evaluateHandle(text => {
      const label = [...document.querySelectorAll('label')].find(node => node.textContent.trim() === text)
      return label?.control ?? label?.querySelector('input')
    }, label)
    const input = handle.asElement()
    assert.ok(input, `field ${label}`)
    await input.click({ clickCount: 3 })
    await input.type(value)
    await handle.dispose()
  }
  async function saved() {
    await page.waitForFunction(() => document.querySelector('.ob-assignment-save-status')?.textContent === 'Sparat')
  }
  try {
    await page.setViewport({ width: 1280, height: 950 })
    await page.goto(`${base}/details?form=draft&object=property`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('input[name="status-object-type"]')
    assert.equal(await page.$eval('input[name="status-object-type"][value="property"]', node => node.checked), true)
    await page.click('input[name="status-object-type"][value="apartment"]')
    await page.waitForFunction(() => [...document.querySelectorAll('label')].some(node => node.textContent.trim() === 'Lägenhetsnummer'))
    assert.equal((await labels()).includes('Fastighetsägare'), false)
    assert.equal((await labels()).includes('Fastighetsbeteckning'), false)
    await fill('Lägenhetsnummer', '1202')
    await saved()
    assert.equal(writes.at(-1).objectType, 'apartment')
    assert.equal(writes.at(-1).assignment_type, 'STATUS')
    assert.equal(writes.at(-1).orderer_role, 'Statusbesiktning')
    assert.equal(writes.at(-1).apartment_number, '1202')
    assert.equal(writes.at(-1).statusCancellationFee, 0)
    await page.reload({ waitUntil: 'networkidle0' })
    assert.equal(await page.$eval('input[name="status-object-type"][value="apartment"]', node => node.checked), true)
    const apartmentValue = await page.evaluate(() => document.getElementById([...document.querySelectorAll('label')].find(node => node.textContent.trim() === 'Lägenhetsnummer').htmlFor).value)
    assert.equal(apartmentValue, '1202')
    await page.screenshot({ path: resolve(output, 'status-assignment-apartment-desktop.png'), fullPage: true })
    await page.goto(`${base}/details?form=draft&object=legacy`, { waitUntil: 'networkidle0' })
    assert.equal(await page.$eval('input[name="status-object-type"][value="property"]', node => node.checked), true, 'legacy draft preserves property')

    for (const width of [390, 1280]) {
      await page.setViewport({ width, height: 950, isMobile: width < 768, hasTouch: width < 768 })
      await page.goto(`${base}/status-object-apartment`, { waitUntil: 'networkidle0' })
      await page.waitForFunction(() => [...document.querySelectorAll('label')].some(node => node.textContent.trim() === 'Lägenhetsnummer *'))
      const shown = await labels()
      assert.equal(shown.includes('Fastighetsägare *'), false)
      assert.equal(shown.includes('Fastighetsbeteckning *'), false)
      assert.equal(shown.includes('Bostadsrättsförening (om tillämpligt)'), true)
      assert.equal(shown.includes('Lägenhetsinnehavare (frivilligt)'), true)
      assert.equal(await page.$('input[name="status-object-type"]'), null, 'customer cannot change frozen object choice')
      await page.click('input[type="checkbox"]')
      const submit = () => page.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent.includes('Godkänn')).click())
      const before = approvals.length
      await submit()
      assert.equal(approvals.length, before, 'missing apartment number blocks submission')
      await fill('Lägenhetsnummer *', '1401')
      await page.screenshot({ path: resolve(output, `status-accept-apartment-${width}.png`), fullPage: true })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await submit()
      await page.waitForFunction(() => document.body.textContent.includes('godkänt') || document.body.textContent.includes('godkänd'))
      assert.equal(approvals.length, before + 1)
      assert.equal(approvals.at(-1).apartmentNumber, '1401')
      assert.equal(approvals.at(-1).brfName, '')
      assert.equal(approvals.at(-1).apartmentHolderName, '')
      assert.equal(approvals.at(-1).cadastralId, '')
      assert.equal(approvals.at(-1).propertyOwnerName, '')
    }
    for (const mode of ['property', 'legacy']) {
      await page.goto(`${base}/status-object-${mode}`, { waitUntil: 'networkidle0' })
      await page.waitForFunction(() => [...document.querySelectorAll('label')].some(node => node.textContent.trim() === 'Fastighetsbeteckning *'))
      assert.equal((await labels()).includes('Lägenhetsnummer *'), false, 'frozen property ignores stale apartment fields')
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    console.log('PASS: STB object choice persists with apartment number, legacy draft remains property, public apartment acceptance requires number only, frozen property ignores stale apartment fields; 390/1280 px, synthetic data only.')
  } catch (error) {
    await page.screenshot({ path: resolve(output, 'status-assignment-object-failure.png'), fullPage: true })
    throw error
  } finally { await browser.close() }
}
