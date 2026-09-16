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
const output = resolve('tmp/renoapp-clarifications-ui')
await mkdir(output,{recursive:true})
await new Promise((done,reject) => webpack({
  mode:'development',devtool:false,
  entry:{board:resolve('test/fixtures/renoapp-clarification-board.tsx'),applicant:resolve('test/fixtures/renoapp-completion-applicant.tsx')},
  output:{path:output,filename:'[name].js'},
  resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':resolve('src'),'next/link':resolve('test/fixtures/renoapp-test-link.tsx'),'next/navigation':resolve('test/fixtures/renoapp-clarification-navigation.ts')}},
  module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:resolve('test/helpers/transpile-loader.mjs')}]},
},(error,stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString('errors-only'))) : done()))
const {css:base} = await postcss([tailwind()]).process(await readFile('src/app/globals.css','utf8'),{from:resolve('src/app/globals.css')})
const css = base + await readFile('src/components/renoapp/renoapp-theme.css','utf8')
const font = await readFile('public/renoapp/brand/manrope.ttf')
const bundles = {board:await readFile(resolve(output,'board.js')),applicant:await readFile(resolve(output,'applicant.js'))}
const server = createServer((request,response) => {
  if (request.url.endsWith('.ttf')) { response.setHeader('Content-Type','font/ttf');response.end(font);return }
  if (request.url.endsWith('.js')) { response.setHeader('Content-Type','application/javascript');response.end(bundles[request.url.includes('applicant')?'applicant':'board']);return }
  response.setHeader('Content-Type','text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/${request.url.includes('applicant')?'applicant':'board'}.js"></script></body></html>`)
})
await new Promise(done => server.listen(0,'127.0.0.1',done))
const url = `http://127.0.0.1:${server.address().port}`
if (process.argv.includes('--serve')) {
  console.log(`Clarification preview (mock data, no email): ${url}`)
} else {
  let browser
  try {
    browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
    const page=await browser.newPage()
    const errors=[]
    page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack)})
    page.on('dialog',dialog=>dialog.accept())
    for (const width of [1440,1024,390,344]) {
      await page.setViewport({width,height:1000})
      await page.goto(url,{waitUntil:'networkidle0'})
      assert.deepEqual(errors,[],await page.$eval('body',node=>node.textContent))
      await page.waitForSelector('#board-clarifications')
      await page.evaluate(()=>document.fonts.ready)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      await (await page.$('section[aria-labelledby="board-clarifications"]')).screenshot({path:resolve(output,`board-${width}.png`)})
      console.log(`PASS board layout ${width}px`)
    }
    await page.setViewport({width:1440,height:1000})
    await page.goto(url,{waitUntil:'networkidle0'})
    const section='section[aria-labelledby="board-clarifications"]'
    // Rapid changes are serialized and end on the latest choice.
    await page.$eval(`${section} input[type=checkbox]`,node=>{node.click();node.click();node.click()})
    await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('board-last-clarification')??'null')?.revision===1)
    await page.waitForFunction(()=>!document.querySelector('section[aria-labelledby="board-clarifications"]').textContent.includes('Sparar...'))
    assert.equal(await page.$eval(`${section} input`,node=>node.checked),true)
    await page.click('#board-decision input[value="approved"]')
    assert.equal(await page.$eval('#board-decision button[type=submit]',node=>node.disabled),true)
    await page.locator(`${section} summary`).click()
    await page.type(`${section} textarea`,'Svaret och underlaget är bedömda.')
    await page.click(`${section} details button`)
    await page.waitForFunction(()=>document.querySelector('section[aria-labelledby="board-clarifications"]').textContent.includes('Klarlagt'))
    await page.waitForFunction(()=>!document.querySelector('#board-decision button[type=submit]').disabled)
    console.log('PASS latest checkbox choice, separate review and approval guard')

    await page.goto(url,{waitUntil:'networkidle0'})
    await page.evaluate(()=>sessionStorage.setItem('clarification-fail','1'))
    await page.click(`${section} input`)
    await page.waitForSelector(`${section} [role=alert]`)
    assert.equal(await page.$eval('#board-decision button[type=submit]',node=>node.disabled),true)
    await page.evaluate(()=>sessionStorage.removeItem('clarification-fail'))
    await page.click(`${section} [role=alert] button`)
    await page.waitForFunction(()=>!document.querySelector('section[aria-labelledby="board-clarifications"] [role=alert]'))
    await page.waitForFunction(()=>!document.querySelector('#board-decision button[type=submit]').disabled)
    await page.click('#board-decision button[type=submit]')
    await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('board-last-status')??'null')?.selectedClarifications?.length===1)
    console.log('PASS save failure blocks publication; retry includes clarification revision')

    await page.goto(`${url}/applicant`,{waitUntil:'networkidle0'})
    await page.evaluate(()=>{
      const draft=JSON.parse(sessionStorage.getItem('completion-fixture'))
      draft.completionRequest.requestedParticipants=[]
      draft.completionRequest.requestedClarifications=[{questionId:'11111111-1111-4111-8111-111111111111',label:'Har du fått besked från kommunen om den planerade åtgärden kräver anmälan?',revision:1,options:[
        {id:'22222222-2222-4222-8222-222222222222',key:'yes',label:'Ja, kommunen har meddelat att anmälan krävs.'},
        {id:'33333333-3333-4333-8333-333333333333',key:'no',label:'Nej, kommunen har meddelat att anmälan inte krävs.'},
        {id:'44444444-4444-4444-8444-444444444444',key:'needs_investigation',label:'Jag behöver undersöka detta'},
      ]}]
      draft.completionDraft.clarificationAnswers={}
      sessionStorage.setItem('completion-fixture',JSON.stringify(draft))
    })
    for (const width of [1440,1024,390,344]) {
      await page.setViewport({width,height:1000})
      await page.reload({waitUntil:'networkidle0'})
      await page.waitForSelector('#clarification-heading')
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      await (await page.$('section[aria-labelledby="clarification-heading"]')).screenshot({path:resolve(output,`applicant-${width}.png`)})
      console.log(`PASS applicant layout ${width}px`)
    }
    const app='section[aria-labelledby="clarification-heading"]'
    await (await page.$$(`${app} input[type=radio]`))[2].click()
    await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('completion-last-request')??'null')?.clarificationAnswers?.['11111111-1111-4111-8111-111111111111']?.optionId)
    await page.click('::-p-xpath(//button[normalize-space()="Skicka komplettering"])')
    await page.waitForFunction(()=>document.body.textContent.includes('Beskriv vad som återstår att undersöka'))
    await page.type(`${app} textarea`,'Väntar på ett skriftligt besked från kommunen.')
    await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('completion-last-request')??'null')?.clarificationAnswers?.['11111111-1111-4111-8111-111111111111']?.note.endsWith('kommunen.'))
    await page.reload({waitUntil:'networkidle0'})
    assert.match(await page.$eval(`${app} textarea`,node=>node.value),/kommunen/)
    await page.click('::-p-xpath(//button[normalize-space()="Skicka komplettering"])')
    await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('completion-last-request')??'null')?.mode==='submit')
    assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('completion-last-request')).questionAnswers),{})
    assert.deepEqual(errors,[])
    console.log('PASS required investigation note, autosave/reload, separate answers and locked base application')
  } finally {
    await browser?.close()
    await new Promise(done=>server.close(done))
  }
}
