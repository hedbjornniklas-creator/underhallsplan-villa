import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testStatusObject(base, output) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = [], external = [], dialogs = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss() })
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (request.url().startsWith('data:') || request.url().startsWith('blob:') || new URL(request.url()).origin === base) void request.continue()
    else { external.push(request.url()); void request.abort() }
  })
  const objectChoice = 'input[name^="status-object-"]'
  async function radio(label) {
    await page.evaluate(label => [...document.querySelectorAll('label')].find(node => node.textContent.trim() === label && node.querySelector('input[type=radio]')).click(), label)
  }
  const apartmentVisible = () => page.waitForFunction(() => [...document.querySelectorAll('label')].some(node => node.textContent === 'Lägenhetsnummer'))
  try {
    await page.setViewport({ width: 1280, height: 950 })
    await page.goto(`${base}/round`, { waitUntil: 'networkidle0' })
    await radio('Lägenhetsbesiktning')
    await apartmentVisible()
    const aptNumber = await page.evaluateHandle(() => [...document.querySelectorAll('label')].find(node => node.textContent === 'Lägenhetsnummer').control)
    await aptNumber.asElement().type('1201')
    await page.keyboard.press('Tab')
    await page.waitForFunction(() => window.__obFormTest.writes.some(write => write.values.apartment_number === '1201'))
    await radio('Statusbesiktning')
    await page.waitForSelector(objectChoice)
    await page.waitForFunction(() => document.querySelectorAll('input[name^="status-object-"]')[1].checked)
    assert.deepEqual(dialogs, [], 'an otherwise empty inspection has no profile warning')
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('label')].find(node => node.textContent === 'Lägenhetsnummer').control.value), '1201')
    await radio('Fastighet')
    await page.waitForFunction(() => document.querySelectorAll('input[name^="status-object-"]')[0].checked)
    await radio('Lägenhet')
    await apartmentVisible()
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('label')].find(node => node.textContent === 'Lägenhetsnummer').control.value), '1201')
    assert.equal(await page.evaluate(() => window.__obFormTest.snapshot().db.inspections[0].inspection_side), 'status')
    await page.screenshot({ path: resolve(output, 'status-apartment-grunddata-desktop.png'), fullPage: true })
    await page.setViewport({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: resolve(output, 'status-apartment-grunddata-mobile.png'), fullPage: true })
    await page.evaluate(() => { window.__obFormTest.failSaves = true })
    await radio('Fastighet')
    await page.waitForFunction(() => document.body.innerText.includes('Kunde inte spara objektets uppgifter'))
    assert.equal(await page.$eval(`${objectChoice}:checked`, node => node.closest('label').textContent.trim()), 'Lägenhet')
    await page.goto(`${base}/round?status&object=apartment&linked`, { waitUntil: 'networkidle0' })
    await radio('Fastighet')
    await page.waitForFunction(() => document.body.innerText.includes('Byte av objekttyp kräver en ny uppdragsbekräftelse'))
    assert.deepEqual(await page.evaluate(() => window.__obFormTest.writes), [])
    await page.goto(`${base}/round?status&object=apartment&locked`, { waitUntil: 'networkidle0' })
    assert.equal(await page.$eval(objectChoice, node => node.matches(':disabled')), true)
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    console.log('PASS: real Grunddata preserves apartment number across OB→STB and object switches; failed save/issued/locked guards; mobile layout. Synthetic data only.')
  } catch (error) {
    await page.screenshot({ path: resolve(output, 'status-object-failure.png'), fullPage: true })
    throw error
  } finally { await browser.close() }
}
