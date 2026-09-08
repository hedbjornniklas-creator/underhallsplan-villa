import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type * as Remediation from '../src/lib/eb/remediation'
import type * as Delivery from '../src/lib/eb/followUpDelivery'

const require = createRequire(import.meta.url)
function load<T>(path: string, dependencies: Record<string, unknown>, expose: string[] = []): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8') + '\n' +
    expose.map(name => `exports.${name} = ${name};`).join('\n')
  const output = ts.transpileModule(source, { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name === '@/lib/eb/reportNoteDisplay') return load('src/lib/eb/reportNoteDisplay.ts', {})
    if (name.startsWith('node:') || ['react', 'react/jsx-runtime', 'lucide-react'].includes(name)) return require(name)
    throw new Error(`Unexpected withdrawal test dependency: ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}

type Details = Pick<NonNullable<Remediation.EbRemediationWorkspace['followUp']>, 'buyerName' | 'receiptEmail' | 'customerType' | 'withdrawalDeadline'>
function actionFixture() {
  const access = { id: 'owner', role: 'customer_owner', org_id: 'org', eb_project_id: 'project', inspection_id: 'inspection',
    follow_up_order_id: 'order', email: 'buyer@example.test', display_name: 'Buyer', expires_at: '2099-01-01T00:00:00Z', revoked_at: null as string | null }
  const order = { id: 'order', org_id: 'org', eb_project_id: 'project', inspection_id: 'inspection', status: 'active',
    withdrawal_requested_at: null as string | null, buyer_snapshot: { name: 'Buyer', email: access.email, customerType: 'consumer',
      acceptanceSnapshot: { withdrawalDeadline: '2000-01-01' } } }
  const calls: Record<string, unknown>[] = []
  const admin = { from: (table: string) => {
    assert.ok(['eb_remediation_access_links', 'eb_follow_up_orders'].includes(table))
    const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: table === 'eb_remediation_access_links' ? access : order, error: null }) }
    return query
  } }
  const service = load<typeof Remediation & { followUpWithdrawalDetails: (snapshot: unknown) => Details }>('src/lib/eb/remediation.ts', {
    sharp: {}, '@/lib/assignments/tokens': { hashAssignmentToken: (value: string) => value },
    '@/lib/assignments/mailer': {}, '@/lib/eb/server': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/eb/reportSnapshot': {}, '@/lib/eb/remediationPolicy': load('src/lib/eb/remediationPolicy.ts', {}),
    '@/lib/eb/remediationDefaults': load('src/lib/eb/remediationDefaults.ts', {}),
    '@/lib/eb/followUpDelivery': {}, '@/lib/eb/ownerAuth': { assertEbRemediationOwnerSession: async () => undefined },
    '@/lib/eb/followUpServer': { withdrawEbFollowUpOrder: async (input: Record<string, unknown>) => {
      calls.push(input)
      // Stop at the existing atomic withdrawal boundary; its database effects have separate PGlite tests.
      throw new Error('TEST_WITHDRAWAL_RECORDED')
    } },
  }, ['followUpWithdrawalDetails'])
  const action = (payload: Record<string, unknown>) => service.performEbRemediationTokenAction({
    token: 'private-owner-token-with-more-than-32-characters', action: 'withdraw_order', payload, requestOrigin: 'https://example.test',
  })
  return { service, access, order, calls, action }
}

test('withdrawal rejects absent/false/string confirmation before calling the atomic purchase mutation', async () => {
  const f = actionFixture()
  for (const confirmed of [undefined, false, 'true', 1]) {
    await assert.rejects(f.action({ confirmed }), /EB_FOLLOW_UP_WITHDRAWAL_CONFIRMATION_REQUIRED/)
  }
  assert.deepEqual(f.calls, [])
})

test('only an active private owner link can confirm withdrawal, including a late or repeated request', async () => {
  const f = actionFixture()
  for (const role of ['assignee', 'contractor_admin', 'contractor_viewer']) {
    f.access.role = role
    await assert.rejects(f.action({ confirmed: true }), /EB_REMEDIATION_ACTION_FORBIDDEN/)
  }
  f.access.role = 'customer_owner'
  f.access.revoked_at = '2026-01-01T00:00:00Z'
  await assert.rejects(f.action({ confirmed: true }), /EB_REMEDIATION_ACCESS_REVOKED/)
  f.access.revoked_at = null
  f.access.expires_at = '2000-01-01T00:00:00Z'
  await assert.rejects(f.action({ confirmed: true }), /EB_REMEDIATION_ACCESS_EXPIRED/)
  f.access.expires_at = '2099-01-01T00:00:00Z'
  await assert.rejects(f.action({ confirmed: true, email: 'spoofed@example.test', orderId: 'other-order' }), /TEST_WITHDRAWAL_RECORDED/)
  f.order.withdrawal_requested_at = '2026-01-01T00:00:00Z'
  await assert.rejects(f.action({ confirmed: true }), /TEST_WITHDRAWAL_RECORDED/)
  assert.equal(f.calls.length, 2)
  assert.deepEqual(f.calls[0], { orderId: 'order', actorEmail: 'buyer@example.test', baseUrl: 'https://example.test' })
})

test('withdrawal display uses saved consumer metadata and never invents a deadline for a business or legacy order', () => {
  const f = actionFixture()
  assert.deepEqual(f.service.followUpWithdrawalDetails(f.order.buyer_snapshot), {
    buyerName: 'Buyer', receiptEmail: 'buyer@example.test', customerType: 'consumer', withdrawalDeadline: '2000-01-01',
  })
  for (const customerType of ['business', undefined, 'unknown']) {
    assert.equal(f.service.followUpWithdrawalDetails({ ...f.order.buyer_snapshot, customerType }).withdrawalDeadline, null)
  }
  assert.deepEqual(f.service.followUpWithdrawalDetails(null), { buyerName: null, receiptEmail: null, customerType: null, withdrawalDeadline: null })
})

test('withdrawal acknowledgement durably contains buyer name, order, exact time and receipt address with escaped HTML', async () => {
  const before = process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY
  process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY = 'test-only-local-key'
  try {
    const queued = new Map<string, Record<string, unknown>>()
    const order = { id: 'order-123', buyer_snapshot: { name: '<Buyer & Test>', email: 'buyer@example.test' },
      seller_snapshot: { email: 'seller@example.test' }, withdrawal_requested_at: '2026-09-08T14:15:16.789Z' }
    const admin = { from: (table: string) => {
      if (table === 'eb_follow_up_orders') {
        const query = { select: () => query, eq: () => query, single: async () => ({ data: order, error: null }) }
        return query
      }
      assert.equal(table, 'eb_follow_up_email_outbox')
      return { upsert: async (row: Record<string, unknown>, options: unknown) => {
        assert.deepEqual(options, { onConflict: 'dedupe_key', ignoreDuplicates: true })
        if (!queued.has(String(row.dedupe_key))) queued.set(String(row.dedupe_key), row)
        return { error: null }
      } }
    } }
    const delivery = load<typeof Delivery & { expandNotification: (row: unknown) => Promise<void> }>('src/lib/eb/followUpDelivery.ts', {
      '@/lib/assignments/mailer': { sendAssignmentEmail: () => { throw new Error('No external email from this test') } },
      '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
      '@/lib/eb/followUp': { EB_FOLLOW_UP_ADMIN_EMAIL: 'admin@example.test', normalizeEbFollowUpEmail: (value: string) => value },
    }, ['expandNotification'])
    const job = { id: 'withdrawal-job', order_id: order.id, kind: 'withdrawal' }
    await delivery.expandNotification(job)
    await delivery.expandNotification(job)
    assert.equal(queued.size, 3)
    const messages = [...queued.values()].map(row => delivery.decryptEbFollowUpPayload<Delivery.EbFollowUpEmail>(String(row.payload_ciphertext)))
    assert.deepEqual(messages.map(mail => mail.to).sort(), ['admin@example.test', 'buyer@example.test', 'seller@example.test'])
    for (const mail of messages) {
      for (const value of [order.id, order.buyer_snapshot.name, order.withdrawal_requested_at, order.buyer_snapshot.email]) assert.ok(mail.text.includes(value))
      assert.match(mail.html, /&lt;Buyer &amp; Test&gt;/)
      assert.match(mail.text, /inte ett beslut om betalning eller återbetalning/)
    }
  } finally {
    if (before === undefined) delete process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY
    else process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY = before
  }
})

test('owner withdrawal remains visible with read-only history and distinguishes business and legacy wording', () => {
  const component = load<{ default: (props: { initialWorkspace: unknown; endpoint: string }) => ReturnType<typeof createElement> }>('src/components/eb/EbRemediationPortalClient.tsx', {
    'next/link': { __esModule: true, default: 'a' }, '@/lib/eb/remediationPolicy': load('src/lib/eb/remediationPolicy.ts', {}),
    '@/lib/eb/remediationDefaults': load('src/lib/eb/remediationDefaults.ts', {}),
    '@/components/eb/EbRemediationImageViewer': load('src/components/eb/EbRemediationImageViewer.tsx', {}),
  })
  const workspace = { state: 'open', project: { title: 'Testvilla' }, inspection: null,
    access: { role: 'customer_owner', displayName: 'Buyer', email: 'buyer@example.test' },
    followUp: { id: 'order', acceptedAt: '2026-09-08T10:00:00Z', status: 'active', withdrawalRequestedAt: null as string | null,
      customerType: 'consumer' as string | undefined, buyerName: 'Buyer', receiptEmail: 'buyer@example.test', withdrawalDeadline: '2026-09-22' },
    assignees: [], tasks: [], events: [], images: [], originalImages: [], accessLinks: [] }
  const render = () => renderToStaticMarkup(createElement(component.default, { initialWorkspace: workspace, endpoint: '/test' }))
  let html = render()
  assert.doesNotMatch(html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '', /Ångra beställningen|angra-bestallning/)
  assert.match(html, /<details(?![^>]*\bopen=)[^>]*id="angra-bestallning"/)
  assert.match(html, /<\/details><div[^>]*><button[^>]*aria-controls="angra-bestallning"[^>]*>Ångra beställningen<\/button>/,
    'one plainly labelled withdrawal action stays available outside the collapsed order details')
  assert.match(html, /14 dagars ångerrätt/)
  assert.match(html, /2026-09-22/)
  workspace.followUp.customerType = 'business'
  html = render()
  assert.match(html, /Begär avbeställning/)
  assert.doesNotMatch(html, /14 dagars|sista ordinarie ångerdag/)
  workspace.followUp.customerType = undefined
  html = render()
  assert.match(html, /ingen beräknad ångerfrist/)
  workspace.followUp.withdrawalRequestedAt = '2026-09-08T11:00:00Z'
  assert.match(render(), /Din begäran har registrerats/)
  assert.match(render(), /<details[^>]*open=""[^>]*id="angra-bestallning"/)
  workspace.access.role = 'assignee'
  assert.doesNotMatch(render(), /angra-bestallning|buyer@example\.test/)
})
