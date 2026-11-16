import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import puppeteer from 'puppeteer-core'
const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack')
const output=resolve('tmp/gizmo-signed-upload-ui'), evidence='C:/Users/hedbj/underhallsplan-villa/output/gizmo-contract-signed-upload-20261116'
await mkdir(output,{recursive:true}); await mkdir(evidence,{recursive:true});const downloads=await mkdtemp(join(output,'downloads-'))
await new Promise((done,fail)=>webpack({mode:'development',devtool:false,plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({NODE_ENV:'development'})})],entry:resolve('test/fixtures/gizmo-signed-upload-view.tsx'),output:{path:output,filename:'view.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'next/image$':resolve('test/helpers/fixture-next-image.tsx'),'@/lib/supabaseClient$':resolve('test/helpers/gizmo-upload-storage-stub.ts'),'@':resolve('src')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:resolve('test/helpers/transpile-loader.mjs')},{test:/\.css$/,type:'asset/source'}]}},(error,stats)=>error||stats.hasErrors()?fail(error||Error(stats.toString('errors-only'))):done()))
const source=(await readFile('src/app/globals.css','utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);\n@source "../components/tasks";')
const globalCss=(await postcss([tailwind()]).process(source,{from:resolve('src/app/globals.css')})).css
const css=globalCss+'\n'+await readFile('src/components/tasks/uppdrag-theme.css','utf8')+'\n'+await readFile('src/components/tasks/project-questions.css','utf8')+'\n'+await readFile('src/components/tasks/project-save-protection.css','utf8')
const script=await readFile(join(output,'view.js')), photo=await readFile('public/landing/renovering-editorial-v2.png'),font=await readFile('public/uppdrag/brand/manrope.ttf')
const pdf=Buffer.alloc(11_487_242,32);pdf.write('%PDF-1.4\n% Synthetic upload fixture, not a real agreement\n')
await writeFile(join(output,'Fiktivt-signerat.pdf'),pdf);await writeFile(join(output,'Ritning.pdf'),pdf.subarray(0,500));await writeFile(join(output,'photo.png'),photo);await writeFile(join(output,'retry.jpg'),photo)
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname
  res.setHeader('Cache-Control','no-store')
  if(path==='/view.js'){res.setHeader('Content-Type','text/javascript');res.end(script)}
  else if(path==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css)}
  else if(path==='/fixture-photo.png'||path.includes('/attachments/')){res.setHeader('Content-Type','image/png');res.end(photo)}
  else if(path==='/uppdrag/brand/manrope.ttf'){res.setHeader('Content-Type','font/ttf');res.end(font)}
  else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="sv"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gizmo - isolerat uppladdningstest</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/view.js"></script></html>')}
})
await new Promise(done=>server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${server.address().port}`
let browser
try {
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
  const page=await browser.newPage(),errors=[],external=[]
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>void dialog.dismiss())
  await page.setRequestInterception(true);page.on('request',request=>{if(!request.url().startsWith(base)&&!request.url().startsWith('blob:')&&!request.url().startsWith('data:')){external.push(request.url());void request.abort()}else void request.continue()})
  const click=async label=>{for(const node of await page.$$('button,summary'))if(await node.evaluate((node,label)=>node.textContent.trim()===label,label)){await node.click();return}throw Error(`Missing control: ${label}`)}
  const waitText=text=>page.waitForFunction(text=>document.body.innerText.includes(text),{},text)
  const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)
  await page.setViewport({width:1280,height:900});await page.goto(base);await page.waitForSelector('[aria-label="Underskriven avtalskopia"]')
  assert.equal((await page.$$('a[href*="?task="]')).length,0)
  assert.equal((await page.$$('a')).length,1,'one download for the active unsigned version')
  await click('Fler åtgärder');await click('Öppna för redigering');assert.equal(await page.$eval('[role="alert"] button',node=>node.disabled),true)
  await click('Avbryt')
  await page.screenshot({path:join(evidence,'contract-before-upload-desktop.png'),fullPage:true})
  const fileInput=await page.$('input[type=file][aria-label="Välj signerad PDF-fil"]');await fileInput.uploadFile(join(output,'Fiktivt-signerat.pdf'))
  await click('Frågor och beslut');await page.waitForSelector('[aria-labelledby="gizmo-save-warning-title"]');await click('Stanna kvar')
  await page.click('[aria-label="Underskriven avtalskopia"] input[type=checkbox]');await click('Registrera underskriven kopia');await waitText('Hämta underskriven kopia')
  assert.equal(await page.evaluate(()=>window.gizmoFixture.stats().completeCalls),1)
  assert.equal(await page.evaluate(()=>window.gizmoFixture.stats().newDrafts),0)
  assert.ok(await overflow());await page.screenshot({path:join(evidence,'contract-desktop.png'),fullPage:true})
  await page.setViewport({width:390,height:844});assert.ok(await overflow());await page.screenshot({path:join(evidence,'contract-mobile.png'),fullPage:true})
  await click('Frågor och beslut');await waitText('Interna projektuppgifter');await waitText('Klar · Underskriven kopia registrerad')
  await page.click('.gizmo-question-open');await page.waitForSelector('input[multiple]')
  const files=await page.$('input[multiple]');await files.uploadFile(join(output,'Ritning.pdf'),join(output,'photo.png'),join(output,'retry.jpg'))
  await waitText('2 av 3 filer bifogade');await waitText('Försök igen med misslyckade filer')
  assert.equal(await page.evaluate(()=>window.gizmoFixture.stats().attached.length),2)
  await page.evaluate(()=>window.gizmoFixture.allowRetry());await click('Försök igen med misslyckade filer');await waitText('3 av 3 filer bifogade')
  assert.equal(await page.evaluate(()=>window.gizmoFixture.stats().attached.length),3)
  assert.equal(await page.evaluate(()=>window.gizmoFixture.stats().uploadCalls),5,'one signed PDF, three initial files and one retry')
  assert.ok(await overflow());await page.screenshot({path:join(evidence,'question-multiple-mobile.png'),fullPage:true})
  await page.click('[aria-label="Granska photo.png"]');await waitText('Ladda ned bild')
  await page.waitForFunction(()=>{const image=document.querySelector('[aria-label="Granska bild"] img');return image?.complete&&image.naturalWidth>0})
  const session=await page.createCDPSession();await session.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  await page.evaluate(()=>window.gizmoFixture.failNextDownload());await click('Ladda ned bild');await waitText('Bilden kunde inte laddas ned.')
  await click('Ladda ned bild')
  for(let i=0;i<40;i++){if((await readdir(downloads)).includes('photo.png'))break;await new Promise(resolve=>setTimeout(resolve,150))}
  assert.equal(createHash('sha256').update(await readFile(join(downloads,'photo.png'))).digest('hex'),createHash('sha256').update(photo).digest('hex'))
  assert.ok(await overflow());await page.screenshot({path:join(evidence,'image-download-mobile.png'),fullPage:true})
  await page.setViewport({width:1280,height:900});await page.screenshot({path:join(evidence,'image-download-desktop.png'),fullPage:true})
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  console.log(JSON.stringify({passed:true,checks:['locked version retained','reopening requires unsigned confirmation','11.5 MB direct upload','selected file navigation protection','local project task','multi-file upload','partial failure and retry','original image bytes and filename downloaded','desktop and mobile no overflow','no external traffic'],screenshots:evidence},null,2))
} finally {await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done))}
