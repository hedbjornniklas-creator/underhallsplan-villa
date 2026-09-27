import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function testDraftStatus(page, base, output) {
  const prefix = 'ob:text-draft:v1:ob:feedback:mobile-round:'
  const status = '.ob-draft-status'
  const bounds = () => page.evaluate(() => {
    const button = document.querySelector('.ob-draft-status').getBoundingClientRect()
    const field = document.querySelector('textarea').getBoundingClientRect()
    return { x: button.x, y: button.y, width: button.width, height: button.height, fieldY: field.y, scroll: scrollY }
  })
  for (const width of [320, 390, 1280]) {
    await page.setViewport({ width, height: 820 })
    await page.goto(base + '/draft-feedback', { waitUntil: 'networkidle0' })
    await page.evaluate(() => { localStorage.clear(); return document.fonts.ready })
    await page.waitForSelector(`${status}[data-state="clear"]`)
    assert.equal(await page.$eval(status, node => node.textContent), '', 'zero drafts has no text banner or badge')
    const clean = await bounds()
    assert.equal(clean.width, 48)
    assert.equal(clean.height, 48)
    await page.focus('textarea')
    await page.evaluate(prefix => {
      localStorage.setItem(prefix + 'pending', JSON.stringify({ note: 'Behåll denna text', risk_text: '', ftu_text: '' }))
    }, prefix)
    await page.waitForSelector(`${status}[data-state="pending"]`)
    assert.deepEqual(await bounds(), clean, 'pending drafts cannot resize or shift the page')
    assert.equal(await page.$eval('textarea', node => document.activeElement === node), true)
    assert.match(await page.$eval(status, node => node.getAttribute('aria-label')), /1 lokala textutkast/)
    await page.evaluate(prefix => {
      for (let i = 0; i < 100; i++) localStorage.setItem(prefix + i, JSON.stringify({ note: 'Text', risk_text: '', ftu_text: '' }))
    }, prefix)
    await page.waitForFunction(() => document.querySelector('.ob-draft-count')?.textContent === '99+')
    assert.deepEqual(await bounds(), clean, 'large counts cannot resize the status')
    await page.focus(status)
    await page.keyboard.press('Enter')
    await page.waitForSelector('dialog[aria-label="Lokala textutkast"]')
    assert.equal(await page.$eval('dialog', node => node.parentElement === document.body), true, 'header styling must not leak into the review dialog')
    await page.keyboard.press('Escape')
    await page.waitForSelector('dialog[open]', { hidden: true })
    assert.equal(await page.$eval(status, node => document.activeElement === node), true, 'closing restores focus to the opener')
    await page.evaluate(() => {
      window.__originalStorageKey = Storage.prototype.key
      Storage.prototype.key = () => { throw Error('Synthetic storage read failure') }
    })
    await page.waitForSelector(`${status}[data-state="error"]`)
    assert.deepEqual(await bounds(), clean, 'read errors must not change layout')
    await page.click(status)
    await page.waitForSelector('dialog [role="alert"]')
    assert.equal(await page.$eval('dialog footer button', node => node.disabled), true)
    await page.keyboard.press('Escape')
    await page.evaluate(() => { Storage.prototype.key = window.__originalStorageKey; localStorage.clear() })
    await page.waitForSelector(`${status}[data-state="clear"]`)
    assert.deepEqual(await bounds(), clean)
  }

  for (const width of [320, 390, 1280]) {
    await page.setViewport({ width, height: 820 })
    await page.goto(base + '/navigation?round=mobile-v2&history-integration', { waitUntil: 'networkidle0' })
    await page.waitForSelector('.ob-inspection-header .ob-draft-status')
    assert.equal((await page.$$(status)).length, 1, 'no extra draft banner above the real round page')
    await page.click(status)
    await page.waitForFunction(() => document.querySelector('dialog[open]') && history.state?.__obRoundBack)
    await page.evaluate(() => history.back())
    await page.waitForSelector('dialog[open]', { hidden: true })
    await page.waitForSelector('.ob-inspection-header')
    await page.screenshot({ path: resolve(output, `draft-header-places-${width}.png`) })
    await page.click('.obm-place-row')
    await page.waitForSelector('.obm-room-header')
    await page.waitForSelector('.ob-inspection-header .ob-draft-status')
    assert.equal((await page.$$(status)).length, 1)
    const layout = await page.$eval('.obm-room-header', header => {
      const rows = [...header.children].filter(node => node.tagName !== 'DIALOG').map(node => {
        const rect = node.getBoundingClientRect()
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      })
      return { overflow: document.documentElement.scrollWidth > innerWidth,
        overlaps: rows.some((a, index) => rows.slice(index + 1).some(b =>
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)) }
    })
    assert.deepEqual(layout, { overflow: false, overlaps: false }, `room header at ${width}px`)
    await page.screenshot({ path: resolve(output, `draft-header-room-${width}.png`) })
    await page.click(status)
    await page.waitForSelector('dialog[aria-label="Lokala textutkast"]')
    await page.evaluate(() => history.back())
    await page.waitForSelector('dialog[open]', { hidden: true })
    assert.ok(await page.$('.obm-room-header'), 'phone Back closes the draft review without leaving the room')
    await page.click('[aria-label="Till platser"]')
    await page.waitForSelector('.ob-inspection-header')
    await page.click('.ob-inspection-header [aria-label="Öppna stegmeny"]')
    await page.waitForSelector('dialog[open] nav')
    await page.locator('dialog nav button').filter(node => node.textContent.includes('Fastighet & uppdrag')).click()
    await page.waitForSelector('.ob-inspection-header .ob-draft-status')
    assert.equal((await page.$$(status)).length, 1, 'form page has one header status, not a second row')
    await page.evaluate(() => sessionStorage.clear())
  }
  console.log('PASS: draft status stays fixed across empty/pending/error states; review, focus and page/round headers work at 320, 390 and 1280px.')
}
