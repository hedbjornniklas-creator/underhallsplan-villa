import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
// @ts-expect-error Node's strip-types runner requires explicit extensions.
import { encryptTuReportLinkToken, decryptTuReportLinkToken } from '../src/lib/tu/reportLinkToken.ts'
// @ts-expect-error Node's strip-types runner requires explicit extensions.
import { hashAssignmentToken } from '../src/lib/assignments/tokens.ts'

const require = createRequire(import.meta.url)
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const routeSource = read('src/app/api/tu/investigations/[inspectionId]/report-delivery/route.ts')
const uiSource = read('src/components/tu/TuPrintActions.tsx')

function load(source: string, imports: Record<string, unknown>) {
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const loaded = { exports: {} as Record<string, (...args: unknown[]) => unknown> }
  new Function('require', 'module', 'exports', code)(
    (name: string) => imports[name] ?? require(name), loaded, loaded.exports
  )
  return loaded.exports
}

const token = 'test-only-customer-token-'.repeat(2)
const publishedRevision = {
  id: 'revision-1', org_id: 'org-1', inspection_id: 'inspection-1',
  revision_number: 1, status: 'published', published_link_id: 'published-link', snapshot_link_id: 'frozen-link',
}
const publishedLink = {
  id: 'published-link', org_id: 'org-1', inspection_id: 'inspection-1', token_hash: hashAssignmentToken(token),
  tu_token_ciphertext: '', revoked_at: null as string | null,
  created_at: '2026-10-01', pdf_status: 'pending',
}

async function withTokenKey(run: (ciphertext: string) => Promise<void>) {
  const previous = process.env.TU_REPORT_LINK_ENCRYPTION_KEY
  process.env.TU_REPORT_LINK_ENCRYPTION_KEY = 'test-only-customer-link-key'
  try { await run(encryptTuReportLinkToken(token)) } finally {
    if (previous === undefined) delete process.env.TU_REPORT_LINK_ENCRYPTION_KEY
    else process.env.TU_REPORT_LINK_ENCRYPTION_KEY = previous
  }
}

function routeHarness(options: {
  links?: Record<string, unknown>[]
  revisions?: Record<string, unknown>[]
  authError?: string
  inspectionFound?: boolean
} = {}) {
  const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  const tables: Record<string, Record<string, unknown>[]> = {
    inspection_report_links: options.links ?? [],
    tu_report_revisions: options.revisions ?? [publishedRevision],
  }
  const admin = {
    from(table: string) {
      const query = { table, filters: [] as Array<[string, unknown]> }
      queries.push(query)
      let rows = [...(tables[table] ?? [])]
      const builder = {
        select: () => builder,
        eq(key: string, value: unknown) { query.filters.push([key, value]); rows = rows.filter(row => row[key] === value); return builder },
        is(key: string, value: unknown) { rows = rows.filter(row => row[key] === value); return builder },
        in(key: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[key])); return builder },
        order(key: string, { ascending }: { ascending: boolean }) {
          rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (ascending ? 1 : -1))
          return builder
        },
        limit(count: number) { rows = rows.slice(0, count); return builder },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(resolve) },
        insert() { assert.fail('Reading a customer link must not create data') },
        update() { assert.fail('Reading a customer link must not change data') },
        delete() { assert.fail('Reading a customer link must not delete data') },
      }
      return builder
    },
  }
  const unexpected = () => assert.fail('No email, token generation or publication allowed')
  const route = load(routeSource, {
    'next/server': { NextResponse: { json: Response.json }, after: () => {} },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/assignments/tokens': { hashAssignmentToken, generateAssignmentToken: unexpected },
    '@/lib/tu/reportLinkToken': { decryptTuReportLinkToken, encryptTuReportLinkToken: unexpected },
    '@/lib/assignments/mailer': { sendAssignmentEmail: unexpected },
    '@/lib/inspections/reportEmailTemplates': { buildInspectionReportDeliveryEmail: unexpected },
    '@/lib/report/pdfJobs': { runInspectionReportPdfBatch: unexpected },
    '@/lib/tu/server': {
      requireTuRequestContext: async () => {
        if (options.authError) throw new Error(options.authError)
        return { orgId: 'org-1', userId: 'user-1' }
      },
      getTuInvestigationById: async () => options.inspectionFound === false ? null : ({
        orgId: 'org-1', inspectionId: 'inspection-1', reportTemplateKey: 'standard',
        reportLockedAt: '2026-10-01', inspection: {}, reportDraft: { sections: [] },
      }),
    },
    '@/lib/tu/reportSnapshot': {},
    '@/lib/tu/authoring': { usesTuAiAssistedWorkflow: () => false },
    '@/lib/tu/evidence': { TU_MOISTURE_DAMAGE_TEMPLATE_KEY: 'moisture' },
    '@/lib/tu/evidenceServer': {},
    '@/lib/tu/workflowProfiles': { TU_POST_DAMAGE_REVIEW_TEMPLATE_KEY: 'post-damage' },
    '@/lib/tu/finalization': { isTuAnalysisStaleForFinalization: () => false },
    '@/lib/tu/reportQuality': {},
  })
  const context = { params: Promise.resolve({ inspectionId: 'inspection-1' }) }
  return {
    queries,
    get: () => route.GET(new Request('https://hushub.se/api/tu/investigations/inspection-1/report-delivery?orgId=org-1'), context) as Promise<Response>,
    regenerate: () => route.POST(new Request('https://hushub.se/api/tu/investigations/inspection-1/report-delivery?orgId=org-1', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'regenerate_pdf' }),
    }), context) as Promise<Response>,
  }
}

test('reload retrieves the same published customer link without writes, sending or token generation', async () => {
  await withTokenKey(async ciphertext => {
    const harness = routeHarness({ links: [{ ...publishedLink, tu_token_ciphertext: ciphertext }] })
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await harness.get()
      assert.equal(response.status, 200)
      assert.match(response.headers.get('Cache-Control') ?? '', /private, no-store/)
      const body = await response.json()
      assert.equal(new URL(body.publicLink).pathname, `/rapport/${token}`)
      assert.equal(body.publicLinkMessage, null)
      assert.equal(body.hasPublishedLink, true)
      assert.doesNotMatch(body.publicLink, /orgId|\/digital/)
    }
    for (const query of harness.queries.filter(q => ['tu_report_revisions', 'inspection_report_links'].includes(q.table))) {
      assert.ok(query.filters.some(([key, value]) => key === 'org_id' && value === 'org-1'))
      assert.ok(query.filters.some(([key, value]) => key === 'inspection_id' && value === 'inspection-1'))
    }
  })
})

test('a newer finalized revision does not replace the customer link to the published version', async () => {
  await withTokenKey(async ciphertext => {
    const newer = { ...publishedRevision, id: 'revision-2', revision_number: 2, status: 'finalized', published_link_id: null }
    const harness = routeHarness({
      revisions: [publishedRevision, newer],
      links: [{ ...publishedLink, tu_token_ciphertext: ciphertext }, { ...publishedLink, id: 'new-unpublished', created_at: '2026-10-02', tu_token_ciphertext: 'not-a-customer-token' }],
    })
    const body = await (await harness.get()).json()
    assert.equal(body.revisionNumber, 2)
    assert.equal(body.publishedRevisionNumber, 1)
    assert.equal(new URL(body.publicLink).pathname, `/rapport/${token}`)
    const regenerated = await (await harness.regenerate()).json()
    assert.equal(regenerated.publicLink, body.publicLink)
    assert.equal(regenerated.hasPublishedLink, true)
    assert.equal(regenerated.revisionStatus, 'finalized')
  })
})

test('finalized but unpublished reports expose only an internal preview', async () => {
  await withTokenKey(async ciphertext => {
    const harness = routeHarness({
      revisions: [{ ...publishedRevision, status: 'finalized', published_link_id: null }],
      links: [{ ...publishedLink, tu_token_ciphertext: ciphertext }],
    })
    const body = await (await harness.get()).json()
    assert.equal(body.publicLink, null)
    assert.equal(body.hasPublishedLink, false)
    assert.match(body.digitalUrl, /\/digital$/)
  })
})

test('revoked, legacy and unreadable links never fall back to an internal URL or create a replacement', async () => {
  await withTokenKey(async ciphertext => {
    for (const patch of [
      { revoked_at: '2026-10-02', tu_token_ciphertext: ciphertext },
      { tu_token_ciphertext: null },
      { tu_token_ciphertext: 'broken-ciphertext' },
      { tu_token_ciphertext: ciphertext, token_hash: 'wrong-hash' },
    ]) {
      const harness = routeHarness({ links: [{ ...publishedLink, ...patch }] })
      const response = await harness.get()
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.publicLink, null)
      assert.ok(body.publicLinkMessage)
      assert.doesNotMatch(JSON.stringify(body), /TOKEN_MISMATCH|broken-ciphertext|wrong-hash/)
    }
  })
})

test('customer links require the existing TU permission and investigation scope', async () => {
  for (const [authError, expectedStatus] of [['UNAUTHORIZED', 401], ['MODULE_ACCESS_REQUIRED', 403], ['ORG_MEMBERSHIP_REQUIRED', 403]] as const) {
    const harness = routeHarness({ authError })
    assert.equal((await harness.get()).status, expectedStatus)
    assert.equal(harness.queries.length, 0)
  }
  const missing = routeHarness({ inspectionFound: false })
  assert.equal((await missing.get()).status, 404)
  assert.equal(missing.queries.length, 0)
  const foreign = routeHarness({ links: [{ ...publishedLink, org_id: 'another-org' }] })
  assert.equal((await (await foreign.get()).json()).publicLink, null)
})

function uiHarness(meta: Record<string, unknown>) {
  const state: unknown[] = []
  const effects: Array<() => unknown> = []
  const notifications: Array<{ kind: string; message: unknown; options: unknown }> = []
  const component = load(uiSource, {
    react: {
      ...React,
      useState(initial: unknown) {
        const index = state.length
        state.push(index === 0 ? meta : index === 3 ? false : initial)
        return [state[index], (value: unknown) => { state[index] = value }]
      },
      useCallback: (callback: unknown) => callback,
      useEffect: (effect: () => unknown) => effects.push(effect),
    },
    '@/components/ui/AppToastProvider': { useToast: () => ({
      success: (message: unknown, options: unknown) => notifications.push({ kind: 'success', message, options }),
      error: (message: unknown, _fallback: unknown, options: unknown) => notifications.push({ kind: 'error', message, options }),
    }) },
  }).default
  const tree = component({ inspectionId: 'inspection-1', organizationId: 'org-1' }) as React.ReactElement
  return { tree, html: renderToStaticMarkup(tree), state, effects, notifications }
}

function findButton(node: React.ReactNode, label: string): React.ReactElement<{ onClick: () => Promise<void> }> | null {
  if (!React.isValidElement(node)) return null
  const element = node as React.ReactElement<{ children?: React.ReactNode; onClick: () => Promise<void> }>
  if (element.type === 'button' && React.Children.toArray(element.props.children).includes(label)) return element
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findButton(child, label)
    if (found) return found
  }
  return null
}

const uiMeta = {
  hasActiveLink: true, hasPublishedLink: true, publicLink: `https://hushub.se/rapport/${token}`,
  digitalUrl: '/tu/investigations/inspection-1/digital', pdfStatus: 'ready', reportLockedAt: '2026-10-01',
  publishedRevisionNumber: 1, revisionStatus: 'published', history: [],
}

test('customer links and internal preview have distinct destinations and labels', () => {
  const { html } = uiHarness(uiMeta)
  assert.match(html, /Öppna kundlänk/)
  assert.match(html, /Kopiera kundlänk/)
  assert.match(html, /href="https:\/\/hushub.se\/rapport\//)
  assert.match(html, /href="\/tu\/investigations\/inspection-1\/digital\?orgId=org-1"/)
  assert.match(html, /Intern förhandsvisning/)
  assert.doesNotMatch(html, /Öppna digitalt utlåtande/)
  const unavailable = uiHarness({ ...uiMeta, publicLink: null, publicLinkMessage: 'Den äldre kundlänken kan inte hämtas här.' }).html
  assert.doesNotMatch(unavailable, /Öppna kundlänk|Kopiera kundlänk/)
  assert.match(unavailable, /Den äldre kundlänken/)
  const unpublished = uiHarness({ ...uiMeta, hasPublishedLink: false }).html
  assert.doesNotMatch(unpublished, /Öppna kundlänk|Kopiera kundlänk/)
  assert.match(unpublished, /Ingen version har publicerats/)
})

test('copy uses the published URL and the existing dark success/error toasts', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  try {
    for (const failure of [false, true]) {
      let copied = ''
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: {
        writeText: async (text: string) => { if (failure) throw new Error('denied'); copied = text },
      } } })
      const harness = uiHarness(uiMeta)
      const button = findButton(harness.tree, 'Kopiera kundlänk')
      assert.ok(button)
      button.props.onClick()
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(copied, failure ? '' : uiMeta.publicLink)
      assert.equal(harness.notifications[0].kind, failure ? 'error' : 'success')
      assert.equal((harness.notifications[0].options as { appearance: string }).appearance, 'dark')
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})

test('a status refresh clears an unavailable customer link instead of resurrecting a cached URL', async () => {
  const previous = globalThis.fetch
  const harness = uiHarness(uiMeta)
  const refreshed = { ...uiMeta, hasPublishedLink: false, publicLink: null }
  globalThis.fetch = async () => Response.json(refreshed)
  try {
    harness.effects[0]()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(harness.state[0], refreshed)
  } finally { globalThis.fetch = previous }
})

test('the internal digital view is clearly marked and cannot offer its URL for sharing', () => {
  const source = read('src/app/(dashboard)/tu/investigations/[inspectionId]/digital/page.tsx')
  assert.match(source, /Intern förhandsvisning/)
  assert.match(source, /Denna länk kräver inloggning och är inte kundlänken/)
  assert.match(source, /shareEndpoint=\{null\}/)
  assert.match(source, /shareUrl=\{null\}/)
})
