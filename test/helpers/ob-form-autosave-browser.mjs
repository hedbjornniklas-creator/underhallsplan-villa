import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testFormAutosave(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = [], external = [], results = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (request.url().startsWith('data:') || new URL(request.url()).origin === base) void request.continue()
    else { external.push(request.url()); void request.abort() }
  })
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  async function load(section) {
    await page.goto(`${base}/round${section ? `?section=${section}` : ''}`, { waitUntil: 'networkidle0' })
    await page.evaluate(async () => { localStorage.clear(); await document.fonts.ready; window.__obFormTest.saveDelay = 650 })
  }
  async function sectionTextarea(title) {
    const handle = await page.evaluateHandle(title => [...document.querySelectorAll('section')]
      .find(node => node.querySelector('h2')?.textContent === title)?.querySelector('textarea'), title)
    assert.ok(handle.asElement(), `Missing textarea in ${title}`)
    return handle.asElement()
  }
  async function field(label) {
    const handle = await page.evaluateHandle(label => [...document.querySelectorAll('label')].find(node => node.textContent === label)?.control, label)
    assert.ok(handle.asElement(), `Missing field ${label}`)
    return handle.asElement()
  }
  async function observe(element) {
    await element.evaluate(node => {
      const panel = node.closest('.obm-sheet-body')
      const measure = () => ({ top: node.getBoundingClientRect().top, height: document.documentElement.scrollHeight,
        scroll: window.scrollY, panelHeight: panel?.scrollHeight ?? 0, panelScroll: panel?.scrollTop ?? 0,
        connected: node.isConnected, focused: document.activeElement === node,
        selection: [node.selectionStart, node.selectionEnd], value: node.value })
      window.__saveWatch = { samples: [measure()], running: true, reads: window.__obFormTest.reads.length }
      const tick = () => { if (window.__saveWatch.running) { window.__saveWatch.samples.push(measure()); requestAnimationFrame(tick) } }
      requestAnimationFrame(tick)
    })
  }
  async function finish(label, element, inserted = ' Test') {
    // Include debounce, a delayed response and the old 1500ms saved-label expiry.
    await pause(3100)
    const report = await page.evaluate(() => {
      const watch = window.__saveWatch
      watch.running = false
      const first = watch.samples[0], last = watch.samples.at(-1)
      return { shifts: Object.fromEntries(['top', 'height', 'scroll', 'panelHeight', 'panelScroll'].map(key => [key,
        Math.max(...watch.samples.map(row => row[key])) - Math.min(...watch.samples.map(row => row[key]))])),
        lostFocus: watch.samples.some(row => !row.connected || !row.focused),
        selection: last.selection, value: last.value, initialValue: first.value, initialSelection: first.selection,
        extraReads: window.__obFormTest.reads.length - watch.reads,
        pendingDrafts: Object.keys(localStorage).filter(key => key.startsWith('ob:text-draft:v1:')),
        writes: window.__obFormTest.writes.length }
    })
    assert.ok(report.writes > 0, `${label}: save must run`)
    assert.equal(await element.evaluate(node => node.value), report.value)
    const [start, end] = report.initialSelection
    assert.equal(report.value, report.initialValue.slice(0, start) + inserted + report.initialValue.slice(end), `${label}: save must not replace typed text`)
    assert.deepEqual(report.selection, [start + inserted.length, start + inserted.length], `${label}: caret must not move`)
    assert.deepEqual(report.pendingDrafts, [], `${label}: completed saves must clear acknowledged drafts`)
    results.push({ label, ...report })
    console.log(JSON.stringify({ label, shifts: report.shifts, lostFocus: report.lostFocus, extraReads: report.extraReads }))
  }
  try {
    for (const width of [320, 390, 1280]) {
      // A short viewport also exercises the space left above a mobile keyboard.
      await page.setViewport({ width, height: 460, isMobile: width < 768, hasTouch: width < 768 })
      await load('documents')
      for (const title of ['Upplysningar', 'Upplysningar om fel i fastigheten']) {
        const input = await sectionTextarea(title)
        await input.click()
        await observe(input)
        await input.type(' Test')
        await pause(850)
        await page.screenshot({ path: resolve(output, `autosave-documents-${width}-${title === 'Upplysningar' ? 'disclosure' : 'defect'}.png`) })
        await finish(`${width}: ${title}`, input)
      }
      await load('conditions')
      for (const button of await page.$$('.ob-form-list-row')) {
        if (await button.evaluate(node => node.textContent.includes('Värme och varmvatten'))) { await button.click(); break }
      }
      await page.waitForSelector('dialog[open] textarea')
      const note = await page.$('dialog[open] textarea')
      await note.click()
      await observe(note)
      await note.type(' Test')
      await pause(850)
      await page.screenshot({ path: resolve(output, `autosave-conditions-${width}.png`) })
      await finish(`${width}: conditions note`, note)
      await load('')
      // These controls save on blur. Watch the NEXT focused field during that save.
      for (const [from, to] of [['Kommun', 'Fastighetsbeteckning'], ['Telefon', 'E-post']]) {
        const input = await field(from), next = await field(to)
        await input.click()
        await input.type('1')
        await next.click()
        await observe(next)
        await next.type('a')
        await finish(`${width}: ${from} -> ${to}`, next, 'a')
      }
      await page.screenshot({ path: resolve(output, `autosave-property-${width}.png`) })
    }
    assert.deepEqual(errors, [], 'Browser runtime errors')
    assert.deepEqual(external, [], 'No production/network fallback')
    for (const report of results) {
      assert.equal(report.lostFocus, false, `${report.label}: focus must survive save`)
      assert.equal(report.extraReads, 0, `${report.label}: save must not reload the form`)
      assert.ok(Object.values(report.shifts).every(delta => delta <= 1), `${report.label}: layout moved: ${JSON.stringify(report.shifts)}`)
    }
    console.log('PASS: all three OB forms keep focus, field position, scroll and content height across autosave')
  } finally { await browser.close() }
}
