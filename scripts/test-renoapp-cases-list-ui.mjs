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
const output = resolve('tmp/renoapp-cases-list-ui')
await mkdir(output, { recursive: true })
await new Promise((done, reject) => webpack({
  mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/renoapp-cases-list.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { 'next/navigation': resolve('test/fixtures/renoapp-navigation.ts') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString('errors-only'))) : done()))
const { css: baseCss } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const css = baseCss + await readFile('src/components/renoapp/renoapp-theme.css', 'utf8')
const font = await readFile('public/renoapp/brand/manrope.ttf')
const js = await readFile(resolve(output, 'view.js'))
const server = createServer((request, response) => {
  if (request.url === '/renoapp/brand/manrope.ttf') { response.setHeader('Content-Type', 'font/ttf'); response.end(font); return }
  if (request.url === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  const rowOrder = () => page.$$eval('tbody tr', rows => rows.map(row => row.querySelector('td').textContent.trim()))
  const expected = [7, 5, 8, 2, 4, 6, 1, 3, 0].map(index => `RA-2026-0907-0${index}`)
  for (const width of [1440, 1024, 768, 390, 344, 320]) {
    await page.setViewport({ width, height: 1000 })
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('tbody tr')
    await page.evaluate(() => document.fonts.ready)
    assert.deepEqual(await rowOrder(), expected)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px overflow`)
    const mobileRows = await page.$$eval('[data-case-number]', rows => rows.map(row => row.dataset.caseNumber))
    assert.deepEqual(mobileRows, expected)
    assert.equal(await page.$eval('.reno-cases-desktop', node => getComputedStyle(node).display === 'none'), width < 1024)
    assert.equal(await page.$eval('.reno-cases-mobile', node => getComputedStyle(node).display === 'none'), width >= 1024)
    assert.equal(await page.$eval('.reno-cases-filters', node => getComputedStyle(node).display === 'none'), width < 1024)
    assert.equal(await page.$eval('.reno-cases-filter-mobile', node => getComputedStyle(node).display === 'none'), width >= 1024)
    const statuses = await page.$$eval('.reno-case-status', nodes => nodes.map(node => {
      const style = getComputedStyle(node)
      return { color: style.color, background: style.backgroundColor, border: style.borderWidth, radius: style.borderRadius, size: style.fontSize, weight: style.fontWeight }
    }))
    assert.equal(new Set(statuses.map(style => JSON.stringify(style))).size, 1, 'All status labels use identical neutral text styling')
    assert.deepEqual(statuses[0], { color: 'rgb(41, 50, 57)', background: 'rgba(0, 0, 0, 0)', border: '0px', radius: '0px', size: '14px', weight: '400' })
    const markers = await page.$$eval('tbody tr td:first-child > span', nodes => nodes.map(node => getComputedStyle(node).backgroundColor))
    assert.equal(new Set(markers).size, 6, 'All six status markers remain distinct')
    assert.equal(markers[5], markers[6], 'Approved variants share the same left marker')
    if (width >= 1024) {
      const rows = await page.$$eval('tbody tr', nodes => nodes.map(node => ({ height: node.getBoundingClientRect().height, statusX: node.querySelector('.reno-case-status').getBoundingClientRect().x })))
      assert.equal(new Set(rows.map(row => row.height)).size, 1, 'All desktop rows have equal height')
      assert.equal(new Set(rows.map(row => row.statusX)).size, 1, 'Status texts share one left alignment')
      const tabs = await page.$$eval('.reno-cases-filter', nodes => nodes.map(node => {
        const style = getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return { height: rect.height, y: rect.y, background: style.backgroundColor, color: style.color, borderBottom: style.borderBottomColor, active: node.getAttribute('aria-pressed') === 'true' }
      }))
      assert.equal(tabs.length, 7)
      assert.equal(new Set(tabs.map(tab => tab.height)).size, 1)
      assert.equal(new Set(tabs.map(tab => tab.y)).size, 1, 'Desktop filters fit a single row')
      assert.equal(tabs.filter(tab => tab.active).length, 1)
      assert.ok(tabs.every(tab => tab.background === 'rgba(0, 0, 0, 0)' && tab.height >= 44))
      assert.ok(tabs.filter(tab => !tab.active).every(tab => tab.color === 'rgb(88, 99, 109)' && tab.borderBottom === 'rgba(0, 0, 0, 0)'))
      assert.equal(tabs.find(tab => tab.active).borderBottom, 'rgb(71, 103, 134)')
      await page.focus('.reno-cases-filter')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      assert.deepEqual(await rowOrder(), expected.slice(0, 2), 'Filters work using the keyboard')
      await page.locator('.reno-cases-filter').click()
    } else {
      assert.equal(await page.$eval('#renoappCasesStatusFilter', node => node.options.length), 7)
      assert.ok(await page.$eval('.reno-cases-sort', node => {
        const controls = [...node.querySelectorAll('select,button')]
        const bounds = controls.map(control => control.getBoundingClientRect())
        const pages = document.querySelector('.reno-cases-page-size').getBoundingClientRect()
        return bounds[0].right <= bounds[1].left && bounds[1].right <= pages.left && bounds.every(bound => bound.height >= 44)
      }), 'Mobile sort and page-size controls never overlap')
      await page.select('#renoappCasesStatusFilter', 'need_info')
      assert.deepEqual(await rowOrder(), ['RA-2026-0907-04'])
      assert.ok(await page.$eval('#renoappCasesStatusFilter', select => {
        const context = document.createElement('canvas').getContext('2d')
        context.font = getComputedStyle(select).font
        return context.measureText(select.selectedOptions[0].text).width <= select.clientWidth - 36
      }), 'The longest selected status fits without truncation')
      await page.screenshot({ path: resolve(output, `filtered-${width}.png`), fullPage: true })
      await page.select('#renoappCasesStatusFilter', 'all')
      assert.deepEqual(await rowOrder(), expected)
    }
    await page.locator('button[aria-label="Vad betyder statusarna?"]').click()
    await page.waitForSelector('dialog[open]')
    assert.equal(await page.$eval('dialog', node => node.scrollWidth > node.clientWidth), false)
    await page.keyboard.press('Escape')
    await page.waitForSelector('dialog', { hidden: true })
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Vad betyder statusarna?')
    assert.match(await page.$eval('tbody', node => node.textContent), /Renoveringsansökan/)
    assert.doesNotMatch(await page.$eval('tbody', node => node.textContent), /Ã/)
    assert.ok(await page.$eval('input[aria-label="Sök ärenden"]', input => {
      const box = input.closest('section').getBoundingClientRect()
      const field = input.getBoundingClientRect()
      return field.left - box.left >= 16 && field.top - box.top >= 16
    }))
    await page.screenshot({ path: resolve(output, `list-${width}.png`), fullPage: true })
    console.log(`PASS ${width}px: neutral statuses, colored left markers, accessible filters, aligned rows and unchanged sorting`)
  }
  await page.select('#renoappCasesSort', 'submittedAt')
  assert.deepEqual(await rowOrder(), [...expected].sort().reverse())
  await page.locator('button[aria-label="Sortera stigande"]').click()
  assert.deepEqual(await rowOrder(), [...expected].sort())
  await page.locator('::-p-xpath(//button[contains(., "Rensa filter")])').click()
  await page.select('#renoappCasesStatusFilter', 'approved')
  assert.equal((await rowOrder()).length, 2, 'Both approved variants share the same filter')
  assert.equal((await page.$$('[data-case-number]')).length, 2)
  await page.reload({ waitUntil: 'networkidle0' })
  assert.equal(await page.$eval('#renoappCasesStatusFilter', node => node.value), 'approved')
  await page.setViewport({ width: 1440, height: 1000 })
  assert.equal(await page.$eval('.reno-cases-filter[aria-pressed="true"]', node => node.textContent.trim()), 'Godkänd2')
  await page.locator('::-p-xpath(//button[@aria-pressed and contains(., "Att granska")])').click()
  assert.equal((await rowOrder()).length, 2)
  await page.setViewport({ width: 344, height: 1000 })
  assert.equal(await page.$eval('#renoappCasesStatusFilter', node => node.value), 'review')
  await page.locator('::-p-xpath(//button[contains(., "Rensa filter")])').click()
  await page.locator('input[aria-label="Sök ärenden"]').fill('0907-07')
  assert.deepEqual(await rowOrder(), ['RA-2026-0907-07'])
  assert.equal(await page.$eval('[data-case-number]', node => node.getAttribute('href')), '/renoapp/app/cases/7')
  await page.locator('input[aria-label="Sök ärenden"]').fill('no match')
  await page.waitForFunction(() => document.body.textContent.includes('Inga RenoApp-ärenden'))
  await page.locator('::-p-xpath(//button[contains(., "Rensa filter")])').click()
  await page.setViewport({ width: 1440, height: 1000 })
  await page.evaluate(() => localStorage.setItem('renoapp:cases:list:view:v1', JSON.stringify({ search: '', statusFilter: 'all', sortField: 'submittedAt', sortDirection: 'desc', pageSize: 10 })))
  await page.reload({ waitUntil: 'networkidle0' })
  assert.deepEqual(await rowOrder(), expected)
  assert.equal(await page.$eval('#renoappCasesPageSize', node => node.value), '10')
  await page.locator('::-p-xpath(//button[contains(., "Ansökningsdatum")])').click()
  await page.reload({ waitUntil: 'networkidle0' })
  assert.deepEqual(await rowOrder(), [...expected].sort().reverse())
  await page.locator('::-p-xpath(//button[contains(., "Rensa filter")])').click()
  assert.deepEqual(await rowOrder(), expected)
  assert.deepEqual(errors, [])
  const source = await readFile('src/lib/renoapp/server.ts', 'utf8')
  assert.match(source, /if \(actionTypes.length === 0\) return 'Renoveringsansökan'/)
  console.log('PASS old preference migration, page-size preservation, explicit date sort persistence, reset and new default title')
} finally {
  await browser?.close()
  await new Promise(done => server.close(done))
}
