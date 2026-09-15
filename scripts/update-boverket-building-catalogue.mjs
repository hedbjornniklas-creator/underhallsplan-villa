import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'

// Explicit maintenance command, never run by the application or during a build.
const endpoint = 'https://api.boverket.se/andamalskatalogen/v1/Catalogue'
const output = new URL('../src/lib/buildings/boverketCatalogue.json', import.meta.url)
const seedName = process.argv[2]
assert.match(seedName ?? '', /^\d{4}-\d{2}-\d{2}_\d{2}_ob_building_purpose_catalogue\.sql$/, 'Pass a NEW dated migration filename')
const seed = new URL('../docs/db/' + seedName, import.meta.url)
await access(seed).then(() => { throw Error('Refusing to overwrite an existing migration') }, error => { if (error.code !== 'ENOENT') throw error })
const previous = await readFile(output, 'utf8').then(JSON.parse).catch(error => {
  if (error.code !== 'ENOENT') throw error
  return { entries: [] }
})
const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30000) })
assert.equal(response.status, 200)
const raw = await response.text(), catalogue = JSON.parse(raw)
assert.ok(Array.isArray(catalogue.conceptVersions))
assert.ok(Number.isFinite(Date.parse(catalogue.catalogueDate)))
const current = []
function visit(nodes, parents = []) {
  for (const node of nodes) {
    assert.match(node.conceptNumber, /^(?:\d{2}){1,3}$/)
    assert.ok(Number.isInteger(node.version) && node.version > 0)
    assert.equal(node.uri, `https://api.boverket.se/andamalskatalogen/v1/concepts/${node.conceptNumber}/${node.version}`)
    assert.ok(typeof node.label === 'string' && node.label.trim().length > 0 && node.label.length <= 200)
    assert.ok(Array.isArray(node.narrower))
    const entry = { key: `boverket:${node.conceptNumber}:v${node.version}`, source: 'boverket-andamalskatalogen',
      conceptNumber: node.conceptNumber, version: node.version, uri: node.uri, label: node.label,
      path: [...parents, node.label] }
    current.push(entry)
    visit(node.narrower, entry.path)
  }
}
visit(catalogue.conceptVersions)
assert.ok(current.length > 100 && current.length < 500)
assert.equal(new Set(current.map(row => row.key)).size, current.length)
// Retain older versions; never silently rewrite an already imported classification.
const entries = new Map(previous.entries.map(row => [row.key, row]))
for (const row of current) {
  if (entries.has(row.key)) assert.deepEqual(entries.get(row.key), row, `Existing version changed: ${row.key}`)
  entries.set(row.key, row)
}
const snapshot = { source: endpoint, catalogueDate: catalogue.catalogueDate,
  sha256: createHash('sha256').update(raw).digest('hex'),
  documentation: 'https://www.boverket.se/sv/om-boverket/oppna-data/api-tjanst-for-andamalskatalogen/',
  currentKeys: current.map(row => row.key), entries: [...entries.values()].sort((a, b) => a.key.localeCompare(b.key)) }
await mkdir(new URL('../src/lib/buildings/', import.meta.url), { recursive: true })
await mkdir(new URL('../.cache/boverket/', import.meta.url), { recursive: true })
await writeFile(new URL(`../.cache/boverket/${snapshot.sha256}.json`, import.meta.url), raw, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error })
await writeFile(output, JSON.stringify(snapshot, null, 2) + '\n')
const literal = value => "'" + value.replaceAll("'", "''") + "'"
const values = snapshot.entries.map((row, index) => `  (${literal(row.key)},${literal(row.label)},${1000 + index},${literal(JSON.stringify(row))}::jsonb)`).join(',\n')
const retired = snapshot.entries.filter(row => !snapshot.currentKeys.includes(row.key))
await writeFile(seed, `-- Generated from Boverkets Andamalskatalog; names and identifiers are unchanged.
-- Source: ${endpoint}
-- Catalogue date: ${snapshot.catalogueDate}; raw SHA-256: ${snapshot.sha256}
-- Requires 2026-09-13_01. No inspection updates or automatic reclassification.
begin;
insert into public.settings_ob_building_categories(key,label,sort_order,catalogue_entry) values
${values}
on conflict (key) do update set label=excluded.label,catalogue_entry=excluded.catalogue_entry;
${retired.length ? `update public.settings_ob_building_categories set is_active=false where key in (${retired.map(row => literal(row.key)).join(',')});` : ''}
commit;
`, { flag: 'wx' })
console.log(JSON.stringify({ entries: snapshot.entries.length, current: current.length, catalogueDate: snapshot.catalogueDate, sha256: snapshot.sha256 }))
