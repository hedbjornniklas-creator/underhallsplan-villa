import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testAssignmentFormLayout(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = [], external = [], writes = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (request.url().startsWith('data:') || request.url().startsWith('blob:') || new URL(request.url()).origin === base) {
      if (request.method() === 'PATCH') writes.push(JSON.parse(request.postData()))
      void request.continue()
    } else { external.push(request.url()); void request.abort() }
  })
  async function load(query) {
    await page.goto(`${base}/details?${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.ob-assignment-form input')
    await page.evaluate(() => document.fonts.ready)
  }
  async function measure(name, mobile = false) {
    const layout = await page.evaluate(() => {
      const style = selector => getComputedStyle(document.querySelector(selector))
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        font: style('.ob-assignment-form input').fontFamily,
        fontLoaded: document.fonts.check('14px "OB Manrope"'),
        input: style('.ob-assignment-form input').fontSize,
        height: document.querySelector('.ob-assignment-form input').getBoundingClientRect().height,
        label: style('.ob-assignment-form .ob-form-field label').fontSize,
        heading: style('.ob-assignment-form h2').fontSize,
        columns: new Set([...document.querySelectorAll('.ob-assignment-columns > .ob-form-section')].map(node => Math.round(node.getBoundingClientRect().left))).size,
        boxedSections: [...document.querySelectorAll('.ob-assignment-form .ob-form-section')].some(node => {
          const css = getComputedStyle(node)
          return css.borderLeftWidth !== '0px' || css.boxShadow !== 'none'
        }),
      }
    })
    assert.equal(layout.overflow, false, `${name}: overflow`)
    assert.match(layout.font, /Manrope/)
    assert.equal(layout.fontLoaded, true)
    assert.equal(layout.input, mobile ? '16px' : '14px')
    assert.equal(layout.label, mobile ? '14px' : '13px')
    assert.equal(layout.heading, mobile ? '18px' : '16px')
    assert.equal(layout.height, mobile ? 48 : 44)
    assert.equal(layout.boxedSections, false)
    await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true })
    return layout
  }
  const fieldset = 'fieldset[aria-label="Uppdragsdata"]'
  try {
    for (const width of [320, 390, 768, 1024, 1280, 1920]) {
      const mobile = width < 768
      await page.setViewport({ width, height: 950, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })
      await load('form=draft')
      const result = await measure(`assignment-draft-${width}`, mobile)
      assert.equal(result.columns, width >= 1280 ? 3 : width >= 768 ? 2 : 1)
      assert.equal(await page.$eval(fieldset, node => node.disabled), false)
    }
    await page.setViewport({ width: 1280, height: 950, isMobile: false, hasTouch: false })
    await load('form=draft')
    const address = `${fieldset} .ob-form-field input`
    const before = await page.$eval(address, node => node.getBoundingClientRect().top)
    await page.click(address, { clickCount: 3 })
    await page.type(address, 'Lindbacksvägen 12')
    await page.waitForFunction(() => document.querySelector('.ob-assignment-save-status').textContent === 'Sparat')
    assert.equal(writes.at(-1).property_address, 'Lindbacksvägen 12')
    assert.equal(await page.$eval(address, node => node.getBoundingClientRect().top), before, 'save status must not move fields')
    assert.equal(await page.$eval(address, node => document.activeElement === node), true)
    await page.evaluate(() => [...document.querySelectorAll('.ob-form-choice')].find(node => node.textContent === 'Lägenhetsbesiktning').click())
    await page.waitForFunction(() => [...document.querySelectorAll('.ob-form-label')].some(node => node.textContent === 'Bostadsrättsförening'))
    await page.waitForFunction(() => document.querySelector('.ob-assignment-save-status').textContent === 'Sparat')
    assert.equal(writes.at(-1).orderer_role, 'Lägenhet')
    await page.evaluate(() => [...document.querySelectorAll('.ob-form-choice')].find(node => node.textContent === 'Säljarbesiktning').click())
    await page.waitForFunction(() => [...document.querySelectorAll('.ob-form-label')].some(node => node.textContent === 'Fastighetsbeteckning'))
    await page.waitForFunction(() => document.querySelector('.ob-assignment-save-status').textContent === 'Sparat')
    assert.equal(writes.at(-1).orderer_role, 'Säljare')
    for (const query of ['form=sent', 'form=ordered&terms=buyer', 'form=booked&terms=buyer']) {
      await load(query)
      assert.equal(await page.$eval(fieldset, node => node.disabled), true)
      assert.equal(await page.$eval(`${fieldset} input`, node => node.matches(':disabled')), true)
      await measure(`assignment-${query.split('&')[0].split('=')[1]}`)
    }
    await page.setViewport({ width: 390, height: 950, isMobile: true, hasTouch: true })
    await load('form=booked&terms=buyer')
    await measure('assignment-booked-mobile', true)
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, '200% text overflow')
    await page.screenshot({ path: resolve(output, 'assignment-large-text.png'), fullPage: true })
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    console.log('PASS: UB compact form at 320/390/768/1024/1280/1920, 200% text, autosave/focus/geometry, role choices and sent/ordered/booked locks; synthetic data only.')
  } catch (error) {
    await page.screenshot({ path: resolve(output, 'assignment-layout-failure.png'), fullPage: true })
    throw error
  } finally { await browser.close() }
}
