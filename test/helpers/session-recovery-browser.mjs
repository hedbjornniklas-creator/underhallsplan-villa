import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testSessionRecovery(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = [], external = [], navigations = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) {
      external.push(url.origin); void request.abort(); return
    }
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push({ url: request.url(), method: request.method(), at: Date.now() })
    void request.continue()
  })
  async function open(path = '/dashboard-v1?reason=forbidden') {
    if (page.url().startsWith(base)) await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('h1')
    assert.match(await page.$eval('body', node => node.textContent), /Försök igen/)
    assert.deepEqual(await signOutEvents(), [], 'Opening recovery must not sign anyone out')
  }
  async function signOutEvents() {
    return page.evaluate(() => JSON.parse(sessionStorage.getItem('recovery-signout-events') ?? '[]'))
  }
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
  try {
    for (const reason of ['forbidden', 'unavailable']) {
      for (const width of [390, 1440]) {
        await page.setViewport({ width, height: 1000 })
        await open(`/dashboard-v1?reason=${reason}`)
        const text = await page.$eval('body', node => node.textContent)
        assert.match(text, /(?:inlogg|session|anslut|tillfäll|behörighet)/i, 'Recovery explains the situation')
        assert.match(text, /Logga in igen/)
        assert.doesNotMatch(text, /RenoApp|Supabase|JWT|refresh.?token|SYNTHETIC_PRIVATE_AUTH_ERROR/i, 'User guidance omits internal permission and SDK details')
        assert.equal((await page.$$('h1')).length, 1)
        assert.ok((await page.$$eval('a[href]', nodes => nodes.map(node => node.getAttribute('href')))).includes('/'), 'Home remains reachable')
        await noOverflow(`${reason} ${width}px`)
        await page.screenshot({ path: resolve(output, `${reason}-${width}.png`), fullPage: true })
      }
    }

    await open('/dashboard-v1?reason=forbidden&orgId=synthetic&tab=calendar')
    const beforeRetry = navigations.length
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickButton(/^Försök igen$/)])
    assert.equal(page.url(), `${base}/dashboard-v1?reason=forbidden&orgId=synthetic&tab=calendar`, 'Retry reloads the original dashboard URL')
    assert.equal(navigations.length, beforeRetry + 1)
    assert.deepEqual(await signOutEvents(), [], 'Retry does not sign out a potentially healthy session')

    await open('/auth/session-unavailable?reason=unavailable')
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickButton(/^Försök igen$/)])
    assert.equal(page.url(), `${base}/dashboard-v1`, 'Direct unavailable page retries the dashboard')
    assert.deepEqual(await signOutEvents(), [])

    await open('/dashboard-v1?reason=forbidden')
    const nextNavigation = page.waitForNavigation({ waitUntil: 'networkidle0' })
    await clickButton(/^Logga in igen$/)
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.disabled))
    assert.equal(new URL(page.url()).pathname, '/dashboard-v1', 'Login navigation waits for local signOut completion')
    await nextNavigation
    const login = new URL(page.url())
    assert.equal(login.pathname, '/login')
    assert.equal(login.searchParams.get('next'), '/dashboard-v1')
    const successful = await signOutEvents()
    assert.deepEqual(successful.map(event => [event.phase, event.scope]), [['started', 'local'], ['finished', 'local']], 'Only this local browser session is cleared before login')
    const loginNavigation = navigations.at(-1)
    assert.ok(successful.at(-1).at <= loginNavigation.at, 'signOut completes before the new login document is requested')

    for (const mode of ['reject', 'error']) {
      await open(`/dashboard-v1?reason=forbidden&signout=${mode}`)
      const originalUrl = page.url(), beforeError = navigations.length
      await clickButton(/^Logga in igen$/)
      await page.waitForSelector('[role="alert"]')
      await page.waitForFunction(() => [...document.querySelectorAll('button')].every(button => !button.disabled))
      assert.equal(page.url(), originalUrl, 'Failed signOut does not navigate away')
      assert.equal(navigations.length, beforeError)
      const text = await page.$eval('[role="alert"]', node => node.textContent)
      assert.doesNotMatch(text, /SYNTHETIC_PRIVATE_AUTH_ERROR|Supabase|JWT/i, 'Authentication error details stay private')
      assert.ok(text.trim().length > 15, 'SignOut failure offers useful feedback')
      await noOverflow(`signOut ${mode}`)
      assert.deepEqual((await signOutEvents()).map(event => [event.phase, event.scope]), [['started', 'local'], ['failed', 'local']])
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickButton(/^Försök igen$/)])
      assert.equal(page.url(), originalUrl, 'Retry remains usable after failed signOut')
      assert.equal((await signOutEvents()).length, 2, 'Retry does not repeat or widen signOut')
    }
    assert.deepEqual(errors, [], 'No client runtime errors')
    assert.deepEqual(external, [], 'All authentication and navigation checks stay local and synthetic')
    console.log('Session recovery browser QA passed: 390/1440px, both reasons, retry preservation, direct unavailable retry, local signOut ordering, pending state, rejected and returned errors, no external requests.')
  } finally { await browser.close() }
}
