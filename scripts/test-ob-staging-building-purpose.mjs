import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { validateStagingKeys } from './lib/ob-staging-app.mjs'

const folder = new URL('../.cache/ob-staging-app/', import.meta.url)
const keys = validateStagingKeys(JSON.parse(await readFile(new URL('keys.json', folder), 'utf8')))
const fixture = JSON.parse(await readFile(new URL('fixtures.json', folder), 'utf8'))
const running = JSON.parse(await readFile(new URL('running.json', folder), 'utf8'))
assert.equal(fixture.project, keys.url)
assert.equal(running.project, new URL(keys.url).hostname)
assert.equal(running.url, `http://127.0.0.1:${running.port}`)
assert.equal((await fetch(`${running.url}/staging`, { redirect: 'error' })).headers.get('x-ob-test-project'), running.project)
const admin = createClient(keys.url, keys.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const cookies = new Map()
const owner = createServerClient(keys.url, keys.anonKey, { cookies: {
  getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
  setAll: values => values.forEach(c => cookies.set(c.name, c.value)),
} })
assert.equal((await owner.auth.signInWithPassword(fixture.owner)).error, null)
const headers = { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'Content-Type': 'application/json' }
const run = { property: randomUUID(), inspection: randomUUID(), project: keys.url, checks: [], completed: false }
const manifest = new URL(`purpose-${Date.now()}.json`, folder)
await writeFile(manifest, JSON.stringify(run, null, 2), { flag: 'wx' })
const tables = ['ob_inspection_structure', 'ob_inspection_buildings', 'ob_building_conditions', 'ob_building_floor_models',
  'inspection_interior_rooms', 'inspection_control_items', 'inspection_images', 'inspection_report_links']
async function checked(request) {
  const { data, error } = await request
  assert.equal(error, null, error?.message)
  return data
}
async function snapshot() {
  const result = {}
  for (const table of tables) result[table] = await checked(admin.from(table).select('*').eq('inspection_id', fixture.inspection))
  return result
}
async function api(operation, payload) {
  const response = await fetch(`${running.url}/api/ob/inspections/${run.inspection}/buildings`, {
    method: operation ? 'POST' : 'GET', headers, redirect: 'error',
    ...(operation ? { body: JSON.stringify({ operation, payload: { ...payload, requestId: randomUUID() } }) } : {}),
  })
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  return body.data
}
const before = await snapshot()
const pass = message => { run.checks.push(message); console.log(`PASS ${message}`) }
try {
  const catalogue = await checked(admin.from('settings_ob_building_categories').select('*').not('catalogue_entry', 'is', null))
  assert.equal(catalogue.length, 197)
  pass('197 official versioned catalogue entries available in staging')
  await checked(admin.from('properties').insert({ id: run.property, owner: fixture.owner.id,
    name: 'TEST - byggnadsandamal', address: 'Testgatan 5', city: 'Teststad' }))
  await checked(admin.from('inspections').insert({ id: run.inspection, property_id: run.property, type: 'OB',
    inspection_family: 'OB', date: '2026-09-13', inspector_name: 'OB Test owner', status: 'Utkast' }))
  const preview = await api()
  let state = await api('activate', { name: 'TEST Huset vid sjon', buildingId: null, categoryKey: null,
    purposeCatalogueVersion: 1, activationToken: preview.activationToken, confirmed: true })
  assert.equal(state.parts[0].category_key, null)
  const originalPrimary = state.structure.primary_part_id
  pass('Activation accepts a free name with no classification')
  state = await api('add', { name: 'TEST Ateljen', buildingId: null, categoryKey: null })
  let part = state.parts.find(row => row.name === 'TEST Ateljen')
  assert.equal(part.category_key, null)
  state = await api('edit', { partId: part.id, revision: part.revision, categoryKey: 'boverket:010404:v2' })
  part = state.parts.find(row => row.id === part.id)
  assert.equal(part.category_key, 'boverket:010404:v2')
  assert.equal(part.name, 'TEST Ateljen')
  assert.equal(state.structure.primary_part_id, originalPrimary)
  assert.equal(state.categories.find(row => row.key === part.category_key).catalogue_entry.label, 'Garage')
  pass('Official key and version persist without changing name or primary building')
  state = await api('edit', { partId: part.id, revision: part.revision, categoryKey: null })
  assert.equal(state.parts.find(row => row.id === part.id).category_key, null)
  pass('Classification can be cleared explicitly')
  state = await api('add', { name: 'TEST Tidigare kategori', buildingId: null, categoryKey: 'guesthouse' })
  part = state.parts.find(row => row.name === 'TEST Tidigare kategori')
  state = await api('edit', { partId: part.id, revision: part.revision, name: 'TEST Tidigare kategori - nytt namn' })
  assert.equal(state.parts.find(row => row.id === part.id).category_key, 'guesthouse')
  pass('Editing a legacy name preserves its existing category')
  assert.deepEqual(await snapshot(), before)
  pass('Existing click-test inspection remains unchanged')
  run.url = `${running.url}/properties/${run.property}/ob/${run.inspection}`
  run.completed = true
} finally {
  await writeFile(manifest, JSON.stringify(run, null, 2))
  await writeFile(new URL('purpose-latest.json', folder), JSON.stringify(run, null, 2))
}
console.log(JSON.stringify(run))
