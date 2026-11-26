// Real Gizmo components, fictional data and a local-only HTTP backend.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { emptyCustomerOffer, normalizeCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'
import { emptyContractParties } from '../src/lib/action-cases/customerContractParties.ts'
import { normalizeCustomerPresentation } from '../src/lib/action-cases/customerPresentation.ts'
import { renderContractSigningPdf } from '../src/lib/action-cases/contractSigningPdf.ts'

const output = resolve('C:/Users/hedbj/underhallsplan-villa/output/gizmo-customer-presentation-20261126')
await mkdir(output, { recursive: true })
const { webpack } = createRequire(import.meta.url)('next/dist/compiled/webpack/webpack')
await new Promise((done, reject) => webpack({ mode: 'development', devtool: false, entry: resolve('test/fixtures/customer-presentation-view.tsx'),
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  output: { path: output, filename: 'view.js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/supabaseClient': resolve('test/helpers/project-supabase-stub.ts'), '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString('errors-only'))) : done()))
const { css } = await postcss([tailwind({ base: resolve('src') })]).process((await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks";\n@source "../../test/fixtures/customer-presentation-view.tsx";'), { from: resolve('src/app/globals.css') })
const theme = await readFile('src/components/tasks/uppdrag-theme.css', 'utf8')
const initial = normalizeCustomerOffer({ ...emptyCustomerOffer('Fiktiv offert - momsvisning'), contractForm: 'custom', baseAmountOre: 1250000,
  contractParties: emptyContractParties('Fiktiv beställare', 'test@example.test'),
  paymentTerms: 'Betalning inom 30 dagar.', paymentPlan: { version: 1, installments: [{ id: '00000000-0000-4000-8000-000000000003', title: 'Efter utfört arbete', condition: 'Utfört arbete', amountOre: 1250000, plannedDate: '' }] } })
let state = { revision: 1, draft: initial, offerDraft: { revision: 1, draft: initial }, offers: [], costing: { privateAmount: 12345 }, customerLink: { organizationId: 'test', customerId: null }, customerPresentation: { available: true, revision: 0, value: null } }
let fail = false, writes = 0
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
const server = createServer(async (req, res) => {
  if (req.url === '/fixture') return json(res, state)
  if (req.url === '/__test__/fail-next') { fail = true; return json(res, { ok: true }) }
  if (req.url?.startsWith('/api/settings/customers')) return json(res, { workspace: { organization: { id: 'test' }, customers: [] } })
  if (req.url?.endsWith('/customer-presentation') && req.method === 'POST') {
    let raw = ''; for await (const chunk of req) raw += chunk
    const payload = JSON.parse(raw)
    if (fail) { fail = false; return json(res, { error: 'Fiktivt sparfel. Försök igen.' }, 503) }
    assert.equal(payload.contractRevision, state.revision)
    const value = normalizeCustomerPresentation(payload.value)
    const next = d => ({ ...d, customerPresentation: value, contractParties: { ...d.contractParties, business: value.customerType === 'private' ? null : { organizationNumber: '', contactName: '', signatoryName: '' } } })
    state = { ...state, revision: state.revision + 1, draft: next(state.draft), offerDraft: { revision: state.offerDraft.revision + 1, draft: next(state.offerDraft.draft) }, customerPresentation: { available: true, revision: state.customerPresentation.revision + 1, value } }; writes++
    await new Promise(resolve => setTimeout(resolve, 100))
    return json(res, { saved: true, workspace: state })
  }
  if (req.url === '/view.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(await readFile(resolve(output, 'view.js'))) }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}${theme}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage(), errors = [], external = []
  page.on('pageerror', error => { errors.push(error.message); console.log('UI error:', error.message) })
  await page.setRequestInterception(true)
  page.on('request', request => { if (request.url().startsWith(origin) || request.url().startsWith('data:')) void request.continue(); else { external.push(request.url()); void request.abort() } })
  const click = async label => { await page.waitForFunction(label => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === label), {}, label); await page.evaluate(label => { const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label); if (!button) throw new Error(`Button missing: ${label}`); button.click() }, label) }
  const text = () => page.$eval('main', node => node.innerText)
  const openSettings = async () => { await click('Översikt'); await page.waitForSelector('details'); await page.$eval('details', node => { node.open = true }) }
  const save = async () => { await click('Spara beställarval'); await page.waitForSelector('[role="alertdialog"]'); await click('Bekräfta och spara'); await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]')); await openSettings() }
  await page.setViewport({ width: 1365, height: 1000 }); await page.goto(origin); await page.waitForSelector('details'); await openSettings()
  await page.select('[aria-label="Projektets beställartyp"]', 'business'); assert.equal(await page.$eval('[aria-label="Projektets momsvisning"]', node => node.value), 'excl')
  await page.evaluate(() => fetch('/__test__/fail-next')); await click('Spara beställarval'); await click('Bekräfta och spara'); await page.waitForSelector('[role="alert"]')
  assert.match(await text(), /Fiktivt sparfel/); assert.equal(state.customerPresentation.revision, 0)
  await click('Bekräfta och spara'); await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]')); await openSettings()
  await page.screenshot({ path: resolve(output, 'desktop-overview.png'), fullPage: true })
  await click('Kundpris'); await page.waitForSelector('input[aria-label^="Fast pris exkl."]')
  assert.equal(await page.$eval('input[aria-label^="Fast pris exkl."]', node => node.value), '10000')
  await page.focus('input[aria-label^="Fast pris exkl."]'); await page.keyboard.press('Tab'); assert.equal(writes, 1)
  for (const tab of ['Offert', 'Avtal', 'ÄTA', 'Betalningsplan']) { await click(tab); await page.waitForFunction(() => document.querySelector('main').innerText.includes('10')); assert.match((await text()).replace(/\s/gu, ''), /10000/); assert.match(await text(), /exkl|exklusive/); }
  await click('Offert'); await page.screenshot({ path: resolve(output, 'desktop-offer.png'), fullPage: true })
  await click('Historiskt dokument'); assert.match((await text()).replace(/\s/gu, ''), /12500/); assert.match(await text(), /inklusive/)
  await page.reload(); await openSettings(); assert.equal(await page.$eval('[aria-label="Projektets beställartyp"]', node => node.value), 'business')
  await page.select('[aria-label="Projektets beställartyp"]', 'association'); await page.select('[aria-label="Projektets momsvisning"]', 'incl'); await save()
  await click('Kundpris'); assert.equal(await page.$eval('input[aria-label^="Fast pris inkl."]', node => node.value), '12500')
  await openSettings(); await page.select('[aria-label="Projektets momsvisning"]', 'excl'); await save()
  await openSettings(); await page.select('[aria-label="Projektets beställartyp"]', 'private'); assert.equal(await page.$eval('[aria-label="Projektets momsvisning"]', node => node.disabled), true); await save()
  assert.equal(state.draft.baseAmountOre, initial.baseAmountOre); assert.deepEqual(state.draft.paymentPlan, initial.paymentPlan); assert.deepEqual(state.costing, { privateAmount: 12345 })
  for (const width of [390, 344]) {
    await page.setViewport({ width, height: 850 }); await openSettings()
    await page.screenshot({ path: resolve(output, `${width}-overview.png`), fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('main *')].filter(node => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map(node => ({ tag: node.tagName, class: node.className, width: node.getBoundingClientRect().width })))) )
    await click('Offert'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${width}-offer.png`), fullPage: true })
  }
  await page.goto(`${origin}/?locked=1`); await page.waitForSelector('details'); await page.$eval('details', node => { node.open = true })
  assert.equal(await page.$('[aria-label="Projektets beställartyp"]'), null)
  assert.match(await text(), /låsta med avtalet/)
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  for (const kind of ['offer', 'contract']) {
    const draft = { ...state.draft, customerPresentation: { version: 1, customerType: 'business', vatBasis: 'excl' }, contractParties: { ...state.draft.contractParties, business: { organizationNumber: '556000-0000', contactName: 'Fiktiv kontakt', signatoryName: 'Fiktiv undertecknare' } } }
    const snapshot = { ...draft, projectTitle: 'Fiktivt byggprojekt', propertyAddress: 'Testgatan 1', customerName: 'Fiktiv kund AB', customerEmail: 'test@example.test', issuerName: 'Fiktiv byggare AB', replyEmail: 'test@example.test' }
    const bytes = await renderContractSigningPdf({ kind: kind === 'offer' ? 'offer' : undefined, id: 'test', version: 1, createdAt: '2026-11-26T10:00:00Z', snapshot, files: [] })
    await writeFile(resolve(output, `${kind}-ex-vat.pdf`), bytes)
  }
  await writeFile(resolve(output, 'ui-results.json'), JSON.stringify({ passed: true, writes, viewports: [1365, 390, 344], externalRequests: external, errors, storedPriceOre: state.draft.baseAmountOre, costingUnchanged: true }, null, 2))
  console.log('PASS: three customer kinds, shared VAT, save failure/retry, reload, all price views, frozen legacy document, locked project, desktop/mobile and PDFs; fictional data only.')
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
