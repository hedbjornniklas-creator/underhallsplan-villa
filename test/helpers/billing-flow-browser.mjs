import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import puppeteer from 'puppeteer-core'
import { PDFDocument } from 'pdf-lib'

export async function testBillingFlow(base, output) {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const downloadPath = await mkdtemp(resolve(output, 'downloads-'))
  const context = await browser.createBrowserContext({ downloadBehavior: { policy: 'allow', downloadPath } })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  const click = async text => {
    const found = await page.evaluate(text => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text && b.getClientRects().length); if (!b) return false; if (b.disabled) throw Error('Disabled: ' + text); b.click(); return true }, text)
    if (!found) throw Error('Missing button: ' + text)
  }
  const fill = async (label, value) => page.evaluate((label, value) => {
    const container = document.querySelector('[role=dialog]') || document
    const control = [...container.querySelectorAll('label')].find(l => l.childNodes[0]?.textContent.trim() === label)?.querySelector('input,textarea,select')
    if (!control) throw Error('Missing field: ' + label)
    const prototype = control.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : control.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, value)
    control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  }, label, value)
  const saved = async () => { await page.waitForFunction(() => document.querySelector('[data-testid=dirty]').textContent === 'clean'); await new Promise(r => setTimeout(r, 100)) }
  try {
    await page.setViewport({ width: 1440, height: 1000 }); await page.goto(base, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.gbf-summary'); assert.equal(await page.evaluate(() => window.fixture.calls.length), 0)
    await click('Hämta överenskommelse'); await fill('ÄTA eller avtalad del', 'change:windows:running')
    await fill('Godkänt av beställare', 'Fiktiv beställare'); await fill('Hänvisning till beställning / avtal / mejl', 'Fiktivt mejl 2026-11-09'); await click('Bekräfta')
    await page.waitForFunction(() => !document.querySelector('[role=dialog]')); await saved()
    await click('Lägg till kostnad'); await fill('Beskrivning', 'Fiktivt fönstermaterial'); await fill('Faktisk kostnad exkl. moms', '10000'); await fill('Underlag / hänvisning', 'Fiktivt kvitto 1')
    await page.waitForFunction(() => window.fixture.data().flow.costs.length === 1 && document.querySelector('[data-testid=dirty]').textContent === 'clean')
    assert.equal(await page.evaluate(() => window.fixture.data().flow.costs[0].internalNetOre), 1000000)
    await click('Granska och gör fakturerbart'); await page.waitForFunction(() => !document.querySelector('[role=dialog]')); await saved()
    assert.equal(await page.evaluate(() => window.fixture.data().flow.entries[0].netOre), 1150000)
    await click('Att fakturera'); await page.click('input[aria-label="Välj Fiktivt fönstermaterial"]'); await click('Skapa fakturaunderlag'); await click('Bekräfta'); await saved()
    assert.equal(await page.evaluate(() => window.fixture.data().flow.bases.length), 1)
    await click('Underlag och fakturor')
    const pdfResponse = page.waitForResponse(r => r.url().endsWith('/preview-pdf'))
    await page.click('button[aria-label="PDF Fakturaunderlag"]')
    const pdfResult = await pdfResponse; assert.equal(pdfResult.status(), 200)
    let downloaded
    for (let n = 0; n < 100 && !downloaded; n++) { downloaded = (await readdir(downloadPath)).find(f => f.endsWith('.pdf')); if (!downloaded) await new Promise(r => setTimeout(r, 100)) }
    assert.ok(downloaded, 'PDF download completes')
    const pdfBytes = await readFile(resolve(downloadPath, downloaded))
    assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-', `PDF header: ${pdfBytes.subarray(0, 80).toString('hex')} (${pdfBytes.length} bytes)`)
    const pdf = await PDFDocument.load(pdfBytes); assert.equal(pdf.getPageCount(), 1); assert.equal(pdf.getAuthor(), 'Testbygg AB'); await saved()
    await click('Registrera Fortnox-faktura'); await fill('Fortnox fakturanummer', 'TEST-1001')
    await page.click('input[aria-label="Fakturera Fiktivt fönstermaterial"]')
    await page.evaluate(() => [...document.querySelectorAll('[role=dialog] input[type=checkbox]')].at(-1).click())
    await click('Bekräfta fakturering'); await page.waitForFunction(() => !document.querySelector('[role=dialog]')); await saved()
    assert.equal(await page.evaluate(() => window.fixture.data().flow.invoices[0].number), 'TEST-1001')
    await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.gbf-summary')
    assert.match(await page.$eval('.gbf-summary', e => e.textContent), /11\s?500,00/)
    await click('Lägg till kostnad'); await page.evaluate(() => window.fixture.failNext()); await fill('Beskrivning', 'Återförsök'); await fill('Faktisk kostnad exkl. moms', '0')
    await page.waitForFunction(() => document.body.textContent.includes('Syntetiskt sparfel'))
    const requestId = await page.evaluate(() => window.fixture.calls.at(-1).requestId)
    // The drawer's retry owns the autosave acknowledgement as well as the HTTP retry.
    await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent === 'Försök igen').click())
    await page.waitForFunction(() => window.fixture.data().flow.costs.length === 2 && document.querySelector('[data-testid=dirty]').textContent === 'clean')
    assert.equal(await page.evaluate(() => window.fixture.calls.at(-1).requestId), requestId)
    await fill('Underlag / hänvisning', 'Fiktiv kostnadsfri produkt'); await saved()
    for (const width of [1440, 768, 390]) {
      await page.setViewport({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: resolve(output, `cost-drawer-${width}.png`), fullPage: true })
      const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(e => [e.tagName, e.className, e.getBoundingClientRect().right]) }))
      assert.ok(overflow.scroll <= width + 1, `No page overflow: ${JSON.stringify(overflow)}`)
    }
    await click('Stäng'); await saved()
    await page.setViewport({ width: 1440, height: 1000 }); await click('Att fakturera'); await page.screenshot({ path: resolve(output, 'billing-queue-desktop.png'), fullPage: true })
    await click('Kostnader'); await click('Hämta överenskommelse'); await fill('ÄTA eller avtalad del', 'base:payment:1')
    await fill('Godkänt av beställare', 'Testkund'); await fill('Hänvisning till beställning / avtal / mejl', 'Testavtal version 1'); await click('Bekräfta'); await saved()
    await click('Underlag och fakturor'); await click('Registrera tidigare fastprisfaktura'); await fill('Tidigare Fortnox fakturanummer', 'TEST-GAMMAL-1')
    await page.click('input[aria-label="Tidigare fakturerat Grundarbete"]')
    await page.evaluate(() => { const input = document.querySelector('input[aria-label="Tidigare belopp Grundarbete"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '5000'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await fill('Hänvisning till tidigare faktura och avstämning', 'Fiktiv historisk faktura')
    await page.evaluate(() => [...document.querySelectorAll('[role=dialog] input[type=checkbox]')].at(-1).click()); await click('Bekräfta'); await saved()
    assert.equal(await page.evaluate(() => window.fixture.data().flow.bases.filter(b => b.historical).length), 1)
    await click('Kostnader'); await fill('ÄTA eller avtalsdel', await page.evaluate(() => window.fixture.data().flow.agreements.find(a => a.mode === 'fixed').id))
    await click('Gör avtalad del fakturerbar')
    assert.equal(await page.$eval('[role=dialog] input:not([type=date])', e => e.value), '15000')
    await fill('Utfört arbete och uppfyllda faktureringsvillkor', 'Fiktivt färdigt grundarbete'); await click('Bekräfta'); await saved()
    await click('Att fakturera'); await page.click('input[aria-label="Välj Grundarbete"]'); await click('Skapa fakturaunderlag'); await fill('Rubrik', 'Test delbetalning'); await click('Bekräfta'); await saved()
    await click('Underlag och fakturor'); await click('Registrera Fortnox-faktura'); await fill('Fortnox fakturanummer', 'TEST-DEL-1')
    await page.click('input[aria-label="Fakturera Grundarbete"]')
    await page.evaluate(() => { const input = document.querySelector('input[aria-label="Fakturerat belopp Grundarbete"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '10000'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await page.evaluate(() => [...document.querySelectorAll('[role=dialog] input[type=checkbox]')].at(-1).click()); await click('Bekräfta fakturering'); await saved()
    await click('Frigör rest: Test delbetalning'); await fill('Skäl', 'Resten ska faktureras senare')
    await page.evaluate(() => document.querySelector('[role=dialog] input[type=checkbox]').click()); await click('Bekräfta'); await saved()
    assert.equal(await page.evaluate(() => window.fixture.data().flow.releases[0].netOre), 500000)
    await click('Att fakturera'); assert.match(await page.$eval('[role=tabpanel]', e => e.textContent), /5\s?000,00/)
    await click('Kostnader'); await fill('ÄTA eller avtalsdel', await page.evaluate(() => window.fixture.data().flow.agreements.find(a => a.mode === 'running').id))
    await page.click('button[aria-label="Koppla faktura till Fiktivt fönstermaterial"]')
    await fill('Leverantörsfaktura / fördelad del', await page.evaluate(() => window.fixture.data().suppliers[0].key)); await fill('Bekräftelse att detta avser samma kostnad', 'Samma inköp som manuellt registrerats'); await click('Bekräfta'); await saved()
    await page.click('button[aria-label="Öppna Fiktivt fönstermaterial"]'); await click('Granska och gör fakturerbart'); await saved()
    assert.equal(await page.evaluate(() => window.fixture.data().flow.entries.at(-1).netOre), -23000)
    assert.equal(await page.evaluate(() => window.fixture.data().flow.costs.length), 2)
    await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.gbf-summary')
    assert.equal(await page.evaluate(() => window.fixture.data().flow.invoices.length), 3)
    assert.deepEqual(errors, [])
    console.log('UI passed: read-only load, agreement, cost autosave, markup, review, reservation, invoice registration, historical fixed invoice, partial billing, release, supplier matching/correction, reload, zero, exact retry and mobile/desktop.')
  } finally { await browser.close() }
}
