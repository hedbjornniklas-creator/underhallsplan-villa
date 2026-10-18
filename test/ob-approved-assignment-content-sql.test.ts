import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomUUID, createHash } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node strip-types requires the explicit extension.
import { runtimeDb, sql, ORG, ACTOR } from './helpers/ob-organization-runtime-db.ts'

let db: PGlite
const migration = sql('2026-10-15_01_ob_approved_assignment_content_lock.sql')
let historic: string
let historicBefore: unknown

before(async () => {
  db = await runtimeDb(false)
  const normalizedTu = sql('2026-05-27_01_tu_module_foundation.sql').replace(/\r\n/g, '\n')
  const startConstraint = normalizedTu.indexOf('alter table public.assignments\n  drop constraint if exists assignments_type_check;')
  assert.ok(startConstraint >= 0)
  await db.exec(normalizedTu.slice(startConstraint, normalizedTu.indexOf('alter table public.inspections', startConstraint)))
  historic = await issue()
  await approve(historic)
  // An older inconsistent row must still be protected by its acceptance evidence.
  await db.query("update assignments set status='draft',accepted_at=null,last_sent_at=null,terms_version=null,terms_document_hash=null where id=$1", [historic])
  historicBefore = (await db.query('select to_jsonb(a) value from assignments a where id=$1', [historic])).rows
  await db.exec(migration)
})
after(async () => { await db?.close() })

const text = 'Synthetic frozen agreement terms'
const hash = createHash('sha256').update(text).digest('hex')
function documentSource(type: string) {
  return { schemaVersion: 'ob-confirmation-v1', issuerName: 'Synthetic company', inspector: {},
    terms: { version: 'test-v1', documentHash: hash, text, role: type === 'STATUS' ? 'status' : 'seller',
      ...(type === 'STATUS' ? { verbatim: true, sourceId: 'OB_STATUS_2026_1' } : {}) },
    ...(type === 'STATUS' ? { statusObjectType: 'property', statusPriceAmount: 1500, statusScopeDescription: 'Agreed scope' } : {}),
  }
}
async function issue(type = 'OB') {
  const id = randomUUID()
  await db.query(`insert into assignments(id,org_id,responsible_profile_id,customer_email,customer_name,property_address,
    assignment_type,orderer_role,status,preferred_date,price_amount,scope_description,assignment_details,notes_internal)
    values($1,$2,$3,'customer@example.test','Original customer','Original street',$4,$5,'draft','2026-10-15',1500,'Agreed scope',$6,'Original note')`,
    [id, ORG, ACTOR, type, type === 'STATUS' ? 'Statusbesiktning' : 'Säljare', JSON.stringify(type === 'STATUS' ? { objectType: 'property' } : {})])
  await db.query("update assignments set status='sent',last_sent_at=now() where id=$1", [id])
  await db.query(`insert into assignment_links(assignment_id,org_id,token_hash,expires_at,terms_version,status_document_source)
    values($1::uuid,$2,encode(digest($1::uuid::text,'sha256'),'hex'),now()+interval '1 day','test-v1',$3)`,
    [id, ORG, type === 'STATUS' ? JSON.stringify(documentSource(type)) : null])
  return id
}
async function approve(id: string, type = 'OB') {
  await db.query('select * from consume_assignment_token($1,$2,$3::jsonb,null,null)', [id, 'test-v1', JSON.stringify({
    terms_document_hash: hash, ob_document_source: documentSource(type), addon_service_ids: [],
    customer_name: 'Approved customer', property_address: 'Approved street',
    invoice_name: 'Approved invoice', price_amount: 1500, scope_description: 'Agreed scope',
    ...(type === 'STATUS' ? { assignment_details: { objectType: 'property' }, orderer_role: 'Statusbesiktning' } : {}),
  })])
}
async function start(id: string, type = 'OB') {
  return (await db.query<{ value: { inspectionId: string } }>(
    type === 'STATUS' ? 'select ob_start_status_assignment_inspection($1,$2,$3) value' :
      'select ob_start_assignment_inspection($1,$2,$3,null) value', [id, ORG, ACTOR])).rows[0].value
}

test('migration is repeatable, preserves existing data, and acceptance evidence locks even an inconsistent historical draft', async () => {
  await db.exec(migration)
  assert.deepEqual((await db.query('select to_jsonb(a) value from assignments a where id=$1', [historic])).rows, historicBefore)
  await assert.rejects(db.query("update assignments set customer_name='Changed' where id=$1", [historic]), /OB_ASSIGNMENT_CONTENT_LOCKED/)
})

for (const type of ['OB', 'STATUS']) {
  test(`${type}: real first acceptance, booking and conversion still work; approved content and archives remain frozen`, async () => {
    const id = await issue(type)
    await approve(id, type)
    const accepted = (await db.query<{ customer_name: string; property_address: string; status: string }>('select * from assignments where id=$1', [id])).rows[0]
    assert.equal(accepted.customer_name, 'Approved customer')
    assert.equal(accepted.property_address, 'Approved street')
    assert.equal(accepted.status, 'ordered')
    const snapshots = (await db.query('select * from assignment_confirmation_snapshots where assignment_id=$1', [id])).rows
    assert.equal(snapshots.length, 1)
    await db.query(`insert into assignment_confirmation_pdfs(assignment_id,org_id,acceptance_id,accepted_at,filename,pdf_base64)
      select assignment_id,org_id,id,accepted_at,'frozen.pdf',$2 from assignment_acceptances where assignment_id=$1`,
      [id, Buffer.from('%PDF-1.4\nSynthetic original\n%%EOF').toString('base64')])
    const pdfs = (await db.query('select * from assignment_confirmation_pdfs where assignment_id=$1', [id])).rows

    for (const state of ['ordered', 'booked', 'completed', 'cancelled', 'expired']) {
      if (state === 'booked') await db.query("update assignments set status='booked',booked_at=now() where id=$1", [id])
      else if (state === 'completed') assert.ok((await start(id, type)).inspectionId)
      else await db.query('update assignments set status=$2 where id=$1', [id, state])
      for (const change of [
        "customer_name='Changed'", "customer_email='changed@example.test'", "property_address='Changed'",
        'price_amount=0', "scope_description='Changed'", "invoice_name='Changed'", "notes_internal='Changed'",
        "assignment_details='{\"changed\":true}'", 'accepted_at=null', "terms_version='Changed'", "status='draft'",
      ]) {
        await assert.rejects(db.query(`update assignments set ${change} where id=$1`, [id]), /OB_ASSIGNMENT_CONTENT_LOCKED/, `${state}: ${change}`)
      }
    }
    await db.query('update assignments set archived_at=now(),archived_by=$2 where id=$1', [id, ACTOR])
    await db.query('update assignments set archived_at=null,archived_by=null where id=$1', [id])
    assert.deepEqual((await db.query('select * from assignment_confirmation_snapshots where assignment_id=$1', [id])).rows, snapshots)
    assert.deepEqual((await db.query('select * from assignment_confirmation_pdfs where assignment_id=$1', [id])).rows, pdfs)
  })
}

test('real early-start reissue produces an editable new draft but leaves its approved source locked', async () => {
  const id = await issue()
  await db.query('select ob_start_assignment_inspection($1,$2,$3,$4)', [id, ORG, ACTOR, 'Customer approval still pending'])
  await approve(id)
  const replacement = (await db.query<{ value: string }>('select ob_reissue_started_assignment($1,$2,$3) value', [id, ORG, ACTOR])).rows[0].value
  await db.query("update assignments set customer_name='Replacement customer',price_amount=1600 where id=$1", [replacement])
  await assert.rejects(db.query("update assignments set customer_name='Overwrite original' where id=$1", [id]), /OB_ASSIGNMENT_CONTENT_LOCKED/)
  const draft = (await db.query<{ status: string; converted_at: string; inspection_id: string }>('select * from assignments where id=$1', [replacement])).rows[0]
  assert.equal(draft.status, 'draft')
  assert.ok(draft.converted_at)
  assert.ok(draft.inspection_id)
})

test('the new database guard does not change TU/EB assignment behavior', async () => {
  for (const type of ['TU', 'EB']) {
    const id = (await db.query<{ id: string }>(`insert into assignments(org_id,responsible_profile_id,customer_email,assignment_type,status,accepted_at,terms_version)
      values($1,$2,'other@example.test',$3,'ordered',now(),'test-v1') returning id`, [ORG, ACTOR, type])).rows[0].id
    await db.query("update assignments set customer_name='Existing module behavior' where id=$1", [id])
  }
})
