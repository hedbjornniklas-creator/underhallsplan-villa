import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

export async function testTuNavigation(base) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    for (const width of [390, 1440]) {
      await page.setViewport({ width, height: 1000 })
      await page.goto(`${base}/?state=sent`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('button[aria-label="Till TU-översikten"]')
      await page.click('button[aria-label="Till TU-översikten"]')
      assert.equal(await page.$eval('#navigation-result', node => node.textContent), '/tu?orgId=11111111-1111-4111-8111-111111111111')
      await page.goto(`${base}/?view=list&state=sent`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('.tu-overview tr[data-row-id]')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    }
    await page.goto(`${base}/?view=delete&state=locked`, { waitUntil: 'networkidle0' })
    assert.equal(await page.$eval('button[title="Låsta utlåtanden kan inte raderas"]', node => node.disabled), true)
    assert.equal(await page.$eval('#request-count', node => node.textContent), '0')
    await page.goto(`${base}/?view=delete`, { waitUntil: 'networkidle0' })
    await page.click('button[title="Radera utredning"]')
    await page.waitForSelector('dialog[open]')
    assert.match(await page.$eval('dialog', node => node.textContent), /Syntetisk testutredning/)
    await page.click('dialog button:first-child')
    assert.equal(await page.$eval('#request-count', node => node.textContent), '0', 'Cancel sends no delete request')
    await page.click('aside label:first-of-type input')
    await page.click('button[title="Radera utredning"]')
    await page.click('dialog button:last-child')
    await page.waitForFunction(() => document.body.textContent.includes('Utredningen kunde inte raderas.'))
    assert.equal(await page.$eval('#navigation-result', node => node.textContent), '', 'Failed deletion stays on the investigation')
    assert.equal(await page.$eval('body', node => node.textContent.includes('internal diagnostics')), false)
    await page.click('aside label:first-of-type input')
    await page.click('aside label:nth-of-type(2) input')
    await page.click('button[title="Radera utredning"]')
    await page.click('dialog button:last-child')
    assert.equal(await page.$eval('dialog button:last-child', node => node.disabled), true)
    await page.waitForFunction(() => document.querySelector('#navigation-result').textContent.startsWith('/tu?'))
    assert.equal(await page.$eval('#request-count', node => node.textContent), '2', 'One failed and one successful deletion')
    assert.equal(await page.$eval('#navigation-result', node => node.textContent), '/tu?orgId=11111111-1111-4111-8111-111111111111')
    assert.deepEqual(errors, [])
    console.log('TU navigation: desktop/mobile back link and overview, locked deletion, confirmation, cancel, error, busy and successful deletion passed (synthetic only).')
  } finally { await browser.close() }
}
