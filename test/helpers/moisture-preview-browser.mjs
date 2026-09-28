import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testMoisturePreview(base, output) {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const page = await browser.newPage()
  const errors = []
  const external = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => void dialog.dismiss())
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (new URL(request.url()).origin === base) void request.continue()
    else { external.push(request.url()); void request.abort() }
  })
  async function click(label, selector = 'button') {
    for (const element of await page.$$(selector)) {
      if ((await element.evaluate(node => node.textContent.trim())) === label) { await element.click(); return }
    }
    throw Error(`Missing ${selector}: ${label}`)
  }
  async function open(query = '') {
    // The application intentionally protects dirty forms. Each scenario starts in a new document.
    await page.goto(`${base}/${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.moisture-workspace')
    await page.evaluate(() => document.fonts.ready)
  }
  async function layout(label) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: horizontal overflow`)
    assert.equal(await page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)), true, `${label}: images`)
  }
  async function changeTitle(value) {
    await page.focus('input[name=title]')
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control')
    await page.type('input[name=title]', value)
  }
  try {
    for (const width of [320, 390, 1280]) {
      await page.setViewport({ width, height: 900 })
      await open()
      await layout(`list ${width}`)
      await page.screenshot({ path: resolve(output, `list-${width}.png`), fullPage: true })
      await click('Nytt projekt')
      await layout(`create ${width}`)
      await page.screenshot({ path: resolve(output, `create-${width}.png`), fullPage: true })
      await open('?detail')
      await layout(`detail ${width}`)
      await page.screenshot({ path: resolve(output, `detail-${width}.png`), fullPage: true })
    }
    await page.setViewport({ width: 320, height: 900 })
    const normalTitleSize = await page.$eval('.moisture-workspace h1', title => parseFloat(getComputedStyle(title).fontSize))
    await page.evaluate(() => document.documentElement.setAttribute('data-large-text', ''))
    assert.equal(await page.$eval('.moisture-workspace h1', title => parseFloat(getComputedStyle(title).fontSize)), normalTitleSize * 2, 'text actually scales to 200 percent')
    await layout('detail with 200 percent text')
    await page.screenshot({ path: resolve(output, 'detail-text-200.png'), fullPage: true })
    await open()
    await page.evaluate(() => document.documentElement.setAttribute('data-large-text', ''))
    await layout('list with 200 percent text')
    await page.screenshot({ path: resolve(output, 'list-text-200.png'), fullPage: true })
    await click('Nytt projekt')
    await layout('create with 200 percent text')
    await page.screenshot({ path: resolve(output, 'create-text-200.png'), fullPage: true })

    await open('?empty')
    await click('Nytt projekt')
    await page.click('.moisture-form button[type=submit]')
    await page.waitForSelector('input[name=title][aria-invalid=true]')
    assert.equal(await page.evaluate(() => window.__moistureTest.requests.length), 0)
    await page.type('input[name=title]', 'Nytt fuktprojekt')
    await page.type('input[name="property.name"]', 'Ny testfastighet')
    await page.type('input[name="property.cadastralId"]', 'TEST 3:17')
    await page.click('.moisture-scope-option input')
    await click('Lägg till byggnad')
    await page.type('.moisture-new-building input', 'Huvudbyggnad')
    await page.evaluate(() => window.__moistureTest.setMode('network'))
    await page.click('.moisture-form button[type=submit]')
    await page.waitForFunction(() => document.querySelector('input[name=title]')?.matches(':disabled'))
    await layout('network failure')
    await page.screenshot({ path: resolve(output, 'create-network-error.png'), fullPage: true })
    await page.evaluate(() => window.__moistureTest.setMode('success'))
    await click('Bekräfta skapandet igen')
    await page.waitForFunction(() => window.__moistureTest.navigation.includes('/fuktsakerhet/projekt/'))
    const attempts = await page.evaluate(() => window.__moistureTest.requests)
    assert.equal(attempts.length, 2)
    assert.deepEqual(attempts[0].body, attempts[1].body, 'retry preserves project ID and complete request')
    assert.equal(attempts[1].body.property.cadastralId, 'TEST 3:17')
    assert.deepEqual(attempts[1].body.newBuildings, ['Huvudbyggnad'])

    await open('?detail')
    assert.equal(await page.evaluate(() => window.dispatchEvent(new Event('hushub:before-organization-switch', { cancelable: true }))), true, 'clean form allows organization switch')
    await changeTitle('Ändring som ska bevaras')
    assert.equal(await page.evaluate(() => window.dispatchEvent(new Event('hushub:before-organization-switch', { cancelable: true }))), false, 'dirty form can cancel organization switch')
    assert.equal(await page.$eval('input[name=title]', input => input.value), 'Ändring som ska bevaras', 'cancelled organization switch preserves draft')
    await page.evaluate(() => window.__moistureTest.setMode('conflict'))
    await page.click('.moisture-form button[type=submit]')
    await page.waitForSelector('.moisture-conflict')
    assert.equal(await page.$eval('input[name=title]', input => input.value), 'Ändring som ska bevaras')
    await layout('revision conflict')
    await page.screenshot({ path: resolve(output, 'revision-conflict.png'), fullPage: true })

    // Discard the synthetic page directly; browser navigation would intentionally trigger beforeunload.
    await page.close()
    const successPage = await browser.newPage()
    await successPage.goto(`${base}/?detail`, { waitUntil: 'networkidle0' })
    await successPage.focus('input[name=title]')
    await successPage.keyboard.down('Control'); await successPage.keyboard.press('A'); await successPage.keyboard.up('Control')
    await successPage.type('input[name=title]', 'Uppdaterat projekt')
    await successPage.click('.moisture-form button[type=submit]')
    await successPage.waitForFunction(() => document.querySelector('.moisture-panel-heading')?.textContent.includes('Version 2'))
    assert.equal(await successPage.$eval('input[name=title]', input => input.value), 'Uppdaterat projekt')
    assert.equal(await successPage.$eval('.moisture-form button[type=submit]', button => button.disabled), true)
    assert.deepEqual(errors, [], 'browser errors')
    assert.deepEqual(external, [], 'no external requests')
    console.log('Moisture browser checks passed: 320/390/1280, 200% text, validation, uncertain create/retry, revision conflict, successful save.')
  } finally {
    await browser.close()
  }
}
