import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testDiaryOptionalTime(base, output) {
  output = resolve(process.env.DIARY_TEST_OUTPUT || output)
  await mkdir(output, { recursive: true })
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  try {
    const page = await browser.newPage(), errors = [], submissions = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('dialog', dialog => { if (dialog.type() !== 'beforeunload') errors.push(`Unexpected dialog: ${dialog.message()}`); void dialog.accept() })
    await page.setRequestInterception(true)
    page.on('request', request => {
      const url = new URL(request.url())
      if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) { errors.push(`Unexpected external request: ${url.origin}`); void request.abort() }
      else {
        if (request.method() === 'POST' && request.postData()) {
          const data = JSON.parse(request.postData())
          if (['entry', 'revision'].includes(data.operation)) submissions.push(data)
        }
        void request.continue()
      }
    })
    const field = async (label, value) => page.evaluate((label, value) => {
      const input = [...document.querySelectorAll('.diary-entry-form label')].find(node => node.childNodes[0]?.textContent.trim() === label)?.querySelector('input,textarea')
      if (!input) throw Error(`Missing input: ${label}`)
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }))
    }, label, value)
    const click = async (text, selector = 'button') => {
      for (const node of await page.$$(selector)) if ((await node.evaluate(el => el.textContent.trim())) === text) { await node.click(); return }
      throw Error(`Missing control: ${text}`)
    }
    const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const fixture = await (await fetch(`${base}/fixture`)).json()
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
    await page.goto(fixture.publicUrl, { waitUntil: 'networkidle0' })
    await page.select('.diary-person-picker select', fixture.public.people[0].id)
    await page.waitForSelector('.diary-entry-form')
    assert.deepEqual(await page.$$eval('.diary-time-grid input', nodes => nodes.map(n => n.required)), [true, false, false])
    await field('Utfört arbete', 'Fiktiv anteckning utan arbetstid.')
    await field('Från (ca, valfritt)', '0700')
    await click('Skicka anteckning')
    await page.waitForSelector('.diary-error')
    assert.equal(submissions.length, 0)
    await field('Från (ca, valfritt)', '')
    await noOverflow()
    await page.screenshot({ path: resolve(output, 'optional-time-mobile.png'), fullPage: true })
    await fetch(`${base}/test/control`, { method: 'POST', body: JSON.stringify({ fail: true }) })
    await click('Skicka anteckning')
    await page.waitForFunction(() => document.body.textContent.includes('Försök igen med samma uppgifter.'))
    await page.reload({ waitUntil: 'networkidle0' })
    await click('Återställ utkast')
    await page.waitForSelector('.diary-entry-form')
    assert.equal(await page.$eval('textarea', node => node.value), 'Fiktiv anteckning utan arbetstid.')
    await fetch(`${base}/test/control`, { method: 'POST', body: '{}' })
    await click('Försök igen')
    await page.waitForSelector('.diary-receipt')
    assert.equal(submissions.length, 2)
    assert.deepEqual(submissions[1], submissions[0])
    assert.equal(submissions[0].body.startTime, ''); assert.equal(submissions[0].body.endTime, '')
    assert.doesNotMatch(await page.$eval('.diary-receipt', node => node.textContent), /Tid på plats|0 tim/)
    await page.setViewport({ width: 1280, height: 960 })
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.diary-record')
    assert.equal(await page.$$eval('.diary-record[open]', nodes => nodes.length), 0)
    await page.click('.diary-record summary')
    assert.doesNotMatch(await page.$eval('.diary-record', node => node.textContent), /Tid på plats|0 tim/)
    await click('Redigera', '.diary-record button')
    await page.waitForSelector('dialog[open] .diary-entry-form')
    await field('Från (ca, valfritt)', '0900'); await field('Till (ca, valfritt)', '1000')
    await click('Spara ändring')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    assert.ok((await page.$eval('.diary-record', node => node.textContent)).includes('09:00–10:00'))
    await click('Redigera', '.diary-record button')
    await page.waitForSelector('dialog[open] .diary-entry-form')
    await field('Från (ca, valfritt)', ''); await field('Till (ca, valfritt)', '')
    await click('Spara ändring')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    assert.doesNotMatch(await page.$eval('.diary-record .diary-record-meta', node => node.textContent), /Tid på plats/)
    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForSelector('.diary-record')
    await page.click('.diary-record summary')
    await page.click('.diary-record .diary-history summary')
    await page.waitForFunction(() => document.querySelector('.diary-record').textContent.includes('09:00–10:00'))
    await noOverflow()
    await page.screenshot({ path: resolve(output, 'optional-time-history-desktop.png'), fullPage: true })
    await click('Ny anteckning')
    await page.select('.diary-person-picker select', fixture.public.people[1].id)
    await page.waitForSelector('.diary-entry-form')
    await field('Utfört arbete', 'Intern anteckning utan tid.')
    await page.screenshot({ path: resolve(output, 'optional-time-desktop.png'), fullPage: true })
    await click('Skicka anteckning')
    await page.waitForSelector('.diary-receipt')
    assert.doesNotMatch(await page.$eval('.diary-receipt', node => node.textContent), /Tid på plats|0 tim/)
    assert.equal((await (await fetch(`${base}/fixture`)).json()).publicUrl, fixture.publicUrl)
    assert.deepEqual(errors, [])
    console.log('Diary optional-time UI passed: mobile QR, partial interval rejected, failed save + restored exact retry, internal entry, time added/removed, history, reload and unchanged QR link.')
  } finally { await browser.close() }
}
