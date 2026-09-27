import assert from 'node:assert/strict'
import { resolve } from 'node:path'

// Real inspection page and menu; report-step content is stubbed by the fixture.
export async function testReviewRetirement(page, base, output) {
  const navigationKey = 'ob:inspection-navigation:v1:synthetic-mobile-inspection'
  const draftKey = 'ob:text-draft:v1:ob:synthetic-mobile-inspection:pending'
  let dialogs = 0
  const onDialog = dialog => { dialogs++; void dialog.dismiss() }
  page.on('dialog', onDialog)
  const openMenu = async () => {
    await page.evaluate(() => [...document.querySelectorAll('button[aria-label="Öppna stegmeny"]')]
      .find(button => button.getBoundingClientRect().width > 0).click())
    await page.waitForSelector('dialog[open] .obm-menu-step')
  }
  const choose = async label => {
    await page.evaluate(label => [...document.querySelectorAll('.obm-menu-step')]
      .find(button => button.getAttribute('aria-label') === label).click(), label)
  }
  try {
    for (const width of [390, 1280]) {
      await page.setViewport({ width, height: 844 })
      await page.goto(`${base}/navigation`, { waitUntil: 'networkidle0' })
      await page.evaluate(key => sessionStorage.setItem(key, JSON.stringify({ section: 'review' })), navigationKey)
      await page.reload({ waitUntil: 'networkidle0' })
      await page.waitForSelector('[data-selected-ob-section="delivery"]')
      assert.equal(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).section, navigationKey), 'delivery')
      await openMenu()
      assert.deepEqual(await page.$$eval('.obm-menu-step', buttons => buttons.map(button => button.getAttribute('aria-label'))),
        ['Fastighet & uppdrag', 'Handlingar & upplysningar', 'Förutsättningar', 'ÖB-runda', 'Skicka utlåtande'])
      assert.deepEqual(await page.$$eval('.obm-menu-step small', nodes => nodes.map(node => node.textContent)),
        ['1/5', '2/5', '3/5', '4/5', '5/5'])
      assert.equal(await page.$eval('.obm-menu-step[aria-current="step"]', node => node.getAttribute('aria-label')), 'Skicka utlåtande')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await page.screenshot({ path: resolve(output, `review-retired-menu-${width}.png`) })
      await choose('ÖB-runda')
      await page.waitForSelector('[data-selected-ob-section="runda-ny"]')
      await page.evaluate(key => localStorage.setItem(key, 'Preserved local draft'), draftKey)
      await openMenu()
      await choose('Skicka utlåtande')
      await page.waitForSelector('[data-selected-ob-section="delivery"]')
      assert.equal(await page.evaluate(key => localStorage.getItem(key), draftKey), 'Preserved local draft')
      assert.equal(dialogs, 0, 'Internal navigation must not trigger a leave/reload prompt')
      await page.evaluate(key => localStorage.removeItem(key), draftKey)
      await page.reload({ waitUntil: 'networkidle0' })
      await page.waitForSelector('[data-selected-ob-section="delivery"]')
      await page.evaluate(key => sessionStorage.setItem(key, JSON.stringify({ section: 'review' })), navigationKey)
      await page.goto(`${base}/navigation?round=mobile-v2`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('[data-selected-ob-section="runda-ny"]')
    }
    assert.equal(dialogs, 0)
    console.log('PASS: retired review redirects to delivery, five numbered menu steps, round deep links and local drafts preserved at 390/1280px.')
  } finally {
    page.off('dialog', onDialog)
  }
}
