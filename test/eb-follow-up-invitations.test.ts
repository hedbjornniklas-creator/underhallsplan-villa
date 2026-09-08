import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import type * as Remediation from '../src/lib/eb/remediation'

// Production invitation logic with local database and mail boundaries only.
const require = createRequire(import.meta.url)
type Row = Record<string, unknown>
type Result = { data: Row | Row[]; error: null; count?: number }
type Query = {
  select: (columns?: string, options?: { count?: string; head?: boolean }) => Query; eq: (key: string, value: unknown) => Query; is: (key: string, value: unknown) => Query
  in: (key: string, values: unknown[]) => Query; filter: (key: string, operator: string, value: unknown) => Query
  limit: (value: number) => Query; insert: (value: Row) => Query; update: (value: Row) => Query
  maybeSingle: () => Promise<{ data: Row | null; error: null }>; single: () => Promise<Result>
  then: (resolve: (value: Result) => void) => void
}
function load<T>(path: string, dependencies: Record<string, unknown>, expose: string[] = []): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8') + '\n' +
    expose.map(name => `exports.${name} = ${name};`).join('\n')
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name === '@/lib/eb/reportNoteDisplay') return load('src/lib/eb/reportNoteDisplay.ts', {})
    if (name.startsWith('node:')) return require(name)
    throw new Error(`Unexpected invitation test dependency ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}

function fixture() {
  const common = { org_id: 'org', eb_project_id: 'project', inspection_id: 'inspection', follow_up_order_id: 'order' }
  const report = {
    project: { id: 'project', title: 'Renovering av Testvilla', propertyDesignation: 'VILLAN 1:2',
      address: 'Villavägen 4', postalCode: '123 45', city: 'Teststad', clientName: 'Rapportens beställare',
      invoiceAddress: 'PRIVATE-BILLING-ADDRESS', clientEmail: 'PRIVATE-CLIENT-EMAIL', inspections: [] },
    inspection: { inspectionId: 'inspection', variantLabel: 'Slutbesiktning', sequenceNo: 1,
      date: '2026-09-03', defaultRemedyDeadline: '2026-10-03', assignmentNumber: 'EB 2026-0903-01',
      clientName: 'Anna & Anders Exempel' },
    reportDraft: {}, branding: {},
  }
  const owner: Row = { ...common, id: 'owner', role: 'customer_owner', display_name: 'Buyer', email: 'buyer@example.test',
    token_hash: 'owner-token'.padEnd(36, '-'), revoked_at: null, expires_at: '2099-01-01T00:00:00Z' }
  const tables: Record<string, Row[]> = {
    eb_follow_up_orders: [{ ...common, id: 'order', status: 'active', withdrawal_requested_at: null,
      report_snapshot: { schemaVersion: 'eb_v1', ...report },
      buyer_snapshot: { name: 'Order Buyer', email: 'PRIVATE-BUYER-EMAIL', invoiceName: 'PRIVATE-INVOICE-NAME',
        invoiceAddress: 'PRIVATE-INVOICE-ADDRESS', privateOwnerUrl: 'https://example.test/atgarder/PRIVATE-OWNER-TOKEN' } }],
    eb_remediation_access_links: [owner, { ...owner, id: 'worker-access', role: 'assignee',
      remediation_assignee_id: 'worker', token_hash: 'worker-token'.padEnd(36, '-'), email: 'worker@example.test' }],
    eb_remediation_assignees: [{ ...common, id: 'worker', name: 'Painting', contact_name: 'Worker', email: 'worker@example.test' }],
    eb_remediation_tasks: [{ ...common, id: 'task', remediation_assignee_id: 'worker', included: true }],
  }
  const mails: Array<{ to: string; subject: string; html: string; text: string; dedupeKey: string }> = []
  let serial = 0, tokenSerial = 0, failQueue = false
  const admin = { from(table: string) {
    assert.ok(table in tables, table)
    const conditions: Array<(row: Row) => boolean> = []
    let insertion: Row | null = null, patch: Row | null = null, limit = Infinity, exactCount = false
    const rows = () => tables[table].filter(row => conditions.every(condition => condition(row))).slice(0, limit)
    const finish = (): Result => {
      if (insertion) {
        const value = { id: `issued-${++serial}`, revoked_at: null, ...insertion }
        tables[table].push(value)
        return { data: value, error: null }
      }
      const result = rows()
      if (patch) result.forEach(row => Object.assign(row, patch))
      return { data: result, error: null, ...(exactCount ? { count: result.length } : {}) }
    }
    const query: Query = {
      select: (_columns, options) => { exactCount = options?.count === 'exact'; return query },
      eq: (key, value) => { conditions.push(row => row[key] === value); return query },
      is: (key, value) => { conditions.push(row => (row[key] ?? null) === value); return query },
      in: (key, values) => { conditions.push(row => values.includes(row[key])); return query },
      filter: (key, operator, value) => operator === 'is' ? query.is(key, value) : query.eq(key, value),
      limit: value => { limit = value; return query },
      insert: value => { insertion = value; return query },
      update: value => { patch = value; return query },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => finish(), then: resolve => resolve(finish()),
    }
    return query
  } }
  const service = load<typeof Remediation>('src/lib/eb/remediation.ts', {
    sharp: {}, '@/lib/assignments/mailer': { sendAssignmentEmail: () => { throw new Error('No live email') } },
    '@/lib/assignments/tokens': { hashAssignmentToken: (value: string) => value, generateAssignmentToken: () => `private-invite-${++tokenSerial}` },
    '@/lib/eb/server': { getEbProjectById: async ({ orgId, projectId }: { orgId: string; projectId: string }) => {
      assert.equal(orgId, 'org'); assert.equal(projectId, 'project')
      return { id: 'project', orgId: 'org', title: 'Testvilla', inspections: [{ inspectionId: 'inspection', variantLabel: 'Slutbesiktning', sequenceNo: 1 }] }
    } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/eb/remediationPolicy': load('src/lib/eb/remediationPolicy.ts', {}),
    '@/lib/eb/remediationDefaults': load('src/lib/eb/remediationDefaults.ts', {}),
    '@/lib/eb/reportSnapshot': load('src/lib/eb/reportSnapshot.ts', {}), '@/lib/eb/followUpServer': {},
    '@/lib/eb/ownerAuth': { assertEbRemediationOwnerSession: async () => undefined },
    '@/lib/eb/followUpDelivery': { queueEbFollowUpEmail: async (mail: typeof mails[number]) => {
      if (failQueue) throw new Error('TEST_QUEUE_FAILURE')
      mails.push(mail)
    } },
  })
  const issue = () => service.issueEbRemediationAccessLink({ orgId: 'org', projectId: 'project', inspectionId: 'inspection',
    followUpOrderId: 'order', role: 'assignee', assigneeId: 'worker', email: 'worker@example.test', requestOrigin: 'https://example.test' })
  return { tables, owner, report, service, mails, issue, failQueue: () => { failQueue = true } }
}

test('public report and non-owner paid links cannot invite contractors or change recipients', async () => {
  const f = fixture()
  for (const role of ['assignee', 'contractor_admin', 'contractor_viewer']) {
    f.tables.eb_remediation_access_links[1].role = role
    for (const action of ['send_assignee_link', 'create_assignee', 'update_assignee', 'assign', 'revoke_link']) {
      await assert.rejects(f.service.performEbRemediationTokenAction({ token: 'worker-token'.padEnd(36, '-'), action,
        payload: { assigneeId: 'worker', taskIds: ['task'] } }), /EB_REMEDIATION_ACTION_FORBIDDEN/)
    }
  }
  await assert.rejects(f.service.performEbRemediationTokenAction({ token: 'public-report-token'.padEnd(36, '-'),
    action: 'send_assignee_link', payload: { assigneeId: 'worker' } }), /EB_REMEDIATION_ACCESS_NOT_FOUND/)
  assert.equal(f.mails.length, 0)
})

test('paid invitations require at least one included assigned task and remain unavailable after withdrawal', async () => {
  const f = fixture()
  assert.equal(f.mails.length, 0, 'An existing purchase alone does not invite a contractor')
  f.tables.eb_remediation_tasks[0].included = false
  await assert.rejects(f.issue(), /EB_REMEDIATION_TASK_REQUIRED/)
  f.tables.eb_remediation_tasks[0].included = true
  f.tables.eb_follow_up_orders[0].withdrawal_requested_at = '2026-09-08T12:00:00Z'
  await assert.rejects(f.issue(), /EB_FOLLOW_UP_ORDER_INACTIVE/)
  assert.equal(f.mails.length, 0)
})

test('purchase mail payloads target only the buyer and Admin, never automatically invite report-distribution contractors', () => {
  const service = load<{ orderEmails: (...input: unknown[]) => Array<{ kind: string; ciphertext: string }> }>('src/lib/eb/followUpServer.ts', {
    '@/lib/assignments/tokens': {}, '@/lib/supabase/admin': {}, '@/lib/eb/reportSnapshot': {},
    '@/lib/eb/followUp': load('src/lib/eb/followUp.ts', {}),
    '@/lib/eb/followUpConfirmation': load('src/lib/eb/followUpConfirmation.ts', {}),
    '@/lib/eb/followUpDelivery': { encryptEbFollowUpPayload: JSON.stringify, escapeEbFollowUpHtml: (value: string) => value },
    '@/lib/eb/followUpCustomer': {}, '@/lib/eb/followUpSeller': {}, '@/lib/eb/followUpTerms': {},
    '@/lib/eb/customerSession': {}, '@/lib/eb/customerLinks': {},
  }, ['orderEmails'])
  const jobs = service.orderEmails('order', 'intent', {
    name: 'Buyer', email: 'buyer@example.test', customerType: 'business', invoiceName: 'Buyer AB',
    invoiceAddress: 'Testvägen 1', invoicePostalCode: '12345', invoiceCity: 'Teststad',
  }, { name: 'Seller', email: 'seller@example.test', address: 'Testvägen 2', orgNumber: '123456-7890' },
  'https://example.test/atgarder/private-owner')
  assert.deepEqual(jobs.map(job => job.kind), ['receipt', 'invoice', 'access'])
  const recipients = jobs.map(job => JSON.parse(job.ciphertext).to)
  assert.deepEqual(recipients, ['buyer@example.test', 'jn@hedbjorn.se', 'buyer@example.test'])
  assert.equal(recipients.includes('worker@example.test'), false)
  const [receipt, invoice, access] = jobs.map(job => JSON.parse(job.ciphertext))
  assert.equal(receipt.confirmationPdf.buyer.customerType, 'business')
  assert.equal(receipt.confirmationPdf.withdrawalFormText, '')
  assert.equal(invoice.confirmationPdf, undefined)
  assert.equal(access.confirmationPdf, undefined)
  assert.doesNotMatch(receipt.text, /ångerrätt|ångerdag|Ångra beställningen/)
})

test('recipient and order scopes cannot be replaced with another project, order or inspection', async () => {
  for (const field of ['org_id', 'eb_project_id', 'follow_up_order_id']) {
    const f = fixture()
    f.tables.eb_remediation_assignees[0][field] = 'other'
    await assert.rejects(f.issue(), /EB_REMEDIATION_ASSIGNEE_NOT_FOUND/)
    assert.equal(f.mails.length, 0)
  }
  const f = fixture()
  f.tables.eb_follow_up_orders[0].inspection_id = 'other-inspection'
  await assert.rejects(f.issue(), /EB_REMEDIATION_ACTION_FORBIDDEN/)
})

test('a sequential resend replaces the previous worker link, not the buyer link, and queues only a scoped invitation', async () => {
  const f = fixture()
  const first = await f.issue(), second = await f.issue()
  assert.notEqual(first.accessUrl, second.accessUrl)
  assert.ok(f.tables.eb_remediation_access_links.find(row => row.id === first.link.id)?.revoked_at)
  assert.equal(f.tables.eb_remediation_access_links.find(row => row.id === second.link.id)?.revoked_at, null)
  assert.equal(f.owner.revoked_at, null)
  assert.equal(f.mails.length, 2)
  for (const mail of f.mails) {
    assert.equal(mail.to, 'worker@example.test')
    assert.match(mail.text, /dina tilldelade anmärkningar/)
    assert.doesNotMatch(mail.text, /owner-token|buyer@example|beställarlänk|köp|faktura/)
  }
})

test('a queue failure revokes the undelivered new invitation and preserves the previous working link', async () => {
  const f = fixture()
  f.failQueue()
  await assert.rejects(f.issue(), /TEST_QUEUE_FAILURE/)
  assert.equal(f.tables.eb_remediation_access_links.find(row => row.id === 'worker-access')?.revoked_at, null)
  assert.ok(f.tables.eb_remediation_access_links.find(row => String(row.id).startsWith('issued-'))?.revoked_at)
  assert.equal(f.mails.length, 0)
})

test('contractor list email identifies the frozen project, customer and inspection in HTML and plaintext', async () => {
  const f = fixture()
  const original = f.tables.eb_remediation_tasks[0]
  f.tables.eb_remediation_tasks.push({ ...original, id: 'task-2' },
    { ...original, id: 'excluded', included: false }, { ...original, id: 'other-contractor', remediation_assignee_id: 'other' },
    { ...original, id: 'other-inspection', inspection_id: 'other' }, { ...original, id: 'other-order', follow_up_order_id: 'other' })
  const invitation = await f.issue()
  const mail = f.mails[0]
  assert.equal(mail.subject, 'Åtgärdslista – Renovering av Testvilla – Slutbesiktning 1')
  for (const fact of ['Renovering av Testvilla', 'VILLAN 1:2', 'Villavägen 4, 123 45 Teststad',
    'Slutbesiktning 1', '2026-09-03', 'EB 2026-0903-01', '2026-10-03', invitation.accessUrl]) {
    assert.ok(mail.text.includes(fact), fact)
    assert.ok(mail.html.includes(fact), fact)
  }
  assert.match(mail.text, /Beställare: Anna & Anders Exempel/)
  assert.match(mail.html, /Anna &amp; Anders Exempel/)
  assert.match(mail.text, /Tilldelade anmärkningar: 2/)
  assert.match(mail.text, /Åtgärdsfrist enligt utlåtandet: 2026-10-03/)
  assert.match(mail.text, /enskilda punkter kan ha ett annat överenskommet datum/)
  assert.match(mail.html, /<html lang="sv">/)
  assert.match(mail.html, /<a href="https:\/\/example\.test\/atgarder\/private-invite-1"[^>]*>Öppna åtgärdslistan<\/a>/)
  assert.match(mail.text, /markera punkter som klara, skriva kommentarer och lägga till bilder/)
  assert.match(mail.text, /inte ett godkännande från besiktningsmannen/)
  assert.equal((mail.html.match(/<a /g) ?? []).length, 1, 'Only the contractor list link is included')
  assert.doesNotMatch(`${mail.subject}${mail.text}${mail.html}`, /PRIVATE-|Order Buyer|owner-token|worker-token/)
})

test('invitation uses available frozen customer name and omits missing dates instead of inventing them', async () => {
  const f = fixture()
  f.report.inspection.clientName = ''
  f.report.inspection.date = ''
  f.report.inspection.defaultRemedyDeadline = '2026-02-30'
  f.report.inspection.assignmentNumber = ''
  await f.issue()
  assert.match(f.mails[0].text, /Beställare: Rapportens beställare/)
  assert.doesNotMatch(f.mails[0].text, /Besiktningsdatum:|Åtgärdsfrist|Utlåtandenummer:|2026-02-30/)
  f.report.project.clientName = ''
  await f.issue()
  assert.match(f.mails[1].text, /Beställare: Order Buyer/)
  assert.doesNotMatch(`${f.mails[1].text}${f.mails[1].html}`, /PRIVATE-/)
})

test('HTML escapes project and customer facts and scoped counts work beyond the REST row limit', async () => {
  const f = fixture()
  f.report.project.title = '<img src=x onerror=alert(1)> & "Projekt"'
  f.report.inspection.clientName = '<script>alert(1)</script>'
  for (let index = 0; index < 1100; index++) {
    f.tables.eb_remediation_tasks.push({ ...f.tables.eb_remediation_tasks[0], id: `extra-${index}` })
  }
  await f.issue()
  const mail = f.mails[0]
  assert.match(mail.html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;Projekt&quot;/)
  assert.match(mail.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(mail.html, /<img|<script/)
  assert.match(mail.text, /Tilldelade anmärkningar: 1101/)
})

test('invalid or cross-inspection frozen snapshots cannot produce misleading invitations', async () => {
  for (const mismatch of ['snapshot', 'project', 'inspection']) {
    const f = fixture()
    if (mismatch === 'snapshot') f.tables.eb_follow_up_orders[0].report_snapshot = null
    if (mismatch === 'project') f.report.project.id = 'other'
    if (mismatch === 'inspection') f.report.inspection.inspectionId = 'other'
    await assert.rejects(f.issue(), /EB_REMEDIATION_ORDER_INVALID/)
    assert.equal(f.mails.length, 0)
    assert.equal(f.tables.eb_remediation_access_links.length, 2)
  }
})
