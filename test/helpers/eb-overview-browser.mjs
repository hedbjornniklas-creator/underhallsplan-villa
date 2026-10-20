import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testEbOverview(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const rows = () => page.$$eval('tr[data-row-id]', nodes => nodes.map(node => node.dataset.rowId))
  async function ready() {
    await page.waitForSelector('.eb-overview[aria-busy="false"]')
    await page.evaluate(() => document.fonts.ready)
  }
  async function clickText(text, scope = 'document') {
    const clicked = await page.evaluate((text, scope) => {
      const root = scope === 'document' ? document : document.querySelector(scope)
      const button = [...root.querySelectorAll('button')].find(node => node.checkVisibility() && node.textContent.trim() === text)
      button?.click()
      return Boolean(button)
    }, text, scope)
    assert.ok(clicked, `Visible button: ${text}`)
  }
  async function labelSelector(text, tag = 'select', scope = 'dialog[open]') {
    const id = `eb-preview-${Math.random().toString(16).slice(2)}`
    const found = await page.evaluate((text, tag, scope, id) => {
      const root = document.querySelector(scope)
      const label = [...root.querySelectorAll('label')].find(node => node.textContent.trim().startsWith(text) && node.querySelector(tag))
      const field = label?.querySelector(tag)
      if (field) field.id = id
      return Boolean(field)
    }, text, tag, scope, id)
    assert.ok(found, `Field label: ${text}`)
    return `#${id}`
  }
  async function chooseFilter(value, width) {
    if (width < 960) await page.select('.obo-filter-select select', value)
    else await page.click(`.obo-filter-buttons button:nth-child(${({ active: 1, closed: 2, all: 3 })[value]})`)
  }
  async function layout(label) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: page overflow`)
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.obo-toolbar, .obo-table td, .obo-check, .obo-actions a, .obh-actions')]
      .filter(node => node.checkVisibility() && node.scrollWidth > node.clientWidth + 1).map(node => node.className)), [], `${label}: content overflow`)
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.obo button, .obo select, .obo input:not([type=checkbox]), .obo a, .obh-actions button, .obh-actions a')]
      .filter(node => node.checkVisibility() && node.getBoundingClientRect().height < 44).map(node => node.outerHTML)), [], `${label}: touch targets`)
  }
  async function openNew() {
    await clickText('Ny besiktning')
    await page.waitForSelector('dialog[open]')
    assert.match(await page.$eval('dialog[open] h2', node => node.textContent), /Ny besiktning/)
  }
  async function openReuse() {
    await page.click('tr[data-row-id="inspection-closed"] button[aria-label^="Ny slutbesiktning från tidigare:"]')
    await page.waitForSelector('dialog[open]')
    await page.waitForFunction(() => document.querySelector('dialog[open] h2')?.textContent === 'Ny slutbesiktning från tidigare')
    await page.waitForSelector('dialog[open] [data-source-inspection-id="inspection-closed"]')
  }
  async function openGenericReuse() {
    await openNew()
    await page.select(await labelSelector('Välj entreprenad'), 'project-alpha')
    await page.select(await labelSelector('Typ av besiktning'), 'SLB')
    await page.select(await labelSelector('Tidigare besiktning'), 'inspection-closed')
    await page.click(await labelSelector('Utgå från den tidigare slutbesiktningen', 'input'))
  }
  async function showMeetingDetails() {
    await page.focus('dialog[open] details summary')
    if (!await page.$eval('dialog[open] details', node => node.open)) await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('dialog[open] details').open)
  }
  try {
    for (const width of [390, 1440]) {
      await page.setViewport({ width, height: 1000 })
      await page.goto(`${base}/eb`, { waitUntil: 'networkidle0' })
      await ready()
      await layout(`${width}`)
      assert.equal((await rows()).length, 10)
      assert.equal((await rows()).includes('inspection-closed'), false)
      assert.ok((await rows()).includes('inspection-slab'))
      assert.ok((await rows()).includes('inspection-after'), 'Both inspections in one project have their own row')
      assert.ok((await rows()).includes('inspection-delivery'), 'Unsent completed inspection stays in worklist')
      assert.equal(await page.$eval('.obo-pagination', node => node.textContent.includes('1–10 av 13')), true)
      await page.screenshot({ path: resolve(output, `eb-home-${width}.png`), fullPage: width >= 960 })

      await chooseFilter('closed', width)
      assert.equal((await rows()).length, 3)
      assert.ok((await rows()).includes('inspection-closed'))
      assert.equal((await rows()).includes('inspection-delivery'), false)
      await layout(`${width}: completed row with reuse action`)
      assert.equal(await page.$$eval('button[aria-label^="Ny slutbesiktning från tidigare:"]', nodes => nodes.length), 1,
        'Only a locked, not-approved final inspection offers the dedicated reuse action')
      await openReuse()
      if (width === 390) await page.setViewport({ width, height: 844 })
      assert.equal(await page.$$eval('dialog[open] select, dialog[open] input[type=radio]', nodes => nodes.length), 0, 'Dedicated reuse has no redundant project or inspection selectors')
      assert.match(await page.$eval('dialog[open] [data-source-inspection-id]', node => node.textContent), /Slutbesiktning 1 · 2026-10-10 · Ej godkänd/)
      assert.match(await page.$eval('dialog[open]', node => node.textContent), /Renovering Testvillan/)
      assert.equal(await page.$eval(await labelSelector('Datum', 'input'), node => node.value), '', 'The old inspection date is never prefilled')
      assert.equal(await page.$eval(await labelSelector('Ta med tidigare noteringar och bilder', 'input'), node => node.checked), true)
      assert.match(await page.$eval('dialog[open]', node => node.textContent), /Originalet lämnas oförändrat/)
      assert.equal(await page.$eval(await labelSelector('Ta med tidigare noteringar och bilder', 'input'), node => {
        const checkbox = node.getBoundingClientRect()
        const footer = document.querySelector('dialog[open] footer').getBoundingClientRect()
        return checkbox.top >= 0 && checkbox.bottom < footer.top && checkbox.bottom < innerHeight
      }), true, `${width}: optional note choice is visible above the create footer without scrolling`)
      assert.equal(await page.$eval(await labelSelector('Datum', 'input'), node => node.getBoundingClientRect().bottom < document.querySelector('dialog[open] footer').getBoundingClientRect().top), true,
        `${width}: new date is visible above the footer without scrolling`)
      assert.equal(await page.$eval('dialog[open]', node => node.scrollWidth > node.clientWidth + 1), false, `${width}: reuse dialog overflow`)
      await page.screenshot({ path: resolve(output, `eb-new-from-previous-${width}.png`) })
      await showMeetingDetails()
      assert.equal(await page.$eval(await labelSelector('Samlingsplats', 'input'), node => node.value), 'Tidigare entrén', 'The location is reusable base data')
      assert.equal(await page.$eval(await labelSelector('Tid', 'input'), node => node.value), '', 'The previous inspection time is not inherited')
      assert.equal(await page.$eval(await labelSelector('Startmöte', 'input'), node => node.value), '', 'The previous start time is not inherited')
      assert.equal(await page.$eval(await labelSelector('Slutmöte', 'input'), node => node.value), '', 'The previous end time is not inherited')
      await page.keyboard.press('Escape')
      await page.waitForSelector('dialog[open]', { hidden: true })
      if (width === 390) await page.setViewport({ width, height: 1000 })
      assert.equal(await page.evaluate(() => window.__ebOverviewTest.writes.length), 0, 'Opening or cancelling reuse changes nothing')
      await chooseFilter('all', width)
      await page.select('.obo-page-size select', '25')
      assert.equal((await rows()).length, 16)
      await page.type('input[aria-label="Sök besiktningar"]', 'Renovering Testvillan')
      await page.waitForFunction(() => document.querySelectorAll('tr[data-row-id]').length === 4)
      assert.deepEqual(new Set(await rows()), new Set(['inspection-slab', 'inspection-after', 'inspection-delivery', 'inspection-closed']))
      await page.click('button[aria-label="Rensa sökning"]')
      await chooseFilter('active', width)
      await page.select('.obo-page-size select', '10')
      await page.click('button[aria-label="Nästa sida"]')
      assert.equal((await rows()).length, 3)
      assert.ok((await rows()).includes('inspection-10'), 'PDF failure remains visible')
      await page.select('.obo-sort select', 'customer')
      assert.match(await page.$eval('tr[data-row-id]', node => node.textContent), /Anna Andersson/)
      const beforeReads = await page.evaluate(() => window.__ebOverviewTest.reads.length)
      await page.evaluate(() => { window.__ebOverviewTest.delay = 250 })
      await page.click('button[aria-label="Uppdatera besiktningslistan"]')
      await page.waitForSelector('.eb-overview[aria-busy="true"]')
      await ready()
      assert.ok(await page.evaluate(count => window.__ebOverviewTest.reads.length > count, beforeReads))
      await page.evaluate(() => { window.__ebOverviewTest.delay = 0 })

      await openNew()
      const project = await labelSelector('Välj entreprenad')
      assert.equal(await page.$eval(project, node => [...node.options].some(option => ['project-archived', 'project-cancelled'].includes(option.value))), false,
        'Archived and cancelled projects cannot receive a new inspection')
      await page.select(project, 'project-alpha')
      const variant = await labelSelector('Typ av besiktning')
      assert.equal(await page.$eval(variant, node => node.value), 'EB')
      assert.equal(await page.evaluate(() => window.__ebOverviewTest.writes.length), 0, 'Choosing a project creates and sends nothing')
      assert.equal(await page.$eval('dialog[open]', node => node.scrollWidth > node.clientWidth + 1), false, `${width}: dialog overflow`)
      await page.screenshot({ path: resolve(output, `eb-new-existing-${width}.png`) })
      await page.keyboard.press('Escape')
      await page.waitForSelector('dialog[open]', { hidden: true })
      assert.equal(await page.evaluate(() => window.__ebOverviewTest.writes.length), 0)
      console.log(`EB overview ${width}: layout, filters, list interactions and dialog cancellation passed.`)
    }

    await page.setViewport({ width: 1440, height: 1000 })
    await page.goto(`${base}/eb`, { waitUntil: 'networkidle0' })
    await ready()
    await chooseFilter('closed', 1440)
    await openGenericReuse()
    await page.click(await labelSelector('Ta med tidigare noteringar och bilder', 'input'))
    await page.select(await labelSelector('Typ av besiktning'), 'EB')
    assert.equal(await page.$$eval('dialog[open] input[type=checkbox]', nodes => nodes.length), 0, 'Changing type removes stale reuse settings')
    await page.select(await labelSelector('Typ av besiktning'), 'SLB')
    assert.equal(await page.$eval(await labelSelector('Utgå från den tidigare slutbesiktningen', 'input'), node => node.checked), false,
      'Returning to SLB does not silently restore reuse')
    await showMeetingDetails()
    assert.equal(await page.$eval(await labelSelector('Samlingsplats', 'input'), node => node.value), '', 'Changing type clears only the inherited location')
    await page.click(await labelSelector('Utgå från den tidigare slutbesiktningen', 'input'))
    assert.equal(await page.$eval(await labelSelector('Samlingsplats', 'input'), node => node.value), 'Tidigare entrén', 'Generic reuse fills an empty location')
    await page.select(await labelSelector('Tidigare besiktning'), 'inspection-slab')
    assert.equal(await page.$$eval('dialog[open] input[type=checkbox]', nodes => nodes.length), 0, 'A draft source is not eligible')
    assert.equal(await page.$eval(await labelSelector('Samlingsplats', 'input'), node => node.value), '', 'A different source does not retain an auto-copied location')
    await page.select(await labelSelector('Tidigare besiktning'), 'inspection-closed')
    assert.equal(await page.$eval(await labelSelector('Utgå från den tidigare slutbesiktningen', 'input'), node => node.checked), false,
      'Changing source clears reuse')
    await page.type(await labelSelector('Samlingsplats', 'input'), 'Egen vald plats')
    await page.click(await labelSelector('Utgå från den tidigare slutbesiktningen', 'input'))
    assert.equal(await page.$eval(await labelSelector('Samlingsplats', 'input'), node => node.value), 'Egen vald plats', 'Generic reuse never overwrites a typed location')
    await page.click('dialog[open] input[type=radio][value=new]')
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('dialog[open] label')].some(node => node.textContent.includes('Utgå från den tidigare slutbesiktningen'))), false)
    await page.click('dialog[open] input[type=radio][value=existing]')
    assert.equal(await page.$eval(await labelSelector('Typ av besiktning'), node => node.value), 'EB', 'Existing mode keeps the established EB default')
    await page.select(await labelSelector('Typ av besiktning'), 'SLB')
    await page.select(await labelSelector('Tidigare besiktning'), 'inspection-closed')
    assert.equal(await page.$eval(await labelSelector('Utgå från den tidigare slutbesiktningen', 'input'), node => node.checked), false)
    await page.click(await labelSelector('Utgå från den tidigare slutbesiktningen', 'input'))
    await page.select(await labelSelector('Välj entreprenad'), 'project-without-inspections')
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('dialog[open] label')].some(node => node.textContent.includes('Utgå från den tidigare slutbesiktningen'))), false,
      'Changing project clears the source and reuse options')
    await page.keyboard.press('Escape')
    await page.waitForSelector('dialog[open]', { hidden: true })
    assert.equal(await page.evaluate(() => window.__ebOverviewTest.writes.length), 0)

    await page.evaluate(() => { window.__ebOverviewTest.delay = 1200 })
    await page.click('button[aria-label="Uppdatera besiktningslistan"]')
    await openReuse()
    await page.click(await labelSelector('Ta med tidigare noteringar och bilder', 'input'))
    await showMeetingDetails()
    const meetingPlace = await labelSelector('Samlingsplats', 'input')
    await page.focus(meetingPlace)
    await page.keyboard.down('Control')
    await page.keyboard.press('A')
    await page.keyboard.up('Control')
    await page.type(meetingPlace, 'Nya entrén')
    await ready()
    assert.equal(await page.$eval(meetingPlace, node => node.value), 'Nya entrén', 'A parent list refresh keeps the new inspection draft')
    assert.equal(await page.$eval(meetingPlace, node => document.activeElement === node), true, 'Parent list refresh does not move editing focus')
    assert.equal(await page.$eval(await labelSelector('Ta med tidigare noteringar och bilder', 'input'), node => node.checked), false,
      'Parent rerender does not reset the optional notes choice')
    await page.evaluate(() => { window.__ebOverviewTest.delay = 0 })
    await clickText('Skapa besiktning', 'dialog[open]')
    await page.waitForSelector('dialog[open]', { hidden: true })
    assert.deepEqual(await page.evaluate(() => window.__ebOverviewTest.writes.map(item => ({
      url: item.url, variant: item.body.variant, parentInspectionId: item.body.parentInspectionId,
      reusePreviousInspection: item.body.reusePreviousInspection, includePreviousNotes: item.body.includePreviousNotes,
      inspectionTime: item.body.inspectionTime, meetingPlace: item.body.meetingPlace,
    }))), [{
      url: '/api/eb/projects/project-alpha/inspections', variant: 'SLB', parentInspectionId: 'inspection-closed',
      reusePreviousInspection: true, includePreviousNotes: false, inspectionTime: '', meetingPlace: 'Nya entrén',
    }], 'A separate new inspection is created from the explicit source, with old notes optional and no inherited meeting time')
    assert.ok(await page.evaluate(() => window.__ebOverviewTest.navigations.some(url => url.includes('synthetic-created-inspection'))))
    await page.goto(`${base}/eb`, { waitUntil: 'networkidle0' })
    await ready()
    await chooseFilter('closed', 1440)
    await openReuse()
    await clickText('Skapa besiktning', 'dialog[open]')
    await page.waitForSelector('dialog[open]', { hidden: true })
    assert.deepEqual(await page.evaluate(() => window.__ebOverviewTest.writes.map(item => ({
      url: item.url, parentInspectionId: item.body.parentInspectionId,
      reusePreviousInspection: item.body.reusePreviousInspection, includePreviousNotes: item.body.includePreviousNotes,
      inspectionDate: item.body.inspectionDate,
    }))), [{
      url: '/api/eb/projects/project-alpha/inspections', parentInspectionId: 'inspection-closed',
      reusePreviousInspection: true, includePreviousNotes: true, inspectionDate: '',
    }], 'The default carries previous notes and pictures only into the new inspection, never its old date')
    await page.goto(`${base}/eb`, { waitUntil: 'networkidle0' })
    await ready()
    await chooseFilter('closed', 1440)
    await page.evaluate(() => { window.__ebOverviewTest.delay = 800; window.__ebOverviewTest.sourceUnlocked = true })
    await page.click('button[aria-label="Uppdatera besiktningslistan"]')
    await openReuse()
    await ready()
    await clickText('Skapa besiktning', 'dialog[open]')
    await page.waitForSelector('dialog[open] [role=alert]')
    assert.match(await page.$eval('dialog[open] [role=alert]', node => node.textContent), /kan inte längre användas som underlag/)
    assert.equal(await page.evaluate(() => window.__ebOverviewTest.writes.length), 0,
      'A source unlocked elsewhere cannot silently turn a requested copy into an empty generic inspection')
    await page.keyboard.press('Escape')
    await page.waitForSelector('dialog[open]', { hidden: true })
    console.log('EB overview: source reuse is explicit, optional notes payload and project/mode/type/source resets passed.')

    await page.goto(`${base}/eb`, { waitUntil: 'networkidle0' })
    await ready()
    await page.click('tr[data-row-id="inspection-delivery"] .eb-delivery-action')
    await page.waitForSelector('[role=dialog] #eb-delivery-customer:not([disabled])')
    await page.waitForFunction(() => document.querySelector('#eb-delivery-customer').value === 'anna@example.invalid')
    const deliveryReads = () => page.evaluate(() => window.__ebOverviewTest.reads.filter(url => url.endsWith('/report-delivery')).length)
    assert.equal(await deliveryReads(), 1, 'Opening delivery fetches metadata once even when its response refreshes the parent project')
    await page.click('#eb-delivery-customer', { clickCount: 3 })
    await page.type('#eb-delivery-customer', 'redigerad@example.invalid')
    const extras = await labelSelector('Övriga mottagare', 'textarea', '[role=dialog]')
    await page.type(extras, 'extra@example.invalid')
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
    assert.equal(await deliveryReads(), 1, 'Stable parent callback prevents an automatic metadata request loop')
    assert.equal(await page.$eval(extras, node => document.activeElement === node), true, 'Editing focus does not repeatedly reset')
    assert.equal(await page.$eval('#eb-delivery-customer', node => node.value), 'redigerad@example.invalid')
    await clickText('Uppdatera status', '[role=dialog]')
    await page.waitForFunction(() => window.__ebOverviewTest.reads.filter(url => url.endsWith('/report-delivery')).length === 2)
    await page.waitForSelector('[role=dialog] #eb-delivery-customer:not([disabled])')
    assert.equal(await page.$eval('#eb-delivery-customer', node => node.value), 'redigerad@example.invalid', 'Explicit metadata refresh keeps the recipient draft')
    assert.equal(await page.$eval(await labelSelector('Övriga mottagare', 'textarea', '[role=dialog]'), node => node.value), 'extra@example.invalid',
      'The refreshed project does not reset additional recipient drafts')
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
    assert.equal(await deliveryReads(), 2)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[role=dialog]', { hidden: true })
    await ready()
    assert.equal(await page.evaluate(() => window.__ebOverviewTest.writes.length), 0, 'Reviewing and closing delivery sends or changes nothing')
    await page.click('tr[data-row-id="inspection-delivery"] .eb-delivery-action')
    await page.waitForFunction(() => document.querySelector('#eb-delivery-customer')?.value === 'anna@example.invalid')
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
    assert.equal(await deliveryReads(), 3, 'Reopening loads the current project once')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[role=dialog]', { hidden: true })
    await ready()
    console.log('EB overview: delivery parent updates retain drafts/focus, requests are bounded and Escape sends nothing.')

    await openNew()
    await page.select(await labelSelector('Välj entreprenad'), 'project-alpha')
    await clickText('Skapa besiktning', 'dialog[open]')
    await page.waitForSelector('dialog[open]', { hidden: true })
    assert.deepEqual(await page.evaluate(() => window.__ebOverviewTest.writes.map(item => item.url)), ['/api/eb/projects/project-alpha/inspections'])
    assert.deepEqual(await page.evaluate(() => window.__ebOverviewTest.writes.map(item => ({
      reuse: item.body.reusePreviousInspection, notes: item.body.includePreviousNotes,
    }))), [{ reuse: false, notes: false }], 'Generic creation does not silently copy a prior inspection')
    assert.ok(await page.evaluate(() => window.__ebOverviewTest.navigations.some(url => url.includes('synthetic-created-inspection'))))

    await page.goto(`${base}/eb`, { waitUntil: 'networkidle0' })
    await ready()
    await openNew()
    await page.click('dialog[open] input[type=radio][value=new]')
    await page.type(await labelSelector('Projektnamn', 'input'), 'Syntetiskt nytt projekt')
    await page.evaluate(() => { window.__ebOverviewTest.createInspectionFailures = 1 })
    await clickText('Skapa besiktning', 'dialog[open]')
    await page.waitForSelector('dialog[open] [role=alert]')
    assert.match(await page.$eval('dialog[open]', node => node.textContent), /Entreprenaden Syntetiskt nytt projekt är sparad/)
    assert.equal(await page.evaluate(() => window.__ebOverviewTest.writes.filter(item => item.url === '/api/eb/projects').length), 1)
    await clickText('Skapa besiktning', 'dialog[open]')
    await page.waitForSelector('dialog[open]', { hidden: true })
    assert.equal(await page.evaluate(() => window.__ebOverviewTest.writes.filter(item => item.url === '/api/eb/projects').length), 1, 'Retry reuses the saved project')
    assert.equal(await page.evaluate(() => window.__ebOverviewTest.writes.filter(item => item.url.endsWith('/inspections')).length), 2)

    await page.goto(`${base}/eb`, { waitUntil: 'networkidle0' })
    await ready()
    await openNew()
    await page.click('dialog[open] input[type=radio][value=new]')
    await page.type(await labelSelector('Projektnamn', 'input'), 'Syntetiskt återupptaget projekt')
    await page.evaluate(() => { window.__ebOverviewTest.createInspectionFailures = 1 })
    await clickText('Skapa besiktning', 'dialog[open]')
    await page.waitForSelector('dialog[open] [role=alert]')
    await clickText('Avbryt', 'dialog[open]')
    await page.waitForSelector('dialog[open]', { hidden: true })
    await page.evaluate(() => {
      const details = document.querySelector('.eb-empty-projects')
      details.open = true
      const project = [...details.querySelectorAll('li')].find(node => node.textContent.includes('Syntetiskt återupptaget projekt'))
      project.querySelector('button').click()
    })
    await page.waitForSelector('dialog[open]')
    assert.equal(await page.$eval(await labelSelector('Välj entreprenad'), node => node.value), 'synthetic-created-project')
    await clickText('Skapa besiktning', 'dialog[open]')
    await page.waitForSelector('dialog[open]', { hidden: true })
    assert.equal(await page.evaluate(() => window.__ebOverviewTest.writes.filter(item => item.url === '/api/eb/projects').length), 1, 'Closing and resuming reuses the saved project')
    console.log('EB overview: existing creation and new project retry/resume passed.')

    await page.goto(`${base}/eb?state=project-dialog`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('dialog[open]')
    assert.equal(await page.$$eval('dialog[open] input[type=radio]', nodes => nodes.length), 0,
      'The project-detail entry cannot create or switch to a different project')
    assert.equal(await page.$$eval('dialog[open] select', nodes => nodes.length), 0, 'The dedicated entry shows a compact fixed source rather than redundant selectors')
    assert.equal(await page.$eval('dialog[open] [data-source-inspection-id]', node => node.dataset.sourceInspectionId), 'inspection-closed')
    assert.match(await page.$eval('dialog[open]', node => node.textContent), /Renovering Testvillan/)
    await clickText('Skapa besiktning', 'dialog[open]')
    await page.waitForSelector('dialog[open]', { hidden: true })
    assert.deepEqual(await page.evaluate(() => window.__ebOverviewTest.writes.map(item => item.url)), ['/api/eb/projects/project-alpha/inspections'])
    console.log('EB overview: shared project-detail dialog keeps the existing project fixed.')

    await page.goto(`${base}/eb`, { waitUntil: 'networkidle0' })
    await ready()
    await page.evaluate(() => { window.__ebOverviewTest.fail = true })
    await page.click('button[aria-label="Uppdatera besiktningslistan"]')
    await page.waitForSelector('.obo-error')
    assert.equal((await rows()).length, 10, 'Temporary server failure preserves loaded inspections')
    await page.evaluate(() => { window.__ebOverviewTest.failStatus = 403 })
    await page.click('.obo-error button')
    await page.waitForFunction(() => document.querySelectorAll('tr[data-row-id]').length === 0)
    assert.equal((await rows()).length, 0, 'Revoked access clears the stale inspection list')
    await page.evaluate(() => { window.__ebOverviewTest.fail = false })
    await page.click('.obo-error button')
    await ready()
    assert.equal((await rows()).length, 10)

    await page.goto(`${base}/eb?state=empty`, { waitUntil: 'networkidle0' })
    await ready()
    assert.match(await page.$eval('.obo-empty', node => node.textContent), /Inga besiktningar/)
    await page.screenshot({ path: resolve(output, 'eb-home-empty.png') })
    await page.goto(`${base}/eb?state=error`, { waitUntil: 'networkidle0' })
    await ready()
    assert.ok(await page.$('.obo-error'))
    await page.screenshot({ path: resolve(output, 'eb-home-error.png') })
    await page.evaluate(() => { window.__ebOverviewTest.fail = false })
    await page.click('.obo-error button')
    await ready()
    await page.waitForSelector('.obo-error', { hidden: true })
    assert.equal((await rows()).length, 10)
    assert.deepEqual(errors, [])
    console.log('EB overview: desktop/mobile layout, inspection rows, lifecycle filters, search, sorting, paging, refresh, creation/cancel/retry, empty/error recovery passed.')
  } finally { await browser.close() }
}
