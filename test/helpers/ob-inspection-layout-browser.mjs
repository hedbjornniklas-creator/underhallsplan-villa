import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testInspectionLayout(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = [], external = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (request.url().startsWith('data:') || request.url().startsWith('blob:') || new URL(request.url()).origin === base) void request.continue()
    else { external.push(request.url()); void request.abort() }
  })
  const menu = '.ob-inspection-header [aria-label="Öppna stegmeny"]'
  async function choose(label) {
    await page.click(menu)
    await page.waitForSelector('dialog[open] .obm-menu-step')
    await page.evaluate(label => [...document.querySelectorAll('.obm-menu-step')]
      .find(node => node.getAttribute('aria-label') === label).click(), label)
    await page.waitForSelector('dialog[open]', { hidden: true })
  }
  async function measure(label, width) {
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: horizontal overflow`)
    assert.equal((await page.$$('.ob-inspection-header')).length, 1)
    assert.equal((await page.$$('.ob-draft-status')).length, 1)
    assert.equal(await page.$eval('.ob-inspection-header', node => getComputedStyle(node).fontFamily.includes('Manrope')), true)
    const rect = await page.$eval(menu, node => { const r = node.getBoundingClientRect(); return { right: r.right, width: r.width, height: r.height } })
    assert.equal(rect.width, 48)
    assert.equal(rect.height, 48)
    assert.equal(await page.$eval('.ob-inspection-header', header => {
      const children = [...header.children].filter(node => node.checkVisibility()).map(node => node.getBoundingClientRect())
      return children.some((a, i) => children.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top))
    }), false, `${label}: header overlaps`)
    await page.screenshot({ path: resolve(output, `layout-${label}-${width}.png`) })
    return rect.right
  }
  try {
    for (const width of [320, 390, 768, 1280, 1920]) {
      await page.setViewport({ width, height: 900 })
      await page.goto(base + '/round', { waitUntil: 'networkidle0' })
      await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
      await page.waitForSelector('.ob-property-workspace input')
      const menuRight = await measure('property', width)
      const propertyForm = await page.evaluate(() => {
        const root = document.querySelector('.ob-property-workspace')
        const input = root.querySelector('.ob-form-field input')
        return {
          font: getComputedStyle(input).fontSize,
          height: input.getBoundingClientRect().height,
          heading: getComputedStyle(root.querySelector('.ob-form-section h2')).fontSize,
          label: getComputedStyle(root.querySelector('.ob-form-field label')).fontSize,
        }
      })
      assert.deepEqual(propertyForm, width < 768
        ? { font: '16px', height: 48, heading: '18px', label: '14px' }
        : { font: '14px', height: 44, heading: '16px', label: '13px' })
      await choose('Handlingar & upplysningar')
      await page.waitForSelector('.ob-documents-workspace textarea')
      assert.equal(await measure('documents', width), menuRight)
      const field = await page.$eval('.ob-documents-workspace textarea', node => ({ size: getComputedStyle(node).fontSize, font: getComputedStyle(node).fontFamily }))
      assert.equal(field.size, width < 768 ? '16px' : '14px')
      assert.match(field.font, /Manrope/)
      await choose('Förutsättningar · Huvudbyggnad')
      await page.waitForSelector('.ob-form-list-row')
      assert.equal(await measure('conditions', width), menuRight)
      await choose('ÖB-runda · Huvudbyggnad')
      await page.waitForSelector('.obm-place-row')
      assert.equal(await measure('round', width), menuRight)
      await page.click('.obm-place-row')
      await page.waitForSelector('.obm-room-header')
      assert.equal(await measure('room', width), menuRight)
      await choose('ÖB-runda · Gästhus med förråd och övernattningsrum')
      await page.waitForSelector('.obm-place-row')
      assert.equal(await measure('extra-building', width), menuRight)
      await choose('Skicka utlåtande')
      await page.waitForSelector('.ob-delivery-workspace input[value="test@example.invalid"]')
      assert.equal(await measure('delivery', width), menuRight)
      assert.equal(await page.$eval('.ob-delivery-workspace .obm-primary', node => node.disabled), true, 'delivery guards remain in place')
      assert.equal(await page.$eval('.ob-delivery-workspace input', node => getComputedStyle(node).fontSize), width < 768 ? '16px' : '14px')
    }
    await page.setViewport({ width: 390, height: 900 })
    await page.goto(base + '/round?long-address&large-text', { waitUntil: 'networkidle0' })
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
    await page.waitForSelector('.ob-property-workspace input')
    await measure('large-text', 390)
    await choose('ÖB-runda · Gästhus med förråd och övernattningsrum')
    await page.waitForSelector('.obm-place-row')
    await measure('large-text-round', 390)
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    console.log('PASS: shared header, fixed menu alignment, typography, guards and overflow across seven views at 320/390/768/1280/1920px, plus 200% text.')
  } catch (error) {
    await page.screenshot({ path: resolve(output, 'layout-failure.png') })
    console.log('Layout failure context:', await page.evaluate(() => ({ text: document.body.innerText.slice(0, 1500) })), errors)
    throw error
  } finally { await browser.close() }
}
