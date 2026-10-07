// Real components, synthetic HTTP backend. No live database, email or acceptance.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import {
  workspace,
  actionCase,
  itemizedWorkspace,
  published,
  id
} from '../test/fixtures/customer-offer-data.ts'
import {
  customerOfferTotal,
  offerPublishIssues,
  normalizeCustomerOffer
} from '../src/lib/action-cases/customerOffers.ts'
import { normalizeCustomerOfferCosting } from '../src/lib/action-cases/customerOfferCosting.ts'
import { normalizePlannedItems } from '../src/lib/action-cases/customerPlanning.ts'
import { projectFixture } from '../test/fixtures/project-workspace-data.ts'
import { normalizeScheduleRows } from '../src/lib/action-cases/projectSchedule.ts'
import { normalizeLumpSum } from '../src/lib/action-cases/lumpSum.ts'
import { copyRegistryCustomer } from '../src/lib/action-cases/customerRegistry.ts'
import { emptyBillingCustomer } from '../src/lib/action-cases/projectBilling.ts'

const require = createRequire(import.meta.url),
  { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/customer-offer-ui')
await mkdir(output, { recursive: true })
await writeFile(resolve(output, '.gitignore'), '*\n')
await new Promise((done, reject) =>
  webpack(
    {
      mode: 'development',
      devtool: false,
      entry: resolve('test/fixtures/customer-offer-view.tsx'),
      plugins: [
        new webpack.DefinePlugin({
          'process.env': JSON.stringify({ NODE_ENV: 'development' })
        })
      ],
      output: { path: output, filename: 'view.js' },
      resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        alias: { '@/lib/supabaseClient': resolve('test/helpers/project-supabase-stub.ts'), '@': resolve('src') }
      },
      module: {
        rules: [
          {
            test: /\.tsx?$/,
            exclude: /node_modules/,
            use: resolve('test/helpers/transpile-loader.mjs')
          },
          { test: /\.css$/, type: 'asset/source' }
        ]
      }
    },
    (error, stats) =>
      error || stats.hasErrors()
        ? reject(error ?? Error(stats.toString('errors-only')))
        : done()
  )
)
const { css: base } = await postcss([tailwind()]).process(
  await readFile('src/app/globals.css', 'utf8'),
  { from: resolve('src/app/globals.css') }
)
const theme = await readFile('src/components/tasks/uppdrag-theme.css', 'utf8'),
  js = await readFile(resolve(output, 'view.js')),
  img = await readFile('public/landing/besiktning-editorial-v2.png')
let state = process.argv.includes('--itemized') ? itemizedWorkspace() : structuredClone(workspace),
  challenge = null,
  failSave = false
state.planning = { available: true, revision: 0, items: [], sharedItems: [], costingAvailable: true, costing: {} }
function separateChoices() {
  const choices = state.draft.items.filter((i) => i.kind === 'option')
  state.planning.items.push(...choices.map((i) => ({ id: i.id, title: i.title, scope: i.scope,
    status: 'planned', budgetOre: i.amountOre, decisionBy: '', optionGroup: i.optionGroup ?? '' })))
  for (const i of choices) if (state.costing?.[i.id]) {
    state.planning.costing[i.id] = state.costing[i.id]
    delete state.costing[i.id]
  }
  state.draft.items = state.draft.items.filter((i) => i.kind !== 'option')
}
if (!process.argv.includes('--legacy-draft')) separateChoices()
if (process.argv.includes('--payment-plan')) {
  const total = state.draft.baseAmountOre
  state.draft.paymentTerms = 'FIKTIV TESTPLAN. Betalningsvillkor enligt den granskade avtalshandlingen.'
  state.draft.paymentPlan = { version: 1, installments: [
    { id: id(80), title: 'Grund färdig', condition: 'Efter färdigställd grund enligt avtalad omfattning.', plannedDate: '2027-04-30', amountOre: Math.floor(total / 4) },
    { id: id(81), title: 'Stomme och tak', condition: 'Efter färdig stomme och tätt tak enligt avtalad omfattning.', plannedDate: '', amountOre: Math.floor(total / 2) },
    { id: id(82), title: 'Återstående avtalat arbete', condition: 'Efter färdigställt återstående arbete enligt avtalet.', plannedDate: '', amountOre: total - Math.floor(total / 4) - Math.floor(total / 2) }
  ] }
}
if (process.argv.includes('--serve') && !process.argv.includes('--legacy-draft')) {
  state.offers = [published(state.draft)]
  state.planning.sharedItems = structuredClone(state.planning.items)
}
const writes = []
const projects = projectFixture(actionCase)
const customerRegistryTest = process.argv.includes('--customer-registry') || process.argv.includes('--project-billing')
const registry = { organization: { id: id(90), name: 'Fiktiv testorganisation', canManage: true }, customers: [
  { id: id(91), orgId: id(90), customerNumber: '1001', customerType: 'private', name: 'Anna Test', email: 'anna@example.test', phone: '0700000000', address: 'Testgatan 1', postalCode: '12345', city: 'Teststad', identityNumber: null, isActive: true, version: 1 },
  { id: id(92), orgId: id(90), customerNumber: '1002', customerType: 'business', name: 'Fiktivt företag', email: 'ekonomi@example.test', fortnoxCustomerNumber: '2002', isActive: true, version: 1 },
  { id: id(93), orgId: id(90), customerNumber: '1003', customerType: 'private', name: 'Inaktiv kund', isActive: false, version: 1 }
] }
registry.customers = registry.customers.map((customer) => ({ ...emptyBillingCustomer(), ...customer }))
let billing = { available: true, revision: 0, customerId: null, registry }, billingRequest = null
let customerRequestId = ''
if (customerRegistryTest) {
  state.offers = []
  state.customerLink = { organizationId: id(90), available: true, customerId: null, customerNumber: null }
  state.recipient = structuredClone(actionCase.participants.find((p) => p.role === 'customer'))
}
function syncTestRecipient(binding = false) {
  if (!customerRegistryTest || !state.draft.contractParties) return
  const parties = state.draft.contractParties
  if (binding || state.recipient.name !== parties.customers[0].name || state.recipient.email !== parties.email) {
    projects.cases[0].attachments = projects.cases[0].attachments.map((a) => ({ ...a,
      grantedParticipantIds: a.grantedParticipantIds.filter((id) => id !== state.recipient.id) }))
    state.planning.sharedItems = []
    state.planning.revision++
    schedule.sharedRows = []
    schedule.revision++
  }
  state.recipient = { ...state.recipient, name: parties.customers[0].name, email: parties.email, phone: parties.mobile || parties.phone }
  projects.cases[0].customerName = state.recipient.name
  projects.cases[0].customerEmail = state.recipient.email
  projects.cases[0].customerPhone = state.recipient.phone
  projects.cases[0].participants = projects.cases[0].participants.map((p) => p.role === 'customer' ? state.recipient : p)
}
let schedule = { available: true, revision: 0, rows: [], sharedRows: [] }, slowSave = false
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const json = (body, status = 200) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }
  if (path === '/project-fixture') { json(projects); return }
  if (customerRegistryTest && path === '/api/settings/customers') { json({ workspace: registry }); return }
  if (path === '/__test__/writes') { json(writes); return }
  if (path === '/__test__/fail-save' && req.method === 'POST') { failSave = true; json({ ok: true }); return }
  if (path === '/__test__/slow-save' && req.method === 'POST') { slowSave = true; json({ ok: true }); return }
  if (path === '/__test__/accept-contract' && req.method === 'POST') {
    state.offers = [{ ...published(state.draft), status: 'accepted', acceptedAt: new Date().toISOString(), acceptedBy: 'Anna Test', acceptedTotalOre: state.draft.baseAmountOre }]
    json({ ok: true }); return
  }
  if (path.endsWith('/billing') && req.method === 'GET') { json(billing); return }
  if (path.endsWith('/schedule') && req.method === 'GET') { json(schedule); return }
  if (path === '/api/action-cases' && req.method === 'GET') { json({ workspace: projects }); return }
  if (req.method === 'POST') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    if (slowSave && (['save', 'autosave'].includes(body.operation) || body.action === 'save_item_scope' || path.endsWith('/billing'))) { slowSave = false; await new Promise((resolve) => setTimeout(resolve, 5000)) }
    writes.push(body.operation ?? body.action ?? `billing_${body.mode}`)
    if (path.endsWith('/billing')) {
      if (failSave) { failSave = false; json({ error: 'Tillfälligt anslutningsfel. Dina ändringar är kvar.' }, 503); return }
      if (billingRequest?.id === body.requestId && billingRequest.key === JSON.stringify(body)) { json(billing); return }
      if (body.revision !== billing.revision) { json({ error: 'Fakturakopplingen har ändrats. Dina ändringar är kvar.' }, 409); return }
      let customer = registry.customers.find((row) => row.id === body.customerId)
      if (body.mode !== 'create' && (!customer || customer.version !== body.customerVersion)) { json({ error: 'Kundversionen har ändrats.' }, 409); return }
      if (body.mode === 'create') {
        customer = { ...body.customer, id: id(94 + registry.customers.length), customerNumber: String(1001 + registry.customers.length), isActive: true, version: 1, fortnoxCustomerNumber: null }
        registry.customers.push(customer)
      } else if (body.mode === 'update') Object.assign(customer, body.customer, { version: customer.version + 1 })
      billing = { ...billing, customerId: customer.id, revision: billing.revision + 1 }
      billingRequest = { id: body.requestId, key: JSON.stringify(body) }
      json(billing); return
    }
    if (path === '/api/action-cases') {
      if (failSave) { failSave = false; json({ error: 'Tillfälligt anslutningsfel. Försök igen.' }, 503); return }
      const payload = body.payload ?? {}
      let itemId, caseId
      if (body.action === 'update_item' || body.action === 'save_item_scope') {
        const item = projects.cases.flatMap((c) => c.items).find((i) => i.id === payload.itemId)
        if (!item) { json({ error: 'Åtgärden saknas.' }, 404); return }
        if (payload.expectedUpdatedAt !== item.updatedAt) { json({ error: 'Åtgärden har ändrats i en annan session.' }, 409); return }
        if (payload.title !== undefined) item.title = payload.title
        if (payload.scope !== undefined) item.scope = payload.scope
        if (payload.scopeConditions !== undefined) item.scopeConditions = payload.scopeConditions
        if (payload.scopeExclusions !== undefined) item.scopeExclusions = payload.scopeExclusions
        if (payload.scopeAdvice !== undefined) item.scopeAdvice = payload.scopeAdvice
        if (payload.scopeAttachmentIds !== undefined) item.scopeAttachmentIds = payload.scopeAttachmentIds
        if (payload.lumpSum !== undefined) {
          item.lumpSum = normalizeLumpSum(payload.lumpSum)
          item.estimatedCost = item.lumpSum?.internalCost ?? null
          item.customerPrice = item.lumpSum?.customerPrice ?? null
          item.status = !item.scope?.trim() ? 'scope_needed' : item.lumpSum?.verified ? 'ready_for_quote' : 'pricing_needed'
        }
        item.updatedAt = new Date().toISOString()
        if (body.action === 'save_item_scope') {
          if (item.lumpSum) item.lumpSum.verified = false
          const { costLines, costSuggestion, workParts, ...saved } = item
          json({ item: saved, caseStatus: 'pricing' }); return
        }
      } else if (body.action === 'delete_item') {
        const c = projects.cases.find((c) => c.id === payload.caseId)
        if (!c || !c.items.some((i) => i.id === payload.itemId)) { json({ error: 'Åtgärden saknas.' }, 404); return }
        if (state.draft.items.some((i) => i.id === payload.itemId) || state.offers.some((o) => o.snapshot.items.some((i) => i.id === payload.itemId))) {
          json({ error: 'Åtgärden finns i ett kundavtal eller offertutkast. Ta bort arbetsdelen ur oskickade utkast först. Skickade avtal bevaras.' }, 409); return
        }
        c.items = c.items.filter((i) => i.id !== payload.itemId)
      } else if (body.action === 'add_item') {
        const c = projects.cases.find((c) => c.id === payload.caseId)
        itemId = id(500 + writes.length)
        c.items.push({ ...structuredClone(projects.cases[0].items[0]), id: itemId, title: payload.title, scope: '', scopeConditions: '', scopeExclusions: '', scopeAdvice: '', costLines: [] })
      } else if (body.action === 'create_case') {
        caseId = id(600 + writes.length)
        projects.cases.unshift({ ...structuredClone(projects.cases[0]), id: caseId, ...payload, attachments: [], participants: [],
          items: payload.items.filter((title) => title.trim()).map((title, n) => ({ ...structuredClone(projects.cases[0].items[0]), id: id(700 + writes.length * 10 + n), title, scope: '', costLines: [] })) })
      } else { json({ error: 'Denna åtgärd är inte aktiverad i den fiktiva demonstrationen.' }, 400); return }
      json({ workspace: projects, itemId, caseId }); return
    }
    if (path.endsWith('/schedule')) {
      if (failSave) { failSave = false; json({ error: 'Tillfälligt anslutningsfel. Försök igen.' }, 503); return }
      if (body.revision !== schedule.revision) { json({ error: 'Tidsplanen har ändrats i en annan session.' }, 409); return }
      try {
        if (body.operation === 'save') schedule.rows = normalizeScheduleRows(body.rows)
        else if (body.operation === 'share' && body.confirmed) schedule.sharedRows = normalizeScheduleRows(schedule.rows, true)
        else if (body.operation === 'unshare') schedule.sharedRows = []
        else throw new Error('Ogiltig åtgärd')
        schedule.revision++; json(schedule)
      } catch (e) { json({ error: e.message }, 400) }
      return
    }
    if (path.includes('/public/')) {
      if (body.operation === 'challenge') {
        challenge = { selection: body.selection, signerName: body.signerName }
        json({ challengeId: id(30) })
        return
      }
      if (body.operation === 'accept') {
        if (body.code !== '123456') {
          json(
            {
              error: 'Koden stämmer inte. Kontrollera mejlet och försök igen.'
            },
            400
          )
          return
        }
        const offer = state.offers[0]
        offer.status = 'accepted'
        offer.acceptedBy = challenge.signerName
        offer.acceptedOptionIds = challenge.selection
        offer.acceptedTotalOre = customerOfferTotal(
          offer.snapshot,
          challenge.selection
        )
        offer.acceptedAt = '2026-09-29T12:34:00Z'
        json({ accepted: true, offer })
        return
      }
    } else if (path.endsWith('/customer-planning')) {
      if (body.revision !== state.planning.revision) { json({ error: 'Planeringen har ändrats. Uppdatera vyn.' }, 409); return }
      try {
        if (body.operation === 'save') {
          if (failSave) { failSave = false; json({ error: 'Tillfälligt anslutningsfel. Försök igen.' }, 503); return }
          state.planning.items = normalizePlannedItems(body.items)
          state.planning.costing = normalizeCustomerOfferCosting(body.costing, state.planning.items)
        }
        else if (body.operation === 'share') {
          if (!body.confirmed || JSON.stringify(body.items) !== JSON.stringify(state.planning.items)) throw new Error('Bekräfta den sparade planeringen.')
          state.planning.sharedItems = normalizePlannedItems(body.items, true)
        } else if (body.operation === 'unshare') state.planning.sharedItems = []
        else throw new Error('Okänd åtgärd')
        state.planning.revision++
        json(state.planning)
      } catch (error) { json({ error: error.message }, 400) }
      return
    } else if (path.endsWith('/customer-offers')) {
      if (body.operation === 'save' || body.operation === 'autosave') {
        if (failSave) {
          failSave = false
          json({ error: 'Tillfälligt anslutningsfel. Försök igen.' }, 503)
          return
        }
        if (body.revision !== state.revision) {
          json({ error: 'Offerten har ändrats. Uppdatera vyn.' }, 409)
          return
        }
        state.draft = normalizeCustomerOffer(body.draft)
        state.costing = normalizeCustomerOfferCosting(body.costing, state.draft.items)
        state.revision++
        if (body.operation === 'save') syncTestRecipient()
      } else if (customerRegistryTest && body.operation === 'bind_customer') {
        if (body.requestId === customerRequestId) { json(state); return }
        if (failSave) { failSave = false; json({ error: 'Tillfälligt anslutningsfel. Försök igen.' }, 503); return }
        if (body.revision !== state.revision) { json({ error: 'Utkastet har ändrats.' }, 409); return }
        const draft = normalizeCustomerOffer(body.draft)
        const costing = normalizeCustomerOfferCosting(body.costing, draft.items)
        let customer = registry.customers.find((row) => row.id === body.binding.customerId && row.isActive && row.customerType === 'private')
        if (body.binding.mode === 'create') {
          const parties = draft.contractParties
          customer = { id: id(100 + registry.customers.length), orgId: id(90), customerNumber: String(1001 + registry.customers.length), customerType: 'private',
            name: parties.customers[0].name, identityNumber: parties.customers[0].personalNumber, email: parties.email, phone: parties.mobile || parties.phone,
            address: parties.street, postalCode: parties.postalCode, city: parties.city, isActive: true, version: 1 }
          registry.customers.push(customer)
        } else if (!customer || customer.version !== body.binding.customerVersion) { json({ error: 'Kunden har ändrats. Uppdatera kundlistan.' }, 409); return }
        draft.contractParties = copyRegistryCustomer(draft.contractParties, customer)
        state.draft = draft
        state.costing = costing
        state.revision++
        state.customerLink.customerId = customer.id
        state.customerLink.customerNumber = customer.customerNumber
        customerRequestId = body.requestId
        syncTestRecipient(true)
      } else if (body.operation === 'separate_choices') {
        if (state.offers.some((o) => o.status === 'published' || o.status === 'accepted')) { json({ error: 'Återkalla den öppna versionen först.' }, 409); return }
        if (body.revision !== state.revision || body.planningRevision !== state.planning.revision) { json({ error: 'Uppgifterna har ändrats.' }, 409); return }
        separateChoices()
        state.revision++
        state.planning.revision++
      } else if (body.operation === 'publish') {
        if (state.draft.items.some((i) => i.kind === 'option')) { json({ error: 'Flytta valen först.' }, 409); return }
        if (offerPublishIssues(state.draft).length) { json({ error: 'Komplettera utkastet före utskick.' }, 400); return }
        state.offers = [published(state.draft)]
      }
      else if (body.operation === 'withdraw')
        state.offers[0].status = 'withdrawn'
      else if (body.operation !== 'send') {
        json({ error: 'Unexpected operation' }, 400)
        return
      }
      json(state)
      return
    }
    json({ error: 'Unexpected write' }, 400)
    return
  }
  if (path === '/fixture' || path.endsWith('/customer-offers')) {
    json(state)
    return
  }
  if (path.endsWith('/customer-planning')) { json(state.planning); return }
  if (path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'image/png')
    res.end(img)
    return
  }
  if (path === '/view.js') {
    res.setHeader('Content-Type', 'application/javascript')
    res.end(js)
    return
  }
  if (
    [
      '/uppdrag/brand/logo.svg',
      '/uppdrag/brand/symbol.svg',
      '/uppdrag/brand/manrope.ttf'
    ].includes(path)
  ) {
    res.setHeader(
      'Content-Type',
      path.endsWith('ttf') ? 'font/ttf' : 'image/svg+xml'
    )
    res.end(await readFile(resolve('public', path.slice(1))))
    return
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(
    `<!doctype html><html lang="sv"><head><title>Gizmo kundvy - testprojekt</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${base}${theme}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`
  )
})
await new Promise((done) =>
  server.listen(Number(process.env.PREVIEW_PORT) || 0, '127.0.0.1', done)
)
const origin = `http://127.0.0.1:${server.address().port}`
if (process.argv.includes('--serve'))
  console.log(
    `Synthetic customer preview: ${origin}/kund ; editor: ${origin}/intern ; projects: ${origin}/uppdrag ; test email code: 123456`
  )
else {
  const browser = await puppeteer.launch({
    executablePath:
      process.env.CHROME_PATH ??
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  })
  try {
    const page = await browser.newPage(),
      errors = [],
      external = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (
        new URL(req.url()).origin === origin ||
        req.url().startsWith('data:image/')
      )
        req.continue()
      else {
        external.push(req.url())
        req.abort()
      }
    })
    const click = async (text) =>
      page.locator(`::-p-xpath(//button[normalize-space(.)="${text}"])`).click()
    const fill = async (text, value) =>
      page
        .locator(
          `::-p-xpath(//label[contains(.,"${text}")]//input[not(@type="checkbox")] | //label[contains(.,"${text}")]//textarea)`
        )
        .fill(value)
    async function layout(label) {
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1
        ),
        false,
        `${label}: overflow`
      )
      assert.deepEqual(errors, [], label)
    }
    await page.setViewport({ width: 1440, height: 980 })
    await page.goto(origin + '/intern', { waitUntil: 'networkidle0' })
    await page.waitForSelector('h1')
    await layout('editor')
    assert.ok(
      !(await page.evaluate(() =>
        document.body.textContent.includes('Privat UE-offert')
      ))
    )
    // Private worksheet is saved separately; using a calculated price is explicit.
    await click('Val och tillval')
    await page.locator('section[aria-label="Val och tillval"] .gizmo-editor-row-toggle').click()
    await page.locator('::-p-xpath(//summary[contains(.,"Intern priskalkyl")])').click()
    await fill('Inköpspris exkl. moms (kr) *', '10000')
    await fill('Påslag på inköpspriset (%, valfritt)', '10')
    await fill('Fast påslag exkl. moms (kr, valfritt)', '1000')
    await click('Lägg till tillägg')
    await fill('Tillägg 1 *', 'Montage')
    assert.equal(await page.$('::-p-xpath(//button[normalize-space(.)="Använd kundpris"])'), null)
    await fill('Belopp tillägg 1 (kr) *', '2000')
    await page.keyboard.press('Tab')
    assert.equal(await page.$eval('[aria-label="Prisunderlag inkl. moms (kr, valfritt)"]', (el) => el.value), '185000')
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 980 })
      await page.$eval('fieldset details', (el) => el.scrollIntoView({ block: 'start' }))
      await layout(`${width} private calculation`)
      await page.screenshot({ path: resolve(output, `${width}-cost-calculator.png`), fullPage: false })
    }
    await page.setViewport({ width: 1440, height: 980 })
    await click('Använd kundpris')
    assert.equal(await page.$eval('[aria-label="Prisunderlag inkl. moms (kr, valfritt)"]', (el) => el.value), '17500')
    failSave = true
    await click('Spara planering')
    await page.waitForFunction(() => document.body.textContent.includes('Tillfälligt anslutningsfel'))
    assert.equal(state.planning.costing[id(11)], undefined)
    await click('Spara planering')
    await page.waitForFunction(() => document.querySelector('main [role="status"]')?.textContent === 'Sparat')
    assert.equal(state.planning.costing[id(11)].purchaseOre, 1000000)
    await page.reload({ waitUntil: 'networkidle0' })
    await click('Val och tillval')
    await page.locator('section[aria-label="Val och tillval"] .gizmo-editor-row-toggle').click()
    await page.locator('::-p-xpath(//summary[contains(.,"Intern priskalkyl")])').click()
    assert.equal(await page.$eval('[aria-label="Inköpspris exkl. moms (kr) *"]', (el) => el.value), '10000')
    assert.equal(await page.$eval('[aria-label="Prisunderlag inkl. moms (kr, valfritt)"]', (el) => el.value), '17500')
    // Existing manual prices remain editable even when a private worksheet exists.
    await fill('Prisunderlag inkl. moms (kr, valfritt)', '185000')
    await page.keyboard.press('Tab')
    await click('Spara planering')
    await page.waitForFunction(() => document.querySelector('main [role="status"]')?.textContent === 'Sparat')
    await click('Grundavtal')
    await page.locator('::-p-xpath(//button[starts-with(normalize-space(.),"Priset")])').click()
    // Decimal input, save failure preserves draft, then retry.
    const price = await page.$('[aria-label="Grundpris inkl. moms (kr) *"]')
    await price.click({ clickCount: 3 })
    await price.type('1250000,50')
    await page.keyboard.press('Tab')
    assert.equal(await price.evaluate((el) => el.value), '1250000,50')
    failSave = true
    await click('Spara utkast')
    await page.waitForFunction(() =>
      document.body.textContent.includes('Tillfälligt anslutningsfel')
    )
    assert.equal(await price.evaluate((el) => el.value), '1250000,50')
    await click('Spara utkast')
    await page.waitForFunction(() =>
      document.body.textContent.includes('Offertutkastet sparades')
    )
    assert.equal(state.draft.baseAmountOre, 125000050)
    await page.screenshot({
      path: resolve(output, 'desktop-editor.png'),
      fullPage: true
    })
    const previewWrites = writes.length
    await page.locator('::-p-xpath(//button[contains(.,"Offertuppgifter")])').click()
    await fill('Rubrik *', 'Tillbyggnad - osparad komplettering')
    await page
      .locator(
        '::-p-xpath(//aside//button[normalize-space(.)="Granska offertutkast"])'
      )
      .click()
    await page.waitForSelector('article[aria-label="Kundoffert"]')
    assert.equal(
      await page.$eval('h1', (el) => {
        const r = el.getBoundingClientRect()
        return (
          r.top >= 0 &&
          r.bottom <= innerHeight &&
          document.activeElement === el
        )
      }),
      true,
      'Preview from the bottom opens at the heading with keyboard focus'
    )
    await layout('draft preview')
    await page.screenshot({
      path: resolve(output, 'desktop-offer.png'),
      fullPage: true
    })
    await click('Tillbaka till redigering')
    await page.waitForSelector('fieldset')
    assert.equal(
      await page.$eval(
        'h1',
        (el) => document.activeElement === el && el.getBoundingClientRect().top >= 0
      ),
      true,
      'Return from the document restores focus at the editor heading'
    )
    assert.equal(
      await page.$eval('fieldset input', (el) => el.value),
      'Tillbyggnad - osparad komplettering',
      'Preview navigation preserves unsaved text'
    )
    await page.locator('::-p-xpath(//button[starts-with(normalize-space(.),"Priset")])').click()
    assert.equal(
      await page.$eval('[aria-label="Grundpris inkl. moms (kr) *"]', (el) => el.value),
      '1250000,50'
    )
    assert.equal(writes.length, previewWrites, 'Preview does not save or publish')
    await click('Spara utkast')
    await page.waitForFunction(
      () => document.querySelector('main [role="status"]')?.textContent === 'Sparat'
    )
    await page
      .locator(
        '::-p-xpath(//label[contains(. ,"Jag har granskat kundofferten")]//input)'
      )
      .click()
    await click('Skicka offert')
    await page.waitForFunction(() =>
      document.body.textContent.includes('Offerten har skickats')
    )
    assert.equal(writes.filter((op) => op === 'publish').length, 1)
    const customerPreviewWrites = writes.length
    await click('Visa som beställare')
    assert.match(await page.evaluate(() => document.body.textContent), /Förhandsgranskning som beställare/)
    assert.equal(writes.length, customerPreviewWrites, 'Viewing as customer does not save or send')
    await page.waitForFunction(() =>
      document.body.textContent.includes('Grundavtalets pris')
    )
    await layout('customer preview')
    assert.equal(
      await page.evaluate(() =>
        document.body.textContent.includes('Skicka kod till min e-post')
      ),
      false
    )
    for (const width of [1440, 1024, 390, 344]) {
      await page.setViewport({ width, height: 900 })
      await page.goto(origin + '/kund', { waitUntil: 'networkidle0' })
      assert.doesNotMatch(await page.evaluate(() => document.body.textContent), /Förhandsgranskning som beställare/)
      await layout(`${width} overview`)
      const primary = await page.$('button.text-white')
      assert.equal(
        await primary.evaluate((el) => getComputedStyle(el).backgroundColor),
        'rgb(37, 42, 45)',
        'Visible primary action background'
      )
      assert.equal(
        await primary.evaluate((el) => getComputedStyle(el).color),
        'rgb(255, 255, 255)',
        'Visible primary action label'
      )
      for (const word of ['marginal', 'inköpspriser', 'ue-hemlig', 'Intern priskalkyl', 'Påslag på inköpspriset'])
        assert.equal(
          await page.evaluate(
            (t) => document.body.textContent.includes(t),
            word
          ),
          false
        )
      await page.screenshot({
        path: resolve(output, `${width}-overview.png`),
        fullPage: true
      })
        await layout(`${width} offer`)
      await page.screenshot({
        path: resolve(output, `${width}-offer.png`),
        fullPage: true
      })
      await page
        .locator('::-p-xpath(//button[contains(.,"Bilder och filer")])')
        .click()
      await page.waitForFunction(() =>
        [...document.querySelectorAll('main img')].every(
          (img) => img.complete && img.naturalWidth > 0
        )
      )
      await layout(`${width} files`)
      await page.screenshot({
        path: resolve(output, `${width}-files.png`),
        fullPage: true
      })
      await page.goto(origin + '/intern', { waitUntil: 'networkidle0' })
      await layout(`${width} editor`)
      await page.screenshot({
        path: resolve(output, `${width}-editor.png`),
        fullPage: true
      })
    }
    await page.setViewport({ width: 1440, height: 980 })
    await page.goto(origin + '/kund', { waitUntil: 'networkidle0' })
    assert.equal(await page.$('input[type="radio"]'), null, 'No choices during main agreement signing')
    await fill('Ditt fullständiga namn', 'Anna Exempel')
    await page
      .locator('::-p-xpath(//label[contains(.,"Jag är beställaren")]//input)')
      .click()
    await click('Skicka kod till min e-post')
    await page.waitForFunction(() =>
      document.body.textContent.includes('sexsiffriga koden')
    )
    await fill('E-postkod', '000000')
    await click('Bekräfta godkännandet')
    await page.waitForFunction(() =>
      document.body.textContent.includes('Koden stämmer inte')
    )
    await fill('E-postkod', '123456')
    await click('Bekräfta godkännandet')
    await page.waitForFunction(() =>
      document.body.textContent.includes('Godkänt av Anna Exempel')
    )
    assert.equal(state.offers[0].acceptedTotalOre, 125000050)
    assert.match(
      await page.evaluate(() => document.body.textContent),
      /2026-09-29 14:34/
    )
    await page.screenshot({
      path: resolve(output, 'accepted.png'),
      fullPage: true
    })
    await page.reload({ waitUntil: 'networkidle0' })
    assert.match(
      await page.evaluate(() => document.body.textContent),
      /Godkänt avtal/
    )
    await page.goto(origin + '/intern', { waitUntil: 'networkidle0' })
    assert.equal(await page.$eval('fieldset', (el) => el.disabled), true)
    await page.goto(origin + '/intern?empty', { waitUntil: 'networkidle0' })
    await click('Granska grundavtal')
    await layout('empty preview')
    state.offers = [published(state.draft)]
    await page.goto(origin + '/intern?no-email', { waitUntil: 'networkidle0' })
    await page.locator('aside summary').click()
    assert.match(
      await page.$eval('aside', (el) => el.textContent),
      /Ange beställarens e-postadress i uppdraget\./
    )
    await page
      .locator(
        '::-p-xpath(//label[contains(.,"Jag har granskat kundofferten")]//input)'
      )
      .click()
    assert.equal(
      await page.$eval('aside button.bg-slate-950', (el) => el.disabled),
      true,
      'Missing recipient still blocks publication after confirmation'
    )
    await page.goto(origin + '/kund?expired', { waitUntil: 'networkidle0' })
    assert.equal(
      await page.evaluate(() =>
        document.body.textContent.includes('Skicka kod till min e-post')
      ),
      false
    )
    await page.keyboard.press('Tab')
    await layout('expired/keyboard')
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    console.log(
      'PASS real component click flow: edit, decimal prices, failed save/retry, preview scroll/focus, unsaved text preserved, missing recipient, send base only, code error/retry, server receipt, reload/locked, empty/expired, files; four viewport widths; no external traffic'
    )
  } finally {
    await browser.close()
    await new Promise((done) => server.close(done))
  }
}
