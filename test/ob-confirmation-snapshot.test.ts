import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as Delivery from '../src/lib/assignments/obConfirmationDelivery'
import type * as Snapshot from '../src/lib/assignments/obConfirmationSnapshot'
import type * as Retry from '../src/app/api/ob/assignments/[id]/confirmation/route'

function load<T>(file: string, deps: Record<string, unknown>): T {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (name in deps) return deps[name]
    throw new Error(`Unexpected dependency ${name}`)
  }, mod, mod.exports)
  return mod.exports as T
}
const terms = { role: 'buyer', version: 'locked-v1', text: 'Exactly approved.\nUnchanged text.', documentHash: '', templateId: 'original' }
terms.documentHash = createHash('sha256').update(terms.text).digest('hex')
const frozen = {
  assignment: { id: 'assignment-1', org_id: 'org-1', assignment_type: 'OB', accepted_at: '2026-09-24T10:00:00Z',
    customer_email: 'original@example.test', customer_name: 'Original customer', terms_version: terms.version, terms_document_hash: terms.documentHash },
  terms, inspector: { fullName: 'Original inspector', email: 'inspector@example.test' },
  issuerName: 'Original company', addonOrders: [], acceptancePayload: { customer_name: 'Original customer' },
}
const original = { pdf: Buffer.from('%PDF-original'), filename: 'Original.pdf', acceptedAt: frozen.assignment.accepted_at }

function deliveryHarness(options: { stored?: boolean; missing?: boolean; renderFails?: boolean; archiveFails?: boolean; mailFails?: boolean } = {}) {
  const events: string[] = []
  const updates: Record<string, unknown>[] = []
  const mails: Record<string, unknown>[] = []
  const admin = { from: (table: string) => {
    assert.equal(table, 'outbound_messages')
    const chain = {
      insert: (row: Record<string, unknown>) => { events.push('log'); assert.equal(row.recipient_email, frozen.assignment.customer_email); return chain },
      select: () => chain,
      single: async () => ({ data: { id: 'mail-1' }, error: null }),
      update: (row: Record<string, unknown>) => { updates.push(row); return chain },
      eq: async () => ({ error: null }),
    }
    return chain
  } }
  const api = load<typeof Delivery>('src/lib/assignments/obConfirmationDelivery.ts', {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/assignments/obConfirmationSnapshot': { getObConfirmationSnapshot: async (org: string, id: string) => {
      assert.equal(org, 'org-1'); assert.equal(id, 'assignment-1'); events.push('snapshot'); return options.missing ? null : structuredClone(frozen)
    } },
    '@/lib/assignments/acceptedPdfArchive': {
      getArchivedAssignmentPdf: async () => { events.push('read-original'); return options.stored ? original : null },
      archiveAcceptedAssignmentPdf: async (input: { pdf: Buffer }) => {
        events.push('archive'); assert.deepEqual(input.pdf, Buffer.from('%PDF-first-render'))
        if (options.archiveFails) throw new Error('ARCHIVE_FAILED')
        return original // Another sender may have won; always mail the stored winner.
      },
    },
    '@/lib/assignments/acceptedConfirmationPdf': {
      renderAcceptedAssignmentConfirmationPdf: async (input: unknown) => {
        events.push('render'); assert.deepEqual(input, frozen)
        if (options.renderFails) throw new Error('RENDER_FAILED')
        return Buffer.from('%PDF-first-render')
      },
      buildAcceptedAssignmentConfirmationFilename: () => 'First.pdf',
    },
    '@/lib/assignments/emailTemplates': { buildAssignmentAcceptedNoticeEmail: (input: { assignment: unknown }) => {
      assert.deepEqual(input.assignment, frozen.assignment); return { subject: 'Original subject', html: '<p>Original</p>', text: 'Original' }
    } },
    '@/lib/assignments/mailer': { sendAssignmentEmail: async (mail: Record<string, unknown>) => {
      events.push('send'); mails.push(mail)
      if (options.mailFails) throw new Error('MAIL_FAILED')
      return { provider: 'test', providerMessageId: 'test-1' }
    } },
  })
  return { events, updates, mails, send: () => api.sendFrozenObConfirmation({ orgId: 'org-1', assignmentId: 'assignment-1', requestedByUserId: 'user-1', fromAddress: 'from@example.test' }) }
}

test('new acceptance renders only frozen data, archives before sending, and sends the stored winner', async () => {
  const h = deliveryHarness()
  await h.send()
  assert.deepEqual(h.events, ['snapshot', 'log', 'read-original', 'render', 'archive', 'send'])
  assert.deepEqual(h.mails[0].attachments, [{ filename: original.filename, contentBase64: original.pdf.toString('base64'), contentType: 'application/pdf' }])
  assert.equal(h.mails[0].to, frozen.assignment.customer_email)
  assert.equal(h.updates[0].status, 'sent')
})
test('resending uses the byte-identical original without rendering or rewriting it', async () => {
  const h = deliveryHarness({ stored: true })
  await h.send()
  assert.deepEqual(h.events, ['snapshot', 'log', 'read-original', 'send'])
})
for (const failure of ['renderFails', 'archiveFails', 'mailFails'] as const) {
  test(`${failure} is logged and never replaces the snapshot/original`, async () => {
    const h = deliveryHarness({ [failure]: true })
    await assert.rejects(h.send())
    assert.equal(h.updates.at(-1)?.status, 'failed')
    assert.equal(h.mails.length, failure === 'mailFails' ? 1 : 0)
  })
}
test('legacy acceptance without snapshot cannot generate or email a new historical original', async () => {
  const h = deliveryHarness({ missing: true })
  await assert.rejects(h.send(), /SNAPSHOT_MISSING/)
  assert.deepEqual(h.events, ['snapshot'])
})

test('snapshot reads verify identity, schema, date and exact terms hash without current templates', async () => {
  let row: Record<string, unknown> | null = { schema_version: 'ob-confirmation-v1', snapshot_payload: frozen, accepted_at: frozen.assignment.accepted_at }
  const filters: unknown[] = []
  const chain = { select: () => chain, eq: (key: string, value: unknown) => { filters.push([key, value]); return chain }, maybeSingle: async () => ({ data: row, error: null }) }
  const api = load<typeof Snapshot>('src/lib/assignments/obConfirmationSnapshot.ts', {
    'server-only': {}, 'node:crypto': { createHash },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: () => chain }) },
    '@/lib/certifications/profileResolver': {},
  })
  assert.deepEqual(await api.getObConfirmationSnapshot('org-1', 'assignment-1'), frozen)
  assert.deepEqual(filters, [['org_id', 'org-1'], ['assignment_id', 'assignment-1']])
  const valid = row
  for (const patch of [
    { schema_version: 'unsupported' }, { accepted_at: '2020-01-01' },
    { snapshot_payload: { ...frozen, terms: { ...terms, text: 'Changed' } } },
    { snapshot_payload: { ...frozen, assignment: { ...frozen.assignment, org_id: 'another-org' } } },
  ]) {
    row = { ...valid, ...patch }
    await assert.rejects(api.getObConfirmationSnapshot('org-1', 'assignment-1'), /INVALID/)
  }
  row = null
  assert.equal(await api.getObConfirmationSnapshot('org-1', 'assignment-1'), null)
})

test('manual retry authenticates, refuses other modules/legacy/cross-origin, and sends only frozen data', async () => {
  const previous = process.env.OB_ASSIGNMENT_PDF_ARCHIVE_ENABLED
  process.env.OB_ASSIGNMENT_PDF_ARCHIVE_ENABLED = 'true'
  let authError = ''
  let assignmentType = 'OB'
  let snapshot: unknown = frozen
  let sends = 0
  try {
    const api = load<typeof Retry>('src/app/api/ob/assignments/[id]/confirmation/route.ts', {
      'next/server': { NextResponse: Response },
      '@/lib/assignments/server': {
        requireOrgContext: async () => { if (authError) throw new Error(authError); return { orgId: 'org-1', userId: 'user-1' } },
        getAssignmentById: async (org: string, id: string) => { assert.equal(org, 'org-1'); assert.equal(id, 'assignment-1'); return { assignment_type: assignmentType, customer_email: 'later-edited@example.test' } },
        sendAssignmentAcceptedNotice: async (input: { assignment: unknown }) => { sends++; assert.deepEqual(input.assignment, frozen.assignment) },
      },
      '@/lib/assignments/obConfirmationSnapshot': { getObConfirmationSnapshot: async () => snapshot },
    })
    const post = (origin = 'https://example.test') => api.POST(new Request('https://example.test/confirmation', { method: 'POST', headers: { origin } }), { params: Promise.resolve({ id: 'assignment-1' }) })
    assert.equal((await post('https://other.test')).status, 403)
    for (const [error, status] of [['UNAUTHORIZED', 401], ['ORG_MEMBERSHIP_REQUIRED', 403]] as const) {
      authError = error; assert.equal((await post()).status, status)
    }
    authError = ''
    for (const type of ['EB', 'TU', 'UHP']) { assignmentType = type; assert.equal((await post()).status, 404) }
    assignmentType = 'OB'; snapshot = null
    assert.equal((await post()).status, 409)
    snapshot = frozen
    process.env.OB_ASSIGNMENT_PDF_ARCHIVE_ENABLED = 'false'
    assert.equal((await post()).status, 409)
    assert.equal(sends, 0)
    process.env.OB_ASSIGNMENT_PDF_ARCHIVE_ENABLED = 'true'
    const response = await post()
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(sends, 1)
  } finally {
    if (previous === undefined) delete process.env.OB_ASSIGNMENT_PDF_ARCHIVE_ENABLED
    else process.env.OB_ASSIGNMENT_PDF_ARCHIVE_ENABLED = previous
  }
})
