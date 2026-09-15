import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { validateStagingKeys } from './lib/ob-staging-app.mjs'

const folder = fileURLToPath(new URL('../.cache/ob-staging-app/', import.meta.url))
const keys = validateStagingKeys(JSON.parse(await readFile(join(folder,'keys.json'),'utf8')))
const fixture = JSON.parse(await readFile(join(folder,'fixtures.json'),'utf8'))
assert.equal(fixture.project, keys.url)
const fetchReal = globalThis.fetch
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  assert.equal(url.origin, keys.url, 'Only the approved staging host')
  return fetchReal(input, options)
}
const client = key => createClient(keys.url, key, {auth:{persistSession:false,autoRefreshToken:false}})
const admin = client(keys.serviceKey), anon = client(keys.anonKey)
async function checked(request) {
  const {data,error} = await request
  assert.equal(error, null, error?.message)
  return data
}
async function identity(person) {
  const db = client(keys.anonKey)
  const session = await checked(db.auth.signInWithPassword({email:person.email,password:person.password}))
  assert.equal(session.user.id, person.id)
  return db
}
const owner = await identity(fixture.owner), other = await identity(fixture.stranger)
async function originalSnapshot() {
  const snapshot = {}
  for (const table of ['ob_inspection_structure','ob_inspection_buildings','ob_building_conditions',
    'inspection_interior_rooms','inspection_control_items','inspection_images','inspection_report_links']) {
    snapshot[table] = await checked(admin.from(table).select('*').eq('inspection_id',fixture.inspection)
      .order(table === 'ob_inspection_structure' ? 'inspection_id' : 'id'))
  }
  return snapshot
}
const prepared = process.argv.includes('--prepare')
const output = prepared ? join(folder,`components-access-${Date.now()}`) : resolve(process.argv[2] ?? '')
assert.equal(resolve(output,'..'), resolve(folder))
assert.match(output.split(/[\\/]/).pop(), /^components-access-\d+$/)
let run
try {
  if (prepared) {
    run = {project:keys.url,owner:fixture.owner.id,other:fixture.stranger.id,inspection:fixture.inspection,
      properties:[randomUUID(),randomUUID()],components:[randomUUID(),randomUUID()],type:randomUUID(),checks:[],completed:false}
    await mkdir(output)
    await writeFile(join(output,'manifest.json'),JSON.stringify(run,null,2),{flag:'wx'})
    const original = await originalSnapshot()
    await checked(admin.from('properties').insert(run.properties.map((id,i)=>({id,owner:i?run.other:run.owner,name:`TEST component access ${i+1}`}))))
    await checked(admin.from('component_types').insert({id:run.type,name:'TEST Access Roof',default_lifespan_years:30}))
    await checked(admin.from('components').insert(run.components.map((id,i)=>({id,property_id:run.properties[i],component_type_id:run.type,
      install_year:2020,condition:'Bra',comment:`TEST PRIVATE ${i+1}`}))))
    const before = {
      original,
      rows:await checked(admin.from('components').select('*').in('id',run.components).order('id')),
      calculations:await checked(admin.from('components_calc').select('*').in('id',run.components).order('id')),
    }
    await writeFile(join(output,'before.json'),JSON.stringify(before,null,2))
    console.log(JSON.stringify({prepared:true,project:keys.url,output}))
  } else {
    run = JSON.parse(await readFile(join(output,'manifest.json'),'utf8'))
    assert.equal(run.project,keys.url)
    assert.equal(run.owner,fixture.owner.id)
    assert.equal(run.other,fixture.stranger.id)
    assert.equal(run.inspection,fixture.inspection)
    assert.ok(run.properties.every(id=>id!==fixture.property))
    run.checks = []
    run.completed = false
    delete run.completedAt
    const before = JSON.parse(await readFile(join(output,'before.json'),'utf8'))
    const pass = name => { run.checks.push(name); console.log(`PASS ${name}`) }
    assert.deepEqual(await checked(admin.from('components').select('*').in('id',run.components).order('id')),before.rows)
    assert.deepEqual(await checked(admin.from('components_calc').select('*').in('id',run.components).order('id')),before.calculations)
    pass('Migration preserves both records and every calculated value')
    for (const table of ['components','components_calc']) {
      const denied = await anon.from(table).select('id,comment')
      assert.equal(denied.error?.code,'42501')
      const ownRows = await checked(owner.from(table).select('*').in('id',run.components))
      assert.equal(ownRows.length,1)
      assert.equal(ownRows[0].id,run.components[0])
      const otherRows = await checked(other.from(table).select('*').in('id',run.components))
      assert.equal(otherRows.length,1)
      assert.equal(otherRows[0].id,run.components[1])
    }
    pass('Real anonymous requests are denied; each logged-in owner sees only their own table/view row')
    const id = randomUUID()
    try {
      await checked(owner.from('components').insert({id,property_id:run.properties[0],component_type_id:run.type,comment:'TEST new'}))
      await checked(owner.from('components').update({comment:'TEST saved'}).eq('id',id))
      assert.equal((await checked(owner.from('components').select('comment').eq('id',id).single())).comment,'TEST saved')
      assert.equal((await owner.from('components').update({property_id:run.properties[1]}).eq('id',id)).error?.code,'42501')
      assert.equal((await other.from('components').insert({property_id:run.properties[0],component_type_id:run.type})).error?.code,'42501')
      assert.deepEqual(await checked(other.from('components').update({comment:'FORBIDDEN'}).eq('id',id).select('id')),[])
      assert.deepEqual(await checked(other.from('components').delete().eq('id',id).select('id')),[])
      assert.equal((await checked(owner.from('components_calc').select('comment').eq('id',id).single())).comment,'TEST saved')
      assert.equal((await checked(owner.from('components').delete().eq('id',id).select('id'))).length,1)
    } finally {
      await checked(admin.from('components').delete().eq('id',id))
    }
    pass('Owner CRUD works; cross-property insertion, updates, deletes and reparenting are blocked')
    const viewWrite = await owner.from('components_calc').update({comment:'FORBIDDEN'}).eq('id',run.components[0])
    assert.ok(['42501','55000'].includes(viewWrite.error?.code),viewWrite.error?.message)
    pass('Browser view mutations are rejected')
    const catalog = await checked(owner.from('component_types').select('id,name,default_lifespan_years').eq('id',run.type).single())
    assert.equal(catalog.default_lifespan_years,30)
    assert.equal((await checked(admin.from('components_calc').select('id').in('id',run.components))).length,2)
    pass('Read-only catalogue prerequisite and service access remain usable')
    assert.deepEqual(await originalSnapshot(),before.original)
    pass('Original mobile inspection remains unchanged in all seven audited tables')
    run.completed = true
    run.completedAt = new Date().toISOString()
    await writeFile(join(folder,'components-access-latest.json'),JSON.stringify({...run,output},null,2))
    console.log(JSON.stringify({completed:true,checks:run.checks.length,output}))
  }
} finally {
  if (run) await writeFile(join(output,'manifest.json'),JSON.stringify(run,null,2))
  globalThis.fetch = fetchReal
}
