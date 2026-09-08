import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/renoapp-classification-ui')
await mkdir(output, { recursive: true })
await new Promise((done, reject) => webpack({
  mode: 'development', devtool: false,
  entry: { board: resolve('test/fixtures/renoapp-completion-view.tsx'), flow: resolve('test/fixtures/renoapp-classification-flow.tsx') },
  output: { path: output, filename: '[name].js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString('errors-only'))) : done()))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const flowCss = await readFile(resolve('node_modules/@xyflow/react/dist/style.css'), 'utf8')
const bundles = { '/board.js': await readFile(resolve(output, 'board.js')), '/flow.js': await readFile(resolve(output, 'flow.js')) }
const writes = []
const action = { id: 'electrical', categoryId: null, key: 'electrical', label: 'Elinstallationer', description: 'Arbete med el.',
  riskLevel: 'medium', contractorRequirement: 'authorized_electrician', sortOrder: 100, isActive: true,
  questionCount: 0, requirementCount: 1, participantRoleCount: 1, impliesElectrical: true }
const actions = [action]
const document = { id: 'document', key: 'electrical_document', label: 'Eldokumentation', description: null,
  reviewGuidance: null, defaultPhase: 'after_completion', sortOrder: 100, isActive: true }
const role = { id: 'electrician', key: 'electrician', label: 'Elinstallationsforetag', description: null,
  reviewGuidance: null, roleKind: 'contractor', sortOrder: 100, isActive: true }
const responses = {
  'action-types': { items: actions }, 'questions': { items: [] }, 'document-types': { items: [document] },
  'participants': { items: [role] }, 'review-flags': { items: [] }, 'review-flag-links': { items: [] },
  'requirements': { actionTypes: [{ actionType: action, requirements: [{ id: 'requirement', documentTypeId: document.id,
    documentLabel: document.label, isRequired: true, sortOrder: 100, note: null }] }] },
  'action-type-questions': { actionTypes: [] },
  'action-type-participants': { actionTypes: [{ actionType: action, participantRoles: [{ id: 'role-link', participantRoleId: role.id,
    participantRoleLabel: role.label, roleKind: role.roleKind, isRequired: true, sortOrder: 100 }] }] },
}
const server = createServer(async (request, response) => {
  if (bundles[request.url]) { response.setHeader('Content-Type', 'application/javascript'); response.end(bundles[request.url]); return }
  if (request.url.startsWith('/api/')) {
    response.setHeader('Content-Type', 'application/json')
    if (request.url.endsWith('/consultant-review')) { response.end(JSON.stringify({ order: null })); return }
    const key = request.url.split('/').at(-1)
    if (!responses[key]) { response.writeHead(404); response.end('{}'); return }
    if (request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk
      const input = JSON.parse(body); writes.push({ key, input })
      if (key !== 'action-types') { response.writeHead(400); response.end('{}'); return }
      const saved = input.id ? actions.find(item => item.id === input.id) : { id: `copy-${actions.length}` }
      Object.assign(saved, input)
      if (!input.id) { saved.id = `copy-${actions.length}`; actions.push(saved) }
      response.end(JSON.stringify({ item: saved })); return
    }
    response.end(JSON.stringify(responses[key])); return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${flowCss}\n${css}</style></head><body><div id="root"></div><script src="/${request.url === '/flow' ? 'flow' : 'board'}.js"></script></body></html>`)
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
let browser, page
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  page = await browser.newPage()
  const origin = `http://127.0.0.1:${server.address().port}`, errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  await page.setRequestInterception(true)
  page.on('request', request => request.url().startsWith(origin) ? request.continue() : request.abort())
  for (const width of [1440, 1024, 390]) {
    await page.setViewport({ width, height: 1000 })
    await page.goto(origin, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => sessionStorage.getItem('board-fixture'))
    await page.evaluate(() => {
      const item = JSON.parse(sessionStorage.getItem('board-fixture'))
      item.actionTypes = [{ label: 'Riva vägg' }, { label: 'Elinstallationer' }, { label: 'Riva vägg' }]
      item.checks = { affectsStructure: true, affectsElectrical: true, affectsWetRoom: true }
      sessionStorage.setItem('board-fixture', JSON.stringify(item))
    })
    await page.reload({ waitUntil: 'networkidle0' })
    const summary = await page.$('::-p-xpath(//article[.//h2[text()="Ärendesammanfattning"]])')
    const text = await summary.evaluate(element => element.textContent)
    assert.doesNotMatch(text, /Kan påverka|Berör våtrum/)
    const labels = await summary.$$eval('h3 + div > div > span:last-child', elements => elements.map(element => element.textContent))
    assert.deepEqual(labels, ['Riva vägg', 'Elinstallationer'])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await summary.screenshot({ path: resolve(output, `summary-${width}.png`) })
    await page.evaluate(() => sessionStorage.removeItem('board-fixture'))
    console.log(`PASS summary ${width}px: selected titles only, deduplicated, old flags ignored`)
  }
  await page.setViewport({ width: 1440, height: 1000 })
  await page.goto(`${origin}/flow`, { waitUntil: 'networkidle0' })
  await page.locator('[data-flow-id="action-type:electrical"] button[aria-label^="Öppna "]').click()
  await page.waitForSelector('aside')
  await page.locator('::-p-xpath(//aside//button[normalize-space(.)="Redigera"])').click()
  await page.waitForSelector('aside input[type="checkbox"]')
  assert.equal((await page.$$('aside input[type="checkbox"]')).length, 1)
  assert.doesNotMatch(await page.$eval('aside', node => node.textContent), /Berör|Endast ytskikt|Teknisk klassning/)
  assert.equal(await page.$eval('aside select', node => node.value), 'medium')
  await page.locator('::-p-xpath(//aside//button[normalize-space(.)="Översikt"])').click()
  assert.doesNotMatch(await page.$eval('aside', node => node.textContent), /Teknisk klassning/)
  await page.locator('::-p-xpath(//aside//button[normalize-space(.)="Redigera"])').click()
  await page.$eval('aside', node => { node.querySelector('input').focus() })
  await page.locator('aside input').fill('Elinstallationer uppdaterad')
  await page.locator('::-p-xpath(//aside//button[normalize-space(.)="Spara"])').click()
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Elinstallationer uppdaterad'))
  await page.locator('::-p-xpath(//aside//button[normalize-space(.)="Stäng"])').click()
  await page.waitForSelector('aside', { hidden: true })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].input.riskLevel, 'medium')
  assert.equal(writes[0].input.contractorRequirement, 'authorized_electrician')
  assert.ok(Object.keys(writes[0].input).every(key => !key.startsWith('implies')))
  assert.match(await page.$eval('body', node => node.textContent), /Eldokumentation/)
  assert.match(await page.$eval('body', node => node.textContent), /Elinstallationsforetag/)
  await page.locator('[data-flow-id="action-type:electrical"] button[aria-label^="Öppna "]').click()
  await page.locator('::-p-xpath(//aside//button[normalize-space(.)="Redigera"])').click()
  await page.screenshot({ path: resolve(output, 'admin-1440.png') })
  await page.locator('::-p-xpath(//aside//button[normalize-space(.)="Skapa kopia"])').click()
  await page.waitForFunction(() => !document.querySelector('aside'))
  assert.equal(writes.length, 2)
  assert.ok(Object.keys(writes[1].input).every(key => !key.startsWith('implies')))
  assert.equal(writes[1].input.contractorRequirement, 'authorized_electrician')
  assert.deepEqual(errors, [])
  console.log('PASS admin: no classification controls, save/copy omit retired fields, risk and linked requirements preserved')
} catch (error) {
  await page?.screenshot({ path: resolve(output, 'failure.png'), fullPage: true })
  throw error
} finally {
  await browser?.close()
  await new Promise(done => server.close(done))
}
