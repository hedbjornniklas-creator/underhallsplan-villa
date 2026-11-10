import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testSupplierPdfPreview(base, output, originalPdf) {
  const profile = await mkdtemp(resolve(output, 'pdf-profile-'))
  await mkdir(resolve(profile, 'Default'))
  await writeFile(resolve(profile, 'Default/Preferences'), JSON.stringify({ plugins: { always_open_pdf_externally: true } }))
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: profile })
  const page = await browser.newPage(), errors = [], reads = [], dialogs = []
  let acceptClose = false
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => { if (r.url().includes('/original.pdf')) reads.push(r.url()) })
  page.on('dialog', async d => { dialogs.push(d.message()); if (acceptClose) await d.accept(); else await d.dismiss() })
  const click = async text => {
    for (const b of await page.$$('button')) if ((await b.evaluate(e => e.getClientRects().length && e.textContent.trim())) === text) { await b.click(); return }
    throw Error('Missing button: ' + text)
  }
  const fill = async (label, value) => page.evaluate((label, value) => {
    const input = [...document.querySelectorAll('.psi-panel label')].find(l => l.childNodes[0]?.textContent.trim() === label)?.querySelector('input')
    if (!input) throw Error('Missing field: ' + label)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, label, value)
  const ready = async (number = 1) => {
    await page.waitForFunction(number => {
      const viewer = document.querySelector('.supplier-pdf-preview'), canvas = viewer?.querySelector('canvas')
      return viewer?.getAttribute('aria-busy') === 'false' && canvas?.width > 100 && viewer?.querySelector(`p[aria-label="Text på PDF-sida ${number}"]`)
    }, {}, number)
    const result = await page.$eval('.supplier-pdf-paper canvas', canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let ink = 0
      for (let n = 0; n < pixels.length; n += 16) if (pixels[n + 3] > 200 && Math.min(pixels[n], pixels[n + 1], pixels[n + 2]) < 235) ink++
      return { width: canvas.width, height: canvas.height, ink }
    })
    assert.ok(result.ink > 200, `PDF page has visible content: ${JSON.stringify(result)}`)
  }
  try {
    await page.setViewport({ width: 1440, height: 1000 }); await page.goto(base, { waitUntil: 'networkidle0' }); await page.waitForSelector('.psi')
    // A PDF with no browser-provided MIME type must still render before registration.
    await page.evaluate(bytes => {
      const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], 'Fiktiv faktura F-301.pdf'))
      document.querySelector('.psi').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    }, [...originalPdf])
    await ready()
    assert.equal(await page.$('.psi-original iframe'), null)
    assert.equal(await page.evaluate(() => window.fixture.calls.length), 0)
    assert.match(await page.$eval('.psi-panel-footer', e => e.textContent), /Inte uppladdad.*leverantör.*fakturanummer/)
    assert.match(await page.$eval('p[aria-label="Text på PDF-sida 1"]', e => e.textContent), /FIKTIV FAKTURA F-301/)
    await click('Stäng'); await page.waitForFunction(() => document.querySelector('.psi-panel'))
    assert.match(dialogs.at(-1), /Filen är inte uppladdad/); await ready()
    await page.click('button[aria-label="Nästa PDF-sida"]'); await ready(2)
    assert.match(await page.$eval('p[aria-label="Text på PDF-sida 2"]', e => e.textContent), /SPECIFIKATION SIDA 2/)
    assert.ok(await page.$eval('.supplier-pdf-paper canvas', canvas => {
      const bytes = canvas.getContext('2d').getImageData(0, Math.floor(canvas.height / 2), canvas.width, Math.floor(canvas.height / 2)).data
      let ink = 0
      for (let n = 0; n < bytes.length; n += 16) if (Math.min(bytes[n], bytes[n + 1], bytes[n + 2]) < 200) ink++
      return ink > 100
    }), 'Scanned invoice image renders in the lower half of page two')
    await page.click('button[aria-label="Föregående PDF-sida"]'); await ready()
    const before = await page.$eval('.supplier-pdf-paper canvas', e => e.getBoundingClientRect().width)
    await page.click('button[aria-label="Zooma in PDF"]')
    await page.waitForFunction(before => document.querySelector('.supplier-pdf-paper canvas')?.getBoundingClientRect().width > before + 20, {}, before); await ready()
    await page.click('button[aria-label="Anpassa PDF till bredden"]'); await ready()
    for (const width of [1440, 768, 390]) {
      await page.setViewport({ width, height: 1000 }); await ready()
      await page.screenshot({ path: resolve(output, `pdf-preview-${width}.png`), fullPage: true })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No page overflow at ${width}`)
    }
    await page.setViewport({ width: 1440, height: 1000 })
    await fill('Leverantör', 'PDF Test AB'); await fill('Fakturanummer', 'F-301'); await fill('Belopp exkl. moms', '10000'); await fill('Momsbelopp', '2500')
    await page.waitForFunction(() => window.fixture.data().invoices[0]?.attachments.length === 1 && document.querySelector('[data-testid=dirty]').textContent === 'clean'); await ready()
    assert.ok(reads.length > 0, 'Saved PDF is loaded through the protected original source')
    acceptClose = true; await click('Stäng'); await page.waitForSelector('.psi-panel', { hidden: true })
    await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.psi-open')
    await page.evaluate(() => window.fixture.failNext('preview')); await click('PDF Test ABF-301')
    await page.waitForFunction(() => document.querySelector('.supplier-pdf-preview [role=alert]'))
    await click('Försök igen'); await ready()
    await click('Stäng'); await page.waitForSelector('.psi-panel', { hidden: true }); await click('Registrera')
    const corrupt = resolve(output, 'trasig-testfil.pdf'); await writeFile(corrupt, '%PDF-1.7\nnot a document')
    const picker = await page.$('.psi-original input[type=file]'); await picker.uploadFile(corrupt)
    await page.waitForFunction(() => document.querySelector('.supplier-pdf-preview [role=alert]'))
    const valid = resolve(output, 'fiktiv-faktura.pdf'); await writeFile(valid, originalPdf); await picker.uploadFile(valid); await ready()
    assert.equal(await page.$('.supplier-pdf-preview [role=alert]'), null)
    await click('Stäng'); await page.waitForSelector('.psi-panel', { hidden: true })
    assert.deepEqual(errors, [])
    console.log('PDF UI passed: native PDF plugin disabled, blank MIME, preview before upload, explicit missing fields, close/cancel, page navigation, zoom/fit, desktop/mobile pixels, saved original, reload, failed fetch/retry and invalid PDF recovery.')
  } finally { await browser.close() }
}
