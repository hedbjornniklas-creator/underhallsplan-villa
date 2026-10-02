import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testTuEvidence(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  async function clickText(text, selector = 'button') {
    const matches = await page.$$(selector)
    for (const match of matches) {
      if (await match.evaluate((node, value) => node.checkVisibility() && node.textContent.includes(value), text)) {
        await match.click()
        return
      }
    }
    throw Error(`Visible control not found: ${text}`)
  }
  async function replace(selector, text) {
    await page.click(selector)
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control')
    await page.keyboard.type(text)
  }
  async function load(width = 1440, suffix = '') {
    await page.setViewport({ width, height: 1000 })
    await page.goto(`${base}/${suffix}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('button[aria-label="Redigera fältpost: Vind"]')
  }
  async function evidence() {
    await clickText('Sortera och granska', 'nav button')
    await page.waitForFunction(() => document.body.textContent.includes('0 av 3'))
  }
  try {
    for (const width of [320, 390, 768, 1440]) {
      await load(width)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}: no field log overflow`)
      const scope = width < 1024 ? 'details.lg\\:hidden' : 'nav'
      if (width < 1024) await page.click(`${scope} summary`)
      const buttons = await page.$$eval(`${scope} button`, nodes => nodes.map(node => node.textContent.trim()))
      const index = buttons.findIndex(text => text.includes('Redigera uppdrag'))
      assert.equal(index >= 0 && buttons[index + 1].includes('Dokumentera på plats'), true)
      await clickText('Redigera uppdrag', `${scope} button`)
      assert.equal(await page.evaluate(() => window.__tuEvidenceTest.assignmentOpened), 1)
      await page.screenshot({ path: resolve(output, `field-${width}.png`), fullPage: true })
      await page.click('button[aria-label="Redigera fältpost: Vind"]')
      await page.waitForSelector('[role="dialog"] textarea')
      assert.match(await page.$eval('[role="dialog"] textarea', node => node.value), /Anteckning från Vind/)
      assert.equal(await page.$eval('[role="dialog"]', node => node.scrollWidth > node.clientWidth + 1), false, `${width}: no panel overflow`)
      await page.screenshot({ path: resolve(output, `edit-${width}.png`) })
      await page.click('button[aria-label="Stäng fältposten"]')
      await page.waitForSelector('button[aria-label="Redigera fältpost: Vind"]')
    }

    // Edit existing field text and attach several images through the existing file input.
    await load()
    await page.click('button[aria-label="Redigera fältpost: Vind"]')
    await page.waitForSelector('[role="dialog"] textarea')
    await replace('[role="dialog"] textarea', 'Korrigerad observation med fler bilder')
    await page.$eval('input[type=file][multiple]', input => {
      const files = new DataTransfer()
      files.items.add(new File(['fixture'], 'photo-1.png', { type: 'image/png' }))
      files.items.add(new File(['fixture'], 'photo-2.png', { type: 'image/png' }))
      input.files = files.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="Granska kopplad bild i fullformat"]').length === 3)
    await clickText('Spara som utkast')
    await page.waitForFunction(() => window.__tuEvidenceTest.observations[0].imageIds.length === 3 && window.__tuEvidenceTest.patches === 1)
    assert.equal(await page.evaluate(() => window.__tuEvidenceTest.observations[0].noteText), 'Korrigerad observation med fler bilder')
    await page.waitForFunction(() => document.body.textContent.includes('Ändringarna är sparade'))
    await page.click('button[aria-label="Stäng fältposten"]')
    await page.waitForSelector('button[aria-label="Redigera fältpost: Vind"]')
    await page.click('button[aria-label="Redigera fältpost: Vind"]')
    await page.waitForSelector('[role="dialog"] textarea')
    assert.equal(await page.$eval('[role="dialog"] textarea', node => node.value), 'Korrigerad observation med fler bilder')

    // Measurement save must not discard an unsaved observation text.
    await page.click('button[aria-label="Stäng fältposten"]')
    await page.waitForSelector('button[aria-label="Redigera fältpost: Kök"]')
    await page.click('button[aria-label="Redigera fältpost: Kök"]')
    await page.waitForSelector('[role="dialog"] textarea')
    await replace('[role="dialog"] textarea', 'Mätpunkt förtydligad')
    await clickText('Spara mätningen')
    await page.waitForFunction(() => document.body.textContent.includes('Mätningen är sparad'))
    assert.equal(await page.$eval('[role="dialog"] textarea', node => node.value), 'Mätpunkt förtydligad')
    await clickText('Spara som utkast')
    await page.waitForFunction(() => window.__tuEvidenceTest.observations[2].noteText === 'Mätpunkt förtydligad')

    // Delete with an arbitrarily slow server: list is immediately usable and never reloads.
    await load()
    await page.evaluate(() => { window.__tuEvidenceTest.holdDeletes = true })
    await evidence()
    await clickText('Vind', 'main button')
    await page.waitForSelector('[role="dialog"]')
    const gets = await page.evaluate(() => window.__tuEvidenceTest.gets)
    await page.click('button[aria-label="Ta bort fältpost"]')
    await page.waitForSelector('[role="dialog"]', { hidden: true })
    await page.waitForFunction(() => window.__tuEvidenceTest.finishDelete !== null)
    assert.equal(await page.evaluate(() => document.body.textContent.includes('Tar bort i bakgrunden')), true)
    assert.equal(await page.evaluate(() => window.__tuEvidenceTest.gets), gets)
    assert.equal(await page.evaluate(() => document.body.textContent.includes('Anteckning från Vind')), false)
    await clickText('Hall', 'main button')
    await replace('[role="dialog"] textarea', 'Arbete fortsätter under radering')
    await page.evaluate(() => window.__tuEvidenceTest.refresh())
    await page.waitForFunction(before => window.__tuEvidenceTest.gets > before, {}, gets)
    assert.equal(await page.evaluate(() => document.body.textContent.includes('Anteckning från Vind')), false, 'stale GET cannot resurrect pending deletion')
    await page.evaluate(() => window.__tuEvidenceTest.finishDelete(false))
    await page.waitForFunction(() => document.body.textContent.includes('Raderingen kunde inte bekräftas'))
    assert.equal(await page.$eval('[role="dialog"] textarea', node => node.value), 'Arbete fortsätter under radering')
    assert.equal(await page.evaluate(() => document.body.textContent.includes('INTERNAL_FIXTURE_FAILURE')), false)
    for (const dismiss of await page.$$('[aria-label="Meddelanden"] button')) await dismiss.click()
    await page.keyboard.press('Escape')
    await page.waitForSelector('[role="dialog"]', { hidden: true })
    await clickText('Vind', 'main button')
    await page.waitForFunction(() => document.querySelector('[role="dialog"] textarea')?.value === 'Anteckning från Vind')
    await page.click('button[aria-label="Ta bort fältpost"]')
    await page.waitForFunction(() => window.__tuEvidenceTest.finishDelete !== null)
    await page.evaluate(() => window.__tuEvidenceTest.finishDelete(true))
    await page.waitForFunction(() => document.body.textContent.includes('Fältposten är borttagen'))
    assert.equal(await page.evaluate(() => document.body.textContent.includes('Anteckning från Vind')), false)
    assert.equal(await page.evaluate(() => window.__tuEvidenceTest.observations.length), 2)
    await page.screenshot({ path: resolve(output, 'deleted.png') })

    await load(1440, '?locked=1')
    assert.equal(await page.$eval('button[aria-label="Redigera fältpost: Vind"]', node => node.disabled), true)
    assert.equal(await page.$$eval('nav button', nodes => nodes.find(node => node.textContent.includes('Redigera uppdrag')).disabled), true)
    assert.deepEqual(errors, [])
    console.log('TU evidence: desktop/tablet/mobile, workflow action, field editing, multiple images, measurement draft preservation, optimistic delete, rollback, stale refresh and locked state passed.')
  } catch (error) {
    await page.screenshot({ path: resolve(output, 'failure.png') })
    console.error(await page.evaluate(() => ({
      dialogText: document.querySelector('[role="dialog"]')?.textContent?.slice(0, 500),
      note: document.querySelector('[role="dialog"] textarea')?.value,
      pendingDelete: Boolean(window.__tuEvidenceTest.finishDelete),
      observations: window.__tuEvidenceTest.observations.map(row => row.id),
    })))
    throw error
  } finally { await browser.close() }
}
