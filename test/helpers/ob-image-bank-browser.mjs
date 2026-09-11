import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function testImageBank(page, base, output) {
  const bank = 'dialog[aria-label="Bildbank"]'
  const editor = 'dialog[aria-label="Notering"]'
  async function click(text, parent = '') {
    for (const button of await page.$$(`${parent} button`)) {
      if (await button.evaluate(node => node.textContent.trim()) === text) {
        await button.click()
        return
      }
    }
    throw Error(`Missing button: ${text}`)
  }
  async function fresh(query = '?imagebank') {
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.goto(base + '/' + query, { waitUntil: 'networkidle0' })
    await page.click('.obm-place-row')
    await page.click('[data-note-id="note-1"]')
    await page.waitForSelector(editor)
  }
  async function openBank() {
    await click('Bildbank', editor)
    await page.waitForSelector(bank)
    assert.equal(await page.$$eval('dialog[open]', rows => rows.length), 1)
  }
  async function select(id) {
    await page.click(`[data-bank-image-id="${id}"] input`)
  }
  async function search(value) {
    await page.$eval('[aria-label="Sök i bildbanken"]', input => input.select())
    await page.keyboard.press('Backspace')
    if (value) await page.type('[aria-label="Sök i bildbanken"]', value)
  }
  for (const width of [320, 390, 1280]) {
    await page.setViewport({ width, height: 820 })
    await fresh()
    assert.deepEqual(await page.$$eval('.obm-photo-actions button', rows => rows.map(row => row.textContent.trim())), ['Ta bild', 'Välj bilder', 'Bildbank'])
    await click('Ta bild', editor)
    await click('Välj bilder', editor)
    assert.deepEqual(await page.evaluate(() => window.__obMobileTest.calls.map(call => [call.kind, call.id])), [['camera', 'note-1'], ['gallery', 'note-1']])
    await page.$eval(`${editor} textarea`, node => node.setSelectionRange(node.value.length, node.value.length))
    await page.type(`${editor} textarea`, ' Tillagd text.')
    await openBank()
    assert.equal(await page.evaluate(() => window.__obMobileTest.notes.find(note => note.id === 'note-1').note), 'Spricka vid dörr. Tillagd text.')
    assert.equal(await page.$$eval('[data-bank-image-id]', rows => rows.length), 4)
    assert.equal(await page.$('[data-bank-image-id="bank-linked"]'), null)
    assert.equal(await page.$('[data-bank-image-id="bank-ignored"]'), null)
    assert.deepEqual(await page.$$eval('.obm-image-bank-group h3', rows => rows.map(row => row.textContent)), ['Samma plats', 'Övriga platser', 'Utan plats'])
    await search('Uppladdad')
    await select('bank-unplaced')
    await search('')
    await select('photo-1')
    assert.equal(await page.$eval(`${bank} footer button`, node => node.textContent.trim()), 'Koppla 2 bilder')
    await page.evaluate(() => { document.querySelector('.obm-sheet-body').scrollTop = 0 })
    assert.ok(await page.$$eval('.obm-sheet,.obm-sheet-body', rows => rows.every(row => row.scrollWidth <= row.clientWidth + 1)))
    assert.ok(await page.$$eval('.obm-image-bank-item img', rows => rows.every(image => image.complete && image.naturalWidth > 0)))
    await page.screenshot({ path: resolve(output, `image-bank-${width}.png`) })
    await page.click(`${bank} [aria-label="Tillbaka"]`)
    await page.waitForSelector(editor)
    assert.equal(await page.$eval(`${editor} textarea`, node => node.value), 'Spricka vid dörr. Tillagd text.')
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.filter(call => call.kind === 'link-batch').length), 0)
    await openBank()
    assert.equal(await page.$$eval('.obm-image-bank-item input:checked', rows => rows.length), 0)
    await select('photo-1')
    await select('bank-other')
    await page.evaluate(() => { window.__obMobileTest.failSaves = true; window.__obMobileTest.holdLinks = true })
    await page.click(`${bank} footer button`)
    await page.waitForFunction(() => document.querySelector('dialog[aria-label="Bildbank"] [aria-label="Tillbaka"]').disabled)
    await page.keyboard.press('Escape')
    assert.ok(await page.$(bank))
    await page.evaluate(() => { window.__obMobileTest.holdLinks = false })
    await page.waitForSelector(`${bank} [role="alert"]`)
    assert.equal(await page.$$eval('.obm-image-bank-item input:checked', rows => rows.length), 2)
    assert.equal(await page.evaluate(() => window.__obMobileTest.images.filter(image => image.control_item_id === 'note-1').length), 0)
    await page.evaluate(() => { window.__obMobileTest.failSaves = false })
    await page.click(`${bank} footer button`)
    await page.waitForSelector(editor)
    assert.equal(await page.$$eval(`${editor} .obm-photos [data-image-id]`, rows => rows.length), 2)
    assert.ok(await page.evaluate(() => window.__obMobileTest.images.filter(image => ['photo-1', 'bank-other'].includes(image.id)).every(image => image.control_item_id === 'note-1' && image.interior_room_id === 'room-1')))
    await page.$eval('.obm-photo-actions', node => node.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: resolve(output, `note-images-${width}.png`) })
  }
  // A partial response keeps only the unlinked selections available for retry.
  await fresh()
  await openBank()
  await select('photo-1')
  await select('bank-other')
  await page.evaluate(() => { window.__obMobileTest.partialLink = true })
  await page.click(`${bank} footer button`)
  await page.waitForSelector(`${bank} [role="alert"]`)
  assert.equal(await page.$('[data-bank-image-id="photo-1"]'), null)
  assert.equal(await page.$eval(`${bank} footer button`, node => node.textContent.trim()), 'Koppla 1 bild')
  await page.evaluate(() => { window.__obMobileTest.partialLink = false })
  await page.click(`${bank} footer button`)
  await page.waitForSelector(editor)
  assert.deepEqual(await page.evaluate(() => window.__obMobileTest.calls.filter(call => call.kind === 'link-batch').map(call => call.patch)), [['photo-1', 'bank-other'], ['bank-other']])
  await fresh('')
  await openBank()
  await select('photo-1')
  await page.click(`${bank} footer button`)
  await page.waitForSelector(editor)
  await openBank()
  assert.equal(await page.$eval(`${bank} .obm-empty`, node => node.textContent), 'Inga ohanterade bilder.')
  assert.equal(await page.$eval(`${bank} footer button`, node => node.disabled), true)
  await fresh('?queued')
  await openBank()
  assert.equal(await page.$eval('[data-bank-image-id="photo-1"] input', node => node.disabled), true)
  assert.equal(await page.$eval(`${bank} footer button`, node => node.disabled), true)
  await page.evaluate(() => window.__obMobileTest.completeUpload())
  await page.waitForFunction(() => !document.querySelector('[data-bank-image-id="photo-1"] input').disabled)
  await select('photo-1')
  await page.click(`${bank} footer button`)
  await page.waitForSelector(editor)
  await fresh('?locked')
  assert.ok(await page.$$eval('.obm-photo-actions button', rows => rows.every(row => row.disabled)))
  // Failed autosave keeps the note open, with its text, instead of entering the bank.
  await fresh()
  await page.evaluate(() => { window.__obMobileTest.failSaves = true })
  await page.type(`${editor} textarea`, ' Osparat.')
  await click('Bildbank', editor)
  await page.waitForSelector(`${editor} [role="alert"]`)
  assert.equal(await page.$(bank), null)
  assert.ok((await page.$eval(`${editor} textarea`, node => node.value)).includes('Osparat.'))
  await page.evaluate(() => { window.__obMobileTest.failSaves = false })
  await page.click(`${editor} [aria-label="Tillbaka"]`)
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  console.log('PASS: three photo actions, multi-select image bank, grouping/search, draft guard, cancellation, partial retry, locks/queued images and 320-1280px layouts.')
}
