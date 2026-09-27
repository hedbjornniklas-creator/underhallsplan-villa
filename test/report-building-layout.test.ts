import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node test runner uses explicit extensions.
import { buildReportSpec } from '../src/lib/report/reportSpec.ts'
// @ts-expect-error Node test runner uses explicit extensions.
import { normalizeProfileWebsite, readProfileWebsite, readReportWebsite } from '../src/lib/report/profileWebsite.ts'

test('new reports put all buildings before unchanged standard appendices; historical specs stay unchanged', () => {
  const dynamicAppendices = { includeAreaMeasurement: true, includeMoistureControl: true,
    buildings: [{ id: 'garage', name: 'Garage' }, { id: 'guest', name: 'Gästhus' }] }
  const old = buildReportSpec({ inspectionSide: 'buyer', dynamicAppendices })
  const before = structuredClone(old)
  const spec = buildReportSpec({ layoutVersion: 2, inspectionSide: 'buyer', dynamicAppendices })
  assert.equal(spec[0].layoutVersion, 2)
  const firstAppendix = spec.findIndex(s => s.id === 'appendix-1')
  assert.deepEqual(spec.slice(firstAppendix - 2, firstAppendix).map(s => s.title), ['Garage', 'Gästhus'])
  for (const [index, building] of dynamicAppendices.buildings.entries()) {
    const section = spec.find(s => s.id === `building-${building.id}`)!
    assert.ok(section.blocks.some(b => b.type === 'buildingIntroduction' && b.itemsPath === `mock.appendices.buildings.${index}.introduction`))
    assert.ok(!section.title?.includes('Bilaga'))
  }
  for (const section of spec.filter(s => s.type === 'appendix')) assert.deepEqual(section, old.find(s => s.id === section.id))
  const toc = spec.find(s => s.id === 'toc')!.blocks.find(b => b.type === 'toc')!
  assert.equal(toc.type, 'toc')
  if (toc.type === 'toc') {
    const index = toc.entries.findIndex(e => e.sectionId === 'appendix-1')
    assert.deepEqual(toc.entries.slice(index - 2, index).map(e => e.label), ['Garage', 'Gästhus'])
  }
  assert.deepEqual(old, before)
  assert.deepEqual(buildReportSpec({ inspectionSide: 'buyer', dynamicAppendices }), before)
  assert.equal(old.find(s => s.id === 'appendix-building-garage')?.title, 'Bilaga 6: Garage')
})

test('website accepts blank, domain and HTTP(S), not invalid protocols or credentials', () => {
  for (const value of [null, undefined, '', '   ']) assert.equal(normalizeProfileWebsite(value), null)
  for (const value of ['www.foretag.se', 'https://foretag.se', 'http://företag.se/kontakt']) assert.equal(normalizeProfileWebsite(` ${value} `), value)
  for (const value of ['javascript:alert(1)', 'ftp://foretag.se', 'https://a:b@foretag.se', 'https://', 'not a website', 'a'.repeat(254)]) assert.throws(() => normalizeProfileWebsite(value))
})

function database(result: unknown) {
  const calls: string[] = []
  const db = { from(table: string) { calls.push(table); return { select(column: string) {
    assert.equal(column, 'company_website'); return { eq() { return { async maybeSingle() { return result } } } }
  } } } } as unknown as Parameters<typeof readProfileWebsite>[0]
  return { db, calls }
}

test('frozen missing and empty website fields never read current profile', async () => {
  const { db, calls } = database({ data: { company_website: 'new.example.se' } })
  for (const snapshot of [{}, { company_website: null }, { company_website: '' }, { company_website: 'old.example.se' }]) {
    assert.equal(await readReportWebsite(db, 'owner', snapshot), snapshot.company_website ?? null)
  }
  assert.deepEqual(calls, [])
  assert.equal(await readReportWebsite(db, 'owner', null), 'new.example.se')
})

test('pre-migration read is optional; unexpected errors are not silently treated as empty', async () => {
  assert.deepEqual(await readProfileWebsite(database({ error: { code: '42703', message: 'company_website does not exist' } }).db, 'owner'), { supported: false, value: null })
  await assert.rejects(readProfileWebsite(database({ error: { code: '42501', message: 'denied' } }).db, 'owner'))
  assert.deepEqual(await readProfileWebsite(database({ data: { company_website: '  ' } }).db, 'owner'), { supported: true, value: null })
})

test('website migration adds only an optional profile field with column-level writes', () => {
  const sql = readFileSync(new URL('../docs/db/2026-09-27_01_profile_company_website.sql', import.meta.url), 'utf8')
  assert.match(sql, /add column if not exists company_website text/i)
  assert.match(sql, /insert\(company_website\), update\(company_website\)/i)
  assert.doesNotMatch(sql, /update public\.|delete from|inspection_report_links|disable row level/i)
})

test('website migration is repeatable and preserves self-only profile writes', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role authenticated;
      create table profiles(id text primary key, full_name text, is_admin boolean default false);
      insert into profiles(id,full_name) values('owner','Owner'),('other','Other');
      alter table profiles enable row level security;
      create policy self_profile on profiles to authenticated using(id=current_setting('test.actor')) with check(id=current_setting('test.actor'));
      grant select on profiles to authenticated;
      grant insert(id,full_name),update(full_name) on profiles to authenticated;`)
    const sql = readFileSync(new URL('../docs/db/2026-09-27_01_profile_company_website.sql', import.meta.url), 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    assert.equal((await db.query<{ company_website: string | null }>('select company_website from profiles')).rows.every(row => row.company_website === null), true)
    await db.exec("set role authenticated; set test.actor='owner'; update profiles set company_website='https://example.se' where id='owner';")
    assert.equal((await db.query<{ company_website: string | null }>('select company_website from profiles')).rows[0].company_website, 'https://example.se')
    await db.exec("update profiles set company_website='not-allowed.se' where id='other';")
    await assert.rejects(db.exec("update profiles set is_admin=true where id='owner'"))
    await db.exec('reset role;')
    assert.equal((await db.query<{ company_website: string | null }>("select company_website from profiles where id='other'")).rows[0].company_website, null)
  } finally { await db.close() }
})
