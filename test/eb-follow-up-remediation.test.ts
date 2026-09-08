import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// Real PostgreSQL migrations/RPCs, in an ephemeral local WASM database only.
const db = new PGlite()
const org = randomUUID(), profile = randomUUID()
const migration = (name: string) => readFileSync(new URL(`../docs/db/${name}`, import.meta.url), 'utf8')
before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key);
    create table profiles(id uuid primary key);
    create table eb_projects(id uuid primary key, org_id uuid references organizations);
    create table inspections(id uuid primary key);
    create table eb_notes(id uuid primary key, org_id uuid references organizations,
      eb_project_id uuid references eb_projects, inspection_id uuid references inspections,
      trade_group text, responsible_party text, note_text text);
    create table inspection_report_links(id uuid primary key, org_id uuid references organizations,
      inspection_id uuid references inspections, snapshot_payload jsonb,
      revoked_at timestamptz, created_at timestamptz default now());
    create function eb_set_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at := clock_timestamp(); return new; end $$;
    create function is_org_member(uuid) returns boolean language sql stable as $$ select true $$;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  `)
  await db.exec(migration('2026-08-15_01_eb_remediation_portal.sql'))
  // The billing portion of the historical scope migration is unrelated; this
  // is its exact additional portal column needed by the two new migrations.
  await db.exec('alter table eb_remediation_access_links add column inspection_id uuid references inspections;')
  await db.exec(migration('2026-09-07_07_eb_follow_up_orders.sql'))
  await db.exec(migration('2026-09-07_08_eb_follow_up_remediation.sql'))
  await db.exec(migration('2026-09-07_08_eb_follow_up_remediation.sql'))
  await db.query('insert into organizations(id) values($1)', [org])
  await db.query('insert into profiles(id) values($1)', [profile])
  await db.exec(`create function test_reject_outbox() returns trigger language plpgsql as $$
    begin if current_setting('app.test_reject_outbox',true)='yes' then raise exception 'TEST_OUTBOX_FAILURE'; end if; return new; end $$;
    create trigger test_reject_outbox before insert on eb_follow_up_email_outbox for each row execute function test_reject_outbox();`)
})
after(async () => { await db.close() })

type Row = Record<string, unknown>
type Task = { id: string; updated_at: string; status: string; note_snapshot: Row; original_images: Row[]; remediation_assignee_id: string | null }
async function fixture(paid = true) {
  const project = randomUUID(), inspection = randomUUID(), note = randomUUID(), link = randomUUID()
  const order = paid ? randomUUID() : null, task = randomUUID(), assignee = randomUUID(), owner = randomUUID(), worker = randomUUID(), viewer = randomUUID()
  await db.query('insert into eb_projects values($1,$2)', [project, org])
  await db.query('insert into inspections values($1)', [inspection])
  await db.query('insert into eb_notes(id,org_id,eb_project_id,inspection_id,note_text) values($1,$2,$3,$4,$5)', [note, org, project, inspection, 'ORIGINAL NOTE'])
  await db.query('insert into inspection_report_links(id,org_id,inspection_id,snapshot_payload) values($1,$2,$3,$4)', [link, org, inspection, { text: 'ORIGINAL REPORT' }])
  if (order) await db.query(`insert into eb_follow_up_orders(id,org_id,eb_project_id,inspection_id,report_link_id,
    report_snapshot,buyer_snapshot,seller_snapshot,terms_version,accept_terms,request_immediate_start,accept_invoice)
    values($1,$2,$3,$4,$5,$6,$7,$8,'2026-09-07',true,true,true)`,
  [order, org, project, inspection, link, { text: 'PURCHASED REPORT' }, { name: 'Customer', email: 'buyer@example.test' }, { name: 'Seller' }])
  await db.query(`insert into eb_remediation_assignees(id,org_id,eb_project_id,follow_up_order_id,name,normalized_name,email)
    values($1,$2,$3,$4,'Worker','worker','worker@example.test')`, [assignee, org, project, order])
  await db.query(`insert into eb_remediation_tasks(id,org_id,eb_project_id,inspection_id,eb_note_id,original_note_id,
    follow_up_order_id,remediation_assignee_id,status,note_snapshot,original_images)
    values($1,$2,$3,$4,$5,$5,$6,$7,'assigned',$8,$9)`,
  [task, org, project, inspection, note, order, assignee, { noteText: 'PURCHASED NOTE', noteNumber: 1 }, [{ imageUrl: 'https://example.test/original.jpg' }]])
  for (const [id, role] of [[owner, paid ? 'customer_owner' : 'contractor_admin'], [worker, 'assignee'], [viewer, 'contractor_viewer']]) {
    await db.query(`insert into eb_remediation_access_links(id,org_id,eb_project_id,inspection_id,follow_up_order_id,
      remediation_assignee_id,role,email,display_name,token_hash,expires_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '180 days')`,
    [id, org, project, inspection, order, role === 'assignee' ? assignee : null, role,
      role === 'customer_owner' ? 'buyer@example.test' : 'worker@example.test', role, `hash-${id}`])
  }
  const current = async () => (await db.query<Task>('select * from eb_remediation_tasks where id=$1', [task])).rows[0]
  const action = async (actor: string | null, kind: string, payload: Row, expected?: string) => {
    const stamp = expected ?? (await current()).updated_at
    return (await db.query<{ result: Task }>('select eb_apply_remediation_action($1,$2,$3,$4,$5,$6,$7) result',
      [org, project, task, stamp, kind, payload, actor ? { accessLinkId: actor, name: 'SPOOFED NAME', email: 'spoofed@example.test' } : { profileId: profile, name: 'Inspector' }])).rows[0].result
  }
  const events = async () => (await db.query<Row>('select * from eb_remediation_events where task_id=$1 order by created_at', [task])).rows
  const jobs = async () => (await db.query<Row>('select * from eb_follow_up_email_outbox where order_id=$1', [order])).rows
  return { project, inspection, note, link, order, task, assignee, owner, worker, viewer, current, action, events, jobs }
}

test('contractor completion commits task, trusted audit identity and one durable notification, not inspection approval', async () => {
  const f = await fixture()
  const task = await f.action(f.worker, 'status', { status: 'reported_remedied', message: 'Åtgärdat enligt bifogad redogörelse.' })
  assert.equal(task.status, 'reported_remedied')
  const events = await f.events(), jobs = await f.jobs()
  assert.equal(events.length, 1)
  assert.equal(events[0].actor_name, 'assignee')
  assert.equal(events[0].actor_email, 'worker@example.test')
  assert.equal(events[0].from_status, 'assigned')
  assert.equal(events[0].to_status, 'reported_remedied')
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].event_id, events[0].id)
  assert.equal(jobs[0].kind, 'task_event')
  assert.equal(jobs[0].status, 'pending')
  assert.equal((await db.query<{ note_text: string }>('select note_text from eb_notes where id=$1', [f.note])).rows[0].note_text, 'ORIGINAL NOTE')
  assert.deepEqual((await db.query<{ snapshot_payload: Row }>('select snapshot_payload from inspection_report_links where id=$1', [f.link])).rows[0].snapshot_payload, { text: 'ORIGINAL REPORT' })
  assert.deepEqual((await db.query<{ report_snapshot: Row }>('select report_snapshot from eb_follow_up_orders where id=$1', [f.order])).rows[0].report_snapshot, { text: 'PURCHASED REPORT' })
  await assert.rejects(f.action(f.worker, 'status', { status: 'approved' }), /STATUS_INVALID/)
})

test('status, comment and image roll back completely if durable notification cannot be queued', async () => {
  const f = await fixture()
  const imageId = randomUUID()
  for (const [kind, payload] of [
    ['status', { status: 'in_progress' }], ['comment', { message: 'En kommentar.' }],
    ['image', { id: imageId, storageBucket: 'eb-remediation-images', filePath: `${f.project}/${f.task}/${imageId}.jpg`, contentType: 'image/jpeg', fileSizeBytes: 10 }],
  ] as const) {
    const before = await f.current()
    await db.exec("set app.test_reject_outbox='yes'")
    try { await assert.rejects(f.action(f.worker, kind, payload), /TEST_OUTBOX_FAILURE/) }
    finally { await db.exec("set app.test_reject_outbox='no'") }
    assert.deepEqual(await f.current(), before)
    assert.equal((await f.events()).length, 0)
    assert.equal((await f.jobs()).length, 0)
    assert.equal((await db.query('select id from eb_remediation_images where task_id=$1', [f.task])).rows.length, 0)
  }
})

test('read-only, revoked, expired, other inspection and legacy links cannot write a paid task', async () => {
  const f = await fixture()
  for (const kind of ['status', 'comment', 'image', 'assign']) {
    await assert.rejects(f.action(f.viewer, kind, { status: 'in_progress', message: 'Forbidden', assigneeId: f.assignee }), /ACTION_FORBIDDEN/)
  }
  await db.query('update eb_remediation_access_links set revoked_at=now() where id=$1', [f.worker])
  await assert.rejects(f.action(f.worker, 'comment', { message: 'Forbidden' }), /ACCESS_REVOKED/)
  await db.query("update eb_remediation_access_links set revoked_at=null, expires_at=now()-interval '1 second' where id=$1", [f.worker])
  await assert.rejects(f.action(f.worker, 'status', { status: 'in_progress' }), /ACCESS_EXPIRED/)
  await db.query("update eb_remediation_access_links set expires_at=now()+interval '1 day',follow_up_order_id=null where id=$1", [f.worker])
  await assert.rejects(f.action(f.worker, 'comment', { message: 'Legacy cannot enter paid scope' }), /TASK_NOT_FOUND/)
  await db.query("update eb_remediation_access_links set role='contractor_admin' where id=$1", [f.viewer])
  await assert.rejects(f.action(f.viewer, 'comment', { message: 'A paid contractor admin also needs an explicit assignment' }), /TASK_NOT_FOUND/)
  assert.equal((await f.events()).length, 0)
  assert.equal((await f.jobs()).length, 0)
})

test('a reassignment immediately removes the previous worker permission and rejects stale concurrent mutations', async () => {
  const f = await fixture()
  const before = await f.current()
  const next = randomUUID()
  await db.query(`insert into eb_remediation_assignees(id,org_id,eb_project_id,follow_up_order_id,name,normalized_name)
    values($1,$2,$3,$4,'Another','another')`, [next, org, f.project, f.order])
  await f.action(f.owner, 'assign', { assigneeId: next })
  await assert.rejects(f.action(f.worker, 'comment', { message: 'Old worker' }), /TASK_NOT_FOUND/)
  await assert.rejects(f.action(f.owner, 'comment', { message: 'Stale owner write' }, before.updated_at), /CONFLICT/)
  assert.equal((await f.current()).remediation_assignee_id, next)
  assert.equal((await f.events()).length, 1)
  assert.equal((await f.jobs()).length, 1)
})

test('completion needs evidence; customer return needs a reason; photos are distinct from original snapshot images', async () => {
  const f = await fixture()
  await assert.rejects(f.action(f.worker, 'status', { status: 'reported_remedied' }), /COMPLETION_EVIDENCE_REQUIRED/)
  await assert.rejects(f.action(f.owner, 'status', { status: 'returned' }), /COMMENT_REQUIRED/)
  await assert.rejects(f.action(f.owner, 'status', { status: 'reported_remedied', message: 'Approve' }), /ACTION_FORBIDDEN/)
  const imageId = randomUUID()
  await f.action(f.worker, 'image', { id: imageId, storageBucket: 'eb-remediation-images',
    filePath: `${f.project}/${f.task}/${imageId}.jpg`, contentType: 'image/jpeg', fileSizeBytes: 10, fileName: 'Efter.jpg' })
  const image = (await db.query<Row>('select * from eb_remediation_images where id=$1', [imageId])).rows[0]
  assert.equal(image.event_id, (await f.events())[0].id)
  await f.action(f.worker, 'status', { status: 'reported_remedied' })
  await f.action(f.owner, 'status', { status: 'returned', message: 'Komplettera med bild från sidan.' })
  assert.equal((await f.current()).status, 'returned')
  assert.deepEqual((await f.current()).original_images, [{ imageUrl: 'https://example.test/original.jpg' }])
  assert.equal((await f.events()).length, 3)
  assert.equal((await f.jobs()).length, 3)
})

test('withdrawal stops contractor writes while preserving the purchased report and history', async () => {
  const f = await fixture()
  await db.query('select eb_withdraw_follow_up_order($1,$2)', [f.order, 'buyer@example.test'])
  for (const kind of ['status', 'comment', 'image', 'assign']) {
    await assert.rejects(f.action(f.worker, kind, { status: 'in_progress', message: 'Too late' }), /ORDER_INACTIVE/)
  }
  assert.equal((await f.current()).status, 'assigned')
  assert.equal((await f.events()).length, 0)
  assert.equal((await f.jobs()).length, 1)
  assert.equal((await f.jobs())[0].kind, 'withdrawal')
})

test('paid original snapshots cannot be rewritten or deleted, even by a trusted direct database writer', async () => {
  const f = await fixture()
  for (const sql of [
    "update eb_remediation_tasks set note_snapshot='{}' where id=$1",
    "update eb_remediation_tasks set original_images='[]' where id=$1",
    'update eb_remediation_tasks set follow_up_order_id=null where id=$1',
    'delete from eb_remediation_tasks where id=$1',
  ]) await assert.rejects(db.query(sql, [f.task]), /TASK_IMMUTABLE/)
  const legacyTask = randomUUID()
  await db.query(`insert into eb_remediation_tasks(id,org_id,eb_project_id,inspection_id,eb_note_id,note_snapshot)
    values($1,$2,$3,$4,$5,'{}')`, [legacyTask, org, f.project, f.inspection, f.note])
  await db.query('delete from eb_notes where id=$1', [f.note])
  const saved = (await db.query<Row>('select * from eb_remediation_tasks where id=$1', [f.task])).rows[0]
  assert.equal(saved.eb_note_id, null)
  assert.equal(saved.original_note_id, f.note)
  assert.deepEqual(saved.note_snapshot, { noteText: 'PURCHASED NOTE', noteNumber: 1 })
  assert.equal((await db.query('select id from eb_remediation_tasks where id=$1', [legacyTask])).rows.length, 0,
    'legacy source-note deletion retains its old cascade semantics while the paid snapshot survives')
})

test('legacy portals retain image-before-review and contractor administration, without paid notifications', async () => {
  const f = await fixture(false)
  await assert.rejects(f.action(f.worker, 'status', { status: 'ready_for_review' }), /COMPLETION_IMAGE_REQUIRED/)
  await f.action(f.worker, 'status', { status: 'in_progress' })
  await f.action(f.owner, 'assign', { assigneeId: null })
  assert.equal((await f.current()).status, 'unassigned')
  assert.equal((await f.events()).length, 2)
  assert.equal((await f.jobs()).length, 0)
})

test('anon and authenticated roles cannot invoke RPC or bypass paid protections with REST-style table writes', async () => {
  const paid = await fixture(), legacy = await fixture(false)
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    try {
      await assert.rejects(paid.action(paid.owner, 'comment', { message: 'Bypass' }, (await db.query<{ now: string }>('select now()')).rows[0].now), /permission denied/)
      if (role === 'anon') {
        await assert.rejects(db.query('select * from eb_remediation_tasks'), /permission denied/)
      } else {
        const result = await db.query('update eb_remediation_tasks set status=$1 where id=$2 returning id', ['in_progress', paid.task])
        assert.equal(result.rows.length, 0)
        await assert.rejects(db.query(`insert into eb_remediation_events(org_id,eb_project_id,task_id,event_type,message)
          values($1,$2,$3,'comment','Bypass')`, [org, paid.project, paid.task]), /row-level security/)
        const allowedLegacy = await db.query('select id from eb_remediation_tasks where id=$1', [legacy.task])
        assert.equal(allowedLegacy.rows.length, 1)
      }
    } finally { await db.exec('reset role') }
  }
})

test('competing notification claims never claim one job twice; stale leases recover and cannot acknowledge new work', async () => {
  // Drain unrelated fixture jobs so this test has exactly one eligible row.
  await db.exec("update eb_follow_up_email_outbox set status='sent'")
  const f = await fixture()
  await f.action(f.worker, 'comment', { message: 'Send one notification.' })
  const claims = await Promise.all([1, 2].map(() => db.query<Row>('select * from eb_claim_follow_up_emails(1)')))
  assert.equal(claims.flatMap(result => result.rows).length, 1)
  const first = claims.flatMap(result => result.rows)[0]
  await db.query("update eb_follow_up_email_outbox set locked_at=now()-interval '6 minutes' where id=$1", [first.id])
  const second = (await db.query<Row>('select * from eb_claim_follow_up_emails(1)')).rows[0]
  assert.equal(second.id, first.id)
  assert.notEqual(second.lease_id, first.lease_id)
  assert.equal((await db.query<{ ok: boolean }>('select eb_finish_follow_up_email($1,$2,true) ok', [first.id, first.lease_id])).rows[0].ok, false)
  assert.equal((await db.query<{ ok: boolean }>('select eb_finish_follow_up_email($1,$2,true) ok', [second.id, second.lease_id])).rows[0].ok, true)
  assert.equal((await db.query('select * from eb_claim_follow_up_emails(1)')).rows.length, 0)
})
