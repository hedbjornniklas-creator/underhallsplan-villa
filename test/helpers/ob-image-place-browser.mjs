import assert from 'node:assert/strict'
import { resolve } from 'node:path'

// Production mobile UI with synthetic callbacks only; no live inspection writes.
export async function testImagePlace(page, base, output) {
  const sheet = 'dialog[aria-label="Koppla bild"][open]'
  const panel = '#image-note-panel-new'
  const createButton = `${sheet} footer .obm-primary`
  const control = label => `${panel} [aria-label="${label}"]`
  const closed = () => page.waitForFunction(() => !document.querySelector('dialog[open]'))
  async function click(text, parent = sheet) {
    for (const button of await page.$$(`${parent} button`)) {
      if (await button.evaluate(node => node.textContent.trim()) === text) {
        await button.click()
        return
      }
    }
    throw Error(`Missing button: ${text}`)
  }
  async function fresh(query = '?image-place') {
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.goto(base + query, { waitUntil: 'networkidle0' })
    // The active room is deliberately Hall, but must not become an unplaced photo's default.
    await page.click('nav button:last-child')
    await page.click('.obm-image-link')
    await page.waitForSelector(sheet)
    await click('Ny notering')
    await page.waitForSelector(control('Område'))
    await page.waitForSelector(control('Ny notering'))
  }
  async function fill(label, text) {
    await page.click(control(label))
    await page.keyboard.down('Control')
    await page.keyboard.press('A')
    await page.keyboard.up('Control')
    await page.type(control(label), text)
  }
  const readDraft = () => page.$$eval(`${panel} textarea`, rows => rows.map(row => row.value))
  const imageSnapshot = () => page.evaluate(() => window.__obMobileTest.images)
  const dataSnapshot = () => page.evaluate(() => ({ images: window.__obMobileTest.images, notes: window.__obMobileTest.notes }))
  async function chooseRoom(roomId) {
    await page.select(control('Område'), 'interior')
    await page.select(control('Plan'), roomId === 'room-2' ? 'plan2' : 'plan1')
    await page.select(control('Rum'), roomId)
  }
  async function chooseExterior(exteriorItemId = 'exterior-2') {
    await page.select(control('Område'), 'exterior')
    await page.select(control('Byggnadsdel'), exteriorItemId)
  }
  async function ready() {
    await page.waitForFunction(selector => !document.querySelector(selector)?.disabled, {}, createButton)
  }
  async function previewStarted(key) {
    await page.waitForFunction(expected => window.__obMobileTest.calls.some(call => call.kind === 'image-preview' && call.patch.key === expected), {}, key)
  }
  async function previewSettled(key) {
    await page.waitForFunction(expected => window.__obMobileTest.calls.some(call => call.kind === 'image-preview-settled' && call.patch.key === expected), {}, key)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }
  async function assertPending() {
    assert.equal(await page.$eval('nav button:last-child', node => node.getAttribute('aria-current')), 'page', 'the pending workspace stays selected')
    assert.ok(await page.$('.obm-image-row'), 'uncommitted photo remains in Att bearbeta')
  }
  async function assertCreated(text, target) {
    await closed()
    const result = await page.evaluate(expectedText => {
      const qa = window.__obMobileTest
      return {
        created: qa.notes.filter(row => row.note === expectedText),
        image: qa.images[0],
        request: qa.calls.filter(row => row.kind === 'image-note-request').at(-1).patch,
      }
    }, text)
    assert.equal(result.created.length, 1)
    const created = result.created[0]
    assert.equal(result.image.control_item_id, created.id)
    assert.equal(result.image.interior_room_id, created.interior_room_id)
    assert.equal(result.image.exterior_observation_id, created.exterior_observation_id)
    assert.equal(result.image.processing_status, 'linked')
    if (target.area === 'interior') {
      assert.equal(created.interior_room_id, target.roomId)
      assert.equal(created.exterior_observation_id, null)
    } else {
      assert.equal(created.interior_room_id, null)
      assert.equal(created.exterior_observation_id, target.observationId ?? (target.exteriorItemId === 'exterior-2' ? 'observation-2' : 'observation-1'))
    }
    assert.equal(await page.$('.obm-image-row'), null, 'linked photo leaves the pending list')
    assert.equal(await page.$eval('nav button:last-child', node => node.getAttribute('aria-current')), 'page', 'creating must not navigate to a room')
    return result
  }

  // Missing location is an explicit choice. Typing alone must never select the active room.
  for (const width of [320, 390, 1280]) {
    await page.setViewport({ width, height: 820 })
    await fresh()
    const original = await dataSnapshot()
    await fill('Ny notering', 'Utkast innan val av plats')
    assert.equal(await page.$eval(createButton, node => node.disabled), true)
    assert.equal(await page.$eval(control('Område'), node => node.value), '')
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.some(call => call.kind === 'image-note')), false)
    await assertPending()
    await chooseRoom('room-2')
    await ready()
    const interiorDraft = await readDraft()
    await chooseExterior()
    await ready()
    assert.deepEqual(await readDraft(), interiorDraft, 'changing area preserves the draft')
    assert.deepEqual(await dataSnapshot(), original, 'previewing another location must not move/link the image or create a note')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.ok(await page.$$eval('.obm-sheet,.obm-sheet-body', rows => rows.every(row => row.scrollWidth <= row.clientWidth + 1)))
    await page.screenshot({ path: resolve(output, `image-note-place-${width}.png`) })
    await page.click(`${sheet} [aria-label="Tillbaka"]`)
    await closed()
    assert.deepEqual(await dataSnapshot(), original, 'cancel discards only the local choice and draft')
    await assertPending()
  }

  await page.setViewport({ width: 390, height: 820 })
  await fresh()
  await fill('Ny notering', 'Invändig notering från platslös bild')
  await chooseRoom('room-2')
  await ready()
  await click('Skapa och koppla', `${sheet} footer`)
  const interior = await assertCreated('Invändig notering från platslös bild', { area: 'interior', roomId: 'room-2' })
  assert.deepEqual(interior.request.target, { area: 'interior', roomId: 'room-2' })

  await fresh()
  await chooseExterior()
  await fill('Sök noteringsförslag', 'plåt')
  await page.waitForSelector('[data-new-outcome-id="outcome-1"]')
  await page.click('[data-new-outcome-id="outcome-1"]')
  await fill('Ny notering', 'Utvändig katalognotering från bild')
  await page.click(`${panel} details summary`)
  await fill('Ny risktext', 'Risktext från utkast')
  await fill('Ny utredningstext', 'Utredning från utkast')
  const catalogDraft = await readDraft()
  await chooseRoom('room-1')
  await chooseExterior()
  await click('Befintlig notering')
  await click('Ny notering')
  assert.deepEqual(await readDraft(), catalogDraft, 'place and tab changes preserve all three draft fields')
  await ready()
  await click('Skapa och koppla', `${sheet} footer`)
  const exterior = await assertCreated('Utvändig katalognotering från bild', { area: 'exterior', exteriorItemId: 'exterior-2' })
  assert.deepEqual(exterior.request.target, { area: 'exterior', exteriorItemId: 'exterior-2' })
  assert.equal(exterior.created[0].selected_outcome_id, 'outcome-1')
  assert.equal(exterior.created[0].risk_text, catalogDraft[1])
  assert.equal(exterior.created[0].ftu_text, catalogDraft[2])

  // Current and original image location remain valid defaults, independent of the active room.
  for (const [query, target] of [
    ['', { area: 'interior', roomId: 'room-1' }],
    ['?image-origin', { area: 'interior', roomId: 'room-2' }],
    ['?image-origin-exterior', { area: 'exterior', exteriorItemId: 'exterior-1', observationId: 'observation-extra' }],
  ]) {
    await fresh(query)
    const text = `Befintlig bildplats ${query || 'current'}`
    await fill('Ny notering', text)
    await ready()
    assert.equal(await page.$eval(control('Område'), node => node.value), target.area)
    assert.equal(await page.$eval(control(target.area === 'interior' ? 'Rum' : 'Byggnadsdel'), node => node.value), target.roomId ?? target.exteriorItemId)
    await click('Skapa och koppla', `${sheet} footer`)
    await assertCreated(text, target)
  }

  // A held preview must disable create immediately, and late older responses must not win.
  await fresh()
  const beforePreviews = await imageSnapshot()
  await fill('Ny notering', 'Senaste platsvalet gäller')
  await page.evaluate(() => { window.__obMobileTest.holdImagePreviews = ['room-1', 'room-2'] })
  await chooseRoom('room-1')
  await previewStarted('room-1')
  assert.equal(await page.$eval(createButton, node => node.disabled), true)
  await chooseRoom('room-2')
  await previewStarted('room-2')
  await page.evaluate(() => { window.__obMobileTest.holdImagePreviews = ['room-1'] })
  await previewSettled('room-2')
  await ready()
  await page.evaluate(() => { window.__obMobileTest.holdImagePreviews = [] })
  await previewSettled('room-1')
  assert.equal(await page.$eval(control('Rum'), node => node.value), 'room-2')
  assert.deepEqual(await imageSnapshot(), beforePreviews)
  await click('Skapa och koppla', `${sheet} footer`)
  await assertCreated('Senaste platsvalet gäller', { area: 'interior', roomId: 'room-2' })

  // Change away from an already-valid token; it must not remain usable while checking.
  await fresh()
  await fill('Ny notering', 'Ny plats kräver ny förhandskontroll')
  await chooseRoom('room-1')
  await ready()
  await page.evaluate(() => { window.__obMobileTest.holdImagePreviews = ['exterior-2'] })
  await chooseExterior()
  await previewStarted('exterior-2')
  assert.equal(await page.$eval(createButton, node => node.disabled), true)
  await page.click(createButton)
  assert.equal(await page.evaluate(() => window.__obMobileTest.calls.some(call => call.kind === 'image-note')), false)
  await page.evaluate(() => { window.__obMobileTest.holdImagePreviews = [] })
  await previewSettled('exterior-2')
  await ready()
  await click('Skapa och koppla', `${sheet} footer`)
  await assertCreated('Ny plats kräver ny förhandskontroll', { area: 'exterior', exteriorItemId: 'exterior-2' })

  // Both preview errors and failed creation retain text and allow an explicit retry.
  await fresh()
  const beforeFailure = await dataSnapshot()
  await fill('Ny notering', 'Utkastet överlever fel och återförsök')
  await page.evaluate(() => { window.__obMobileTest.failImagePreview = true })
  await chooseRoom('room-2')
  await page.waitForFunction(() => document.querySelector('#image-note-panel-new')?.textContent.includes('Synthetic image preview failure'))
  assert.equal(await page.$eval(createButton, node => node.disabled), true)
  assert.equal(await page.$eval(control('Ny notering'), node => node.value), 'Utkastet överlever fel och återförsök')
  await page.evaluate(() => { window.__obMobileTest.failImagePreview = false })
  await click('Kontrollera platsen igen')
  await ready()
  await page.evaluate(() => { window.__obMobileTest.failImageCreate = true })
  await click('Skapa och koppla', `${sheet} footer`)
  await page.waitForFunction(() => document.querySelector('dialog[open]')?.textContent.includes('Synthetic image note failure'))
  await ready()
  assert.deepEqual(await dataSnapshot(), beforeFailure)
  assert.equal(await page.$eval(control('Ny notering'), node => node.value), 'Utkastet överlever fel och återförsök')
  await page.evaluate(() => { window.__obMobileTest.failImageCreate = false })
  await click('Skapa och koppla', `${sheet} footer`)
  await assertCreated('Utkastet överlever fel och återförsök', { area: 'interior', roomId: 'room-2' })
  assert.equal(await page.evaluate(() => new Set(window.__obMobileTest.calls.filter(call => call.kind === 'image-note').map(call => call.id)).size), 1, 'unchanged retry keeps its idempotency key')
  console.log('PASS: image-note place selection: missing/current/original locations, interior/exterior creation, no navigation or premature image moves, cancel, draft/catalog preservation, stale/pending previews, failure/retry and 320-1280px layouts.')
}
