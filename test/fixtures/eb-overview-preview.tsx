import { createRoot } from 'react-dom/client'
import EbDashboardClient from '../../src/components/eb/EbDashboardClient'
import { AppToastProvider } from '../../src/components/ui/AppToastProvider'
import { ebOverviewDemo, ebOverviewInspection, ebOverviewProject } from './eb-overview-data'

declare global {
  interface Window {
    __ebOverviewTest: {
      fail: boolean; failStatus: number; empty: boolean; delay: number; reads: string[];
      writes: { url: string; body: Record<string, unknown> }[];
      navigations: string[]; refreshes: number; createInspectionFailures: number;
    }
  }
}

const mode = new URLSearchParams(location.search).get('state')
const savedProjects = new Map<string, ReturnType<typeof ebOverviewProject>>()
window.__ebOverviewTest = {
  fail: mode === 'error', failStatus: 503, empty: mode === 'empty', delay: 0, reads: [], writes: [],
  navigations: [], refreshes: 0, createInspectionFailures: 0,
}
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href)
  const state = window.__ebOverviewTest
  if (url.origin !== location.origin) throw Error('Synthetic preview forbids external requests')
  const method = init?.method ?? 'GET'
  const snapshot = { ...state }
  await new Promise(resolve => setTimeout(resolve, snapshot.delay))
  if (method === 'GET') {
    state.reads.push(url.pathname + url.search)
    if (snapshot.fail) return Response.json({ error: 'Kunde inte hämta besiktningarna.' }, { status: snapshot.failStatus })
    if (url.pathname === '/api/eb/projects') return Response.json({ projects: snapshot.empty ? [] : ebOverviewDemo() })
    const delivery = url.pathname.match(/^\/api\/eb\/projects\/([^/]+)\/inspections\/([^/]+)\/report-delivery$/)
    if (delivery) {
      const project = ebOverviewDemo().find(item => item.id === delivery[1])
      const inspection = project?.inspections.find(item => item.inspectionId === delivery[2])
      if (!project || !inspection) return Response.json({}, { status: 404 })
      // Production returns the refreshed project alongside delivery metadata.
      // This exercises the parent update callback, not just the dialog alone.
      return Response.json({
        project, reportLockedAt: inspection.reportLockedAt, hasActiveLink: Boolean(inspection.reportLockedAt),
        pdfStatus: inspection.reportPdfStatus, pdfError: inspection.reportPdfError,
        downloadUrl: inspection.reportPdfDownloadUrl, defaultRecipientEmail: project.clientEmail,
        defaultExtraRecipients: [], deliveryCustomer: null, customerContactUnavailable: false,
        hasBeenSent: inspection.reportDeliveryStatus === 'sent',
        deliveryStatus: inspection.reportDeliveryStatus === 'sent' ? 'sent' : 'finalized', history: [], activityLog: [],
      })
    }
    return Response.json({}, { status: 404 })
  }
  if (method !== 'POST') throw Error(`Blocked preview method: ${method}`)
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  state.writes.push({ url: url.pathname, body })
  if (url.pathname === '/api/eb/projects') {
    const project = ebOverviewProject({ ...body, id: 'synthetic-created-project', inspections: [] })
    savedProjects.set(project.id, project)
    return Response.json({ project }, { status: 201 })
  }
  if (/^\/api\/eb\/projects\/[^/]+\/inspections$/.test(url.pathname)) {
    if (state.createInspectionFailures > 0) {
      state.createInspectionFailures--
      return Response.json({ error: 'Syntetiskt fel: försök skapa besiktningen igen.' }, { status: 503 })
    }
    const projectId = url.pathname.split('/')[4]
    const project = savedProjects.get(projectId) ?? ebOverviewDemo().find(item => item.id === projectId)
    if (!project) return Response.json({}, { status: 404 })
    const inspection = ebOverviewInspection({
      ...body, projectId, inspectionId: 'synthetic-created-inspection', date: String(body.inspectionDate ?? '') || null,
      sequenceNo: Math.max(0, ...project.inspections.map(item => item.sequenceNo)) + 1,
    })
    return Response.json({ project: { ...project, inspections: [...project.inspections, inspection] } }, { status: 201 })
  }
  throw Error(`Blocked preview mutation: ${url.pathname}`)
}

createRoot(document.getElementById('root')!).render(<AppToastProvider>
  <div className="preview-notice">Förhandsvisning med testdata · Inte publicerad</div>
  <header className="preview-header">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/report-assets/BesiktApp.png" alt="BesiktApp" /><span>Entreprenadbesiktningar</span>
  </header>
  <EbDashboardClient initialProjects={mode ? [] : ebOverviewDemo()} initialError={mode === 'error' ? 'Kunde inte hämta besiktningarna.' : null} />
</AppToastProvider>)
