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
        alias: { '@': resolve('src') }
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
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const json = (body, status = 200) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }
  if (req.method === 'POST') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    writes.push(body.operation)
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
      if (body.operation === 'save') {
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
    `Synthetic customer preview: ${origin}/kund ; editor: ${origin}/intern ; test email code: 123456`
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
    await page.locator('::-p-xpath(//summary[contains(.,"Intern priskalkyl")])').click()
    assert.equal(await page.$eval('[aria-label="Inköpspris exkl. moms (kr) *"]', (el) => el.value), '10000')
    assert.equal(await page.$eval('[aria-label="Prisunderlag inkl. moms (kr, valfritt)"]', (el) => el.value), '17500')
    // Existing manual prices remain editable even when a private worksheet exists.
    await fill('Prisunderlag inkl. moms (kr, valfritt)', '185000')
    await page.keyboard.press('Tab')
    await click('Spara planering')
    await page.waitForFunction(() => document.querySelector('main [role="status"]')?.textContent === 'Sparat')
    await click('Grundavtal')
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
      await page.$eval('[aria-label="Grundpris inkl. moms (kr) *"]', (el) => el.value),
      '1250000,50'
    )
    assert.equal(
      await page.$eval('fieldset input', (el) => el.value),
      'Tillbyggnad - osparad komplettering',
      'Preview navigation preserves unsaved text'
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
