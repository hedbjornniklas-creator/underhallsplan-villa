import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { validateStagingKeys } from './lib/ob-staging-app.mjs'
import { settingsTables, settingsProbeRows, settingsEditorPaths } from './lib/ob-settings-rehearsal.mjs'

const folder=fileURLToPath(new URL('../.cache/ob-staging-app/',import.meta.url))
const keys=validateStagingKeys(JSON.parse(await readFile(join(folder,'keys.json'),'utf8')))
const fixture=JSON.parse(await readFile(join(folder,'fixtures.json'),'utf8'))
assert.equal(fixture.project,keys.url)
const realFetch=globalThis.fetch
globalThis.fetch=(input,options)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url)
  assert.ok([keys.url,'http://127.0.0.1:57100'].includes(url.origin))
  return realFetch(input,options)
}
const db=createClient(keys.url,keys.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const anon=createClient(keys.url,keys.anonKey,{auth:{persistSession:false,autoRefreshToken:false}})
async function checked(request) { const {data,error}=await request; assert.equal(error,null,error?.message);return data }
async function identity(person) {
  const cookies=new Map()
  const client=createServerClient(keys.url,keys.anonKey,{cookies:{
    getAll:()=>[...cookies].map(([name,value])=>({name,value})),
    setAll:all=>all.forEach(c=>cookies.set(c.name,c.value)),
  }})
  assert.equal((await checked(client.auth.signInWithPassword({email:person.email,password:person.password}))).user.id,person.id)
  return {client,cookies}
}
async function snapshot() {
  const result={}
  for(const table of settingsTables) {
    result[table]=[]
    for(let offset=0;;offset+=500) {
      const page=await checked(db.from(table).select('*').order('id').range(offset,offset+499))
      result[table].push(...page)
      if(page.length<500)break
    }
  }
  for(const table of ['ob_inspection_structure','ob_inspection_buildings','ob_building_conditions','inspection_interior_rooms',
    'inspection_control_items','inspection_images','inspection_report_links','inspection_overview_selections']) {
    result[table]=await checked(db.from(table).select('*').eq('inspection_id',fixture.inspection).order(table==='ob_inspection_structure'?'inspection_id':'id'))
  }
  result.profiles=await checked(db.from('profiles').select('*').in('id',[fixture.owner.id,fixture.stranger.id]).order('id'))
  return result
}
const prepare=process.argv.includes('--prepare')
const cleanupOnly=process.argv.includes('--cleanup')
const output=prepare?join(folder,'ob-settings-'+Date.now()):resolve(process.argv[2]??'')
assert.equal(resolve(output,'..'),resolve(folder))
assert.match(output.split(/[\\/]/).pop(),/^ob-settings-\d+$/)
let run, accounts, browser, currentPage, cleanupAllowed=false
const save=()=>writeFile(join(output,'manifest.json'),JSON.stringify(run,null,2))
const pass=name=>{run.checks.push(name);console.log('PASS '+name)}
try {
  if(prepare) {
    const latest=JSON.parse(await readFile(join(folder,'component-catalogue-latest.json'),'utf8'))
    assert.equal(latest.authorityRemoved,true)
    assert.equal(resolve(latest.output,'..'),resolve(folder))
    await mkdir(output)
    run={project:keys.url,inspection:fixture.inspection,accounts:latest.output,
      assignment:randomUUID(),rows:settingsProbeRows(),checks:[],completed:false}
    await save()
    await writeFile(join(output,'before.json'),JSON.stringify(await snapshot()))
    console.log(JSON.stringify({prepared:true,project:keys.url,output}))
  } else {
    run=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'))
    assert.equal(run.project,keys.url)
    assert.equal(run.inspection,fixture.inspection)
    assert.equal(resolve(run.accounts,'..'),resolve(folder))
    assert.match(run.accounts.split(/[\\/]/).pop(),/^component-catalogue-\d+$/)
    accounts=JSON.parse(await readFile(join(run.accounts,'manifest.json'),'utf8'))
    assert.equal(accounts.project,keys.url)
    assert.notEqual(accounts.org,fixture.org)
    for(const person of Object.values(accounts.people)) {
      assert.match(person.email,/^catalogue-(inspector|legacy|admin)-[a-f0-9-]+@example\.invalid$/)
      assert.ok(![fixture.owner.id,fixture.stranger.id].includes(person.id))
      if(!cleanupOnly) assert.equal((await checked(db.from('profiles').select('is_admin').eq('id',person.id).single())).is_admin,false)
    }
    const before=JSON.parse(await readFile(join(output,'before.json'),'utf8'))
    for(const table of settingsTables) assert.ok(!before[table].some(row=>row.id===run.rows[table].id))
    if(cleanupOnly) cleanupAllowed=true
    else {
    assert.deepEqual(await snapshot(),before)
    run.checks=[];run.completed=false;run.authorityRemoved=false
    await save()
    pass('All 19 catalogues, original inspection tables and original profiles unchanged by migration')
    const inspector=await identity(accounts.people.inspector), legacy=await identity(accounts.people.legacy), admin=await identity(accounts.people.admin)
    cleanupAllowed=true
    await checked(db.from('profiles').update({is_admin:true}).eq('id',accounts.people.legacy.id))
    await checked(db.from('platform_access_assignments').insert({id:run.assignment,profile_id:accounts.people.admin.id,
      product_id:accounts.product,module_id:accounts.module,role_id:accounts.role,scope_type:'global',scope_id:null,is_active:true,source_system:'ob-settings-staging'}))
    for(const table of settingsTables) await checked(db.from(table).insert(run.rows[table]))
    for(const table of settingsTables) {
      const row=run.rows[table]
      assert.equal((await anon.from(table).select('id').limit(1)).error?.code,'42501',table)
      await checked(inspector.client.from(table).select('*').eq('id',row.id).single())
      assert.equal((await inspector.client.from(table).insert({...row,id:randomUUID()})).error?.code,'42501',table)
      assert.equal((await inspector.client.from(table).upsert({...row,is_active:true})).error?.code,'42501',table)
      assert.deepEqual(await checked(inspector.client.from(table).update({is_active:true}).eq('id',row.id).select('id')),[],table)
      assert.deepEqual(await checked(inspector.client.from(table).delete().eq('id',row.id).select('id')),[],table)
    }
    pass('Real anonymous/ordinary JWTs cannot mutate any catalogue; inspector reads remain available')
    for(const actor of [legacy.client,admin.client]) {
      assert.equal(await checked(actor.rpc('is_hushub_besiktapp_admin')),true)
      // These rows are inactive, uniquely keyed, and never attached to an inspection.
      for(const table of [...settingsTables].reverse()) await checked(actor.from(table).delete().eq('id',run.rows[table].id).select('id').single())
      for(const table of settingsTables) {
        await checked(actor.from(table).insert(run.rows[table]).select('id').single())
        await checked(actor.from(table).update({is_active:false}).eq('id',run.rows[table].id).select('id').single())
      }
    }
    pass('Both global-admin models retain INSERT/UPDATE/DELETE through all 19 catalogues')
    for(const patch of [{is_active:false},{expires_at:'2000-01-01T00:00:00Z'},
      {scope_type:'organization',scope_id:accounts.org},{module_id:accounts.otherModule}]) {
      await checked(db.from('platform_access_assignments').update({is_active:true,expires_at:null,scope_type:'global',scope_id:null,module_id:accounts.module,...patch}).eq('id',run.assignment))
      assert.equal(await checked(admin.client.rpc('is_hushub_besiktapp_admin')),false)
      for(const table of settingsTables) assert.deepEqual(await checked(admin.client.from(table).update({is_active:true}).eq('id',run.rows[table].id).select('id')),[],table)
    }
    await checked(db.from('platform_access_assignments').update({is_active:true,expires_at:null,scope_type:'global',scope_id:null,module_id:accounts.module}).eq('id',run.assignment))
    pass('Revoked, expired, organization-scoped and other-module authority rejected across all catalogues')
    if(process.argv.includes('--ui')) {
      const running=JSON.parse(await readFile(join(folder,'running.json'),'utf8'))
      assert.equal(running.url,'http://127.0.0.1:57100')
      assert.equal((await fetch(running.url+'/staging')).headers.get('x-ob-test-project'),new URL(keys.url).hostname)
      for(const person of Object.values(accounts.people)) await checked(db.from('org_members').upsert({org_id:accounts.org,profile_id:person.id,role:'inspector',is_active:true,is_default:true},{onConflict:'org_id,profile_id'}))
      const {default:puppeteer}=await import('puppeteer-core')
      browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
      for(const [name,actor] of Object.entries({inspector,legacy,admin})) {
        const context=await browser.createBrowserContext()
        await context.setCookie(...[...actor.cookies].map(([name,value])=>({name,value,url:running.url,httpOnly:false,sameSite:'Lax'})))
        const page=await context.newPage()
        currentPage=page
        const errors=[]
        page.on('pageerror',error=>errors.push(error.message))
        page.on('response',response=>{
          const url=new URL(response.url())
          if(url.origin===keys.url&&settingsTables.includes(url.pathname.replace('/rest/v1/',''))&&response.status()>=400) errors.push('Catalogue HTTP '+response.status()+': '+url.pathname)
        })
        await page.setRequestInterception(true)
        page.on('request',request=>{
          const url=new URL(request.url())
          if(['data:','blob:'].includes(url.protocol)||[running.url,keys.url].includes(url.origin))void request.continue()
          else void request.abort()
        })
        await page.setViewport({width:390,height:844})
        for(const path of [...settingsEditorPaths,...(name==='inspector'?[]:['/admin/besiktapp?tab=docs'])]) {
          await page.goto(running.url+path,{waitUntil:'networkidle0',timeout:60000})
          await page.waitForFunction(()=>!document.body.innerText.includes('Kontrollerar behörighet...'),{timeout:30000})
          if(name!=='inspector') await page.waitForFunction(()=>document.querySelector('h1')?.textContent?.trim(),{timeout:30000})
          const state=await page.evaluate(()=>({text:document.body.innerText,heading:document.querySelector('h1')?.textContent??''}))
          if(name==='inspector') assert.match(state.text,/Åtkomst nekad/)
          else { assert.doesNotMatch(state.text,/Åtkomst nekad|Behörigheten kunde inte kontrolleras/);assert.match(state.heading,/Förutsättningar|Handlingar|Kontrollpunkter|Insida|Utsida|Systeminställningar/) }
          await page.screenshot({path:join(output,`ui-${name}-${path.split('/').pop().replaceAll('?','-').replaceAll('=','-')}.png`)})
        }
        if(name==='admin') {
          await checked(db.from('platform_access_assignments').update({is_active:false}).eq('id',run.assignment))
          await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
          await page.waitForFunction(()=>document.body.innerText.includes('Åtkomst nekad'))
          assert.equal(await page.evaluate(()=>document.querySelectorAll('main input,main textarea,main select').length),0)
        }
        assert.deepEqual(errors,[])
        await context.close()
      }
      pass('Five actual editors and admin page enforce permission states; revocation closes the editor')
    }
    run.completed=true
    }
  }
} catch(error) {
  if(run) {
    run.completed=false
    run.failure=String(error)
    if(currentPage&&!currentPage.isClosed()) {
      await currentPage.screenshot({path:join(output,'ui-failure-'+Date.now()+'.png')}).catch(()=>{})
      await writeFile(join(output,'ui-failure.txt'),await currentPage.evaluate(()=>document.body.innerText).catch(()=>String(error)))
    }
    await save()
  }
  throw error
} finally {
  await browser?.close().catch(()=>{})
  if(cleanupAllowed) {
    const failures=[]
    // Retry only exact-ID, idempotent cleanup; a failed data cleanup must not leave authority behind.
    const attempt=async (label,operation)=>{
      for(let count=0;count<3;count++) {
        try { await operation();return } catch(error) {
          if(count===2) failures.push(label+': '+String(error))
          else await new Promise(done=>setTimeout(done,1000))
        }
      }
    }
    await attempt('admin flag',()=>checked(db.from('profiles').update({is_admin:false}).eq('id',accounts.people.legacy.id)))
    await attempt('assignment',()=>checked(db.from('platform_access_assignments').delete().eq('id',run.assignment).eq('profile_id',accounts.people.admin.id)))
    for(const person of Object.values(accounts.people)) await attempt('membership',()=>checked(db.from('org_members').delete().eq('org_id',accounts.org).eq('profile_id',person.id)))
    for(const table of [...settingsTables].reverse()) await attempt(table,()=>checked(db.from(table).delete().eq('id',run.rows[table].id)))
    for(const person of Object.values(accounts.people)) await attempt('verify flag',async ()=>assert.equal((await checked(db.from('profiles').select('is_admin').eq('id',person.id).single())).is_admin,false))
    await attempt('verify assignment',async ()=>assert.deepEqual(await checked(db.from('platform_access_assignments').select('id').eq('id',run.assignment)),[]))
    await attempt('snapshot equality',async ()=>assert.deepEqual(await snapshot(),JSON.parse(await readFile(join(output,'before.json'),'utf8'))))
    run.cleanupFailures=failures
    run.authorityRemoved=failures.length===0
    if(failures.length) {run.completed=false;process.exitCode=1;console.error('Cleanup needs attention: '+failures.join('\n'))}
    else pass('Probe rows/temporary authority removed; original catalogue and inspection snapshots unchanged')
  }
  if(run) {
    await save()
    await writeFile(join(folder,'ob-settings-latest.json'),JSON.stringify({completed:run.completed,authorityRemoved:run.authorityRemoved,checks:run.checks,output},null,2))
  }
}
