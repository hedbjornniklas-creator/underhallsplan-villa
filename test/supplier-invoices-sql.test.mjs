import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const org = randomUUID(), otherOrg = randomUUID(), actor = randomUUID()
const caseId = randomUUID(), secondCaseId = randomUUID(), foreignCaseId = randomUUID()
const itemId = randomUUID(), secondItemId = randomUUID(), foreignItemId = randomUUID()
const migration = readFileSync(new URL('../docs/db/2026-11-05_01_supplier_invoices.sql', import.meta.url), 'utf8')

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key);
    create table profiles(id uuid primary key);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean,primary key(org_id,profile_id));
    create table action_cases(id uuid primary key,org_id uuid references organizations(id));
    create table action_case_items(id uuid primary key,org_id uuid references organizations(id),action_case_id uuid references action_cases(id));
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    insert into organizations values('${org}'),('${otherOrg}');
    insert into profiles values('${actor}');
    insert into org_members values('${org}','${actor}',true),('${otherOrg}','${actor}',true);
    insert into action_cases values('${caseId}','${org}'),('${secondCaseId}','${org}'),('${foreignCaseId}','${otherOrg}');
    insert into action_case_items values('${itemId}','${org}','${caseId}'),('${secondItemId}','${org}','${secondCaseId}'),('${foreignItemId}','${otherOrg}','${foreignCaseId}');
  `)
  await db.exec(migration)
  // Real deployments may have broad legacy storage policies. Exercise both the
  // migration's optional-storage branch and its protection against those grants.
  await db.exec(`
    create table storage.objects(id text primary key,bucket_id text not null);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create policy legacy_storage_access on storage.objects for all to anon,authenticated using(true) with check(true);
    insert into storage.objects values('private-invoice','supplier-invoice-files'),('existing-document','another-bucket');
  `)
  await db.exec(migration)
  await db.exec(migration)
})

after(() => db.close())

function draft(overrides = {}) {
  return {
    supplierName: 'Leverantören AB', supplierOrgNumber: '556123-4567', invoiceNumber: randomUUID(),
    invoiceDate: '2026-11-01', dueDate: '2026-11-30', documentKind: 'invoice', creditReferenceInvoiceId: null,
    currency: 'SEK', netAmountOre: 100_000, vatAmountOre: 25_000, approvalStatus: 'registered',
    paymentStatus: 'unpaid', paidOn: null, notes: '', sourceText: '', allocations: [], ...overrides,
  }
}

async function write(body, id = randomUUID(), expectedRevision = 0, organization = org) {
  return (await db.query('select write_supplier_invoice($1,$2,$3,$4,$5::jsonb) result',
    [organization, actor, id, expectedRevision, JSON.stringify(body)])).rows[0].result
}

async function stored(id) {
  return (await db.query('select * from supplier_invoices where id=$1', [id])).rows[0]
}

async function eventCount(id) {
  return (await db.query('select count(*)::int count from supplier_invoice_events where invoice_id=$1', [id])).rows[0].count
}

async function attach(invoiceId, overrides = {}, organization = org) {
  const attachmentId = overrides.id ?? randomUUID()
  const metadata = {
    fileName: 'faktura.pdf', contentType: 'application/pdf', fileSizeBytes: 1024,
    filePath: `${organization}/${invoiceId}/${attachmentId}`, ...overrides,
  }
  return (await db.query('select add_supplier_invoice_attachment($1,$2,$3,$4,$5,$6,$7,$8) result',
    [organization, actor, invoiceId, attachmentId, metadata.fileName, metadata.contentType, metadata.fileSizeBytes, metadata.filePath])).rows[0].result
}

test('repeatable migration creates private invoice storage and service-only access', async () => {
  const privileges = (await db.query(`select
    has_table_privilege('authenticated','supplier_invoices','select') browser_read,
    has_table_privilege('authenticated','supplier_invoices','insert') browser_write,
    has_table_privilege('anon','supplier_invoices','select') anonymous_read,
    has_function_privilege('authenticated','write_supplier_invoice(uuid,uuid,uuid,integer,jsonb)','execute') browser_rpc,
    has_function_privilege('service_role','write_supplier_invoice(uuid,uuid,uuid,integer,jsonb)','execute') service_rpc,
    has_function_privilege('authenticated','add_supplier_invoice_attachment(uuid,uuid,uuid,uuid,text,text,bigint,text)','execute') browser_attachment,
    (select relrowsecurity from pg_class where oid='supplier_invoices'::regclass) rls`)).rows[0]
  assert.deepEqual(privileges, { browser_read: false, browser_write: false, anonymous_read: false, browser_rpc: false, service_rpc: true, browser_attachment: false, rls: true })
  const buckets = (await db.query('select public from storage.buckets')).rows
  assert.ok(buckets.length > 0)
  assert.ok(buckets.every(bucket => bucket.public === false))
})

test('invoice files remain inaccessible despite permissive legacy storage policies', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    try {
      assert.deepEqual((await db.query('select id from storage.objects order by id')).rows, [{ id: 'existing-document' }])
      await assert.rejects(db.query("insert into storage.objects values('new-private','supplier-invoice-files')"), /row-level security/i)
      await assert.rejects(db.query("update storage.objects set bucket_id='supplier-invoice-files' where id='existing-document'"), /row-level security/i)
      assert.deepEqual((await db.query("delete from storage.objects where id='private-invoice' returning id")).rows, [])
    } finally {
      await db.exec('reset role')
    }
  }
  assert.deepEqual((await db.query('select id from storage.objects order by id')).rows, [{ id: 'existing-document' }, { id: 'private-invoice' }])
})

test('creation, exact retry and compare-and-swap preserve data and audit history', async () => {
  const id = randomUUID(), body = draft()
  assert.deepEqual(await write(body, id), { id, revision: 1 })
  const first = await stored(id), initialEvents = await eventCount(id)
  assert.ok(initialEvents > 0)
  assert.deepEqual(await write(body, id), { id, revision: 1 })
  assert.deepEqual(await stored(id), first)
  assert.equal(await eventCount(id), initialEvents)
  const next = { ...body, notes: 'Kontrollerad mot leveransen', approvalStatus: 'approved' }
  assert.deepEqual(await write(next, id, 1), { id, revision: 2 })
  assert.deepEqual(await write(next, id, 1), { id, revision: 2 })
  const afterUpdate = await stored(id), updatedEvents = await eventCount(id)
  assert.equal(updatedEvents, initialEvents + 1)
  await assert.rejects(write({ ...next, notes: 'Gammal flik' }, id, 1), /INVOICE_STALE/)
  assert.deepEqual(await stored(id), afterUpdate)
  assert.equal(await eventCount(id), updatedEvents)
})

test('another organization cannot overwrite an invoice, even on an exact retry', async () => {
  const id = randomUUID(), body = draft()
  await write(body, id)
  const first = await stored(id)
  await assert.rejects(write(body, id, 0, otherOrg), /NOT_FOUND|CONFLICT|FORBIDDEN/i)
  await assert.rejects(write({ ...body, notes: 'Annan organisation' }, id, 1, otherOrg), /NOT_FOUND|CONFLICT|FORBIDDEN/i)
  assert.deepEqual(await stored(id), first)
})

test('duplicate keys normalize supplier organization numbers and invoice numbers, including voided invoices', async () => {
  const number = `DUP-${randomUUID()}`
  const id = randomUUID(), body = draft({ invoiceNumber: number })
  await write(body, id)
  await assert.rejects(write(draft({ supplierOrgNumber: '5561234567', invoiceNumber: `  ${number.toLowerCase()}  ` })), /DUPLICATE|duplicate key/i)
  await write({ ...body, approvalStatus: 'void' }, id, 1)
  await assert.rejects(write(draft({ invoiceNumber: number })), /DUPLICATE|duplicate key/i)
  // The same supplier reference is legal in a different organization's ledger.
  assert.equal((await write(draft({ invoiceNumber: number }), randomUUID(), 0, otherOrg)).revision, 1)
})

test('name fallback normalizes case and whitespace while duplicate attempts leave one record', async () => {
  const number = `NAME-${randomUUID()}`
  const attempts = await Promise.allSettled([
    write(draft({ supplierName: '  Bygg  Partner AB  ', supplierOrgNumber: '', invoiceNumber: number })),
    write(draft({ supplierName: 'bygg partner ab', supplierOrgNumber: '', invoiceNumber: number.toLowerCase() })),
  ])
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 1)
})

test('adding or omitting supplier registration number cannot duplicate an existing invoice', async () => {
  const invoiceNumber = `AMBIGUOUS-${randomUUID()}`, originalId = randomUUID()
  const original = draft({ supplierName: '  Samma Bygg AB ', supplierOrgNumber: '', invoiceNumber })
  await write(original, originalId)
  await assert.rejects(write(draft({ supplierName: 'samma  bygg ab', supplierOrgNumber: '556222-1234', invoiceNumber: invoiceNumber.toLowerCase() })), /INVOICE_DUPLICATE/)
  // Adding the missing number to the existing record is permitted.
  const completed = { ...original, supplierOrgNumber: '556222-1234' }
  assert.equal((await write(completed, originalId, 1)).revision, 2)
  await assert.rejects(write({ ...original, supplierName: 'SAMMA BYGG AB' }), /INVOICE_DUPLICATE/)
  // Removing it on that same record remains legal when it creates no ambiguity.
  assert.equal((await write(original, originalId, 2)).revision, 3)
  assert.equal((await stored(originalId)).body.supplierOrgNumber, '')
})

test('distinct complete supplier identities can share a name but cannot become ambiguous on update', async () => {
  const invoiceNumber = `DISTINCT-${randomUUID()}`, firstId = randomUUID(), secondId = randomUUID()
  const first = draft({ supplierName: 'Gemensamt handelsnamn AB', supplierOrgNumber: '556333-1234', invoiceNumber })
  const second = { ...first, supplierOrgNumber: '556444-1234' }
  await write(first, firstId)
  await write(second, secondId)
  await assert.rejects(write({ ...first, supplierOrgNumber: '' }, firstId, 1), /INVOICE_DUPLICATE/)
  await assert.rejects(write({ ...second, supplierOrgNumber: '----' }, secondId, 1), /INVOICE_DUPLICATE/)
  await assert.rejects(write({ ...second, supplierOrgNumber: first.supplierOrgNumber }, secondId, 1), /INVOICE_DUPLICATE/)
  assert.equal((await stored(firstId)).revision, 1)
  assert.equal((await stored(secondId)).revision, 1)
})

test('new supplier identity cannot bypass ambiguity by changing an existing invoice number', async () => {
  const invoiceNumber = `UPDATE-DUP-${randomUUID()}`, originalId = randomUUID(), otherId = randomUUID()
  await write(draft({ supplierOrgNumber: '', invoiceNumber }), originalId)
  const other = draft({ supplierOrgNumber: '556555-1234' })
  await write(other, otherId)
  await assert.rejects(write({ ...other, invoiceNumber }, otherId, 1), /INVOICE_DUPLICATE/)
  assert.equal((await stored(otherId)).body.invoiceNumber, other.invoiceNumber)
})

test('simultaneous missing and complete supplier identities leave only one invoice', async () => {
  const invoiceNumber = `RACE-DUP-${randomUUID()}`
  const attempts = await Promise.allSettled([
    write(draft({ supplierName: 'Identitet Bygg AB', supplierOrgNumber: '', invoiceNumber })),
    write(draft({ supplierName: 'Identitet Bygg AB', supplierOrgNumber: '556777-1234', invoiceNumber })),
  ])
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 1)
})

test('money must be bounded integer magnitudes and failed writes leave no invoice', async () => {
  for (const overrides of [
    { netAmountOre: 0 }, { netAmountOre: -1 }, { netAmountOre: 1.5 }, { netAmountOre: 100_000_000_000 },
    { vatAmountOre: -1 }, { vatAmountOre: 0.5 }, { vatAmountOre: 100_000_000_000 },
  ]) {
    const id = randomUUID()
    await assert.rejects(write(draft(overrides), id), /INVALID|AMOUNT|MONEY|check constraint/i)
    assert.equal(await stored(id), undefined)
  }
  assert.equal((await write(draft({ netAmountOre: 99_999_999_999, vatAmountOre: 0 }))).revision, 1)
})

test('document dates, payment state and currency obey the draft contract', async () => {
  for (const overrides of [
    { invoiceDate: '2026-02-30' }, { dueDate: '2026-13-01' }, { invoiceDate: '2026-1-01' },
    { paymentStatus: 'paid', paidOn: null }, { paymentStatus: 'unpaid', paidOn: '2026-11-02' },
    { paymentStatus: 'paid', paidOn: '2026-02-30' }, { currency: 'EUR' },
    { approvalStatus: 'unknown' }, { documentKind: 'unknown' },
  ]) {
    await assert.rejects(write(draft(overrides)), /INVOICE_INVALID/)
  }
  assert.equal((await write(draft({ paymentStatus: 'paid', paidOn: '2026-11-02' }))).revision, 1)
})

test('allocations must use the correct organization and an item belonging to their case', async () => {
  const allocation = { caseId, itemId, category: 'material', description: 'Virke', amountOre: 60_000 }
  assert.equal((await write(draft({ allocations: [allocation, { ...allocation, itemId: null, amountOre: 40_000 }] }))).revision, 1)
  for (const allocations of [
    [{ ...allocation, caseId: foreignCaseId, itemId: foreignItemId }],
    [{ ...allocation, itemId: secondItemId }],
    [{ ...allocation, caseId: randomUUID(), itemId: null }],
    [{ ...allocation, amountOre: 100_001 }],
    [{ ...allocation, amountOre: 60_000 }, { ...allocation, amountOre: 60_000 }],
    [{ ...allocation, amountOre: -1 }],
    [{ ...allocation, amountOre: 0.5 }],
    Array.from({ length: 101 }, () => ({ ...allocation, amountOre: 1 })),
  ]) {
    await assert.rejects(write(draft({ allocations })), /INVALID|ALLOCATION|CASE|ITEM/i)
  }
})

test('credits reduce costs through document kind and can only reference ordinary invoices in the same organization', async () => {
  const ordinaryId = randomUUID(), foreignId = randomUUID(), creditId = randomUUID()
  await write(draft(), ordinaryId)
  await write(draft(), foreignId, 0, otherOrg)
  const credit = draft({ documentKind: 'credit', creditReferenceInvoiceId: ordinaryId })
  await write(credit, creditId)
  assert.equal((await stored(creditId)).body.documentKind, 'credit')
  assert.equal((await stored(creditId)).body.netAmountOre, 100_000)
  assert.equal((await write(draft({ documentKind: 'credit', creditReferenceInvoiceId: null }))).revision, 1)
  for (const creditReferenceInvoiceId of [foreignId, creditId, randomUUID()]) {
    await assert.rejects(write(draft({ documentKind: 'credit', creditReferenceInvoiceId })), /INVALID|CREDIT|REFERENCE/i)
  }
  const selfId = randomUUID()
  await assert.rejects(write(draft({ documentKind: 'credit', creditReferenceInvoiceId: selfId }), selfId), /INVALID|CREDIT|REFERENCE/i)
  await assert.rejects(write(draft({ creditReferenceInvoiceId: ordinaryId })), /INVALID|CREDIT|REFERENCE/i)
})

test('active credits protect their original from voiding or conversion and void credits remain editable', async () => {
  const ordinaryId = randomUUID(), creditId = randomUUID()
  const original = draft(), credit = draft({ documentKind: 'credit', creditReferenceInvoiceId: ordinaryId.toUpperCase() })
  await write(original, ordinaryId)
  await write(credit, creditId)
  await assert.rejects(write({ ...original, approvalStatus: 'void' }, ordinaryId, 1), /INVOICE_REFERENCE_IN_USE/)
  await assert.rejects(write({ ...original, documentKind: 'credit' }, ordinaryId, 1), /INVOICE_REFERENCE_IN_USE/)
  assert.equal((await stored(ordinaryId)).revision, 1)
  assert.equal(await eventCount(ordinaryId), 1)
  const voidCredit = { ...credit, approvalStatus: 'void' }
  assert.equal((await write(voidCredit, creditId, 1)).revision, 2)
  assert.equal((await write({ ...original, approvalStatus: 'void' }, ordinaryId, 1)).revision, 2)
  assert.equal((await write({ ...voidCredit, notes: 'Historisk referens kvar.' }, creditId, 2)).revision, 3)
  // A void credit cannot be reactivated while the original remains void.
  await assert.rejects(write(credit, creditId, 3), /INVOICE_REFERENCE_INVALID/)
})

test('original kind can change after referenced credits are void without trapping historic credit edits', async () => {
  const ordinaryId = randomUUID(), creditId = randomUUID()
  const original = draft(), credit = draft({ documentKind: 'credit', creditReferenceInvoiceId: ordinaryId, approvalStatus: 'void' })
  await write(original, ordinaryId)
  await write(credit, creditId)
  await write({ ...original, documentKind: 'credit' }, ordinaryId, 1)
  assert.equal((await write({ ...credit, notes: 'Spårbar makulerad kredit.' }, creditId, 1)).revision, 2)
  await assert.rejects(write({ ...credit, approvalStatus: 'registered' }, creditId, 2), /INVOICE_REFERENCE_INVALID/)
})

test('competing credit creation and original voiding cannot leave an active credit against a void original', async () => {
  const ordinaryId = randomUUID(), creditId = randomUUID(), original = draft()
  await write(original, ordinaryId)
  const results = await Promise.allSettled([
    write({ ...original, approvalStatus: 'void' }, ordinaryId, 1),
    write(draft({ documentKind: 'credit', creditReferenceInvoiceId: ordinaryId }), creditId),
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected').length, 1)
  const storedOriginal = await stored(ordinaryId), storedCredit = await stored(creditId)
  assert.ok(!(storedOriginal.body.approvalStatus === 'void' && storedCredit?.body.approvalStatus !== 'void' && storedCredit))
})

test('manual saves cannot spoof integration identity, revision or audit fields', async () => {
  for (const injected of [
    { source: 'fortnox', externalId: '7712' }, { revision: 99 }, { createdBy: randomUUID() }, { orgId: otherOrg },
  ]) {
    const id = randomUUID()
    await assert.rejects(write({ ...draft(), ...injected }, id), /INVALID|SOURCE|FIELD|INPUT/i)
    assert.equal(await stored(id), undefined)
  }
  const id = randomUUID()
  await write(draft(), id)
  const invoice = await stored(id)
  assert.equal(invoice.source, 'manual')
  assert.equal(invoice.external_id, null)
  assert.equal(invoice.created_by, actor)
})

test('provider-owned invoices cannot be edited or converted through the manual RPC', async () => {
  const id = randomUUID(), body = draft()
  await write(body, id)
  await db.query("update supplier_invoices set source='fortnox',external_id='provider-17' where id=$1", [id])
  const before = await stored(id)
  await assert.rejects(write(body, id, 0), /INVOICE_EXTERNAL_READ_ONLY/)
  await assert.rejects(write({ ...body, notes: 'Manuellt ändrad' }, id, 1), /INVOICE_EXTERNAL_READ_ONLY/)
  assert.deepEqual(await stored(id), before)
})

test('attachments bind immutable metadata to an invoice in the same organization', async () => {
  const id = randomUUID(), attachmentId = randomUUID()
  await write(draft(), id)
  await attach(id, { id: attachmentId })
  const rows = (await db.query('select * from supplier_invoice_attachments where invoice_id=$1', [id])).rows
  assert.equal(rows.length, 1)
  assert.equal(rows[0].org_id, org)
  assert.equal(rows[0].file_path, `${org}/${id}/${attachmentId}`)
  await assert.rejects(attach(id, { id: attachmentId, fileName: 'ersatt.pdf' }), /CONFLICT|DUPLICATE|duplicate key|IMMUTABLE/i)
  await assert.rejects(attach(id, {}, otherOrg), /NOT_FOUND|FORBIDDEN|INVALID/i)
  assert.equal((await db.query('select count(*)::int count from supplier_invoice_attachments where invoice_id=$1', [id])).rows[0].count, 1)
})

test('attachment paths, MIME types and sizes are validated before metadata is committed', async () => {
  const id = randomUUID()
  await write(draft(), id)
  for (const overrides of [
    { filePath: `${otherOrg}/${id}/${randomUUID()}` },
    { filePath: `${org}/${randomUUID()}/${randomUUID()}` },
    { filePath: `${org}/${id}/../escaped` },
    { fileName: '' }, { contentType: 'text/html' }, { fileSizeBytes: 0 }, { fileSizeBytes: -1 }, { fileSizeBytes: 10_485_761 },
  ]) {
    await assert.rejects(attach(id, overrides), /INVALID|FILE|ATTACHMENT|SIZE|MIME/i)
  }
  assert.equal((await db.query('select count(*)::int count from supplier_invoice_attachments where invoice_id=$1', [id])).rows[0].count, 0)
})
