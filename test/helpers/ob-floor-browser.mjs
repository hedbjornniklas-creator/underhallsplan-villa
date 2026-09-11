import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function testFloorEditor(page, base, output) {
  async function clickText(text) {
    for (const button of await page.$$('button')) {
      if (await button.evaluate((node, label) => node.textContent.trim() === label, text)) { await button.click(); return }
    }
    throw Error(`Missing button: ${text}`)
  }
  async function fill(selector, text) {
    await page.click(selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.type(selector, text)
  }
  for (const width of [320, 390, 1280]) {
    await page.setViewport({ width, height: 820 })
    await page.goto(`${base}/?levels`, { waitUntil: 'networkidle0' })
    assert.deepEqual(await page.$$eval('select[aria-label="Plan"] option', rows => rows.map(row => row.value)), ['ovrigt','plan-1','plan0','plan1'])
    assert.ok((await page.$eval('select[aria-label="Plan"]', node => node.textContent)).includes('Plan 0'))
    // The fixture's menu exposes the actual production floor editor.
    await page.click('.obm-inspection-header button')
    await page.waitForSelector('section[aria-label="Plan"]')
    assert.equal(await page.$eval('button[aria-label="Ta bort plan 0"]', node => node.disabled), true)
    await fill('input[aria-label="Nytt plannummer"]', '-2')
    await page.click('button[aria-label="L\u00e4gg till plan"]')
    await page.waitForSelector('input[aria-label="Namn p\u00e5 plan -2"]')
    await fill('input[aria-label="Namn p\u00e5 plan -2"]', 'Underplan med ett mycket langt namn')
    await page.screenshot({ path: resolve(output, `floor-editor-${width}.png`) })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'floor editor horizontal overflow')
    assert.ok(await page.$eval('section[aria-label="Plan"]', node => node.scrollWidth <= node.clientWidth + 1))
    await clickText('Spara plan')
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(node => node.textContent === 'Spara plan'))
    await page.click('dialog [aria-label="Tillbaka"]')
    await page.select('select[aria-label="Plan"]', 'plan-2')
    assert.ok((await page.$eval('select[aria-label="Plan"]', node => node.selectedOptions[0].textContent)).includes('Underplan'))
    await page.click('.obm-inspection-header button')
    await page.click('button[aria-label="Ta bort plan 1"]')
    await clickText('Spara plan')
    await page.waitForSelector('section [role="alert"]')
    await clickText('Avbryt')
    assert.ok(await page.$('input[aria-label="Namn p\u00e5 plan 1"]'))
  }
  await page.goto(`${base}/?levels&locked`, { waitUntil: 'networkidle0' })
  await page.click('.obm-inspection-header button')
  assert.equal(await page.$eval('section fieldset', node => node.disabled), true)
}
