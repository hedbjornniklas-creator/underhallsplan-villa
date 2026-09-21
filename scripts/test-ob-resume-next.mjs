import assert from 'node:assert/strict'
import { cp, mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const root = process.cwd(), output = resolve('tmp/ob-resume-next')
await mkdir(output, { recursive: true })
await cp(resolve('test/fixtures/ob-resume-next'), output, { recursive: true })
await mkdir(resolve(output, 'public/report-assets'), { recursive: true })
await cp(resolve('public/report-assets/BesiktApp.png'), resolve(output, 'public/report-assets/BesiktApp.png'))
await cp(resolve('public/landing/Background1.png'), resolve(output, 'public/photo.png'))
await cp(resolve('public/ob/brand'), resolve(output, 'public/ob/brand'), { recursive: true })
const socket = createServer()
await new Promise(ok => socket.listen(0, '127.0.0.1', ok))
const port = socket.address().port
await new Promise(ok => socket.close(ok))
const base = `http://127.0.0.1:${port}`
const options = { windowsHide: true, env: { ...process.env, OB_RESUME_REPO_ROOT: root, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }
console.log('Building isolated Next router fixture (synthetic data only)...')
if (!process.argv.includes('--skip-build')) await new Promise((ok, fail) => {
  const build = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'build', output, '--webpack'], options)
  let log = ''
  build.stdout.on('data', chunk => { log += chunk })
  build.stderr.on('data', chunk => { log += chunk })
  build.on('error', fail)
  build.on('exit', code => code === 0 ? ok() : fail(Error(log)))
})
const server = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', output, '--hostname', '127.0.0.1', '--port', String(port)], options)
let log = '', browser, page
server.stdout.on('data', chunk => { log += chunk })
server.stderr.on('data', chunk => { log += chunk })
try {
  const deadline = Date.now() + 90000
  while (true) {
    try { if ((await fetch(`${base}/inspections`)).ok) break } catch {}
    if (Date.now() > deadline || server.exitCode !== null) throw Error(`Next fixture did not start: ${log}`)
    await new Promise(ok => setTimeout(ok, 300))
  }
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  page = await browser.newPage()
  const errors = [], external = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (new URL(request.url()).origin === base || request.url().startsWith('blob:')) void request.continue()
    else { external.push(request.url()); void request.abort() }
  })
  const waitSection = key => page.waitForSelector(`[data-selected-ob-section="${key}"]`)
  async function tab(label) {
    for (const button of await page.$$('.obm-bottom-nav button')) {
      if (await button.evaluate((el, name) => el.textContent.includes(name), label)) {
        await button.click()
        return
      }
    }
    assert.fail(`Missing round tab: ${label}`)
  }
  async function select(label) {
    if (await page.$('.obm-room-header')) await tab('Att bearbeta')
    await page.evaluate(() => [...document.querySelectorAll('button[aria-label="Öppna stegmeny"]')].find(el => el.getBoundingClientRect().width > 0).click())
    await page.waitForSelector('dialog[open]')
    await page.click(`.obm-menu-step[aria-label="${label}"]`)
  }
  await page.goto(`${base}/inspections`)
  await page.click('a')
  await waitSection('grunddata')
  await select('ÖB-runda · Gästhus')
  await page.waitForSelector('.obm-place-row')
  await page.click('.obm-place-row')
  await page.waitForSelector('.obm-room-header')
  await page.waitForFunction(() => Boolean(history.state?.__obRoundBack))
  const owner = await page.evaluate(() => history.state.__obRoundBack.owner)
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.obm-room-header')
  assert.equal(await page.evaluate(() => history.state.__obRoundBack.owner), owner, 'reload adopts the same room history boundary')
  assert.match(await page.$eval('.obm-root', el => el.textContent), /Gästhus/)
  await page.evaluate(() => history.back())
  await page.waitForSelector('[data-view="places"]')
  await select('Förutsättningar · Gästhus')
  await waitSection('forutsattningar')
  await page.reload({ waitUntil: 'networkidle0' })
  assert.equal(await page.$eval('[data-selected-ob-section]', el => el.dataset.buildingId), 'guest')
  await select('ÖB-runda · Huvudbyggnad')
  await page.waitForSelector('.obm-place-row')
  await page.click('.obm-place-row')
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.obm-room-header')
  assert.match(await page.$eval('.obm-root', el => el.textContent), /Huvudbyggnad/)
  assert.doesNotMatch(await page.$eval('.obm-root', el => el.textContent), /Gästhus/)
  await page.evaluate(() => history.back())
  await page.waitForFunction(() => document.querySelector('[data-view="places"]') && !history.state?.__obRoundBack)
  for (let i = 0; i < 3; i++) {
    console.log(`Next router: menu re-entry ${i + 1}`)
    await select('ÖB-runda · Gästhus')
    await page.waitForSelector('.obm-root nav')
    await tab('Platser')
    await page.waitForSelector('.obm-place-row')
    await page.click('.obm-place-row')
    await page.waitForSelector('.obm-room-header')
    await select('Fastighet & uppdrag')
    await waitSection('grunddata')
    await page.waitForFunction(() => !history.state?.__obRoundBack)
  }
  await select('ÖB-runda · Gästhus')
  await page.waitForSelector('[data-view="pending"]')
  await tab('Platser')
  await page.click('.obm-place-row')
  await page.waitForSelector('.obm-room-header')
  console.log('Next router: return from background and Back')
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pageshow'))
    window.dispatchEvent(new Event('focus'))
  })
  await page.waitForSelector('.obm-room-header')
  await page.evaluate(() => history.back())
  await page.waitForFunction(() => document.querySelector('[data-view="places"]') && !history.state?.__obRoundBack)
  await page.evaluate(() => history.back())
  await page.waitForSelector('a[href*="synthetic-mobile-inspection"]')
  console.log('Next router: root exit confirmed')
  assert.equal(new URL(page.url()).pathname, '/inspections', 'root Back exits via the actual Next router')
  await page.click('a')
  await page.waitForSelector('[data-view="places"]')
  assert.match(await page.$eval('.obm-root', el => el.textContent), /Gästhus/)
  console.log('Next router: internal step changes with a retained local draft')
  await select('Fastighet & uppdrag')
  await waitSection('grunddata')
  const draftKey = 'ob:text-draft:v1:ob:synthetic-mobile-inspection:handlingar:retained'
  const draftValue = JSON.stringify({ value: 'Retained synthetic local text' })
  await page.evaluate((key, value) => localStorage.setItem(key, value), draftKey, draftValue)
  const acceptFixtureReload = dialog => void dialog.accept()
  page.on('dialog', acceptFixtureReload)
  await page.reload({ waitUntil: 'networkidle0' })
  page.off('dialog', acceptFixtureReload)
  await waitSection('grunddata')
  await page.waitForFunction(() => history.state?.obTextDraftGuard === true)
  const unexpectedDialogs = [], documentRequests = []
  const onDialog = dialog => { unexpectedDialogs.push(dialog.type()); void dialog.dismiss() }
  const onRequest = request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests.push(request.url()) }
  page.on('dialog', onDialog)
  page.on('request', onRequest)
  for (let i = 0; i < 3; i++) {
    await select('ÖB-runda · Huvudbyggnad')
    await page.waitForSelector('.obm-root nav')
    await tab('Platser')
    await page.waitForSelector('.obm-place-row')
    await page.click('.obm-place-row')
    await page.waitForSelector('.obm-room-header')
    await select('Fastighet & uppdrag')
    await waitSection('grunddata')
    await page.waitForFunction(() => !history.state?.__obRoundBack)
  }
  assert.equal(await page.evaluate(key => localStorage.getItem(key), draftKey), draftValue)
  assert.deepEqual(unexpectedDialogs, [], 'Internal navigation must not trigger leave/reload dialogs')
  assert.deepEqual(documentRequests, [], 'Internal navigation must not reload the document')
  page.off('dialog', onDialog)
  page.off('request', onRequest)
  assert.deepEqual(external, [])
  assert.deepEqual(errors, [])
  console.log('PASS: real Next router, multi-building round/conditions reload, room Back, repeated menu re-entry, return events, root exit, inspection re-entry and retained drafts across reload/internal navigation. No external requests.')
} catch (error) {
  if (page) {
    console.error('Failure page:', page.url(), await page.$eval('body', el => el.innerText))
    await page.screenshot({ path: resolve(output, 'failure.png') })
  }
  console.error(log)
  throw error
} finally {
  await browser?.close()
  if (server.exitCode === null) {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else server.kill('SIGTERM')
  }
}
