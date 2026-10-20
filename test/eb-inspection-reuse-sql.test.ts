import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('reuse migration is additive/idempotent and immutable evidence metadata does not block ordinary note or caption edits', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create table eb_notes (id text primary key,note_text text);
      create table inspection_images (id text primary key,label text);
      insert into eb_notes values ('original','Original');
      insert into inspection_images values ('original','Original image');`)
    const sql = readFileSync(new URL('../docs/db/2026-10-19_01_eb_inspection_reuse.sql', import.meta.url), 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    const origin = { inspectionId: 'source', noteId: 'note', imageId: 'photo', inspectionDate: '2026-10-01' }
    await db.query(`insert into eb_notes values ('copy','Copied',$1::jsonb)`, [JSON.stringify(origin)])
    await db.query(`insert into inspection_images values ('copy','Copied image',$1::jsonb)`, [JSON.stringify(origin)])
    await db.exec(`update eb_notes set note_text='Edited template' where id='copy';
      update inspection_images set label='New editable caption' where id='copy';`)
    for (const table of ['eb_notes', 'inspection_images']) {
      await assert.rejects(db.exec(`update ${table} set reuse_source=null where id='copy'`), /EB_REUSE_SOURCE_IMMUTABLE/)
      const row = (await db.query<{ reuse_source: unknown }>(`select reuse_source from ${table} where id='copy'`)).rows[0]
      assert.deepEqual(row.reuse_source, origin)
      assert.equal((await db.query<{ reuse_source: unknown }>(`select reuse_source from ${table} where id='original'`)).rows[0].reuse_source, null)
    }
    await assert.rejects(db.exec(`insert into eb_notes values ('bad','Bad','[]')`), /check constraint/)
    await assert.rejects(db.exec(`insert into inspection_images values ('bad','Bad','{"inspectionId":"x","noteId":"n"}')`), /check constraint/)
    assert.equal((await db.query<{ note_text: string }>(`select note_text from eb_notes where id='original'`)).rows[0].note_text, 'Original')
  } finally { await db.close() }
})
