import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function testImageRemoval(page, base, output) {
  const editor = 'dialog[aria-label="Notering"]'
  const choice = 'dialog[aria-label="Ta bort bild"]'
  async function click(text, parent = 'dialog') {
    for (const button of await page.$$(`${parent} button`)) {
      if (await button.evaluate(node => node.textContent.trim()) === text) {
        await button.click()
        return
      }
    }
    throw Error(`Missing button: ${text}`)
  }
  async function fresh(query = '') {
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.goto(`${base}/?linked${query}`, { waitUntil: 'networkidle0' })
    await page.click('.obm-place-row')
    await page.click('[data-note-id="note-1"]')
    await page.waitForSelector(editor)
  }
  async function open() {
    await page.click(`${editor} [aria-label="Ta bort bild"]`)
    await page.waitForSelector(choice)
    assert.equal(await page.$$eval('dialog[open]', rows => rows.length), 1)
  }
  for (const width of [320, 390, 1280]) {
    await page.setViewport({ width, height: 820 })
    await fresh()
    const original = await page.evaluate(() => ({ images: window.__obMobileTest.images, notes: window.__obMobileTest.notes }))
    await open()
    assert.deepEqual(await page.$$eval(`${choice} footer button`, rows => rows.map(row => row.textContent.trim())), ['Ta bort från noteringen', 'Radera från besiktningen'])
    assert.ok(await page.$$eval('.obm-sheet,.obm-sheet-body', rows => rows.every(row => row.scrollWidth <= row.clientWidth + 1)))
    await page.screenshot({ path: resolve(output, `image-removal-choice-${width}.png`) })
    await page.click(`${choice} [aria-label="Tillbaka"]`)
    await page.waitForSelector(editor)
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0)
    // The destructive choice still requires a separate confirmation.
    await open()
    await click('Radera från besiktningen')
    await page.waitForSelector('dialog[aria-label="Radera bild"]')
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.some(call => call.kind === 'remove')), false)
    await click('Avbryt')
    await page.waitForSelector(editor)
    assert.deepEqual(await page.evaluate(() => window.__obMobileTest.images), original.images)
    // Flush new text before entering either action.
    await page.type(`${editor} textarea`, 'Sparad text. ')
    await open()
    const text = await page.evaluate(() => window.__obMobileTest.notes[0].note)
    assert.ok(text.includes('Sparad text.'))
    await page.evaluate(() => { window.__obMobileTest.holdUnlink = true })
    await click('Ta bort från noteringen')
    await page.waitForFunction(() => document.querySelector('dialog[aria-label="Ta bort bild"] [aria-label="Tillbaka"]').disabled)
    await page.keyboard.press('Escape')
    assert.ok(await page.$(choice))
    assert.ok(await page.$$eval(`${choice} footer button`, rows => rows.every(row => row.disabled)))
    await page.evaluate(() => { window.__obMobileTest.holdUnlink = false })
    await page.waitForSelector(editor)
    assert.equal(await page.$('.obm-photos [data-image-id="photo-1"]'), null)
    const result = await page.evaluate(() => ({ images: window.__obMobileTest.images, notes: window.__obMobileTest.notes, calls: window.__obMobileTest.calls }))
    assert.deepEqual(result.images, [{ ...original.images[0], control_item_id: null, processing_status: 'unprocessed', ignored_at: null }])
    assert.equal(result.notes[0].note, text)
    assert.equal(result.notes.length, original.notes.length)
    assert.equal(result.calls.filter(call => call.kind === 'unlink').length, 1)
    assert.equal(result.calls.filter(call => call.kind === 'remove').length, 0)
    await page.click(`${editor} [aria-label="Tillbaka"]`)
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    await page.click('nav button:last-child')
    await page.waitForSelector('.obm-image-thumb')
    assert.equal(await page.$$eval('.obm-image-row', rows => rows.length), 1)
    // The same retained image is available to link to a different note.
    await page.click('nav button:first-child')
    await page.click('.obm-place-row')
    await page.click('[data-note-id="note-1"]')
    await click('Bildbank')
    await page.waitForSelector('[data-bank-image-id="photo-1"]')
  }
  await fresh()
  await open()
  await page.evaluate(() => { window.__obMobileTest.failSaves = true })
  await click('Ta bort från noteringen')
  await page.waitForSelector(`${choice} [role="alert"]`)
  assert.equal(await page.evaluate(() => window.__obMobileTest.images[0].control_item_id), 'note-1')
  await page.evaluate(() => { window.__obMobileTest.failSaves = false })
  await click('Ta bort från noteringen')
  await page.waitForSelector(editor)
  assert.equal(await page.evaluate(() => window.__obMobileTest.images[0].control_item_id), null)
  await fresh()
  await open()
  await click('Radera från besiktningen')
  await page.waitForFunction(() => !document.querySelector('dialog .obm-danger').disabled)
  await click('Radera bild', 'dialog footer')
  await page.waitForSelector(editor)
  assert.equal(await page.evaluate(() => window.__obMobileTest.images.length), 0)
  assert.equal(await page.evaluate(() => window.__obMobileTest.notes.length), 3)
  await fresh('&locked')
  assert.equal(await page.$eval(`${editor} [aria-label="Ta bort bild"]`, node => node.disabled), true)
  await fresh('&queued')
  await open()
  assert.ok(await page.$$eval(`${choice} footer button`, rows => rows.every(row => row.disabled)))
  await page.click(`${choice} [aria-label="Tillbaka"]`)
  await page.waitForSelector(editor)
  await page.evaluate(() => { window.__obMobileTest.failSaves = true })
  await page.type(`${editor} textarea`, 'Osparat. ')
  await page.click(`${editor} [aria-label="Ta bort bild"]`)
  await page.waitForSelector(`${editor} [role="alert"]`)
  assert.equal(await page.$(choice), null)
  assert.equal(await page.evaluate(() => window.__obMobileTest.images[0].control_item_id), 'note-1')
  await page.evaluate(() => { window.__obMobileTest.failSaves = false })
  await page.click(`${editor} [aria-label="Tillbaka"]`)
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  console.log('PASS: unlink/delete choices, preserved files/location/text, return to pending/bank, confirmation, retry, save guards and 320-1280px layouts.')
}
