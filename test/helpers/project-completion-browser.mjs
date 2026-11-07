import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
export async function testProjectCompletion(base, output) {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  const click = async text => { for (const button of await page.$$('button')) if ((await button.evaluate(b => b.textContent.trim())) === text) { await button.click(); return }; throw Error(`Missing button ${text}`) }
  const fill = async (label, value) => page.evaluate((label, value) => {
    const control = [...document.querySelectorAll('label')].find(l => l.childNodes[0]?.textContent.trim() === label)?.querySelector('input,textarea')
    if (!control) throw Error(`Missing field ${label}`)
    Object.getOwnPropertyDescriptor(control.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(control, value)
    control.dispatchEvent(new Event('input', { bubbles: true }))
  }, label, value)
  const saved = () => page.waitForFunction(() => document.querySelector('[data-testid=dirty]').textContent === 'clean')
  try {
    await page.setViewport({ width: 1440, height: 1000 }); await page.goto(base, { waitUntil: 'networkidle0' }); await saved()
    assert.equal(await page.evaluate(() => window.fixture.calls.length), 0, 'Opening is read-only')
    await page.evaluate(() => { [...document.querySelectorAll('input[type=checkbox]')][0].click() }); await saved()
    await page.evaluate(() => { [...document.querySelectorAll('input[type=checkbox]')][1].click() }); await saved()
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Avsluta projekt').disabled), 'Open questions prevent close')
    await page.evaluate(() => window.fixture.clearQuestions()); await page.click('[aria-label="Uppdatera projektstatus"]'); await saved()
    await click('Avsluta projekt'); await click('Bekräfta'); await page.waitForFunction(() => document.querySelector('[data-testid=status]').textContent === 'completed'); await saved()
    await click('Återöppna projekt'); await click('Bekräfta'); await page.waitForFunction(() => document.querySelector('[data-testid=status]').textContent === 'in_progress'); await saved()
    await click('Nytt underlag'); await click('Lägg till rad'); await fill('Beskrivning', 'Fiktivt byggarbete'); await fill('Antal', '10'); await fill('À-pris exkl. moms', '600'); await saved()
    await page.waitForFunction(() => window.fixture.data().bases[0]?.body.lines[0]?.unitPriceOre === 60000)
    assert.match(await page.$eval('.gizmo-invoice-totals', e => e.textContent), /7\s?500,00/)
    assert.equal(await page.evaluate(() => window.fixture.data().bases[0].body.lines[0].quantity), 10)
    // A late acknowledgement must not replace text entered after the save began.
    await page.evaluate(() => window.fixture.delay(700)); await fill('Notering till underlaget', 'Första texten')
    await page.waitForFunction(() => window.fixture.calls.at(-1).body?.note === 'Första texten')
    await fill('Notering till underlaget', 'Nyare text under sparning'); await saved()
    await page.waitForFunction(() => window.fixture.data().bases[0]?.body.note === 'Nyare text under sparning')
    await page.evaluate(() => window.fixture.delay(0))
    await fill('À-pris exkl. moms', '0'); await saved(); await page.waitForFunction(() => window.fixture.data().bases[0]?.body.lines[0]?.unitPriceOre === 0)
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'PDF').disabled), false)
    await fill('À-pris exkl. moms', ''); await saved(); await page.waitForFunction(() => window.fixture.data().bases[0]?.body.lines[0]?.unitPriceOre === null)
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'PDF').disabled), true)
    await page.evaluate(() => window.fixture.failNext()); await fill('À-pris exkl. moms', '650')
    await page.waitForFunction(() => document.body.textContent.includes('Syntetiskt sparfel'))
    const failedId = await page.evaluate(() => window.fixture.calls.at(-1).requestId)
    await click('Försök igen'); await saved(); await page.waitForFunction(() => window.fixture.data().bases[0]?.body.lines[0]?.unitPriceOre === 65000)
    assert.equal(await page.evaluate(() => window.fixture.calls.at(-1).requestId), failedId)
    await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.gizmo-invoice-row'); await saved()
    assert.equal(await page.evaluate(() => document.querySelector('.gizmo-invoice-row input[inputmode=decimal]')?.value), '10')
    for (const width of [1440, 768, 390]) {
      await page.setViewport({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No overflow at ${width}`)
      await page.screenshot({ path: resolve(output, `invoice-basis-${width}.png`), fullPage: true })
    }
    assert.deepEqual(errors, [])
    console.log('UI passed: read-only open, flags, blockers, close/reopen, invoice autosave, late save, zero/missing, retry, reload and 3 viewports.')
  } finally { await browser.close() }
}
