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
let workspace = initial('customer_owner'), revision = 0, conflictNext = false, reads = 0
const posts = []
const server = createServer(async (request, response) => {
  if (request.url === '/mock-image.png') { response.setHeader('Content-Type', 'image/png'); response.end(image); return }
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
      !input.payload.message?.trim() && workspace.images.length === 0) {
      response.statusCode = 400; response.end(JSON.stringify({ error: 'Lägg till en åtgärdsbild eller en förklarande kommentar.' })); return
    }
    const task = workspace.tasks.find(item => item.id === input.payload.taskId) ?? workspace.tasks[0]
    const touched = input.action === 'assign'
      ? workspace.tasks.filter(item => input.payload.taskIds.includes(item.id)) : [task]
    if (input.action === 'assign') {
      for (const assigned of touched) {
        assigned.assigneeId = input.payload.assigneeId
        assigned.status = input.payload.assigneeId ? 'assigned' : 'unassigned'
        // Match the server contract: omitting dueDate preserves a task's existing date.
        if (Object.hasOwn(input.payload, 'dueDate')) assigned.dueDate = input.payload.dueDate
      }
    }
    if (input.action === 'create_assignee') workspace.assignees.push({ id: `created-${revision}`, ...input.payload })
    if (input.action === 'update_assignee') Object.assign(workspace.assignees.find(item => item.id === input.payload.assigneeId), input.payload)
    if (input.action === 'status') task.status = input.payload.status
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
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.process={env:{NODE_ENV:'development'},browser:true};</script><script src="/view.js"></script></body></html>`)
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
  const waitIdle = () => page.waitForFunction(() => !document.querySelector('button[aria-label="Uppdatera"]')?.disabled && !document.querySelector('[aria-busy="true"]') &&
    !Array.from(document.querySelectorAll('[role=status]')).some(node => /Åtgärden genomförs|Bilder laddas upp/.test(node.textContent)))
  const fill = async (selector, value) => {
    await page.click(selector)
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control')
    await page.type(selector, value)
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
  const chooseImage = async (selector = 'input[type=file][multiple]') => page.evaluate(value => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'Efter.png', { type: 'image/png' }))
    const input = document.querySelector(value)
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, selector)
  const load = async value => {
    workspace = value; revision = 0; posts.length = 0; reads = 0; conflictNext = false
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.waitForSelector('article')
  }
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 900 })
    await load(initial('customer_owner'))
    await page.waitForSelector('article select')
    assert.match(await page.$eval('main', node => node.textContent), /Beställare · uppföljning/)
    assert.equal(await page.$('#comment-task'), null, 'owner overview starts without an execution form')
    assert.equal(await page.$('article input[type=file]'), null, 'owner upload is collapsed until commenting')
    assert.equal(await hasButton('Anmäl åtgärdat'), false, 'owner must not receive the contractor completion action')
    assert.doesNotMatch(await page.$eval('main', node => node.textContent), /beskrivning av utförd åtgärd|Lägg till åtgärdsbilder/)
    assert.equal(await hasButton('Skriv ut åtgärdslista'), true)
    assert.match(await page.$eval('header [role="note"]', node => node.textContent), /Uppdatera hämtar.*Skriv ut åtgärdslista.*inte originalutlåtandet/)
    assert.match(await page.$eval('article', node => node.textContent), /2026-09-25/)
    await page.screenshot({ path: resolve(output, `owner-overview-${width}.png`), fullPage: true })
    assert.equal(await page.$eval('header a[href="#angra-bestallning"]', node => document.querySelector(node.getAttribute('href'))?.querySelector('h2')?.textContent), 'Ångra beställningen')
    await page.select('article select', 'worker')
    await page.waitForFunction(() => document.querySelector('article select')?.value === 'worker' && !document.querySelector('article select')?.disabled)
    assert.equal(posts[0].action, 'assign')
    assert.deepEqual(posts[0].payload.expectedVersions, { task: '2026-09-07T10:00:00.000Z' })
    assert.equal(Object.hasOwn(posts[0].payload, 'dueDate'), false, 'individual assignment must not wipe the saved date')
    assert.equal(workspace.tasks[0].dueDate, '2026-09-25')
    await fill('input[aria-label="E-post"]', 'updated-worker@example.invalid')
    await button('Kommentera', 'article').click()
    await page.waitForSelector('#comment-task')
    assert.equal(await page.$eval('label[for="comment-task"]', node => node.textContent.trim()), 'Kommentar till entreprenören')
    assert.match(await page.$eval('#comment-panel-task [role="note"]', node => node.textContent), /Ställ en fråga.*inte ett besiktningsbeslut/)
    assert.match(await page.$eval('article', node => node.textContent), /Bifoga bild/)
    await page.type('#comment-task', 'Kan ni komplettera med en bild på resultatet?')
    const refresh = page.waitForResponse(response => response.url() === `${url}/mock-portal` && response.request().method() === 'GET')
    await button('Uppdatera').click()
    await refresh
    await page.waitForFunction(() => !document.querySelector('button[aria-label="Uppdatera"]').disabled)
    assert.ok(reads > 0, 'manual refresh fetches the latest workspace')
    assert.equal(posts.length, 1, 'manual refresh must not invite, reassign or otherwise mutate')
    assert.equal(await page.$eval('input[aria-label="E-post"]', node => node.value), 'updated-worker@example.invalid', 'manual refresh retains edited contact data')
    assert.equal(await page.$eval('#comment-task', node => node.value), 'Kan ni komplettera med en bild på resultatet?', 'manual refresh retains owner comment draft')
    await page.evaluate(() => {
      const element = Array.from(document.querySelectorAll('button')).find(node => node.textContent.includes('Skicka lista'))
      element.click(); element.click()
    })
    await page.waitForFunction(() => document.body.textContent.includes('Den personliga länken är köad'))
    assert.deepEqual(posts.map(post => post.action), ['assign', 'update_assignee', 'send_assignee_link'])
    assert.equal(posts[1].payload.email, 'updated-worker@example.invalid')
    await chooseImage()
    await page.waitForFunction(() => document.querySelector('img[alt="Åtgärdsbild"]') && !document.querySelector('#comment-task').disabled)
    assert.equal(await page.$eval('#comment-task', node => node.value), 'Kan ni komplettera med en bild på resultatet?', 'owner image upload retains comment draft')
    await button('Skicka kommentar', 'article').click()
    await page.waitForFunction(() => document.querySelector('#comment-task')?.value === '' && !document.querySelector('#comment-task').disabled)
    assert.equal(posts.at(-1).action, 'comment')
    assert.equal(posts.at(-1).payload.message, 'Kan ni komplettera med en bild på resultatet?')
    assert.equal(workspace.tasks[0].status, 'assigned', 'owner comment must not mark the defect completed')
    await page.screenshot({ path: resolve(output, `owner-${width}.png`), fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await button('Ångra beställningen').click()
    assert.match(await page.$eval('#withdrawal-review', node => node.textContent), /Testbeställare.*beställning order.*buyer@example.invalid/)
    await button('Avbryt').click()
    assert.equal(posts.length, 5, 'dismissing withdrawal confirmation must not mutate the order')
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
    console.log(`PASS owner ${width}px: compact role-specific overview, preserved date, comment/image drafts across refresh, explicit invitation, double-click guard, cancel/confirm withdrawal, no overflow`)

    await load(bulkWorkspace())
    assert.equal(await hasButton('Markera alla i urvalet'), true, 'bulk selection is visible before manually selecting a defect')
    assert.equal(await hasButton('Markera ej tilldelade'), true)
    assert.match(await page.$$eval('[role="note"]', nodes => nodes.map(node => node.textContent).join('\n')), /Tilldela ändrar ansvarig men skickar ingen lista.*Filterbyte rensar markeringarna/)
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
    await page.select('select[aria-label="Filtrera status"]', 'unassigned')
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
    await page.emulateMediaType('print')
    assert.equal(await page.$$eval('[role="note"]', nodes => nodes.every(node => getComputedStyle(node).display === 'none')), true, 'help boxes are excluded from printing')
    assert.equal(await page.$$eval('select', nodes => nodes.every(node => node.getClientRects().length === 0)), true, 'printed tasks show recipient names instead of editing controls')
    assert.match(await page.$eval('main', node => node.innerText), /Urval: 2 av 3 anmärkningar\. Status: Alla\. Åtgärdas av: Målare\./,
      'printed view visibly identifies its restricted selection, status and contractor')
    await page.screenshot({ path: resolve(output, `print-filtered-${width}.png`), fullPage: true })
    await page.emulateMediaType('screen')
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
    assert.match(await page.$eval('main', node => node.textContent), /Kom överens med entreprenören/)
    assert.equal(await hasButton('Tilldela alla ej tilldelade'), false, 'suggestion is not an assigned contractor until confirmed')
    await button('Lägg till entreprenör').click()
    await page.waitForSelector('input[aria-label="E-post"]')
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
    await button('Kommentera', 'article').click()
    await page.type('#comment-task', 'Bilden behöver även visa fönstrets nederkant.')
    assert.equal(await hasButton('Anmäl åtgärdat'), false)
    await button('Begär komplettering', 'article').click()
    await page.waitForFunction(() => document.querySelector('#comment-task')?.value === '' && !document.querySelector('#comment-task').disabled)
    assert.equal(posts.at(-1).action, 'status')
    assert.equal(posts.at(-1).payload.status, 'returned')
    assert.equal(posts.at(-1).payload.message, 'Bilden behöver även visa fönstrets nederkant.')
    assert.equal(workspace.tasks[0].status, 'returned')
    assert.match(await page.$eval('article', node => node.textContent), /Komplettering begärd/)
    console.log(`PASS owner review ${width}px: requests clarification without inspection approval or contractor completion controls`)

    await load(initial('assignee'))
    await page.waitForSelector('#comment-task')
    assert.equal(await page.$('#angra-bestallning'), null, 'only the buyer sees order withdrawal')
    assert.equal(await page.$('input[aria-label="E-post"]'), null)
    assert.match(await page.$eval('main', node => node.textContent), /Bilder i utlåtandet/)
    await button('Anmäl åtgärdat').click()
    await page.waitForFunction(() => document.body.textContent.includes('Lägg till en åtgärdsbild eller en förklarande kommentar.'))
    assert.equal(workspace.tasks[0].status, 'assigned')
    await page.type('#comment-task', 'Åtgärdat, men resultatet kan inte visas med foto.')
    conflictNext = true
    await button('Anmäl åtgärdat').click()
    await page.waitForFunction(() => document.body.textContent.includes('Testkonflikt'))
    assert.equal(await page.$eval('#comment-task', node => node.value), 'Åtgärdat, men resultatet kan inte visas med foto.')
    await waitIdle()
    await page.evaluate(() => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array([137,80,78,71])], 'Efter.png', { type: 'image/png' }))
      const input = document.querySelector('input[type=file][multiple]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.waitForFunction(() => document.querySelector('img[alt="Åtgärdsbild"]') && !document.querySelector('#comment-task').disabled)
    assert.equal(posts.at(-1).action, 'image')
    assert.equal(await page.$eval('#comment-task', node => node.value), 'Åtgärdat, men resultatet kan inte visas med foto.')
    await button('Anmäl åtgärdat').click()
    await page.waitForFunction(() => document.querySelector('#comment-task')?.value === '' && !document.querySelector('#comment-task').disabled)
    assert.equal(posts.at(-1).payload.status, 'reported_remedied')
    assert.equal(posts.at(-1).payload.expectedUpdatedAt, '2026-09-07T10:01:00.000Z')
    assert.match(await page.$eval('main', node => node.textContent), /innebär inte att punkten är godkänd vid besiktning/)
    await page.screenshot({ path: resolve(output, `worker-${width}.png`), fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    console.log(`PASS worker ${width}px: originals, no owner controls, evidence requirement, conflict retains draft, upload, completion CAS, no horizontal overflow`)
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
