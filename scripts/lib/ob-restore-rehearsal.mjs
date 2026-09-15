import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function storageFailureStatus(error) {
  // Blob downloads retain the failed Response instead of parsing an API error.
  return Number(error?.statusCode??error?.status??
    (error?.originalError instanceof Response?error.originalError.status:undefined))
}
export function canonical(value) {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']'
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}'
  assert.ok(typeof value!=='number'||!Number.isInteger(value)||Number.isSafeInteger(value),'Unsafe JSON integer')
  return JSON.stringify(value)
}
export const quote = value => '"'+value.replaceAll('"','""')+'"'
export const relation = table => table.split('.').map(quote).join('.')

export async function describeRestoreSchema(db) {
  const tables=(await db.query(`select n.nspname||'.'||c.relname as name,
    (select (select jsonb_agg(a.attname order by k.n)
      from unnest(i.indkey) with ordinality k(attnum,n)
      join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum where k.n<=i.indnkeyatts)
      from pg_index i where i.indrelid=c.oid and i.indisunique and i.indisvalid
      and i.indpred is null and i.indexprs is null
      and not exists(select 1 from unnest(i.indkey) with ordinality k(attnum,n)
        join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum
        where k.n<=i.indnkeyatts and not a.attnotnull)
      order by i.indisprimary desc,i.indexrelid::regclass::text limit 1) as pk,
    (select jsonb_agg(a.attname order by a.attnum) from pg_attribute a
      where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','auth') and c.relkind='r' order by 1`)).rows
  const fks=(await db.query(`select conname as name,
    nf.nspname||'.'||cf.relname as "from", nt.nspname||'.'||ct.relname as "to",
    (select jsonb_agg(a.attname order by k.n) from unnest(c.conkey) with ordinality k(attnum,n)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum) as "fromColumns",
    (select jsonb_agg(a.attname order by k.n) from unnest(c.confkey) with ordinality k(attnum,n)
      join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum) as "toColumns",
    pg_get_constraintdef(c.oid) as definition
    from pg_constraint c join pg_class cf on cf.oid=c.conrelid join pg_namespace nf on nf.oid=cf.relnamespace
    join pg_class ct on ct.oid=c.confrelid join pg_namespace nt on nt.oid=ct.relnamespace
    where c.contype='f' and nf.nspname='public' order by 2,1`)).rows
  return {tables,fks}
}

// Descendants belong to the selected object. Ancestors are dependencies only:
// never traverse back down from a shared owner/catalogue into unrelated objects.
export async function collectScopedRows(schema, readRows, roots, shared=[]) {
  const found=new Map(), queried=new Set(), owned=[]
  const metadata=new Map(schema.tables.map(t=>[t.name,t]))
  const add=(table,rows,queue)=>{
    const definition=metadata.get(table)
    assert.ok(definition?.pk?.length,'Unreviewed unique row key: '+table)
    if(!found.has(table))found.set(table,new Map())
    for(const row of rows){
      assert.ok(Object.keys(row).every(k=>definition.columns.includes(k)),'Unreviewed source column: '+table)
      assert.ok(definition.pk.every(k=>row[k]!=null),'Missing unique row key: '+table)
      const id=canonical(definition.pk.map(k=>row[k]))
      const prior=found.get(table).get(id)
      if(prior){ assert.equal(canonical(prior),canonical(row),'Source changed during backup');continue }
      found.get(table).set(id,row)
      queue.push({table,row})
      assert.ok([...found.values()].reduce((n,m)=>n+m.size,0)<=10000,'Scope row limit exceeded')
    }
  }
  const fetchRows=async (table,filters)=>{
    const key=canonical({table,filters})
    if(queried.has(key))return []
    queried.add(key)
    return readRows(table,filters)
  }
  for(const root of roots)add(root.table,await fetchRows(root.table,root.filters),owned)
  for(let index=0;index<owned.length;index++) {
    const {table,row}=owned[index]
    for(const fk of schema.fks.filter(f=>f.to===table)) {
      if(fk.toColumns.some(k=>row[k]==null))continue
      const filters=Object.fromEntries(fk.fromColumns.map((k,i)=>[k,row[fk.toColumns[i]]]))
      add(fk.from,await fetchRows(fk.from,filters),owned)
    }
  }
  const dependencies=[...owned]
  for(const item of shared)add(item.table,await fetchRows(item.table,item.filters),dependencies)
  for(let index=0;index<dependencies.length;index++) {
    const {table,row}=dependencies[index]
    for(const fk of schema.fks.filter(f=>f.from===table)) {
      if(fk.fromColumns.some(k=>row[k]==null))continue
      const filters=Object.fromEntries(fk.toColumns.map((k,i)=>[k,row[fk.fromColumns[i]]]))
      add(fk.to,await fetchRows(fk.to,filters),dependencies)
    }
  }
  return Object.fromEntries([...found].sort(([a],[b])=>a.localeCompare(b)).map(([table,rows])=>
    [table,[...rows].sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>row)]))
}

export function validateObjectPath(asset,inspection) {
  assert.match(asset.bucket,/^[a-z0-9][a-z0-9-]*$/)
  assert.ok(typeof asset.path==='string'&&asset.path.split('/').every(s=>s&&s!=='.'&&s!=='..'),'Unsafe object path')
  assert.doesNotMatch(asset.path,/[\\%\u0000-\u001f]/,'Encoded or unsafe object path')
  assert.ok(asset.path.split('/').includes(inspection),'Object outside selected inspection')
}

export function validateAsset(asset,inspection) {
  validateObjectPath(asset,inspection)
  assert.match(asset.sha256,/^[a-f0-9]{64}$/)
  assert.ok(Number.isSafeInteger(asset.bytes)&&asset.bytes>0&&asset.bytes<=20000000)
  assert.equal(asset.blob,'blobs/'+asset.sha256)
}

export function requiredAssets(rows,project) {
  const objects=new Map()
  const add=object=>{
    const key=object.bucket+'/'+object.path
    const prior=objects.get(key)
    assert.ok(!prior?.expected||!object.expected||prior.expected===object.expected,'Conflicting file hashes')
    objects.set(key,{...prior,...object})
  }
  for(const image of rows['public.inspection_images']??[])add({bucket:'inspection-images',path:image.file_path})
  const reports=rows['public.inspection_report_links']??[]
  for(const report of reports) {
    assert.equal(report.pdf_status,'ready','Only frozen, ready test PDFs')
    assert.match(report.pdf_sha256,/^[a-f0-9]{64}$/)
    add({bucket:report.pdf_storage_bucket,path:report.pdf_storage_path,expected:report.pdf_sha256})
  }
  function inspect(value) {
    if(typeof value==='string'&&value.includes('/storage/v1/object/')) {
      const url=new URL(value)
      assert.equal(url.origin,project,'Frozen asset outside staging')
      const match=url.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
      assert.ok(match,'Unreviewed frozen asset URL')
      assert.ok(objects.has(match[1]+'/'+decodeURIComponent(match[2])),'Frozen asset missing from backup scope')
    } else if(value&&typeof value==='object')for(const child of Object.values(value))inspect(child)
  }
  for(const report of reports)inspect(report.snapshot_payload)
  return objects
}

export async function verifyBackup(manifest,readBytes) {
  assert.equal(manifest.version,1)
  assert.equal(manifest.project,'https://lodbgdbmfdtdzfaezblx.supabase.co')
  assert.equal(manifest.consistency,'quiescent-synthetic-double-read')
  assert.match(manifest.inspection,/^[a-f0-9-]{36}$/)
  assert.match(manifest.rowsSha256,/^[a-f0-9]{64}$/)
  const rowsBytes=await readBytes('rows.json')
  assert.equal(sha256(rowsBytes),manifest.rowsSha256,'Row backup checksum mismatch')
  const rows=JSON.parse(rowsBytes)
  canonical(rows)
  assert.match(manifest.schemaSha256,/^[a-f0-9]{64}$/)
  assert.equal(sha256(await readBytes('schema/source.json')),manifest.schemaSha256,'Schema backup checksum mismatch')
  assert.ok(Array.isArray(manifest.migrations)&&manifest.migrations.length>0)
  for(const [index,migration] of manifest.migrations.entries()) {
    assert.equal(migration.blob,`schema/migration-${index}.sql`,'Unsafe migration path')
    assert.match(migration.sha256,/^[a-f0-9]{64}$/)
    assert.equal(sha256(await readBytes(migration.blob)),migration.sha256,'Migration backup checksum mismatch')
  }
  const required=requiredAssets(rows,manifest.project)
  const names=new Set()
  for(const asset of manifest.assets) {
    validateAsset(asset,manifest.inspection)
    const name=asset.bucket+'/'+asset.path
    assert.ok(!names.has(name),'Duplicate object path')
    names.add(name)
    assert.ok(required.has(name),'Unexpected backup asset')
    if(required.get(name).expected)assert.equal(asset.sha256,required.get(name).expected,'Frozen PDF checksum mismatch')
    const bytes=await readBytes(asset.blob)
    assert.equal(bytes.length,asset.bytes,'Object length mismatch')
    assert.equal(sha256(bytes),asset.sha256,'Object checksum mismatch')
  }
  assert.deepEqual([...names].sort(),[...required.keys()].sort(),'Required image or PDF missing from manifest')
  return rows
}

export async function restoreRowsLocally(db,schema,rows) {
  assert.ok(db instanceof PGlite,'Only a local PGlite restore target is permitted')
  const occupied=(await db.query('select (select count(*) from public.properties)+(select count(*) from public.inspections) as n')).rows[0].n
  assert.equal(Number(occupied),0,'Restore target must contain no properties or inspections')
  const tables=new Map(schema.tables.map(t=>[t.name,t]))
  for(const [table,data] of Object.entries(rows)) {
    assert.ok(tables.has(table),'Unknown restore table')
    for(const row of data)assert.ok(Object.keys(row).every(k=>tables.get(table).columns.includes(k)),'Unknown restore column')
  }
  const publicTables=schema.tables.filter(t=>t.name.startsWith('public.')).map(t=>relation(t.name))
  await db.exec('begin; set local session_replication_role=replica;')
  try {
    // This handle is a newly-created, local PGlite instance, never a remote DB.
    // Remove only schema-seeded defaults before replaying the backed-up values.
    await db.exec('truncate '+[...publicTables,'auth.users'].join(',')+' cascade')
    for(const [table,data] of Object.entries(rows)) {
      if(data.length)await db.query(`insert into ${relation(table)} select * from jsonb_populate_recordset(null::${relation(table)},$1::jsonb)`,[JSON.stringify(data)])
    }
    await db.exec('set local session_replication_role=origin')
    // Restored triggers must not rewrite revisions/timestamps. Validate real FK
    // definitions after loading, including cycles and composite foreign keys.
    for(const fk of schema.fks.filter(f=>rows[f.from]?.length)) {
      await db.exec(`alter table ${relation(fk.from)} drop constraint ${quote(fk.name)};
        alter table ${relation(fk.from)} add constraint ${quote(fk.name)} ${fk.definition}`)
    }
    for(const [table,data] of Object.entries(rows)) {
      const actual=(await db.query(`select to_jsonb(t) as row from ${relation(table)} t`)).rows.map(r=>r.row)
      const expected=(await db.query(`select to_jsonb(t) as row from jsonb_populate_recordset(null::${relation(table)},$1::jsonb) t`,[JSON.stringify(data)])).rows.map(r=>r.row)
      assert.deepEqual(actual.map(canonical).sort(),expected.map(canonical).sort(),'Restored row mismatch: '+table)
    }
    await db.exec('commit')
  } catch(error) { await db.exec('rollback');throw error }
}
