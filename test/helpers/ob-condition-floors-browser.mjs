import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testConditionFloors(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = [], external = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (request.url().startsWith('data:') || request.url().startsWith('blob:') || new URL(request.url()).origin === base) void request.continue()
    else { external.push(request.url()); void request.abort() }
  })
  async function click(text, selector = 'button') {
    for (const element of await page.$$(selector)) {
      if (await element.evaluate((node, text) => node.textContent.trim().includes(text), text)) { await element.click(); return }
    }
    throw Error(`Missing ${selector}: ${text}`)
  }
  async function fill(selector, text) {
    await page.click(selector)
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control')
    await page.type(selector, text)
  }
  const snapshot = () => page.evaluate(() => window.__obFormTest.snapshot())
  const closed = () => page.waitForFunction(() => !document.querySelector('dialog[open]'))
  const saved = () => page.waitForFunction(() => ![...document.querySelectorAll('button')].some(node => /Spara plan|Sparar\.\.\./.test(node.textContent)))
  try {
    for (const width of [320, 390, 1280]) {
      for (const extra of [false, true]) {
        await page.setViewport({ width, height: 844 })
        await page.goto(`${base}/round?section=conditions${extra ? '&extra' : ''}`, { waitUntil: 'networkidle0' })
        const before = await snapshot()
        await click('Våningsplan', '.ob-form-list-row')
        await page.waitForSelector('dialog[aria-label="Våningsplan"]')
        assert.equal(await page.$eval('[aria-label="Ta bort plan 0"]', node => node.disabled), true)
        await page.keyboard.press('Escape'); await closed()
        assert.deepEqual(await snapshot(), before, 'Opening a floor panel must not mutate data')
        await click('Byggnadstyp', '.ob-form-list-row')
        const labels = await page.$$eval('dialog .ob-form-label', nodes => nodes.map(node => node.textContent.trim()))
        assert.ok(!labels.includes('Våningar'), 'Explicit model must not expose a second floor count')
        assert.ok(labels.includes('Källare') && labels.includes('Vind'), 'Descriptive building properties remain')
        assert.equal(await page.$('dialog section[aria-label="Plan"]'), null)
        await page.keyboard.press('Escape'); await closed()
        await click('Våningsplan', '.ob-form-list-row')
        await fill('[aria-label="Nytt plannummer"]', '-1')
        await page.click('[aria-label="Lägg till plan"]')
        await fill('[aria-label="Namn på plan -1"]', 'Suterräng')
        assert.equal(await page.$eval('dialog [aria-label="Tillbaka"]', node => node.disabled), true)
        assert.equal(await page.$$eval('dialog footer button', nodes => nodes.every(node => node.disabled)), true)
        await page.keyboard.press('Escape')
        assert.ok(await page.$('dialog[open]'), 'Unsaved floor edits cannot disappear on Escape')
        await page.screenshot({ path: resolve(output, `condition-floors-${extra ? 'extra' : 'main'}-${width}.png`) })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        assert.ok(await page.$eval('dialog section[aria-label="Plan"]', node => node.scrollWidth <= node.clientWidth + 1))
        await page.evaluate(() => { window.__obFormTest.failSaves = true })
        await click('Spara plan')
        await page.waitForSelector('dialog [role=alert]')
        assert.equal(await page.$eval('[aria-label="Namn på plan -1"]', node => node.value), 'Suterräng')
        assert.deepEqual(await snapshot(), before, 'Failed save must preserve database data')
        await page.evaluate(() => { window.__obFormTest.failSaves = false })
        await click('Spara plan'); await saved()
        const after = await snapshot()
        const index = extra ? 1 : 0
        assert.deepEqual(after.parts[1 - index], before.parts[1 - index], 'Other building stays unchanged')
        assert.deepEqual(after.db, before.db, 'No rooms, notes, images, conditions or legacy answers are changed')
        assert.deepEqual(after.parts[index].floor_model, { revision: 2, levels: [
          { level: 0, name: 'Entréplan' }, { level: 1, name: 'Övre plan' }, { level: -1, name: 'Suterräng' },
        ] })
        const writes = await page.evaluate(() => window.__obFormTest.writes)
        assert.ok(writes.every(row => row.operation === 'floors' && row.payload.partId === before.parts[index].id))
        await page.keyboard.press('Escape'); await closed()
        assert.ok((await page.$$eval('.ob-form-list-row', nodes => nodes.map(node => node.textContent)))
          .some(text => /Våningsplan.*Plan -1.*Suterräng.*Plan 0.*Plan 1/.test(text)))
        await click('Våningsplan', '.ob-form-list-row')
        assert.equal(await page.$eval('[aria-label="Namn på plan -1"]', node => node.value), 'Suterräng', 'Reopened editor reads saved model')
        await fill('[aria-label="Namn på plan 0"]', 'Ska inte sparas')
        await click('Avbryt')
        assert.equal(await page.$eval('[aria-label="Namn på plan 0"]', node => node.value), 'Entréplan')
        assert.deepEqual(await snapshot(), after)
        await page.waitForFunction(() => !document.querySelector('dialog [aria-label="Tillbaka"]').disabled)
        await page.click('dialog [aria-label="Tillbaka"]'); await closed()
      }
    }
    await page.setViewport({ width: 390, height: 844 })
    await page.goto(`${base}/round?section=conditions&extra&garage`, { waitUntil: 'networkidle0' })
    const garageBefore = await snapshot()
    await click('Våningsplan', '.ob-form-list-row')
    await fill('[aria-label="Namn på plan 0"]', 'Suterräng / garage')
    await page.click('[aria-label="Lägg till plan"]')
    await fill('[aria-label="Namn på plan 1"]', 'Kontor')
    await page.screenshot({ path: resolve(output, 'garage-floors-390.png') })
    await click('Spara plan'); await saved()
    const garageAfter = await snapshot()
    assert.deepEqual(garageAfter.parts[1].floor_model.levels, [{ level: 0, name: 'Suterräng / garage' }, { level: 1, name: 'Kontor' }])
    assert.deepEqual(garageAfter.parts[0], garageBefore.parts[0])
    assert.deepEqual(garageAfter.db, garageBefore.db)
    await page.click('dialog [aria-label="Tillbaka"]'); await closed()
    assert.ok((await page.$$eval('.ob-form-list-row', nodes => nodes.map(node => node.textContent)))
      .some(text => /Våningsplan.*2 plan.*Plan 0.*Suterräng.*Plan 1.*Kontor/.test(text)))
    await page.screenshot({ path: resolve(output, 'garage-conditions-390.png'), fullPage: true })
    await page.goto(`${base}/round?section=conditions&legacy&legacy-floors`, { waitUntil: 'networkidle0' })
    assert.equal(await page.$$eval('.ob-form-list-row', nodes => nodes.some(node => node.textContent.includes('Våningsplan'))), false)
    await click('Byggnadstyp', '.ob-form-list-row')
    assert.ok((await page.$$eval('dialog .ob-form-label', nodes => nodes.map(node => node.textContent.trim()))).includes('Våningar'))
    assert.equal(await page.evaluate(() => window.__obFormTest.writes.length), 0, 'Legacy numbering is not migrated on read')
    await page.goto(`${base}/round?section=conditions&extra&locked`, { waitUntil: 'networkidle0' })
    await click('Våningsplan', '.ob-form-list-row')
    assert.equal(await page.$eval('dialog fieldset', node => node.disabled), true)
    assert.equal(await page.evaluate(() => window.__obFormTest.writes.length), 0)
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    console.log('PASS: condition floors on main/extra at 320/390/1280, same saved model, isolation, no implicit room/data writes, failed-save retry, pending guard, cancel, legacy and lock')
  } catch (error) {
    await page.screenshot({ path: resolve(output, 'condition-floors-failure.png') })
    console.log('Browser errors:', errors)
    throw error
  } finally { await browser.close() }
}
