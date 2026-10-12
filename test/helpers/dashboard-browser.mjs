import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const tile = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf1e8"/><path d="M0 45H256M0 140H256M0 220H256M45 0V256M140 0V256M220 0V256" stroke="#fff" stroke-width="12"/><path d="M0 45H256M0 140H256M0 220H256M45 0V256M140 0V256M220 0V256" stroke="#d9dfd4" stroke-width="1"/></svg>')

export async function testDashboard(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = [], external = []
  page.on('pageerror', error => errors.push(error.message))
  // Tiles use a deterministic fixture, so addresses and coordinates never leave
  // the isolated browser. All other external requests are blocked and reported.
  await page.setRequestInterception(true)
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.hostname === 'tile.openstreetmap.org' || url.hostname.endsWith('.tile.openstreetmap.org')) {
      void request.respond({ status: 200, contentType: 'image/svg+xml', body: tile }); return
    }
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) {
      external.push(url.origin); void request.abort(); return
    }
    void request.continue()
  })
  async function ready() {
    await page.waitForSelector('[data-testid="dashboard-actions"]')
    await page.evaluate(() => document.fonts.ready)
  }
  async function actionIds() {
    return page.$$eval('[data-action-id]', nodes => nodes.map(node => node.dataset.actionId))
  }
  async function noOverflow(label) {
    const overflow = await page.evaluate(() => {
      const elements = [...document.querySelectorAll('main,section,article,header,input,select')]
        .filter(node => node.checkVisibility() && node.getBoundingClientRect().right > innerWidth + 1)
        .map(node => `${node.tagName}.${node.className}`)
      return { width: innerWidth, scroll: document.documentElement.scrollWidth, elements }
    })
    assert.ok(overflow.scroll <= overflow.width + 1, `${label}: horizontal page overflow: ${JSON.stringify(overflow)}`)
    assert.deepEqual(overflow.elements, [], `${label}: elements extend beyond viewport`)
  }
  async function clickText(selector, match) {
    for (const node of await page.$$(selector)) {
      if (match.test(await node.evaluate(element => element.textContent.trim()))) { await node.click(); return }
    }
    throw Error(`Missing ${selector} matching ${match}`)
  }
  async function setDate(date) {
    await page.$eval('input[aria-label="Visa uppdrag för datum"]', (input, date) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, date)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, date)
  }
  try {
    await page.emulateTimezone('Europe/Stockholm')
    for (const width of [390, 768, 1440]) {
      await page.setViewport({ width, height: 1000 })
      await page.goto(`${base}/dashboard-v1`, { waitUntil: 'networkidle0' })
      await ready()
      await page.$eval('[aria-label="Karta över dagens bokade uppdrag"]', node => node.scrollIntoView())
      await page.waitForFunction(() => document.querySelectorAll('.leaflet-marker-icon').length === 3)
      await page.evaluate(() => window.scrollTo(0, 0))
      await noOverflow(`${width}px`)
      assert.deepEqual(await actionIds(), ['ob-report', 'ob-confirmation', 'eb-inspection', 'tu-confirmation', 'task-followup'])
      assert.equal(await page.$eval('body', node => /DOLD KUNDUPPGIFT|DOLD BOKNING|DOLD ADRESS/.test(node.textContent)), false, 'Disabled module records must be excluded')
      const links = await page.$$eval('a[href]', nodes => nodes.map(node => node.getAttribute('href')))
      assert.equal(links.some(link => link.includes('/fuktsakerhet')), false, 'Disabled module has no workflow links')
      assert.ok(links.filter(link => /^\/(ob|eb|tu|uppdrag)(\/|\?)/.test(link)).every(link => link.includes('orgId=11111111-1111-4111-8111-111111111111')), 'Internal workflows keep active organization')
      await page.screenshot({ path: resolve(output, `dashboard-${width}.png`), fullPage: true })
    }
    await page.setViewport({ width: 1440, height: 1000 })
    await page.goto(`${base}/dashboard-v1`, { waitUntil: 'networkidle0' })
    await ready()
    await clickText('button', /^Nytt uppdrag/)
    assert.equal((await page.$$('.dh-new-menu a')).length, 4)
    assert.ok((await page.$$eval('.dh-new-menu a', nodes => nodes.map(node => node.getAttribute('href')))).includes('/ob/assignments/new?orgId=11111111-1111-4111-8111-111111111111'))
    await page.keyboard.press('Escape')
    assert.equal(await page.$('.dh-new-menu'), null)
    await page.click('button[aria-label="Uppdatera översikten"]')
    await page.waitForSelector('.dh-dashboard[aria-busy="true"]')
    assert.equal(await page.$eval('button[aria-label="Uppdatera översikten"]', button => button.disabled), true)
    await page.waitForSelector('.dh-dashboard[aria-busy="false"]')
    assert.equal(await page.evaluate(() => window.__dashboardTest.refreshes), 1)
    await clickText('[aria-label="Filtrera nästa steg"] button', /^(Besiktningar|Ej klara besiktningar)/)
    assert.deepEqual(await actionIds(), ['ob-report', 'eb-inspection'])
    await clickText('[aria-label="Filtrera nästa steg"] button', /^(Bekräftelser|Uppdragsbekräftelser)/)
    assert.deepEqual(await actionIds(), ['ob-confirmation', 'tu-confirmation'])
    await clickText('[aria-label="Filtrera nästa steg"] button', /^Alla/)
    await page.select('select[aria-label="Filtrera arbetsområde"]', 'ob')
    assert.deepEqual(await actionIds(), ['ob-report', 'ob-confirmation'])
    await page.select('select[aria-label="Filtrera arbetsområde"]', 'all')
    await page.type('input[aria-label="Sök uppdrag eller fastighet"]', 'Storgatan')
    assert.deepEqual(await actionIds(), ['tu-confirmation'])
    await page.$eval('input[aria-label="Sök uppdrag eller fastighet"]', input => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    assert.equal((await actionIds()).length, 5)

    await page.click('button[aria-label="Nästa vecka"]')
    await page.waitForFunction(() => document.body.textContent.includes('Nästa veckas besiktning'))
    await page.click('button[aria-label="Föregående vecka"]')
    await page.click('button[aria-label="Föregående vecka"]')
    await page.waitForFunction(() => document.body.textContent.includes('Förra veckans villa'))
    await clickText('button', /^I dag$/)
    assert.equal(await page.$eval('input[aria-label="Visa uppdrag för datum"]', input => input.value), '2026-10-12')
    await setDate('2026-10-15')
    await page.waitForFunction(() => document.querySelector('input[aria-label="Visa uppdrag för datum"]').value === '2026-10-15')
    assert.match(await page.$eval('body', node => node.textContent), /Torsdagsutredningen/)
    await setDate('2026-10-13')
    await noOverflow('Empty selected day')
    await page.screenshot({ path: resolve(output, 'dashboard-no-bookings.png'), fullPage: true })
    await clickText('button', /^I dag$/)
    await page.waitForSelector('[aria-label="Karta över dagens bokade uppdrag"]')
    await page.waitForFunction(() => document.querySelectorAll('.leaflet-marker-icon').length >= 2)
    const markers = await page.$$eval('.leaflet-marker-icon', nodes => nodes.map(node => node.textContent.trim()))
    assert.ok(markers.includes('1') && markers.includes('2'), 'Map labels correspond to stop numbers')
    await page.click('.leaflet-marker-icon')
    assert.match(await page.$eval('body', node => node.textContent), /Tallstigen 12/)
    await page.screenshot({ path: resolve(output, 'dashboard-map.png'), fullPage: true })
    await page.goto(`${base}/dashboard-v1?state=empty`, { waitUntil: 'networkidle0' })
    await ready()
    assert.deepEqual(await actionIds(), [])
    await noOverflow('Empty dashboard')
    await page.screenshot({ path: resolve(output, 'dashboard-empty.png'), fullPage: true })
    assert.equal(await page.evaluate(() => window.__dashboardTest.writes), 0)
    await page.goto(`${base}/dashboard-v1?state=long`, { waitUntil: 'networkidle0' })
    await ready()
    assert.equal((await actionIds()).length, 8, 'Long action lists initially show eight next steps')
    await clickText('button', /^Visa alla 12/)
    assert.equal((await actionIds()).length, 12)
    await clickText('button', /^Visa färre/)
    assert.equal((await actionIds()).length, 8)
    await page.goto(`${base}/dashboard-v1?state=client-error`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('[role="alert"]')
    await page.evaluate(() => { window.__dashboardTest.fail = false })
    await clickText('button', /^Försök igen$/)
    await ready()
    assert.equal((await actionIds()).length, 5)
    await page.evaluate(() => { window.__dashboardTest.wrongOrg = true })
    // An explicit orgId is required to verify the browser's response scope check.
    await page.evaluate(() => {
      history.replaceState(null, '', '?state=client&orgId=11111111-1111-4111-8111-111111111111')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await page.waitForSelector('[role="alert"]')
    assert.equal(await page.$('[data-action-id]'), null, 'Changing organization selection hides a stale snapshot and rejects a foreign response')
    await page.goto(`${base}/dashboard-v1?state=client&orgId=11111111-1111-4111-8111-111111111111`, { waitUntil: 'networkidle0' })
    await ready()
    assert.equal((await actionIds()).length, 5)
    await page.evaluate(() => { window.__dashboardTest.fail = true; window.__dashboardTest.failureStatus = 503 })
    await page.click('button[aria-label="Uppdatera översikten"]')
    await page.waitForSelector('[role="alert"]')
    assert.equal((await actionIds()).length, 5, 'Transient failures preserve the existing snapshot')
    await page.evaluate(() => { window.__dashboardTest.failureStatus = 403 })
    await page.click('button[aria-label="Uppdatera översikten"]')
    await page.waitForFunction(() => document.querySelector('[role="alert"]') && !document.querySelector('[data-action-id]'))
    assert.equal(await page.$('[data-booking-id]'), null, 'Revoked access removes all prior booked work')
    assert.equal(await page.$eval('body', node => /Tallstigen 12|Kvarteret Björken|Storgatan 24/.test(node.textContent)), false, '403 refresh clears customer data and action/calendar/map snapshots')
    await page.screenshot({ path: resolve(output, 'dashboard-access-revoked.png'), fullPage: true })
    assert.equal(await page.evaluate(() => window.__dashboardTest.writes), 0)
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    console.log('PASS: dashboard 390/768/1440px layouts; active-organization links; disabled-module isolation; module menu; action tabs/module/search; show all/fewer; calendar week/date/today navigation; empty states; map markers; load retry; foreign-organization rejection; transient snapshot preservation and 403 clearing. Synthetic data and tiles only; no external requests or writes.')
  } catch (error) {
    console.error(await page.$eval('body', node => node.innerText))
    await page.screenshot({ path: resolve(output, 'dashboard-failure.png'), fullPage: true })
    throw error
  } finally { await browser.close() }
}
