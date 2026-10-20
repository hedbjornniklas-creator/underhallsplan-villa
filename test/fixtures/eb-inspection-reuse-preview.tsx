import { createRoot } from 'react-dom/client'
import EbInspectionReportView from '../../src/components/eb/EbInspectionReportView'
import EbPublicReportSnapshotView from '../../src/components/eb/EbPublicReportSnapshotView'
import { EbToastProvider } from '../../src/components/eb/EbToastProvider'
import type { EbInspectionReport, EbNote, EbNoteImage } from '../../src/lib/eb/server'
import { ebOverviewInspection, ebOverviewProject } from './eb-overview-data'

const inspection = ebOverviewInspection({ inspectionId: 'new-inspection', sequenceNo: 2,
  date: '2026-10-19', reportLockedAt: '2026-10-19T08:00:00Z' })
const note: EbNote = {
  id: 'new-note', inspectionId: inspection.inspectionId, projectId: 'project-alpha', disciplineId: 'building',
  noteNumber: 1, location: 'Vägg', room: 'Hall', placeDetail: null, markerKey: 'E', statusKey: 'open',
  noteText: 'Spricka vid dörren.', remediationAssigneeId: null, remediationAssigneeName: null,
  responsibleParty: null, tradeGroup: null, investigationResponsibleParty: null,
  investigationResponsibleNote: null, investigationCostParty: null, investigationDueDate: null,
  deductionAmount: null, sortOrder: 100, createdAt: null, updatedAt: null,
  disciplineLabel: 'Bygg', disciplineLittera: 'SLB2', markerLabel: 'Fel', statusLabel: 'Kvarstår',
}
const image: EbNoteImage = {
  id: 'copied-image', noteId: note.id, inspectionId: inspection.inspectionId, sourceAttachmentId: null,
  filePath: 'new-inspection/eb-notes/copied.jpg', thumbnailFilePath: null,
  label: 'Bildtexten har ändrats i den nya besiktningen.', sortOrder: 100,
  publicUrl: `${location.origin}/photo.svg`, thumbnailUrl: null, createdAt: null,
  reusedFrom: { inspectionId: 'old-inspection', inspectionDate: '2026-09-03', variant: 'SLB',
    sequenceNo: 1, noteId: 'old-note', noteNumber: 1, imageId: 'old-image' },
}
const report: EbInspectionReport = {
  project: ebOverviewProject({ inspections: [inspection] }), inspection,
  disciplines: [{ id: 'building', key: 'building', label: 'Bygg', littera: 'SLB2', sortOrder: 100, isActive: true }],
  markers: [{ key: 'E', label: 'Fel', colorToken: 'amber', sortOrder: 100 }],
  statuses: [{ key: 'open', label: 'Kvarstår', colorToken: 'gray', sortOrder: 100, isDefault: true }],
  remediationAssignees: [], notes: [note], images: [image, { ...image, id: 'new-image',
    filePath: 'new-inspection/eb-notes/new.jpg',
    label: 'Ny bild från detta tillfälle.', reusedFrom: undefined, sortOrder: 200 }],
  projectAttachments: [], suggestions: [], checkpoints: [], participants: [], inspectionDocuments: [],
  reportDraft: { schemaVersion: 2, templateKey: 'eb_default', templateTitle: 'EB-utlåtande', templateVersion: 2,
    initializedAt: null, sourceSnapshot: null, projectSourceRefreshBaseUpdatedAt: null, updatedAt: null,
    noteHeadings: [], sections: [{ key: 'defects_appendices', title: 'Fel och förhållanden', sbrPoint: null,
      source: 'notes', status: 'complete', isRelevant: true, text: '', contentMode: 'mixed', updatedAt: null }] },
  branding: { inspectorLogoUrl: null, inspectorAvatarUrl: null, inspectorSignatureUrl: null,
    besiktAppLogoUrl: '/report-assets/BesiktApp.png', footer: { companyLines: ['Testföretag'], contactLines: [] }, signature: null },
}

createRoot(document.getElementById('root')!).render(
  <EbToastProvider>
    {new URLSearchParams(location.search).has('print')
      ? <EbInspectionReportView report={report} showInternalActions={false} />
      : <EbPublicReportSnapshotView report={report} publishedAt="2026-10-19T08:00:00Z" pdfStatus="ready"
        shareEndpoint={null} shareUrl={null} pdfDownloadUrl={null} />}
  </EbToastProvider>,
)
