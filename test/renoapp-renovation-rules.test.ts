import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node strip-types uses explicit file extensions.
import { rulesAcceptanceFields } from '../src/lib/renoapp/renovationRules.ts'

const db = new PGlite()
const actor = randomUUID()
const legacyBrf = randomUUID(), legacyCase = randomUUID()
const sql = (name: string) => readFileSync(new URL(`../docs/db/${name}`, import.meta.url), 'utf8')
const migration = sql('2026-09-07_02_renoapp_renovation_rules.sql')

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key);
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`)
  await db.exec(sql('2026-03-26_01_renoapp_mvp_foundation.sql').replace('create extension if not exists pgcrypto;', ''))
  await db.query('insert into profiles values ($1)', [actor])
  await db.query('insert into brf_associations(id,name,slug) values ($1,$2,$3)', [legacyBrf, 'Legacy', `brf-${legacyBrf}`])
  await db.query('insert into renovation_cases(id,brf_id,case_number,title,status) values ($1,$2,$3,$4,$5)', [legacyCase, legacyBrf, legacyCase, 'Legacy', 'submitted'])
  await db.exec(migration)
})
after(async () => { await db.close() })

async function brf() {
  const id = randomUUID()
  await db.query('insert into brf_associations(id,name,slug) values ($1,$2,$3)', [id, 'Test BRF', `brf-${id}`])
  return id
}
async function publish(brfId: string, previous: string | null = null, content: Record<string, string | undefined> | null = { format: 'text', body: 'Tysta arbeten efter 18.00.\n\nSkydda hissen.' }) {
  return (await db.query<{ id: string | null }>('select renoapp_publish_brf_rules($1,$2,$3,$4) as id', [actor, brfId, previous, content])).rows[0].id
}
async function draft(brfId: string) {
  const id = randomUUID()
  await db.query('insert into renovation_cases(id,brf_id,case_number,title,status) values ($1,$2,$3,$4,$5)', [id, brfId, id, 'Test', 'draft'])
  return id
}
async function submit(caseId: string, version: string | null, accepted = true) {
  await db.query(`update renovation_cases set status='submitted', rules_version_id=$2,
    rules_accepted_at=$3, rules_accepted_name='Sokande', rules_accepted_email='resident@example.test' where id=$1`,
  [caseId, version, accepted ? '2001-01-01T00:00:00Z' : null])
}
async function receipt(caseId: string) {
  return (await db.query<Record<string, string | null>>(`select status,rules_version_id,rules_accepted_at,rules_accepted_name,rules_accepted_email,rules_checked_at
    from renovation_cases where id=$1`, [caseId])).rows[0]
}

test('migration is repeatable and leaves historical applications without fabricated consent', async () => {
  await db.exec(migration)
  assert.equal((await receipt(legacyCase)).rules_checked_at, null)
  const version = await publish(legacyBrf)
  await db.query("update renovation_cases set status='need_info' where id=$1", [legacyCase])
  await db.query("update renovation_cases set status='review' where id=$1", [legacyCase])
  assert.equal((await receipt(legacyCase)).rules_accepted_at, null)
  await assert.rejects(db.query('update renovation_cases set rules_version_id=$2 where id=$1', [legacyCase, version]), /RULES_ACCEPTANCE_IMMUTABLE/)
})

test('draft saving does not record consent; submission without active rules works', async () => {
  const id = await draft(await brf())
  await db.query("update renovation_cases set rules_accepted_at=now(), rules_accepted_name='Pretend' where id=$1", [id])
  assert.equal((await receipt(id)).rules_accepted_at, null)
  await submit(id, null)
  const saved = await receipt(id)
  assert.equal(saved.status, 'submitted')
  assert.ok(saved.rules_checked_at)
  assert.equal(saved.rules_accepted_at, null)
  assert.equal(saved.rules_accepted_name, null)
})

test('first submission enforces active rules and rolls back status on missing consent', async () => {
  const association = await brf(), id = await draft(association)
  const version = await publish(association)
  await assert.rejects(submit(id, null), /RULES_VERSION_CHANGED/)
  await assert.rejects(submit(id, version, false), /RULES_ACCEPTANCE_REQUIRED/)
  assert.equal((await receipt(id)).status, 'draft')
  await submit(id, version)
  const saved = await receipt(id)
  assert.equal(saved.rules_version_id, version)
  assert.equal(saved.rules_accepted_name, 'Sokande')
  assert.equal(saved.rules_accepted_email, 'resident@example.test')
  assert.ok(new Date(String(saved.rules_accepted_at)).getTime() > Date.now() - 60000)
})

test('inserting a submitted case directly cannot bypass consent', async () => {
  const association = await brf()
  await publish(association)
  const id = randomUUID()
  await assert.rejects(db.query('insert into renovation_cases(id,brf_id,case_number,title) values($1,$2,$3,$4)', [id, association, id, 'Direct']), /RULES_VERSION_CHANGED/)
  assert.equal((await db.query('select id from renovation_cases where id=$1', [id])).rows.length, 0)
})

test('stale publication and stale acceptance fail, preserving draft values', async () => {
  const association = await brf(), id = await draft(association)
  const first = await publish(association)
  const second = await publish(association, first, { format: 'text', body: 'Nya regler' })
  await assert.rejects(publish(association, first), /RULES_VERSION_CHANGED/)
  await assert.rejects(submit(id, first), /RULES_VERSION_CHANGED/)
  assert.equal((await receipt(id)).status, 'draft')
  await submit(id, second)
})

test('completion preserves the original text version after replacement and withdrawal', async () => {
  const association = await brf(), id = await draft(association)
  const version = await publish(association)
  await submit(id, version)
  const original = await receipt(id)
  const replacement = await publish(association, version, { format: 'text', body: 'Andrade regler' })
  await publish(association, replacement, null)
  await db.query("update renovation_cases set status='need_info' where id=$1", [id])
  await db.query("update renovation_cases set status='review' where id=$1", [id])
  assert.deepEqual({ ...await receipt(id), status: 'submitted' }, original)
  assert.equal((await db.query<{ body: string }>('select body from renoapp_brf_rules_versions where id=$1', [version])).rows[0].body, 'Tysta arbeten efter 18.00.\n\nSkydda hissen.')
  await assert.rejects(db.query('update renovation_cases set rules_accepted_at=now() where id=$1', [id]), /RULES_ACCEPTANCE_IMMUTABLE/)
  await assert.rejects(db.query("update renovation_cases set status='draft' where id=$1", [id]), /CASE_LOCKED/)
})

test('PDF versions and acceptance survive withdrawal and cannot be rewritten or deleted', async () => {
  const association = await brf(), id = await draft(association)
  const path = `${association}/published/${randomUUID()}.pdf`
  const version = await publish(association, null, { format: 'pdf', file_name: 'Regler.pdf', file_path: path })
  await submit(id, version)
  await publish(association, version, null)
  assert.equal((await receipt(id)).rules_version_id, version)
  assert.equal((await db.query<{ file_path: string }>('select file_path from renoapp_brf_rules_versions where id=$1', [version])).rows[0].file_path, path)
  await assert.rejects(db.query("update renoapp_brf_rules_versions set file_name='Changed.pdf' where id=$1", [version]), /RULES_VERSION_IMMUTABLE/)
  await assert.rejects(db.query('delete from renoapp_brf_rules_versions where id=$1', [version]), /RULES_VERSION_IMMUTABLE/)
})

test('rules from another BRF cannot be linked or accepted', async () => {
  const a = await brf(), b = await brf(), caseB = await draft(b)
  const versionA = await publish(a)
  await assert.rejects(submit(caseB, versionA), /RULES_VERSION_CHANGED/)
  await assert.rejects(db.query('update brf_associations set renovation_rules_version_id=$2 where id=$1', [b, versionA]), /foreign key constraint/)
})

test('withdrawal is detected for open drafts and new drafts no longer need consent', async () => {
  const association = await brf(), id = await draft(association)
  const version = await publish(association)
  await publish(association, version, null)
  await assert.rejects(submit(id, version), /RULES_VERSION_CHANGED/)
  await submit(id, null, false)
  assert.equal((await receipt(id)).rules_accepted_at, null)
})

test('empty publications fail and clients cannot read history or call the publishing RPC', async () => {
  const association = await brf()
  for (const content of [{ format: 'text', body: '' }, { format: 'text' }, { format: 'pdf' }]) {
    await assert.rejects(publish(association, null, content), /check constraint/)
  }
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    await assert.rejects(db.query('select * from renoapp_brf_rules_versions'), /permission denied/)
    await assert.rejects(publish(association), /permission denied/)
    await db.exec('reset role')
  }
})

test('application mapping ignores consent on autosave and completion', () => {
  const input = { mode: 'submit' as const, isCompletion: false, versionId: randomUUID(), accepted: true, applicantName: 'Name', applicantEmail: 'name@example.test' }
  assert.deepEqual(rulesAcceptanceFields({ ...input, mode: 'draft' }), {})
  assert.deepEqual(rulesAcceptanceFields({ ...input, isCompletion: true }), {})
  assert.equal(rulesAcceptanceFields({ ...input, accepted: false }).rules_accepted_at, null)
  assert.equal(rulesAcceptanceFields(input).rules_version_id, input.versionId)
})
