import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const ID = 'f5a870d5-2671-4ab2-977c-55fef662a880'

export async function testSessionRecovery(base, output) {
  const guardsOnly = process.argv.includes('--guards-only')
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = [], external = [], writes = [], navigations = []
  let configScript
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => {
    const url = new URL(request.url())
    if (request.method() !== 'GET') { writes.push({ method: request.method(), pathname: url.pathname }); void request.abort(); return }
    if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) { external.push(url.origin); void request.abort(); return }
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push({ url: request.url(), at: Date.now() })
    void request.continue()
  })
  async function open(path = '/dashboard-v1', config = {}) {
    if (page.url().startsWith(base)) await page.evaluate(() => sessionStorage.clear())
    // An identical URL containing a fragment may otherwise be a same-document
    // navigation, which would retain the previous synthetic SDK/configuration.
    await page.goto('about:blank')
    if (configScript) await page.removeScriptToEvaluateOnNewDocument(configScript.identifier)
    configScript = await page.evaluateOnNewDocument(value => { window.__sessionQAConfig = value }, config)
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('h1')
    assert.deepEqual(await signOutEvents(), [], 'Opening a page never signs out a session')
  }
  async function signOutEvents() { return page.evaluate(() => JSON.parse(sessionStorage.getItem('recovery-signout-events') ?? '[]')) }
  async function counters() { return page.evaluate(() => ({ ...window.__sessionRecoveryTest.counters })) }
  async function text() { return page.$eval('body', node => node.textContent) }
  async function clickButton(match) {
    for (const button of await page.$$('button')) {
      if (match.test(await button.evaluate(node => node.textContent.trim()))) { await button.click(); return }
    }
    throw Error(`Missing button matching ${match}`)
  }
  async function noOverflow(label) {
    const overflow = await page.evaluate(() => ({
      width: innerWidth, scroll: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('main,section,article,h1,p,button,a')]
        .filter(node => node.checkVisibility() && node.getBoundingClientRect().right > innerWidth + 1)
        .map(node => `${node.tagName}.${node.className}`),
    }))
    assert.ok(overflow.scroll <= overflow.width + 1, `${label}: page overflow ${JSON.stringify(overflow)}`)
    assert.deepEqual(overflow.elements, [], `${label}: element overflow`)
  }
  async function loginAgain(expectedDestination, expectedLogin = '/login') {
    const originalPath = new URL(page.url()).pathname
    const nextNavigation = page.waitForNavigation({ waitUntil: 'networkidle0' })
    await clickButton(/^Logga in igen$/)
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.disabled))
    assert.equal(new URL(page.url()).pathname, originalPath, 'Login waits for local signOut completion')
    await nextNavigation
    const login = new URL(page.url())
    assert.equal(login.origin, base)
    assert.equal(login.pathname, expectedLogin)
    assert.equal(login.searchParams.get('next'), expectedDestination)
    const successful = await signOutEvents()
    assert.deepEqual(successful.map(event => [event.phase, event.scope]), [['started', 'local'], ['finished', 'local']])
    assert.ok(successful.at(-1).at <= navigations.at(-1).at, 'Only local signOut completes before requesting login')
  }
  async function settleAuthEvent(callback) {
    await page.evaluate(async event => {
      const api = window.__sessionRecoveryTest
      if (event === 'logout') api.emitSignedOut()
      else if (event === 'refresh') api.emitTokenRefreshed()
      else api.emitSignedIn(event)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }, callback)
  }
  const detail = `/tu/investigations/${ID}?orgId=${ID}&tab=observations#field-notes`
  try {
    if (!guardsOnly) {
    for (const reason of ['forbidden', 'unavailable']) {
      for (const width of [390, 1440]) {
        await page.setViewport({ width, height: 1000 })
        await open('/dashboard-v1', { reason })
        assert.match(await text(), /(?:inlogg|session|anslut|tillfäll|behörighet)/i)
        assert.match(await text(), /Logga in igen/)
        assert.match(await text(), /kommer du tillbaka till sidan/)
        assert.doesNotMatch(await text(), /RenoApp|Supabase|JWT|refresh.?token|SYNTHETIC_PRIVATE_AUTH_ERROR/i)
        assert.equal((await page.$$('h1')).length, 1)
        assert.ok((await page.$$eval('a[href]', nodes => nodes.map(node => node.getAttribute('href')))).includes('/'))
        await noOverflow(`${reason} ${width}px`)
        await page.screenshot({ path: resolve(output, `${reason}-${width}.png`), fullPage: true })
      }
    }

    await open(detail)
    const beforeRetry = navigations.length
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickButton(/^Försök igen$/)])
    assert.equal(page.url(), `${base}${detail}`, 'Retry preserves module, organization, query and anchor')
    assert.equal(navigations.length, beforeRetry + 1)
    assert.deepEqual(await signOutEvents(), [])

    await open(`/auth/session-unavailable?next=${encodeURIComponent(detail)}`)
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickButton(/^Försök igen$/)])
    assert.equal(page.url(), `${base}${detail}`, 'Direct recovery retries the requested safe detail page')

    const modulePaths = [
      [`/ob/assignments/${ID}`, '/login'],
      [`/eb/projects/${ID}/inspections/${ID}/perform`, '/login'],
      [`/tu/investigations/${ID}`, '/login'],
      [`/fuktsakerhet/projekt/${ID}`, '/login'],
      [`/uppdrag/${ID}`, '/login'],
      [`/properties/${ID}/ob/${ID}`, '/login'], ['/inspections', '/login'],
      ['/settings/organisation', '/login'], ['/admin/renoapp/flow-builder', '/login'],
      [`/renoapp/app/cases/${ID}`, '/renoapp/login'], [`/renoapp/review/${ID}`, '/renoapp/login'],
      [`/mina-uppdrag/uppdrag/${ID}`, '/mina-uppdrag/logga-in'], ['/mina-uppdrag', '/mina-uppdrag/logga-in'],
    ]
    for (const [path, login] of modulePaths) {
      const target = `${path}?orgId=${ID}&tab=documents#review`
      await open(target)
      await loginAgain(target, login)
    }

    const unsafe = [`https://evil.test${detail}`, '//evil.test/tu', '/tu/../../admin', '/tu/%252fexample']
    for (const target of unsafe) {
      await open(`/auth/session-unavailable?next=${encodeURIComponent(target)}`)
      await loginAgain('/dashboard-v1')
    }
    await open(`/auth/session-unavailable?next=${encodeURIComponent(`${detail.split('#')[0]}&next=https://evil.test&access_token=private#field-notes`)}`)
    await loginAgain(detail)

    for (const mode of ['reject', 'error']) {
      await open(detail, { signout: mode })
      const originalUrl = page.url(), beforeError = navigations.length
      await clickButton(/^Logga in igen$/)
      await page.waitForSelector('[role="alert"]')
      await page.waitForFunction(() => [...document.querySelectorAll('button')].every(button => !button.disabled))
      assert.equal(page.url(), originalUrl)
      assert.equal(navigations.length, beforeError)
      assert.doesNotMatch(await page.$eval('[role="alert"]', node => node.textContent), /SYNTHETIC_PRIVATE_AUTH_ERROR|Supabase|JWT/i)
      assert.deepEqual((await signOutEvents()).map(event => [event.phase, event.scope]), [['started', 'local'], ['failed', 'local']])
      await noOverflow(`signOut ${mode}`)
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickButton(/^Försök igen$/)])
      assert.equal(page.url(), originalUrl)
      assert.equal((await signOutEvents()).length, 2, 'Retry does not repeat or widen signOut')
    }
    }

    for (const sessionMode of ['missing', 'error', 'reject']) {
      await open(detail, { kind: 'guard', sessionMode })
      assert.equal(await page.$('[data-private-workspace]'), null, `${sessionMode} never exposes private children`)
      assert.match(await text(), /Logga in igen/)
      assert.doesNotMatch(await text(), /SYNTHETIC_PRIVATE_AUTH_ERROR|Supabase|JWT/i)
      assert.equal((await counters()).subscriptions, 1, `${sessionMode}: nested guards share the auth subscription`)
    }

    for (const width of [390, 1440]) {
      await page.setViewport({ width, height: 1000 })
      await open(detail, { kind: 'guard', sessionMode: 'healthy' })
      await page.waitForSelector('[data-private-workspace]')
      await page.type('input', 'Anteckning som inte ska försvinna')
      const before = await counters()
      assert.equal(before.getSession, 1, 'Nested guards check a healthy session once')
      assert.equal(before.subscriptions, 1)
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await page.waitForFunction(previous => window.__sessionRecoveryTest.counters.sessionChecksCompleted > previous, {}, before.sessionChecksCompleted)
      await settleAuthEvent('refresh')
      assert.equal(await page.$eval('input', node => node.value), 'Anteckning som inte ska försvinna')
      const after = await counters()
      assert.equal(after.getSession, before.getSession + 1, 'Returning to a healthy tab performs one shared recheck')
      assert.equal(after.childMounts, 1)
      assert.equal(after.childUnmounts, 0, 'Healthy recheck and token refresh preserve the mounted form')
      assert.equal(after.subscriptions, 1)
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
      await page.waitForFunction(previous => window.__sessionRecoveryTest.counters.sessionChecksCompleted > previous, {}, after.sessionChecksCompleted)
      assert.equal((await counters()).getSession, after.getSession + 1, 'BFCache restoration performs one shared recheck')
      assert.equal(await page.$eval('input', node => node.value), 'Anteckning som inte ska försvinna')
      await settleAuthEvent('logout')
      assert.equal(await page.$('[data-private-workspace]'), null, 'SIGNED_OUT removes private children immediately')
      assert.match(await text(), /Logga in igen/)
      await settleAuthEvent('synthetic-account-b')
      assert.equal(await page.$('[data-private-workspace]'), null, 'Another account cannot restore old private server content')
      assert.equal((await counters()).childUnmounts, 1)
      await noOverflow(`guard signed out ${width}px`)
      await page.screenshot({ path: resolve(output, `guard-signed-out-${width}.png`), fullPage: true })
    }

    await open(detail, { kind: 'guard', sessionMode: 'healthy' })
    await page.waitForSelector('[data-private-workspace]')
    await settleAuthEvent('synthetic-account-b')
    assert.equal(await page.$('[data-private-workspace]'), null, 'Direct account A to B change removes old private server content')
    assert.match(await text(), /Logga in igen/)

    await open(detail, { kind: 'guard', sessionMode: 'healthy' })
    await page.waitForSelector('[data-private-workspace]')
    await page.evaluate(() => { window.__sessionRecoveryTest.setSessionMode('error'); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
    await page.waitForFunction(() => !document.querySelector('[data-private-workspace]'))
    await settleAuthEvent('synthetic-account-a')
    assert.equal(await page.$('[data-private-workspace]'), null, 'A failed session recheck also latches recovery until reload')

    await open(detail, { kind: 'guard', sessionMode: 'missing' })
    await loginAgain(detail)
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickButton(/^Slutför syntetisk inloggning$/)])
    assert.equal(page.url(), `${base}${detail}`, 'Actual PublicLogin sign-in callback returns to the original module detail URL')
    await page.waitForSelector('[data-private-workspace]')

    await open(`/login?next=${encodeURIComponent('https://evil.test/steal')}`)
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickButton(/^Slutför syntetisk inloggning$/)])
    assert.equal(page.url(), `${base}/app`, 'Actual PublicLogin rejects an external next after sign-in')

    assert.deepEqual(errors, [], 'No client runtime errors')
    assert.deepEqual(external, [], 'All authentication and navigation remain local and synthetic')
    assert.deepEqual(writes, [], 'No authentication or application network writes occur')
    console.log(guardsOnly
      ? 'Session guard browser QA passed: nested checks/subscription, healthy tab/BFCache/token refresh form preservation, signed-out/failed-session/account-change privacy latch, actual PublicLogin roundtrip, no external requests/writes.'
      : 'Session recovery browser QA passed: 390/1440px, 13 module/detail routes, org/tab/hash return, product login, actual PublicLogin sign-in return, sanitized direct recovery, local signOut ordering/failures, nested guard deduplication, healthy form preservation, signed-out/failed-session/account-change privacy latch; no external requests or network writes.')
  } finally { await browser.close() }
}
