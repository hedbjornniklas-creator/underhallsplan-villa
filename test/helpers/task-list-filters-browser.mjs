import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testTaskListFilters(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  try {
    const page = await browser.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setRequestInterception(true)
    page.on('request', request => request.url().startsWith(base) || /^(data|blob):/.test(request.url()) ? request.continue() : request.abort())
    const titles = () => page.$$eval('[aria-label^="Öppna uppdraget "]', rows => rows
      .filter(row => row.checkVisibility()).map(row => row.getAttribute('aria-label').replace('Öppna uppdraget ', '')))
    const waitTitles = async expected => { try { await page.waitForFunction(values => {
      const titles = [...document.querySelectorAll('[aria-label^="Öppna uppdraget "]')]
        .filter(row => row.checkVisibility()).map(row => row.getAttribute('aria-label').replace('Öppna uppdraget ', ''))
      return JSON.stringify(titles.sort()) === JSON.stringify([...values].sort())
    }, { timeout: 10000 }, expected) } catch (error) {
      await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true })
      throw Error(`Expected ${JSON.stringify(expected)}, found ${JSON.stringify(await titles())}`, { cause: error })
    } }
    const select = (label, value) => page.select(`select[aria-label="${label}"]`, value)
    const open = async () => { if (!(await page.$eval('.gizmo-task-options', node => node.open))) await page.click('.gizmo-task-options > summary') }
    const clickButton = async text => {
      for (const button of await page.$$('button')) {
        if (await button.evaluate((node, value) => node.checkVisibility() && node.textContent.trim().includes(value), text)) {
          await button.click(); return
        }
      }
      throw Error(`Missing visible button: ${text}`)
    }
    for (const width of [320, 390, 1280]) {
      await page.setViewport({ width, height: 950 })
      await page.goto(base, { waitUntil: 'networkidle0' })
      await page.evaluate(() => localStorage.clear())
      await page.reload({ waitUntil: 'networkidle0' })
      await page.waitForSelector('#task-list-sort')
      assert.ok(await page.$eval('#task-list-sort', node => node.getClientRects().length > 0), 'Sort is available on desktop and mobile')
      await open()
      await select('Rader per sida', '10')
      await clickButton('Nästa')
      await page.waitForFunction(() => document.querySelector('nav[aria-label="Sidindelning"]')?.textContent.includes('Sida 2'))
      await select('Filtrera projekt / sammanhang', 'context:Östra skolan')
      await select('Filtrera mottagare', 'profile:bo')
      await waitTitles(['Samordna renoveringen', 'Kontrollera fönster', 'Invänta leveransen'])
      assert.equal(await page.$('nav[aria-label="Sidindelning"]'), null, 'Filtering resets page and recalculates page count')
      await select('Filtrera status', 'in_progress')
      await waitTitles(['Samordna renoveringen', 'Kontrollera fönster'])
      await page.select('#task-list-sort', 'ball:desc')
      await page.reload({ waitUntil: 'networkidle0' })
      await waitTitles(['Samordna renoveringen', 'Kontrollera fönster'])
      assert.equal(await page.$eval('#task-list-sort', node => node.value), 'ball:desc')
      await open()
      assert.equal(await page.$eval('select[aria-label="Filtrera mottagare"]', node => node.value), 'profile:bo')
      assert.equal(await page.$eval('.gizmo-task-create-mobile', node => node.checkVisibility()), false, 'Mobile create action does not cover the open filters')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await page.screenshot({ path: resolve(output, `filters-${width}.png`), fullPage: true })
      await clickButton('Visa resultat')
      assert.equal(await page.$eval('.gizmo-task-options', node => node.open), false)
      await page.screenshot({ path: resolve(output, `results-${width}.png`), fullPage: true })
      await page.click('button[aria-label="Ta bort filtret Status"]')
      await waitTitles(['Samordna renoveringen', 'Kontrollera fönster', 'Invänta leveransen'])
      await open()
      await select('Filtrera status', 'ready_for_review')
      await waitTitles([])
      assert.ok((await page.$eval('main', node => node.textContent)).includes('Inga uppgifter matchar filtren'), 'Different children must not satisfy separate filters')
      await select('Filtrera status', 'in_progress')
      await waitTitles(['Samordna renoveringen', 'Kontrollera fönster'])
      await clickButton('Visa resultat')
      await clickButton('Dölj')
      await waitTitles(['Samordna renoveringen'])
      await clickButton('Visa 1 matchande')
      await waitTitles(['Samordna renoveringen', 'Kontrollera fönster'])
      await clickButton('Rensa filter')
      await open()
      await select('Filtrera mottagare', 'profile:bo')
      await select('Filtrera bollen hos', 'profile:anna')
      await waitTitles(['Godkänn provet'])
      await clickButton('Rensa filter')
      await open()
      await select('Filtrera status', 'approved')
      await waitTitles(['Avslutat ärende'])
      assert.equal(await page.$eval('#task-list-selection', node => node.value), 'all', 'Explicit closed status is not hidden by the default Active view')
      await clickButton('Rensa filter')
      await open()
      await select('Filtrera projekt / sammanhang', 'none')
      await waitTitles(['Ring leverantören'])
      await clickButton('Rensa filter')
      await open()
      await select('Filtrera uppdragsansvarig', 'bo')
      await waitTitles(['Besök Björkvägen'])
      await clickButton('Rensa filter')
      await open()
      await select('Välj listvisning', 'all')
      await page.select('#task-list-sort', 'title:asc')
      await page.type('input[aria-label="Sök uppgifter"]', 'fönster')
      await waitTitles(['Kontrollera fönster'])
      await clickButton('Rensa filter')
      await select('Jag har tid', '5')
      await waitTitles(['Ring leverantören'])
      assert.deepEqual(await page.evaluate(() => window.__taskFilterTest.writes), [])
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    }
    await page.evaluateOnNewDocument(() => {
      Storage.prototype.getItem = () => { throw Error('Synthetic storage denied') }
      Storage.prototype.setItem = () => { throw Error('Synthetic storage denied') }
    })
    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForSelector('#task-list-sort')
    await open(); await select('Filtrera uppdragsansvarig', 'bo')
    await waitTitles(['Besök Björkvägen'])
    await page.focus('select[aria-label="Filtrera uppdragsansvarig"]')
    await page.keyboard.press('Escape')
    assert.equal(await page.$eval('.gizmo-task-options', node => node.open), false)
    assert.equal(await page.$eval('.gizmo-task-options > summary', node => document.activeElement === node), true)
    assert.deepEqual(errors, [])
    console.log('Task filters passed at 320/390/1280: combined filters, grouped child matches, sorting, pagination, reload, blocked storage, time budget and zero writes.')
  } finally { await browser.close() }
}
