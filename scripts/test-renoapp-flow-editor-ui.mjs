import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { compactFlowResponses, compactWallQuestion, compactWallAnswerIds } from '../test/fixtures/renoapp-compact-flow.mjs'

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
const secondAction = { ...action, id:id(2), key:'kitchen', label:'Kök', sortOrder:200 }
const doc = { id:id(3),key:'drawing',label:'Utlåtande från byggnadskonstruktör',sortOrder:100,isActive:true,defaultPhase:'before_required' }
const yes = { id:id(8),key:'yes',label:'Ja',isActive:true,sortOrder:10,triggers:[] }
const no = { id:id(9),key:'no',label:'Nej',isActive:true,sortOrder:20,triggers:[] }
const question = { id:id(6),key:'water',label:'Påverkas vatteninstallationer?',responseType:'boolean',sortOrder:100,isActive:true,options:[yes,no] }
const questions = [question]
const docs = [doc]
const requirements = [{id:id(12),documentTypeId:doc.id,documentLabel:doc.label,isRequired:true,sortOrder:100,note:null}]
const writes = []
let moveFailure = null, copyFailure = false, sequence = 30, fixture = null
let writeGate = null, readGate = null, patchFailure = false, linkFailure = false, activeWrites = 0, maxActiveWrites = 0, gets = 0
const releaseGates = []
const holdWrites = () => {
  let release
  writeGate = new Promise(resolve => { release = resolve })
  const done = () => { writeGate = null; release() }
  releaseGates.push(done)
  return done
}
const responses = () => fixture ?? ({
  'action-types':{items:[action,secondAction]},'questions':{items:questions},'document-types':{items:docs},'participants':{items:[]},
  'review-flags':{items:[]},'review-flag-links':{items:[]},'action-type-participants':{actionTypes:[]},
  'action-type-questions':{actionTypes:[{actionType:action,questions:[{id:id(11),questionId:question.id,questionLabel:question.label,isRequired:true,sortOrder:100}]}]},
  'requirements':{actionTypes:[{actionType:action,requirements}]},
})
const server = createServer(async(request,response)=>{
  if(request.url==='/flow.js'){response.setHeader('Content-Type','application/javascript');response.end(bundle);return}
  if(request.url.startsWith('/api/')){
    response.setHeader('Content-Type','application/json')
    const key=request.url.split('/').at(-1)
    if(request.method==='POST' || request.method==='PATCH'){
      let body='';for await(const chunk of request)body+=chunk
      const input=JSON.parse(body);writes.push({key,input,method:request.method})
      activeWrites++;maxActiveWrites=Math.max(maxActiveWrites,activeWrites)
      response.once('finish',()=>activeWrites--)
      if(writeGate)await writeGate
      if(key==='questions' && request.method==='PATCH'){
        if(patchFailure){response.writeHead(500);response.end(JSON.stringify({error:'Testfel vid sparande.'}));return}
        const question=responses().questions.items.find(q=>q.id===input.questionId)
        const target=input.optionId?question.options.find(o=>o.id===input.optionId):question
        Object.assign(target,input.fields)
        response.end(JSON.stringify({item:{id:target.id,fields:input.fields}}));return
      }
      if(key==='flow-move'){
        const operation=input.operation??'move'
        const failure=operation==='move'?moveFailure:(operation==='copy'&&input.apply&&copyFailure?500:null)
        if(failure){response.writeHead(failure);response.end(JSON.stringify({error:failure===503?'Databasuppdateringen för flödeskopplingar behöver köras först.':failure===500?'Kopplingen kunde inte skapas.':'Flödet har ändrats. Ladda om flödesbyggaren och försök igen.'}));return}
        const data=responses(),options=data.questions.items.flatMap(q=>q.options)
        const owner=input.source.kind==='action_document' ? data.requirements.actionTypes.find(a=>a.actionType.id===input.source.parentId)
          : options.find(o=>o.id===input.source.parentId)
        const connections=input.source.kind==='action_document'?owner?.requirements:owner?.triggers
        const original=connections?.find(item=>item.id===input.source.id)
        if(!original){response.writeHead(409);response.end(JSON.stringify({error:'Flödet har ändrats.'}));return}
        const child=original.questionId ? data.questions.items.find(q=>q.id===original.questionId)
          : data['document-types'].items.find(d=>d.id===original.documentTypeId)
        const target=options.find(o=>o.id===input.target?.id)
        const parentLabel=option=>data.questions.items.find(q=>q.options.some(o=>o.id===option.id)).label+' / '+option.label
        const fromLabel=input.source.kind==='action_document'?owner.actionType.label:parentLabel(owner)
        if(input.apply){
          if(operation!=='copy')connections.splice(connections.findIndex(item=>item.id===input.source.id),1)
          if(operation!=='remove')target.triggers.push({...original,id:id(sequence++),triggerType:original.triggerType??'document',isActive:true})
        }
        response.end(JSON.stringify({version:'a'.repeat(32),itemLabel:child.label,fromLabel,toLabel:target?parentLabel(target):null,shared:true,saved:input.apply}));return
      }
      if(key==='action-type-questions'){
        response.end(JSON.stringify({saved:true}));return
      }
      if(key==='document-types'){
        if(copyFailure){response.writeHead(500);response.end(JSON.stringify({error:'Kopian kunde inte skapas.'}));return}
        const saved={...input,id:id(sequence++)};docs.push(saved);response.end(JSON.stringify({item:saved}));return
      }
      if(key==='requirements'){
        if(input.isEnabled){requirements.push({...input,id:id(sequence++),documentLabel:docs.find(item=>item.id===input.documentTypeId).label})}
        else {const index=requirements.findIndex(item=>item.documentTypeId===input.documentTypeId);if(index>=0)requirements.splice(index,1)}
        response.end(JSON.stringify({saved:true}));return
      }
      if(key==='questions'){
        if(linkFailure){response.writeHead(500);response.end(JSON.stringify({error:'Testfel efter skapad definition.'}));return}
        const updated=input.question
        const target=questions.find(item=>item.id===updated.id)
        if(target){
          const options=input.options.map(option=>Object.assign(target.options.find(item=>item.id===option.id)??{},option,{
            id:option.id?.startsWith('00000000')?option.id:id(sequence++),
            triggers:option.triggers.map(trigger=>({...trigger,id:id(sequence++)})),
          }))
          Object.assign(target,updated,{options});response.end(JSON.stringify({item:target}));return
        }
      }
      response.writeHead(400);response.end('{}');return
    }
    gets++
    const result=structuredClone(responses()[key]);if(!result)response.writeHead(404)
    if(readGate && key==='questions')await readGate
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
  const rootNode=`[data-flow-id="action-type:${action.id}"]`
  const answerNode=option=>`[data-flow-id="option:${question.id}:${option.id}"]`
  const triggerDoc=option=>`[data-flow-id="document:${option.id}:${doc.id}"]`
  const clickTarget=async selector=>{
    await page.locator(`${selector} button[aria-label^="Koppla hit:"]`).click()
    await page.waitForSelector('dialog[open]')
  }
  const chooseMove=async(from,to)=>{
    await page.locator(`${from} button[aria-label="Flytta koppling"]`).click()
    assert.equal(await page.$('dialog[open]'),null)
    assert.equal(await page.$('dialog select'),null)
    await clickTarget(to)
  }
  // Every branch is expanded on initial entry, without clicking Expand all.
  await page.waitForSelector(answerNode(yes))
  await page.locator('button[aria-label="Visa hela flödet"]').click()
  await page.waitForFunction(()=>document.querySelectorAll('.react-flow__edge-path').length===4)
  await page.screenshot({path:resolve(output,'desktop-before.png')})

  const questionNode=`[data-flow-id="question:root:${question.id}"]`
  await page.locator(`${questionNode} button[aria-label="Fäll ihop"]`).click()
  await page.waitForSelector(answerNode(yes),{hidden:true})
  await page.locator('::-p-xpath(//button[normalize-space(.)="Kök"])').click()
  await page.locator('::-p-xpath(//button[normalize-space(.)="Riva vägg"])').click()
  await page.waitForSelector(answerNode(yes))
  assert.equal(writes.length,0)
  console.log('PASS initial expansion: switching back to a previously collapsed flow expands every branch')
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
    const position=JSON.parse(localStorage.getItem('renoapp-flow-layout:v2:action-type:'+ '00000000-0000-4000-8000-000000000001'))[node.dataset.id]
    return `translate(${position.x}px, ${position.y}px)`
  },rootDoc))
  console.log('PASS position-only drag: edges follow, no configuration writes, position survives reload')

  // Copy/remove on the canvas must affect the selected document, not the last opened node.
  await page.locator(`${questionNode} button[aria-label="Fäll ihop"]`).click()
  await page.locator(`${rootDoc} button[aria-label="Kopiera till en annan plats"]`).click()
  assert.equal(writes.length,0)
  assert.equal(await page.$('dialog[open]'),null)
  await page.locator(`${questionNode} button[aria-label="Expandera"]`).click()
  await page.waitForSelector(answerNode(yes))
  assert.equal(await page.$eval(answerNode(yes),node=>node.dataset.flowTarget),'true')
  await page.keyboard.press('Escape')
  assert.equal(writes.length,0)
  await page.locator(`${rootDoc} button[aria-label="Kopiera till en annan plats"]`).click()
  assert.equal(await page.$eval(rootNode,node=>node.dataset.flowTarget),'false')
  assert.equal(await page.$eval(questionNode,node=>node.dataset.flowTarget),'false')
  assert.equal(await page.$eval(answerNode(yes),node=>node.dataset.flowTarget),'true')
  await page.screenshot({path:resolve(output,'copy-targets.png')})
  await clickTarget(answerNode(yes))
  assert.equal(writes.length,1);assert.equal(writes[0].input.apply,false)
  assert.equal(docs.length,1);assert.equal(yes.triggers.length,0)
  assert.match(await page.$eval('dialog',node=>node.textContent),/Ingen ny fråge- eller underlagsdefinition/)
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Avbryt"])').click()
  assert.equal(yes.triggers.length,0)
  await page.locator(`${rootDoc} button[aria-label="Kopiera till en annan plats"]`).click()
  await clickTarget(answerNode(yes))
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Koppla hit"])').click()
  await page.waitForSelector(triggerDoc(yes))
  assert.equal(requirements[0].documentTypeId,doc.id)
  assert.equal(yes.triggers[0].documentTypeId,doc.id)
  assert.equal(docs.length,1)
  // Root and answer cards are definitions, not unlinkable occurrences.
  for(const selector of [rootNode,answerNode(yes)]){
    assert.equal(await page.$(`${selector} button[aria-label="Ta bort från flödet"]`),null)
    assert.equal(await page.$(`${selector} button[aria-label="Kopiera till en annan plats"]`),null)
  }
  // Once connected, the same target is no longer offered.
  await page.locator(`${rootDoc} button[aria-label="Kopiera till en annan plats"]`).click()
  assert.equal(await page.$eval(answerNode(yes),node=>node.dataset.flowTarget),'false')
  await page.keyboard.press('Escape')
  await page.locator(`${triggerDoc(yes)} button[aria-label="Ta bort från flödet"]`).click()
  await page.waitForSelector('dialog[open]')
  assert.equal(yes.triggers.length,1)
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Avbryt"])').click()
  assert.equal(yes.triggers.length,1)
  await page.locator(`${triggerDoc(yes)} button[aria-label="Ta bort från flödet"]`).click()
  await page.waitForSelector('dialog[open]')
  await page.screenshot({path:resolve(output,'unlink-confirmation.png')})
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Ta bort kopplingen"])').click()
  await page.waitForSelector(triggerDoc(yes),{hidden:true})
  assert.equal(requirements.length,1);assert.equal(yes.triggers.length,0);assert.equal(docs.length,1)
  assert.ok(writes.every(write=>write.key==='flow-move'))
  console.log('PASS copy/remove: existing entity reused, no definition writes, duplicate targets excluded, removal affects only connection')

  await page.locator(`${questionNode} button[aria-label="Flytta koppling"]`).click()
  assert.equal(await page.$eval(answerNode(yes),node=>node.dataset.flowTarget),'false')
  assert.equal(await page.$eval(answerNode(no),node=>node.dataset.flowTarget),'false')
  await page.keyboard.press('Escape')
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
  await chooseMove(rootDoc,answerNode(yes))
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
    assert.equal(await page.$('dialog[open]'),null)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    if(width===390)assert.ok(await page.$eval('[role="status"] span.font-semibold',node=>node.getBoundingClientRect().width)>200)
    await page.screenshot({path:resolve(output,`move-targets-${width}.png`)})
    // Enter on the full-card target button supports keyboard as well as pointer selection.
    await page.focus(`${answerNode(yes)} button[aria-label^="Koppla hit:"]`)
    await page.keyboard.press('Enter')
    await page.waitForFunction(()=>document.querySelector('dialog')?.textContent.includes('alla renoveringsflöden'))
    assert.equal(await page.$eval('dialog',node=>node.scrollWidth>node.clientWidth),false)
    await page.screenshot({path:resolve(output,`confirmation-${width}.png`)})
    await page.keyboard.press('Escape')
    console.log(`PASS ${width}px: diagram and keyboard-accessible move dialog render without page overflow`)
  }
  // A stale confirmation must not change the source or retry a write automatically.
  await chooseMove(triggerDoc(no),answerNode(yes))
  await page.waitForFunction(()=>document.querySelector('dialog')?.textContent.includes('alla renoveringsflöden'))
  moveFailure=409
  const beforeFailure=writes.length
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Flytta koppling"])').click()
  await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('Flödet har ändrats'))
  await page.waitForSelector('dialog',{hidden:true})
  assert.equal(writes.length,beforeFailure+1);assert.equal(no.triggers.length,1);assert.equal(yes.triggers.length,0)
  console.log('PASS stale apply: source retained, configuration reloaded, no automatic retry')
  // A missing migration or a failed preview must never fall back to separate writes.
  moveFailure=503
  const count=writes.length
  await page.locator(`${triggerDoc(no)} button[aria-label="Flytta koppling"]`).click()
  await page.locator(`${answerNode(yes)} button[aria-label^="Koppla hit:"]`).click()
  await page.waitForFunction(()=>document.body.textContent.includes('Databasuppdateringen'))
  assert.equal(writes.length,count+1);assert.equal(no.triggers.length,1)
  assert.deepEqual(errors,[])
  console.log('PASS missing migration: clear error, no configuration changes')
  const beforeFailedCopy=writes.length
  await page.locator(`${triggerDoc(no)} button[aria-label="Kopiera till en annan plats"]`).click()
  await clickTarget(answerNode(yes))
  copyFailure=true
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Koppla hit"])').click()
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role="alert"]')).some(node=>node.textContent.includes('Kopplingen kunde inte skapas')))
  assert.equal(writes.length,beforeFailedCopy+2);assert.equal(no.triggers.length,1);assert.equal(yes.triggers.length,0)
  console.log('PASS failed copy: original retained, no link or blind retry, error displayed')

  // Regression for the kitchen branch in the reported screenshot.
  fixture=compactFlowResponses
  const writesBeforeLayout=writes.length
  await page.setViewport({width:1440,height:1100})
  await page.reload({waitUntil:'networkidle0'})
  await page.waitForFunction(()=>document.querySelectorAll('[data-flow-id]').length>=29)
  await page.locator('button[aria-label="Återställ kortens placering"]').click()
  const cards=await page.$$eval('[data-flow-id]',nodes=>nodes.map(card=>{
    const wrapper=card.closest('.react-flow__node')
    const [x,y]=wrapper.style.transform.match(/-?[\d.]+/g).map(Number)
    const title=card.querySelector('button[aria-label^="Öppna "]')
    const header=card.querySelector('.flow-drag-handle').parentElement
    return {id:card.dataset.flowId,x,y,width:card.offsetWidth,height:card.offsetHeight,title:title?.textContent,
      overflow:header.scrollWidth>header.clientWidth,titleOverflow:title?.scrollHeight>title?.clientHeight}
  }))
  assert.deepEqual(cards.filter(card=>card.width!==224 || card.height>117 || card.overflow || card.titleOverflow),[])
  const wall=cards.find(card=>card.title===compactWallQuestion)
  const [yesCard,noCard]=compactWallAnswerIds.map(id=>cards.find(card=>card.id.endsWith(':'+id)))
  assert.ok(yesCard.height<=84 && noCard.height<=84,'short answers must no longer reserve three title lines')
  assert.equal(yesCard.x-wall.x-wall.width,40)
  assert.equal(noCard.x,yesCard.x)
  assert.ok(noCard.y-yesCard.y-yesCard.height<=24,'Yes/No must stay together rather than spreading across other branches')
  for(let a=0;a<cards.length;a++)for(let b=a+1;b<cards.length;b++){
    const one=cards[a],two=cards[b]
    assert.equal(one.x<two.x+two.width && one.x+one.width>two.x && one.y<two.y+two.height && one.y+one.height>two.y,false,`${one.id} overlaps ${two.id}`)
  }
  for(const width of [1440,1024,390]){
    await page.setViewport({width,height:1100})
    await page.locator('button[aria-label="Visa hela flödet"]').click()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await page.screenshot({path:resolve(output,`compact-kitchen-${width}.png`)})
  }
  assert.equal(writes.length,writesBeforeLayout)
  assert.deepEqual(errors,[])
  console.log('PASS compact kitchen layout: content-sized cards, clustered answers, no overlap or configuration writes')

  // Reuse the reported question with its complete branch, then unlink that occurrence.
  copyFailure=false
  const beforeKitchen=structuredClone(fixture)
  const wallSelector=`[data-flow-id^="question:"][data-flow-id$=":${id(140)}"]`
  const recipient=`[data-flow-id="option:${id(101)}:${id(110)}"]`
  await page.setViewport({width:1440,height:1100})
  await page.locator('button[aria-label="Visa hela flödet"]').click()
  await page.locator(`${wallSelector} button[aria-label="Kopiera till en annan plats"]`).click()
  await clickTarget(recipient)
  assert.deepEqual(fixture,beforeKitchen)
  await page.screenshot({path:resolve(output,'reuse-question-confirmation.png')})
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Koppla hit"])').click()
  await page.waitForFunction(selector=>document.querySelectorAll(selector).length===2,{},wallSelector)
  await page.locator('::-p-xpath(//button[normalize-space(.)="Expandera alla"])').click()
  await page.waitForFunction(()=>document.querySelectorAll('[data-flow-id]').length===33)
  assert.equal(fixture.questions.items.length,beforeKitchen.questions.items.length)
  assert.deepEqual(fixture.questions.items.find(q=>q.id===id(140)),beforeKitchen.questions.items.find(q=>q.id===id(140)))
  assert.equal((await page.$$(`[data-flow-id="document:${id(141)}:${id(200)}"]`)).length,2)
  await page.screenshot({path:resolve(output,'reused-question-branch.png')})
  const occurrences=await page.$$(wallSelector)
  let copiedOccurrence
  for(const card of occurrences)if(await card.evaluate((node,parent)=>node.closest('.react-flow__node').dataset.id.includes(parent),id(110)))copiedOccurrence=card
  assert.ok(copiedOccurrence)
  await (await copiedOccurrence.$('button[aria-label="Ta bort från flödet"]')).click()
  await page.waitForSelector('dialog[open]')
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Ta bort kopplingen"])').click()
  await page.waitForFunction(()=>document.querySelectorAll('[data-flow-id]').length===29)
  await page.reload({waitUntil:'networkidle0'})
  await page.locator('::-p-xpath(//button[normalize-space(.)="Expandera alla"])').click()
  await page.waitForFunction(()=>document.querySelectorAll('[data-flow-id]').length===29)
  assert.deepEqual(fixture,beforeKitchen)
  assert.ok(writes.every(write=>write.key==='flow-move'))
  assert.deepEqual(errors,[])
  console.log('PASS question reuse: same question/answers/descendants at two places, unlink/reload retain all original data')

  fixture=null;moveFailure=null;copyFailure=false
  await page.reload({waitUntil:'networkidle0'})
  await page.locator('::-p-xpath(//button[normalize-space(.)="Expandera alla"])').click()
  const clickText = text => page.locator(`::-p-xpath(//aside//button[normalize-space(.)="${text}"])`).click()
  const fillField = (label,value) => page.locator(`::-p-xpath(//aside//label[span[normalize-space(.)="${label}"]]//input)`).fill(value)
  const openEdit = async selector => {
    await page.locator(`${selector} button[aria-label^="Öppna "]`).click()
    await clickText('Redigera')
  }
  const saved = () => page.waitForFunction(()=>document.querySelector('[data-flow-save-status]')?.textContent==='Alla ändringar sparade.')
  await page.locator(`${questionNode} button[aria-label="Fäll ihop"]`).click()
  await openEdit(questionNode)
  await fillField('Visningsnamn','Fråga version ett?')
  const readsBeforeEdit=gets, writesBeforeEdit=writes.length
  const releaseEdits=holdWrites()
  await clickText('Spara')
  await page.waitForFunction(()=>document.querySelector('[data-flow-save-status]')?.textContent.includes('Sparar i bakgrunden'))
  assert.equal(writes.length,writesBeforeEdit+1)
  assert.equal(await page.$eval('aside fieldset',node=>node.disabled),false)
  await clickText('Stäng')
  // Reopening before save completion must retain the latest submitted draft.
  await openEdit(questionNode)
  assert.equal(await page.$eval('aside input',node=>node.value),'Fråga version ett?')
  await fillField('Visningsnamn','Fråga version två?')
  await clickText('Spara')
  await clickText('Stäng')
  assert.equal(await page.$(answerNode(yes)),null,'saving must not reopen a manually collapsed branch')
  await page.locator(`${questionNode} button[aria-label="Expandera"]`).click()
  await openEdit(answerNode(yes))
  await fillField('Svarstext','Ja, påverkas')
  await clickText('Spara')
  await clickText('Stäng')
  await openEdit(answerNode(no))
  await fillField('Svarstext','Nej, påverkas inte')
  await clickText('Spara')
  await clickText('Stäng')
  assert.equal(writes.length,writesBeforeEdit+1,'waiting jobs must not run concurrently')
  assert.equal(await page.evaluate(()=>{
    const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented
  }),true,'leaving during a pending save must warn')
  assert.equal(await page.$eval('button[aria-label="Zooma in"]',node=>node.disabled),false)
  await page.locator('button[aria-label="Zooma in"]').click()
  await page.screenshot({path:resolve(output,'background-saving.png')})
  releaseEdits()
  await saved()
  assert.equal(maxActiveWrites,1)
  assert.equal(question.label,'Fråga version två?')
  assert.equal(yes.label,'Ja, påverkas')
  assert.equal(no.label,'Nej, påverkas inte')
  assert.equal(no.triggers.length,1)
  assert.equal(gets,readsBeforeEdit,'ordinary editing must not refetch the nine configuration endpoints')
  assert.equal(writes.slice(writesBeforeEdit).filter(write=>write.key==='questions' && write.method==='PATCH').length,4)
  assert.ok(writes.slice(writesBeforeEdit).every(write=>!('options' in write.input)),'text edits never rewrite options/triggers')
  console.log('PASS background editing: StrictMode, FIFO, responsive form/canvas, reopening pending draft, no redundant reloads')

  // A failed first save must not cancel another queued edit or discard the captured input.
  await openEdit(answerNode(yes))
  await fillField('Svarstext','Behåll vid sparfel')
  patchFailure=true
  await clickText('Spara')
  await clickText('Stäng')
  await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('Testfel vid sparande'))
  assert.equal(yes.label,'Ja, påverkas')
  patchFailure=false
  await openEdit(answerNode(no))
  await fillField('Svarstext','Nej efter sparfel')
  await clickText('Spara')
  await page.waitForFunction(()=>document.querySelector('[data-flow-save-status]')?.textContent==='Alla ändringar kunde inte sparas.')
  await clickText('Stäng')
  assert.equal(no.label,'Nej efter sparfel')
  await page.locator('::-p-xpath(//button[normalize-space(.)="Öppna ändringen"])').click()
  assert.equal(await page.$eval('aside input',node=>node.value),'Behåll vid sparfel')
  await clickText('Spara')
  await saved()
  assert.equal(yes.label,'Behåll vid sparfel')
  await clickText('Stäng')
  assert.equal(await page.$('[role="alert"]'),null)
  console.log('PASS save failure: error persists across other successful saves, draft restored, explicit retry succeeds')

  // Confirmed graph changes run in the same background queue.
  await page.locator('button[aria-label="Visa hela flödet"]').click()
  await page.locator(`${triggerDoc(no)} button[aria-label="Kopiera till en annan plats"]`).click()
  await clickTarget(answerNode(yes))
  const releaseCopy=holdWrites()
  await page.locator('::-p-xpath(//dialog//button[normalize-space(.)="Koppla hit"])').click()
  await page.waitForSelector('dialog',{hidden:true})
  assert.equal(await page.$eval('button[aria-label="Zooma in"]',node=>node.disabled),false)
  await openEdit(answerNode(yes))
  await fillField('Svarstext','Ändrat medan kopian sparades')
  await clickText('Spara')
  await clickText('Stäng')
  releaseCopy()
  await saved()
  assert.equal(yes.triggers.length,1)
  assert.equal(no.triggers.length,1)
  assert.equal(yes.label,'Ändrat medan kopian sparades')
  assert.equal(maxActiveWrites,1)
  assert.deepEqual(errors,[])
  console.log('PASS graph save: dialog closes immediately, editor remains usable, follow-up edit preserves new connection')

  let releaseReads
  readGate=new Promise(resolve=>{releaseReads=()=>{readGate=null;resolve()}})
  releaseGates.push(releaseReads)
  await page.locator('button[aria-label="Ladda om flödet"]').click()
  await openEdit(questionNode)
  await fillField('Visningsnamn','Nyare än omladdningen?')
  await clickText('Spara')
  await saved()
  releaseReads()
  await page.waitForNetworkIdle()
  await clickText('Stäng')
  assert.equal(await page.$eval(`${questionNode} button[aria-label^="Öppna "]`,node=>node.textContent),'Nyare än omladdningen?')
  console.log('PASS stale refresh: an older read cannot replace a confirmed edit')

  await openEdit(answerNode(no))
  await fillField('Svarstext','Sparas i rätt flöde')
  const releaseSwitch=holdWrites()
  await clickText('Spara')
  await clickText('Stäng')
  await page.locator('::-p-xpath(//button[normalize-space(.)="Kök"])').click()
  await page.waitForSelector(`[data-flow-id="action-type:${secondAction.id}"]`)
  releaseSwitch()
  await saved()
  assert.equal(no.label,'Sparas i rätt flöde')
  assert.ok(await page.$(`[data-flow-id="action-type:${secondAction.id}"]`),'background save must not change current flow')
  console.log('PASS flow switch: page-owned queue retains the original write without switching back')

  await page.locator('::-p-xpath(//button[normalize-space(.)="Riva vägg"])').click()
  await page.locator('::-p-xpath(//button[normalize-space(.)="Expandera alla"])').click()
  await openEdit(answerNode(yes))
  await clickText('Lägg till')
  await clickText('Underlag')
  await clickText('Skapa ny')
  await fillField('Visningsnamn','Nytt underlag i bakgrunden')
  const releaseAdd=holdWrites()
  await clickText('Spara + Ny')
  assert.equal(await page.$eval('aside input',node=>node.value),'')
  await fillField('Visningsnamn','Nästa underlag')
  releaseAdd()
  await saved()
  assert.equal(await page.$eval('aside input',node=>node.value),'Nästa underlag','completion must not clear a newer draft')
  assert.equal(docs.filter(item=>item.label==='Nytt underlag i bakgrunden').length,1)
  assert.equal(yes.triggers.length,2)
  assert.equal(no.triggers.length,1)
  assert.equal(yes.label,'Ändrat medan kopian sparades')
  await clickText('Stäng')
  assert.equal(maxActiveWrites,1)
  assert.deepEqual(errors,[])
  console.log('PASS add/save-and-new: resets immediately, retains next draft, no duplicate definition or lost branch')

  await openEdit(answerNode(yes))
  await clickText('Lägg till')
  await clickText('Underlag')
  await clickText('Skapa ny')
  await fillField('Visningsnamn','Återanvänd efter sparfel')
  linkFailure=true
  await clickText('Spara')
  await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('Testfel efter skapad definition'))
  const created=docs.find(item=>item.label==='Återanvänd efter sparfel')
  assert.ok(created)
  assert.equal(yes.triggers.some(trigger=>trigger.documentTypeId===created.id),false)
  linkFailure=false
  const writesBeforeRecovery=writes.length
  await page.locator('::-p-xpath(//button[normalize-space(.)="Öppna ändringen"])').click()
  await clickText('Spara')
  await saved()
  assert.equal(docs.filter(item=>item.label===created.label).length,1)
  assert.equal(yes.triggers.filter(trigger=>trigger.documentTypeId===created.id).length,1)
  assert.equal(writes.slice(writesBeforeRecovery).some(write=>write.key==='document-types'),false)
  assert.equal(await page.$('[role="alert"]'),null)
  assert.deepEqual(errors,[])
  console.log('PASS partial add recovery: reuses acknowledged definition and clears only the retried failure')
}catch(error){await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true});throw error}
finally{releaseGates.forEach(release=>release());await browser?.close();await new Promise(done=>server.close(done))}
