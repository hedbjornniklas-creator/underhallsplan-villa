import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import { testDraftFeedback } from './ob-draft-feedback-browser.mjs'

export async function testTuReportEditor(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = [], dialogs = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss() })
  const heading = 'textarea[aria-label="Rubrik för del 2"]'
  const body = '[data-tu-section-textarea]'
  const original = 'Min egen text.\nEn rad till.\n\nEtt eget stycke.'
  const fill = async (selector, value) => {
    await page.focus(selector)
    await page.$eval(selector, (node, text) => {
      const prototype = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, text)
      node.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
  }
  const click = async text => {
    const button = await page.waitForSelector(`xpath///button[contains(., '${text}')]`)
    await button.click()
  }
  const open = async query => {
    await page.goto(`${base}/?${query || ''}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForSelector(heading)
  }
  const preview = async () => {
    await click('Förhandsgranska utkast')
    await page.waitForFunction(() => location.pathname.endsWith('/print'), { polling: 100 })
    await page.waitForSelector('main > h1')
    return page.evaluate(() => JSON.parse(sessionStorage.getItem('tu-editor-saved')))
  }
  try {
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 })
      await open('required')
      assert.equal(await page.$eval(heading, node => node.value), 'Rekommenderade kompletterande kontroller')
      await fill(heading, 'Rekommenderad fortsatt hantering')
      await page.evaluate(() => { window.__tuEditorTest.delay = 450 })
      await click('Förhandsgranska utkast')
      assert.equal(await page.$eval('main', node => node.inert), true, 'No editing while taking the saved preview snapshot')
      assert.equal(new URL(page.url()).pathname, '/', 'Preview waits for slow saves')
      await page.waitForFunction(() => location.pathname.endsWith('/print'), { polling: 100 })
      await page.waitForSelector('main > h1')
      const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tu-editor-saved')))
      assert.equal(saved.reportDraft.sections[1].title, 'Rekommenderad fortsatt hantering')
      assert.equal(saved.reportDraft.sections[1].text, original, 'A heading change must not modify report text')
      assert.equal(saved.reportDraft.sections[1].key, 'recommended_actions')
      assert.equal(saved.reportDraft.sections[1].templateSectionKey, 'recommended_actions')
      assert.equal(saved.reportDraft.sections[1].subsections[0].text, 'Egen underrubrikstext.')
      assert.match(await page.$eval('body', node => node.textContent), /Rekommenderad fortsatt hantering/)
      await page.goto(`${base}/?resume&required`, { waitUntil: 'networkidle0' })
      assert.equal(await page.$eval(heading, node => node.value), 'Rekommenderad fortsatt hantering', 'Saved title survives reopen')
      await page.$eval(heading, node => node.scrollIntoView({ block: 'center' }))
      await page.screenshot({ path: resolve(output, `editor-${width}.png`) })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal page overflow')
      assert.equal(await page.$eval(heading, node => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight), false, 'Whole heading is visible')
    }

    await open()
    await page.evaluate(() => { window.__tuEditorTest.delay = 400 })
    await fill(body, 'Snabb textändring.\n\nEtt andra stycke.')
    await fill('input[aria-label="Underrubrik"]', 'Ändrad underrubrik')
    await fill('textarea[aria-label="Text för underrubrik 2.1"]', 'Ändrad underrubrikstext.')
    await fill(heading, 'En ny rubrik')
    let saved = await preview()
    assert.equal(saved.reportDraft.sections[1].title, 'En ny rubrik')
    assert.equal(saved.reportDraft.sections[1].text, 'Snabb textändring.\n\nEtt andra stycke.')
    assert.deepEqual(saved.reportDraft.sections[1].subsections[0], { id: 'sub-1', title: 'Ändrad underrubrik', text: 'Ändrad underrubrikstext.' })

    await open()
    await page.evaluate(() => { window.__tuEditorTest.delay = 450 })
    await fill(body, 'Första ändringen')
    await page.focus(heading)
    await page.waitForFunction(() => window.__tuEditorTest.active > 0)
    await fill(body, 'Senaste ändringen under pågående sparning.')
    saved = await preview()
    assert.equal(saved.reportDraft.sections[1].text, 'Senaste ändringen under pågående sparning.')

    await open()
    await page.evaluate(() => { window.__tuEditorTest.delay = 300 })
    await fill(heading, 'Sparad även i bakgrunden')
    await click('Förhandsgranska utkast')
    const otherTab = await browser.newPage()
    await otherTab.bringToFront()
    await page.waitForFunction(() => location.pathname.endsWith('/print'), { polling: 100 })
    await otherTab.close()
    await page.bringToFront()

    await open()
    await page.evaluate(() => { window.__tuEditorTest.fail = true; window.__tuEditorTest.delay = 250 })
    await fill(heading, 'Rubrik vid fel')
    await fill(body, 'Min text finns kvar efter felet.')
    await click('Förhandsgranska utkast')
    await page.waitForFunction(() => document.body.textContent.includes('Förhandsgranskningen kunde inte öppnas eftersom alla ändringar inte har sparats.'))
    assert.equal(new URL(page.url()).pathname, '/')
    assert.equal(await page.$eval(body, node => node.value), 'Min text finns kvar efter felet.')
    assert.equal(await page.$eval(heading, node => node.value), 'Rubrik vid fel')
    assert.equal(await page.$eval('main', node => node.inert), false)
    await page.evaluate(() => { window.__tuEditorTest.fail = false })
    saved = await preview()
    assert.equal(saved.reportDraft.sections[1].text, 'Min text finns kvar efter felet.')
    assert.equal(saved.reportDraft.sections[1].title, 'Rubrik vid fel')

    await open()
    await page.evaluate(() => { window.__tuEditorTest.delay = 500 })
    await fill(body, 'Text i hopfälld del.')
    await page.click('#tu-section-recommended_actions button[title="Minimera sektion"]')
    saved = await preview()
    assert.equal(saved.reportDraft.sections[1].text, 'Text i hopfälld del.')

    await open()
    await page.evaluate(() => { window.__tuEditorTest.delay = 350 })
    await fill('textarea[placeholder="Plats, byggnadsdel och vad bilden visar"]', 'Senast redigerad bildtext.')
    await preview()
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tu-editor-image')).reportCaption), 'Senast redigerad bildtext.')

    await open('locked')
    assert.equal(await page.$eval(heading, node => node.disabled), true)
    await preview()
    assert.equal(await page.evaluate(() => sessionStorage.getItem('tu-editor-saved')), null, 'Locked preview must not write')
    assert.deepEqual(dialogs, [], 'No unexpected leave-page warning after successful flush')
    assert.deepEqual(errors, [])
    console.log('TU report editor: desktop/mobile headings, unchanged body, required and locked sections, slow queued/debounced saves, failure and retry, collapsed text, image captions and fresh preview passed (synthetic only).')
    await testDraftFeedback({ page, base, output })
    assert.deepEqual(errors, [])
    console.log('Shared textarea: existing OB draft restoration, save failures, locking and unload-guard checks passed.')
  } catch (error) {
    console.error('Editor test diagnostics:', { errors, dialogs })
    console.error('Editor test state:', await page.evaluate(() => ({ path: location.pathname,
      busy: document.querySelector('main')?.inert, state: window.__tuEditorTest,
      alerts: [...document.querySelectorAll('[role="alert"], [role="status"]')].map(node => node.textContent),
      tail: document.body.textContent.slice(-1200),
    })))
    await page.screenshot({ path: resolve(output, 'failure.png') })
    throw error
  } finally { await browser.close() }
}
