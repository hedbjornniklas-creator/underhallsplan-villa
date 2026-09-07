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
const output = resolve('tmp/renoapp-completion-ui')
await mkdir(output, { recursive: true })
await new Promise((resolveBuild, reject) => webpack({
  mode: 'development', devtool: false,
  entry: { view: resolve('test/fixtures/renoapp-completion-view.tsx'), applicant: resolve('test/fixtures/renoapp-completion-applicant.tsx') },
  output: { path: output, filename: '[name].js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src'), 'next/navigation': resolve('test/fixtures/renoapp-navigation.ts') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString('errors-only'))) : resolveBuild()))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const js = await readFile(resolve(output, 'view.js'))
const applicantJs = await readFile(resolve(output, 'applicant.js'))
const server = createServer((request, response) => {
  if (request.url === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  if (request.url === '/applicant.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(applicantJs); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/${request.url === '/applicant' ? 'applicant' : 'view'}.js"></script></body></html>`)
})
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
let browser
let page
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  for (const width of [1440, 1024, 390]) {
    await page.setViewport({ width, height: 1000 })
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('a[href$="?view=1"]')
    const historyToggle = page.locator('::-p-xpath(//button[contains(., "Visa historik") or contains(., "Dölj historik")])')
    assert.equal(await historyToggle.map(button => button.getAttribute('aria-expanded')).wait(), 'false')
    assert.equal(await historyToggle.map(button => document.getElementById(button.getAttribute('aria-controls')).getClientRects().length).wait(), 0)
    await historyToggle.click()
    assert.equal(await historyToggle.map(button => button.getAttribute('aria-expanded')).wait(), 'true')
    assert.equal(await historyToggle.map(button => document.getElementById(button.getAttribute('aria-controls')).querySelectorAll('li').length).wait(), 2)
    const historyCard = await page.$('::-p-xpath(//article[.//h2[text()="Ärendehistorik"]])')
    await historyCard.screenshot({ path: resolve(output, `history-expanded-${width}.png`) })
    await historyToggle.click()
    assert.equal(await historyToggle.map(button => document.getElementById(button.getAttribute('aria-controls')).getClientRects().length).wait(), 0)
    await historyCard.screenshot({ path: resolve(output, `history-collapsed-${width}.png`) })
    const layout = await page.evaluate(() => {
      const open = document.querySelector('a[href$="?view=1"]')
      const status = open.parentElement.querySelector('p')
      const row = open.closest('[data-requirement-id]')
      const choices = row.querySelector('fieldset')
      const info = row.querySelector('button[title="Visa granskningsstöd"]')
      const heading = info.parentElement
      const a = open.getBoundingClientRect(), b = status.getBoundingClientRect()
      return { overflow: document.documentElement.scrollWidth > window.innerWidth,
        grouped: a.top >= b.bottom && a.top - b.bottom < 90, aligned: Math.abs(a.left - b.left) < 1,
        infoAtHeading: heading.textContent.includes('Utlåtande från byggnadskonstruktör') && info.querySelector('svg').getBoundingClientRect().width === 15,
        leftIndicator: row.firstElementChild.getBoundingClientRect().right < heading.getBoundingClientRect().left,
        columnOrder: window.innerWidth < 1024 || heading.getBoundingClientRect().right <= choices.getBoundingClientRect().left && choices.getBoundingClientRect().right <= a.left,
      }
    })
    assert.deepEqual(layout, { overflow: false, grouped: true, aligned: true, infoAtHeading: true, leftIndicator: true, columnOrder: true }, `${width}px layout`)
    await page.locator('[data-requirement-id="document:drawing-type"] button[title="Visa granskningsstöd"]').click()
    await page.waitForSelector('[role="dialog"]')
    await page.keyboard.press('Escape')
    assert.equal(await page.$('[role="dialog"]'), null)
    await page.locator('button[aria-expanded="false"]').filter(button => button.textContent.includes('Visa företagsuppgifter')).click()
    assert.equal(await page.locator('button[aria-expanded="true"]').filter(button => button.textContent.includes('Dölj företagsuppgifter')).wait().then(() => true), true)
    await page.locator('summary').filter(element => element.textContent.includes('Fler filer')).click()
    assert.ok(await page.$('a[href*="old-drawing"]'))
    assert.doesNotMatch(await page.$eval('body', element => element.textContent), /Begär rättelse/)
    const choose = (id, value) => page.locator(`[data-requirement-id="${id}"] input[value="${value}"]`).click()
    await choose('document:drawing-type', 'not_requested')
    await choose('document:drawing-type', 'requested')
    assert.equal(await page.$('[role="status"]'), null)
    await page.evaluate(() => Array.from(document.querySelectorAll('h2,h3')).find(el => el.textContent === 'Föreslagna underlag')?.scrollIntoView())
    await page.screenshot({ path: resolve(output, `board-${width}.png`) })
    await choose('document:plumber-certificate', 'requested')
    await page.waitForSelector('[role="status"]')
    assert.match(await page.$eval('[role="status"]', node => node.textContent), /Begäran om komplettering behöver skickas igen/)
    await choose('document:plumber-certificate', 'not_requested')
    assert.equal(await page.$('[role="status"]'), null)
    await page.evaluate(() => {
      document.querySelector('[data-requirement-id="document:plumber-certificate"] input[value="requested"]').click()
      document.querySelector('[data-requirement-id="participant:builder"] input[value="requested"]').click()
    })
    await page.waitForFunction(() => document.querySelectorAll('[role="status"]').length === 2)
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('board-fixture')).underlag.filter(row => row.requirementDecision === 'requested').length === 4)
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('board-fixture')).completion.id), 'round-1')
    await page.reload({ waitUntil: 'networkidle0' })
    assert.equal((await page.$$('[role="status"]')).length, 2)
    assert.equal((await page.$$('[data-requirement-id="document:plumber-certificate"] input:checked')).length, 1)
    await page.locator('a[href="#board-decision"]').click()
    assert.equal(await page.$eval('input[name="board-decision"][value="need_info"]', input => input.checked), true)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(() => document.querySelectorAll('[role="status"]').length === 0)
    assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('board-fixture')).completion.items.map(row => row.id)), ['document:plumber-certificate', 'participant:builder'])
    assert.ok(await page.$('a[href*="drawing?view=1"]'))
    if (width === 390) {
      for (const count of [0, 1, 6]) {
        await page.evaluate(count => {
          const fixture = JSON.parse(sessionStorage.getItem('board-fixture'))
          fixture.messages = Array.from({ length: count }, (_, index) => ({
            id: `message-${index}`, type: 'applicant_reply', authorRole: 'applicant', authorName: 'Testperson',
            message: `Submitted message ${index}`, createdAt: '2026-09-07',
          }))
          sessionStorage.setItem('board-fixture', JSON.stringify(fixture))
        }, count)
        await page.reload({ waitUntil: 'networkidle0' })
        assert.equal(await historyToggle.map(button => button.getAttribute('aria-expanded')).wait(), 'false')
        await historyToggle.click()
        assert.equal(await historyToggle.map(button => document.getElementById(button.getAttribute('aria-controls')).querySelectorAll('li').length).wait(), count)
        if (count === 0) assert.match(await historyToggle.map(button => document.getElementById(button.getAttribute('aria-controls')).textContent).wait(), /Inga skickade meddelanden/)
      }
    }
    await page.evaluate(() => sessionStorage.removeItem('board-fixture'))
    console.log(`PASS ${width}px: indicator, heading info, exclusive square choices, right-aligned files, expansion warning/undo/reload/send and preserved documents`)
  }
  await page.setViewport({ width: 1440, height: 1000 })
  await page.goto(`http://127.0.0.1:${server.address().port}/applicant`, { waitUntil: 'networkidle0' })
  const company = page.locator('input').filter(input => input.value === 'Original plumber')
  await company.fill('Changed plumber')
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('completion-fixture')).form.participantEntries[0].companyName === 'Changed plumber')
  await page.reload({ waitUntil: 'networkidle0' })
  assert.equal(await page.locator('input').filter(input => input.value === 'Changed plumber').wait().then(() => true), true)
  await page.locator('::-p-xpath(//button[contains(., "Granska och skicka")])').click()
  await page.locator('::-p-xpath(//button[normalize-space(.)="Skicka komplettering"])').click()
  await page.waitForFunction(() => document.body.textContent.includes('Bekräfta båda rutorna'))
  const confirmations = await page.$$('input[type="checkbox"]')
  for (const checkbox of confirmations) await checkbox.click()
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('completion-fixture')).form.participantEntries[0].acceptsResponsibility === true)
  await page.locator('::-p-xpath(//button[contains(., "Granska och skicka")])').click()
  await page.locator('textarea').fill('New reply after reopening')
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('completion-fixture')).completionDraft.replyMessage === 'New reply after reopening')
  await page.locator('::-p-xpath(//button[normalize-space(.)="Skicka komplettering"])').click()
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('completion-fixture')).case.status === 'review')
  const submitted = await page.evaluate(() => JSON.parse(sessionStorage.getItem('completion-last-request')))
  assert.equal(submitted.completionRequestId, 'round-2')
  assert.ok(submitted.completionRevision > 0)
  assert.equal(submitted.description, 'Original renovation')
  assert.equal(submitted.replyMessage, 'New reply after reopening')
  await page.waitForSelector('textarea', { hidden: true })
  console.log('PASS applicant: autosave/reopen, required confirmations, revision on submit and locked base fields')
  await page.evaluate(() => { const draft = JSON.parse(sessionStorage.getItem('completion-fixture')); draft.case.status = 'need_info'; sessionStorage.setItem('completion-fixture', JSON.stringify(draft)); sessionStorage.setItem('completion-conflict', '1') })
  await page.reload({ waitUntil: 'networkidle0' })
  await page.locator('input').filter(input => input.value === 'Changed plumber').fill('Stale edit')
  await page.waitForFunction(() => document.body.textContent.includes('annan flik'))
  await page.locator('::-p-xpath(//button[contains(., "Granska och skicka")])').click()
  assert.equal(await page.locator('::-p-xpath(//button[normalize-space(.)="Skicka komplettering"])').map(button => button.disabled).wait(), true)
  console.log('PASS applicant: stale revision blocks further submissions and asks for reload')
  assert.deepEqual(errors, [])
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true })
    console.error(await page.evaluate(() => ({ buttons: Array.from(document.querySelectorAll('button')).map(button => ({ text: button.textContent, disabled: button.disabled })), body: document.body.textContent.slice(-3000) })))
  }
  throw error
} finally {
  await browser?.close()
  await new Promise(resolveClose => server.close(resolveClose))
}
