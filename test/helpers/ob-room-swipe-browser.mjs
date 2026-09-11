import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function testRoomSwipe(page, base, output) {
  const client = await page.createCDPSession()
  const pause = ms => new Promise(ok => setTimeout(ok, ms))
  const title = () => page.$eval('.obm-room-header h1', node => node.textContent)
  async function fresh(flags = '') {
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.goto(`${base}/?swipe&room-images${flags}`, { waitUntil: 'networkidle0' })
  }
  async function hall() {
    await page.$$eval('.obm-place-row', rows => rows.find(row => row.querySelector('strong')?.textContent === 'Hall').click())
    await page.waitForSelector('.obm-room-header')
  }
  async function point(selector) {
    await page.$eval(selector, node => node.scrollIntoView({ block: 'center' }))
    return page.$eval(selector, node => {
      const box = node.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })
  }
  async function gesture(start, dx, dy = 0, duration = 220, end = 'touchEnd', multi = false) {
    if (multi || end === 'touchCancel') {
      // Exercise interruption guards without leaving emulated browser fingers active.
      await page.evaluate(({ start, dx, dy, multi }) => {
        const target = document.elementFromPoint(start.x, start.y)
        const first = new Touch({ identifier: 11, target, clientX: start.x, clientY: start.y })
        const second = new Touch({ identifier: 12, target, clientX: start.x + 16, clientY: start.y + 16 })
        const moved = new Touch({ identifier: 11, target, clientX: start.x + dx, clientY: start.y + dy })
        const send = (type, touches, changedTouches) => target.dispatchEvent(new TouchEvent(type, { bubbles: true, touches, changedTouches }))
        send('touchstart', [first], [first])
        if (multi) send('touchstart', [first, second], [second])
        send('touchmove', multi ? [moved, second] : [moved], [moved])
        if (!multi) send('touchcancel', [], [moved])
        send('touchend', [], multi ? [moved, second] : [moved])
      }, { start, dx, dy, multi })
      return
    }
    const touches = (x, y) => [{ id: 0, x, y }]
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(start.x, start.y) })
    for (let i = 1; i <= 8; i++) {
      await pause(duration / 8)
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(start.x + dx * i / 8, start.y + dy * i / 8) })
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await pause(100)
  }
  async function swipe(step, selector = '.obm-catalog .obm-section-title', options = {}) {
    const p = await point(selector)
    const dx = options.dx ?? -step * 140
    return gesture({ x: p.x - dx / 2, y: p.y }, dx, options.dy ?? 0, options.duration ?? 220, options.end ?? 'touchEnd', options.multi)
  }
  async function remainsHall(message) { assert.equal(await title(), 'Hall', message) }
  try {
    for (const width of [320, 390]) {
      await page.setViewport({ width, height: 820, isMobile: true, hasTouch: true })
      await fresh(width === 320 ? '&levels' : '')
      const before = await page.evaluate(() => ({ rooms: window.__obMobileTest.rooms, notes: window.__obMobileTest.notes, images: window.__obMobileTest.images }))
      assert.deepEqual(await page.$$eval('.obm-place-row strong', nodes => nodes.map(node => node.textContent)), ['Vardagsrum', 'Hall', 'Kök'])
      await hall()
      await swipe(1)
      assert.equal(await title(), 'Kök', 'left goes forward in the rendered list order')
      await swipe(1)
      assert.equal(await title(), 'Kök', 'last room stays on this floor without wrapping')
      await swipe(-1)
      await remainsHall('right goes back')
      await swipe(-1)
      assert.equal(await title(), 'Vardagsrum')
      await swipe(-1)
      assert.equal(await title(), 'Vardagsrum', 'first room does not wrap')
      await swipe(1)
      await remainsHall('can navigate after reaching a boundary')
      await page.reload({ waitUntil: 'networkidle0' })
      await remainsHall('last navigated room survives reload')
      for (const options of [{ dx: -35 }, { dy: 85 }, { duration: 1150 }, { multi: true }, { end: 'touchCancel' }]) {
        await swipe(1, '.obm-catalog .obm-section-title', options)
        await remainsHall(`ignored gesture: ${JSON.stringify(options)}`)
      }
      await page.$$eval('.obm-category', rows => rows.forEach(row => { row.open = true }))
      await page.evaluate(() => window.scrollTo(0, 0))
      const verticalStart = await point('.obm-catalog .obm-section-title')
      const scrollBefore = await page.evaluate(() => window.scrollY)
      await gesture(verticalStart, 3, -150)
      await remainsHall('vertical scroll does not navigate')
      assert.ok(await page.evaluate(() => window.scrollY) > scrollBefore, 'native vertical scrolling still works')
      await page.$$eval('.obm-category', rows => rows.forEach(row => { row.open = false }))
      await swipe(1, '[data-note-id="note-1"] > span')
      assert.equal(await title(), 'Kök', 'swiping a note row navigates instead of opening the note')
      assert.equal(await page.$('dialog[open]'), null)
      await swipe(-1)
      await page.screenshot({ path: resolve(output, `room-swipe-${width}.png`) })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      assert.deepEqual(await page.evaluate(() => ({ rooms: window.__obMobileTest.rooms, notes: window.__obMobileTest.notes, images: window.__obMobileTest.images })), before)
      assert.deepEqual(await page.evaluate(() => window.__obMobileTest.calls), [], 'navigation performs no inspection writes')
    }

    await fresh()
    await hall()
    await swipe(1, '[aria-label="Sök notering"]')
    await remainsHall('swiping a text field does not navigate')
    await page.focus('[aria-label="Sök notering"]')
    await swipe(1)
    await remainsHall('focused text field prevents room changes')
    await page.evaluate(() => document.activeElement.blur())
    await swipe(1, '.obm-room-actions .obm-primary')
    await remainsHall('action buttons do not trigger navigation')
    await page.click('.obm-place-images summary')
    const photo = '.obm-place-image[data-image-id="photo-1"]'
    await gesture(await point(photo), 90)
    await remainsHall('gallery swipes do not change room')
    await page.click(photo)
    await page.waitForSelector('dialog[open]')
    await swipe(1, 'dialog .obm-place-label')
    await remainsHall('image dialog swipes do not change room')
    await page.click('dialog [aria-label="Tillbaka"]')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    const notePoint = await point('[data-note-id="note-1"]')
    await page.touchscreen.tap(notePoint.x, notePoint.y)
    await page.waitForSelector('dialog[aria-label="Notering"]')
    await swipe(1, 'dialog .obm-place-label')
    await remainsHall('note editor swipes do not change underlying room')
    await page.click('dialog [aria-label="Tillbaka"]')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))

    // A normal mouse drag is not a touch swipe, including on desktop.
    await page.setViewport({ width: 1280, height: 820, hasTouch: false, isMobile: false })
    const mouse = await point('.obm-catalog .obm-section-title')
    await page.mouse.move(mouse.x + 100, mouse.y)
    await page.mouse.down()
    await page.mouse.move(mouse.x - 100, mouse.y, { steps: 8 })
    await page.mouse.up()
    await remainsHall('mouse dragging is unchanged')

    await page.setViewport({ width: 390, height: 820, isMobile: true, hasTouch: true })
    await fresh()
    await swipe(1, '.obm-page-header')
    assert.ok(await page.$('[data-view="places"]'), 'swiping main views has no effect')
    await page.select('select[aria-label="Plan"]', 'plan2')
    await page.click('.obm-place-row')
    const onlyRoom = await title()
    await swipe(1)
    await swipe(-1)
    assert.equal(await title(), onlyRoom, 'a floor with only one room never leaves that floor')
    await page.click('[aria-label="Till platser"]')
    await page.$$eval('.obm-segment button', rows => rows.find(row => row.textContent.trim() === 'Utsida').click())
    await page.click('.obm-place-row')
    await swipe(1)
    assert.equal(await title(), 'Fasad', 'exterior views do not use room swiping')
    assert.deepEqual(await page.evaluate(() => window.__obMobileTest.calls), [])
    console.log('PASS: real touch swipes, shared floor order/boundaries, vertical scroll, gesture guards, image/editor isolation, mouse behavior, and no inspection writes.')
  } finally {
    await client.detach()
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.setViewport({ width: 390, height: 820, isMobile: false, hasTouch: false })
  }
}
