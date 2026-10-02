import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function testStatusRound(page, base, output) {
  const editor = 'dialog[aria-label="Notering"][open]'
  async function fresh(query) {
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.goto(`${base}/?${query}`, { waitUntil: 'networkidle0' })
  }
  async function openNote(id = 'note-1') {
    if (await page.$('.obm-place-row')) await page.click('.obm-place-row')
    await page.click('.obm-bottom-nav button:nth-child(2)')
    await page.waitForSelector(`[data-note-id="${id}"]`)
    await page.click(`[data-note-id="${id}"]`)
    await page.waitForSelector(`${editor} textarea`)
  }
  async function fill(index, value) {
    const field = (await page.$$(`${editor} textarea`))[index]
    await field.click()
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control')
    await field.type(value)
  }
  async function close() {
    await page.click(`${editor} [aria-label="Tillbaka"]`)
    await page.waitForSelector(editor, { hidden: true })
  }
  const values = () => page.$$eval(`${editor} textarea`, nodes => nodes.map(node => node.value))
  const labels = () => page.$$eval(`${editor} .obm-field`, nodes => nodes.map(node => node.childNodes[0].textContent.trim()))
  const saved = id => page.evaluate(id => window.__obMobileTest.notes.find(note => note.id === id), id)

  for (const width of [390, 1280]) {
    await page.setViewport({ width, height: 900 })
    await fresh('status&filled-template')
    await page.waitForSelector('.ob-inspection-header')
    assert.match(await page.$eval('.ob-inspection-header', node => node.textContent), /Statusbesiktning/)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await openNote()
    assert.deepEqual(await labels(), ['Notering', 'Rekommendation', 'Övriga kommentarer'])
    assert.doesNotMatch(await page.$eval(editor, node => node.textContent), /Risk och fortsatt|Fortsatt teknisk utredning|Föreslå till biblioteket/)
    assert.deepEqual(await values(), ['Spricka vid dörr.', '', ''])
    await page.click(`${editor} details summary`)
    const recommendation = `Manuell rekommendation ${width}`
    const comment = `Manuell övrig kommentar ${width}`
    await fill(1, recommendation)
    await fill(2, comment)
    await page.waitForFunction((recommendation, comment) => {
      const row = window.__obMobileTest.notes.find(note => note.id === 'note-1')
      return row.recommendation_text === recommendation && row.comment_text === comment && !window.__obMobileTest.hasDrafts()
    }, {}, recommendation, comment)
    const persisted = await saved('note-1')
    assert.equal(persisted.risk_text, 'Äldre OB-risk ska bevaras, inte omtolkas.')
    assert.equal(persisted.ftu_text, 'Äldre OB-FTU ska bevaras, inte omtolkas.')
    const saves = await page.evaluate(() => window.__obMobileTest.calls.filter(call => call.kind === 'save'))
    assert.ok(saves.length > 0)
    assert.ok(saves.every(call => !Object.hasOwn(call.patch, 'risk_text') && !Object.hasOwn(call.patch, 'ftu_text')))
    assert.equal(await page.$eval(editor, node => node.scrollWidth > node.clientWidth), false)
    await page.screenshot({ path: resolve(output, `status-editor-${width}.png`) })
    await close()
    await page.screenshot({ path: resolve(output, `status-notes-${width}.png`) })

    await page.goto(`${base}/?status&filled-template`, { waitUntil: 'networkidle0' })
    await openNote()
    assert.deepEqual(await values(), ['Spricka vid dörr.', recommendation, comment], 'saved manual STB fields survive reload')
    assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0, 'reading never converts older OB risk/FTU')

    // Failed writes keep all manual text local and prevent closing the editor.
    await page.evaluate(() => { window.__obMobileTest.failSaves = true })
    const localRecommendation = `Lokalt utkast ${width}`
    await fill(1, localRecommendation)
    await page.waitForSelector(`${editor} [role="alert"]`)
    await page.click(`${editor} [aria-label="Tillbaka"]`)
    await page.waitForFunction(() => window.__obMobileTest.hasDrafts())
    assert.ok(await page.$(editor))
    assert.equal((await saved('note-1')).recommendation_text, recommendation)
    await page.screenshot({ path: resolve(output, `status-draft-guard-${width}.png`) })
    await page.evaluate(() => { window.__obMobileTest.failSaves = false })
    await page.click(`${editor} [role="alert"] button`)
    await page.waitForFunction(value => window.__obMobileTest.notes.find(note => note.id === 'note-1').recommendation_text === value && !window.__obMobileTest.hasDrafts(), {}, localRecommendation)
    await close()

    // Existing catalogue is selectable, but only its observation is copied for STB.
    await page.click('.obm-bottom-nav button:nth-child(1)')
    await page.click('.obm-place-row')
    await page.type('[aria-label="Sök notering"]', 'metallfasad')
    await page.waitForSelector('[data-outcome-id="outcome-1"]')
    assert.doesNotMatch(await page.$eval('[data-outcome-id="outcome-1"]', node => node.textContent), /Risk vid skapandet|FTU vid skapandet/)
    await page.click('[data-outcome-id="outcome-1"] > .obm-icon')
    await page.waitForFunction(() => window.__obMobileTest.notes.some(note => note.selected_outcome_id === 'outcome-1'))
    const copied = await page.evaluate(() => window.__obMobileTest.notes.find(note => note.selected_outcome_id === 'outcome-1'))
    assert.deepEqual({ note: copied.note, risk: copied.risk_text, ftu: copied.ftu_text, recommendation: copied.recommendation_text, comment: copied.comment_text },
      { note: 'Skada noterades i fasad av stål.', risk: '', ftu: '', recommendation: '', comment: '' })
    await page.screenshot({ path: resolve(output, `status-catalogue-${width}.png`) })
    await page.goto(`${base}/?status&changed-template`, { waitUntil: 'networkidle0' })
    await openNote()
    assert.deepEqual(await values(), ['Spricka vid dörr.', localRecommendation, comment], 'changed catalogue cannot replace manual recommendations/comments')
    await close()
    await openNote(copied.id)
    assert.deepEqual(await values(), ['Skada noterades i fasad av stål.', '', ''])
    await close()
  }

  await fresh('filled-template')
  await openNote()
  assert.deepEqual(await labels(), ['Notering', 'Risk', 'Fortsatt teknisk utredning'], 'ordinary OB retains its editor semantics')
  await close()
  await page.click('.obm-bottom-nav button:nth-child(1)')
  await page.click('.obm-place-row')
  await page.type('[aria-label="Sök notering"]', 'metallfasad')
  await page.waitForSelector('[data-outcome-id="outcome-1"]')
  await page.click('[data-outcome-id="outcome-1"] > .obm-icon')
  await page.waitForFunction(() => window.__obMobileTest.notes.some(note => note.selected_outcome_id === 'outcome-1'))
  const ob = await page.evaluate(() => window.__obMobileTest.notes.find(note => note.selected_outcome_id === 'outcome-1'))
  assert.equal(ob.risk_text, 'Risk vid skapandet')
  assert.equal(ob.ftu_text, 'FTU vid skapandet')
  console.log('PASS: STB manual recommendations/comments save and survive reload, failures retain drafts and block close, catalogue copies only observations without touching manual fields; OB risk/FTU unchanged. Mobile+desktop synthetic records only.')
}
