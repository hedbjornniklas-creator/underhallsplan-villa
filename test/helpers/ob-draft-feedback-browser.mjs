import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function testDraftFeedback({ page, base, output }) {
  async function click(text) {
    for (const button of await page.$$('button')) {
      if (await button.evaluate(node => node.textContent.trim()) === text) { await button.click(); return }
    }
    throw Error(`Missing button: ${text}`)
  }
  async function fill(selector, text) {
    await page.click(selector)
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control')
    await page.type(selector, text)
  }
  const key = 'ob:text-draft:v1:ob:feedback:grunddata:attendees_other'
  await page.goto(base + '/draft-feedback', { waitUntil: 'networkidle0' })
  await fill('textarea', 'Bekräftat sparad text')
  await page.waitForFunction(() => document.querySelector('output').textContent === 'Bekräftat sparad text')
  await click('Visa textfält')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null,
    'closing an acknowledged save must not recreate a ghost draft from an old prop')
  await click('Visa textfält')
  await click('Sparfel: false')
  await fill('textarea', 'Osparad text får inte rensas')
  await click('Visa textfält')
  assert.equal(JSON.parse(await page.evaluate(key => localStorage.getItem(key), key)).value, 'Osparad text får inte rensas')
  await click('Visa textfält')
  // The stored draft is restored by the textarea's mount effect, after its first render.
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'Osparad text får inte rensas')
  assert.equal(await page.$eval('textarea', node => node.value), 'Osparad text får inte rensas')
  await click('Sparfel: true')
  await page.focus('textarea')
  await click('Visa textfält')
  await page.waitForFunction(key => localStorage.getItem(key) === null, {}, key)

  // An interrupted edit resumes autosave on mount, without focus or blur.
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ value: 'Återupptaget autospar' })), key)
  await click('Visa textfält')
  await page.waitForFunction(() => document.querySelector('output').textContent === 'Återupptaget autospar')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null)
  await fill('textarea', 'Fördröjt fel')
  await new Promise(resolve => setTimeout(resolve, 300))
  await fill('textarea', 'Nyare sparad text')
  await page.waitForFunction(() => document.querySelector('output').textContent === 'Nyare sparad text')
  await new Promise(resolve => setTimeout(resolve, 1100))
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null, 'late failure cannot recreate older local text')
  await click('Visa textfält')
  await click('Låst: false')
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ value: 'Text som väntar på upplåsning' })), key)
  await click('Visa textfält')
  await new Promise(resolve => setTimeout(resolve, 350))
  assert.equal(await page.$eval('output', node => node.textContent), 'Nyare sparad text', 'locked fields never autosave restored text')
  await click('Låst: true')
  await page.waitForFunction(() => document.querySelector('output').textContent === 'Text som väntar på upplåsning')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null)
  await click('Visa textfält')

  await click('Formulär låst: false')
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ value: 'Text som väntar på formuläret' })), key)
  await click('Visa textfält')
  await new Promise(resolve => setTimeout(resolve, 350))
  assert.equal(await page.$eval('output', node => node.textContent), 'Text som väntar på upplåsning', 'a disabled ancestor fieldset also prevents restored autosave')
  await click('Formulär låst: true')
  await page.waitForFunction(() => document.querySelector('output').textContent === 'Text som väntar på formuläret')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null)
  await click('Visa textfält')

  // Locking a restored field before its debounce expires preserves the draft.
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ value: 'Text efter tillfällig spärr' })), key)
  await click('Visa textfält')
  await page.$eval('fieldset', node => { node.disabled = true })
  await new Promise(resolve => setTimeout(resolve, 350))
  assert.equal(await page.$eval('output', node => node.textContent), 'Text som väntar på formuläret')
  await page.$eval('fieldset', node => { node.disabled = false })
  await page.waitForFunction(() => document.querySelector('output').textContent === 'Text efter tillfällig spärr')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null)
  await click('Visa textfält')

  const prefix = 'ob:text-draft:v1:ob:feedback:mobile-round:'
  const retainedDrafts = {
    different: { note: 'Min lokala text', risk_text: '', ftu_text: '' },
    unknown: { note: 'Utkast utan serverpost', risk_text: '', ftu_text: '' },
    'read-failure': { note: 'Text vid anslutningsfel', risk_text: '', ftu_text: '' },
  }
  for (const width of [320, 390, 1280]) {
    await page.setViewport({ width, height: 820 })
    await page.evaluate((prefix, drafts) => {
      for (const [id, draft] of Object.entries(drafts)) localStorage.setItem(prefix + id, JSON.stringify(draft))
      localStorage.setItem(prefix + 'same', JSON.stringify({ note: 'Serverns text', risk_text: '', ftu_text: '' }))
    }, prefix, retainedDrafts)
    await page.waitForFunction(() => document.body.textContent.includes('4 lokala textutkast'))
    await click('Visa texter')
    await page.waitForSelector('dialog[aria-label="Lokala textutkast"]')
    await click('Kontrollera mot sparat')
    await page.waitForFunction(() => document.querySelector('dialog').textContent.includes('Inget har skrivits över.'))
    await page.waitForFunction(() => document.querySelector('dialog').textContent.includes('Kunde inte läsa sparad text.'))
    await page.waitForFunction(prefix => localStorage.getItem(prefix + 'same') === null, {}, prefix)
    for (const [id, draft] of Object.entries(retainedDrafts)) {
      assert.deepEqual(JSON.parse(await page.evaluate(key => localStorage.getItem(key), prefix + id)), draft)
    }
    assert.equal(await page.$eval('dialog', node => node.scrollWidth > node.clientWidth), false)
    await page.screenshot({ path: resolve(output, `local-drafts-${width}.png`) })
    await page.click('dialog [aria-label="Tillbaka"]')
    await page.waitForSelector('dialog[open]', { hidden: true })
  }
  await page.evaluate(prefix => {
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key)
  }, prefix)

  for (const width of [390, 1280]) {
    await page.setViewport({ width, height: 820 })
    await click('Öppna dialog')
    await page.waitForSelector('dialog[open]')
    await click('Visa dialogfel')
    await page.waitForSelector('dialog [aria-label="Meddelanden"] [role="alert"]')
    const bounds = await page.$eval('[aria-label="Meddelanden"]', node => {
      const r = node.getBoundingClientRect(), alert = node.querySelector('[role="alert"]')
      const a = alert.getBoundingClientRect()
      return { x: r.x, right: r.right, y: r.y, visible: alert.contains(document.elementFromPoint(a.x + a.width / 2, a.y + a.height / 2)) }
    })
    assert.ok(bounds.y >= 0 && bounds.y < 30)
    assert.ok(bounds.right <= width && bounds.visible, 'toast is visible above the modal, not behind its backdrop')
    if (width >= 640) assert.ok(bounds.x > width / 2 && width - bounds.right <= 20, 'desktop toast stays top-right')
    await page.screenshot({ path: resolve(output, `draft-feedback-${width}.png`) })
    await page.click('[aria-label="Stäng felmeddelande"]')
    await page.waitForSelector('[aria-label="Meddelanden"]', { hidden: true })
    await click('Visa dialogfel')
    await page.waitForSelector('dialog [aria-label="Meddelanden"]')
    await page.keyboard.press('Escape')
    await page.waitForSelector('dialog[open]', { hidden: true })
    await page.waitForSelector('body > [aria-label="Meddelanden"]')
    await page.click('[aria-label="Stäng felmeddelande"]')
    await click('Visa kort notis')
    await page.waitForSelector('[aria-label="Meddelanden"]')
    await page.waitForSelector('[aria-label="Meddelanden"]', { hidden: true })
  }
  console.log('PASS: acknowledged saves stay clean after unmount, unsaved text survives, global toasts stay visible above dialogs and auto-dismiss on mobile/desktop.')
}
