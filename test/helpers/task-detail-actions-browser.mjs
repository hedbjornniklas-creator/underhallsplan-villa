import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testTaskDetailActions(base, output) {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage(), errors = [], external = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:')) external.push(request.url()) })
  const click = async (text, scope = 'button') => {
    for (const button of await page.$$(scope)) if (await button.evaluate((node, text) => node.getClientRects().length && node.textContent.trim() === text, text)) { await button.click(); return }
    throw Error(`Missing button: ${text}`)
  }
  const select = async name => {
    await page.evaluate(name => window.fixture.select(name), name)
    await page.waitForFunction(name => document.querySelector('main')?.dataset.scenario === name && document.querySelector('[data-task-detail-scroll]'), {}, name)
  }
  const calls = () => page.evaluate(() => window.fixture.calls)
  const layout = async () => {
    const result = await page.evaluate(() => {
      const footer = document.querySelector('footer'), body = document.querySelector('[data-task-detail-scroll]'), f = footer.getBoundingClientRect(), b = body.getBoundingClientRect()
      return { viewport: innerHeight, width: innerWidth, top: f.top, bottom: f.bottom, bodyBottom: b.bottom, pageWidth: document.documentElement.scrollWidth,
        buttons: [...footer.querySelectorAll('button')].map(node => { const r = node.getBoundingClientRect(); return { text: node.textContent, top: r.top, bottom: r.bottom, left: r.left, right: r.right } }) }
    })
    assert.ok(result.bottom <= result.viewport + 1)
    assert.ok(result.bodyBottom <= result.top + 1, 'Scrolling content does not overlap the footer')
    assert.ok(result.pageWidth <= result.width + 1)
    for (const b of result.buttons) assert.ok(b.top >= result.top - 1 && b.bottom <= result.bottom + 1 && b.left >= 0 && b.right <= result.width + 1, JSON.stringify({ button: b, layout: result }))
    return result
  }
  try {
    await page.goto(base, { waitUntil: 'networkidle0' }); await page.waitForSelector('footer')
    for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
      await page.setViewport({ width, height }); await select('normal')
      assert.doesNotMatch(await page.$eval('[data-task-detail-scroll]', node => node.textContent), /förslag på nästa steg|Gammalt AI-förslag/)
      const before = await layout()
      await page.$eval('[data-task-detail-scroll]', node => { node.scrollTop = node.scrollHeight })
      const after = await layout(); assert.equal(after.top, before.top)
      await page.screenshot({ path: resolve(output, `actions-${width}.png`), fullPage: true })
      await click('Radera uppdrag', 'footer button'); await page.waitForSelector('[role=alertdialog]')
      assert.deepEqual(await calls(), [])
      await page.waitForFunction(() => document.activeElement?.textContent.trim() === 'Behåll uppdraget')
      await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift')
      assert.match(await page.evaluate(() => document.activeElement.textContent), /Radera uppdrag/)
      await page.keyboard.press('Tab'); await page.keyboard.press('Escape')
      await page.waitForSelector('[role=alertdialog]', { hidden: true })
      assert.match(await page.evaluate(() => document.activeElement.textContent), /Radera uppdrag/)
      assert.deepEqual(await calls(), [])
      await click('Avbryt uppdrag', 'footer button'); await page.waitForSelector('footer textarea'); await layout()
      await page.type('footer textarea', 'Fiktivt avbrott')
      await click('Bekräfta', 'footer button')
      await page.waitForFunction(() => [...document.querySelectorAll('footer button')].length === 1)
      assert.equal((await calls())[0].payload.status, 'cancelled')
      await select('self'); await layout()
      await click('Avbryt uppdrag', 'footer button'); await page.waitForSelector('footer textarea'); await layout()
      assert.ok(await page.$eval('footer textarea', node => node.getBoundingClientRect().height > 40))
      await click('Avbryt', 'footer button'); assert.deepEqual(await calls(), [])
    }
    for (const name of ['approved', 'cancelled']) {
      await select(name); await layout()
      assert.deepEqual(await page.$$eval('footer button', nodes => nodes.map(node => node.textContent.trim())), ['Radera uppdrag'])
    }
    for (const name of ['no-delete', 'recipient']) { await select(name); assert.equal(await page.$eval('footer', node => node.textContent.includes('Radera uppdrag')), false) }
    await select('children')
    assert.ok(await page.$eval('footer button[aria-describedby=task-delete-blocked]', node => node.disabled))
    assert.match(await page.$eval('#task-delete-blocked', node => node.textContent), /underuppgifterna/)
    await select('busy'); assert.ok(await page.$eval('footer button[title="Radera uppdrag"]', node => node.disabled))
    await page.setViewport({ width: 1440, height: 900 }); await select('normal')
    await click('Klarmarkera manuellt', 'footer button'); await page.waitForSelector('dialog[open]'); await page.keyboard.press('Escape'); await page.waitForSelector('dialog[open]', { hidden: true })
    assert.deepEqual(await calls(), [])
    await click('Underuppgift', 'footer button'); assert.equal((await calls())[0].action, 'create_subtask')
    await select('normal'); await click('Radera uppdrag', 'footer button'); await click('Behåll uppdraget', '[role=alertdialog] button'); assert.deepEqual(await calls(), [])
    await click('Radera uppdrag', 'footer button'); await click('Radera uppdrag', '[role=alertdialog] button')
    await page.waitForSelector('[data-task-detail-scroll]', { hidden: true })
    assert.deepEqual(await calls(), [{ action: 'archive_task', payload: { taskId: 'fictitious-task', version: 7 } }])
    await select('error'); await click('Radera uppdrag', 'footer button'); await click('Radera uppdrag', '[role=alertdialog] button')
    await page.waitForFunction(() => document.querySelector('[role=alertdialog] [role=alert]')?.textContent.includes('Fiktivt raderingsfel'))
    await click('Radera uppdrag', '[role=alertdialog] button'); await page.waitForSelector('[data-task-detail-scroll]', { hidden: true })
    assert.equal((await calls()).length, 2)
    assert.deepEqual(errors, []); assert.deepEqual(external, [])
    console.log('Task UI passed: no AI section, pinned/wrapped actions at 1440/390/320px including self-assigned tasks, scrolling, cancellation, closed-task deletion, permissions, children, busy, confirmation/cancel/Escape/focus trap, manual completion, subtasks and archive retry.')
  } catch (error) { await page.screenshot({ path: resolve(output, 'actions-failure.png'), fullPage: true }); throw error }
  finally { await browser.close() }
}
