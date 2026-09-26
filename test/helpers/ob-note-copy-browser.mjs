import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function testNoteCopy(page, base, output) {
  const editor = 'dialog[aria-label="Notering"][open]'
  const row = '[data-outcome-id="outcome-1"]'
  const saved = () => page.evaluate(() => window.__obMobileTest.notes.find(note => note.selected_outcome_id === 'outcome-1'))
  const text = note => ({ note: note.note, risk_text: note.risk_text, ftu_text: note.ftu_text })
  async function close() {
    await page.click(`${editor} [aria-label="Tillbaka"]`)
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  }
  async function openSaved(id) {
    await page.click('.obm-bottom-nav button:nth-child(2)')
    await page.waitForSelector(`[data-note-id="${id}"]`)
    await page.click(`[data-note-id="${id}"]`)
    await page.waitForSelector(`${editor} textarea`)
  }
  async function editorText() {
    const values = await page.$$eval(`${editor} textarea`, nodes => nodes.map(node => node.value))
    return { note: values[0], risk_text: values[1], ftu_text: values[2] }
  }
  for (const width of [390, 1280]) {
    await page.setViewport({ width, height: 844 })
    for (const extra of [false, true]) {
      for (const filled of [false, true]) {
        await page.goto(base)
        await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
        const query = `?strict${extra ? '&extra-building' : ''}${filled ? '&filled-template' : ''}`
        await page.goto(base + '/' + query, { waitUntil: 'networkidle0' })
        await page.click('.obm-place-row')
        await page.type('[aria-label="S\u00f6k notering"]', 'metallfasad')
        await page.waitForSelector(row)
        await page.click(`${row} > .obm-icon`)
        await page.waitForFunction(() => window.__obMobileTest.notes.some(note => note.selected_outcome_id === 'outcome-1'))
        const original = await saved()
        assert.deepEqual(text(original), {
          note: 'Skada noterades i fasad av st\u00e5l.',
          risk_text: filled ? 'Risk vid skapandet' : '',
          ftu_text: filled ? 'FTU vid skapandet' : '',
        })

        // Same origin and persisted inspection, but the catalogue changes on reload.
        await page.goto(base + '/' + query + '&changed-template', { waitUntil: 'networkidle0' })
        await openSaved(original.id)
        assert.deepEqual(await editorText(), text(original))
        assert.deepEqual(await saved(), original)
        assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0, 'opening/reloading never backfills note text')
        await page.screenshot({ path: resolve(output, `note-copy-${width}-${extra ? 'extra' : 'main'}-${filled ? 'filled' : 'empty'}.png`) })

        if (filled) {
          const fields = await page.$$(`${editor} textarea`)
          for (const field of fields.slice(1, 3)) {
            await field.click()
            await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control')
            await page.keyboard.press('Backspace')
          }
          await close()
          assert.deepEqual(text(await saved()), { note: original.note, risk_text: '', ftu_text: '' })
        } else await close()
        await page.goto(base + '/' + query + '&changed-template&retired-template', { waitUntil: 'networkidle0' })
        await openSaved(original.id)
        assert.deepEqual(await editorText(), { note: original.note, risk_text: '', ftu_text: '' }, 'retirement and reload preserve saved text and intentionally empty fields')
        assert.equal(await page.evaluate(() => window.__obMobileTest.calls.length), 0)
        await close()
      }
    }
  }
  console.log('PASS: note copies survive changed/retired templates, clear/autosave/reload, mobile/desktop and main/extra buildings. Synthetic records only.')
}
