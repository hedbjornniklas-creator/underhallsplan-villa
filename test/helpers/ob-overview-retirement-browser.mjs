import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testOverviewRetirement(base, output, widths = [320, 390, 1280]) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  try {
    for (const width of widths) {
      await page.setViewport({ width, height: 900 })
      await page.goto(`${base}/ob?manage`, { waitUntil: 'networkidle0' })
      await page.waitForFunction(() => document.querySelector('.obo')?.getAttribute('aria-busy') === 'false')
      assert.equal((await page.$$('.obh-list-links')).length, 0)
      await page.select('.obo-page-size select', '25')
      await page.waitForFunction(() => window.__obOverviewTest.urls.at(-1).includes('pageSize=25') && document.querySelector('.obo')?.getAttribute('aria-busy') === 'false')
      const draft = '[data-row-id="assignment:assignment-4"]'
      await page.click(`${draft} .obo-row-toggle`)
      const actions = `${draft} + .obo-detail-row .obo-assignment-actions`
      await page.waitForSelector(actions)
      await page.click(`${actions} > button:first-child`)
      await page.waitForSelector('.obo-assignment-dialog[open]')
      assert.equal(await page.$eval('.obo-assignment-dialog[open]', dialog => dialog.querySelector('button') === document.activeElement), true)
      assert.ok(await page.$eval('.obo-assignment-dialog[open]', dialog => dialog.scrollWidth <= dialog.clientWidth))
      await page.screenshot({ path: resolve(output, `archive-dialog-${width}.png`) })
      await page.keyboard.press('Escape')
      assert.equal(await page.evaluate(() => window.overviewMutationQa.requests.length), 0, 'Dismissal does not mutate')
      await page.click(`${actions} > button:first-child`)
      await page.click('.obo-assignment-dialog[open] > div button:last-child')
      await page.waitForFunction(() => !document.querySelector('[data-row-id="assignment:assignment-4"]'))
      const archive = await page.evaluate(() => window.overviewMutationQa.requests.at(-1))
      assert.equal(archive.url, '/api/ob/assignments/assignment-4?orgId=11111111-1111-4111-8111-111111111111')
      assert.deepEqual(Object.keys(archive.body), ['archived_at'])
      assert.ok(Date.parse(archive.body.archived_at))
      await page.click('.obo-check:last-child input')
      await page.waitForSelector(draft)
      await page.click(`${draft} .obo-row-toggle`)
      await page.waitForSelector(actions)
      assert.match(await page.$eval(`${actions} > button:first-child`, button => button.textContent), /Återför/)
      await page.click(`${actions} > button:first-child`)
      await page.click('.obo-assignment-dialog[open] > div button:last-child')
      await page.waitForFunction(() => {
        const state = document.querySelector('[data-row-id="assignment:assignment-4"] .obo-state')?.textContent
        return state?.includes('Utkast') && !state.includes('Arkiverad') && document.querySelector('.obo')?.getAttribute('aria-busy') === 'false'
      })
      assert.deepEqual(await page.evaluate(() => window.overviewMutationQa.requests.at(-1).body), { archived_at: null })
      await page.click('.obo-check:last-child input')
      await page.waitForFunction(() => !document.querySelector('.obo-check:last-child input').checked && document.querySelector('.obo')?.getAttribute('aria-busy') === 'false')
      // Refresh keeps the same row component and its expanded state.
      if (!(await page.$(`${actions} > button`))) await page.click(`${draft} .obo-row-toggle`)
      await page.click(`${actions} > button:last-of-type`)
      await page.click('.obo-assignment-dialog[open] > div button:last-child')
      await page.waitForFunction(() => !document.querySelector('[data-row-id="assignment:assignment-4"]'))
      const cancel = await page.evaluate(() => window.overviewMutationQa.requests.at(-1))
      assert.equal(cancel.body.status, 'cancelled')
      assert.ok(cancel.body.archived_at)
      assert.equal(await page.evaluate(() => window.__obOverviewTest.writes), 0, 'No database or unrelated mutation')
      for (const close of await page.$$('button[aria-label="Stäng bekräftelse"]')) await close.click()
      const linked = '[data-row-id="inspection:inspection-1"]'
      await page.click(`${linked} .obo-row-toggle`)
      const linkedActions = `${linked} + .obo-detail-row .obo-assignment-actions`
      await page.waitForSelector(linkedActions)
      assert.equal(await page.$eval(`${linkedActions} > button:first-child`, button => button.disabled), true, 'Sent confirmation is not directly archived')
      await page.evaluate(() => { window.overviewMutationQa.fail = true; window.overviewMutationQa.delay = 800 })
      const requestsBeforeFailure = await page.evaluate(() => window.overviewMutationQa.requests.length)
      await page.click(`${linkedActions} > button:last-of-type`)
      await page.click('.obo-assignment-dialog[open] > div button:last-child')
      assert.equal(await page.$eval('.obo-assignment-dialog[open] > div button:last-child', button => button.disabled), true)
      await page.keyboard.press('Escape')
      assert.equal((await page.$$('.obo-assignment-dialog[open]')).length, 1, 'Pending request cannot be dismissed')
      await page.click('.obo-assignment-dialog[open] > div button:last-child')
      await page.waitForFunction(() => document.body.textContent.includes('Syntetiskt fel. Inget ändrades.'))
      assert.equal(await page.evaluate(() => window.overviewMutationQa.requests.length), requestsBeforeFailure + 1, 'Double submission is blocked')
      assert.equal((await page.$$('.obo-assignment-dialog[open]')).length, 0)
      assert.equal(await page.$eval(`${linked} .obo-state`, node => node.textContent.includes('Inväntar kund')), true)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: resolve(output, `retired-lists-${width}.png`), fullPage: true })
      console.log(JSON.stringify({ viewport: width, archive: 'passed', restore: 'passed', cancel: 'passed', errorsPreserveData: 'passed' }))
    }
    await page.setViewport({ width: 320, height: 900 })
    await page.goto(`${base}/ob?manage`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.querySelector('.obo')?.getAttribute('aria-busy') === 'false')
    await page.evaluate(() => document.documentElement.setAttribute('data-large-text', ''))
    await page.click('[data-row-id="assignment:assignment-4"] .obo-row-toggle')
    await page.waitForSelector('.obo-assignment-actions')
    assert.ok(await page.$eval('.obo-assignment-actions', node => node.scrollWidth <= node.clientWidth), 'Expanded commands reflow with enlarged text')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Expanded row reflows with enlarged text')
    await page.click('.obo-assignment-actions > button:first-child')
    await page.waitForSelector('.obo-assignment-dialog[open]')
    assert.ok(await page.$eval('.obo-assignment-dialog[open]', node => node.scrollWidth <= node.clientWidth), 'Dialog reflows with enlarged text')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: resolve(output, 'archive-dialog-large-320.png') })
    await page.keyboard.press('Escape')
    assert.equal(await page.evaluate(() => window.overviewMutationQa.requests.length), 0)
    assert.deepEqual(errors, [])
  } catch (error) {
    await page.screenshot({ path: resolve(output, 'retirement-failure.png'), fullPage: true })
    await page.screenshot({ path: resolve(output, 'retirement-failure-viewport.png') })
    console.error(JSON.stringify(await page.evaluate(() => ({
      width: innerWidth, pageWidth: document.documentElement.scrollWidth,
      rows: Array.from(document.querySelectorAll('[data-row-id]')).map(row => ({
        id: row.getAttribute('data-row-id'), expanded: row.querySelector('.obo-row-toggle')?.getAttribute('aria-expanded'),
        next: row.nextElementSibling?.className, actions: row.nextElementSibling?.querySelector('.obo-assignment-actions')?.textContent,
      })), requests: window.overviewMutationQa.requests,
      overflow: Array.from(document.querySelectorAll('body *')).filter(node => {
        const rect = node.getBoundingClientRect()
        return !node.closest('thead') && node.checkVisibility() && rect.width &&
          (rect.right > innerWidth + 1 || rect.left < -1 || node.scrollWidth > node.clientWidth + 1)
      }).slice(0, 15).map(node => ({ tag: node.tagName, class: node.className, width: node.getBoundingClientRect().width,
        contentWidth: node.scrollWidth, text: node.textContent.slice(0, 60) })),
    }))))
    throw error
  } finally { await browser.close() }
}
