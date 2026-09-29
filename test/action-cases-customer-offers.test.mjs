import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import {
  normalizeCustomerOffer,
  emptyCustomerOffer,
  customerOfferTotal,
  customerOfferBaseAmount,
  selectCustomerOfferOption,
  offerPublishIssues,
  parseKronor,
  mapCustomerOffer
} from '../src/lib/action-cases/customerOffers.ts'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sql = (name) =>
  readFileSync(
    new URL(`../docs/db/${name}.sql`, import.meta.url),
    'utf8'
  ).replace('create extension if not exists pgcrypto;', '')
const db = new PGlite()
const migration = () => sql('2026-09-29_01_action_case_customer_offers')
const get = async (table, key) =>
  (await db.query(`select * from ${table} where id=$1`, [key])).rows[0]
let seq = 100
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create table organization_contacts(id uuid primary key);
    create function is_org_member(uuid) returns boolean language sql as $$ select true $$;
    create function operational_tasks_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end $$;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
  for (const name of [
    '2026-09-08_01_action_cases_foundation',
    '2026-09-08_02_action_case_files_and_participants',
    '2026-09-08_03_action_case_costing',
    '2026-09-08_04_action_case_ai_costing',
    '2026-09-08_05_action_case_work_quotes',
    '2026-09-08_09_action_case_grouped_requests'
  ])
    await db.exec(sql(name))
  await db.exec(
    `insert into organizations values('${id(1)}'),('${id(9)}'); insert into profiles values('${id(2)}');`
  )
  await db.exec(migration())
  await db.exec(migration())
  await db.exec(sql('2026-09-29_02_customer_offer_pricing'))
  await db.exec(sql('2026-09-29_02_customer_offer_pricing'))
})
after(async () => {
  await db.close()
})

async function fixture() {
  const n = seq
  seq += 20
  const caseId = id(n),
    recipientId = id(n + 1),
    offerId = id(n + 2),
    fileId = id(n + 3),
    challengeId = id(n + 4)
  const tokenHash = `hash-${n}`
  await db.query(
    "insert into action_cases(id,org_id,title,customer_name,property_address) values($1,$2,'Project','Customer','Address')",
    [caseId, id(1)]
  )
  await db.query(
    "insert into action_case_participants(id,org_id,action_case_id,role,name,email) values($1,$2,$3,'customer','Customer','customer@example.test')",
    [recipientId, id(1), caseId]
  )
  await db.query(
    "insert into action_case_attachments(id,org_id,action_case_id,attachment_type,file_name,content_type,file_size_bytes,file_path) values($1,$2,$3,'document','Terms.pdf','application/pdf',1234,$4)",
    [fileId, id(1), caseId, `${id(1)}/${caseId}/original`]
  )
  const draft = normalizeCustomerOffer({
    ...emptyCustomerOffer('Extension'),
    baseAmountOre: 10000000,
    validUntil: '2099-12-31',
    terms: 'Reviewed terms',
    paymentTerms: 'As agreed',
    schedule: 'Start by agreement',
    attachmentIds: [fileId],
    termsAttachmentId: fileId,
    items: [
      {
        id: id(n + 5),
        title: 'Base work',
        scope: 'Weather-tight extension',
        kind: 'included',
        amountOre: null
      },
      {
        id: id(n + 6),
        title: 'Paint',
        scope: 'Painting inside',
        kind: 'option',
        amountOre: 1500050
      },
      {
        id: id(n + 7),
        title: 'Kitchen',
        scope: 'Customer arranges separately',
        kind: 'excluded',
        amountOre: null
      }
    ]
  })
  const snapshot = {
    ...draft,
    projectTitle: 'Project',
    propertyAddress: 'Address',
    customerName: 'Customer',
    customerEmail: 'customer@example.test',
    issuerName: 'Builder',
    replyEmail: 'builder@example.test'
  }
  const file = {
    id: fileId,
    fileName: 'Terms.pdf',
    contentType: 'application/pdf',
    fileSizeBytes: 1234,
    sourcePath: `${id(1)}/${caseId}/original`,
    path: `${id(1)}/${caseId}/${offerId}/${fileId}`
  }
  const publication = {
    id: offerId,
    revision: 1,
    participantId: recipientId,
    email: 'customer@example.test',
    issuerName: 'Builder',
    replyEmail: 'builder@example.test',
    snapshot,
    files: [file],
    confirmed: true,
    tokenHash,
    emailPayload: {
      to: 'customer@example.test',
      text: 'Link to this offer',
      idempotencyKey: offerId
    }
  }
  const write = async (op, data, org = id(1)) =>
    (
      await db.query(
        'select write_customer_offer($1,$2,$3,$4,$5::jsonb) result',
        [org, caseId, id(2), op, JSON.stringify(data)]
      )
    ).rows[0].result
  const respond = async (op, data, token = tokenHash, offer = offerId) =>
    (
      await db.query(
        'select respond_customer_offer($1,$2,$3,$4::jsonb) result',
        [token, offer, op, JSON.stringify(data)]
      )
    ).rows[0].result
  const challenge = {
    challengeId,
    codeHash: 'good-hash',
    selection: [id(n + 6)],
    signerName: 'Customer Name',
    confirmed: true
  }
  await write('save', { revision: 0, body: draft })
  return {
    caseId,
    recipientId,
    offerId,
    fileId,
    challengeId,
    draft,
    snapshot,
    file,
    publication,
    tokenHash,
    write,
    respond,
    challenge
  }
}

function itemized(draft) {
  return normalizeCustomerOffer({
    ...draft,
    pricingMode: 'itemized',
    baseAmountOre: 1,
    items: [
      { id: id(21), title: 'Grund', scope: 'Grundarbete', kind: 'included', amountOre: 1230050 },
      { id: id(22), title: 'Stomme', scope: 'Stomarbete', kind: 'included', amountOre: 4500000 },
      { id: id(23), title: 'Fönster A', scope: 'Leverantör A', kind: 'option', amountOre: 1000000, optionGroup: 'Fönster' },
      { id: id(24), title: 'Fönster B', scope: 'Leverantör B', kind: 'option', amountOre: 2000000, optionGroup: 'Fönster' },
      { id: id(25), title: 'Altan', scope: 'Tillval', kind: 'option', amountOre: 500000 },
      { id: id(26), title: 'El', scope: 'Projekteras senare. Ingår inte.', kind: 'excluded', amountOre: null }
    ]
  })
}

test('itemized prices derive the base total; missing is not zero; legacy drafts retain their exact shape', () => {
  const legacy = emptyCustomerOffer('Test')
  assert.deepEqual(normalizeCustomerOffer(legacy), legacy)
  const draft = itemized(legacy)
  assert.equal(draft.baseAmountOre, 5730050)
  assert.equal(customerOfferTotal(draft, [id(23), id(25)]), 7230050)
  draft.items[0].amountOre = null
  assert.equal(customerOfferBaseAmount(draft), null)
  assert.equal(normalizeCustomerOffer(draft).baseAmountOre, null)
  assert.ok(offerPublishIssues(draft).includes('Ange delpris för Grund.'))
  assert.throws(() => customerOfferTotal(draft, []))
  draft.items[0].amountOre = 0
  assert.equal(customerOfferBaseAmount(draft), 4500000)
  assert.equal(normalizeCustomerOffer({ ...draft, pricingMode: 'total', baseAmountOre: 9900 }).baseAmountOre, 9900)
  assert.equal(normalizeCustomerOffer({ ...draft, pricingMode: 'total', baseAmountOre: 9900 }).items[1].amountOre, 4500000)
  for (const invalid of [-1, 0.5, 100000000001, '100']) {
    assert.throws(() => normalizeCustomerOffer({ ...draft, items: [{ ...draft.items[0], amountOre: invalid }] }))
  }
  assert.throws(() => normalizeCustomerOffer({ ...draft, pricingMode: 'estimate' }))
})

test('alternative groups replace only their own selection and reject combinations from the same group', () => {
  const draft = itemized(emptyCustomerOffer())
  assert.deepEqual(selectCustomerOfferOption(draft, [id(23), id(25)], id(24)), [id(25), id(24)])
  assert.deepEqual(selectCustomerOfferOption(draft, [id(24)], id(25)), [id(24), id(25)])
  assert.throws(() => customerOfferTotal(draft, [id(23), id(24)]), /INVALID/)
  assert.equal(customerOfferTotal(draft, []), 5730050)
  assert.equal(normalizeCustomerOffer({ ...draft, items: [{ ...draft.items[2], optionGroup: '  Fönster  ' }] }).items[0].optionGroup, 'Fönster')
  assert.ok(offerPublishIssues({ ...draft, items: draft.items.filter((i) => i.id !== id(24)) }).some((i) => i.includes('minst två alternativ')))
})

test('database checks itemized totals and freezes one alternative plus independent options through acceptance', async () => {
  const f = await fixture()
  const draft = itemized(f.draft)
  await assert.rejects(f.write('save', { revision: 1, body: { ...draft, baseAmountOre: 1 } }), /INVALID/)
  await f.write('save', { revision: 1, body: draft })
  const publication = { ...f.publication, revision: 2, snapshot: { ...f.snapshot, ...draft } }
  await f.write('publish', publication)
  await assert.rejects(f.respond('challenge', { ...f.challenge, selection: [id(23), id(24)] }), /INVALID/)
  await f.respond('challenge', { ...f.challenge, selection: [id(24), id(25)] })
  await f.respond('accept', { challengeId: f.challengeId, codeHash: 'good-hash', selection: [id(23)], total: 1 })
  const accepted = await get('action_case_customer_offers', f.offerId)
  assert.equal(Number(accepted.accepted_total_ore), 8230050)
  assert.deepEqual(accepted.accepted_option_ids, [id(24), id(25)])
  await db.exec(sql('2026-09-29_02_customer_offer_pricing'))
  assert.deepEqual(await get('action_case_customer_offers', f.offerId), accepted)
})

test('incomplete itemized drafts can be saved but not published; acceptance cannot carry a tampered total', async () => {
  const f = await fixture()
  const draft = itemized(f.draft)
  draft.items[0].amountOre = null
  draft.baseAmountOre = null
  await f.write('save', { revision: 1, body: draft })
  await assert.rejects(f.write('publish', { ...f.publication, revision: 2, snapshot: { ...f.snapshot, ...draft } }), /INVALID|INCOMPLETE/)
  const g = await fixture()
  await g.write('publish', g.publication)
  await assert.rejects(db.query("update action_case_customer_offers set status='accepted', accepted_total_ore=1 where id=$1", [g.offerId]), /INVALID/)
  const acl = (await db.query("select has_function_privilege('anon', 'assert_customer_offer_pricing(jsonb,jsonb,boolean)', 'execute') allowed")).rows[0]
  assert.equal(acl.allowed, false)
})

test('money, template normalization, publication readiness and selected option totals', () => {
  for (const [value, expected] of [
    ['10 000,50', 1000050],
    ['0', 0],
    ['', null],
    ['0.29', 29]
  ])
    assert.equal(parseKronor(value), expected)
  for (const value of ['NaN', '-1', '1,234', 'Infinity', '1e4', '1000000001'])
    assert.throws(() => parseKronor(value))
  assert.ok(offerPublishIssues(emptyCustomerOffer(), '2026-09-29').length >= 5)
  const base = {
    ...emptyCustomerOffer('Title'),
    baseAmountOre: 500,
    items: [
      {
        id: id(10),
        title: 'Option',
        scope: 'Scope',
        kind: 'option',
        amountOre: 125
      }
    ]
  }
  assert.equal(customerOfferTotal(base, [id(10)]), 625)
  for (const selection of [[id(10), id(10)], [id(11)]])
    assert.throws(() => customerOfferTotal(base, selection))
  assert.throws(() =>
    normalizeCustomerOffer({ ...base, items: [...base.items, ...base.items] })
  )
  assert.throws(() =>
    normalizeCustomerOffer({ ...base, validUntil: '2026-02-30' })
  )
  assert.throws(() =>
    normalizeCustomerOffer({ ...base, termsAttachmentId: id(99) })
  )
  assert.equal(
    normalizeCustomerOffer({ ...base, internalPrice: 200 }).internalPrice,
    undefined
  )
})

test('publication checklist treats whitespace as missing and identifies each required field', () => {
  const draft = {
    ...emptyCustomerOffer('Offert'),
    baseAmountOre: 0,
    validUntil: '2099-12-31',
    contractForm: 'custom',
    terms: 'Villkor',
    paymentTerms: 'Betalningsplan',
    schedule: 'Tidplan',
    items: [
      {
        id: id(10),
        title: 'Arbete',
        scope: 'Omfattning',
        kind: 'included',
        amountOre: null
      }
    ]
  }
  assert.deepEqual(offerPublishIssues(draft, '2026-09-29'), [])
  for (const [field, message] of [
    ['title', 'Ange en offertrubrik.'],
    ['terms', 'Komplettera villkor och hänvisning till avtalshandling.'],
    ['paymentTerms', 'Ange betalningsvillkor.'],
    ['schedule', 'Ange tider och förutsättningar.']
  ]) {
    const incomplete = { ...draft, [field]: ' \n\t ' }
    assert.deepEqual(offerPublishIssues(incomplete, '2026-09-29'), [message])
    assert.deepEqual(
      offerPublishIssues(incomplete, '2026-09-29'),
      offerPublishIssues(normalizeCustomerOffer(incomplete), '2026-09-29')
    )
  }
  for (const field of ['title', 'scope']) {
    assert.deepEqual(
      offerPublishIssues(
        {
          ...draft,
          items: [{ ...draft.items[0], [field]: '   ' }]
        },
        '2026-09-29'
      ),
      ['Beskriv omfattningen för varje arbete.']
    )
  }
})

test('migration is rerunnable; drafts use revisions and tenant boundaries; publication is frozen and idempotent', async () => {
  const f = await fixture()
  await assert.rejects(f.write('save', { revision: 0, body: f.draft }), /STALE/)
  await assert.rejects(
    f.write('save', { revision: 1, body: f.draft }, id(9)),
    /NOT_FOUND/
  )
  assert.deepEqual(await f.write('publish', f.publication), { id: f.offerId })
  assert.deepEqual(await f.write('publish', f.publication), { id: f.offerId })
  const row = await get('action_case_customer_offers', f.offerId)
  assert.equal(row.version, 1)
  assert.deepEqual(row.snapshot, f.snapshot)
  for (const statement of ["snapshot='{}'", "files='[]'", "email_payload='{}'"])
    await assert.rejects(
      db.query(
        `update action_case_customer_offers set ${statement} where id=$1`,
        [f.offerId]
      ),
      /IMMUTABLE/
    )
  const dto = mapCustomerOffer(row)
  for (const key of [
    'org_id',
    'email_payload',
    'tokenHash',
    'path',
    'sourcePath'
  ])
    assert.ok(!JSON.stringify(dto).includes(`"${key}"`), key)
  await db.query('delete from action_case_attachments where id=$1', [f.fileId])
  assert.equal(
    (await get('action_case_customer_offers', f.offerId)).files.length,
    1
  )
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from action_case_events where action_case_id=$1 and event_type='customer_offer_published'",
        [f.caseId]
      )
    ).rows[0].n,
    1
  )
  const acl = (
    await db.query(
      "select has_table_privilege('authenticated','action_case_customer_offers','select') allowed,has_function_privilege('anon','respond_customer_offer(text,uuid,text,jsonb)','execute') executable"
    )
  ).rows[0]
  assert.equal(acl.allowed, false)
  assert.equal(acl.executable, false)
})

test('tampered recipient, snapshot, files and stale revision cannot publish', async () => {
  const f = await fixture()
  for (const patch of [
    { revision: 2 },
    { email: 'another@example.test' },
    { participantId: id(99) },
    { snapshot: { ...f.snapshot, baseAmountOre: 1 } },
    { files: [] },
    { files: [{ ...f.file, path: 'other/path' }] },
    { files: [{ ...f.file, sourcePath: 'changed' }] },
    { emailPayload: { to: 'other@example.test' } }
  ])
    await assert.rejects(f.write('publish', { ...f.publication, ...patch }))
  assert.equal(await get('action_case_customer_offers', f.offerId), undefined)
  // Supplier-response documents must not become customer offer attachments.
  await db.query(
    "insert into action_case_quote_requests(id,org_id,action_case_id,supplier_name,supplier_email,subject,body,lines,response_document_id) values($1,$2,$3,'UE','ue@example.test','Subject','Body','[{}]',$4)",
    [id(seq++), id(1), f.caseId, f.fileId]
  )
  await assert.rejects(f.write('publish', f.publication), /FILES/)
})

test('email leases prevent double sends and keep retries identical', async () => {
  const f = await fixture()
  await f.write('publish', f.publication)
  const claim = await f.write('claim_send', { id: f.offerId })
  assert.deepEqual(claim.payload, f.publication.emailPayload)
  await assert.rejects(f.write('claim_send', { id: f.offerId }), /BUSY/)
  await assert.rejects(
    f.write('finish_send', { id: f.offerId, leaseId: id(999), success: true }),
    /STALE/
  )
  await f.write('finish_send', {
    id: f.offerId,
    leaseId: claim.leaseId,
    success: false
  })
  const retry = await f.write('claim_send', { id: f.offerId })
  assert.deepEqual(retry.payload, claim.payload)
  await f.write('finish_send', {
    id: f.offerId,
    leaseId: retry.leaseId,
    success: true,
    providerMessageId: 'mail-1'
  })
  assert.deepEqual(await f.write('claim_send', { id: f.offerId }), {
    sent: true
  })
  const g = await fixture()
  await g.write('publish', g.publication)
  await db.query(
    "update action_case_customer_offers set first_attempt_at=now()-interval '25 hours' where id=$1",
    [g.offerId]
  )
  await assert.rejects(g.write('claim_send', { id: g.offerId }), /SEND_UNKNOWN/)
})

test('email-code acceptance binds server-held selection and name; wrong attempts persist, acceptance is idempotent and immutable', async () => {
  const f = await fixture()
  await f.write('publish', f.publication)
  await assert.rejects(
    f.respond('challenge', {
      ...f.challenge,
      selection: [f.draft.items[0].id]
    }),
    /INVALID/
  )
  await f.respond('challenge', f.challenge)
  await assert.rejects(
    f.respond('challenge', { ...f.challenge, challengeId: id(999) }),
    /RATE_LIMIT/
  )
  assert.deepEqual(
    await f.respond('accept', { challengeId: f.challengeId, codeHash: 'bad' }),
    { error: 'CUSTOMER_OFFER_CODE_INVALID' }
  )
  assert.equal(
    (await get('action_case_customer_offer_challenges', f.challengeId))
      .attempts,
    1
  )
  const answer = {
    challengeId: f.challengeId,
    codeHash: 'good-hash',
    selection: [],
    signerName: 'Tampered',
    total: 1
  }
  assert.deepEqual(await f.respond('accept', answer), { accepted: true })
  assert.deepEqual(await f.respond('accept', answer), { accepted: true })
  const row = await get('action_case_customer_offers', f.offerId)
  assert.equal(row.accepted_by, 'Customer Name')
  assert.equal(Number(row.accepted_total_ore), 11500050)
  assert.deepEqual(row.accepted_option_ids, f.challenge.selection)
  assert.ok(row.accepted_at)
  await assert.rejects(
    f.write('save', { revision: 1, body: f.draft }),
    /ACCEPTED/
  )
  await assert.rejects(f.write('withdraw', { id: f.offerId }), /IMMUTABLE/)
  await assert.rejects(
    db.query(
      "update action_case_customer_offers set status='published' where id=$1",
      [f.offerId]
    ),
    /IMMUTABLE/
  )
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from action_case_events where action_case_id=$1 and event_type='customer_offer_accepted'",
        [f.caseId]
      )
    ).rows[0].n,
    1
  )
})

test('five incorrect codes exhaust challenge, expired and revoked access cannot act, foreign and UE links cannot act', async () => {
  const f = await fixture()
  await f.write('publish', f.publication)
  await f.respond('challenge', f.challenge)
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await f.respond('accept', {
          challengeId: f.challengeId,
          codeHash: 'bad'
        })
      ).error,
      'CUSTOMER_OFFER_CODE_INVALID'
    )
  assert.equal(
    (
      await f.respond('accept', {
        challengeId: f.challengeId,
        codeHash: 'good-hash'
      })
    ).error,
    'CUSTOMER_OFFER_CODE_EXPIRED'
  )
  const g = await fixture()
  await g.write('publish', g.publication)
  await assert.rejects(
    f.respond('challenge', f.challenge, g.tokenHash),
    /NOT_FOUND/
  )
  await db.query(
    "update action_case_participants set role='subcontractor' where id=$1",
    [g.recipientId]
  )
  await assert.rejects(g.respond('challenge', g.challenge), /RECIPIENT/)
  await db.query(
    'update action_case_access_links set revoked_at=now() where token_hash=$1',
    [f.tokenHash]
  )
  await assert.rejects(f.respond('challenge', f.challenge), /CLOSED/)
  await db.query(
    "update action_case_access_links set revoked_at=null,expires_at=now()-interval '1 second' where token_hash=$1",
    [f.tokenHash]
  )
  await assert.rejects(f.respond('challenge', f.challenge), /CLOSED/)
})

test('new revision supersedes old version; old links can read history but cannot approve replaced/withdrawn offers', async () => {
  const f = await fixture()
  await f.write('publish', f.publication)
  await f.respond('challenge', f.challenge)
  const draft = { ...f.draft, baseAmountOre: 20000000 }
  await f.write('save', { revision: 1, body: draft })
  const nextId = id(seq++),
    next = {
      ...f.publication,
      id: nextId,
      revision: 2,
      snapshot: { ...f.snapshot, baseAmountOre: draft.baseAmountOre },
      tokenHash: 'new-' + f.tokenHash,
      files: [{ ...f.file, path: `${id(1)}/${f.caseId}/${nextId}/${f.fileId}` }]
    }
  await f.write('publish', next)
  assert.equal(
    (await get('action_case_customer_offers', f.offerId)).status,
    'superseded'
  )
  assert.equal((await get('action_case_customer_offers', nextId)).version, 2)
  await assert.rejects(
    f.respond('accept', { challengeId: f.challengeId, codeHash: 'good-hash' }),
    /CLOSED/
  )
  await f.respond(
    'challenge',
    { ...f.challenge, challengeId: id(seq++) },
    f.tokenHash,
    nextId
  )
  await f.write('withdraw', { id: nextId })
  await assert.rejects(
    f.respond('challenge', f.challenge, f.tokenHash, nextId),
    /CLOSED/
  )
})
