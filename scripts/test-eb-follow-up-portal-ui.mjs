import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

// Local synthetic portal only: every external browser request is blocked.
// This never contacts Supabase, mail providers, production portals or orders.
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/eb-follow-up-portal-ui')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  entry: resolve('test/fixtures/eb-follow-up-portal.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? new Error(stats.toString('errors-only'))) : ok()))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const js = await readFile(resolve(output, 'view.js'))
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR4sAAAAASUVORK5CYII=', 'base64')
const initial = role => ({
  state: 'open', project: { id: 'project', title: 'Testvilla – lokal portalgranskning', objectLabel: 'TESTVILLAN 1',
    address: 'Testvägen 1, Teststad', contractorName: null, contractorEmail: null },
  inspection: { id: 'inspection', variant: 'SLB', variantLabel: 'Slutbesiktning', sequenceNo: 1,
    date: '2026-09-07', defaultRemedyDeadline: '2026-09-30' },
  access: { id: role, role, displayName: role === 'customer_owner' ? 'Testbeställare' : 'Testutförare',
    email: 'person@example.invalid', assigneeId: role === 'assignee' ? 'worker' : null,
    expiresAt: '2027-01-01T00:00:00Z', followUpOrderId: 'order' },
  followUp: { id: 'order', status: 'active', acceptedAt: '2026-09-07T10:00:00Z', withdrawalRequestedAt: null,
    buyerName: 'Testbeställare', receiptEmail: 'buyer@example.invalid', customerType: 'consumer', withdrawalDeadline: '2026-09-21' },
  assignees: [{ id: 'worker', name: 'Målare', companyName: 'Testmåleri AB', contactName: 'Testutförare',
    email: 'worker@example.invalid', phone: null, isActive: true }],
  tasks: [{ id: 'task', inspectionId: 'inspection', noteId: 'note', followUpOrderId: 'order',
    assigneeId: role === 'customer_owner' ? null : 'worker', assignmentManagedBy: 'contractor',
    status: role === 'customer_owner' ? 'unassigned' : 'assigned', dueDate: '2026-09-25', included: true,
    snapshot: { noteNumber: 1, noteText: 'Färgsläpp vid fönstret. Ytan ska undersökas och återrapporteras.',
      location: 'Entréplan', room: 'Vardagsrum', placeDetail: 'Fönstervägg', markerKey: 'E', statusKey: null,
      disciplineLabel: 'Måleri', disciplineLittera: 'M', inspectionVariant: 'SLB', inspectionVariantLabel: 'Slutbesiktning',
      inspectionSequenceNo: 1, inspectionDate: '2026-09-07' },
    reportedRemediedAt: null, updatedAt: '2026-09-07T10:00:00.000Z' }],
  contractorSuggestions: role === 'customer_owner' ? [{ name: 'Testbygg AB', companyName: 'Testbygg AB',
    contactName: 'Testkontakt', email: 'contract@example.invalid', phone: '0700000000', source: 'report' }] : [],
  events: [], images: [], originalImages: [{ id: 'original', taskId: 'task', fileName: 'Originalbild från utlåtandet',
    imageUrl: '/mock-image.png', thumbnailUrl: '/mock-image.png', createdAt: '2026-09-07T10:00:00Z' }], accessLinks: [],
})
const bulkWorkspace = () => {
  const value = initial('customer_owner')
  value.assignees.push({ ...value.assignees[0], id: 'previous', name: 'Tidigare entreprenör',
    email: 'previous@example.invalid', isActive: false })
  value.tasks.push({ ...structuredClone(value.tasks[0]), id: 'task-2', noteId: 'note-2', dueDate: null,
    snapshot: { ...value.tasks[0].snapshot, noteNumber: 2, noteText: 'Fog saknas vid dörren.' } },
  { ...structuredClone(value.tasks[0]), id: 'task-3', noteId: 'note-3', dueDate: '2026-10-02',
    assigneeId: 'previous', status: 'in_progress',
    snapshot: { ...value.tasks[0].snapshot, noteNumber: 3, noteText: 'Befintlig tilldelning ska behållas.' } })
  return value
}
const deadlineWorkspace = (role = 'customer_owner') => {
  const value = initial(role)
  value.inspection.defaultRemedyDeadline = null
  value.assignees.push({ ...value.assignees[0], id: 'other-worker', name: 'Annan entreprenör', email: 'other@example.invalid' })
  value.tasks = [
    { id: 'task', dueDate: '2026-09-30', assigneeId: 'worker', status: 'assigned' },
    { id: 'task-2', dueDate: '2026-09-30', assigneeId: 'worker', status: 'assigned' },
  ].map((details, index) => ({ ...structuredClone(value.tasks[0]), ...details, noteId: `deadline-note-${index}`,
    snapshot: { ...value.tasks[0].snapshot, noteNumber: index + 1, noteText: `Datumsatt anmärkning ${index + 1}.` } }))
  return value
}
const galleryWorkspace = (role = 'customer_owner') => {
  const value = initial(role)
  value.tasks[0].snapshot.noteNumber = 17
  value.tasks[0].snapshot.noteText = [
    'Färgsläpp vid fönstret. Den ursprungliga noteringens nummer och text ska behållas i åtgärdslistan.',
    'Kontrollera anslutningen mot fönsterkarmen och hela den angränsande väggen. '.repeat(9).trim(),
    `Underlagsreferens: ${'LangReferensUtanMellanslag'.repeat(8)}`,
    'Avslutande mening: här slutar notering 17.',
  ].join('\n\n')
  value.tasks.push({ ...structuredClone(value.tasks[0]), id: 'task-2', noteId: 'note-2',
    snapshot: { ...value.tasks[0].snapshot, noteNumber: 4, room: 'Kök', placeDetail: 'Bänkskiva',
      noteText: 'Notering 4 gäller endast köket. Dess bild får inte blandas in i notering 17.' } },
  { ...structuredClone(value.tasks[0]), id: 'task-3', noteId: 'note-3',
    snapshot: { ...value.tasks[0].snapshot, noteNumber: 81, room: 'Hall', placeDetail: null,
      noteText: 'Notering utan någon bild.' } })
  value.originalImages = [
    { id: 'original-first', taskId: 'task', fileName: 'Original 17 – översikt' },
    { id: 'original-second', taskId: 'task', fileName: 'Original 17 – detalj' },
    { id: 'original-other-note', taskId: 'task-2', fileName: 'Original 4 – kök' },
  ].map(details => ({ ...details, imageUrl: `/mock-image.png?image=${details.id}&size=full`,
    thumbnailUrl: `/mock-image.png?image=${details.id}&size=thumbnail`, createdAt: '2026-09-07T10:00:00Z' }))
  value.images = [{ id: 'follow-up-first', taskId: 'task', fileName: 'Återrapportering 17',
    imageUrl: '/mock-image.png?image=follow-up-first&size=full',
    thumbnailUrl: '/mock-image.png?image=follow-up-first&size=thumbnail', createdAt: '2026-09-08T10:00:00Z' }]
  return value
}
let workspace = initial('customer_owner'), revision = 0, conflictNext = false, reads = 0
const posts = []
// Evidence ownership is checked by the synthetic server, not exposed as an
// extra client-side capability or inferred from a visible comment's author name.
const savedContractorComments = new Map()
const server = createServer(async (request, response) => {
  if (request.url.startsWith('/mock-image.png')) {
    const fixtureImage = new URL(request.url, 'http://127.0.0.1').searchParams.get('image')
    if (fixtureImage) {
      const labels = { 'original-first': 'ORIGINAL 17 / OVERSIKT', 'original-second': 'ORIGINAL 17 / DETALJ',
        'original-other-note': 'ORIGINAL 4 / KOK', 'follow-up-first': 'UPPFOLJNING 17' }
      const label = labels[fixtureImage] ?? 'SYNTHETIC TEST IMAGE'
      response.setHeader('Content-Type', 'image/svg+xml')
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#dae7e0"/><rect x="120" y="100" width="700" height="650" fill="#f8fafc" stroke="#34594b" stroke-width="15"/><path d="M470 100V750 M120 425H820" stroke="#34594b" stroke-width="15"/><path d="M960 160L1370 440L1110 770" fill="none" stroke="#e29361" stroke-width="22"/><text x="100" y="910" fill="#172f27" font-family="sans-serif" font-size="56">${label}</text></svg>`)
      return
    }
    response.setHeader('Content-Type', 'image/png'); response.end(image); return
  }
  if (request.url === '/broken-image.png') { response.statusCode = 404; response.end('Missing synthetic image'); return }
  if (request.url === '/mock-workspace') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(workspace)); return }
  if (request.url === '/mock-portal' || request.url === '/mock-portal/images') {
    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'GET') { reads++; response.end(JSON.stringify({ workspace })); return }
    let body = ''; for await (const chunk of request) body += chunk
    const input = request.url.endsWith('/images') ? { action: 'image', payload: { taskId: 'task' } } : JSON.parse(body)
    posts.push(input)
    await new Promise(ok => setTimeout(ok, 250))
    if (conflictNext) { conflictNext = false; response.statusCode = 409; response.end(JSON.stringify({ error: 'Testkonflikt. Texten finns kvar, försök igen.' })); return }
    if (input.action === 'status' && input.payload.status === 'reported_remedied' &&
      !input.payload.message?.trim() && !workspace.images.some(image => image.taskId === input.payload.taskId) &&
      !savedContractorComments.has(input.payload.taskId)) {
      response.statusCode = 400; response.end(JSON.stringify({ error: 'Lägg till en åtgärdsbild eller en förklarande kommentar.' })); return
    }
    const task = workspace.tasks.find(item => item.id === input.payload.taskId) ?? workspace.tasks[0]
    const touched = input.action === 'assign'
      ? workspace.tasks.filter(item => input.payload.taskIds.includes(item.id)) : [task]
    if (input.action === 'assign') {
      const changed = touched.filter(item => item.assigneeId !== input.payload.assigneeId)
      const issued = id => id && workspace.accessLinks.some(link => link.assigneeId === id)
      if (changed.some(item => item.status === 'reported_remedied' || issued(item.assigneeId) || issued(input.payload.assigneeId)) && input.payload.confirmReassignment !== true) {
        response.statusCode = 409; response.end(JSON.stringify({ error: 'Bekräfta byte av utförare.' })); return
      }
      if (changed.some(item => item.status === 'reported_remedied') && input.payload.reopenCompleted !== true) {
        response.statusCode = 409; response.end(JSON.stringify({ error: 'Bekräfta återöppning.' })); return
      }
      for (const assigned of touched) {
        const reopen = assigned.assigneeId !== input.payload.assigneeId && assigned.status === 'reported_remedied'
        assigned.assigneeId = input.payload.assigneeId
        if (!input.payload.assigneeId) assigned.status = 'unassigned'
        else if (reopen || assigned.status === 'unassigned') assigned.status = 'assigned'
        // Match the server contract: omitting dueDate preserves a task's existing date.
        if (Object.hasOwn(input.payload, 'dueDate')) assigned.dueDate = input.payload.dueDate
      }
    }
    if (input.action === 'create_assignee') workspace.assignees.push({ id: `created-${revision}`, ...input.payload })
    if (input.action === 'update_assignee') Object.assign(workspace.assignees.find(item => item.id === input.payload.assigneeId), input.payload)
    if (input.action === 'status') task.status = input.payload.status
    if (input.action === 'comment' && ['assignee', 'contractor_admin'].includes(workspace.access.role) && input.payload.message?.trim()) {
      savedContractorComments.set(task.id, input.payload.message.trim())
    }
    if (input.action === 'image') workspace.images.push({ id: `after-${revision}`, taskId: 'task',
      imageUrl: '/mock-image.png', thumbnailUrl: '/mock-image.png', createdAt: '2026-09-07T11:00:00Z' })
    if (input.action === 'withdraw_order') workspace.followUp.withdrawalRequestedAt = '2026-09-07T12:00:00Z'
    if (input.action === 'send_assignee_link') workspace.accessLinks.push({ id: `link-${revision}`, role: 'assignee',
      assigneeId: 'worker', email: workspace.assignees[0].email, displayName: 'Testutförare', sentAt: null, createdAt: '2026-09-07T10:00:00Z' })
    if (['status', 'comment', 'image', 'assign'].includes(input.action)) {
      workspace.events.push({ id: `event-${revision}`, taskId: 'task', eventType: input.action === 'image' ? 'photo_added' : input.action === 'status' ? 'status_changed' : input.action,
        actorName: 'Testperson', actorEmail: null, message: input.payload.message || null,
        fromStatus: 'assigned', toStatus: task.status, createdAt: '2026-09-07T11:00:00Z' })
    }
    revision++
    for (const changed of touched) changed.updatedAt = new Date(Date.UTC(2026, 8, 7, 10, revision)).toISOString()
    response.end(JSON.stringify({ workspace })); return
  }
  if (request.url === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.process={env:{NODE_ENV:'development'},browser:true};const realSetInterval=window.setInterval.bind(window);window.setInterval=(callback,delay,...args)=>{if(delay===30000)window.__portalPoll=()=>callback(...args);return realSetInterval(callback,delay,...args)};</script><script src="/view.js"></script></body></html>`)
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
let browser, page
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  page = await browser.newPage()
  await page.setRequestInterception(true)
  page.on('request', request => new URL(request.url()).hostname === '127.0.0.1' ? request.continue() : request.abort())
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message) })
  const url = `http://127.0.0.1:${server.address().port}`
  const button = (label, scope = 'body') => ({ click: async () => {
    const handle = await page.evaluateHandle((value, container) => Array.from(document.querySelector(container).querySelectorAll('button'))
      .find(node => node.getAttribute('aria-label') === value || node.textContent.trim() === value), label, scope)
    const element = handle.asElement()
    assert.ok(element, `Missing button: ${label}`)
    await page.waitForFunction(node => !node.disabled, {}, element)
    // Settle test-driven scrolling before every physical click. Besides popovers
    // dismissing on scroll, compact cards can move after a preceding form expands.
    await element.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await page.evaluate(() => new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok))))
    if (label === 'Skriv ut åtgärdslista') {
      await element.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }))
      const hit = await element.evaluate(node => {
        const box = node.getBoundingClientRect()
        const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        return { clickable: target === node || node.contains(target), obstructedBy: target?.outerHTML.slice(0, 500) }
      })
      assert.equal(hit.clickable, true, `Print button is obstructed: ${hit.obstructedBy}`)
    }
    await element.click()
    await handle.dispose()
  } })
  const waitIdle = () => page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') &&
    !Array.from(document.querySelectorAll('[role=status]')).some(node => /Åtgärden genomförs|Bilder laddas upp/.test(node.textContent)))
  const fill = async (selector, value) => {
    await page.click(selector)
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control')
    if (value) await page.type(selector, value)
    else await page.keyboard.press('Backspace')
  }
  const field = async (label, tag = 'input') => {
    const handle = await page.evaluateHandle((text, kind) => {
      const wrapper = Array.from(document.querySelectorAll('label')).find(node =>
        node.querySelector('span')?.textContent.trim() === text && node.querySelector(kind))
      return wrapper?.querySelector(kind) ?? null
    }, label, tag)
    const element = handle.asElement()
    assert.ok(element, `Missing ${tag} field: ${label}`)
    return element
  }
  const hasButton = label => page.evaluate(value => Array.from(document.querySelectorAll('button'))
    .some(node => node.textContent.trim() === value), label)
  const readHelp = async (label, expected, scope = 'body') => {
    const control = `Hjälp om ${label}`
    await button(control, scope).click()
    await page.waitForSelector(`${scope} [role="note"]`)
    assert.match(await page.$eval(`${scope} [role="note"]`, node => node.textContent), expected)
    await page.$eval(`${scope} [role="note"]`, node => node.dispatchEvent(new Event('scroll')))
    assert.ok(await page.$(`${scope} [role="note"]`), 'scrolling within longer help text must not dismiss it')
    assert.equal(await page.evaluate((value, container) => Array.from(document.querySelector(container).querySelectorAll('button'))
      .find(node => node.getAttribute('aria-label') === value)?.getAttribute('aria-expanded'), control, scope), 'true')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
      `open help for ${label} fits the viewport`)
    await button(control, scope).click()
    await page.waitForSelector(`${scope} [role="note"]`, { hidden: true })
    assert.equal(await page.$(`${scope} [role="note"]`), null, 'help is dismissed by pressing the information icon again')
  }
  const chooseImage = async (selector = 'input[type=file][multiple]') => {
    const upload = page.waitForResponse(response => response.url() === `${url}/mock-portal/images` && response.request().method() === 'POST')
    await page.evaluate(value => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'Efter.png', { type: 'image/png' }))
      const input = document.querySelector(value)
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, selector)
    await upload
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') &&
      !Array.from(document.querySelectorAll('input[type=file]')).some(node => node.disabled))
  }
  const load = async value => {
    workspace = value; revision = 0; posts.length = 0; reads = 0; conflictNext = false; savedContractorComments.clear()
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.waitForSelector('article')
  }
  const expectDeadlineSummary = async expected => {
    const selector = '[data-testid="remediation-deadline-summary"]'
    await page.waitForFunction((target, text) => document.querySelector(target)?.textContent.trim() === text, {}, selector, expected)
    assert.equal(await page.$eval(selector, node => node.textContent.trim()), expected)
  }
  const galleryButton = taskId => `[data-task-id="${taskId}"] [data-testid="remediation-note-images"]`
  const expectViewerImage = async (id, position, source) => {
    await page.waitForFunction((imageId, count) => {
      const dialog = document.querySelector('dialog[open]')
      const img = dialog?.querySelector('img')
      return dialog?.textContent.includes(count) && img?.getAttribute('src')?.includes(`image=${imageId}&size=full`) && img.complete && img.naturalWidth > 0
    }, {}, id, position)
    assert.match(await page.$eval('dialog[open]', node => node.textContent), source)
    assert.equal(await page.$eval('dialog[open] img', node => node.referrerPolicy), 'no-referrer')
    assert.equal(await page.$eval('dialog[open] img', node => getComputedStyle(node).objectFit), 'contain')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 900 })
    await load(initial('customer_owner'))
    await page.waitForSelector('article select')
    assert.match(await page.$eval('main', node => node.textContent), /Beställare · uppföljning/)
    assert.equal(await page.$('#comment-task'), null, 'owner overview starts without an execution form')
    assert.equal(await page.$('article input[type=file]'), null, 'owner upload is collapsed until commenting')
    assert.equal(await hasButton('Markera klar'), false, 'owner must not receive the contractor completion action')
    assert.equal(await hasButton('Uppdatera'), false, 'automatic updates do not need a manual header button')
    assert.doesNotMatch(await page.$eval('main', node => node.textContent), /beskrivning av utförd åtgärd|Lägg till åtgärdsbilder/)
    assert.equal(await hasButton('Skriv ut åtgärdslista'), true)
    assert.equal(await page.$('[role="note"]'), null, 'help texts are collapsed behind information icons by default')
    await readHelp('utskrift', /urval.*inte originalutlåtandet/, 'header')
    await readHelp('åtgärdas av', /Skicka lista.*mejl/)
    assert.equal(await page.$('input[aria-label="E-post"]'), null, 'contractor contacts start as readable cards instead of unlabeled inputs')
    assert.equal(await page.$('#new-assignee-form'), null, 'adding a second contractor is an explicit action')
    await button('Lägg till entreprenör').click()
    await page.waitForSelector('#new-assignee-form')
    assert.equal(posts.length, 0, 'opening the contractor form is not a write')
    await button('Stäng formuläret').click()
    assert.equal(await page.$('#new-assignee-form'), null)
    assert.match(await page.$eval('article', node => node.textContent), /2026-09-25/)
    await page.screenshot({ path: resolve(output, `owner-overview-${width}.png`), fullPage: true })
    assert.equal(await page.$('header a[href="#angra-bestallning"]'), null, 'withdrawal does not compete with everyday header actions')
    assert.equal(await page.$eval('#angra-bestallning', node => node.open), false, 'order and withdrawal details start collapsed')
    assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('button'))
      .find(node => node.textContent.trim() === 'Ångra beställningen')?.getClientRects().length > 0), true,
      'the understated withdrawal action remains directly available outside the collapsed order details')
    await page.evaluate(() => { location.hash = '#angra-bestallning' })
    await page.waitForFunction(() => document.querySelector('#angra-bestallning')?.open)
    assert.equal(posts.length, 0, 'an existing emailed withdrawal fragment opens the order, never submits a request')
    await page.evaluate(() => { history.replaceState(null, '', location.pathname); document.querySelector('#angra-bestallning').open = false })
    await page.select('article select', 'worker')
    await page.waitForFunction(() => document.querySelector('article select')?.value === 'worker' && !document.querySelector('article select')?.disabled)
    assert.equal(posts[0].action, 'assign')
    assert.deepEqual(posts[0].payload.expectedVersions, { task: '2026-09-07T10:00:00.000Z' })
    assert.equal(Object.hasOwn(posts[0].payload, 'dueDate'), false, 'individual assignment must not wipe the saved date')
    assert.equal(workspace.tasks[0].dueDate, '2026-09-25')
    await button('Redigera Målare').click()
    await fill('[data-assignee-id="worker"] input[aria-label="E-post"]', 'updated-worker@example.invalid')
    assert.equal(await hasButton('Kommentera'), false)
    assert.equal(await page.$('#comment-task'), null)
    assert.equal(await page.$('article input[type=file]'), null)
    const refresh = page.waitForResponse(response => response.url() === `${url}/mock-portal` && response.request().method() === 'GET')
    await page.evaluate(() => window.__portalPoll())
    await refresh
    await waitIdle()
    assert.ok(reads > 0, 'the registered automatic polling callback fetches the latest workspace')
    assert.equal(posts.length, 1, 'automatic refresh must not invite, reassign or otherwise mutate')
    assert.equal(await page.$eval('[data-assignee-id="worker"] input[aria-label="E-post"]', node => node.value), 'updated-worker@example.invalid', 'automatic refresh retains edited contact data')
    await button('Spara mottagare').click()
    await page.waitForFunction(() => !document.querySelector('[data-assignee-id="worker"] input[aria-label="E-post"]'))
    assert.match(await page.$eval('[data-assignee-id="worker"]', node => node.textContent), /updated-worker@example.invalid/)
    await page.evaluate(() => {
      const element = Array.from(document.querySelectorAll('button')).find(node => node.textContent.includes('Skicka lista'))
      element.click(); element.click()
    })
    await page.waitForFunction(() => document.body.textContent.includes('Den personliga länken är köad'))
    assert.deepEqual(posts.map(post => post.action), ['assign', 'update_assignee', 'send_assignee_link'])
    assert.equal(posts[1].payload.email, 'updated-worker@example.invalid')
    await page.screenshot({ path: resolve(output, `owner-${width}.png`), fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await button('Ångra beställningen').click()
    assert.equal(await page.$eval('#angra-bestallning', node => node.open), true, 'the withdrawal action opens the relevant order details')
    assert.match(await page.$eval('#withdrawal-review', node => node.textContent), /Testbeställare.*beställning order.*buyer@example.invalid/)
    await button('Avbryt').click()
    assert.equal(posts.length, 3, 'dismissing withdrawal confirmation must not mutate the order')
    await button('Ångra beställningen').click()
    await page.screenshot({ path: resolve(output, `withdrawal-review-${width}.png`), fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.evaluate(() => {
      const confirm = document.querySelector('#withdrawal-review button[type="submit"]')
      confirm.click(); confirm.click()
    })
    await page.waitForFunction(() => document.body.textContent.includes('Din begäran har registrerats'))
    assert.equal(posts.at(-1).action, 'withdraw_order')
    assert.deepEqual(posts.at(-1).payload, { confirmed: true })
    assert.equal(posts.filter(post => post.action === 'withdraw_order').length, 1)
    assert.equal(await page.$('input[type=file]'), null)
    assert.equal(await page.$('#comment-task'), null)
    assert.equal(await page.$('input[aria-label="E-post"]'), null)
    assert.match(await page.$eval('main', node => node.textContent), /Färgsläpp vid fönstret/)
    console.log(`PASS owner ${width}px: readable contact cards, collapsible help, automatic refresh retains drafts, explicit invitation, guarded discreet withdrawal, no overflow`)

    const reassignment = deadlineWorkspace()
    reassignment.tasks[0].status = 'reported_remedied'
    reassignment.accessLinks = [{ id: 'issued-link', role: 'assignee', assigneeId: 'worker', sentAt: null,
      email: 'worker@example.invalid', displayName: 'Målare', createdAt: '2026-09-07T10:00:00Z' }]
    await load(structuredClone(reassignment))
    assert.equal(await page.$('[data-task-id="task"] select'), null, 'an issued link removes the instant reassignment select')
    await button('Byt utförare', '[data-task-id="task"]').click()
    await page.waitForSelector('dialog[open]')
    assert.equal(posts.length, 0)
    assert.match(await page.$eval('dialog[open]', node => node.innerText), /tidigare utföraren förlorar åtkomsten/)
    await page.select('#assignment-target', 'other-worker')
    assert.equal(await page.$eval('dialog[open] input[type="checkbox"]', node => node.checked), false)
    assert.equal(await page.$eval('dialog[open] button[type="submit"]', node => node.disabled), true)
    await page.keyboard.press('Escape')
    await page.waitForSelector('dialog[open]', { hidden: true })
    assert.equal(posts.length, 0, 'Escape cancels without moving the task')
    assert.equal(workspace.tasks[0].assigneeId, 'worker')
    await button('Byt utförare', '[data-task-id="task"]').click()
    await page.select('#assignment-target', 'other-worker')
    await page.click('dialog[open] input[type="checkbox"]')
    await page.screenshot({ path: resolve(output, `owner-reassign-confirm-${width}.png`), fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await button('Bekräfta byte', 'dialog[open]').click()
    await page.waitForSelector('dialog[open]', { hidden: true })
    assert.equal(workspace.tasks[0].assigneeId, 'other-worker')
    assert.equal(workspace.tasks[0].status, 'assigned')
    assert.equal(posts.length, 1, 'confirming a move never sends an invitation')
    assert.equal(posts[0].payload.confirmReassignment, true)
    assert.equal(posts[0].payload.reopenCompleted, true)
    assert.equal(workspace.tasks[0].dueDate, '2026-09-30')

    await load(structuredClone(reassignment))
    await button('Markera alla i urvalet').click()
    await page.select('select[aria-label="Tilldela till"]', 'other-worker')
    await button('Tilldela').click()
    await page.waitForSelector('dialog[open]')
    assert.equal(posts.length, 0, 'bulk changes also wait for explicit confirmation')
    assert.equal(await page.$$eval('dialog[open] li', nodes => nodes.length), 2)
    await page.click('dialog[open] input[type="checkbox"]')
    conflictNext = true
    await button('Bekräfta byte', 'dialog[open]').click()
    await page.waitForSelector('dialog[open] [role="alert"]')
    assert.equal(await page.$eval('dialog[open] button[type="submit"]', node => node.disabled), true)
    assert.equal(workspace.tasks[0].assigneeId, 'worker', 'a conflict cannot silently transfer ownership')
    assert.equal(workspace.tasks[0].status, 'reported_remedied')
    await button('Avbryt', 'dialog[open]').click()
    await page.waitForSelector('dialog[open]', { hidden: true })
    console.log(`PASS reassignment ${width}px: issued-link guard, explicit reopening, cancellation, local conflict feedback, bulk guard and no invitation`)

    await load(bulkWorkspace())
    assert.equal(await hasButton('Markera alla i urvalet'), true, 'bulk selection is visible before manually selecting a defect')
    assert.equal(await hasButton('Markera ej tilldelade'), true)
    await readHelp('masshantering', /Tilldela ändrar ansvarig men skickar ingen lista.*Filterbyte rensar markeringarna/)
    assert.equal(await hasButton('Tilldela alla ej tilldelade'), true, 'only one active contractor offers the shortcut')
    assert.match(await page.$eval('[data-task-id="task-2"]', node => node.textContent), /2026-09-30/)
    assert.match(await page.$eval('[data-task-id="task-3"]', node => node.textContent), /2026-10-02/)
    await page.select('select[aria-label="Filtrera mottagare"]', 'unassigned')
    await button('Markera alla i urvalet').click()
    assert.equal(await page.$$eval('article input[type=checkbox]:checked', nodes => nodes.length), 2)
    await page.select('select[aria-label="Filtrera mottagare"]', 'previous')
    assert.equal(await page.$$eval('article input[type=checkbox]:checked', nodes => nodes.length), 0, 'filter changes clear hidden selections')
    await page.select('select[aria-label="Filtrera mottagare"]', 'all')
    await button('Markera ej tilldelade').click()
    assert.equal(await page.$$eval('article input[type=checkbox]:checked', nodes => nodes.length), 2)
    await button('Avmarkera').click()
    assert.equal(await page.$$eval('article input[type=checkbox]:checked', nodes => nodes.length), 0)
    await page.select('select[aria-label="Filtrera mottagare"]', 'unassigned')
    await button('Markera alla i urvalet').click()
    await page.select('select[aria-label="Tilldela till"]', 'worker')
    await button('Tilldela').click()
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && document.querySelectorAll('article').length === 0)
    assert.equal(posts.length, 1)
    assert.equal(posts[0].action, 'assign')
    assert.deepEqual(posts[0].payload.taskIds.sort(), ['task', 'task-2'])
    assert.equal(Object.hasOwn(posts[0].payload, 'dueDate'), false)
    assert.deepEqual(posts[0].payload.expectedVersions,
      { task: '2026-09-07T10:00:00.000Z', 'task-2': '2026-09-07T10:00:00.000Z' })
    assert.deepEqual(workspace.tasks.map(task => task.dueDate), ['2026-09-25', null, '2026-10-02'])
    assert.equal(workspace.tasks[2].assigneeId, 'previous')
    assert.equal(workspace.tasks[2].status, 'in_progress')

    await load(bulkWorkspace())
    // Shortcut is global and explicitly separate from the filtered list's bulk controls.
    await page.select('select[aria-label="Filtrera mottagare"]', 'previous')
    await page.evaluate(() => {
      const shortcut = Array.from(document.querySelectorAll('button')).find(node => node.textContent.trim() === 'Tilldela alla ej tilldelade')
      shortcut.click(); shortcut.click()
    })
    await waitIdle()
    assert.equal(posts.length, 1, 'double-clicking the shortcut creates only one assignment request, never an invitation')
    assert.equal(posts[0].action, 'assign')
    assert.deepEqual(posts[0].payload.taskIds.sort(), ['task', 'task-2'])
    assert.equal(Object.hasOwn(posts[0].payload, 'dueDate'), false)
    assert.deepEqual(workspace.tasks.map(task => task.assigneeId), ['worker', 'worker', 'previous'])
    assert.deepEqual(workspace.tasks.map(task => task.dueDate), ['2026-09-25', null, '2026-10-02'])
    await page.select('select[aria-label="Filtrera mottagare"]', 'worker')
    await button('Markera alla i urvalet').click()
    const changeDate = await page.evaluateHandle(() => Array.from(document.querySelectorAll('label'))
      .find(node => node.textContent.includes('Ändra sista åtgärdsdatum'))?.querySelector('input[type=checkbox]'))
    assert.ok(changeDate.asElement(), 'date replacement requires an explicit checkbox')
    await changeDate.asElement().click()
    await changeDate.dispose()
    assert.equal(await page.$eval('input[aria-label="Sista åtgärdsdatum"]', node => node.value), '2026-09-30', 'bulk date starts from the frozen report deadline')
    await page.$eval('input[aria-label="Sista åtgärdsdatum"]', node => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, '2026-10-05')
      node.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.select('select[aria-label="Tilldela till"]', 'worker')
    await button('Tilldela').click()
    await waitIdle()
    assert.equal(posts.at(-1).payload.dueDate, '2026-10-05')
    assert.deepEqual(workspace.tasks.map(task => task.dueDate), ['2026-10-05', '2026-10-05', '2026-10-02'])
    await page.evaluate(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++ } })
    await button('Skriv ut åtgärdslista').click()
    await page.waitForFunction(() => window.__printCalls === 1)
    assert.equal(await page.evaluate(() => window.__printCalls), 1)
    await button('Hjälp om status').click()
    await page.waitForSelector('[role="note"]')
    await page.emulateMediaType('print')
    assert.equal(await page.$$eval('button[aria-label^="Hjälp om"]', nodes => nodes.every(node => node.getClientRects().length === 0)), true, 'information icons are excluded from printing')
    assert.equal(await page.$$eval('[role="note"]', nodes => nodes.every(node => node.getClientRects().length === 0)), true, 'even an opened help popup is excluded from printing')
    assert.equal(await page.$$eval('select', nodes => nodes.every(node => node.getClientRects().length === 0)), true, 'printed tasks show recipient names instead of editing controls')
    assert.match(await page.$eval('main', node => node.innerText), /Urval: 2 av 3 anmärkningar\. Status: Alla\. Åtgärdas av: Målare\./,
      'printed view visibly identifies its restricted selection, status and contractor')
    await page.screenshot({ path: resolve(output, `print-filtered-${width}.png`), fullPage: true })
    await page.emulateMediaType('screen')
    await page.keyboard.press('Escape')
    assert.equal(await page.$('[role="note"]'), null, 'Escape dismisses help without needing a pointer')
    await page.screenshot({ path: resolve(output, `owner-bulk-${width}.png`), fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    console.log(`PASS bulk ${width}px: visible selection, filter reset, preserved assignments/dates, guarded one-contractor shortcut, explicit date override, filtered print`)

    const suggestionOnly = initial('customer_owner')
    suggestionOnly.assignees = []
    suggestionOnly.inspection.defaultRemedyDeadline = null
    suggestionOnly.tasks[0].dueDate = null
    await load(suggestionOnly)
    const suggestedName = await field('Entreprenör / arbetsområde')
    assert.equal(await suggestedName.evaluate(node => node.value), 'Testbygg AB')
    await suggestedName.dispose()
    const suggestedEmail = await field('E-post')
    assert.equal(await suggestedEmail.evaluate(node => node.value), 'contract@example.invalid')
    await suggestedEmail.dispose()
    assert.equal(posts.length, 0, 'a report contractor suggestion must not create an assignee or send email on load')
    await readHelp('sista åtgärdsdatum', /kom överens med entreprenören/i)
    assert.equal(await hasButton('Tilldela alla ej tilldelade'), false, 'suggestion is not an assigned contractor until confirmed')
    await button('Spara entreprenör').click()
    await page.waitForSelector('[data-assignee-id]')
    assert.equal(posts.length, 1)
    assert.equal(posts[0].action, 'create_assignee')
    assert.equal(posts[0].payload.email, 'contract@example.invalid')
    assert.equal(await hasButton('Tilldela alla ej tilldelade'), true)
    assert.equal(workspace.tasks[0].assigneeId, null, 'confirming the suggestion does not implicitly assign or invite')
    await button('Markera alla i urvalet').click()
    await page.select('select[aria-label="Tilldela till"]', workspace.assignees[0].id)
    await page.evaluate(() => Array.from(document.querySelectorAll('label'))
      .find(node => node.textContent.includes('Ändra sista åtgärdsdatum'))?.querySelector('input[type=checkbox]').click())
    assert.equal(await page.$eval('input[aria-label="Sista åtgärdsdatum"]', node => node.value), '')
    assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('button'))
      .find(node => node.textContent.trim() === 'Tilldela')?.disabled), true, 'explicit but empty date is blocked instead of clearing deadlines')
    assert.equal(posts.length, 1)
    await page.screenshot({ path: resolve(output, `owner-no-deadline-${width}.png`), fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)

    const severalSuggestions = initial('customer_owner')
    severalSuggestions.assignees = []
    severalSuggestions.contractorSuggestions.push({ ...severalSuggestions.contractorSuggestions[0], name: 'Annan entreprenör',
      companyName: 'Annat företag AB', email: null, source: 'project' })
    await load(severalSuggestions)
    const emptyName = await field('Entreprenör / arbetsområde')
    assert.equal(await emptyName.evaluate(node => node.value), '', 'multiple contractors require an explicit choice')
    await emptyName.dispose()
    const suggestions = await page.evaluateHandle(() => Array.from(document.querySelectorAll('select'))
      .find(node => Array.from(node.options).some(option => option.textContent.includes('Testbygg AB')) &&
        Array.from(node.options).some(option => option.textContent.includes('Annan entreprenör'))))
    assert.ok(suggestions.asElement(), 'multiple report contractors are offered in a selection list')
    const optionValue = await suggestions.asElement().evaluate(node => Array.from(node.options).find(option => option.textContent.includes('Annan entreprenör')).value)
    await suggestions.asElement().select(optionValue)
    await suggestions.dispose()
    const chosenName = await field('Entreprenör / arbetsområde')
    assert.equal(await chosenName.evaluate(node => node.value), 'Annan entreprenör')
    await chosenName.dispose()
    const chosenEmail = await field('E-post')
    assert.equal(await chosenEmail.evaluate(node => node.value), '', 'missing email remains editable and is not invented')
    await chosenEmail.dispose()
    assert.equal(posts.length, 0, 'choosing a suggestion is local form preparation only')
    console.log(`PASS suggestions ${width}px: single editable prefill, explicit multi-contractor choice, no hidden assignment/mail, missing deadline guidance`)

    const completedForOwner = initial('customer_owner')
    completedForOwner.tasks[0].assigneeId = 'worker'
    completedForOwner.tasks[0].status = 'reported_remedied'
    await load(completedForOwner)
    assert.equal(await hasButton('Kommentera'), false)
    assert.equal(await hasButton('Markera klar'), false)
    assert.equal(await page.$('#comment-task'), null)
    assert.equal(posts.length, 0)
    console.log(`PASS owner review ${width}px: read-only completion history without messaging controls`)

    const gallery = galleryWorkspace()
    const originalNoteText = gallery.tasks[0].snapshot.noteText
    await load(gallery)
    assert.deepEqual(await page.$$eval('article[data-task-id]', nodes => nodes.map(node => node.dataset.taskId)),
      gallery.tasks.map(task => task.id), 'the cards retain exactly the note order delivered by the backend')
    for (const [taskId, noteNumber] of [['task', 17], ['task-2', 4], ['task-3', 81]]) {
      assert.equal(await page.$eval(`[data-task-id="${taskId}"] span[aria-label="Punkt ${noteNumber}"]`, node => node.textContent), String(noteNumber),
        'displayed note numbers come from the report, not the current card position')
    }
    assert.equal(await page.$eval(galleryButton('task'), node => node.textContent.trim()), '3 bilder')
    assert.equal(await page.$eval(galleryButton('task-2'), node => node.textContent.trim()), '1 bild')
    assert.equal(await page.$(galleryButton('task-3')), null, 'a note without images has no empty photo action')
    assert.equal(await page.$eval(galleryButton('task'), node => node.getAttribute('aria-haspopup')), 'dialog')
    assert.equal(await page.$eval('[data-task-id="task"]', (node, text) => Array.from(node.querySelectorAll('p')).some(paragraph => paragraph.textContent === text), originalNoteText), true,
      'the full report text, paragraphs and long references are preserved')
    assert.match(await page.$eval('[data-task-id="task"]', node => node.innerText), /Entréplan · Vardagsrum · Fönstervägg/)
    assert.equal(await page.$$eval('article textarea', nodes => nodes.length), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: resolve(output, `owner-note-cards-${width}.png`), fullPage: true })
    const noteCard = await page.$('[data-task-id="task"]')
    await noteCard.screenshot({ path: resolve(output, `long-note-card-${width}.png`) })
    await noteCard.dispose()
    const overflowBeforeViewer = await page.evaluate(() => document.body.style.overflow)
    await page.click(galleryButton('task'))
    await page.waitForSelector('dialog[open]')
    assert.equal(await page.$eval('dialog[open]', node => node.getAttribute('aria-modal')), 'true')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Stäng bildvisaren')
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden')
    await expectViewerImage('original-first', 'Bild 1 av 3', /Punkt 17.*Bilder i utlåtandet/)
    assert.equal(await page.$eval('dialog button[aria-label="Föregående bild"]', node => node.disabled), true)
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift')
    assert.equal(await page.evaluate(() => document.querySelector('dialog[open]').contains(document.activeElement)), true, 'backward tab cannot escape the modal')
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Stäng bildvisaren', 'forward tab wraps to the first dialog control')
    await button('Nästa bild', 'dialog[open]').click()
    await expectViewerImage('original-second', 'Bild 2 av 3', /Bilder i utlåtandet/)
    await page.keyboard.press('ArrowRight')
    await expectViewerImage('follow-up-first', 'Bild 3 av 3', /Bilder i uppföljningen/)
    assert.equal(await page.$eval('dialog button[aria-label="Nästa bild"]', node => node.disabled), true)
    await page.keyboard.press('ArrowRight')
    await expectViewerImage('follow-up-first', 'Bild 3 av 3', /Bilder i uppföljningen/)
    assert.doesNotMatch(await page.$eval('dialog[open]', node => node.textContent), /Original 4|Punkt 4|Notering 4/,
      'next/previous stay inside the current note, never exposing another note\'s images')
    await button('Föregående bild', 'dialog[open]').click()
    await expectViewerImage('original-second', 'Bild 2 av 3', /Bilder i utlåtandet/)
    await page.keyboard.press('ArrowLeft')
    await expectViewerImage('original-first', 'Bild 1 av 3', /Bilder i utlåtandet/)
    await page.click('dialog[open] img')
    assert.ok(await page.$('dialog[open]'), 'clicking the displayed image does not dismiss it')
    await page.screenshot({ path: resolve(output, `note-image-dialog-${width}.png`) })
    await page.keyboard.press('Escape')
    await page.waitForSelector('dialog[open]', { hidden: true })
    assert.equal(await page.evaluate(selector => document.activeElement === document.querySelector(selector), galleryButton('task')), true,
      'Escape restores focus to the exact note image button')
    assert.equal(await page.evaluate(() => document.body.style.overflow), overflowBeforeViewer)
    await page.click(galleryButton('task-2'))
    await expectViewerImage('original-other-note', 'Bild 1 av 1', /Punkt 4.*Bilder i utlåtandet/)
    assert.equal(await page.$('dialog button[aria-label="Nästa bild"]'), null, 'a single-image note has no next action')
    await button('Stäng bildvisaren', 'dialog[open]').click()
    await page.waitForSelector('dialog[open]', { hidden: true })
    assert.equal(await page.evaluate(selector => document.activeElement === document.querySelector(selector), galleryButton('task-2')), true)
    await page.click(galleryButton('task'))
    await button('Nästa bild', 'dialog[open]').click()
    await button('Nästa bild', 'dialog[open]').click()
    await expectViewerImage('follow-up-first', 'Bild 3 av 3', /Bilder i uppföljningen/)
    await page.keyboard.press('Escape')
    assert.equal(posts.length, 0, 'viewing, navigating, closing and opening reporting must not write or send anything')
    assert.equal(workspace.tasks[0].snapshot.noteText, originalNoteText)
    console.log(`PASS gallery ${width}px: original numbering and long text, note-scoped image counts, full-size sources, original/follow-up captions, keyboard navigation, focus trap/restore, no writes`)

    const refreshedGallery = galleryWorkspace()
    refreshedGallery.tasks[0].assigneeId = 'worker'
    refreshedGallery.tasks[0].status = 'assigned'
    await load(refreshedGallery)
    await page.select('select[aria-label="Filtrera status"]', 'not_done')
    await page.click(galleryButton('task'))
    await expectViewerImage('original-first', 'Bild 1 av 3', /Punkt 17.*Bilder i utlåtandet/)
    workspace.tasks[0].status = 'reported_remedied'
    const refreshedGalleryResponse = page.waitForResponse(response => response.url() === `${url}/mock-portal` && response.request().method() === 'GET')
    await page.evaluate(() => window.__portalPoll())
    await refreshedGalleryResponse
    await page.waitForSelector('dialog[open]', { hidden: true })
    await page.waitForSelector('[data-task-id="task"]', { hidden: true })
    assert.equal(await page.$$eval('article', nodes => nodes.length), 2)
    await page.select('select[aria-label="Filtrera status"]', 'all')
    assert.equal(await page.$$eval('article', nodes => nodes.length), 3)
    assert.equal(await page.$('dialog[open]'), null, 'an image hidden by polling must not reopen when its note becomes visible again')
    await page.select('select[aria-label="Filtrera status"]', 'done')
    assert.equal(await page.$$eval('article', nodes => nodes.length), 1)
    assert.equal(await page.$('dialog[open]'), null, 'changing to completed notes must not restore stale image selection')
    await page.click(galleryButton('task'))
    await expectViewerImage('original-first', 'Bild 1 av 3', /Punkt 17.*Bilder i utlåtandet/)
    await page.keyboard.press('Escape')
    assert.equal(posts.length, 0, 'filter changes and automatic status refresh never write or send anything')
    console.log(`PASS gallery refresh ${width}px: an open image closes when its note leaves the filtered workspace and only reopens after a new explicit click`)

    const brokenGallery = galleryWorkspace('assignee')
    brokenGallery.originalImages[0].imageUrl = '/broken-image.png'
    brokenGallery.originalImages[1].imageUrl = null
    await load(brokenGallery)
    await page.click(galleryButton('task'))
    await page.waitForFunction(() => document.querySelector('dialog[open] [role="status"]')?.textContent.includes('Bilden kunde inte visas.'))
    await button('Nästa bild', 'dialog[open]').click()
    await page.waitForFunction(() => document.querySelector('dialog[open]')?.textContent.includes('Bild 2 av 3') &&
      document.querySelector('dialog[open] [role="status"]')?.textContent.includes('Bilden kunde inte visas.'))
    await button('Nästa bild', 'dialog[open]').click()
    await expectViewerImage('follow-up-first', 'Bild 3 av 3', /Bilder i uppföljningen/)
    await page.keyboard.press('Escape')
    assert.equal(posts.length, 0, 'unavailable original images cannot trigger any changes or block navigation to the remaining evidence')
    assert.equal(await page.$('#comment-task'), null, 'viewing pictures does not expand contractor reporting')
    console.log(`PASS gallery errors ${width}px: broken/missing original images remain navigable and never modify follow-up data`)

    const historicalStatuses = initial('customer_owner')
    historicalStatuses.tasks = ['unassigned', 'assigned', 'in_progress', 'ready_for_review', 'returned', 'reported_remedied', 'cannot_remedy']
      .map((status, index) => ({ ...structuredClone(historicalStatuses.tasks[0]), id: `historical-${status}`,
        noteId: `historical-note-${index}`, status, snapshot: { ...historicalStatuses.tasks[0].snapshot, noteNumber: index + 1 } }))
    await load(historicalStatuses)
    assert.deepEqual(await page.$$eval('select[aria-label="Filtrera status"] option', nodes => nodes.map(node => node.value)),
      ['all', 'not_done', 'done'], 'the paid workflow only exposes all, not done and done')
    assert.equal(await page.$$eval('article', nodes => nodes.length), 7)
    assert.doesNotMatch(await page.$eval('main', node => node.textContent), /Pågår|Anmälda avhjälpta|Komplettering begärd/)
    await page.select('select[aria-label="Filtrera status"]', 'not_done')
    assert.equal(await page.$$eval('article', nodes => nodes.length), 6,
      'all previous intermediate and obstacle statuses remain visible as not done')
    await page.select('select[aria-label="Filtrera status"]', 'done')
    assert.equal(await page.$$eval('article', nodes => nodes.length), 1)
    assert.equal(await page.$eval('article', node => node.dataset.taskId), 'historical-reported_remedied')
    assert.equal(posts.length, 0, 'simplified presentation never migrates or overwrites original statuses')
    console.log(`PASS status simplification ${width}px: seven stored statuses safely grouped into Klar/Ej klar with no data writes`)

    const individuallyDated = deadlineWorkspace()
    await load(individuallyDated)
    await expectDeadlineSummary('Klar senast: 2026-09-30')
    assert.doesNotMatch(await page.$eval('main', node => node.textContent), /Åtgärdsdatum saknas/,
      'a missing report-wide deadline must not hide dates already saved on every task')
    for (const taskId of ['task', 'task-2']) {
      assert.match(await page.$eval(`[data-task-id="${taskId}"]`, node => node.textContent), /Klar senast: 2026-09-30/)
      assert.doesNotMatch(await page.$eval(`[data-task-id="${taskId}"]`, node => node.textContent), /enligt utlåtandet/,
        'individual dates must not be attributed to a report-wide deadline')
    }
    await button('Hjälp om sista åtgärdsdatum').click()
    await page.waitForSelector('[role="note"]')
    assert.doesNotMatch(await page.$eval('[role="note"]', node => node.textContent), /Kom överens|Datumet behöver tas fram|Ändra sista åtgärdsdatum/i,
      'no missing-date instructions are shown when every visible task has a date')
    await page.keyboard.press('Escape')
    await page.screenshot({ path: resolve(output, `owner-individual-deadlines-${width}.png`), fullPage: true })
    assert.equal(posts.length, 0, 'summarising existing dates must never write a replacement date')

    const mixedDates = deadlineWorkspace()
    mixedDates.tasks[1].dueDate = '2026-10-02'
    mixedDates.tasks.push({ ...structuredClone(mixedDates.tasks[0]), id: 'undated-task', noteId: 'undated-note',
      dueDate: null, assigneeId: 'other-worker', status: 'reported_remedied',
      snapshot: { ...mixedDates.tasks[0].snapshot, noteNumber: 3, noteText: 'Annan entreprenörs anmärkning utan datum.' } })
    await load(mixedDates)
    await expectDeadlineSummary('Åtgärdsdatum saknas för 1 av 3 anmärkningar i urvalet.')
    await readHelp('sista åtgärdsdatum', /kom överens med entreprenören/i)
    await page.select('select[aria-label="Filtrera mottagare"]', 'worker')
    await expectDeadlineSummary('Olika åtgärdsdatum – se respektive anmärkning.')
    assert.equal(await page.$$eval('article', nodes => nodes.length), 2)
    assert.doesNotMatch(await page.$eval('main', node => node.textContent), /Åtgärdsdatum saknas/,
      'another contractor\'s hidden undated task must not produce a warning for this selection')
    await page.select('select[aria-label="Filtrera mottagare"]', 'other-worker')
    await expectDeadlineSummary('Åtgärdsdatum saknas för 1 av 1 anmärkningar i urvalet.')
    await page.select('select[aria-label="Filtrera mottagare"]', 'all')
    await page.select('select[aria-label="Filtrera status"]', 'not_done')
    await expectDeadlineSummary('Olika åtgärdsdatum – se respektive anmärkning.')
    await page.select('select[aria-label="Filtrera status"]', 'done')
    await expectDeadlineSummary('Åtgärdsdatum saknas för 1 av 1 anmärkningar i urvalet.')
    await page.select('select[aria-label="Filtrera mottagare"]', 'worker')
    await page.waitForFunction(() => document.querySelectorAll('article').length === 0)
    assert.equal(await page.$('[data-testid="remediation-deadline-summary"]'), null,
      'an empty selection must not claim that a date is missing')
    assert.equal(posts.length, 0, 'date summaries and filtering do not change assignments or saved dates')

    const fallbackDates = deadlineWorkspace()
    fallbackDates.inspection.defaultRemedyDeadline = '2026-09-30'
    fallbackDates.tasks[0].dueDate = null
    await load(fallbackDates)
    await expectDeadlineSummary('Klar senast: 2026-09-30')
    assert.match(await page.$eval('[data-task-id="task"]', node => node.textContent), /Klar senast: 2026-09-30 \(enligt utlåtandet\)/)
    assert.doesNotMatch(await page.$eval('[data-task-id="task-2"]', node => node.textContent), /enligt utlåtandet/)
    await readHelp('sista åtgärdsdatum', /utlåtandet/)
    // The actual automatic refresh must update the summary while retaining the
    // report fallback for the other task, with no background writes or emails.
    workspace.tasks[1].dueDate = '2026-10-05'
    const refreshedDates = page.waitForResponse(response => response.url() === `${url}/mock-portal` && response.request().method() === 'GET')
    await page.evaluate(() => window.__portalPoll())
    await refreshedDates
    await expectDeadlineSummary('Olika åtgärdsdatum – se respektive anmärkning.')
    assert.match(await page.$eval('[data-task-id="task-2"]', node => node.textContent), /Klar senast: 2026-10-05/)
    assert.equal(posts.length, 0)

    // A contractor receives only its already-authorized task slice from the API.
    // The summary must not depend on an order-wide report deadline or hidden
    // work belonging to the buyer or other contractors.
    const contractorDates = deadlineWorkspace('assignee')
    contractorDates.assignees = contractorDates.assignees.filter(assignee => assignee.id === 'worker')
    await load(contractorDates)
    await expectDeadlineSummary('Klar senast: 2026-09-30')
    assert.equal(await page.$$eval('article', nodes => nodes.length), 2)
    assert.equal(await page.$('select[aria-label="Filtrera mottagare"]'), null)
    assert.doesNotMatch(await page.$eval('main', node => node.textContent), /Åtgärdsdatum saknas|Annan entreprenör/)
    assert.doesNotMatch(await page.$$eval('article', nodes => nodes.map(node => node.innerText).join('\n')), /Åtgärdas av:|Klar senast:/,
      'personal contractor cards omit the repeated assignee and the date already shown above the list')
    assert.doesNotMatch(await page.$eval('main', node => node.innerText), /Klar = anmäld klar av entreprenören/)
    await readHelp('status', /inte att besiktningsmannen har godkänt/)
    await page.emulateMediaType('print')
    assert.equal(await page.$eval('[data-testid="remediation-deadline-summary"]', node => node.getClientRects().length > 0), true,
      'the shared contractor deadline must remain visible in the printed list')
    await page.emulateMediaType('screen')
    for (const role of ['contractor_admin', 'contractor_viewer']) {
      const personalWorkspace = structuredClone(contractorDates)
      personalWorkspace.access.role = role
      await load(personalWorkspace)
      await expectDeadlineSummary('Klar senast: 2026-09-30')
      assert.doesNotMatch(await page.$$eval('article', nodes => nodes.map(node => node.innerText).join('\n')), /Åtgärdas av:|Klar senast:/)
    }
    const personalMixedDates = structuredClone(contractorDates)
    personalMixedDates.tasks[1].dueDate = '2026-10-05'
    personalMixedDates.tasks[1].status = 'reported_remedied'
    await load(personalMixedDates)
    await expectDeadlineSummary('Olika åtgärdsdatum – se respektive anmärkning.')
    assert.match(await page.$eval('[data-task-id="task"]', node => node.innerText), /Klar senast: 2026-09-30/)
    assert.match(await page.$eval('[data-task-id="task-2"]', node => node.innerText), /Klar senast: 2026-10-05/)
    assert.doesNotMatch(await page.$$eval('article', nodes => nodes.map(node => node.innerText).join('\n')), /Åtgärdas av:/)
    await page.select('select[aria-label="Filtrera status"]', 'not_done')
    await expectDeadlineSummary('Klar senast: 2026-09-30')
    assert.doesNotMatch(await page.$eval('article', node => node.innerText), /Klar senast:/,
      'a filtered common date moves to the summary, without losing the task deadline')
    await page.select('select[aria-label="Filtrera status"]', 'all')
    await expectDeadlineSummary('Olika åtgärdsdatum – se respektive anmärkning.')
    assert.match(await page.$eval('[data-task-id="task-2"]', node => node.innerText), /Klar senast: 2026-10-05/)
    assert.equal(posts.length, 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    console.log(`PASS deadlines ${width}px: individual dates without a report default, mixed dates/missing counts, effective report fallback, live refresh, status/recipient filters and contractor-scoped summary`)

    const contractorWithBuyerComment = initial('assignee')
    contractorWithBuyerComment.events.push({ id: 'buyer-comment', taskId: 'task', eventType: 'comment',
      actorName: 'Testbeställare', actorEmail: 'buyer@example.invalid', message: 'Min kommentar som beställare är inte entreprenörens återrapportering.',
      fromStatus: null, toStatus: null, createdAt: '2026-09-07T10:00:00Z' })
    await load(contractorWithBuyerComment)
    assert.equal(await page.$('#comment-task'), null, 'contractor overview starts with the reporting form collapsed')
    assert.equal(await page.$('article input[type=file]'), null, 'contractor uploads are hidden until opening reporting')
    assert.equal(await page.$$eval('article button[aria-controls="comment-panel-task"]', nodes => nodes.length), 1,
      'the contractor has exactly one entry into reporting')
    assert.equal(await hasButton('Rapportera åtgärd'), true)
    assert.equal(await hasButton('Markera klar'), false, 'opening the form and saving completion are not competing actions')
    assert.equal(await page.$eval('button[aria-controls="comment-panel-task"]', node =>
      Array.from(node.querySelectorAll('svg')).some(icon => /check/i.test(icon.getAttribute('class') ?? ''))), false,
    'the report action must not visually suggest that the task is already completed')
    const compactCardHeight = await page.$eval('article', node => Math.ceil(node.getBoundingClientRect().height))
    assert.ok(compactCardHeight <= (width === 1440 ? 300 : 500), `normal contractor card should remain compact: ${compactCardHeight}px at ${width}px`)
    await page.screenshot({ path: resolve(output, `worker-overview-${width}.png`), fullPage: true })
    await (await page.$('article')).screenshot({ path: resolve(output, `worker-compact-card-${width}.png`) })
    assert.equal(await page.$eval('#history-task', node => node.getClientRects().length), 0)
    await button('Historik (1)', 'article').click()
    assert.match(await page.$eval('#history-task', node => node.innerText), /Min kommentar som beställare/)
    assert.equal(await page.$eval('button[aria-controls="history-task"]', node => node.getAttribute('aria-expanded')), 'true')
    await button('Historik (1)', 'article').click()
    await button('Rapportera åtgärd', 'article').click()
    await page.waitForSelector('#comment-task')
    assert.equal(posts.length, 0, 'opening history and the reporting form does not submit a status or comment')
    assert.equal(workspace.tasks[0].status, 'assigned')
    assert.equal(await page.$eval('#comment-task', node => node.rows), 3)
    assert.equal(await page.$$eval('article button', nodes => nodes.filter(node => node.textContent.trim() === 'Markera klar').length), 1)
    assert.equal(await page.$eval('article', node => Array.from(node.querySelectorAll('button'))
      .find(button => button.textContent.trim() === 'Markera klar').querySelector('svg')), null,
    'the unsaved completion action does not contain a completed-state check mark')
    await page.type('#comment-task', 'Pågående utkast ska finnas kvar när panelen stängs.')
    await button('Stäng återrapportering', 'article').click()
    assert.equal(await page.$('#comment-task'), null)
    await button('Rapportera åtgärd', 'article').click()
    assert.equal(await page.$eval('#comment-task', node => node.value), 'Pågående utkast ska finnas kvar när panelen stängs.')
    assert.equal(posts.length, 0, 'drafting, closing and reopening never changes status')
    await fill('#comment-task', '')
    assert.equal(await page.$('#angra-bestallning'), null, 'only the buyer sees order withdrawal')
    assert.equal(await page.$('input[aria-label="E-post"]'), null)
    assert.match(await page.$eval('main', node => node.textContent), /Bilder i utlåtandet/)
    assert.equal(await hasButton('Påbörja'), false, 'contractors need not announce that they have started work')
    assert.equal(await hasButton('Kan inte avhjälpas'), false, 'obstacles are comments rather than another workflow status')
    await button('Markera klar', 'article').click()
    await page.waitForSelector('article [data-testid="remediation-task-error"][role="alert"]')
    assert.match(await page.$eval('article [data-testid="remediation-task-error"]', node => node.textContent), /Lägg till en åtgärdsbild eller en förklarande kommentar/)
    assert.equal(workspace.tasks[0].status, 'assigned', 'a buyer comment must not satisfy the contractor evidence requirement')
    assert.equal(posts.at(-1).payload.status, 'reported_remedied', 'the server evaluates evidence ownership, not the client')
    await waitIdle()
    await page.type('#comment-task', 'Åtgärdat, men resultatet kan inte visas med foto.')
    conflictNext = true
    await button('Markera klar', 'article').click()
    await page.waitForFunction(() => document.querySelector('article [data-testid="remediation-task-error"]')?.textContent.includes('Testkonflikt'))
    assert.equal(await page.$eval('#comment-task', node => node.value), 'Åtgärdat, men resultatet kan inte visas med foto.')
    assert.equal(workspace.tasks[0].status, 'assigned')
    await waitIdle()
    await button('Markera klar', 'article').click()
    await page.waitForSelector('#comment-task', { hidden: true })
    assert.equal(workspace.tasks[0].status, 'reported_remedied')
    assert.equal(workspace.images.length, 0, 'an explanatory comment alone is sufficient when the work cannot be photographed')
    assert.equal(posts.at(-1).payload.message, 'Åtgärdat, men resultatet kan inte visas med foto.')
    assert.equal(posts.at(-1).payload.expectedUpdatedAt, '2026-09-07T10:00:00.000Z')
    assert.equal(await hasButton('Kommentera'), false)
    assert.equal(await hasButton('Markera klar'), false)
    await readHelp('status', /inte att besiktningsmannen har godkänt/)
    assert.equal(workspace.tasks[0].snapshot.noteText, initial('assignee').tasks[0].snapshot.noteText)
    console.log(`PASS worker evidence ${width}px: compact ${compactCardHeight}px card, one non-mutating report entry, hidden history, local missing-evidence/conflict errors, retained draft and comment-only completion`)

    await load(initial('assignee'))
    await button('Rapportera åtgärd', 'article').click()
    assert.equal(await hasButton('Skicka endast kommentar'), false)
    assert.equal(await hasButton('Skicka kommentar'), false)
    await readHelp('klarmarkering', /ring beställaren/)
    assert.equal(posts.length, 0)

    await load(initial('assignee'))
    await button('Rapportera åtgärd', 'article').click()
    await chooseImage()
    assert.equal(await page.$eval('#comment-task', node => node.value), '')
    assert.equal(workspace.tasks[0].status, 'assigned', 'uploading a photo alone does not mark the task complete')
    await page.evaluate(() => {
      const save = Array.from(document.querySelectorAll('article button')).find(node => node.textContent.trim() === 'Markera klar')
      save.click(); save.click()
    })
    await page.waitForSelector('#comment-task', { hidden: true })
    assert.deepEqual(posts.map(post => post.action), ['image', 'status'], 'a double click saves image-only completion once')
    assert.equal(workspace.tasks[0].status, 'reported_remedied')
    assert.equal(posts.at(-1).payload.status, 'reported_remedied')
    assert.equal(posts.at(-1).payload.expectedUpdatedAt, '2026-09-07T10:01:00.000Z')
    assert.equal(workspace.tasks[0].snapshot.noteText, initial('assignee').tasks[0].snapshot.noteText)
    await page.screenshot({ path: resolve(output, `worker-${width}.png`), fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    console.log(`PASS worker image ${width}px: image-only completion, double-click suppression, current CAS, unchanged original text and no horizontal overflow`)
  }
  assert.deepEqual(errors, [])
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {})
    console.error('Failure URL:', page.url())
    console.error('Failure UI:', await page.$eval('main', node => node.innerText).catch(() => 'not mounted'))
  }
  throw error
} finally {
  await browser?.close()
  await new Promise(ok => server.close(ok))
}
