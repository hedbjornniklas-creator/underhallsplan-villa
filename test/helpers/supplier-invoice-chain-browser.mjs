import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises'
import puppeteer from 'puppeteer-core'
import { PDFDocument } from 'pdf-lib'

export async function testSupplierInvoiceChain(base, output, originalPdf) {
  const downloadPath = resolve(output, 'chain-downloads'); await mkdir(downloadPath, { recursive: true })
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.createBrowserContext({ downloadBehavior: { policy: 'allow', downloadPath } })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.dismiss())
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const click = async text => {
    await page.waitForFunction(text => [...document.querySelectorAll('button')].some(b => b.getClientRects().length && b.textContent.trim() === text && !b.disabled), { timeout: 10000 }, text)
    const result = await page.evaluate(text => { const b = [...document.querySelectorAll('button')].find(b => b.getClientRects().length && b.textContent.trim() === text); if (!b) return 'missing'; if (b.disabled) return 'disabled'; b.click(); return 'clicked' }, text)
    assert.equal(result, 'clicked', text)
  }
  const fill = async (label, value) => {
    await page.waitForFunction(label => { const scope = document.querySelector('[role=dialog]') || document; return [...scope.querySelectorAll('label')].some(l => l.getClientRects().length && l.childNodes[0]?.textContent.trim() === label && l.querySelector('input,select,textarea')) }, { timeout: 10000 }, label)
    return page.evaluate((label, value) => {
    const scope = document.querySelector('[role=dialog]') || document
    const c = [...scope.querySelectorAll('label')].find(l => l.childNodes[0]?.textContent.trim() === label)?.querySelector('input,select,textarea')
    if (!c) throw Error('Missing field ' + label)
    const proto = c.tagName === 'SELECT' ? HTMLSelectElement.prototype : c.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(c, value); c.dispatchEvent(new Event(c.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    }, label, value)
  }
  const saved = () => page.waitForFunction(() => document.querySelector('[data-testid=dirty]').textContent === 'clean')
  const closeDrawer = () => page.waitForSelector('[role=dialog]', { hidden: true })
  const tab = async text => { await page.evaluate(text => [...document.querySelectorAll('[role=tab]')].find(e => e.getClientRects().length && e.textContent === text).click(), text); await page.waitForSelector(text === 'Leverantörsfakturor' ? '.psi-open' : '.gbf-summary') }
  const originalPath = resolve(output, 'chain-original.pdf'); await writeFile(originalPath, originalPdf)
  const createInvoice = async (number, net, vat, target, credit = false) => {
    await click('Lägg till fakturor'); await (await page.$('.psi>input[type=file]')).uploadFile(originalPath); await page.waitForSelector('.psi-panel')
    assert.match(await page.$eval('.psi-progress', e => e.textContent), /Vald på denna enhet/)
    await fill('Leverantör', 'Fiktiv leverantör AB'); await fill('Fakturanummer', number)
    await fill('Fakturadatum', '2026-11-18'); await fill('Moment eller ÄTA', target); await fill('Kostnadsslag', 'material')
    if (credit) { await page.click('.psi-panel details summary'); await fill('Typ', 'credit') }
    await fill('Belopp exkl. moms', net); await fill('Momsbelopp', vat)
    await page.waitForFunction(() => document.querySelector('.psi-original>a') && document.querySelector('[data-testid=dirty]').textContent === 'clean')
    await page.click('.psi-result input[type=checkbox]'); await saved()
    await page.waitForFunction(() => document.querySelector('.psi-panel-footer').textContent.includes('Sparat'))
    const value = await page.evaluate(number => window.fixture.data().invoices.find(i => i.invoiceNumber === number), number)
    assert.equal(value.invoiceDate, '2026-11-18'); assert.equal(value.attachments.length, 1); assert.equal(value.approvalStatus, 'approved')
    return value
  }
  const agreement = async (key, name) => {
    await click('Hämta överenskommelse'); await fill('ÄTA eller avtalad del', key)
    await fill('Godkänt av beställare', 'Fiktiv beställare'); await fill('Hänvisning till beställning / avtal / mejl', 'Fiktivt godkännande, låst testavtal / ÄTA')
    await click('Bekräfta'); await closeDrawer(); await saved()
    await fill('ÄTA eller avtalsdel', await page.evaluate(name => window.fixture.billing().flow.agreements.find(a => a.title === name).id, name))
  }
  try {
    await page.setViewport({ width: 1440, height: 1000 }); await page.goto(base, { waitUntil: 'networkidle0' }); await page.waitForSelector('.psi')
    const protectedBefore = await page.evaluate(() => window.fixture.protected())
    const source = await createInvoice('CHAIN-BUDGET', '10000', '2500', `item:${id(10)}`)
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: resolve(output, `workflow-${width}.png`), fullPage: true })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      assert.equal(await page.$$eval('.psi-progress li', nodes => nodes.length), 4)
    }
    await page.setViewport({ width: 1440, height: 1000 })
    await click('Stäng'); await closeDrawer(); await page.evaluate(() => window.fixture.legacyIds())
    await page.reload({ waitUntil: 'networkidle0' }); await click('Fiktiv leverantör ABCHAIN-BUDGET')
    const revisionBefore = await page.evaluate(() => window.fixture.data().invoices[0].revision)
    await saved()
    assert.equal(await page.evaluate(() => window.fixture.data().invoices[0].revision), revisionBefore, 'Opening an old invoice is read-only')
    await click('Fortsätt till fakturering'); await page.waitForSelector('.gbf-supplier-handoff'); await saved()
    assert.ok(await page.evaluate(() => window.fixture.data().invoices[0].allocations.every(a => a.id)), 'Explicit continuation gives old allocations stable identities without changing amounts')
    assert.equal(await page.evaluate(() => localStorage.getItem('supplier-invoice:00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000001:pending')), null, 'Confirmed handoff clears the recovery index')
    assert.equal(await page.evaluate(() => window.fixture.billing().revision), 0, 'Navigation does not activate billing')
    await agreement(`base:${id(10)}:combined`, 'Grundarbete')
    await click('Koppla kostnadsdel'); await page.waitForFunction(() => window.fixture.billing().flow.costs.length === 1 && document.querySelector('[data-testid=dirty]').textContent === 'clean')
    assert.equal(await page.$eval('input[inputmode=decimal]', e => e.value), '10000')
    await click('Granska och gör fakturerbart'); await closeDrawer(); await saved()
    let flow = await page.evaluate(() => window.fixture.billing().flow)
    assert.equal(flow.costs[0].internalNetOre, 1000000); assert.equal(flow.entries[0].netOre, 1150000)
    const budget = await page.$eval('[aria-label="Kundens budgetuppföljning"]', e => e.textContent)
    assert.match(budget, /12\s?500,00/); assert.match(budget, /11\s?500,00/); assert.match(budget, /Avstämning krävs/)
    await click('Öppna kopplad kostnad'); await click('Stäng'); await closeDrawer()
    assert.equal(await page.evaluate(() => window.fixture.billing().flow.costs.length), 1, 'Reopening does not duplicate the source')
    await click('Dokumentera avstämning'); await fill('Bedömd återstående kunddebitering exkl. moms', '500')
    await fill('Deltagare i avstämningen', 'Fiktiv kund och projektansvarig'); await fill('Besked om omfattning, kostnader och fortsatt arbete', 'Fortsätt enligt avstämd omfattning')
    await fill('Hänvisning till kundens besked', 'Fiktivt mejl 2026-11-18'); await click('Bekräfta'); await closeDrawer(); await saved()
    await page.screenshot({ path: resolve(output, 'budget-followup.png'), fullPage: true })
    await click('Att fakturera'); await page.click(`input[aria-label="Välj ${flow.entries[0].description}"]`)
    await click('Skapa fakturaunderlag'); await fill('Rubrik', 'Kedjeprov budget'); await click('Bekräfta'); await closeDrawer(); await saved()
    flow = await page.evaluate(() => window.fixture.billing().flow)
    assert.equal(flow.bases[0].lines[0].netOre, 1150000)
    assert.ok(!JSON.stringify(flow.bases).includes('Intern anteckning'))
    await click('Underlag och fakturor')
    const pdfResponse = page.waitForResponse(r => r.url().endsWith('/preview-invoice-basis-pdf'))
    await page.click('button[aria-label="PDF Kedjeprov budget"]'); assert.equal((await pdfResponse).status(), 200); await saved()
    let downloaded
    for (let n = 0; n < 100 && !downloaded; n++) { downloaded = (await readdir(downloadPath)).find(f => f.endsWith('.pdf')); if (!downloaded) await new Promise(r => setTimeout(r, 100)) }
    assert.ok(downloaded); assert.equal((await PDFDocument.load(await readFile(resolve(downloadPath, downloaded)))).getPageCount(), 1)
    await click('Registrera Fortnox-faktura'); await fill('Fortnox fakturanummer', 'FIKTIV-KUND-1')
    await page.click(`input[aria-label="Fakturera ${flow.entries[0].description}"]`)
    await page.evaluate(() => [...document.querySelectorAll('[role=dialog] input[type=checkbox]')].at(-1).click())
    await click('Bekräfta fakturering'); await closeDrawer(); await saved()
    assert.equal(await page.evaluate(() => window.fixture.billing().flow.invoices.length), 1)

    await tab('Leverantörsfakturor'); await createInvoice('CHAIN-FIXED', '6660', '1665', `item:${id(11)}`)
    assert.match(await page.$eval('.psi-result', e => e.textContent), /fastprisdel.*inte extra kunddebitering/)
    await click('Fortsätt till fakturering'); await agreement(`base:${id(11)}:combined`, 'Byggarbete fast pris')
    await click('Koppla kostnadsdel'); await page.waitForFunction(() => window.fixture.billing().flow.costs.length === 2 && document.querySelector('[data-testid=dirty]').textContent === 'clean')
    await click('Bekräfta granskning'); await closeDrawer(); await saved()
    assert.equal(await page.evaluate(() => window.fixture.billing().flow.entries.length), 1, 'Fixed-price supplier cost never adds customer billing')

    await tab('Leverantörsfakturor'); await createInvoice('CHAIN-ATA', '4000', '1000', `change:${id(12)}`)
    await click('Fortsätt till fakturering'); await agreement(`change:${id(12)}:running`, 'Extra vägg')
    await click('Koppla kostnadsdel'); await page.waitForFunction(() => window.fixture.billing().flow.costs.length === 3 && document.querySelector('[data-testid=dirty]').textContent === 'clean')
    await click('Granska och gör fakturerbart'); await closeDrawer(); await saved()
    assert.equal(await page.evaluate(() => window.fixture.billing().flow.entries.at(-1).netOre), 440000)

    await tab('Leverantörsfakturor'); await createInvoice('CHAIN-CREDIT', '1000', '250', `change:${id(12)}`, true)
    await click('Fortsätt till fakturering'); await fill('ÄTA eller avtalsdel', await page.evaluate(() => window.fixture.billing().flow.agreements.find(a => a.title === 'Extra vägg').id))
    await click('Koppla kostnadsdel'); await page.waitForFunction(() => window.fixture.billing().flow.costs.length === 4 && document.querySelector('[data-testid=dirty]').textContent === 'clean')
    await click('Granska och gör fakturerbart'); await closeDrawer(); await saved()
    assert.equal(await page.evaluate(() => window.fixture.billing().flow.entries.at(-1).netOre), -110000)
    await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.psi-open')
    assert.equal(await page.evaluate(() => window.fixture.data().invoices.length), 4)
    assert.equal(await page.evaluate(() => window.fixture.billing().flow.bases[0].lines[0].netOre), 1150000)
    assert.equal(await page.evaluate(id => window.fixture.data().invoices.find(i => i.id === id).allocations[0].amountOre, source.id), 1000000)
    await click('Fiktiv leverantör ABCHAIN-BUDGET')
    assert.equal(await page.$eval('.psi-panel label input', e => e.disabled), true, 'Reviewed billing protects the supplier header in the UI too')
    assert.equal(await page.$eval('.psi-allocation select', e => e.disabled), true)
    assert.match(await page.$eval('.psi-allocation', e => e.textContent), /Rättning hanteras under Fakturering/)
    assert.deepEqual(await page.evaluate(() => window.fixture.protected()), protectedBefore)
    assert.deepEqual(errors, [])
    console.log('CHAIN passed: upload -> allocation -> reviewed cost -> 15% fee -> 80% budget review -> frozen basis PDF -> invoice registration; fixed cost without extra billing; running ATA with 10%; credit; duplicate-safe reopen; reload; unchanged contract/calculation/prices.')
  } catch (e) {
    await page.screenshot({ path: resolve(output, 'chain-failure.png'), fullPage: true })
    await writeFile(resolve(output, 'chain-failure.txt'), await page.evaluate(() => JSON.stringify({ body: document.body.innerText, calls: window.fixture.calls, billing: window.fixture.billing() }, null, 2)))
    throw e
  } finally { await browser.close() }
}
