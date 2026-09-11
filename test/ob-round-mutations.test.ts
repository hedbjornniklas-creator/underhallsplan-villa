import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const org = randomUUID(),
  actor = randomUUID(),
  stranger = randomUUID()
const migration = readFileSync(
  new URL('../docs/db/2026-09-11_01_ob_round_mutations.sql', import.meta.url),
  'utf8',
)
before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key);
    create table org_members(org_id uuid,profile_id uuid,role text,is_active boolean);
    create table properties(id uuid primary key default gen_random_uuid(),owner uuid references profiles(id));
    create table inspections(id uuid primary key default gen_random_uuid(),property_id uuid references properties(id),
      type text default 'OB',inspection_family text default 'OB',inspection_side text default 'buyer',
      locked_at timestamptz,locked_by uuid,status text default 'draft');
    create table assignments(id uuid primary key default gen_random_uuid());
    create table ob_assignment_workflows(inspection_id uuid primary key,current_assignment_id uuid);
    create table test_paused(inspection_id uuid primary key);
    create function ob_assignment_workflow_state(uuid) returns jsonb language sql as $$
      select jsonb_build_object('paused',exists(select 1 from test_paused where inspection_id=$1)) $$;
    create table settings_exterior_items(id uuid primary key default gen_random_uuid(),key text default 'fasad',label text default 'Fasad',is_active boolean default true);
    create table settings_control_points(id uuid primary key default gen_random_uuid(),title text default 'Kontroll',key text default 'test',label text,applies_to text[],is_active boolean default true);
    create table settings_control_point_outcomes(id uuid primary key default gen_random_uuid(),control_point_id uuid references settings_control_points(id),label text, is_active boolean default true);
    create table inspection_interior_rooms(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),floor_label text not null,
      order_index int default 10,room_type_key text default 'hall',room_label text default 'Hall',values jsonb default '{}',note text,updated_at timestamptz default now());
    create table inspection_exterior_observations(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),
      exterior_item_id uuid references settings_exterior_items(id),part_label text,values jsonb default '{}',is_free_note boolean default false,created_at timestamptz default now());
    create table inspection_control_items(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),
      interior_room_id uuid references inspection_interior_rooms(id) on delete cascade,
      exterior_observation_id uuid references inspection_exterior_observations(id),control_point_id uuid references settings_control_points(id),
      selected_outcome_id uuid references settings_control_point_outcomes(id),title text not null,status text,note text,risk_text text,ftu_text text,
      sort_order int default 10,updated_at timestamptz default now());
    create table inspection_images(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),
      control_item_id uuid references inspection_control_items(id) on delete cascade,
      interior_room_id uuid references inspection_interior_rooms(id),exterior_observation_id uuid references inspection_exterior_observations(id),
      origin_interior_room_id uuid references inspection_interior_rooms(id),origin_exterior_observation_id uuid references inspection_exterior_observations(id),
      origin_exterior_item_id uuid references settings_exterior_items(id),origin_floor_label text,file_path text default 'test-original.jpg',
      thumbnail_file_path text default 'test-thumbnail.jpg',label text,processing_status text default 'unprocessed',ignored_at timestamptz);
    create table inspection_round_quick_notes(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),
      interior_room_id uuid references inspection_interior_rooms(id) on delete cascade,exterior_observation_id uuid, note text default '');
    create table settings_overview_items(id uuid primary key,key text,is_active boolean);
    create table inspection_overview_selections(inspection_id uuid,overview_item_id uuid,values jsonb,set_index int);
    create table settings_overview_groups(id uuid primary key,overview_item_id uuid,key text,is_active boolean);
    create table settings_overview_options(group_id uuid,value text,label text,system_value text,is_active boolean);
    insert into profiles values('${actor}'),('${stranger}');
    insert into org_members values('${org}','${actor}','inspector',true),('${org}','${stranger}','inspector',true);
  `)
  await db.exec(
    readFileSync(
      new URL(
        '../docs/db/2026-03-24_03_inspection_lock_write_guards.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  await db.exec(migration)
  await db.exec(migration)
})
after(() => db.close())
// SQL fixtures intentionally exercise multiple table and JSON result shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function one(sql: string, params: unknown[] = []): Promise<any> {
  return (await db.query(sql, params)).rows[0]
}
async function fixture() {
  const property = await one(
    'insert into properties(owner) values($1) returning *',
    [actor],
  )
  const inspection = await one(
    'insert into inspections(property_id) values($1) returning *',
    [property.id],
  )
  const room = await one(
    "insert into inspection_interior_rooms(inspection_id,floor_label) values($1,'plan1') returning *",
    [inspection.id],
  )
  const target = await one(
    "insert into inspection_interior_rooms(inspection_id,floor_label) values($1,'plan2') returning *",
    [inspection.id],
  )
  const note = await one(
    "insert into inspection_control_items(inspection_id,interior_room_id,title,note,risk_text,ftu_text,status) values($1,$2,'Notering','Behall text','Behall risk','Behall utredning','remark') returning *",
    [inspection.id, room.id],
  )
  const image = await one(
    "insert into inspection_images(inspection_id,interior_room_id,origin_interior_room_id,origin_floor_label,control_item_id,processing_status) values($1,$2,$2,'plan1',$3,'linked') returning *",
    [inspection.id, room.id, note.id],
  )
  const loose = await one(
    'insert into inspection_images(inspection_id,interior_room_id,origin_interior_room_id) values($1,$2,$2) returning *',
    [inspection.id, room.id],
  )
  const exterior = await one(
    'insert into settings_exterior_items default values returning *',
  )
  return { id: inspection.id, room, target, note, image, loose, exterior }
}
async function rpc(
  id: string,
  operation: string,
  payload: object,
  user = actor,
  floors = ['plan1', 'plan2'],
) {
  return (
    await one(
      'select ob_round_mutate($1,$2,$3,$4,$5::jsonb,$6::text[]) as result',
      [id, org, user, operation, JSON.stringify(payload), floors],
    )
  ).result
}
const moveNote = (
  n: {
    id: string
    interior_room_id: string | null
    exterior_observation_id: string | null
  },
  target: object,
) => ({
  kind: 'note',
  id: n.id,
  from: {
    roomId: n.interior_room_id,
    observationId: n.exterior_observation_id,
  },
  target,
  requestId: randomUUID(),
})
async function remove(f: { id: string }, kind: string, id: string) {
  const preview = await rpc(f.id, 'remove-preview', { kind, id })
  const request = { kind, id, token: preview.token, requestId: randomUUID() }
  return { result: await rpc(f.id, 'remove', request), request }
}

test('move room preserves IDs, contents and all image provenance; retry is idempotent', async () => {
  const f = await fixture()
  const request = {
    kind: 'room',
    id: f.room.id,
    from: { floor: 'plan1' },
    floor: 'plan2',
    requestId: randomUUID(),
  }
  const result = await rpc(f.id, 'move', request)
  assert.equal(result.room.id, f.room.id)
  assert.equal(result.room.floor_label, 'plan2')
  assert.deepEqual(
    await one('select * from inspection_control_items where id=$1', [
      f.note.id,
    ]),
    f.note,
  )
  assert.deepEqual(
    await one('select * from inspection_images where id=$1', [f.image.id]),
    f.image,
  )
  assert.deepEqual(await rpc(f.id, 'move', request), result)
  assert.equal(
    (
      await one(
        'select count(*)::int as n from ob_round_mutation_events where inspection_id=$1',
        [f.id],
      )
    ).n,
    1,
  )
  await assert.rejects(
    rpc(f.id, 'move', { ...request, requestId: randomUUID(), floor: 'plan99' }),
    /OB_ROUND_INVALID/,
  )
})
test('note moves to exterior and back with images, all text and provenance intact', async () => {
  const f = await fixture()
  const legacy = await one(`insert into inspection_exterior_observations(inspection_id,exterior_item_id,values)
    values($1,$2,'{"_free_note":true}') returning *`, [f.id, f.exterior.id])
  const out = await rpc(
    f.id,
    'move',
    moveNote(f.note, { area: 'exterior', exteriorItemId: f.exterior.id }),
  )
  assert.ok(out.observation.id)
  assert.notEqual(out.observation.id, legacy.id, 'Use a main observation, not a legacy free-note row hidden by report grouping')
  assert.equal(out.note.interior_room_id, null)
  assert.equal(out.images[0].exterior_observation_id, out.observation.id)
  const back = await rpc(
    f.id,
    'move',
    moveNote(out.note, { area: 'interior', roomId: f.target.id }),
  )
  assert.equal(back.observation, null)
  for (const field of [
    'id',
    'title',
    'note',
    'risk_text',
    'ftu_text',
    'status',
    'control_point_id',
    'selected_outcome_id',
  ])
    assert.equal(back.note[field], f.note[field])
  assert.equal(back.images[0].interior_room_id, f.target.id)
  for (const field of [
    'file_path',
    'thumbnail_file_path',
    'origin_interior_room_id',
    'origin_floor_label',
  ])
    assert.equal(back.images[0][field], f.image[field])
  await assert.rejects(
    rpc(
      f.id,
      'move',
      moveNote(f.note, { area: 'interior', roomId: f.room.id }),
    ),
    /OB_ROUND_STALE/,
  )
})
test('delete note retains linked images as pending and archives text; late upserts cannot resurrect it', async () => {
  const f = await fixture(),
    { result, request } = await remove(f, 'note', f.note.id)
  assert.deepEqual(result.noteIds, [f.note.id])
  assert.equal(result.images[0].control_item_id, null)
  assert.equal(result.images[0].processing_status, 'unprocessed')
  assert.equal(result.images[0].origin_interior_room_id, f.room.id)
  assert.equal(
    (
      await one(
        'select before_data from ob_round_mutation_events where id=$1',
        [result.archiveId],
      )
    ).before_data.record.note,
    f.note.note,
  )
  assert.equal(
    await one('select * from inspection_control_items where id=$1', [
      f.note.id,
    ]),
    undefined,
  )
  assert.deepEqual(await rpc(f.id, 'remove', request), result)
  await assert.rejects(
    one(
      "insert into inspection_control_items(id,inspection_id,interior_room_id,title) values($1,$2,$3,'Late draft')",
      [f.note.id, f.id, f.room.id],
    ),
    /OB_ROUND_REMOVED/,
  )
  await assert.rejects(
    one(
      'insert into inspection_images(inspection_id,control_item_id) values($1,$2)',
      [f.id, f.note.id],
    ),
    /OB_ROUND_REMOVED/,
  )
})
test('delete image retains note and stores original/thumbnail references for recovery', async () => {
  const f = await fixture(),
    { result } = await remove(f, 'image', f.image.id)
  assert.deepEqual(result.imageIds, [f.image.id])
  assert.deepEqual(
    await one('select * from inspection_control_items where id=$1', [
      f.note.id,
    ]),
    f.note,
  )
  const archived = await one(
    'select before_data from ob_round_mutation_events where id=$1',
    [result.archiveId],
  )
  assert.equal(archived.before_data.record.file_path, f.image.file_path)
  assert.equal(
    archived.before_data.record.thumbnail_file_path,
    f.image.thumbnail_file_path,
  )
})
test('room removal protects content, empty free notes, OK checkpoints, quick notes and original image relationships', async () => {
  const f = await fixture()
  assert.ok(
    (await rpc(f.id, 'remove-preview', { kind: 'room', id: f.room.id }))
      .blockedReason,
  )
  const point = await one(
    'insert into settings_control_points default values returning *',
  )
  const row = await one(
    "insert into inspection_control_items(inspection_id,interior_room_id,title,control_point_id,status) values($1,$2,'Kontrollerad',$3,'ok') returning *",
    [f.id, f.target.id, point.id],
  )
  assert.ok(
    (await rpc(f.id, 'remove-preview', { kind: 'room', id: f.target.id }))
      .blockedReason,
  )
  await db.query(
    'update inspection_control_items set status=null where id=$1',
    [row.id],
  )
  const preview = await rpc(f.id, 'remove-preview', {
    kind: 'room',
    id: f.target.id,
  })
  assert.equal(preview.blockedReason, null)
  const { result } = await remove(f, 'room', f.target.id)
  assert.deepEqual(result.noteIds, [row.id])
  assert.equal(result.roomId, f.target.id)
  assert.equal(
    await one('select * from inspection_interior_rooms where id=$1', [
      f.target.id,
    ]),
    undefined,
  )
  const g = await fixture()
  await db.query(
    "insert into inspection_round_quick_notes(inspection_id,interior_room_id,note) values($1,$2,'Kvar att gora')",
    [g.id, g.target.id],
  )
  assert.ok(
    (await rpc(g.id, 'remove-preview', { kind: 'room', id: g.target.id }))
      .blockedReason,
  )
  const h = await fixture()
  await db.query(
    "insert into inspection_control_items(inspection_id,interior_room_id,title) values($1,$2,'Fri notering')",
    [h.id, h.target.id],
  )
  assert.ok(
    (await rpc(h.id, 'remove-preview', { kind: 'room', id: h.target.id }))
      .blockedReason,
  )
})
test('stale deletion previews cannot discard new text or images', async () => {
  const f = await fixture(),
    preview = await rpc(f.id, 'remove-preview', { kind: 'note', id: f.note.id })
  await db.query(
    "update inspection_control_items set note='New concurrent text' where id=$1",
    [f.note.id],
  )
  await assert.rejects(
    rpc(f.id, 'remove', {
      kind: 'note',
      id: f.note.id,
      token: preview.token,
      requestId: randomUUID(),
    }),
    /OB_ROUND_STALE/,
  )
  assert.equal(
    (
      await one('select note from inspection_control_items where id=$1', [
        f.note.id,
      ])
    ).note,
    'New concurrent text',
  )
})
test('image-note preview writes nothing; create uses image place and preserves templates; retry creates once', async () => {
  const f = await fixture(),
    preview = await rpc(f.id, 'image-note-preview', { imageId: f.loose.id })
  assert.equal(preview.room.id, f.room.id)
  assert.equal(preview.observation, null)
  assert.equal(preview.exteriorItem, null)
  assert.equal(
    (
      await one(
        'select count(*)::int as n from inspection_control_items where inspection_id=$1',
        [f.id],
      )
    ).n,
    1,
  )
  const point = await one(
    'insert into settings_control_points default values returning *',
  )
  const outcome = await one(
    'insert into settings_control_point_outcomes(control_point_id) values($1) returning *',
    [point.id],
  )
  const request = {
    imageId: f.loose.id,
    token: preview.token,
    requestId: randomUUID(),
    draft: {
      note: 'Anpassad text',
      risk_text: 'Risk',
      ftu_text: 'FTU',
      outcomeId: outcome.id,
    },
  }
  const created = await rpc(f.id, 'image-note', request)
  assert.equal(created.note.interior_room_id, f.room.id)
  assert.equal(created.image.control_item_id, created.note.id)
  assert.equal(created.note.control_point_id, point.id)
  assert.equal(created.note.selected_outcome_id, outcome.id)
  assert.equal(created.note.status, 'remark')
  assert.equal(created.note.note, 'Anpassad text')
  assert.equal(created.note.risk_text, 'Risk')
  assert.equal(created.note.ftu_text, 'FTU')
  assert.deepEqual(await rpc(f.id, 'image-note', request), created)
  assert.equal(
    (
      await one(
        'select count(*)::int as n from inspection_control_items where inspection_id=$1',
        [f.id],
      )
    ).n,
    2,
  )
  await assert.rejects(
    rpc(f.id, 'image-note', {
      ...request,
      draft: { ...request.draft, note: 'Changed' },
    }),
    /OB_ROUND_STALE/,
  )
  await assert.rejects(
    rpc(f.id, 'image-note', { ...request, requestId: randomUUID() }),
    /OB_ROUND_IMAGE_LINKED/,
  )
})
test('image-note supports exterior origin without current observation and rolls all changes back on failure', async () => {
  const f = await fixture()
  await db.query(
    'update inspection_images set interior_room_id=null,origin_interior_room_id=null,origin_exterior_item_id=$2 where id=$1',
    [f.loose.id, f.exterior.id],
  )
  const preview = await rpc(f.id, 'image-note-preview', { imageId: f.loose.id })
  assert.equal(preview.room, null)
  assert.equal(preview.observation, null)
  const request = {
    imageId: f.loose.id,
    token: preview.token,
    requestId: randomUUID(),
    draft: { note: 'Utsida', risk_text: '', ftu_text: '', outcomeId: null },
  }
  await db.exec(`create function test_fail_image() returns trigger language plpgsql as $$ begin raise exception 'TEST_WRITE_FAILURE'; end $$;
    create trigger zz_test_fail_image before update on inspection_images for each row execute function test_fail_image();`)
  await assert.rejects(rpc(f.id, 'image-note', request), /TEST_WRITE_FAILURE/)
  await db.exec(
    'drop trigger zz_test_fail_image on inspection_images; drop function test_fail_image();',
  )
  assert.equal(
    (
      await one(
        'select count(*)::int as n from inspection_exterior_observations where inspection_id=$1',
        [f.id],
      )
    ).n,
    0,
  )
  assert.equal(
    (
      await one(
        'select count(*)::int as n from inspection_control_items where inspection_id=$1',
        [f.id],
      )
    ).n,
    1,
  )
  const result = await rpc(f.id, 'image-note', request)
  assert.equal(result.note.exterior_observation_id, result.observation.id)
  assert.equal(result.image.origin_exterior_item_id, f.exterior.id)
})
test('rejects foreign targets, missing image place, unauthorized, locked and paused inspections', async () => {
  const f = await fixture(),
    other = await fixture()
  await assert.rejects(
    rpc(
      f.id,
      'move',
      moveNote(f.note, { area: 'interior', roomId: other.room.id }),
    ),
    /OB_ROUND_PLACE_REQUIRED/,
  )
  await assert.rejects(
    rpc(f.id, 'remove-preview', { kind: 'note', id: f.note.id }, stranger),
    /OB_ROUND_FORBIDDEN/,
  )
  await db.query(
    'update inspection_images set interior_room_id=null,origin_interior_room_id=null where id=$1',
    [f.loose.id],
  )
  await assert.rejects(
    rpc(f.id, 'image-note-preview', { imageId: f.loose.id }),
    /OB_ROUND_PLACE_REQUIRED/,
  )
  await db.query('insert into test_paused values($1)', [f.id])
  await assert.rejects(
    rpc(f.id, 'remove-preview', { kind: 'note', id: f.note.id }),
    /OB_ROUND_PAUSED/,
  )
  await db.query('delete from test_paused where inspection_id=$1', [f.id])
  await db.query('update inspections set locked_at=now() where id=$1', [f.id])
  await assert.rejects(
    rpc(f.id, 'remove-preview', { kind: 'note', id: f.note.id }),
    /OB_ROUND_LOCKED/,
  )
})
test('late linked uploads follow moved notes; direct writes cannot use foreign references', async () => {
  const f = await fixture(),
    other = await fixture()
  await rpc(
    f.id,
    'move',
    moveNote(f.note, { area: 'interior', roomId: f.target.id }),
  )
  const image = await one(
    'insert into inspection_images(inspection_id,control_item_id,interior_room_id,origin_interior_room_id) values($1,$2,$3,$3) returning *',
    [f.id, f.note.id, f.room.id],
  )
  assert.equal(image.interior_room_id, f.target.id)
  assert.equal(image.origin_interior_room_id, f.room.id)
  await assert.rejects(
    db.query(
      "insert into inspection_control_items(inspection_id,interior_room_id,title) values($1,$2,'Foreign')",
      [f.id, other.room.id],
    ),
    /OB_ROUND_FOREIGN/,
  )
})
test('mutation functions and recovery records are not directly accessible to browser roles', async () => {
  const f = await fixture()
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    try {
      await assert.rejects(
        rpc(f.id, 'remove-preview', { kind: 'note', id: f.note.id }),
        /permission denied/,
      )
      await assert.rejects(
        db.query('select * from ob_round_mutation_events'),
        /permission denied/,
      )
    } finally {
      await db.exec('reset role')
    }
  }
})

test('failed receipt storage rolls moves and deletions back, including image links', async () => {
  const f = await fixture()
  const preview = await rpc(f.id, 'remove-preview', {
    kind: 'note',
    id: f.note.id,
  })
  await db.exec(`create function test_fail_receipt() returns trigger language plpgsql as $$ begin raise exception 'TEST_RECEIPT_FAILURE'; end $$;
    create trigger zz_test_fail_receipt before insert on ob_round_mutation_events for each row execute function test_fail_receipt();`)
  try {
    await assert.rejects(
      rpc(
        f.id,
        'move',
        moveNote(f.note, { area: 'interior', roomId: f.target.id }),
      ),
      /TEST_RECEIPT_FAILURE/,
    )
    await assert.rejects(
      rpc(f.id, 'remove', {
        kind: 'note',
        id: f.note.id,
        token: preview.token,
        requestId: randomUUID(),
      }),
      /TEST_RECEIPT_FAILURE/,
    )
  } finally {
    await db.exec(
      'drop trigger zz_test_fail_receipt on ob_round_mutation_events; drop function test_fail_receipt();',
    )
  }
  assert.deepEqual(
    await one('select * from inspection_control_items where id=$1', [
      f.note.id,
    ]),
    f.note,
  )
  assert.deepEqual(
    await one('select * from inspection_images where id=$1', [f.image.id]),
    f.image,
  )
  assert.equal(
    (
      await one(
        'select count(*)::int as n from ob_round_removed_records where inspection_id=$1',
        [f.id],
      )
    ).n,
    0,
  )
})

test('direct writes cannot move OB rows to another family or bypass inspection locks', async () => {
  const f = await fixture(),
    other = await fixture()
  await db.query(
    "update inspections set type='EB',inspection_family='EB' where id=$1",
    [other.id],
  )
  await assert.rejects(
    db.query(
      'update inspection_interior_rooms set inspection_id=$1 where id=$2',
      [other.id, f.room.id],
    ),
    /OB_ROUND_FOREIGN/,
  )
  await db.query('update inspections set locked_at=now() where id=$1', [f.id])
  await assert.rejects(
    db.query("update inspection_control_items set note='late' where id=$1", [
      f.note.id,
    ]),
    /Besiktningen är låst/,
  )
})

test('image-note rejects stale places, blank text and inactive templates without creating drafts', async () => {
  const f = await fixture()
  const preview = await rpc(f.id, 'image-note-preview', { imageId: f.loose.id })
  const request = {
    imageId: f.loose.id,
    token: preview.token,
    requestId: randomUUID(),
    draft: { note: '', risk_text: '', ftu_text: '', outcomeId: null },
  }
  await assert.rejects(
    rpc(f.id, 'image-note', request),
    /OB_ROUND_TEXT_REQUIRED/,
  )
  const point = await one(
    'insert into settings_control_points default values returning *',
  )
  const outcome = await one(
    'insert into settings_control_point_outcomes(control_point_id,is_active) values($1,false) returning *',
    [point.id],
  )
  await assert.rejects(
    rpc(f.id, 'image-note', {
      ...request,
      draft: { ...request.draft, note: 'Text', outcomeId: outcome.id },
    }),
    /OB_ROUND_INVALID/,
  )
  await db.query(
    'update inspection_images set interior_room_id=$1 where id=$2',
    [f.target.id, f.loose.id],
  )
  await assert.rejects(
    rpc(f.id, 'image-note', {
      ...request,
      draft: { ...request.draft, note: 'Text' },
    }),
    /OB_ROUND_STALE/,
  )
  const current = await rpc(f.id, 'image-note-preview', { imageId: f.loose.id })
  assert.equal(
    current.room.id,
    f.target.id,
    'Current place wins over capture origin',
  )
  assert.equal(
    (
      await one(
        'select count(*)::int as n from inspection_control_items where inspection_id=$1',
        [f.id],
      )
    ).n,
    1,
  )
})
