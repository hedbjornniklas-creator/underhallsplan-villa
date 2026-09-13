import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { validateStagingKeys } from './lib/ob-staging-app.mjs'

const folder = new URL('../.cache/ob-staging-app/', import.meta.url)
const keys = validateStagingKeys(JSON.parse(await readFile(new URL('keys.json',folder),'utf8')))
const fixture = JSON.parse(await readFile(new URL('fixtures.json',folder),'utf8'))
assert.equal(fixture.project,keys.url)
const base = process.argv[2] ?? 'http://127.0.0.1:57100'
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/)
const admin = createClient(keys.url,keys.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const anon = createClient(keys.url,keys.anonKey,{auth:{persistSession:false,autoRefreshToken:false}})
async function identity(person) {
  const cookies = new Map()
  const db = createServerClient(keys.url,keys.anonKey,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:all=>all.forEach(c=>cookies.set(c.name,c.value))}})
  const result = await db.auth.signInWithPassword({email:person.email,password:person.password})
  assert.equal(result.error,null,'Real test login')
  return {db,headers:{Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')}}
}
const owner = await identity(fixture.owner)
const stranger = await identity(fixture.stranger)
const checks=[]
function pass(name) { checks.push(name); console.log(`PASS ${name}`) }
const own = await owner.db.from('properties').select('id').eq('id',fixture.property)
assert.equal(own.error,null);assert.equal(own.data.length,1)
const foreign = await stranger.db.from('properties').select('id').eq('id',fixture.property)
assert.equal(foreign.error,null);assert.equal(foreign.data.length,0)
assert.ok((await anon.from('properties').select('id')).error)
pass('Owner-only property reads with real JWTs; anon denied')
const original = JSON.parse(await readFile(new URL('before-activation.json',folder),'utf8'))
const room = await owner.db.from('inspection_interior_rooms').select('*').eq('id',fixture.room).single()
const note = await owner.db.from('inspection_control_items').select('*').eq('id',fixture.note).single()
assert.equal(room.error,null);assert.equal(note.error,null)
assert.equal(room.data.floor_label,original.inspection_interior_rooms.find(r=>r.id===fixture.room).floor_label)
assert.equal(note.data.note,original.inspection_control_items.find(n=>n.id===fixture.note).note)
assert.equal(note.data.interior_room_id,fixture.room)
const savedInspection = await owner.db.from('inspections').select('inspector_name').eq('id',fixture.inspection).single()
assert.equal(savedInspection.error,null)
assert.equal((await owner.db.from('inspections').update({inspector_name:savedInspection.data.inspector_name}).eq('id',fixture.inspection)).error,null)
pass('Existing room IDs, floor labels and note text survive; normal authenticated saving works')
for(const client of [owner.db,stranger.db,anon]) {
  assert.ok((await client.rpc('ensure_inspection_default_other_room_and_points',{p_inspection_id:fixture.inspection})).error)
}
pass('Legacy privileged RPC unavailable to browser identities')
const notes = await stranger.db.from('inspection_control_items').select('id').eq('inspection_id',fixture.inspection)
assert.equal(notes.error,null);assert.equal(notes.data.length,0)
assert.ok((await stranger.db.from('inspection_control_items').insert({inspection_id:fixture.inspection,title:'Forbidden',note:'Must not be saved'})).error)
pass('Foreign note reads and writes blocked despite legacy permissive policies')
const objectPath = `${fixture.inspection}/staging-access/${randomUUID()}.png`
const png = await readFile(new URL('../public/report-assets/mock-company-logo.png',import.meta.url))
try {
  assert.equal((await owner.db.storage.from('inspection-images').upload(objectPath,png,{contentType:'image/png'})).error,null)
  const wrongPath = `${fixture.inspection}/staging-access/${randomUUID()}.png`
  assert.ok((await stranger.db.storage.from('inspection-images').upload(wrongPath,png,{contentType:'image/png'})).error)
  assert.ok((await anon.storage.from('inspection-images').upload(wrongPath,png,{contentType:'image/png'})).error)
  const listing = await stranger.db.storage.from('inspection-images').list(`${fixture.inspection}/staging-access`)
  assert.equal(listing.error,null);assert.equal(listing.data.length,0)
  const deletion = await stranger.db.storage.from('inspection-images').remove([objectPath])
  assert.equal(deletion.error,null);assert.equal(deletion.data.length,0)
  const publicImage = owner.db.storage.from('inspection-images').getPublicUrl(objectPath).data.publicUrl
  assert.equal((await fetch(publicImage)).status,200)
  pass('Owner upload works; foreign listing/upload/deletion and anon upload blocked; public download remains public')
} finally {
  assert.equal((await admin.storage.from('inspection-images').remove([objectPath])).error,null)
}
for (const [actor,expected] of [[owner,200],[stranger,403]]) {
  const response = await fetch(`${base}/api/ob/inspections/${fixture.inspection}/buildings`,{headers:actor.headers})
  if(response.status!==expected) console.log('Building API failure:',await response.text())
  assert.equal(response.status,expected)
}
pass('Actual Next building API permits owner and rejects second inspector in same organization')
for(const path of [`/api/ob/inspections/${fixture.inspection}/report-delivery`,`/api/ob/inspections/${fixture.inspection}/note-suggestions`,'/api/cron/reports/pdf','/api/ai/test']) {
  assert.equal((await fetch(base+path,{method:'POST',headers:owner.headers})).status,403)
}
pass('Local app blocks mail, AI, delivery and cron endpoints')
const imageFixtures = await owner.db.from('inspection_images').select('file_path').eq('inspection_id',fixture.inspection).limit(1)
assert.equal(imageFixtures.error,null)
if (imageFixtures.data.length) {
  const source = owner.db.storage.from('inspection-images').getPublicUrl(imageFixtures.data[0].file_path).data.publicUrl
  const proxied = await fetch(`${base}/api/image-proxy?url=${encodeURIComponent(source)}`)
  assert.equal(proxied.status,200)
  assert.equal(proxied.headers.get('content-type'),'image/jpeg')
  for(const source of ['http://127.0.0.1/private.png','https://production.supabase.co/storage/v1/object/public/test.png']) {
    assert.equal((await fetch(`${base}/api/image-proxy?url=${encodeURIComponent(source)}`)).status,403)
  }
  pass('Report image proxy serves staging images and rejects local or unconfigured hosts')
}
await writeFile(new URL('access-test-results.json',folder),JSON.stringify({project:keys.url,time:new Date().toISOString(),checks},null,2))
