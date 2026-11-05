import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testSupplierInvoices(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage(), errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) { errors.push(`External request: ${url.origin}`); void request.abort() }
    else void request.continue()
  })
  const click = async (text, selector = 'button') => {
    for (const button of await page.$$(selector)) if ((await button.evaluate((node) => node.textContent.trim())) === text) { await button.click(); return }
    throw Error(`Missing ${selector}: ${text}`)
  }
  const setField = async (label, value) => page.evaluate((label, value) => {
    const node = [...document.querySelectorAll('label')].find((node) => node.childNodes[0]?.textContent.trim() === label)
    const control = node?.querySelector('input,select,textarea')
    if (!control) throw Error(`Missing field: ${label}`)
    const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, value)
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  }, label, value)
  const fieldValue = async (label) => page.evaluate((label) => [...document.querySelectorAll('label')].find((node) => node.childNodes[0]?.textContent.trim() === label)?.querySelector('input,select,textarea')?.value, label)
  const visible = async () => { await page.waitForFunction(() => document.querySelector('[data-invoice-id]') || document.body.textContent.includes('Registrera den första fakturan') || document.body.textContent.includes('syntetiskt testfel')); await page.evaluate(() => document.fonts.ready) }
  const noOverflow = async (name) => {
    const sizes = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth, dialog: document.querySelector('[role=dialog]')?.scrollWidth, dialogWidth: document.querySelector('[role=dialog]')?.clientWidth }))
    assert.ok(sizes.page <= sizes.viewport + 1, `${name}: horizontal page overflow ${JSON.stringify(sizes)}`)
    if (sizes.dialog) assert.ok(sizes.dialog <= sizes.dialogWidth + 1, `${name}: horizontal dialog overflow ${JSON.stringify(sizes)}`)
  }
  try {
    await page.emulateTimezone('Europe/Stockholm')
    for (const width of [390, 768, 1440]) {
      await page.setViewport({ width, height: 1000 })
      await page.goto(base, { waitUntil: 'networkidle0' }); await visible()
      await noOverflow(`${width}px register`)
      const text = await page.$eval('body', (node) => node.textContent)
      assert.ok(text.includes('2\u00a0900,00') || text.includes('2 900,00'), 'Register total subtracts credit and excludes void')
      assert.ok(!text.includes('F-VOID'), 'Voided invoice hidden by default')
      const rowHeights = await page.$$eval('[data-invoice-id]', (rows) => rows.map((row) => row.getBoundingClientRect().height))
      assert.ok(rowHeights.every((height) => height <= 36), `${width}px: invoice rows stay compact: ${rowHeights}`)
      // The real table control must still open its invoice using the keyboard.
      await page.focus('[data-invoice-id] td button')
      await page.keyboard.press('Enter')
      await page.waitForSelector('[role=dialog]')
      assert.equal(await fieldValue('Fakturanummer'), 'F-100')
      await page.click('[aria-label="Stäng faktura"]')
      await click('Ny faktura')
      await page.waitForSelector('[role=dialog]')
      await noOverflow(`${width}px editor`)
      await page.screenshot({ path: resolve(output, `editor-${width}.png`), fullPage: true })
      await page.click('[aria-label="Stäng faktura"]')
      await page.screenshot({ path: resolve(output, `register-${width}.png`), fullPage: true })
    }
    await setField('Projekt', '00000000-0000-4000-8000-000000000001')
    await page.waitForFunction(() => document.body.textContent.includes('Projektandel exkl. moms'))
    assert.ok((await page.$eval('body', (node) => node.textContent)).includes('2\u00a0500,00'), 'Central project filter uses project actual, not organization total')
    assert.ok((await page.$eval('body', (node) => node.textContent)).includes('600,00'), 'Central project filter shows allocated invoice share')
    await page.goto(`${base}/?state=project`, { waitUntil: 'networkidle0' }); await visible()
    assert.ok((await page.$eval('body', (node) => node.textContent)).includes('2\u00a0500,00'), 'Project actual uses allocated share only (600 -100 +2000)')
    await noOverflow('project economy')
    await page.screenshot({ path: resolve(output, 'project-1440.png'), fullPage: true })

    await page.goto(`${base}/?state=empty`, { waitUntil: 'networkidle0' }); await visible()
    await click('Ny faktura')
    await page.waitForSelector('[role=dialog]')
    await setField('Klistra in fakturatext', 'Leverantör: Ny leverantör AB\nFakturanummer: NY-200\nFakturadatum: 2026-11-01\nFörfallodatum: 2026-12-01\nNetto: 1 000,00 kr\nMoms: 250,00 kr')
    await click('Fyll fält från texten')
    assert.equal(await fieldValue('Leverantör'), 'Ny leverantör AB')
    assert.equal(await fieldValue('Exklusive moms'), '1000,00')
    assert.equal(await page.$eval('button[type=submit]', (node) => node.disabled), true, 'Pasted data requires review')
    await click('Lägg till fördelning')
    await setField('Belopp exkl. moms', '600,00')
    await click('Lägg till fördelning')
    await page.evaluate(() => {
      const controls = [...document.querySelectorAll('label')].filter((node) => node.childNodes[0]?.textContent.trim() === 'Projekt / åtgärdsärende')
      const select = controls[1].querySelector('select')
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '00000000-0000-4000-8000-000000000004')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.click('input[type=checkbox]')
    assert.equal(await page.$eval('button[type=submit]', (node) => node.disabled), false)
    await page.$eval('input[type=file]', (node) => node.classList.remove('sr-only'))
    await (await page.$('input[type=file]')).uploadFile(resolve(output, 'invoice.pdf'))
    await page.evaluate(() => { window.__invoiceTest.failUpload = true; window.__invoiceTest.delay = 80 })
    await click('Spara faktura')
    await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent.includes('Fakturan är sparad'))
    assert.equal(await fieldValue('Fakturanummer'), 'NY-200', 'Failed upload preserves invoice fields')
    assert.equal(await page.evaluate(() => window.__invoiceTest.saves.length), 1)
    await page.evaluate(() => { window.__invoiceTest.failUpload = false })
    await click('Spara faktura')
    await page.waitForSelector('[role=dialog]', { hidden: true })
    const saves = await page.evaluate(() => window.__invoiceTest.saves)
    assert.equal(saves.length, 2)
    assert.equal(saves[0].id, saves[1].id, 'Upload retry reuses saved invoice id')
    assert.equal(saves[1].expectedRevision, 1, 'Upload retry uses own saved revision')
    assert.deepEqual(saves[0].invoice.allocations.map((row) => [row.caseId, row.amountOre]), [
      ['00000000-0000-4000-8000-000000000001', 60000], ['00000000-0000-4000-8000-000000000004', 40000],
    ])
    assert.equal(await page.evaluate(() => window.__invoiceTest.uploaded), 1)
    await page.screenshot({ path: resolve(output, 'saved-invoice.png'), fullPage: true })

    // A conflict keeps the same editable draft and shows the server message.
    await page.goto(base, { waitUntil: 'networkidle0' }); await visible()
    await click('Ny faktura')
    await page.waitForSelector('[role=dialog]')
    await setField('Leverantör', 'Bevarat utkast AB')
    await setField('Fakturanummer', 'DUP-1')
    await setField('Förfallodatum', '2026-12-01')
    await setField('Exklusive moms', '10,00')
    await page.evaluate(() => { window.__invoiceTest.failSave = true })
    await click('Spara faktura')
    await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent.includes('finns redan'))
    assert.equal(await fieldValue('Leverantör'), 'Bevarat utkast AB')
    await page.click('[aria-label="Stäng faktura"]')

    // A workspace readback may already include a newer writer. Retrying a failed
    // attachment must use our own revision and preserve that writer's changes.
    await page.goto(`${base}/?state=empty`, { waitUntil: 'networkidle0' }); await visible()
    await click('Ny faktura'); await page.waitForSelector('[role=dialog]')
    await setField('Leverantör', 'Samtidighet AB')
    await setField('Fakturanummer', 'CAS-1')
    await setField('Förfallodatum', '2026-12-01')
    await setField('Exklusive moms', '100,00')
    await setField('Intern anteckning', 'Mitt utkast')
    await (await page.$('input[type=file]')).uploadFile(resolve(output, 'invoice.pdf'))
    await page.evaluate(() => { window.__invoiceTest.concurrentAfterSave = true; window.__invoiceTest.failUpload = true })
    await click('Spara faktura')
    await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent.includes('Fakturan är sparad'))
    await page.evaluate(() => { window.__invoiceTest.failUpload = false })
    await click('Spara faktura')
    await page.waitForFunction(() => document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('ändrats sedan'))
    assert.equal(await fieldValue('Intern anteckning'), 'Mitt utkast')
    assert.equal(await page.evaluate(() => window.__invoiceTest.saves.length), 1, 'A stale retry cannot overwrite another writer')
    assert.equal(await page.evaluate(() => window.__invoiceTest.attempts[1].expectedRevision), 1, 'Readback revision2 must not replace committed revision1')

    // Persistent load error offers a real retry.
    await page.goto(`${base}/?state=error`, { waitUntil: 'networkidle0' }); await visible()
    assert.ok((await page.$eval('body', (node) => node.textContent)).includes('syntetiskt testfel'))
    await page.evaluate(() => { window.__invoiceTest.failLoad = false })
    await click('Försök igen')
    await page.waitForFunction(() => document.body.textContent.includes('F-100'))

    // Hundreds of invoices stay one line tall and paginate without hiding totals.
    await page.goto(`${base}/?state=many`, { waitUntil: 'networkidle0' }); await visible()
    assert.equal((await page.$$('[data-invoice-id]')).length, 50)
    const firstPageIds = await page.$$eval('[data-invoice-id]', (rows) => rows.map((row) => row.dataset.invoiceId))
    await page.click('[aria-label="Nästa sida"]')
    await page.waitForFunction((firstId) => document.querySelector('[data-invoice-id]')?.getAttribute('data-invoice-id') !== firstId, {}, firstPageIds[0])
    const secondPageIds = await page.$$eval('[data-invoice-id]', (rows) => rows.map((row) => row.dataset.invoiceId))
    assert.ok(secondPageIds.every((id) => !firstPageIds.includes(id)), 'Next page advances to different invoices')
    await page.select('[aria-label="Fakturor per sida"]', '100')
    await page.waitForFunction(() => document.querySelectorAll('[data-invoice-id]').length === 100)
    assert.equal(await page.$eval('[data-invoice-id]', (node) => node.getAttribute('data-invoice-id')), firstPageIds[0], 'Changing page size returns to first page')
    await page.click('[aria-label="Nästa sida"]')
    await page.click('[aria-label="Nästa sida"]')
    await page.waitForFunction(() => document.querySelectorAll('[data-invoice-id]').length === 50)
    assert.equal(await page.$eval('[aria-label="Nästa sida"]', (button) => button.disabled), true)
    await setField('Sök faktura', 'SERIE-0250')
    await page.waitForFunction(() => document.querySelectorAll('[data-invoice-id]').length === 1)
    assert.ok((await page.$eval('[data-invoice-id]', (node) => node.textContent)).includes('SERIE-0250'), 'Search resets pagination and finds invoices from the last page')
    await setField('Sök faktura', '')
    await page.waitForFunction(() => document.querySelectorAll('[data-invoice-id]').length === 100)
    await noOverflow('250 invoice table')
    await page.screenshot({ path: resolve(output, 'register-250-1440.png'), fullPage: true })
    const compactHeights = await page.$$eval('[data-invoice-id]', (rows) => rows.map((row) => row.getBoundingClientRect().height))
    assert.ok(compactHeights.every((height) => height <= 36), `Large dataset keeps compact rows: ${[...new Set(compactHeights)]}`)
    assert.deepEqual(errors, [])
    console.log('Supplier invoice UI checks passed: compact single-line rows on desktop/mobile, 250 invoices with pagination/search, keyboard access, project shares, paste, allocation, file retry, stale conflict and loading recovery.')
  } catch (error) {
    console.error(JSON.stringify({ errors, body: await page.$eval('body', (node) => node.textContent.slice(0, 3500)) }))
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true })
    throw error
  } finally { await browser.close() }
}
