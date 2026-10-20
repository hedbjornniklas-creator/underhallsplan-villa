import { createRoot } from 'react-dom/client'
import EbInspectionRoundClient from '../../src/components/eb/EbInspectionRoundClient'
import { EbToastProvider } from '../../src/components/eb/EbToastProvider'
import type { EbInspectionReport, EbNote } from '../../src/lib/eb/server'
import { ebOverviewInspection, ebOverviewProject } from './eb-overview-data'

const inspection = ebOverviewInspection({ inspectionId: 'editor-preview', sequenceNo: 2 })
const notes: EbNote[] = Array.from({ length: 31 }, (_, index) => ({
  id: `note-${index + 9}`, inspectionId: inspection.inspectionId, projectId: 'project-alpha', disciplineId: 'building',
  noteNumber: index + 9, location: 'Fönster', room: 'Loft', placeDetail: null, markerKey: 'E', statusKey: 'open',
  noteText: `Sparad punkt ${index + 9}`, remediationAssigneeId: null, remediationAssigneeName: null,
  responsibleParty: null, tradeGroup: null, investigationResponsibleParty: null, investigationResponsibleNote: null,
  investigationCostParty: null, investigationDueDate: null, deductionAmount: null, sortOrder: (index + 9) * 100,
  createdAt: null, updatedAt: null, disciplineLabel: 'Bygg', disciplineLittera: 'SLB2', markerLabel: 'Fel', statusLabel: 'Kvarstår',
}))
const report: EbInspectionReport = {
  project: ebOverviewProject({ inspections: [inspection] }), inspection, notes, images: [],
  disciplines: [{ id: 'building', key: 'building', label: 'Bygg', littera: 'SLB2', sortOrder: 100, isActive: true }],
  markers: [{ key: 'E', label: 'Fel', colorToken: 'amber', sortOrder: 100 }],
  statuses: [{ key: 'open', label: 'Kvarstår', colorToken: 'gray', sortOrder: 100, isDefault: true }],
  remediationAssignees: [], projectAttachments: [], suggestions: [], checkpoints: [], participants: [], inspectionDocuments: [],
  reportDraft: { schemaVersion: 2, templateKey: 'eb_default', templateTitle: 'EB-utlåtande', templateVersion: 2,
    initializedAt: '2026-10-20T08:00:00Z', updatedAt: null, sourceSnapshot: null, projectSourceRefreshBaseUpdatedAt: null,
    noteHeadings: [], sections: [{ key: 'notes', title: 'Noteringar', sbrPoint: null, source: 'notes',
      status: 'complete', isRelevant: true, text: '31 noteringar.', contentMode: 'structured', updatedAt: null }] },
  branding: { inspectorLogoUrl: null, inspectorAvatarUrl: null, inspectorSignatureUrl: null,
    besiktAppLogoUrl: '/report-assets/BesiktApp.png', footer: { companyLines: [], contactLines: [] }, signature: null },
}

type Write = { method: string; id: string; text: string; completed: boolean }
declare global {
  interface Window {
    __ebEditorTest: { writes: Write[]; holdNext: boolean; failNext: boolean; pending: Array<() => void>; saved: Record<string, string> }
  }
}
window.__ebEditorTest = { writes: [], holdNext: false, failNext: false, pending: [], saved: {} }
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href)
  if (url.origin !== location.origin) throw Error('Synthetic editor forbids external requests')
  const state = window.__ebEditorTest
  const method = init?.method ?? 'GET'
  if (method === 'GET') return Response.json({ participants: [], images: [], attachments: [],
    report, round: report, reportDraft: report.reportDraft, checkpoints: [], documents: [] })
  const body = JSON.parse(String(init?.body ?? '{}'))
  if (/\/notes(?:\/[^/]+)?$/.test(url.pathname) && ['PATCH', 'POST'].includes(method)) {
    const id = method === 'POST' ? 'new-note' : url.pathname.split('/').at(-1)!
    const record = { method, id, text: body.noteText ?? '', completed: false }
    state.writes.push(record)
    if (state.holdNext) {
      state.holdNext = false
      await new Promise<void>(resolve => state.pending.push(resolve))
    }
    if (state.failNext) {
      state.failNext = false
      return Response.json({ error: 'Simulerat sparfel. Försök igen.' }, { status: 503 })
    }
    const existing = notes.find(note => note.id === id) ?? { ...notes[0], id, noteNumber: 40, sortOrder: 4000 }
    const note = { ...existing, ...body, updatedAt: '2026-10-20T08:00:01Z' }
    state.saved[id] = note.noteText
    record.completed = true
    return Response.json({ note })
  }
  throw Error(`Unexpected synthetic mutation: ${method} ${url.pathname}`)
}

createRoot(document.getElementById('root')!).render(
  <EbToastProvider><EbInspectionRoundClient initialRound={report} initialDisciplineId={null} /></EbToastProvider>,
)
