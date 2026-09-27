import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testDocumentLayout(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = [], external = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (request.url().startsWith('data:') || new URL(request.url()).origin === base) void request.continue()
    else { external.push(request.url()); void request.abort() }
  })
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const visibleNote = async () => (await page.evaluateHandle(() => [...document.querySelectorAll('.ob-document-note')].find(node => node.checkVisibility()))).asElement()
  const measure = node => ({ height: node.getBoundingClientRect().height, top: node.getBoundingClientRect().top,
    scroll: window.scrollY, pageHeight: document.documentElement.scrollHeight, focused: document.activeElement === node,
    value: node.value, selection: node.selectionStart, fits: node.scrollHeight <= node.clientHeight + 1 })
  const longNote = 'Kontrollerad handling.\nUnderlaget omfattar ritningar och kompletterande uppgifter.\nNoteringen ska visas i sin helhet utan att sparandet flyttar sidan.'
  try {
    for (const width of [320, 390, 768, 1280, 1920]) {
      await page.setViewport({ width, height: 900, isMobile: width < 768, hasTouch: width < 768 })
      await page.goto(base + '/round?section=documents&documents-density', { waitUntil: 'networkidle0' })
      await page.waitForSelector('.ob-document-note')
      await page.evaluate(async () => { localStorage.clear(); await document.fonts.ready; window.__obFormTest.saveDelay = 650 })
      const note = await visibleNote()
      const initial = await note.evaluate(measure)
      assert.equal(initial.height, width < 768 ? 48 : 44, `${width}: empty notes are one control high`)
      assert.equal(await note.evaluate(node => node.rows), 1)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      assert.equal(await page.$eval('.ob-documents-workspace h2', node => getComputedStyle(node).fontSize), width < 768 ? '18px' : '16px')
      if (width >= 768) {
        const heights = await page.$$eval('.ob-document-table tbody tr', rows => rows.map(row => row.getBoundingClientRect().height))
        assert.ok(heights.every(height => height >= 56 && height <= 58), JSON.stringify(heights))
      }
      await page.screenshot({ path: resolve(output, `documents-compact-${width}.png`) })
      await note.click()
      await note.type(longNote)
      await pause(100)
      const typed = await note.evaluate(measure)
      assert.ok(typed.height > initial.height, `${width}: multiline text grows`)
      assert.equal(typed.fits, true)
      // Watch the save, after intentional growth caused by the user's typing.
      await note.evaluate(node => {
        window.__documentWatch = { samples: [], running: true }
        const sample = () => {
          if (!window.__documentWatch.running) return
          window.__documentWatch.samples.push({ top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height,
            pageHeight: document.documentElement.scrollHeight, scroll: window.scrollY, focused: document.activeElement === node })
          requestAnimationFrame(sample)
        }
        sample()
      })
      await pause(2400)
      const saved = await note.evaluate(measure)
      assert.deepEqual(saved, typed, `${width}: save must not move, replace or blur the field`)
      const samples = await page.evaluate(() => { window.__documentWatch.running = false; return window.__documentWatch.samples })
      for (const key of ['top', 'height', 'pageHeight', 'scroll']) {
        assert.ok(Math.max(...samples.map(row => row[key])) - Math.min(...samples.map(row => row[key])) <= 1, `${width}: ${key} shifted during save`)
      }
      assert.ok(samples.every(sample => sample.focused))
      assert.equal(await page.evaluate(() => window.__obFormTest.snapshot().db.inspection_documents.find(row => row.id === 'document-0').note), longNote)
      assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('ob:text-draft:'))), [])
      await page.screenshot({ path: resolve(output, `documents-expanded-${width}.png`) })
      // Returning to an empty note restores compact height, without losing focus.
      await page.keyboard.down('Control')
      await note.press('a')
      await page.keyboard.up('Control')
      await note.press('Backspace')
      await pause(1500)
      assert.equal((await note.evaluate(measure)).height, initial.height)
      assert.equal(await note.evaluate(node => document.activeElement === node), true)
      console.log(`PASS: document layout, growth and stable autosave at ${width}px`)
    }
    // Restored drafts and locked saved text must also be measured before editing.
    await page.evaluate(text => localStorage.setItem('ob:text-draft:v1:ob:10000000-0000-4000-8000-000000000001:handlingar:document:document-0:note', JSON.stringify({ value: text })), longNote)
    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForSelector('.ob-document-note')
    await pause(1500)
    const restored = await visibleNote()
    assert.equal((await restored.evaluate(measure)).value, longNote)
    assert.equal((await restored.evaluate(measure)).fits, true)
    await page.setViewport({ width: 390, height: 900 })
    await page.waitForFunction(() => [...document.querySelectorAll('.ob-document-note')].some(node => node.checkVisibility()))
    await pause(150)
    assert.equal((await (await visibleNote()).evaluate(measure)).fits, true, 'Hidden mobile field resizes when shown')
    assert.equal((await (await visibleNote()).evaluate(measure)).value, longNote)
    await page.goto(base + '/round?section=documents&locked&large-text', { waitUntil: 'networkidle0' })
    await page.waitForSelector('.ob-document-note')
    const locked = await visibleNote()
    assert.equal(await locked.evaluate(node => node.matches(':disabled')), true)
    assert.equal((await locked.evaluate(measure)).fits, true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(await page.evaluate(() => window.__obFormTest.writes), [])
    await page.screenshot({ path: resolve(output, 'documents-locked-large-text.png') })
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
  } catch (error) {
    await page.screenshot({ path: resolve(output, 'documents-failure.png') })
    throw error
  } finally { await browser.close() }
}
