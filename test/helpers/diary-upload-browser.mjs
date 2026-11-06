import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import sharp from 'sharp'

export async function testDiaryUpload(base, output) {
  const tiny = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#f2d76a' } }).jpeg().toBuffer()
  const file = resolve(output, 'synthetic-original-5mb.jpg')
  const secondFile = resolve(output, 'synthetic-original-5mb-second.jpg')
  const original = Buffer.concat([tiny, Buffer.alloc(5 * 1024 * 1024 - tiny.length)])
  await writeFile(file, original); await writeFile(secondFile, original)
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  try {
    const page = await browser.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setRequestInterception(true)
    page.on('request', request => {
      const url = new URL(request.url())
      if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) { errors.push(`Unexpected external request: ${url.origin}`); void request.abort() }
      else void request.continue()
    })
    const control = data => fetch(`${base}/test/control`, { method: 'POST', body: JSON.stringify(data) })
    const click = async text => {
      for (const button of await page.$$('button')) if ((await button.evaluate(node => node.textContent.trim())) === text) { await button.click(); return }
      throw Error(`Missing button: ${text}`)
    }
    const field = async (text, value) => page.evaluate((text, value) => {
      const input = [...document.querySelectorAll('label')].find(node => node.childNodes[0]?.textContent.trim() === text)?.querySelector('input,textarea')
      if (!input) throw Error(`Missing input: ${text}`)
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }))
    }, text, value)
    const fixture = await (await fetch(`${base}/fixture`)).json()
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
    await page.goto(fixture.publicUrl, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.body.textContent.includes('Anna Exempel'))
    await page.select('.diary-person-picker select', fixture.public.people[0].id)
    await page.waitForSelector('.diary-entry-form')
    await field('Från (ca)', '0700'); await field('Till (ca)', '1600'); await field('Utfört arbete', 'Fiktivt nätverkstest. Inga verkliga uppgifter.')
    await control({ blockDirect: true, blockParts: true })
    await (await page.$('input[type=file][multiple]')).uploadFile(file, secondFile)
    await page.waitForFunction(() => document.querySelectorAll('.diary-upload-list li').length === 2 && document.body.textContent.includes('Försök igen med alla bilder'))
    assert.equal(await page.$eval('.diary-form-footer button', node => node.disabled), true)
    assert.ok((await page.$eval('textarea', node => node.value)).includes('Fiktivt nätverkstest'))
    assert.ok(!(await page.$eval('body', node => node.textContent)).includes('Failed to fetch'))
    await page.screenshot({ path: resolve(output, 'upload-errors-mobile.png'), fullPage: true })
    await control({ blockDirect: true })
    await click('Försök igen med alla bilder')
    await page.waitForFunction(() => [...document.querySelectorAll('.diary-upload-list li')].every(node => node.textContent.includes('Bilden är sparad')), { timeout: 60000 })
    const metrics = await (await fetch(`${base}/test/metrics`)).json()
    assert.equal(metrics.relayedParts, 6); assert.equal(metrics.maxPartBytes, 2 * 1024 * 1024)
    assert.ok(metrics.maxConcurrent <= 3)
    assert.equal(metrics.entryCount, 1)
    assert.equal(await page.$eval('.diary-form-footer button', node => node.disabled), false)
    assert.ok((await page.$eval('textarea', node => node.value)).includes('Fiktivt nätverkstest'))
    await page.screenshot({ path: resolve(output, 'upload-recovered-mobile.png'), fullPage: true })
    await click('Skicka anteckning')
    await page.waitForSelector('.diary-receipt')
    const after = await (await fetch(`${base}/test/metrics`)).json()
    assert.equal(after.entryCount, 2); assert.equal(after.latestPhotoCount, 2)
    await page.screenshot({ path: resolve(output, 'upload-receipt-mobile.png'), fullPage: true })
    assert.deepEqual(errors, [])
    console.log('Diary UI passed: two original 5 MB photos, blocked direct upload, failed relay, retained text, retry-all, bounded parts, one receipt.')
  } finally { await browser.close() }
}
