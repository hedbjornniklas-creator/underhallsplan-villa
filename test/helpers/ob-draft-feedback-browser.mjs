import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function testDraftFeedback({ page, base, output }) {
  async function click(text) {
    for (const button of await page.$$('button')) {
      if (await button.evaluate(node => node.textContent.trim()) === text) { await button.click(); return }
    }
    throw Error(`Missing button: ${text}`)
  }
  async function fill(selector, text) {
    await page.click(selector)
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control')
    await page.type(selector, text)
  }
  const key = 'ob:text-draft:v1:ob:feedback:grunddata:attendees_other'
  await page.goto(base + '/draft-feedback', { waitUntil: 'networkidle0' })
  await fill('textarea', 'Bekräftat sparad text')
  await page.waitForFunction(() => document.querySelector('output').textContent === 'Bekräftat sparad text')
  await click('Visa textfält')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null,
    'closing an acknowledged save must not recreate a ghost draft from an old prop')
  await click('Visa textfält')
  await click('Sparfel: false')
  await fill('textarea', 'Osparad text får inte rensas')
  await click('Visa textfält')
  assert.equal(JSON.parse(await page.evaluate(key => localStorage.getItem(key), key)).value, 'Osparad text får inte rensas')
  await click('Visa textfält')
  assert.equal(await page.$eval('textarea', node => node.value), 'Osparad text får inte rensas')
  await click('Sparfel: true')
  await page.focus('textarea')
  await click('Visa textfält')
  await page.waitForFunction(key => localStorage.getItem(key) === null, {}, key)

  for (const width of [390, 1280]) {
    await page.setViewport({ width, height: 820 })
    await click('Öppna dialog')
    await page.waitForSelector('dialog[open]')
    await click('Visa dialogfel')
    await page.waitForSelector('dialog [aria-label="Meddelanden"] [role="alert"]')
    const bounds = await page.$eval('[aria-label="Meddelanden"]', node => {
      const r = node.getBoundingClientRect(), alert = node.querySelector('[role="alert"]')
      const a = alert.getBoundingClientRect()
      return { x: r.x, right: r.right, y: r.y, visible: alert.contains(document.elementFromPoint(a.x + a.width / 2, a.y + a.height / 2)) }
    })
    assert.ok(bounds.y >= 0 && bounds.y < 30)
    assert.ok(bounds.right <= width && bounds.visible, 'toast is visible above the modal, not behind its backdrop')
    if (width >= 640) assert.ok(bounds.x > width / 2 && width - bounds.right <= 20, 'desktop toast stays top-right')
    await page.screenshot({ path: resolve(output, `draft-feedback-${width}.png`) })
    await page.click('[aria-label="Stäng felmeddelande"]')
    await page.waitForSelector('[aria-label="Meddelanden"]', { hidden: true })
    await click('Visa dialogfel')
    await page.waitForSelector('dialog [aria-label="Meddelanden"]')
    await page.keyboard.press('Escape')
    await page.waitForSelector('dialog[open]', { hidden: true })
    await page.waitForSelector('body > [aria-label="Meddelanden"]')
    await page.click('[aria-label="Stäng felmeddelande"]')
    await click('Visa kort notis')
    await page.waitForSelector('[aria-label="Meddelanden"]')
    await page.waitForSelector('[aria-label="Meddelanden"]', { hidden: true })
  }
  console.log('PASS: acknowledged saves stay clean after unmount, unsaved text survives, global toasts stay visible above dialogs and auto-dismiss on mobile/desktop.')
}
