import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  page.on('pageerror', e => console.log('ERROR', e.message))
  page.on('console', e => console.log('CONSOLE', e.type(), e.text().slice(0, 500)))
  await page.setRequestInterception(true)
  page.on('request', r => {
    if (r.url().includes('/api/renoapp/public/brfs')) return r.respond({ contentType: 'application/json', body: JSON.stringify({ items: [{ id: 'test', name: 'Testföreningen', slug: 'layout-test', address: 'Testgatan' }] }) })
    if (!r.url().startsWith('http://127.0.0.1:3034')) return r.abort()
    return r.continue()
  })
  await page.goto('http://127.0.0.1:3034/renoapp/apply', { waitUntil: 'networkidle0' })
  await page.locator('#brf-search').fill('Testföreningen')
  console.log('FILLED', await page.$eval('#brf-search', el => ({ value: el.value, props: Object.keys(el).filter(k => k.includes('react')) })))
  await new Promise(done => setTimeout(done, 1000))
  console.log('RESULT', await page.$eval('#brf-search', el => el.value), await page.$eval('#brf-search-status', el => el.textContent))
  console.log('LINKS', await page.$$eval('a', els => els.map(el => el.href)))
} finally { await browser.close() }
