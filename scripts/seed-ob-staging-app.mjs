import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { validateStagingKeys } from './lib/ob-staging-app.mjs'

const folder = new URL('../.cache/ob-staging-app/', import.meta.url)
const keys = validateStagingKeys(JSON.parse(await readFile(new URL('keys.json', folder), 'utf8')))
const db = createClient(keys.url, keys.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const manifestPath = new URL('fixtures.json', folder)
let fixture
try { fixture = JSON.parse(await readFile(manifestPath, 'utf8')) }
catch (error) {
  if (error.code !== 'ENOENT') throw error
  fixture = { project: keys.url, org: randomUUID(), property: randomUUID(), inspection: randomUUID(),
    room: randomUUID(), note: randomUUID(), image: randomUUID(),
    owner: { email: 'ob-staging-owner@example.invalid', password: randomBytes(24).toString('base64url') },
    stranger: { email: 'ob-staging-stranger@example.invalid', password: randomBytes(24).toString('base64url') } }
  await writeFile(manifestPath, JSON.stringify(fixture), { flag: 'wx', mode: 0o600 })
}
assert.equal(fixture.project, keys.url)
async function checked(request, label) {
  const { data, error } = await request
  if (error) throw Error(`${label}: ${error.message}`)
  return data
}
const users = await checked(db.auth.admin.listUsers(), 'List test users')
assert.ok(users.users.every(u => [fixture.owner.email, fixture.stranger.email].includes(u.email)), 'Unexpected user: stop')
const properties = await checked(db.from('properties').select('id'), 'Check properties')
assert.ok(properties.every(p => p.id === fixture.property), 'Unexpected property: stop')
for (const [name, person] of [['owner', fixture.owner], ['stranger', fixture.stranger]]) {
  const existing = users.users.find(u => u.email === person.email)
  const user = existing ?? (await checked(db.auth.admin.createUser({ email: person.email, password: person.password, email_confirm: true }), 'Create synthetic user')).user
  person.id = user.id
  await writeFile(manifestPath, JSON.stringify(fixture), { mode: 0o600 })
  await checked(db.from('profiles').upsert({ id: user.id, full_name: `OB Test ${name}`, email: person.email }), 'Test profile')
}
await checked(db.from('organizations').upsert({ id: fixture.org, name: 'OB TEST - endast fiktiva uppgifter' }), 'Test organization')
for (const person of [fixture.owner, fixture.stranger]) {
  await checked(db.from('org_members').upsert({ org_id: fixture.org, profile_id: person.id, role: 'inspector', is_active: true, is_default: true }, { onConflict: 'org_id,profile_id' }), 'Membership')
}
await checked(db.from('properties').upsert({ id: fixture.property, owner: fixture.owner.id, name: 'TEST - Flerbyggnadsfastigheten', address: 'Testgatan 1', city: 'Teststad', year_built: 1990 }), 'Test property')
const inspections = await checked(db.from('inspections').select('id').eq('id', fixture.inspection), 'Find fixture')
if (!inspections.length) {
  await checked(db.from('inspections').insert({ id: fixture.inspection, property_id: fixture.property, type: 'OB', inspection_family: 'OB', date: '2026-09-12', inspector_name: 'OB Test owner', status: 'Utkast' }), 'Test inspection')
  await checked(db.from('inspection_interior_rooms').insert({ id: fixture.room, inspection_id: fixture.inspection, floor_label: 'plan1', room_type_key: 'hall', room_label: 'Befintlig hall' }), 'Legacy room')
  await checked(db.from('inspection_control_items').insert({ id: fixture.note, inspection_id: fixture.inspection, interior_room_id: fixture.room, title: 'Fiktiv testnotering', note: 'Testtext som ska finnas kvar efter byggnadsindelning.' }), 'Legacy note')
}
for (const [key, label] of [['hall','Hall'],['kitchen','Kok'],['bathroom','Badrum'],['bedroom','Sovrum'],['other','Ovrigt']]) {
  await checked(db.from('settings_interior_room_types').upsert({ key, label }, { onConflict: 'key' }), 'Room configuration')
}
for (const [key,label] of [['mark','Mark'],['fasad','Fasad'],['tak','Tak']]) {
  await checked(db.from('settings_exterior_items').upsert({ key, label }, { onConflict: 'key' }), 'Exterior configuration')
}
for (const name of ['inspection-images','property-media']) {
  const found = (await checked(db.storage.listBuckets(), 'List test buckets')).some(b => b.id === name)
  if (!found) await checked(db.storage.createBucket(name, { public: true, fileSizeLimit: 26214400, allowedMimeTypes: ['image/jpeg','image/png','image/webp','image/heic','image/heif'] }), 'Create test bucket')
}
// Only this approved empty staging project is activated. No real inspection is enrolled.
await checked(db.from('ob_building_rollout').update({ enabled: true }).eq('id', true), 'Enable staging building pilot')
console.log(JSON.stringify({ property: fixture.property, inspection: fixture.inspection, syntheticUsers: 2, stagingOnly: true }))
