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
    const layout = await page.evaluate(() => {
      const open = document.querySelector('a[href$="?view=1"]')
      const status = open.parentElement.querySelector('p')
      const a = open.getBoundingClientRect(), b = status.getBoundingClientRect()
      return { overflow: document.documentElement.scrollWidth > window.innerWidth,
        grouped: a.top >= b.bottom && a.top - b.bottom < 16, aligned: Math.abs(a.left - b.left) < 1 }
    })
    assert.deepEqual(layout, { overflow: false, grouped: true, aligned: true }, `${width}px layout`)
    await page.locator('button[aria-expanded="false"]').filter(button => button.textContent.includes('Visa företagsuppgifter')).click()
    assert.equal(await page.locator('button[aria-expanded="true"]').filter(button => button.textContent.includes('Dölj företagsuppgifter')).wait().then(() => true), true)
    await page.locator('summary').filter(element => element.textContent.includes('Fler filer')).click()
    assert.ok(await page.$('a[href*="old-drawing"]'))
    await page.locator('label').filter(label => label.textContent.includes('Begär rättelse')).click()
    assert.match(await page.$eval('body', element => element.textContent), /rättelse begärd/)
    await page.evaluate(() => Array.from(document.querySelectorAll('h2,h3')).find(el => el.textContent === 'Föreslagna underlag')?.scrollIntoView())
    await page.screenshot({ path: resolve(output, `board-${width}.png`) })
    console.log(`PASS ${width}px: status/open alignment, no page overflow, company expansion, older files and correction preview`)
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
  assert.equal(await page.$('textarea'), null)
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
