// Runs production UI components with synthetic data; blocks all external traffic.
import assert from 'node:assert/strict'
import { readFile, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = await mkdtemp(join(tmpdir(), 'organization-administration-ui-'))
const mock = resolve('test/fixtures/organization-admin-ui-mocks.tsx')
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/organization-admin-ui.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { 'next/link$': mock, 'next/navigation$': mock, '@/lib/supabaseClient$': mock, '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? new Error(stats.toString('errors-only'))) : ok()))
const script = await readFile(join(output, 'view.js'))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
// The real invitation route inherits these component styles from PublicFrame.
const publicCss = await readFile('src/components/public/public.css', 'utf8')
const server = createServer((request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'")
  response.setHeader('Content-Type', request.url === '/view.js' ? 'application/javascript' : 'text/html; charset=utf-8')
  const query = new URL(request.url, 'http://127.0.0.1').searchParams
  const invitationCss = query.has('invite') || query.has('invitation') ? publicCss : ''
  response.end(request.url === '/view.js' ? script : `<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n${invitationCss}</style></head><body><div id="root" style="max-width:1152px;margin:24px auto;padding:16px"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
if (process.argv.includes('--serve-only')) {
  console.log(`Synthetic organization UI: http://127.0.0.1:${server.address().port}/?both`)
  console.log('Modes: ?ob-only, ?both, ?no-modules, ?invitation&ob-only#invite=<64 lowercase a characters>. No external API traffic or real writes.')
  await new Promise(() => {})
}
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const url = `http://127.0.0.1:${server.address().port}`
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => { void (request.url().startsWith(url) ? request.continue() : request.abort()) })
  async function open(query = '') { await page.goto(`${url}/${query}`); await page.waitForSelector('h1') }
  async function button(label) {
    const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text), label)
    assert.ok(await handle.evaluate(node => Boolean(node)), `Button: ${label}`)
    await handle.asElement().click(); await handle.dispose()
  }
  async function field(label, value) {
    const handle = await page.evaluateHandle(text => [...document.querySelectorAll('label')].find(node => node.firstChild?.textContent.trim() === text)?.querySelector('input'), label)
    assert.ok(await handle.evaluate(node => Boolean(node)), `Input: ${label}`)
    await handle.asElement().click({ clickCount: 3 }); await handle.asElement().type(value); await handle.dispose()
  }
  async function checkbox(label, selector = 'form') {
    const handle = await page.evaluateHandle((text, scope) => [...document.querySelectorAll(`${scope} label`)].find(node => node.textContent.trim() === text)?.querySelector('input[type="checkbox"]'), label, selector)
    assert.ok(await handle.evaluate(node => Boolean(node)), `Checkbox: ${label}`)
    await handle.asElement().click(); await handle.dispose()
  }
  const calls = () => page.evaluate(() => window.organizationUiCalls)

  await open()
  await field('Företagsnamn', 'BBSAB uppdaterat')
  page.once('dialog', dialog => dialog.dismiss())
  const switchAllowed = await page.evaluate(() => window.dispatchEvent(new CustomEvent('hushub:before-organization-switch', { cancelable: true, detail: {} })))
  assert.equal(switchAllowed, false, 'Cancelling unsaved changes blocks organisation switch')
  await button('Spara företagsuppgifter')
  await page.waitForFunction(() => document.body.textContent.includes('Organisationens uppgifter har sparats.'))
  const saved = (await calls()).find(call => call.url === '/api/organizations/profile')
  assert.equal(saved.body.orgId, '00000000-0000-4000-8000-000000000001')
  assert.equal(saved.body.expectedVersion, 4)
  assert.equal(saved.body.profile.name, 'BBSAB uppdaterat')
  console.log('PASS profile save is scoped and unsaved switching is cancellable')

  await open('?conflict')
  await field('Företagsnamn', 'Mitt osparade namn')
  await button('Spara företagsuppgifter')
  await page.waitForSelector('[role="alert"]')
  assert.equal(await page.$eval('input', input => input.type), 'file')
  assert.ok(await page.$$eval('input', nodes => nodes.some(input => input.value === 'Mitt osparade namn')), 'Conflicting save retains edit')
  console.log('PASS conflicting edits remain available')

  page.once('dialog', dialog => dialog.accept())
  await open('?member')
  assert.equal(await page.$$eval('button', nodes => nodes.some(node => node.textContent.trim() === 'Medlemmar')), false)
  assert.ok(await page.$$eval('input,textarea', nodes => nodes.every(node => node.disabled)), 'Member cannot edit company profile')
  assert.equal((await calls()).length, 0, 'Member view does not fetch administrator data')
  console.log('PASS member has readonly company profile without member management')

  await open('?migration')
  assert.ok(await page.$$eval('input,textarea', nodes => nodes.every(node => node.disabled)), 'Migration gate disables company edits')
  await button('Medlemmar')
  assert.equal((await calls()).length, 0, 'Migration gate does not fetch member data')
  console.log('PASS migration gate is read only')

  await open('?unconfigured')
  await button('Spara företagsuppgifter')
  await page.waitForFunction(() => document.body.textContent.includes('Organisationens uppgifter har sparats.'))
  assert.equal((await calls()).find(call => call.url === '/api/organizations/profile').body.expectedVersion, 4)
  console.log('PASS initial profile can be confirmed without changing correct prefilled values')

  await open()
  await button('Medlemmar')
  await page.waitForFunction(() => document.body.textContent.includes('Niklas Test'))
  await field('Namn', 'Ny Kollega')
  await field('E-post', 'new@example.test')
  await button('Skicka inbjudan')
  await page.waitForFunction(() => document.body.textContent.includes('Inbjudan skickad.'))
  const sent = (await calls()).find(call => call.url === '/api/organizations/invitations')
  assert.equal(sent.body.role, 'inspector')
  assert.deepEqual(sent.body.modules, ['technical_investigations'])
  assert.equal(sent.body.orgId, '00000000-0000-4000-8000-000000000001')
  assert.equal(sent.body.moduleSetVersion, 2)
  console.log('PASS invitation defaults to organisation-scoped member with TU only')

  await field('Namn', 'Administrativ kollega')
  await field('E-post', 'admin@example.test')
  await page.select('form select', 'admin')
  await checkbox('TU – teknisk utredning')
  await button('Skicka inbjudan')
  await page.waitForFunction(() => window.organizationUiCalls.filter(call => call.url === '/api/organizations/invitations').length === 2)
  const adminSent = (await calls()).filter(call => call.url === '/api/organizations/invitations').at(-1)
  assert.equal(adminSent.body.role, 'admin')
  assert.deepEqual(adminSent.body.modules, [])
  console.log('PASS administrator can be invited without an operational module')

  await open('?ob-only')
  await button('Medlemmar')
  await page.waitForFunction(() => document.body.textContent.includes('Niklas Test'))
  await field('Namn', 'ÖB Kollega')
  await field('E-post', 'ob@example.test')
  assert.ok(await page.$$eval('button', nodes => nodes.find(node => node.textContent.trim() === 'Skicka inbjudan').disabled), 'OB must be explicitly selected')
  await checkbox('ÖB – överlåtelsebesiktning')
  await button('Skicka inbjudan')
  await page.waitForFunction(() => document.body.textContent.includes('Inbjudan skickad.'))
  assert.deepEqual((await calls()).find(call => call.url === '/api/organizations/invitations').body.modules, ['inspections'])
  console.log('PASS OB-only invitation requires explicit enabled OB selection')

  await open('?both')
  await button('Medlemmar')
  await page.waitForFunction(() => document.body.textContent.includes('Niklas Test'))
  await field('Namn', 'Två områden')
  await field('E-post', 'both@example.test')
  await checkbox('ÖB – överlåtelsebesiktning')
  await button('Skicka inbjudan')
  await page.waitForFunction(() => document.body.textContent.includes('Inbjudan skickad.'))
  assert.deepEqual((await calls()).find(call => call.url === '/api/organizations/invitations').body.modules, ['inspections', 'technical_investigations'])
  console.log('PASS OB and TU can be invited together without administrator role')

  await open()
  await button('Integrationer')
  await page.waitForFunction(() => document.body.textContent.includes('Ingen Fortnox-anslutning finns för BBSAB'))
  assert.equal(await page.$eval('input[name="orgId"]', node => node.value), '00000000-0000-4000-8000-000000000001')
  assert.equal(await page.$$eval('select', nodes => nodes.length), 0, 'Embedded Fortnox cannot switch organisation independently')
  console.log('PASS Fortnox uses the selected BBSAB organisation although SVEA is default')

  const token = 'a'.repeat(64)
  await open(`?invite#invite=${token}`)
  await page.waitForSelector('input[type="password"]')
  assert.equal(await page.evaluate(() => location.hash), '', 'Token is removed from the address')
  assert.equal(await page.evaluate(() => sessionStorage.getItem('hushub:organization-invitation')), token)
  await page.reload()
  await page.waitForSelector('input[type="password"]')
  await page.type('input[type="password"]', 'test-password-123')
  await button('Acceptera inbjudan')
  await page.waitForFunction(() => document.body.textContent.includes('Ditt medlemskap i BBSAB är aktivt.'))
  assert.equal(await page.evaluate(() => sessionStorage.getItem('hushub:organization-invitation')), null)
  assert.ok(await page.$$eval('a', nodes => nodes.some(node => node.getAttribute('href') === '/settings/profil?orgId=00000000-0000-4000-8000-000000000001')))
  console.log('PASS invitation survives login navigation and clears token on acceptance')

  for (const [query, expectedPaths] of [['ob-only', ['/ob?']], ['both', ['/ob?', '/tu?']]]) {
    await open(`?invite&${query}#invite=${token}`)
    await page.waitForSelector('input[type="password"]')
    await page.type('input[type="password"]', 'test-password-123')
    await button('Acceptera inbjudan')
    await page.waitForFunction(() => document.body.textContent.includes('Ditt medlemskap i BBSAB är aktivt.'))
    const paths = await page.$$eval('a', nodes => nodes.map(node => node.getAttribute('href')).filter(href => /^\/(?:ob|tu)\?/.test(href)).map(href => href.split('orgId=')[0]))
    assert.deepEqual(paths, expectedPaths)
  }
  console.log('PASS accepted OB-only and mixed invitations link to the invited modules')

  await open(`?invite&wrong-user#invite=${token}`)
  await page.waitForFunction(() => document.body.textContent.includes('Du är inloggad som other@example.test'))
  assert.equal(await page.$$eval('button', nodes => nodes.some(node => node.textContent.trim() === 'Acceptera inbjudan')), false)
  await button('Logga ut och byt konto')
  await page.waitForSelector('input[type="password"]')
  console.log('PASS mismatched account must switch before accepting')

  await open(`?invite&admin-only#invite=${token}`)
  await page.waitForSelector('input[type="password"]')
  await page.type('input[type="password"]', 'test-password-123')
  await button('Acceptera inbjudan')
  await page.waitForFunction(() => document.body.textContent.includes('Ditt medlemskap i BBSAB är aktivt.'))
  assert.equal(await page.$$eval('a', nodes => nodes.some(node => node.getAttribute('href')?.startsWith('/tu?'))), false)
  assert.ok(await page.$$eval('a', nodes => nodes.some(node => node.getAttribute('href') === '/settings/organisation?orgId=00000000-0000-4000-8000-000000000001')))
  console.log('PASS admin-only invitation leads to organisation management without a TU link')

  await page.setViewport({ width: 1440, height: 1100 })
  await open()
  await page.screenshot({ path: join(output, 'organization-desktop.png'), fullPage: true })
  await button('Medlemmar')
  await page.waitForFunction(() => document.body.textContent.includes('Niklas Test'))
  await page.screenshot({ path: join(output, 'members-desktop.png'), fullPage: true })
  await page.setViewport({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'members-mobile.png'), fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Member UI fits narrow screen')
  assert.deepEqual(errors, [])
  console.log(`15 UI scenarios passed; no external API traffic or customer writes. Screenshots: ${output}`)
} finally {
  if (browser) await browser.close()
  await new Promise(ok => server.close(ok))
}
