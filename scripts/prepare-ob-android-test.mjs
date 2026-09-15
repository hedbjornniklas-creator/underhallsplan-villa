import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import { randomBytes,randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createServerClient,serializeCookieHeader } from '@supabase/ssr'
import { validateStagingKeys } from './lib/ob-staging-app.mjs'

const folder=new URL('../.cache/ob-staging-app/',import.meta.url)
const keys=validateStagingKeys(JSON.parse(await readFile(new URL('keys.json',folder))))
const original=JSON.parse(await readFile(new URL('fixtures.json',folder)))
const running=JSON.parse(await readFile(new URL('running.json',folder)))
assert.equal(original.project,keys.url);assert.equal(running.project,new URL(keys.url).hostname)
assert.equal(running.url,`http://127.0.0.1:${running.port}`)
const filename=new URL('android-fixture.json',folder)
try {await readFile(filename);throw Error('Android fixture already exists; never reseed user edits')}
catch(error){if(error.code!=='ENOENT')throw error}
const fixture={project:keys.url,org:original.org,property:randomUUID(),inspection:randomUUID(),
  person:{email:`ob-android-${randomUUID()}@example.invalid`,password:randomBytes(24).toString('base64url')},ready:false}
const save=()=>writeFile(filename,JSON.stringify(fixture,null,2),{mode:0o600})
await writeFile(filename,JSON.stringify(fixture),{flag:'wx',mode:0o600})
const realFetch=globalThis.fetch
globalThis.fetch=(input,options)=>{assert.equal(new URL(typeof input==='string'||input instanceof URL?input:input.url).origin,keys.url);return realFetch(input,options)}
const admin=createClient(keys.url,keys.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const checked=async request=>{const r=await request;assert.ok(!r.error,r.error?.message);return r.data}
try {
  const before=await checked(admin.from('ob_inspection_structure').select('*').eq('inspection_id',original.inspection))
  fixture.person.id=(await checked(admin.auth.admin.createUser({...fixture.person,email_confirm:true}))).user.id
  await save()
  await checked(admin.from('profiles').upsert({id:fixture.person.id,email:fixture.person.email,full_name:'Androidtest',is_admin:false}))
  await checked(admin.from('org_members').insert({org_id:fixture.org,profile_id:fixture.person.id,role:'inspector',is_active:true,is_default:true}))
  await checked(admin.from('properties').insert({id:fixture.property,owner:fixture.person.id,name:'TEST - Android',address:'Testgatan 2',city:'Teststad'}))
  await checked(admin.from('inspections').insert({id:fixture.inspection,property_id:fixture.property,type:'OB',inspection_family:'OB',date:new Date().toISOString().slice(0,10),inspector_name:'Androidtest',status:'Utkast'}))
  let cookies=[]
  const owner=createServerClient(keys.url,keys.anonKey,{cookies:{getAll:()=>[],setAll:all=>{cookies=all.map(c=>serializeCookieHeader(c.name,c.value,c.options))}}})
  await checked(owner.auth.signInWithPassword({email:fixture.person.email,password:fixture.person.password}))
  const cookie=cookies.map(c=>c.split(';')[0]).join('; ')
  const endpoint=`${running.url}/api/ob/inspections/${fixture.inspection}/buildings`
  async function api(operation,payload) {
    const response=await realFetch(endpoint,{method:operation?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},
      ...(operation?{body:JSON.stringify({operation,payload})}:{}),redirect:'error'})
    assert.equal(response.headers.get('x-ob-test-project'),running.project)
    const result=await response.json();assert.equal(response.status,200,result.error??'Building command failed');return result.data
  }
  const preview=await api()
  await api('activate',{name:'Huvudbyggnad',buildingId:null,confirmed:true,activationToken:preview.activationToken,requestId:randomUUID()})
  await api('add',{name:'G\u00e4sthus',categoryKey:'guesthouse',buildingId:null,requestId:randomUUID()})
  const overview=await api()
  assert.equal(overview.parts.length,2)
  for(const part of overview.parts) {
    for(const name of part.id===overview.structure.primary_part_id?['Hall','K\u00f6k']:['Hall','Sovrum']) {
      await api('row',{table:'inspection_interior_rooms',partId:part.id,operation:'insert',id:randomUUID(),requestId:randomUUID(),
        row:{floor_label:'plan0',room_type_key:name==='Hall'?'hall':name==='Sovrum'?'bedroom':'kitchen',room_label:name}})
    }
  }
  assert.deepEqual(await checked(admin.from('ob_inspection_structure').select('*').eq('inspection_id',original.inspection)),before)
  assert.equal((await checked(owner.from('properties').select('id'))).length,1,'Android account must see only its own property')
  fixture.parts=overview.parts.map(p=>({id:p.id,name:p.name}));fixture.ready=true;await save()
  console.log(JSON.stringify({ready:true,property:fixture.property,inspection:fixture.inspection,buildings:2,newInspector:true}))
} catch(error){fixture.failure=error.message;await save();throw error}
finally{globalThis.fetch=realFetch}
