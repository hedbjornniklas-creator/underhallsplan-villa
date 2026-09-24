import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testAcceptedTerms(base, output, documents, previewPdf) {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  })
  const page = await browser.newPage()
  const errors = []
  const writes = []
  const dialogs = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss() })
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.method() + ' ' + request.url()) })
  const pdfRequests = []
  page.on('request', request => { if (request.url().endsWith('/pdf')) pdfRequests.push(request.url()) })
  await page.evaluateOnNewDocument(() => {
    const create = URL.createObjectURL.bind(URL)
    URL.createObjectURL = blob => {
      window.downloadedBlob = blob
      return create(blob)
    }
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[download]')
      if (link) window.downloadedFilename = link.download
    })
  })
  try {
    for (const role of ['buyer', 'seller', 'apartment']) {
      for (const width of [390, 1440]) {
        await page.setViewport({ width, height: 1000 })
        await page.goto(`${base}/details?terms=${role}`, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('[aria-label="Godkänd villkorstext"]')
        assert.equal(await page.$eval('[aria-label="Godkänd villkorstext"]', node => node.textContent), documents[role].text)
        assert.equal(await page.$eval('#approved-terms', node => Boolean(node.closest('fieldset:disabled'))), false)
        assert.equal(await page.$eval('fieldset[aria-label="Uppdragsdata"]', node => node.disabled), true)
        await page.click('a[href="#approved-terms"]')
        await page.waitForFunction(() => document.querySelector('#approved-terms').getBoundingClientRect().top < innerHeight)
        assert.equal(await page.$eval('#approved-terms', node => node.scrollWidth > node.clientWidth + 1), false)
        assert.equal(await page.$eval('[aria-label="Godkänd villkorstext"]', node => node.scrollWidth > node.clientWidth + 1), false)
        await page.screenshot({ path: resolve(output, `terms-${role}-${width}.png`) })
        if (role === 'buyer') {
          const before = pdfRequests.length
          await page.$eval('#approved-terms button[title]', button => { button.click(); button.click() })
          await page.waitForFunction(() => Boolean(window.downloadedBlob && window.downloadedFilename))
          assert.equal(pdfRequests.length - before, 1, 'double click must request a single download')
          assert.equal(await page.evaluate(() => window.downloadedFilename), 'Synthetic-original.pdf')
          const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.downloadedBlob.arrayBuffer())))
          assert.deepEqual(Buffer.from(bytes), previewPdf, 'download uses byte-identical archived original')
        }
        await page.$eval('[aria-label="Godkänd villkorstext"]', node => { node.scrollTop = node.scrollHeight })
        assert.equal(await page.$eval('[aria-label="Godkänd villkorstext"]', node => node.scrollHeight - node.scrollTop <= node.clientHeight + 1), true)
      }
    }
    for (const scenario of ['missing', 'mismatch']) {
      await page.goto(`${base}/details?terms=${scenario}`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => document.querySelector('#approved-terms')?.textContent.includes('Godkännandet har inte ändrats.'))
      assert.equal(await page.$('[aria-label="Godkänd villkorstext"]'), null)
      assert.equal(await page.$eval('#approved-terms', node => node.textContent.includes('Godkännandet har inte ändrats.')), true)
      await page.click('#approved-terms button[title]')
      await page.waitForFunction(() => document.body.textContent.includes('Historiska dokument återskapas inte.'))
      assert.equal(await page.evaluate(() => Boolean(window.downloadedBlob)), false)
    }
    await page.goto(`${base}/details?terms=retry`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#approved-terms [role="alert"]')
    let detailReloads = 0
    page.on('request', request => { if (request.url() === `${base}/api/ob/assignments/synthetic-assignment`) detailReloads++ })
    await page.click('#approved-terms button')
    await page.waitForSelector('[aria-label="Godkänd villkorstext"]')
    assert.equal(detailReloads, 0, 'retry must not reset assignment form')
    await page.goto(`${base}/details`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('fieldset[aria-label="Uppdragsdata"]')
    assert.equal(await page.$('#approved-terms'), null, 'sent but unaccepted assignment has no approved terms')
    assert.deepEqual(writes, [], 'reading or retrying terms must never save, send mail or change approval')
    await page.setViewport({ width: 390, height: 1000 })
    await page.goto(`${base}/details?terms=mail-failed`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelector('#approved-terms')?.textContent.includes('kunde inte bekräftas'))
    await page.click('a[href="#approved-terms"]')
    await page.screenshot({ path: resolve(output, 'terms-mail-failed-390.png') })
    await page.$$eval('#approved-terms button', buttons => {
      const retry = buttons.find(button => button.textContent.includes('Försök skicka igen'))
      retry.click(); retry.click()
    })
    await page.waitForFunction(() => document.querySelector('#approved-terms')?.textContent.includes('har skickats till beställaren'))
    assert.deepEqual(writes, [`POST ${base}/api/ob/assignments/synthetic-assignment/confirmation`])
    assert.deepEqual(errors, [])
    assert.deepEqual(dialogs, [])
    console.log('Accepted terms UI: 6 desktop/mobile layouts, byte-identical PDF downloads, 2 legacy states, load retry, mail retry/deduplication and no unintended writes passed.')
  } catch (error) {
    await page.screenshot({ path: resolve(output, 'terms-failure.png'), fullPage: true })
    console.error({ errors, writes, dialogs, url: page.url() })
    throw error
  } finally { await browser.close() }
}
