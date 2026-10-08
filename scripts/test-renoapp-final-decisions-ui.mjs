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
const output = resolve('tmp/renoapp-final-decisions-ui')
await mkdir(output, { recursive: true })
await new Promise((done, reject) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/renoapp-completion-view.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx','.ts','.js'], alias: { '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString('errors-only'))) : done()))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css','utf8'), {from:resolve('src/app/globals.css')})
const theme = await readFile('src/components/renoapp/renoapp-theme.css','utf8')
const font = await readFile('public/renoapp/brand/manrope.ttf')
const script = await readFile(resolve(output,'view.js'))
const server = createServer((req,res) => {
  if (req.url.endsWith('/consultant-review')) { res.setHeader('Content-Type','application/json'); res.end('{"order":null}'); return }
  if (req.url.endsWith('.ttf')) { res.setHeader('Content-Type','font/ttf'); res.end(font); return }
  if (req.url==='/view.js') { res.setHeader('Content-Type','application/javascript'); res.end(script); return }
  res.setHeader('Content-Type','text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}${theme}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(done => server.listen(0,'127.0.0.1',done))
let browser
try {
  browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
  const page = await browser.newPage()
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle0'})
  await page.waitForSelector('#board-decision form')
  const original=await page.evaluate(()=>sessionStorage.getItem('board-fixture'))
  for (const width of [1440,344]) {
    await page.setViewport({width,height:1000})
    for (const status of ['approved','conditional','rejected']) {
      await page.evaluate(({original,status})=>{
        const item=JSON.parse(original)
        item.status=status
        item.decisions=[{id:'final-decision',decision:status,reason:'Styrelsens sparade testmotivering. '.repeat(5),
          conditions:status==='conditional'?'Testvillkor: dokumentation ska lämnas innan arbetet börjar.':null,
          decidedAt:'2026-10-08T10:00:00Z',deliveryStatus:'failed',deliveryError:'Beslutet är sparat och låst, men mejlet kunde inte skickas.'}]
        sessionStorage.setItem('board-fixture',JSON.stringify(item))
        sessionStorage.removeItem('decision-mail-retries')
      },{original,status})
      await page.reload({waitUntil:'networkidle0'})
      assert.equal(await page.$('#board-decision form'),null)
      assert.equal(await page.$('#board-decision textarea'),null)
      assert.equal(await page.$('input[name="board-decision"]'),null)
      assert.match(await page.$eval('#board-decision',el=>el.textContent),/kan inte ändras/)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      await page.$eval('#board-decision',el=>el.scrollIntoView())
      await page.screenshot({path:resolve(output,`${status}-${width}.png`)})
      await page.click('#board-decision button')
      await page.waitForFunction(()=>document.querySelector('#board-decision').textContent.includes('skickats till mejlleverantören'))
      assert.equal(await page.$('#board-decision button'),null)
      const current=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('board-fixture')))
      assert.equal(current.decisions.length,1)
      assert.equal(current.decisions[0].id,'final-decision')
      assert.equal(current.status,status)
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('decision-mail-retries')),'1')
      await page.reload({waitUntil:'networkidle0'})
      assert.equal(await page.$('#board-decision form'),null)
      assert.equal(await page.$('#board-decision button'),null)
      console.log(`PASS ${width}px ${status}: read-only decision, retry mail, no new decision, reload remains locked`)
    }
  }
  assert.deepEqual(errors,[])
} finally {
  if (browser) await browser.close()
  await new Promise(done=>server.close(done))
}
