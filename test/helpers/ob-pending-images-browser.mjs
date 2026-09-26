import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function testPendingImages(page, base, output) {
  const filters = '[role="group"][aria-label="Visa bilder"]'
  const unmatched = `${filters} button:first-child`
  const all = `${filters} button:last-child`
  const rows = '.obm-image-list .obm-image-row'
  const viewer = 'dialog[aria-label="Bild"]'
  const editor = 'dialog[aria-label="Notering"]'
  const next = `${viewer} button[aria-label="N\u00e4sta bild"]`
  const back = 'dialog[open] button[aria-label="Tillbaka"]'
  const row = id => `${rows}[data-image-id="${id}"]`
  const ids = () => page.$$eval(rows, nodes => nodes.map(node => node.dataset.imageId))
  const records = () => page.evaluate(() => ({
    images: window.__obMobileTest.images,
    notes: window.__obMobileTest.notes,
    rooms: window.__obMobileTest.rooms,
    observations: window.__obMobileTest.observations,
    calls: window.__obMobileTest.calls,
  }))
  async function click(selector) {
    await page.$eval(selector, node => node.scrollIntoView({ block: 'center' }))
    await page.click(selector)
  }
  async function fresh(query = '?image-preview-nav&legacy-notes&trash') {
    await page.goto(base)
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.goto(base + '/' + query, { waitUntil: 'networkidle0' })
    await page.click('nav button:last-child')
    await page.waitForSelector(filters)
  }
  async function close() {
    await click(back)
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  }
  const expectedUnmatched = ['photo-1', 'preview-middle', 'preview-exterior', 'preview-unplaced']
  const expectedAll = ['photo-1', 'preview-linked', 'preview-middle', 'preview-ignored', 'preview-exterior', 'preview-unplaced', 'legacy-image']
  for (const width of [320, 390, 1280]) {
    await page.setViewport({ width, height: 900 })
    await fresh()
    const before = await records()
    const badge = await page.$eval('nav button:last-child', node => node.textContent)
    assert.equal(await page.$eval(unmatched, node => node.getAttribute('aria-pressed')), 'true')
    assert.deepEqual(await ids(), expectedUnmatched)
    await click(all)
    assert.deepEqual(await ids(), expectedAll)
    assert.equal(await page.$eval('nav button:last-child', node => node.textContent), badge, 'pending count is independent of the visible image filter')
    assert.equal(await page.$eval('.obm-image-trash', node => node.open), false)
    assert.match(await page.$eval(row('preview-linked'), node => node.textContent), /Kopplad till notering/)
    assert.match(await page.$eval(row('legacy-image'), node => node.textContent), /Kopplad till notering/)
    assert.match(await page.$eval(row('legacy-image'), node => node.textContent), /Utsida \u00b7 Fasad/)
    assert.match(await page.$eval(row('preview-ignored'), node => node.textContent), /Undantagen/)
    assert.match(await page.$eval(row('preview-unplaced'), node => node.textContent), /Ej kopplad/, 'a processing status alone does not create a note relation')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.ok(await page.$$eval(`${filters} button`, nodes => nodes.every(node => {
      const rect = node.getBoundingClientRect()
      return rect.height >= 44 && node.scrollWidth <= node.clientWidth + 1
    })), 'filters fit and have touch-sized targets')
    await page.$eval(filters, node => node.scrollIntoView({ block: 'start' }))
    await page.screenshot({ path: resolve(output, `pending-all-images-${width}.png`) })

    await click(`${row('preview-linked')} .obm-image-link`)
    await page.waitForSelector(editor)
    assert.equal(await page.$eval(`${editor} textarea`, node => node.value), 'Spricka vid d\u00f6rr.')
    assert.equal(await page.$('dialog[aria-label="Koppla bild"]'), null)
    await close()
    assert.equal(await page.$eval(all, node => node.getAttribute('aria-pressed')), 'true')
    assert.deepEqual(await ids(), expectedAll)

    await click(`${row('photo-1')} .obm-image-thumb`)
    await page.waitForSelector(viewer)
    for (let index = 0; index < expectedAll.length; index++) {
      await page.waitForFunction(count => document.querySelector('dialog[aria-label="Bild"] nav')?.textContent.includes(count), {}, `${index + 1} av ${expectedAll.length}`)
      const footer = await page.$eval(`${viewer} footer button`, node => ({ label: node.textContent.trim(), disabled: node.disabled }))
      assert.equal(footer.label, index === 1 ? '\u00d6ppna notering' : index === 6 ? '\u00d6ppna plats' : 'Koppla till notering')
      assert.equal(footer.disabled, index === 3, 'ignored images remain view-only')
      if (index < expectedAll.length - 1) await click(next)
    }
    assert.equal(await page.$eval(next, node => node.disabled), true)
    await close()
    await click(unmatched)
    assert.deepEqual(await ids(), expectedUnmatched)
    assert.deepEqual(await records(), before, 'filtering, opening notes and browsing do not write data or fetch trash')
  }

  // Older exterior note images are visible without being offered for relinking.
  await page.setViewport({ width: 390, height: 844 })
  await fresh()
  const beforeLegacy = await records()
  await click(all)
  await click(`${row('legacy-image')} .obm-image-link`)
  await page.waitForSelector(viewer)
  assert.equal(await page.$eval(`${viewer} footer button`, node => node.textContent.trim()), '\u00d6ppna plats')
  assert.equal(await page.$eval(`${viewer} .obm-place-label`, node => node.textContent.trim()), 'Utsida \u00b7 Fasad')
  await click(`${viewer} footer button`)
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  await page.waitForFunction(() => document.querySelector('.obm-room-header')?.textContent.includes('Fasad'))
  assert.deepEqual(await records(), beforeLegacy)

  for (const query of ['?empty-images', '?linked']) {
    await fresh(query)
    assert.deepEqual(await ids(), [])
    assert.match(await page.$eval('.obm-empty', node => node.textContent), /Inga bilder utan notering/)
    await click(all)
    assert.deepEqual(await ids(), query === '?empty-images' ? [] : ['photo-1'])
    if (query === '?empty-images') assert.match(await page.$eval('.obm-empty', node => node.textContent), /Inga bilder \u00e4nnu/)
  }

  // Both modes use only the images supplied by the current building; queued
  // and locked images can be viewed without enabling link/delete mutations.
  for (const flag of ['extra-building', 'locked', 'queued']) {
    await fresh(`?image-preview-nav&${flag}`)
    const before = await records()
    await click(all)
    assert.deepEqual(await ids(), before.images.map(image => image.id))
    if (flag === 'queued') assert.match(await page.$eval(row('photo-1'), node => node.textContent), /Lokal bild/)
    await click(`${row('photo-1')} .obm-image-thumb`)
    await page.waitForSelector(viewer)
    assert.equal(await page.$eval(`${viewer} footer button`, node => node.disabled), flag !== 'extra-building')
    await close()
    assert.deepEqual(await records(), before)
  }

  // A committed link removes an image only from the unmatched mode.
  await fresh('?image-preview-nav')
  await click(all)
  await click(`${row('photo-1')} .obm-image-link`)
  const linker = 'dialog[aria-label="Koppla bild"]'
  await page.waitForSelector(`${linker} input[value="note-1"]`)
  await click(`${linker} input[value="note-1"]`)
  await click(`${linker} footer .obm-primary`)
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  assert.deepEqual(await ids(), expectedAll.slice(0, -1))
  assert.match(await page.$eval(row('photo-1'), node => node.textContent), /Kopplad till notering/)
  await click(unmatched)
  assert.deepEqual(await ids(), expectedUnmatched.slice(1))
  assert.deepEqual(await page.evaluate(() => window.__obMobileTest.calls), [{ kind: 'link', id: 'note-1' }])
  console.log('PASS: pending image filters, counts, linked/legacy notes, ordered viewing, empty/locked/queued states and unchanged data at mobile/desktop sizes.')
}
