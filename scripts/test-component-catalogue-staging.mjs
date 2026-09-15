import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { validateStagingKeys } from './lib/ob-staging-app.mjs'

const folder=fileURLToPath(new URL('../.cache/ob-staging-app/',import.meta.url))
const keys=validateStagingKeys(JSON.parse(await readFile(join(folder,'keys.json'),'utf8')))
const fixture=JSON.parse(await readFile(join(folder,'fixtures.json'),'utf8'))
assert.equal(fixture.project,keys.url)
const fetchReal=globalThis.fetch
globalThis.fetch=(input,options) => {
  const url=new URL(typeof input==='string'||input instanceof URL ? input : input.url)
  assert.ok([keys.url,'http://127.0.0.1:57100'].includes(url.origin),'Only staging and guarded loopback')
  return fetchReal(input,options)
}
const db=createClient(keys.url,keys.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const anon=createClient(keys.url,keys.anonKey,{auth:{persistSession:false,autoRefreshToken:false}})
async function checked(request) { const {data,error}=await request; assert.equal(error,null,error?.message); return data }
async function identity(person) {
  const cookies=new Map()
  const client=createServerClient(keys.url,keys.anonKey,{cookies:{
    getAll:()=>[...cookies].map(([name,value])=>({name,value})),
    setAll:values=>values.forEach(c=>cookies.set(c.name,c.value)),
  }})
  const session=await checked(client.auth.signInWithPassword({email:person.email,password:person.password}))
  assert.equal(session.user.id,person.id)
  return {client,cookies}
}
async function originalSnapshot() {
  const result={}
  for (const table of ['ob_inspection_structure','ob_inspection_buildings','ob_building_conditions',
    'inspection_interior_rooms','inspection_control_items','inspection_images','inspection_report_links']) {
    result[table]=await checked(db.from(table).select('*').eq('inspection_id',fixture.inspection)
      .order(table==='ob_inspection_structure'?'inspection_id':'id'))
  }
  result.profiles=await checked(db.from('profiles').select('*').in('id',[fixture.owner.id,fixture.stranger.id]).order('id'))
  result.component_types=await checked(db.from('component_types').select('*').order('id'))
  result.components=await checked(db.from('components').select('*').order('id'))
  result.components_calc=await checked(db.from('components_calc').select('*').order('id'))
  return result
}
const prepare=process.argv.includes('--prepare')
const output=prepare?join(folder,`component-catalogue-${Date.now()}`):resolve(process.argv[2]??'')
assert.equal(resolve(output,'..'),resolve(folder))
assert.match(output.split(/[\\/]/).pop(),/^component-catalogue-\d+$/)
let run, browser
let cleanupAllowed=false
const save=()=>writeFile(join(output,'manifest.json'),JSON.stringify(run,null,2))
const pass=name=>{run.checks.push(name);console.log(`PASS ${name}`)}
try {
  if(prepare) {
    await mkdir(output)
    run={project:keys.url,inspection:fixture.inspection,assignment:randomUUID(),type:randomUUID(),checks:[],completed:false,
      people:Object.fromEntries(['inspector','legacy','admin'].map(role=>[role,{email:`catalogue-${role}-${randomUUID()}@example.invalid`,password:randomBytes(24).toString('base64url')}]))}
    await save()
    await writeFile(join(output,'before.json'),JSON.stringify(await originalSnapshot()))
    for(const [name,person] of Object.entries(run.people)) {
      const {user}=await checked(db.auth.admin.createUser({email:person.email,password:person.password,email_confirm:true}))
      person.id=user.id
      await save()
      await checked(db.from('profiles').upsert({id:user.id,full_name:`TEST catalogue ${name}`,email:person.email,is_admin:false}))
    }
    // No existing test user is promoted. Temporary admin rights are granted only during verification.
    const catalog=async (table,key,productId) => {
      let query=db.from(table).select('id').eq('key',key)
      if(productId) query=query.eq('product_id',productId)
      const found=await checked(query.maybeSingle())
      return found?.id ?? (await checked(db.from(table).insert({key,label:`TEST ${key}`,...(productId?{product_id:productId}:{})}).select('id').single())).id
    }
    run.product=await catalog('platform_products','hushub_admin')
    run.module=await catalog('platform_modules','besiktapp_admin',run.product)
    run.role=await catalog('platform_roles','product_admin',run.product)
    run.otherModule=await catalog('platform_modules','renoapp_admin',run.product)
    await save()
    console.log(JSON.stringify({prepared:true,project:keys.url,output}))
  } else {
    run=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'))
    assert.equal(run.project,keys.url)
    assert.equal(run.inspection,fixture.inspection)
    for(const person of Object.values(run.people)) {
      assert.match(person.email,/^catalogue-(inspector|legacy|admin)-[a-f0-9-]+@example\.invalid$/)
      assert.ok(![fixture.owner.id,fixture.stranger.id].includes(person.id))
    }
    run.checks=[]; run.completed=false; run.authorityRemoved=false
    await save()
    const before=JSON.parse(await readFile(join(output,'before.json'),'utf8'))
    assert.ok(!before.component_types.some(row=>row.id===run.type),'Never delete a baseline catalogue record')
    assert.notEqual(run.org,fixture.org,'Never use the original fixture organization')
    assert.deepEqual(await originalSnapshot(),before)
    pass('Migration preserves original inspection, profiles, catalogue records and calculated values')
    const inspector=await identity(run.people.inspector), legacy=await identity(run.people.legacy), admin=await identity(run.people.admin)
    cleanupAllowed=true
    if(!run.org) {
      run.org=randomUUID()
      await checked(db.from('organizations').insert({id:run.org,name:'TEST catalogue access'}))
      await save()
    }
    for(const person of [run.people.inspector,run.people.admin]) {
      await checked(db.from('org_members').upsert({org_id:run.org,profile_id:person.id,role:'inspector',is_active:true,is_default:true},{onConflict:'org_id,profile_id'}))
    }
    await checked(db.from('profiles').update({is_admin:true}).eq('id',run.people.legacy.id))
    await checked(db.from('platform_access_assignments').upsert({id:run.assignment,profile_id:run.people.admin.id,
      product_id:run.product,module_id:run.module,role_id:run.role,scope_type:'global',scope_id:null,is_active:true,expires_at:null,source_system:'catalogue-staging-test'}))
    await checked(db.from('component_types').insert({id:run.type,name:'TEST permission probe',default_lifespan_years:30}))
    assert.equal(await checked(inspector.client.rpc('is_hushub_besiktapp_admin')),false)
    assert.equal(await checked(legacy.client.rpc('is_hushub_besiktapp_admin')),true)
    assert.equal(await checked(admin.client.rpc('is_hushub_besiktapp_admin')),true)
    for(const table of ['profiles','platform_access_assignments','component_types']) assert.equal((await anon.from(table).select('id').limit(1)).error?.code,'42501')
    await checked(inspector.client.from('component_types').select('id,name').eq('id',run.type).single())
    assert.equal((await inspector.client.from('component_types').insert({name:'FORBIDDEN',default_lifespan_years:1})).error?.code,'42501')
    assert.deepEqual(await checked(inspector.client.from('component_types').update({name:'FORBIDDEN'}).eq('id',run.type).select('id')),[])
    assert.deepEqual(await checked(inspector.client.from('component_types').delete().eq('id',run.type).select('id')),[])
    pass('Anonymous denied; ordinary JWT reads but cannot insert, update or delete catalogue rows')
    for(const [name,person] of Object.entries(run.people)) {
      const actor={inspector,legacy,admin}[name].client
      assert.equal((await actor.from('profiles').update({is_admin:true}).eq('id',person.id)).error?.code,'42501')
      assert.equal((await actor.from('profiles').upsert({id:person.id,is_admin:true})).error?.code,'42501')
      await checked(actor.from('profiles').upsert({id:person.id,full_name:`TEST saved ${name}`,phone:'123',
        email:person.email,company_name:'TEST Company',company_orgno:'TEST',company_address:'Testgatan',company_postal_code:'12345',
        company_city:'Teststad',avatar_path:null,logo_path:null,signature_path:'TEST signature'}))
      const row=await checked(actor.from('profiles').select('is_admin,signature_path').eq('id',person.id).single())
      assert.equal(row.is_admin,name==='legacy')
      assert.equal(row.signature_path,'TEST signature')
    }
    assert.equal((await inspector.client.from('profiles').upsert({id:run.people.admin.id,full_name:'FORBIDDEN'})).error?.code,'42501')
    for(const [table,id] of [['platform_products',run.product],['platform_modules',run.module],['platform_roles',run.role],['platform_access_assignments',run.assignment]]) {
      assert.equal((await inspector.client.from(table).update({id}).eq('id',id)).error?.code,'42501')
      assert.equal((await inspector.client.from(table).delete().eq('id',id)).error?.code,'42501')
    }
    pass('Profile autosave including signature succeeds; self-promotion, foreign profiles and role edits fail')
    await checked(db.from('org_members').update({role:'admin'}).eq('org_id',run.org).eq('profile_id',run.people.inspector.id))
    assert.equal(await checked(inspector.client.rpc('is_hushub_besiktapp_admin')),false)
    assert.equal((await inspector.client.from('component_types').insert({name:'FORBIDDEN',default_lifespan_years:1})).error?.code,'42501')
    await checked(db.from('org_members').update({role:'inspector'}).eq('org_id',run.org).eq('profile_id',run.people.inspector.id))
    for(const actor of [legacy.client,admin.client]) {
      const id=randomUUID()
      try {
        await checked(actor.from('component_types').insert({id,name:'TEST admin CRUD',default_lifespan_years:40}))
        await checked(actor.from('component_types').update({name:'TEST edited'}).eq('id',id).select('id').single())
        await checked(actor.from('component_types').delete().eq('id',id).select('id').single())
      } finally { await checked(db.from('component_types').delete().eq('id',id)) }
    }
    pass('Both legacy and assigned global admins retain catalogue CRUD with real JWTs')
    for(const patch of [{is_active:false},{expires_at:'2000-01-01T00:00:00Z'},{scope_type:'organization',scope_id:fixture.org},{module_id:run.otherModule}]) {
      await checked(db.from('platform_access_assignments').update({is_active:true,expires_at:null,scope_type:'global',scope_id:null,module_id:run.module,...patch}).eq('id',run.assignment))
      assert.equal(await checked(admin.client.rpc('is_hushub_besiktapp_admin')),false)
      assert.equal((await admin.client.from('component_types').insert({name:'FORBIDDEN',default_lifespan_years:1})).error?.code,'42501')
    }
    await checked(db.from('platform_access_assignments').update({is_active:true,expires_at:null,scope_type:'global',scope_id:null,module_id:run.module}).eq('id',run.assignment))
    pass('Expired, inactive, organization-scoped and unrelated-module assignments do not authorize edits')
    if(process.argv.includes('--ui')) {
      const running=JSON.parse(await readFile(join(folder,'running.json'),'utf8'))
      assert.equal(running.url,'http://127.0.0.1:57100')
      assert.equal(running.project,new URL(keys.url).hostname)
      assert.equal((await fetch(running.url+'/staging')).headers.get('x-ob-test-project'),running.project)
      const {default:puppeteer}=await import('puppeteer-core')
      browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
      for(const [person,canEdit] of [[inspector,false],[legacy,true],[admin,true]]) {
        const context=await browser.createBrowserContext()
        await context.setCookie(...[...person.cookies].map(([name,value])=>({name,value,url:running.url,httpOnly:false,sameSite:'Lax'})))
        const page=await context.newPage()
        const pageErrors=[]
        let failPermissionProbe=false
        page.on('pageerror',error=>pageErrors.push(error.message))
        page.on('dialog',dialog=>{ pageErrors.push(dialog.message()); void dialog.dismiss() })
        await page.setRequestInterception(true)
        page.on('request',request=>{
          const url=new URL(request.url())
          if(failPermissionProbe&&url.origin===keys.url&&url.pathname==='/rest/v1/rpc/is_hushub_besiktapp_admin') {
            void request.respond({status:503,contentType:'application/json',headers:{'access-control-allow-origin':running.url},body:JSON.stringify({message:'TEST unavailable'})})
          } else if(['data:','blob:'].includes(url.protocol)||[running.url,keys.url].includes(url.origin)) void request.continue()
          else void request.abort()
        })
        for(const path of ['/settings/insida','/settings/utsida',...(canEdit?['/admin/besiktapp?tab=comps']:[])]) {
          await page.setViewport({width:390,height:844})
          await page.goto(running.url+path,{waitUntil:'networkidle0',timeout:60000})
          try { await page.waitForSelector('fieldset[aria-label="Komponentkatalog"]',{timeout:15000}) }
          catch(error) {
            await page.screenshot({path:join(output,'ui-failure.png')})
            await writeFile(join(output,'ui-failure.json'),JSON.stringify({url:page.url(),pageErrors,text:await page.$eval('body',node=>node.innerText.slice(0,2500))},null,2))
            throw error
          }
          await page.waitForFunction(()=>!document.body.innerText.includes('Kontrollerar behörighet'))
          assert.equal(await page.$eval('fieldset[aria-label="Komponentkatalog"]',node=>node.disabled),!canEdit)
          assert.equal(await page.$eval('fieldset[aria-label="Komponentkatalog"]',node=>node.querySelector('input')?.matches(':disabled')),!canEdit)
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'The page must not overflow horizontally')
          await page.screenshot({path:join(output,`ui-${person===inspector?'reader':person===legacy?'legacy':'admin'}-${path.includes('insida')?'inside':path.includes('utsida')?'outside':'admin'}.png`)})
        }
        await page.setViewport({width:1440,height:1000})
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
        await page.screenshot({path:join(output,`ui-desktop-${person===inspector?'reader':person===legacy?'legacy':'admin'}.png`)})
        if(canEdit) {
          failPermissionProbe=true
          await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
          await page.waitForFunction(()=>document.body.innerText.includes('Behörigheten kunde inte kontrolleras'))
          assert.equal(await page.$eval('fieldset[aria-label="Komponentkatalog"]',node=>node.disabled),true)
          failPermissionProbe=false
          await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
          await page.waitForFunction(()=>!document.querySelector('fieldset[aria-label="Komponentkatalog"]').disabled)
          if(person===legacy) await checked(db.from('profiles').update({is_admin:false}).eq('id',run.people.legacy.id))
          else await checked(db.from('platform_access_assignments').update({is_active:false}).eq('id',run.assignment))
          await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
          await page.waitForFunction(()=>document.body.innerText.includes('Skrivskyddad katalog'))
          assert.equal(await page.$eval('fieldset[aria-label="Komponentkatalog"]',node=>node.disabled),true)
        }
        await context.close()
      }
      pass('Real settings pages show read-only/authorized controls at mobile and desktop widths')
      pass('Permission-probe failures and revoked admin rights return editors to read-only')
    }
    run.completed=true
    run.completedAt=new Date().toISOString()
  }
} finally {
  if(browser) await browser.close()
  if(run&&!prepare&&cleanupAllowed) {
    // Cleanup uses only IDs created by this harness, never the original inspection users.
    await checked(db.from('platform_access_assignments').delete().eq('id',run.assignment).eq('profile_id',run.people.admin.id))
    await checked(db.from('profiles').update({is_admin:false}).eq('id',run.people.legacy.id))
    if(run.org) await checked(db.from('org_members').delete().eq('org_id',run.org).in('profile_id',[run.people.inspector.id,run.people.admin.id]))
    await checked(db.from('component_types').delete().eq('id',run.type))
    run.authorityRemoved=true
    assert.deepEqual(await originalSnapshot(),JSON.parse(await readFile(join(output,'before.json'),'utf8')))
    pass('Temporary admin authority removed; original fixture, catalogue and calculations are unchanged')
    await writeFile(join(folder,'component-catalogue-latest.json'),JSON.stringify({completed:run.completed,authorityRemoved:true,checks:run.checks,output},null,2))
    console.log(JSON.stringify({completed:run.completed,checks:run.checks.length,output}))
  }
  if(run) await save()
  globalThis.fetch=fetchReal
}
