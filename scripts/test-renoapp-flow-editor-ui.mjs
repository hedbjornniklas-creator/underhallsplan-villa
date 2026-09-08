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
const output = resolve('tmp/renoapp-flow-editor-ui')
await mkdir(output, { recursive: true })
await new Promise((done, reject) => webpack({
  mode: 'development', devtool: false,
  entry: resolve('test/fixtures/renoapp-classification-flow.tsx'),
  output: { path: output, filename: 'flow.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString('errors-only'))) : done()))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const flowCss = await readFile(resolve('node_modules/@xyflow/react/dist/style.css'), 'utf8')
const bundle = await readFile(resolve(output, 'flow.js'))
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const action = { id:id(1), key:'wall',label:'Riva vägg',sortOrder:100,isActive:true,riskLevel:'medium',contractorRequirement:'none' }
const doc = { id:id(3),key:'drawing',label:'Utlåtande från byggnadskonstruktör',sortOrder:100,isActive:true,defaultPhase:'before_required' }
const yes = { id:id(8),key:'yes',label:'Ja',isActive:true,sortOrder:10,triggers:[] }
const no = { id:id(9),key:'no',label:'Nej',isActive:true,sortOrder:20,triggers:[] }
const question = { id:id(6),key:'water',label:'Påverkas vatteninstallationer?',responseType:'boolean',sortOrder:100,isActive:true,options:[yes,no] }
const questions = [question]
const docs = [doc]
const requirements = [{id:id(12),documentTypeId:doc.id,documentLabel:doc.label,isRequired:true,sortOrder:100,note:null}]
const writes = []
let moveFailure = null, sequence = 30
const responses = () => ({
  'action-types':{items:[action]},'questions':{items:questions},'document-types':{items:docs},'participants':{items:[]},
  'review-flags':{items:[]},'review-flag-links':{items:[]},'action-type-participants':{actionTypes:[]},
  'action-type-questions':{actionTypes:[{actionType:action,questions:[{id:id(11),questionId:question.id,questionLabel:question.label,isRequired:true,sortOrder:100}]}]},
  'requirements':{actionTypes:[{actionType:action,requirements}]},
})
const server = createServer(async(request,response)=>{
  if(request.url==='/flow.js'){response.setHeader('Content-Type','application/javascript');response.end(bundle);return}
  if(request.url.startsWith('/api/')){
    response.setHeader('Content-Type','application/json')
    const key=request.url.split('/').at(-1)
    if(request.method==='POST'){
      let body='';for await(const chunk of request)body+=chunk
      const input=JSON.parse(body);writes.push({key,input})
      if(key==='flow-move'){
        if(moveFailure){response.writeHead(moveFailure);response.end(JSON.stringify({error:moveFailure===503?'Databasuppdateringen för flytt av kort behöver köras först.':'Flödet har ändrats. Ladda om flödesbyggaren och försök igen.'}));return}
        const old = input.source.kind==='action_document' ? requirements.find(item=>item.id===input.source.id)
          : [...yes.triggers,...no.triggers].find(item=>item.id===input.source.id)
        if(!old){response.writeHead(409);response.end(JSON.stringify({error:'Flödet har ändrats.'}));return}
        if(input.apply){
          if(input.source.kind==='action_document')requirements.splice(requirements.findIndex(item=>item.id===input.source.id),1)
          else for(const option of [yes,no]) option.triggers=option.triggers.filter(item=>item.id!==input.source.id)
          const target=[yes,no].find(item=>item.id===input.target.id)
          target.triggers.push({id:id(sequence++),triggerType:'document',documentTypeId:doc.id,questionId:null,participantRoleId:null,reviewFlagId:null,isActive:true,sortOrder:100})
        }
        response.end(JSON.stringify({version:'a'.repeat(32),itemLabel:doc.label,fromLabel:input.source.kind==='action_document'?'Riva vägg':`${question.label} / ${input.source.parentId===no.id?'Nej':'Ja'}`,toLabel:`${question.label} / ${input.target.id===no.id?'Nej':'Ja'}`,shared:true,saved:input.apply}));return
      }
      if(key==='document-types'){
        const saved={...input,id:id(sequence++)};docs.push(saved);response.end(JSON.stringify({item:saved}));return
      }
      if(key==='requirements'){
        if(input.isEnabled){requirements.push({...input,id:id(sequence++),documentLabel:docs.find(item=>item.id===input.documentTypeId).label})}
        else {const index=requirements.findIndex(item=>item.documentTypeId===input.documentTypeId);if(index>=0)requirements.splice(index,1)}
        response.end(JSON.stringify({saved:true}));return
      }
      if(key==='questions'){
        const updated=input.question
        const target=questions.find(item=>item.id===updated.id)
        if(target){target.options=input.options;Object.assign(target,updated);response.end(JSON.stringify({item:target}));return}
      }
      response.writeHead(400);response.end('{}');return
    }
    const result=responses()[key];if(!result)response.writeHead(404)
    response.end(JSON.stringify(result??{}));return
  }
  response.setHeader('Content-Type','text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${flowCss}\n${css}</style></head><body><div id="root"></div><script src="/flow.js"></script></body></html>`)
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
let browser,page
try{
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
  page=await browser.newPage()
  const origin=`http://127.0.0.1:${server.address().port}`,errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('dialog',dialog=>dialog.accept())
  await page.setRequestInterception(true)
  page.on('request',request=>request.url().startsWith(origin)?request.continue():request.abort())
  await page.setViewport({width:1440,height:1100})
  await page.goto(origin,{waitUntil:'networkidle0'})
  await page.waitForSelector('.react-flow__node')
  const rootDoc=`[data-flow-id="root-document:${doc.id}"]`
  const answerNode=option=>`[data-flow-id="option:${question.id}:${option.id}"]`
  const triggerDoc=option=>`[data-flow-id="document:${option.id}:${doc.id}"]`
  await page.locator('::-p-xpath(//button[normalize-space(.)="Expandera alla"])').click()
  await page.waitForSelector(answerNode(yes))
  await page.locator('button[aria-label="Visa hela flödet"]').click()
  await page.waitForFunction(()=>document.querySelectorAll('.react-flow__edge-path').length===4)
  await page.screenshot({path:resolve(output,'desktop-before.png')})

  const questionNode=`[data-flow-id="question:root:${question.id}"]`
  const positions=()=>page.$$eval('[data-flow-id]',cards=>Object.fromEntries(cards.map(card=>{
    const transform=card.closest('.react-flow__node').style.transform
    const [x,y]=transform.match(/-?[\d.]+/g).map(Number)
    return [card.dataset.flowId,{x,y}]
  })))
  const dragBy=async(selector,dx,dy)=>{
    const handle=await(await page.$(`${selector} .flow-drag-handle`)).boundingBox()
    await page.mouse.move(handle.x+12,handle.y+12);await page.mouse.down()
    await page.mouse.move(handle.x+12+dx,handle.y+12+dy,{steps:15});await page.mouse.up()
  }
  const assertBranchTranslation=(before,after,moved,rootKey)=>{
    const dx=after[rootKey].x-before[rootKey].x,dy=after[rootKey].y-before[rootKey].y
    assert.ok(Math.abs(dx)+Math.abs(dy)>10,'parent must actually move')
    for(const [key,position] of Object.entries(before)){
      assert.ok(Math.abs(after[key].x-position.x-(moved.includes(key)?dx:0))<1,`${key}: x translation`)
      assert.ok(Math.abs(after[key].y-position.y-(moved.includes(key)?dy:0))<1,`${key}: y translation`)
    }
  }
  const branchKeys=[`question:root:${question.id}`,`option:${question.id}:${yes.id}`,`option:${question.id}:${no.id}`]
  const beforeBranch=await positions()
  await dragBy(questionNode,0,-70)
  const afterBranch=await positions()
  assertBranchTranslation(beforeBranch,afterBranch,branchKeys,branchKeys[0])
  assert.equal(writes.length,0)
  await page.screenshot({path:resolve(output,'subtree-moved.png')})
  await page.reload({waitUntil:'networkidle0'})
  await page.locator('::-p-xpath(//button[normalize-space(.)="Expandera alla"])').click()
  await page.waitForSelector(answerNode(yes))
  for(const key of branchKeys)assert.deepEqual((await positions())[key],afterBranch[key])
  // Saved descendants must move even while their cards are collapsed.
  const beforeCollapsed=await positions()
  await page.locator(`${questionNode} button[aria-label="Fäll ihop"]`).click()
  await page.waitForSelector(answerNode(yes),{hidden:true})
  await dragBy(questionNode,0,-45)
  await page.locator(`${questionNode} button[aria-label="Expandera"]`).click()
  await page.waitForSelector(answerNode(yes))
  assertBranchTranslation(beforeCollapsed,await positions(),branchKeys,branchKeys[0])
  assert.equal(writes.length,0)
  await page.locator('button[aria-label="Återställ kortens placering"]').click()
  console.log('PASS whole-branch drag: descendants follow, siblings stay, collapsed positions follow, reload retains placement')

  // Dragging onto empty space must move the line endpoint and must not write configuration.
  const handle=await page.$(`${rootDoc} .flow-drag-handle`)
  const box=await handle.boundingBox()
  const oldTransform=await page.$eval(rootDoc,node=>node.closest('.react-flow__node').style.transform)
  const oldPaths=await page.$$eval('.react-flow__edge-path',nodes=>nodes.map(node=>node.getAttribute('d')))
  await page.mouse.move(box.x+12,box.y+12);await page.mouse.down();await page.mouse.move(box.x+12,box.y+105,{steps:15});await page.mouse.up()
  await page.waitForFunction((selector,previous)=>document.querySelector(selector).closest('.react-flow__node').style.transform!==previous,{},rootDoc,oldTransform)
  assert.notDeepEqual(await page.$$eval('.react-flow__edge-path',nodes=>nodes.map(node=>node.getAttribute('d'))),oldPaths)
  assert.equal(writes.length,0)
  await page.reload({waitUntil:'networkidle0'})
  assert.equal(await page.$eval(rootDoc,node=>node.closest('.react-flow__node').style.transform),await page.evaluate(selector=>{
    const node=document.querySelector(selector).closest('.react-flow__node')
    const position=JSON.parse(localStorage.getItem('renoapp-flow-layout:v1:action-type:'+ '00000000-0000-4000-8000-000000000001'))[node.dataset.id]
    return `translate(${position.x}px, ${position.y}px)`
  },rootDoc))
  console.log('PASS position-only drag: edges follow, no configuration writes, position survives reload')

  // Copy/remove on the canvas must affect the selected document, not the last opened node.
  await page.locator(`${rootDoc} button[aria-label="Skapa kopia"]`).click()
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-flow-id]')].some(node=>node.textContent.includes('(kopia)')))
  const copied=docs.at(-1)
  assert.equal(copied.label,`${doc.label} (kopia)`)
  assert.equal(requirements.length,2)
  const copiedSelector=`[data-flow-id="root-document:${copied.id}"]`
  await page.locator(`${copiedSelector} button[aria-label="Ta bort från flödet"]`).click()
  await page.waitForSelector(copiedSelector,{hidden:true})
  assert.equal(requirements.length,1);assert.equal(docs.length,2)
  console.log('PASS copy/remove: selected card copied, only its connection removed, shared object retained')

  await page.locator('::-p-xpath(//button[normalize-space(.)="Expandera alla"])').click()
  await page.waitForSelector(answerNode(yes))
  await page.locator('button[aria-label="Återställ kortens placering"]').click()
  const drag=async(from,to)=>{
    const a=await(await page.$(`${from} .flow-drag-handle`)).boundingBox()
    const b=await(await page.$(to)).boundingBox()
    await page.mouse.move(a.x+12,a.y+12);await page.mouse.down()
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:20});await page.mouse.up()
    await page.waitForSelector('dialog[open]')
  }
  const beforeMove=writes.filter(item=>item.key==='flow-move').length
  await drag(rootDoc,answerNode(yes))
  assert.equal(writes.filter(item=>item.key==='flow-move').length,beforeMove+1)
  assert.equal(writes.at(-1).input.apply,false)
  assert.match(await page.$eval('dialog',node=>node.textContent),/FrånRiva väggTillPåverkas vatteninstallationer\? \/ Ja/)
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Avbryt"])').click()
  assert.equal(requirements.length,1)
  await drag(rootDoc,answerNode(yes))
  await page.screenshot({path:resolve(output,'move-confirmation.png')})
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Flytta koppling"])').click()
  await page.waitForSelector(triggerDoc(yes))
  assert.equal(requirements.length,0);assert.equal(yes.triggers.length,1)
  await drag(triggerDoc(yes),answerNode(no))
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Flytta koppling"])').click()
  await page.waitForSelector(triggerDoc(no))
  assert.equal(yes.triggers.length,0);assert.equal(no.triggers.length,1)
  console.log('PASS reparent drag: confirmation before writes, cancel preserves source, root to Yes and Yes to No')

  for(const width of [1440,1024,390]){
    await page.setViewport({width,height:1100})
    await page.locator('button[aria-label="Visa hela flödet"]').click()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    assert.ok(await page.$eval('.react-flow',node=>node.getBoundingClientRect().height)>=480)
    assert.equal((await page.$$('.react-flow__node')).length,5)
    await page.screenshot({path:resolve(output,`flow-${width}.png`)})
    await page.locator(`${triggerDoc(no)} button[aria-label="Flytta koppling"]`).click()
    await page.locator('dialog select').click()
    await page.select('dialog select',await page.$eval('dialog select',node=>[...node.options].find(option=>option.textContent.endsWith('/ Ja')).value))
    await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Granska flytt"])').click()
    await page.waitForFunction(()=>document.querySelector('dialog')?.textContent.includes('alla renoveringsflöden'))
    assert.equal(await page.$eval('dialog',node=>node.scrollWidth>node.clientWidth),false)
    await page.screenshot({path:resolve(output,`confirmation-${width}.png`)})
    await page.keyboard.press('Escape')
    console.log(`PASS ${width}px: diagram and keyboard-accessible move dialog render without page overflow`)
  }
  // A stale confirmation must not change the source or retry a write automatically.
  await page.locator(`${triggerDoc(no)} button[aria-label="Flytta koppling"]`).click()
  await page.select('dialog select',await page.$eval('dialog select',node=>[...node.options].find(option=>option.textContent.endsWith('/ Ja')).value))
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Granska flytt"])').click()
  await page.waitForFunction(()=>document.querySelector('dialog')?.textContent.includes('alla renoveringsflöden'))
  moveFailure=409
  const beforeFailure=writes.length
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Flytta koppling"])').click()
  await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('Flödet har ändrats'))
  await page.waitForSelector('dialog',{hidden:true})
  assert.equal(writes.length,beforeFailure+1);assert.equal(no.triggers.length,1);assert.equal(yes.triggers.length,0)
  console.log('PASS stale apply: source retained, configuration reloaded, no automatic retry')
  // A missing migration or a failed preview must never fall back to separate writes.
  moveFailure=503
  const count=writes.length
  await page.locator(`${triggerDoc(no)} button[aria-label="Flytta koppling"]`).click()
  await page.select('dialog select',await page.$eval('dialog select',node=>[...node.options].find(option=>option.textContent.endsWith('/ Ja')).value))
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Granska flytt"])').click()
  await page.waitForFunction(()=>document.body.textContent.includes('Databasuppdateringen'))
  assert.equal(writes.length,count+1);assert.equal(no.triggers.length,1)
  assert.deepEqual(errors,[])
  console.log('PASS missing migration: clear error, no configuration changes')
}catch(error){await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true});throw error}
finally{await browser?.close();await new Promise(done=>server.close(done))}
