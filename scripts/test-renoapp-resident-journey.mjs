import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

// Exercise the real local pages, but never send application data to a backend.
const origin = process.env.TEST_ORIGIN ?? 'http://localhost:3011'
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/)
const output = resolve('tmp/renoapp-resident-journey')
await mkdir(output, { recursive: true })
const brf = { id: 'test-brf', name: 'Testföreningen', slug: 'layout-test', address: 'Testgatan 1', applyIntroText: 'Här ansöker du om att renovera din lägenhet.' }
const rules = { id: 'rules-test', version: 1, format: 'text', body: 'Testregler: beskriv arbetet och invänta styrelsens beslut.' }
const question = { id: 'water', key: 'water', label: 'Görs ingrepp i vatten- eller avloppsledningar, fasta anslutningar eller föreningens installationer?',
  helpText: 'Svara Ja om ledningar eller fasta anslutningar ska installeras, flyttas, byggas om eller tas bort. '.repeat(8), responseType: 'boolean', isRequired: true, sortOrder: 1,
  options: ['Ja', 'Nej'].map((label, index) => ({ id: label, key: label, label, description: `${label}: utförlig information om ditt alternativ. `.repeat(10), triggers: [], sortOrder: index })) }
const config = { brf, renovationRules: rules, actionTypes: [{ id: 'wall', key: 'wall', label: 'Riva vägg', description: 'Rivning av en innervägg eller upptagning av en öppning. '.repeat(10), requirements: [], participantRoles: [], questions: [question], sortOrder: 1 }], questionBank: [question] }
const results = []
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  for (const width of [344, 390, 1440]) {
    const page = await browser.newPage()
    await page.setViewport({ width, height: 844 })
    const posts = [], blocked = [], errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setRequestInterception(true)
    page.on('request', request => {
      const url = new URL(request.url())
      const json = body => request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      if (url.origin !== origin) { blocked.push(url.origin); void request.abort(); return }
      if (url.pathname === '/api/renoapp/public/brfs') { void json({ items: [brf] }); return }
      if (url.pathname === '/api/renoapp/brf/layout-test/public') { void json(config); return }
      if (url.pathname === '/api/renoapp/public/applications' && request.method() === 'POST') {
        posts.push(JSON.parse(request.postData()))
        void json({ caseId: 'layout-case', caseNumber: 'RA-LAYOUT-TEST', status: 'submitted', emailSent: true, emailError: null,
          resumeUrl: `${origin}/renoapp/brf/layout-test/apply?draft=layout-token`, accessUrl: `${origin}/renoapp/brf/layout-test/apply?draft=layout-token` })
        return
      }
      if (url.pathname === '/api/renoapp/public/applications/draft/layout-token') {
        void json({ state: 'open', brf, case: { id: 'layout-case', caseNumber: 'RA-LAYOUT-TEST', status: 'submitted', updatedAt: '2026-09-12' },
          form: posts.at(-1), completionRequest: { id: null, requestedDocuments: [], requestedParticipants: [] }, documents: [], messages: [],
          rulesAcceptance: { acceptedAt: '2026-09-12', acceptedName: 'Testperson Layout', acceptedEmail: 'layout@example.test', version: rules } })
        return
      }
      if (url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method())) { blocked.push(url.pathname); void request.abort(); return }
      void request.continue()
    })
    const snapshot = async name => {
      const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll('input,button,textarea,main,section')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, text: (el.textContent || el.getAttribute('placeholder') || '').slice(0, 80) })) }))
      results.push({ width, stage: name, ...overflow })
      await page.screenshot({ path: resolve(output, `${width}-${name}.png`), fullPage: true })
    }
    const button = text => page.locator(`::-p-xpath(//button[contains(., "${text}")])`)
    try {
      await page.goto(origin, { waitUntil: 'networkidle2' })
      await snapshot('01-home')
      const entry = await page.waitForSelector('.hushub-hero-actions a[href="/renoapp/apply"]')
      assert.ok(await entry.evaluate(el => el.getBoundingClientRect().bottom < innerHeight))
      await page.locator('.hushub-hero-actions a[href="/renoapp/apply"]').click()
      await page.waitForSelector('#brf-search')
      await snapshot('02-search-empty')
      await page.locator('#brf-search').fill('Testföreningen')
      await page.waitForSelector('a[href="/renoapp/brf/layout-test/apply"]')
      await snapshot('03-search-result')
      await page.locator('a[href="/renoapp/brf/layout-test/apply"]').click()
      await page.waitForSelector('[data-resident-application]')
      await snapshot('04-application-entry')
      assert.equal(await page.$eval('button[aria-controls="application-step-1"]', el => el.getAttribute('aria-expanded')), 'true')
      for (const [placeholder, value] of [['Namn *', 'Testperson Layout'], ['E-post *', 'layout@example.test'], ['Telefon *', '0700000000'], ['Internt lägenhetsnummer *', '12'], ['Skatteverkets lägenhetsnummer *', '1101']]) {
        await page.locator(`input[placeholder="${placeholder}"]`).fill(value)
        assert.ok(await page.$eval(`input[placeholder="${placeholder}"]`, el => el.labels?.length > 0))
      }
      await snapshot('05-contact')
      await button('Nästa steg').click()
      await page.locator('::-p-xpath(//label[normalize-space(.)="Riva vägg"])').click()
      await page.waitForSelector('fieldset')
      await snapshot('06-renovation')
      await page.locator('fieldset > details > summary').click()
      await snapshot('07-help-expanded')
      await page.locator('fieldset > details > summary').click()
      await page.locator('input[type="radio"][value="Nej"]').click()
      await page.locator('#description').click()
      await page.type('#description', 'Vi vill ta upp en öppning i väggen mellan kök och vardagsrum. Detta är endast ett lokalt layouttest.')
      await button('Nästa steg').click()
      await snapshot('08-review')
      assert.match(await page.$eval('#application-step-5', el => el.innerText), /Vi vill ta upp en öppning/)
      assert.match(await page.$eval('#application-step-5', el => el.innerText), /Dina svar/)
      assert.match(await page.$eval('#application-step-5 dl', el => el.innerText), /Nej/)
      await button('Skicka ansökan').click()
      await page.waitForSelector('#application-rules-error')
      assert.equal(posts.length, 0)
      await snapshot('09-rules-error')
      await page.locator('::-p-xpath(//label[contains(., "Jag har läst och godkänner")])').click()
      await button('Skicka ansökan').click()
      await page.waitForFunction(() => document.body.textContent.includes('Ansökan registrerad'))
      await page.waitForFunction(() => document.body.textContent.includes('Styrelsen handlägger ärendet'))
      await page.waitForFunction(() => location.search.includes('draft=layout-token'))
      await page.waitForSelector('#application-project-summary')
      assert.equal(posts.length, 1)
      assert.equal(posts[0].mode, 'submit')
      assert.equal(posts[0].applicantEmail, 'layout@example.test')
      assert.match(posts[0].description, /Vi vill ta upp en öppning/)
      await snapshot('10-submitted')
      assert.equal(await page.$$eval('[data-resident-application] a', els => els.some(el => el.textContent.includes('layout-token'))), false)
      await page.waitForFunction(() => document.querySelector('[data-resident-application]')?.textContent.includes('Projektbeskrivning'))
      assert.deepEqual(errors, [])
      assert.doesNotMatch(await page.$eval('body', el => el.innerText), /Cannot read properties|Kunde inte/)
      results.push({ width, posts: posts.length, blocked, errors })
      console.log(`PASS ${width}px: home, search, contact, renovation, help, review, rules validation, simulated submission`)
    } catch (error) {
      await snapshot('failure')
      console.error(await page.$eval('body', el => el.innerText.slice(-3500)))
      throw error
    } finally { await page.close() }
  }
} finally {
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2))
  await browser.close()
}
