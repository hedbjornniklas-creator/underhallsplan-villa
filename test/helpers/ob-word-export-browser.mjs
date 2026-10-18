import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { resolve } from 'node:path'

export async function testWordExport(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => request.url().startsWith(base) || request.url().startsWith('data:') || request.url().startsWith('blob:') ? request.continue() : request.abort())
  try {
    for (const width of [320, 390, 1280]) for (const published of [false, true]) {
      await page.setViewport({ width, height: 900 })
      await page.goto(`${base}/round?section=delivery&word${published ? '&published&locked&completed' : ''}`, { waitUntil: 'networkidle0' })
      const button = 'button[title^="Word-kopia"]'
      await page.waitForSelector(button)
      assert.equal(await page.$eval(button, node => node.textContent.trim()), 'Ladda ner Word')
      assert.ok(await page.$eval(button, node => node.parentElement.textContent.includes('Publicerad version') || node.parentElement.textContent.includes('Aktuellt utkast')))
      await page.evaluate(() => { window.__obFormTest.failSaves = true; window.__obFormTest.saveDelay = 500 })
      await page.click(button)
      assert.equal(await page.$eval(button, node => node.disabled), true)
      await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes('Word-filen kunde inte skapas'))
      assert.equal(await page.$eval(button, node => node.disabled), false)
      await page.evaluate(() => { window.__obFormTest.failSaves = false })
      await page.click(button)
      await page.waitForFunction(() => document.querySelector('button[title^="Word-kopia"]')?.getAttribute('aria-busy') === 'false')
      assert.equal((await page.$$('[role="alert"]')).length, 0)
      const state = await page.evaluate(() => ({ requests: window.__obFormTest.wordRequests, writes: window.__obFormTest.writes }))
      assert.equal(state.requests.length, 2)
      assert.ok(state.requests.every(url => url.includes(published ? 'report=selected' : 'draft=1')))
      assert.deepEqual(state.writes, [])
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await page.screenshot({ path: resolve(output, `word-${published ? 'published' : 'draft'}-${width}.png`), fullPage: false })
    }
    assert.deepEqual(errors, [])
    console.log('Word download: real delivery UI at 320/390/1280, draft/published version, busy, error/retry and zero writes passed.')
  } finally { await browser.close() }
}
