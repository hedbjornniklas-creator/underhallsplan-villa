import { createRoot } from 'react-dom/client'
import EbProjectDetailClient from '../../src/components/eb/EbProjectDetailClient'
import { AppToastProvider } from '../../src/components/ui/AppToastProvider'
import { emptyEbInspectionBilling, type EbInspectionBilling } from '../../src/lib/eb/billing'
import { ebOverviewInspection, ebOverviewProject } from './eb-overview-data'

declare global {
  interface Window {
    __ebBillingTest: {
      billing: EbInspectionBilling; writes: { url: string; body: Record<string, unknown> }[];
      reads: string[]; fail: number; delay: number;
    }
  }
}

const query = new URLSearchParams(location.search)
const locked = query.get('locked') !== 'false'
const initialBilling = emptyEbInspectionBilling()
window.__ebBillingTest = { billing: initialBilling, writes: [], reads: [], fail: 0, delay: 0 }
// The navigation mock shares the existing overview test contract; no real navigation runs.
Object.assign(window, { __ebOverviewTest: { navigations: [], refreshes: 0 } })
const project = ebOverviewProject({ inspections: [ebOverviewInspection({
  status: locked ? 'completed' : 'draft', reportLockedAt: locked ? '2026-11-07T09:00:00Z' : null,
  reportDeliveryStatus: locked ? 'sent' : 'not_sent', billing: initialBilling,
})] })

window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href)
  if (url.origin !== location.origin) throw Error('Synthetic billing test forbids external requests')
  const state = window.__ebBillingTest
  const method = init?.method ?? 'GET'
  if (method === 'GET') {
    state.reads.push(url.pathname)
    if (url.pathname.endsWith('/billing')) return Response.json({ billing: state.billing })
    if (url.pathname.endsWith('/invitation')) return Response.json({ participants: [], subject: '', body: '' })
    if (url.pathname.endsWith('/documents')) return Response.json({ documents: [] })
    if (url.pathname.endsWith('/attachments')) return Response.json({ attachments: [] })
    throw Error(`Unexpected synthetic read: ${url.pathname}`)
  }
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  state.writes.push({ url: url.pathname, body })
  if (method !== 'PATCH' || !url.pathname.endsWith('/billing')) throw Error(`Unexpected synthetic write: ${method} ${url.pathname}`)
  await new Promise(resolve => setTimeout(resolve, state.delay))
  if (state.fail) return Response.json({ error: state.fail === 503 ? 'Fakturamarkeringen är inte tillgänglig just nu.' : 'Syntetiskt sparfel.' }, { status: state.fail })
  if (body.expectedRevision !== state.billing.revision) return Response.json({ error: 'Ändrad av annan användare' }, { status: 409 })
  state.billing = {
    status: body.isInvoiced ? 'invoiced' : 'not_invoiced', invoicedAt: body.isInvoiced ? '2026-11-07T10:00:00Z' : null,
    invoiceNumber: body.invoiceNumber as string | null, updatedAt: '2026-11-07T10:00:00Z',
    updatedByName: 'Testperson', revision: state.billing.revision + 1,
  }
  return Response.json({ billing: state.billing })
}

createRoot(document.getElementById('root')!).render(<AppToastProvider>
  <EbProjectDetailClient project={project} attachments={[]} assignmentConfirmations={[]} />
</AppToastProvider>)
