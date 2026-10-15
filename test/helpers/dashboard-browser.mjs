import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const tile = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf1e8"/><path d="M0 45H256M0 140H256M0 220H256M45 0V256M140 0V256M220 0V256" stroke="#fff" stroke-width="12"/><path d="M0 45H256M0 140H256M0 220H256M45 0V256M140 0V256M220 0V256" stroke="#d9dfd4" stroke-width="1"/></svg>')

export async function testDashboard(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = [], external = [], workflowNavigations = []
  page.on('pageerror', error => errors.push(error.message))
  // Tiles use a deterministic fixture, so addresses and coordinates never leave
  // the isolated browser. All other external requests are blocked and reported.
  await page.setRequestInterception(true)
  page.on('request', request => {
    const url = new URL(request.url())
    if (['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/ob/assignments/test-tentative') {
      workflowNavigations.push({ method: request.method(), url: request.url() })
      void request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html lang="sv"><body><h1>Uppdragsbekräftelse · testdata</h1></body></html>' }); return
    }
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
  const mapSelector = '[aria-label="Karta över uppdrag för vald dag"]'
  const tentativeMarker = '.leaflet-marker-icon[data-booking-id="booking-tentative"]'
  const routePath = '.leaflet-overlay-pane path.leaflet-interactive'
  async function waitForMap(count) {
    await page.$eval('.dh-map-panel', node => node.scrollIntoView())
    await page.waitForSelector(mapSelector)
    await page.waitForFunction(expected => document.querySelectorAll('.leaflet-marker-icon').length === expected, {}, count)
  }
  async function assertMixedMap() {
    const markers = await page.$$eval('.leaflet-marker-icon', nodes => nodes.map(node => ({
      id: node.dataset.bookingId, status: node.dataset.bookingStatus, text: node.textContent.trim(),
      title: node.getAttribute('title'), background: getComputedStyle(node).backgroundColor,
      hasClock: Boolean(node.querySelector('svg')),
    })))
    assert.deepEqual(markers.filter(marker => marker.status === 'confirmed').map(marker => marker.text), ['1', '2', '3'], 'Confirmed map markers keep their route stop numbers')
    const tentative = markers.find(marker => marker.id === 'booking-tentative')
    assert.equal(tentative?.status, 'tentative')
    assert.equal(tentative?.text, '', 'Tentative map markers do not claim a route stop number')
    assert.equal(tentative?.hasClock, true, 'Tentative map markers show a clock symbol')
    assert.match(tentative?.title ?? '', /Preliminärt|Inväntar kund/i, 'Tentative status is available without relying on marker color')
    assert.notEqual(tentative?.background, markers.find(marker => marker.status === 'confirmed')?.background, 'Tentative and confirmed markers have different colors')
    assert.equal((await page.$$(routePath)).length, 1, 'Confirmed route has one ordering line')
    assert.equal(await page.$eval(routePath, node => (node.getAttribute('d').match(/L/g) ?? []).length), 2, 'The ordering line joins only the three confirmed stops')
  }
  try {
    await page.emulateTimezone('Europe/Stockholm')
    for (const width of [390, 768, 1440]) {
      await page.setViewport({ width, height: 1000 })
      await page.goto(`${base}/dashboard-v1`, { waitUntil: 'networkidle0' })
      await ready()
      await waitForMap(4)
      await page.evaluate(() => window.scrollTo(0, 0))
      await noOverflow(`${width}px`)
      assert.deepEqual(await actionIds(), ['ob-report', 'ob-confirmation', 'eb-inspection', 'tu-confirmation', 'task-followup'])
      assert.equal(await page.$eval('body', node => /DOLD KUNDUPPGIFT|DOLD BOKNING|DOLD ADRESS/.test(node.textContent)), false, 'Disabled module records must be excluded')
      const links = await page.$$eval('a[href]', nodes => nodes.map(node => node.getAttribute('href')))
      assert.equal(links.some(link => link.includes('/fuktsakerhet')), false, 'Disabled module has no workflow links')
      assert.ok(links.filter(link => /^\/(ob|eb|tu|uppdrag)(\/|\?)/.test(link)).every(link => link.includes('orgId=11111111-1111-4111-8111-111111111111')), 'Internal workflows keep active organization')
      const tentativeSelector = `${width <= 640 ? '.dh-calendar-mobile-booking' : '.dh-calendar-booking'}[data-booking-status="tentative"]`
      assert.equal(await page.$eval(tentativeSelector, node => node.checkVisibility()), true, 'Unconfirmed work remains visible at every viewport')
      assert.match(await page.$eval(tentativeSelector, node => node.textContent), /Äppelvägen 5/)
      assert.match(await page.$eval(tentativeSelector, node => `${node.textContent} ${node.getAttribute('aria-label') ?? ''}`), /Ej bekräftat|Obekräftat|Preliminärt|Inväntar kund/i, 'Tentative calendar status is conveyed in text as well as color')
      assert.equal(await page.$eval(tentativeSelector, node => getComputedStyle(node).borderLeftStyle), 'dashed', 'Unconfirmed work has a distinct dashed border')
      assert.notEqual(await page.$eval(tentativeSelector, node => getComputedStyle(node).backgroundColor), await page.$eval(`${width <= 640 ? '.dh-calendar-mobile-booking' : '.dh-calendar-booking'}[data-module="ob"]:not([data-booking-status="tentative"])`, node => getComputedStyle(node).backgroundColor), 'Unconfirmed work has a different color from confirmed work in the same module')
      assert.match(await page.$eval('.dh-calendar .dh-panel-heading p', node => node.textContent), /4.*bekräftade.*1.*(?:ej bekräftat|obekräftat|preliminärt)/i, 'Weekly totals distinguish confirmed and unconfirmed work')
      assert.match(await page.$eval('.dh-agenda .dh-heading-count', node => node.textContent), /3.*bekräftade.*1.*(?:ej bekräftat|obekräftat|preliminärt)/i, 'Selected-day totals distinguish confirmed and unconfirmed work')
      assert.match(await page.$eval('.dh-map-panel .dh-panel-heading', node => node.textContent), /3.*bekräftade.*1.*preliminärt/i, 'Map totals include both confirmed and tentative work')
      const agenda = await page.$$eval('.dh-agenda-row[data-booking-id]', nodes => nodes.map(node => ({ id: node.dataset.bookingId, stop: node.querySelector('.dh-stop-number')?.getAttribute('aria-label') ?? null })))
      assert.deepEqual(agenda.map(booking => booking.id), ['booking-ob', 'booking-tentative', 'booking-eb', 'booking-tu'], 'Confirmed and unconfirmed work share chronological order')
      assert.deepEqual(agenda.filter(booking => booking.id !== 'booking-tentative').map(booking => booking.stop), ['Stopp 1', 'Stopp 2', 'Stopp 3'], 'Tentative work does not shift confirmed route stop numbering')
      assert.equal(/^Stopp \d+$/.test(agenda.find(booking => booking.id === 'booking-tentative').stop ?? ''), false, 'Unconfirmed work is not numbered as a route stop')
      const route = await page.$eval('.dh-route-button', node => node.href)
      const routeParams = new URL(route).searchParams
      assert.deepEqual([...(routeParams.get('waypoints')?.split('|') ?? []), routeParams.get('destination')], ['Tallstigen 12, Nacka', 'Björkvägen 8, Stockholm', 'Storgatan 24, Solna'], 'Directions include only confirmed stops in route order')
      const mapRequests = await page.evaluate(() => window.__dashboardTest.requests.filter(url => url.startsWith('/api/dashboard/map?')))
      assert.ok(mapRequests.length > 0, 'The lazy map geocoding request ran')
      assert.ok(mapRequests.some(url => new URL(url, base).searchParams.getAll('bookingId').includes('booking-tentative')), 'Tentative work without coordinates is included in geocoding requests')
      assert.ok(mapRequests.every(url => !new URL(url, base).searchParams.getAll('bookingId').includes('restricted-booking')), 'Disabled work is excluded from geocoding requests')
      await assertMixedMap()
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
    await Promise.all([
      page.waitForFunction(() => document.querySelector('.dh-dashboard')?.getAttribute('aria-busy') === 'true'
        && document.querySelector('button[aria-label="Uppdatera översikten"]')?.disabled === true),
      page.click('button[aria-label="Uppdatera översikten"]'),
    ])
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
    await waitForMap(4)
    const markers = await page.$$eval('.leaflet-marker-icon', nodes => nodes.map(node => node.textContent.trim()))
    assert.ok(markers.includes('1') && markers.includes('2'), 'Map labels correspond to stop numbers')
    await page.click('.leaflet-marker-icon')
    assert.match(await page.$eval('body', node => node.textContent), /Tallstigen 12/)
    await page.screenshot({ path: resolve(output, 'dashboard-map.png'), fullPage: true })
    await page.click('.leaflet-popup-close-button')
    await page.click(tentativeMarker)
    await page.waitForFunction(() => document.querySelector('.leaflet-popup-content')?.textContent.includes('Äppelvägen 5'))
    assert.match(await page.$eval('.leaflet-popup-content', node => node.textContent), /Äppelvägen 5.*Preliminärt.*Inväntar kund/s, 'Tentative popup identifies the appointment and confirmation status')
    const confirmationLink = await page.$eval('.leaflet-popup-content a', node => ({ href: node.getAttribute('href'), label: node.textContent }))
    assert.equal(confirmationLink.href, '/ob/assignments/test-tentative?orgId=11111111-1111-4111-8111-111111111111')
    assert.equal(confirmationLink.label, 'Öppna uppdrag', 'Popup link describes the shared workflow action')
    await page.screenshot({ path: resolve(output, 'dashboard-map-tentative.png'), fullPage: true })
    assert.equal(await page.evaluate(() => window.__dashboardTest.writes), 0)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('.leaflet-popup-content a'),
    ])
    assert.equal(new URL(page.url()).pathname, '/ob/assignments/test-tentative', 'Opening unconfirmed work navigates to its confirmation')
    assert.equal(new URL(page.url()).searchParams.get('orgId'), '11111111-1111-4111-8111-111111111111')
    assert.deepEqual(workflowNavigations.map(request => request.method), ['GET'], 'Opening a confirmation never sends or accepts it')
    await page.goto(`${base}/dashboard-v1?state=tentative-only`, { waitUntil: 'networkidle0' })
    await ready()
    assert.equal((await page.$$('.dh-agenda-row[data-booking-id]')).length, 1, 'A day with only unconfirmed work retains its agenda entry')
    assert.equal(await page.$('.dh-route-button'), null, 'A day with only unconfirmed work offers no confirmed driving route')
    await waitForMap(1)
    assert.equal((await page.$$(routePath)).length, 0, 'A tentative-only day has no confirmed ordering line')
    assert.equal(await page.$eval(tentativeMarker, node => node.dataset.bookingStatus), 'tentative')
    assert.ok((await page.evaluate(() => window.__dashboardTest.requests)).some(url => url.startsWith('/api/dashboard/map?') && new URL(url, base).searchParams.getAll('bookingId').includes('booking-tentative')), 'A tentative-only day resolves its address')
    await noOverflow('Tentative-only dashboard')
    await page.screenshot({ path: resolve(output, 'dashboard-tentative-only.png'), fullPage: true })
    const draftVisits = [
      { id: 'booking-draft-ob', module: 'ob', moduleName: 'Överlåtelsebesiktning', title: 'Klövervägen 3', time: '10:00', address: 'Klövervägen 3, Nacka', href: '/ob/assignments/test-draft-ob?orgId=11111111-1111-4111-8111-111111111111', status: 'Preliminärt · Bekräftelse ej skickad' },
      { id: 'booking-draft-eb', module: 'eb', moduleName: 'Entreprenadbesiktning', title: 'Kvarteret Linden', time: '12:15', address: 'Lindvägen 6, Stockholm', href: '/eb/projects/test-draft-eb?orgId=11111111-1111-4111-8111-111111111111', status: 'Preliminärt · Bekräftelse ej skickad' },
      { id: 'booking-draft-tu', module: 'tu', moduleName: 'Tekniska utredningar', title: 'Utredning · Ekvägen 11', time: '13:30', address: 'Ekvägen 11, Solna', href: '/tu/assignments/test-draft-tu?orgId=11111111-1111-4111-8111-111111111111', status: 'Preliminärt · Bekräftelse ej skickad' },
      { id: 'booking-draft-case', module: 'tasks', moduleName: 'Uppdrag', title: 'Platsbesök · Brf Syrenen', time: '15:00', address: 'Syrenvägen 9, Bromma', href: '/uppdrag/test-draft-case', status: 'Preliminärt · Planerat platsbesök' },
    ]
    for (const width of [390, 1440]) {
      await page.setViewport({ width, height: 1000 })
      await page.goto(`${base}/dashboard-v1?state=multi-module-drafts`, { waitUntil: 'networkidle0' })
      await ready()
      await waitForMap(4)
      const calendarSelector = width <= 640 ? '.dh-calendar-mobile-booking' : '.dh-calendar-booking'
      const cards = await page.$$eval(calendarSelector, nodes => nodes.map(node => ({
        module: node.dataset.module, status: node.dataset.bookingStatus, title: node.textContent,
        time: node.querySelector('time').textContent, tooltip: node.title, href: node.getAttribute('href'),
        visible: node.checkVisibility(), border: getComputedStyle(node).borderLeftStyle,
      })))
      assert.equal(cards.length, 4, `${width}px: OB, EB, TU drafts and Uppdrag site visits all appear in the calendar`)
      for (const [index, visit] of draftVisits.entries()) {
        const card = cards[index]
        assert.equal(card.module, visit.module)
        assert.equal(card.status, 'tentative')
        assert.equal(card.visible, true)
        assert.equal(card.border, 'dashed')
        assert.ok(card.title.includes(visit.title) && card.title.includes('Preliminärt'))
        assert.equal(card.time, visit.time)
        assert.ok(card.tooltip.includes(visit.status), 'Draft status is available in calendar text')
        assert.equal(card.href, visit.href)
        const row = await page.$eval(`.dh-agenda-row[data-booking-id="${visit.id}"]`, node => ({
          text: node.textContent, status: node.dataset.bookingStatus, hasClock: Boolean(node.querySelector('.dh-tentative-stop svg')),
          time: node.querySelector('time').textContent, href: node.querySelector('.dh-agenda-open').getAttribute('href'),
        }))
        assert.equal(row.status, 'tentative')
        assert.equal(row.hasClock, true)
        assert.equal(row.time, visit.time)
        assert.ok(row.text.includes(visit.title) && row.text.includes(visit.moduleName) && row.text.includes(visit.status) && row.text.includes(visit.address), 'Day list identifies draft, module, status and address')
        assert.equal(row.href, card.href)
      }
      assert.match(await page.$eval('.dh-calendar .dh-panel-heading p', node => node.textContent), /0 bekräftade · 4 preliminära denna vecka/)
      assert.match(await page.$eval('.dh-agenda .dh-count', node => node.textContent), /0 bekräftade · 4 preliminära/)
      assert.deepEqual(await page.$$eval('.dh-agenda-row[data-booking-id]', nodes => nodes.map(node => node.dataset.bookingId)), draftVisits.map(visit => visit.id), 'Scheduled drafts stay in chronological order')
      const draftMarkers = await page.$$eval('.leaflet-marker-icon', nodes => nodes.map(node => ({
        id: node.dataset.bookingId, status: node.dataset.bookingStatus, text: node.textContent,
        clock: Boolean(node.querySelector('svg')), background: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderStyle,
      })))
      assert.deepEqual(draftMarkers.map(marker => marker.id), draftVisits.map(visit => visit.id))
      assert.ok(draftMarkers.every(marker => marker.status === 'tentative' && marker.text === '' && marker.clock && marker.border === 'dashed' && marker.background === 'rgb(255, 244, 214)'), 'All four draft map markers are yellow clocks without confirmed stop numbers')
      assert.equal(await page.$('.dh-route-button'), null, 'Draft-only work offers no confirmed driving route')
      assert.equal((await page.$$(routePath)).length, 0, 'Draft-only work has no confirmed route polyline')
      const draftRequests = await page.evaluate(() => window.__dashboardTest.requests.filter(url => url.startsWith('/api/dashboard/map?')))
      assert.ok(draftRequests.some(url => draftVisits.every(visit => new URL(url, base).searchParams.getAll('bookingId').includes(visit.id))), 'Every draft module resolves its synthetic visit address')
      await noOverflow(`Scheduled module drafts ${width}px`)
      await page.screenshot({ path: resolve(output, `dashboard-module-drafts-${width}.png`), fullPage: true })
      for (const visit of draftVisits) {
        // Keyboard targets the exact marker while earlier popups finish panning.
        await page.focus(`.leaflet-marker-icon[data-booking-id="${visit.id}"]`)
        await page.keyboard.press('Enter')
        await page.waitForFunction(title => document.querySelector('.leaflet-popup-content')?.textContent.includes(title), {}, visit.title)
        const popup = await page.$eval('.leaflet-popup-content', node => ({ text: node.textContent, href: node.querySelector('a').getAttribute('href') }))
        assert.ok(popup.text.includes(visit.title) && popup.text.includes(visit.status) && popup.text.includes(visit.address), 'Every draft popup identifies its visit and preliminary status')
        assert.equal(popup.href, visit.href)
        await page.click('.leaflet-popup-close-button')
      }
      for (const visit of draftVisits) {
        await page.select('select[aria-label="Filtrera arbetsområde"]', visit.module)
        await waitForMap(1)
        assert.deepEqual(await page.$$eval(calendarSelector, nodes => nodes.map(node => node.dataset.module)), [visit.module], 'Module filter isolates calendar drafts')
        assert.deepEqual(await page.$$eval('.dh-agenda-row[data-booking-id]', nodes => nodes.map(node => node.dataset.bookingId)), [visit.id], 'Module filter isolates the day list')
        assert.deepEqual(await page.$$eval('.leaflet-marker-icon', nodes => nodes.map(node => node.dataset.bookingId)), [visit.id], 'Module filter isolates map draft markers')
        assert.equal(await page.$('.dh-route-button'), null)
        assert.equal((await page.$$(routePath)).length, 0)
        await noOverflow(`${visit.module} draft filter ${width}px`)
      }
      assert.equal(await page.evaluate(() => window.__dashboardTest.writes), 0)
    }
    await page.setViewport({ width: 1440, height: 1000 })
    await page.goto(`${base}/dashboard-v1?state=client`, { waitUntil: 'networkidle0' })
    await ready()
    await waitForMap(4)
    await assertMixedMap()
    const tentativeColor = await page.$eval(tentativeMarker, node => getComputedStyle(node).backgroundColor)
    await page.evaluate(() => { window.__dashboardTest.confirmTentative = true })
    await page.click('button[aria-label="Uppdatera översikten"]')
    await page.waitForFunction(() => document.querySelector('.leaflet-marker-icon[data-booking-id="booking-tentative"]')?.dataset.bookingStatus === 'confirmed')
    assert.equal(await page.$eval(tentativeMarker, node => node.textContent.trim()), '2', 'Confirmed former tentative work receives its chronological route stop number')
    assert.notEqual(await page.$eval(tentativeMarker, node => getComputedStyle(node).backgroundColor), tentativeColor, 'Refreshing a newly confirmed assignment updates its map color')
    assert.equal((await page.$$('.leaflet-marker-icon')).length, 4, 'Status transitions replace markers without duplicates')
    assert.equal(await page.$eval(routePath, node => (node.getAttribute('d').match(/L/g) ?? []).length), 3, 'Confirming the appointment adds it to the ordering line')
    assert.deepEqual(await page.$$eval('.leaflet-marker-icon', nodes => nodes.map(node => node.textContent.trim())), ['1', '2', '3', '4'])
    assert.equal(new URL(await page.$eval('.dh-route-button', node => node.href)).searchParams.get('waypoints').includes('Äppelvägen 5, Täby'), true, 'Confirming the appointment adds it to Google directions')
    await page.click(tentativeMarker)
    assert.equal(await page.$eval('.leaflet-popup-content a', node => node.getAttribute('href')), '/ob/inspections/test-tentative-converted?orgId=11111111-1111-4111-8111-111111111111', 'Map popup refreshes to the confirmed inspection link')
    assert.match(await page.$eval('.leaflet-popup-content', node => node.textContent), /Bekräftat/i)
    await page.screenshot({ path: resolve(output, 'dashboard-map-newly-confirmed.png'), fullPage: true })
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
    assert.equal(await page.$('.dh-agenda-row[data-booking-id]'), null, 'Revoked access removes all prior booked work')
    assert.equal(await page.$eval('body', node => /Tallstigen 12|Kvarteret Björken|Storgatan 24/.test(node.textContent)), false, '403 refresh clears customer data and action/calendar/map snapshots')
    await page.screenshot({ path: resolve(output, 'dashboard-access-revoked.png'), fullPage: true })
    assert.equal(await page.evaluate(() => window.__dashboardTest.writes), 0)
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    console.log('PASS: dashboard 390/768/1440px layouts; tentative calendar/day/map entries, clock markers, status text and distinct color; scheduled OB/EB/TU drafts and Uppdrag site visits at 390/1440px, preliminary labels, map popups, workflow links and module filters; confirmed/tentative totals; confirmed-only route numbering, polyline and Google directions; tentative geocoding; GET-only map confirmation navigation; tentative-only map; tentative-to-confirmed refresh updates markers, popup, route and line; active-organization links; disabled-module isolation; module menu; action tabs/module/search; show all/fewer; calendar navigation; empty states; load retry; foreign-organization rejection; transient snapshot preservation and 403 clearing. Synthetic data and tiles only; no external requests or writes.')
  } catch (error) {
    console.error(await page.$eval('body', node => node.innerText))
    await page.screenshot({ path: resolve(output, 'dashboard-failure.png'), fullPage: true })
    throw error
  } finally { await browser.close() }
}
