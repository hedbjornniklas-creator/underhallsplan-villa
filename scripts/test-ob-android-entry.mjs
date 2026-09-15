import assert from 'node:assert/strict'
import { readFile,writeFile,copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createClient } from '@supabase/supabase-js'
import { validateStagingKeys } from './lib/ob-staging-app.mjs'

const root=fileURLToPath(new URL('../',import.meta.url)),folder=join(root,'.cache/ob-staging-app')
const session=JSON.parse(await readFile(join(folder,'android-session.json')))
const keys=validateStagingKeys(JSON.parse(await readFile(join(folder,'keys.json'))))
assert.equal(session.project,keys.url);assert.equal(session.ready,true)
assert.match(session.url,/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/)
const api=`/api/ob/inspections/${session.inspection}/buildings`
const result={project:keys.url,inspection:session.inspection,checks:[],requests:[],completed:false}
const pass=name=>{result.checks.push(name);console.log('PASS '+name)}
let browser,page
try {
  assert.equal((await fetch(session.url,{redirect:'manual'})).status,200)
  for(const path of [api,'/api/staging/login','/_next/static/chunks/app.js'])assert.equal((await fetch(session.url+path,{redirect:'manual'})).status,401)
  pass('HTTPS entry is reachable; app/API/assets are inaccessible without test login')
  browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
  page=await browser.newPage()
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:1})
  const errors=[],origins=new Set()
  page.on('request',request=>{
    const url=new URL(request.url())
    if(['http:','https:'].includes(url.protocol)){origins.add(url.origin);result.requests.push(url.origin+url.pathname)}
    if(url.pathname==='/__mobile/login')result.loginRequest={origin:request.headers().origin,codeMatches:new URLSearchParams(request.postData()).get('code')===session.code}
  })
  page.on('response',response=>{if(new URL(response.url()).pathname==='/__mobile/login')result.loginStatus=response.status()})
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(session.url,{waitUntil:'networkidle2',timeout:60000})
  await page.type('#code',session.code)
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle2',timeout:60000}),page.click('button')])
  assert.equal(result.loginStatus,303,'Test login must redirect to the inspection')
  await page.waitForFunction(()=>document.body.innerText.includes('V\u00e4lj plats'),{timeout:60000})
  await page.select('select[aria-label="Plan"]','plan0')
  await page.waitForFunction(()=>document.body.innerText.includes('Hall'))
  const body=await page.evaluate(()=>document.body.innerText)
  assert.ok(body.includes('Hall'))
  assert.equal(await page.evaluate(()=>document.querySelectorAll('iframe').length),0)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
  const overview=await page.evaluate(async path=>{const r=await fetch(path);return {status:r.status,body:await r.json()}},api)
  assert.equal(overview.status,200);assert.equal(overview.body.data.parts.length,2)
  assert.deepEqual([...origins].sort(),[session.url,keys.url].sort(),'Unexpected external origin')
  assert.deepEqual(errors,[])
  await page.screenshot({path:join(session.output,'android-entry-390.png'),fullPage:true})
  pass('Real Chrome mobile viewport logs in and opens the two-building round without iframe or horizontal overflow')
  for(const path of ['/api/staging/login','/api/reports/send','/admin',api.replace(session.inspection,session.property)]) {
    assert.equal(await page.evaluate(async path=>(await fetch(path)).status,path),403,path)
  }
  pass('Authenticated gateway still blocks integrations, admin screens and other inspection APIs')
  await page.$$eval('button',nodes=>nodes.find(node=>/^Hall\b/.test(node.innerText.trim())).click())
  await page.waitForFunction(()=>document.body.innerText.includes('Fri notering'))
  await page.$$eval('button',nodes=>nodes.find(node=>node.innerText.trim()==='Fri notering').click())
  await page.waitForSelector('textarea')
  const noteText='TEST Androidkontroll '+new Date().toISOString()
  await page.type('textarea',noteText)
  const db=createClient(keys.url,keys.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
  let note
  for(let i=0;i<30&&!note;i++) {
    const {data,error}=await db.from('inspection_control_items').select('id,note,building_part_id').eq('inspection_id',session.inspection).eq('note',noteText)
    assert.ok(!error,error?.message);note=data[0]
    if(!note)await new Promise(r=>setTimeout(r,300))
  }
  assert.ok(note,'Mobile note was not saved')
  const originalImage=join(root,'public/report-assets/mock-company-logo.png')
  const secondImage=join(session.output,'selected-image-2.png')
  await copyFile(originalImage,secondImage)
  const choosing=page.waitForFileChooser()
  await page.$$eval('button',nodes=>nodes.find(node=>node.innerText.trim()==='V\u00e4lj bilder').click())
  const chooser=await choosing
  assert.equal(chooser.isMultiple(),true)
  await chooser.accept([originalImage,secondImage])
  let images=[]
  for(let i=0;i<40&&images.length<2;i++) {
    const {data,error}=await db.from('inspection_images').select('id,file_path,control_item_id,building_part_id').eq('inspection_id',session.inspection).eq('control_item_id',note.id)
    assert.ok(!error,error?.message);images=data
    if(images.length<2)await new Promise(r=>setTimeout(r,400))
  }
  assert.equal(images.length,2,'Both selected images must be linked exactly once')
  for(const image of images){assert.equal(image.building_part_id,note.building_part_id);assert.ok(image.file_path.startsWith(session.inspection+'/'))}
  await page.waitForFunction(()=>Array.from(document.images).some(img=>img.src.includes('/round/')&&img.complete&&img.naturalWidth>0))
  await page.screenshot({path:join(session.output,'android-note-390.png'),fullPage:true})
  await page.goBack({waitUntil:'networkidle2'})
  await page.waitForFunction(()=>document.body.innerText.includes('Fri notering'))
  assert.ok(page.url().includes(session.inspection))
  assert.deepEqual([...origins].sort(),[session.url,keys.url].sort(),'Unexpected origin during image upload')
  assert.deepEqual(errors,[])
  result.createdNote=note.id;result.createdImages=images.map(i=>i.id)
  pass('Note text and two selected images save once to the Android fixture; browser Back returns to the room')
  const buttons=await page.$$eval('button',nodes=>nodes.map(node=>({text:node.innerText,aria:node.getAttribute('aria-label'),title:node.title})))
  await writeFile(join(session.output,'entry-buttons.json'),JSON.stringify(buttons,null,2))
  result.completed=true
} catch(error){
  result.error=error.message;console.error(error.message);process.exitCode=1
  if(page){result.failureText=await page.evaluate(()=>document.body.innerText.slice(0,1600)).catch(()=>null);await page.screenshot({path:join(session.output,'entry-failure.png')}).catch(()=>{})}
}
finally{await browser?.close();await writeFile(join(session.output,'entry-verification.json'),JSON.stringify(result,null,2))}
