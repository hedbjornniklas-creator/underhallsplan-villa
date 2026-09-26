import assert from 'node:assert/strict'
import { resolve } from 'node:path'

const query = 'fukt tr\u00e4'
const result = id => `[data-outcome-id="${id}"]`
const action = id => `${result(id)} > .obm-icon`

export async function testSearchOrder(page, base, output) {
  async function clickText(text) {
    for (const button of await page.$$('button')) {
      if (await button.evaluate((el, text) => el.textContent.trim() === text, text)) {
        await button.click()
        return
      }
    }
    throw Error(`Missing button: ${text}`)
  }
  async function fresh({ area = 'interior', extra = false, locked = false } = {}) {
    await page.goto(base)
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.goto(`${base}/?search-order&strict${extra ? '&extra-building' : ''}${locked ? '&locked' : ''}`)
    await page.waitForSelector('.obm-place-row')
    if (area === 'exterior') await clickText('Utsida')
    await page.click('.obm-place-row')
    await page.type('[aria-label="S\u00f6k notering"]', query)
    await page.waitForSelector(result('search-local-0'))
  }
  const records = () => page.evaluate(() => JSON.stringify({
    notes: window.__obMobileTest.notes,
    images: window.__obMobileTest.images,
    calls: window.__obMobileTest.calls,
  }))
  async function returnToPlace(area = 'interior') {
    const before = await records()
    await clickText('Denna plats')
    await page.waitForFunction(() => document.querySelector('[aria-label="S\u00f6k notering"]').value === '')
    assert.equal(await page.$eval('.obm-search-scope [aria-pressed="true"]', el => el.textContent.trim()), 'Denna plats')
    assert.equal(await page.$eval('.obm-catalog h2', el => el.textContent), 'Noteringsf\u00f6rslag')
    assert.ok(await page.$('.obm-category'), 'room suggestions return to their usual groups')
    assert.ok(await page.$(`[data-note-id="${area === 'interior' ? 'note-1' : 'outside-note'}"]`), 'saved notes return')
    assert.equal(await page.$eval('.obm-place-images h2', el => el.textContent), area === 'interior' ? 'Bilder i rummet' : 'Bilder p\u00e5 platsen')
    assert.ok(await page.$(result('search-local-0')))
    assert.equal(await page.$(result('search-other-0')), null, 'unrelated suggestions are hidden again')
    assert.equal(await records(), before, 'returning changes no notes, images or persistence calls')
    await assertFocus('.obm-search-scope [aria-pressed="true"]')
  }
  async function snapshot(id) {
    return page.evaluate(id => {
      const row = document.querySelector(`[data-outcome-id="${id}"]`)
      return {
        ids: [...document.querySelectorAll('.obm-result')].map(el => el.dataset.outcomeId),
        top: row.getBoundingClientRect().top,
        height: row.getBoundingClientRect().height,
        scroll: scrollY,
        query: document.querySelector('[aria-label="S\u00f6k notering"]').value,
        scope: document.querySelector('.obm-search-scope [aria-pressed="true"]').textContent,
      }
    }, id)
  }
  async function unchanged(before, id, allowErrorAnchoring = false) {
    const after = await snapshot(id)
    assert.deepEqual(after.ids, before.ids, 'adding must not reorder the selected outcome or its siblings')
    assert.equal(after.query, before.query)
    assert.equal(after.scope, before.scope)
    // An existing inline save error can change scrollY via browser anchoring,
    // but the result must still occupy exactly the same viewport position.
    for (const key of allowErrorAnchoring ? ['top', 'height'] : ['top', 'height', 'scroll']) {
      assert.ok(Math.abs(after[key] - before[key]) <= 1, `${key} changed from ${before[key]} to ${after[key]}`)
    }
  }
  async function position(id) {
    await page.$eval(result(id), el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
    return snapshot(id)
  }
  async function added(id) {
    await page.waitForSelector(`${result(id)} .obm-added:not(:disabled):not([aria-disabled="true"])`)
  }
  async function closed() {
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  }
  async function assertFocus(selector) {
    assert.equal(await page.$eval(selector, el => el === document.activeElement), true, 'focus stays with the result')
  }

  for (const width of [390, 1280]) {
    await page.setViewport({ width, height: 844 })
    for (const area of ['interior', 'exterior']) {
      for (const extra of [false, true]) {
        await fresh({ area, extra })
        const id = 'search-remote-0'
        const before = await position(id)
        assert.ok(before.scroll > 0, 'exercise a result below the first viewport')
        assert.equal(before.ids.length, 16)
        await page.click(action(id))
        await added(id)
        await unchanged(before, id)
        await assertFocus(action(id))
        assert.equal(await page.$('dialog[open]'), null, 'adding does not open an editor')

        await page.click(`${result(id)} .obm-result-text`)
        await page.waitForSelector('dialog[aria-label="Notering"][open] textarea')
        await page.click('dialog textarea')
        await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control')
        await page.type('dialog textarea', 'Justerad sparad notering')
        await page.click('dialog [aria-label="Tillbaka"]')
        await closed()
        await unchanged(before, id)
        await assertFocus(`${result(id)} .obm-result-text`)

        await page.click(action(id))
        await page.waitForSelector('dialog[aria-label="Notering"][open] textarea')
        assert.equal(await page.$eval('dialog textarea', el => el.value), 'Justerad sparad notering', 'check opens the saved note, not the template')
        await page.click('dialog [aria-label="Tillbaka"]')
        await closed()
        await unchanged(before, id)
        await assertFocus(action(id))
        assert.equal(await page.evaluate(id => window.__obMobileTest.notes.filter(note => note.selected_outcome_id === id).length, id), 1)

        const sibling = 'search-remote-1'
        const beforeSibling = await position(sibling)
        await page.click(action(sibling))
        await added(sibling)
        await unchanged(beforeSibling, sibling)
        assert.equal(await page.evaluate(() => window.__obMobileTest.calls.filter(call => call.kind === 'create').length), 2)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        await page.screenshot({ path: resolve(output, `search-stable-${width}-${area}-${extra ? 'extra' : 'main'}-all.png`) })
        await returnToPlace(area)
        assert.equal(await page.$('[aria-label="Rensa s\u00f6kning"]'), null)
        assert.equal(await page.$$eval('.obm-result', nodes => nodes.length), 14, 'local suggestions include the point already used here')
        await page.screenshot({ path: resolve(output, `search-return-${width}-${area}-${extra ? 'extra' : 'main'}.png`) })

        const afterReturn = await records()
        await page.type('[aria-label="S\u00f6k notering"]', query)
        await page.waitForSelector(result('search-other-0'))
        assert.equal(await page.$eval('.obm-search-scope [aria-pressed="true"]', el => el.textContent.trim()), 'Hela biblioteket')
        assert.equal(await page.$$eval('.obm-result', nodes => nodes.length), 16)
        assert.ok(await page.$(`${result(id)} .obm-added`), 'saved result stays checked in a new search')
        assert.equal(await page.$('.obm-place-images'), null)
        assert.equal(await records(), afterReturn)
        console.log(`PASS: stable search and return to place, ${width}px, ${area}, ${extra ? 'extra' : 'main'} building`)
      }
    }
  }

  await fresh()
  const id = 'search-remote-0'
  const before = await position(id)
  await page.evaluate(() => { window.__obMobileTest.holdAdds = true })
  await page.click(action(id))
  await page.waitForFunction(() => window.__obMobileTest.calls.some(call => call.kind === 'add-outcome'))
  await page.click(action(id))
  await unchanged(before, id)
  await assertFocus(action(id))
  assert.equal(await page.evaluate(() => window.__obMobileTest.calls.filter(call => call.kind === 'add-outcome').length), 1, 'slow add cannot be duplicated')
  await page.evaluate(() => { window.__obMobileTest.holdAdds = false; window.__obMobileTest.failAdds = true })
  await page.waitForFunction(id => document.querySelector(`[data-outcome-id="${id}"] > .obm-icon`).getAttribute('aria-disabled') === 'false' && document.body.textContent.includes('Synthetic add failure'), {}, id)
  await unchanged(before, id, true)
  await assertFocus(action(id))
  assert.equal(await page.$(`${result(id)} .obm-added`), null)
  assert.equal(await page.evaluate(() => window.__obMobileTest.calls.filter(call => call.kind === 'create').length), 0)
  await page.evaluate(() => { window.__obMobileTest.failAdds = false })
  await page.click(action(id))
  await added(id)
  await unchanged(before, id)

  await fresh({ locked: true })
  assert.equal(await page.$eval(action(id), el => el.disabled), true)
  await page.click(`${result(id)} .obm-result-text`)
  await page.waitForSelector('dialog[aria-label="Noteringsf\u00f6rslag"][open]')
  assert.equal(await page.$eval('dialog footer button', el => el.disabled), true)
  assert.equal(await page.evaluate(() => window.__obMobileTest.calls.filter(call => call.kind === 'create').length), 0)
  await page.click('dialog [aria-label="Tillbaka"]')
  await closed()
  await returnToPlace()
  assert.equal(await page.$$eval('.obm-result', nodes => nodes.length), 12, 'no unused control points enter the local library')

  // An empty result set must also offer a way back, without changing records.
  await fresh()
  await page.type('[aria-label="S\u00f6k notering"]', ' qzxnomatch')
  await page.waitForFunction(() => document.querySelectorAll('.obm-result').length === 0)
  await returnToPlace()
  await returnToPlace()

  // Group order must also be independent of saved outcomes when no query is entered.
  await fresh()
  await page.click('[aria-label="S\u00f6k notering"]')
  await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace')
  const groups = () => page.$$eval('.obm-category summary > span', nodes => nodes.map(el => el.textContent))
  const beforeGroups = await groups()
  await page.$eval(result(id), el => { el.closest('details').open = true })
  await page.click(action(id))
  await added(id)
  assert.deepEqual(await groups(), beforeGroups)
  await clickText('Denna plats')
  assert.ok(await page.$(result('search-remote-1')), 'local scope still includes the control point already used here')
  assert.equal(await page.$(result('search-other-0')), null)
  console.log('PASS: stable search, direct edit/back, slow/failed saves and locks; Denna plats clears search and restores local notes/images/groups without writes; new searches reopen the full library.')
}
