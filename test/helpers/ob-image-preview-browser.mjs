import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function testImagePreview(page, base, output) {
  const viewer = 'dialog[aria-label="Bild"]'
  const navigation = `${viewer} nav[aria-label="Bläddra bland bilder"]`
  const previous = `${navigation} button[aria-label="Föregående bild"]`
  const next = `${navigation} button[aria-label="Nästa bild"]`
  const linker = 'dialog[aria-label="Koppla bild"]'
  async function fresh(query = '') {
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.goto(base + '/' + query, { waitUntil: 'networkidle0' })
    await page.click('nav button:last-child')
    await page.waitForSelector('.obm-image-thumb img')
  }
  async function open(index = 0) {
    const thumbs = await page.$$('.obm-image-thumb')
    await thumbs[index].evaluate(node => node.scrollIntoView({ block: 'center' }))
    await thumbs[index].click()
    await page.waitForSelector(`${viewer} .obm-image-viewer img`)
    await page.waitForFunction(() => document.querySelector('.obm-image-viewer img').naturalWidth > 0)
  }
  const closed = () => page.waitForFunction(() => !document.querySelector('dialog[open]'))
  const records = () => page.evaluate(() => ({
    images: window.__obMobileTest.images,
    notes: window.__obMobileTest.notes,
    rooms: window.__obMobileTest.rooms,
    observations: window.__obMobileTest.observations,
  }))
  async function assertNavigation(index, count) {
    await page.waitForFunction((selector, status) => document.querySelector(selector)?.textContent.includes(status), {}, navigation, `${index + 1} av ${count}`)
    assert.equal(await page.$eval(previous, node => node.disabled), index === 0)
    assert.equal(await page.$eval(next, node => node.disabled), index === count - 1)
    assert.equal(await page.$(linker), null, 'browsing stays in the enlarged image viewer')
  }
  async function assertFits() {
    assert.ok(await page.$$eval('.obm-sheet,.obm-sheet-body', rows => rows.every(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1)), 'viewer content fits without overflowing')
    assert.ok(await page.$$eval('dialog[aria-label="Bild"] nav[aria-label="Bläddra bland bilder"] button', nodes => nodes.length === 2 && nodes.every(node => {
      const rect = node.getBoundingClientRect()
      return rect.width >= 44 && rect.height >= 44 && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
    })), 'both navigation arrows have visible touch-sized targets')
  }
  for (const [width, height] of [[320, 820], [390, 820], [1280, 820], [820, 390]]) {
    await page.setViewport({ width, height })
    await fresh()
    await page.$eval('.obm-image-thumb', node => node.scrollIntoView({ block: 'center' }))
    const original = await page.$eval('.obm-image-thumb img', node => node.src)
    const scroll = await page.evaluate(() => scrollY)
    await open()
    await assertNavigation(0, 1)
    assert.equal(await page.$('dialog[aria-label="Koppla bild"]'), null)
    assert.equal(await page.$eval('.obm-image-viewer img', node => node.src), original)
    assert.equal(await page.$eval('body', node => getComputedStyle(node).overflowY), 'hidden')
    assert.ok(await page.$eval('.obm-image-viewer img', node => {
      const rect = node.getBoundingClientRect()
      return node.complete && rect.width > 200 && rect.height > 150 &&
        rect.top >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth &&
        getComputedStyle(node).objectFit === 'contain'
    }))
    await assertFits()
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0)
    await page.screenshot({ path: resolve(output, `image-preview-${width}x${height}.png`) })
    await page.click(`${viewer} [aria-label="Tillbaka"]`)
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    assert.ok(Math.abs(await page.evaluate(() => scrollY) - scroll) < 2)
    // Keyboard activation enlarges too; opening the link screen does not save anything.
    await page.focus('.obm-image-thumb')
    await page.keyboard.press('Enter')
    await page.waitForSelector(viewer)
    await page.click(`${viewer} footer button`)
    await page.waitForSelector('dialog[aria-label="Koppla bild"]')
    assert.equal(await page.$(viewer), null)
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0)
    await page.click('dialog [aria-label="Tillbaka"]')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    await page.click('.obm-image-link')
    await page.waitForSelector('dialog[aria-label="Koppla bild"]')
    await page.click('dialog [aria-label="Tillbaka"]')
    await open()
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  }
  for (const query of ['?locked', '?queued']) {
    await fresh(query)
    await open()
    assert.equal(await page.$eval(`${viewer} footer button`, node => node.disabled), true)
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0)
    await page.click(`${viewer} [aria-label="Tillbaka"]`)
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  }
  for (const [width, height] of [[320, 820], [390, 820], [1280, 820], [820, 390]]) {
    await page.setViewport({ width, height })
    await fresh('?image-preview-nav')
    const before = await records()
    const expected = [
      { id: 'photo-1', image: 'first', alt: 'Första bilden', place: 'Plan 1 · Hall' },
      { id: 'preview-middle', image: 'middle', alt: 'Andra bilden', place: 'Plan 2 · Sovrum med ett mycket långt rumsnamn' },
      { id: 'preview-exterior', image: 'exterior', alt: 'Tredje bilden', place: 'Utsida · Fasad' },
      { id: 'preview-unplaced', image: 'unplaced', alt: 'Fjärde bilden', place: 'Plats saknas' },
    ]
    assert.deepEqual(before.images.filter(image => !image.control_item_id && image.processing_status !== 'ignored').map(image => image.id), expected.map(image => image.id))
    assert.deepEqual(await page.$$eval('.obm-image-thumb img', nodes => nodes.map(node => new URL(node.src).searchParams.get('image'))), expected.map(image => image.image))
    async function current(index) {
      await assertNavigation(index, expected.length)
      const image = expected[index]
      await page.waitForFunction(image => {
        const node = document.querySelector('dialog[aria-label="Bild"] .obm-image-viewer img')
        return node?.complete && node.naturalWidth > 0 && new URL(node.src).searchParams.get('image') === image
      }, {}, image.image)
      assert.equal(await page.$eval(`${viewer} img`, node => node.alt), image.alt)
      assert.equal(await page.$eval(`${viewer} .obm-place-label`, node => node.textContent.trim()), image.place)
      assert.equal(await page.$eval(`${viewer} footer button`, node => node.textContent.trim()), 'Koppla till notering')
      assert.equal(await page.$eval(`${viewer} footer button`, node => node.disabled), false)
      await assertFits()
    }
    // Starting from any thumbnail positions the viewer at that exact pending row.
    await open(1)
    await current(1)
    await page.screenshot({ path: resolve(output, `image-preview-navigation-${width}x${height}.png`) })
    await page.focus(previous)
    await page.keyboard.press('Enter')
    await current(0)
    await page.click(previous)
    await current(0)
    for (let index = 1; index < expected.length; index++) {
      await page.click(next)
      await current(index)
    }
    await page.click(next)
    await current(expected.length - 1)
    if (width === 390) await page.screenshot({ path: resolve(output, 'image-preview-navigation-last-390.png') })
    for (let index = expected.length - 2; index >= 0; index--) {
      await page.click(previous)
      await current(index)
    }
    if (width === 390) await page.screenshot({ path: resolve(output, 'image-preview-navigation-first-390.png') })
    await page.focus(next)
    await page.keyboard.press('Enter')
    await current(1)
    assert.deepEqual(await records(), before, 'navigation leaves images, relations, notes and rooms unchanged')
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0)
    // The footer opens the currently displayed image, not the thumbnail first opened.
    await page.click(next)
    await current(2)
    await page.click(`${viewer} footer button`)
    await page.waitForSelector(linker)
    assert.equal(await page.$(viewer), null)
    assert.equal(await page.$eval(`${linker} .obm-link-image-context img`, node => new URL(node.src).searchParams.get('image')), 'exterior')
    assert.equal(await page.$eval(`${linker} .obm-link-image-context .obm-place-label`, node => node.textContent.trim()), 'Utsida · Fasad')
    assert.deepEqual(await records(), before)
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0)
    await page.click(`${linker} [aria-label="Tillbaka"]`)
    await closed()
    await open(3)
    await current(3)
    await page.keyboard.press('Escape')
    await closed()
  }
  // Browsing local/unuploaded or locked photos remains read-only and does not disable arrows.
  await page.setViewport({ width: 390, height: 820 })
  for (const flag of ['locked', 'queued']) {
    await fresh(`?image-preview-nav&${flag}`)
    const before = await records()
    await open()
    for (let index = 0; index < 4; index++) {
      await assertNavigation(index, 4)
      assert.equal(await page.$eval(`${viewer} footer button`, node => node.disabled), true)
      if (index < 3) await page.click(next)
    }
    await page.click(previous)
    await assertNavigation(2, 4)
    assert.deepEqual(await records(), before)
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0)
    if (flag === 'queued') {
      await page.screenshot({ path: resolve(output, 'image-preview-navigation-queued-390.png') })
      await page.evaluate(() => window.__obMobileTest.completeUpload())
      await page.waitForFunction(selector => !document.querySelector(`${selector} footer button`).disabled, {}, viewer)
      await assertNavigation(2, 4)
      assert.equal(await page.$eval(`${viewer} img`, node => new URL(node.src).searchParams.get('image')), 'exterior')
    }
    await page.click(`${viewer} [aria-label="Tillbaka"]`)
    await closed()
  }
  // Committing a synthetic link after browsing targets only the currently selected photo.
  await fresh('?image-preview-nav')
  const beforeLink = await records()
  await open()
  await page.click(next)
  await assertNavigation(1, 4)
  await page.click(`${viewer} footer button`)
  await page.waitForSelector(`${linker} input[value="note-1"]`)
  assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0)
  await page.click(`${linker} input[value="note-1"]`)
  await page.click(`${linker} footer button`)
  await closed()
  assert.deepEqual((await records()).images, beforeLink.images.map(image => image.id === 'preview-middle' ? { ...image, control_item_id: 'note-1' } : image))
  assert.deepEqual(await page.evaluate(() => window.__obMobileTest.calls), [{ kind: 'link', id: 'note-1' }])
  await open(1)
  await assertNavigation(1, 3)
  assert.equal(await page.$eval(`${viewer} img`, node => new URL(node.src).searchParams.get('image')), 'exterior')
  await page.click(`${viewer} [aria-label="Tillbaka"]`)
  await closed()
  // Existing room-gallery viewers keep their single-photo behavior even with pending images.
  await fresh('?room-images')
  await page.click('nav button:first-child')
  await page.click('.obm-place-row')
  await page.click('.obm-place-images summary')
  for (const id of ['photo-1', 'room-linked']) {
    await page.click(`.obm-place-image[data-image-id="${id}"]`)
    await page.waitForSelector(viewer)
    assert.equal(await page.$(navigation), null)
    assert.equal(await page.$eval(`${viewer} footer button`, node => node.textContent.trim()), id === 'photo-1' ? 'Koppla till notering' : 'Öppna notering')
    await page.click(`${viewer} [aria-label="Tillbaka"]`)
    await closed()
  }
  assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0)
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  console.log('PASS: image enlargement, pending-image arrows/order/boundaries/current link target, unchanged records while browsing, single/locked/queued states, phone/desktop/landscape layouts, keyboard/back/Escape and unchanged place galleries. Synthetic records only.')
}
