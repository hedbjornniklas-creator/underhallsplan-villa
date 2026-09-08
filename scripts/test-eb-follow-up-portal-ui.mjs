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
  inspection: { id: 'inspection', variant: 'SLB', variantLabel: 'Slutbesiktning', sequenceNo: 1, date: '2026-09-07' },
  access: { id: role, role, displayName: role === 'customer_owner' ? 'Testbeställare' : 'Testutförare',
    email: 'person@example.invalid', assigneeId: role === 'assignee' ? 'worker' : null,
    expiresAt: '2027-01-01T00:00:00Z', followUpOrderId: 'order' },
  followUp: { id: 'order', status: 'active', acceptedAt: '2026-09-07T10:00:00Z', withdrawalRequestedAt: null,
    buyerName: 'Testbeställare', receiptEmail: 'buyer@example.invalid', customerType: 'consumer', withdrawalDeadline: '2026-09-21' },
  assignees: [{ id: 'worker', name: 'Målare', companyName: 'Testmåleri AB', contactName: 'Testutförare',
    email: 'worker@example.invalid', phone: null, isActive: true }],
  tasks: [{ id: 'task', inspectionId: 'inspection', noteId: 'note', followUpOrderId: 'order',
    assigneeId: role === 'customer_owner' ? null : 'worker', assignmentManagedBy: 'contractor',
    status: role === 'customer_owner' ? 'unassigned' : 'assigned', dueDate: null, included: true,
    snapshot: { noteNumber: 1, noteText: 'Färgsläpp vid fönstret. Ytan ska undersökas och återrapporteras.',
      location: 'Entréplan', room: 'Vardagsrum', placeDetail: 'Fönstervägg', markerKey: 'E', statusKey: null,
      disciplineLabel: 'Måleri', disciplineLittera: 'M', inspectionVariant: 'SLB', inspectionVariantLabel: 'Slutbesiktning',
      inspectionSequenceNo: 1, inspectionDate: '2026-09-07' },
    reportedRemediedAt: null, updatedAt: '2026-09-07T10:00:00.000Z' }],
  events: [], images: [], originalImages: [{ id: 'original', taskId: 'task', fileName: 'Originalbild från utlåtandet',
    imageUrl: '/mock-image.png', thumbnailUrl: '/mock-image.png', createdAt: '2026-09-07T10:00:00Z' }], accessLinks: [],
})
let workspace = initial('customer_owner'), revision = 0, conflictNext = false
const posts = []
const server = createServer(async (request, response) => {
  if (request.url === '/mock-image.png') { response.setHeader('Content-Type', 'image/png'); response.end(image); return }
  if (request.url === '/mock-workspace') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(workspace)); return }
  if (request.url === '/mock-portal' || request.url === '/mock-portal/images') {
    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'GET') { response.end(JSON.stringify({ workspace })); return }
    let body = ''; for await (const chunk of request) body += chunk
    const input = request.url.endsWith('/images') ? { action: 'image', payload: { taskId: 'task' } } : JSON.parse(body)
    posts.push(input)
    await new Promise(ok => setTimeout(ok, 250))
    if (conflictNext) { conflictNext = false; response.statusCode = 409; response.end(JSON.stringify({ error: 'Testkonflikt. Texten finns kvar, försök igen.' })); return }
    if (input.action === 'status' && input.payload.status === 'reported_remedied' &&
      !input.payload.message?.trim() && workspace.images.length === 0) {
      response.statusCode = 400; response.end(JSON.stringify({ error: 'Lägg till en åtgärdsbild eller en förklarande kommentar.' })); return
    }
    const task = workspace.tasks[0]
    if (input.action === 'assign') { task.assigneeId = input.payload.assigneeId; task.status = 'assigned' }
    if (input.action === 'update_assignee') Object.assign(workspace.assignees[0], input.payload)
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
    task.updatedAt = new Date(Date.UTC(2026, 8, 7, 10, revision)).toISOString()
    response.end(JSON.stringify({ workspace })); return
  }
  if (request.url === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.process={env:{NODE_ENV:'development'},browser:true};</script><script src="/view.js"></script></body></html>`)
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  await page.setRequestInterception(true)
  page.on('request', request => new URL(request.url()).hostname === '127.0.0.1' ? request.continue() : request.abort())
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message) })
  const url = `http://127.0.0.1:${server.address().port}`
  const button = label => ({ click: async () => {
    const handle = await page.evaluateHandle(value => Array.from(document.querySelectorAll('button'))
      .find(node => node.textContent.trim() === value), label)
    const element = handle.asElement()
    assert.ok(element, `Missing button: ${label}`)
    await element.click()
    await handle.dispose()
  } })
  const waitIdle = () => page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') &&
    !Array.from(document.querySelectorAll('[role=status]')).some(node => /Åtgärden genomförs|Bilder laddas upp/.test(node.textContent)))
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 900 })
    workspace = initial('customer_owner'); revision = 0; posts.length = 0
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.waitForSelector('article select')
    assert.match(await page.$eval('main', node => node.textContent), /Beställare · uppföljning/)
    assert.equal(await page.$eval('header a[href="#angra-bestallning"]', node => document.querySelector(node.getAttribute('href'))?.querySelector('h2')?.textContent), 'Ångra beställningen')
    await page.select('article select', 'worker')
    await page.waitForFunction(() => document.querySelector('article select')?.value === 'worker' && !document.querySelector('article select')?.disabled)
    assert.equal(posts[0].action, 'assign')
    assert.deepEqual(posts[0].payload.expectedVersions, { task: '2026-09-07T10:00:00.000Z' })
    await page.click('input[aria-label="E-post"]')
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control')
    await page.type('input[aria-label="E-post"]', 'updated-worker@example.invalid')
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
    console.log(`PASS owner ${width}px: assignment CAS, edited invitation, double-click guard, cancel/confirm withdrawal, read-only history, no horizontal overflow`)

    workspace = initial('assignee'); revision = 0; posts.length = 0
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.waitForSelector('#comment-task')
    assert.equal(await page.$('#angra-bestallning'), null, 'only the buyer sees order withdrawal')
    assert.equal(await page.$('input[aria-label="E-post"]'), null)
    assert.match(await page.$eval('main', node => node.textContent), /Bilder i utlåtandet/)
    await button('Anmäl avhjälpt').click()
    await page.waitForFunction(() => document.body.textContent.includes('Lägg till en åtgärdsbild eller en förklarande kommentar.'))
    assert.equal(workspace.tasks[0].status, 'assigned')
    await page.type('#comment-task', 'Åtgärdat, men resultatet kan inte visas med foto.')
    conflictNext = true
    await button('Anmäl avhjälpt').click()
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
    await button('Anmäl avhjälpt').click()
    await page.waitForFunction(() => document.querySelector('#comment-task')?.value === '' && !document.querySelector('#comment-task').disabled)
    assert.equal(posts.at(-1).payload.status, 'reported_remedied')
    assert.equal(posts.at(-1).payload.expectedUpdatedAt, '2026-09-07T10:01:00.000Z')
    assert.match(await page.$eval('main', node => node.textContent), /innebär inte att punkten är godkänd vid besiktning/)
    await page.screenshot({ path: resolve(output, `worker-${width}.png`), fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    console.log(`PASS worker ${width}px: originals, no owner controls, evidence requirement, conflict retains draft, upload, completion CAS, no horizontal overflow`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  await new Promise(ok => server.close(ok))
}
