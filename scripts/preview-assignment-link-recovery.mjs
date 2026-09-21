import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

// Actual React pages with synthetic HTTP responses; no database or mail credentials.
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/assignment-link-ui')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/assignment-link-page.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    'next/navigation': resolve('test/fixtures/assignment-link-navigation.tsx'),
    '@/components/Protected': resolve('test/fixtures/assignment-link-navigation.tsx'),
    '@/components/ob/ObAssignmentWorkflowBoundary': resolve('test/fixtures/assignment-link-navigation.tsx'),
    'next/link': resolve('test/helpers/preview-link.tsx'), '@': resolve('src'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })).css
const js = await readFile(resolve(output, 'view.js'))
const assignment = { id: 'synthetic-assignment', org_id: 'synthetic-org', status: 'sent', assignment_type: 'OB',
  customer_name: 'Testkund', customer_email: 'test@example.test', customer_phone: '0700000000',
  customer_address: 'Testgatan 1', customer_postal_code: '12345', customer_city: 'Teststad',
  property_address: 'Testgatan 1', preliminary_address: 'Testgatan 1', property_postal_code: '12345',
  property_city: 'Teststad', property_municipality: 'Testkommun', property_owner_name: 'Testperson',
  cadastral_id: 'Test 1:1', orderer_role: 'buyer', price_amount: 1000, currency: 'SEK',
  preferred_date: '2026-09-25', preferred_time: '10:00', created_at: '2026-09-21T10:00:00Z',
  updated_at: '2026-09-21T10:00:00Z', last_sent_at: '2026-09-21T10:00:00Z', accepted_at: null,
  inspection_id: null, archived_at: null, notes_internal: '', assignment_details: {}, scope_description: 'Syntetiskt testuppdrag' }
const reference = '11111111-1111-4111-8111-111111111111'
const linkIssues = { available: true, items: [{ id: reference, assignment_id: assignment.id, operation: 'open',
  last_failed_at: '2026-09-21T10:01:00Z', last_reference: reference, occurrences: 2, notification_state: 'failed' }] }
const doc = { hash: 'a'.repeat(64), text: 'Syntetiska testvillkor.', templateId: 'test' }
const counters = new Map()
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  response.setHeader('Cache-Control', 'no-store')
  if (url.pathname.startsWith('/api/')) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (url.pathname === '/api/ob/assignments') { response.end(JSON.stringify({ items: [assignment], linkIssues })); return }
    if (url.pathname === `/api/ob/assignments/${assignment.id}`) { response.end(JSON.stringify({ assignment, addonOrders: [], linkIssues })); return }
    if (!url.pathname.startsWith('/api/assignments/accept/')) { response.writeHead(404); response.end('{}'); return }
    const mode = url.pathname.split('/').at(-1)
    const key = `${mode}:${request.method}`
    const count = (counters.get(key) ?? 0) + 1
    counters.set(key, count)
    if ((mode.startsWith('open-failure') && request.method === 'GET' && count === 1) || (request.method === 'POST' && count === 1)) {
      response.writeHead(500)
      response.end(JSON.stringify({ error: 'Uppdragsbekräftelsen kunde inte laddas just nu. Försök igen. Om felet kvarstår, kontakta besiktningsmannen och ange felreferensen.', reference, retryable: true })); return
    }
    if (request.method === 'POST') { response.end(JSON.stringify({ ok: true, confirmationEmailSent: false })); return }
    response.end(JSON.stringify({ state: 'open', expiresAt: '2099-01-01', usedAt: null, assignment,
      inspector: { full_name: 'Testbesiktningsman', email: 'inspector@example.test' }, addonOffers: [], selectedAddonServiceIds: [],
      terms: { version: mode === 'terms-change' && count > 1 ? 'test-v2' : 'test-v1', documents: Object.fromEntries(['seller','buyer','apartment','technical','construction','constructionBusiness','constructionConsumer'].map(k => [k, doc])) } })); return
  }
  if (url.pathname === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Uppdragslank - syntetiskt test</title><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
server.listen(Number(process.env.PORT ?? 57121), '127.0.0.1', () => console.log(`Synthetic assignment preview: http://127.0.0.1:${server.address().port}`))
