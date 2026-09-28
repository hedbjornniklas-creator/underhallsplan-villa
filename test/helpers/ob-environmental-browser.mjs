import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testEnvironmental(base, output) {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  page.on('dialog', dialog => { assert.equal(dialog.type(), 'beforeunload'); void dialog.accept() })
  await page.setRequestInterception(true)
  page.on('request', request => request.url().startsWith(base) || request.url().startsWith('data:') ? request.continue() : request.abort())
  const field = label => page.evaluateHandle(label => [...document.querySelectorAll('label')].find(n => n.querySelector('span')?.textContent === label).querySelector('input,textarea,select'), label)
  const button = text => page.evaluateHandle(text => [...document.querySelectorAll('button')].find(n => n.textContent.trim() === text), text)
  const ready = () => page.waitForSelector('.ob-env-fields')
  const saved = () => page.waitForFunction(() => document.querySelector('.ob-env-save [role=status]')?.textContent === 'Sparat')
  try {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewport({ width, height: 900 })
      for (const kind of ['radon', 'mould']) {
        await page.goto(`${base}/?kind=${kind}`, { waitUntil: 'networkidle0' }); await ready()
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${kind}`)
        await page.screenshot({ path: resolve(output, `${kind}-${width}.png`), fullPage: true })
        await page.evaluate(() => document.documentElement.setAttribute('data-large-text', ''))
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `large ${width} ${kind}`)
      }
    }
    await page.goto(`${base}/?kind=mould`); await ready()
    await page.setViewport({ width: 390, height: 844 })
    await page.evaluate(() => { window.environmentalTest.delay = 1000 })
    const result = await field('Laboratoriets resultat')
    await result.click(); await result.type('Syntetiskt provsvar')
    const before = await page.evaluate(() => ({ y: scrollY, height: document.body.scrollHeight }))
    await saved()
    const after = await page.evaluate(() => ({ y: scrollY, height: document.body.scrollHeight }))
    assert.deepEqual(after, before, 'Autosave changed scroll or layout')
    assert.ok(await result.evaluate(n => document.activeElement === n), 'Autosave lost focus')
    await result.type(' med tillägg'); await saved()
    assert.match(await page.evaluate(() => window.environmentalTest.state('mould').document.rows[0].fields.result), /med tillägg/)
    await (await button('Lägg till plats')).click(); await saved()
    await page.click('[aria-label="Ta bort plats 2"]'); await page.waitForSelector('dialog[open]')
    await (await button('Avbryt')).click()
    assert.equal(await page.$$eval('.ob-env-row', n => n.length), 2)
    await page.click('[aria-label="Ta bort plats 2"]'); await (await button('Ta bort plats')).click(); await saved()
    assert.equal(await page.$$eval('.ob-env-row', n => n.length), 1)
    await page.evaluate(async () => {
      const input = document.querySelector('input[type=file]'), transfer = new DataTransfer()
      transfer.items.add(new File(['%PDF-synthetic'], 'Analys.pdf', { type: 'application/pdf' })); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.waitForSelector('[aria-label="Koppla bort Analys.pdf"]'); await saved()
    await page.click('[aria-label="Koppla bort Analys.pdf"]'); await saved()
    await page.evaluate(() => document.querySelector('.ob-env-files + details').open = true)
    await page.click('[aria-label="Bifoga Analys.pdf"]'); await saved()
    await page.evaluate(() => { window.environmentalTest.fail = true; window.environmentalTest.delay = 10 })
    await (await field('Bedömning / kommentar')).type('Bevara vid nätfel')
    await page.waitForFunction(() => document.querySelector('.ob-env-save').textContent.includes('Ej sparat'))
    assert.ok(await page.evaluate(() => Object.keys(localStorage).some(k => k.includes('environmental:mould'))))
    await page.reload(); await ready(); await saved()
    assert.equal(await page.evaluate(() => window.environmentalTest.state('mould').document.fields.comment), 'Bevara vid nätfel')
    await page.evaluate(() => { window.environmentalTest.conflict = true })
    await (await field('Bedömning / kommentar')).type(' konflikt')
    await page.waitForSelector('dialog[aria-label="Välj protokollversion"][open]')
    assert.ok(await page.evaluate(() => Object.keys(localStorage).some(k => k.includes('environmental:mould'))))
    await page.evaluate(() => { window.environmentalTest.conflict = false })
    await (await button('Spara mitt utkast')).click(); await saved()
    await page.goto(`${base}/?kind=mould&locked`); await ready()
    assert.equal(await page.$eval('.ob-env-fields', n => n.disabled), true)
    assert.deepEqual(await page.evaluate(() => window.environmentalTest.writes), [])
    await page.setViewport({ width: 1440, height: 1000 })
    for (const suffix of ['report', 'report&long']) {
      await page.goto(`${base}/?${suffix}`, { waitUntil: 'networkidle0' })
      await page.waitForFunction(() => document.querySelector('[data-report-pagination-ready="1"]'))
      const pages = await page.$$eval('.report-page', nodes => nodes.map(n => ({ text: n.innerText, height: n.getBoundingClientRect().height })))
      assert.ok(pages.every(p => p.height < 1130), 'Oversized PDF page')
      const text = pages.map(p => p.text).join('\n')
      assert.match(text, /Radonindikering/); assert.match(text, /Mögelprov/)
      if (suffix.includes('long')) assert.match(text, /SLUT PÅ PROVRESULTAT/)
      await page.pdf({ path: resolve(output, suffix.includes('long') ? 'protocols-long.pdf' : 'protocols.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true })
      for (let index = 0; index < pages.length; index++) await (await page.$$('.report-page'))[index].screenshot({ path: resolve(output, `${suffix.includes('long') ? 'long' : 'pdf'}-${index + 1}.png`) })
    }
    assert.deepEqual(errors, [])
    console.log('Browser checks passed: 4 widths, 200% text, autosave focus/scroll, delete confirmation, upload/detach/reattach, network recovery, conflict, locked inspection, PDF pagination and long results.')
  } finally { await browser.close() }
}
