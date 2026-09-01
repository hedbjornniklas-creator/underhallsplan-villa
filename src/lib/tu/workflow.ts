import type { TuAnalysisValidation, TuAnalysisWorkflow } from '@/lib/tu/analysis'
import type { TuWholeReportDraftState } from '@/lib/tu/reportDraft'

export type TuWorkspaceView = 'field' | 'evidence' | 'assessment' | 'report' | 'delivery'

export type TuWorkflowStepState = 'not_started' | 'in_progress' | 'needs_attention' | 'complete'

export type TuWorkflowStep = {
  id: TuWorkspaceView
  number: number
  title: string
  shortTitle: string
  description: string
  status: TuWorkflowStepState
  statusText: string
  blockerCount: number
}

export type TuDeliveryWorkflowState = {
  reportLockedAt: string | null
  hasActiveLink: boolean
  pdfStatus: string | null
  sentCount: number
  revisionNumber: number | null
  revisionStatus: 'finalized' | 'published' | null
}

export type TuWorkflowSource = {
  validation: TuAnalysisValidation | null
  workflow: TuAnalysisWorkflow | null
  reportDraft: TuWholeReportDraftState | null
  delivery: TuDeliveryWorkflowState | null
  queue: {
    total: number
    failed: number
  }
  reportFilledSectionCount: number
  reportSectionCount: number
}

export const TU_WORKSPACE_ORDER: TuWorkspaceView[] = [
  'field',
  'evidence',
  'assessment',
  'report',
  'delivery',
]

function sourceCount(source: TuWorkflowSource) {
  return (source.validation?.observationCount ?? 0) + (source.validation?.imageCount ?? 0)
}

export function deriveTuWorkflowSteps(source: TuWorkflowSource): TuWorkflowStep[] {
  const validation = source.validation
  const workflow = source.workflow
  const analysisRun = workflow?.run ?? null
  const reportRun = source.reportDraft?.run ?? null
  const hasSources = sourceCount(source) > 0
  const evidenceBlockers =
    (validation?.unreviewedObservationCount ?? 0) +
    (validation?.emptyObservationCount ?? 0) +
    source.queue.failed
  const reportApplied = source.reportDraft?.sections.some((section) => section.status === 'accepted') ?? false
  const analysisStale = Boolean(workflow?.analysisStaleAt) || analysisRun?.status === 'cancelled'
  const fieldworkCompleted = Boolean(workflow?.fieldworkCompletedAt)
  const reportProcessing = reportRun?.status === 'queued' || reportRun?.status === 'processing'
  const reportFailed = reportRun?.status === 'failed' || reportRun?.status === 'cancelled'
  const locked = Boolean(source.delivery?.reportLockedAt)
  const currentRevisionPublished = source.delivery?.revisionStatus === 'published'
    || (
      source.delivery?.revisionNumber == null
      && (source.delivery?.sentCount ?? 0) > 0
      && locked
    )

  let fieldStatus: TuWorkflowStepState = 'not_started'
  let fieldStatusText = 'Lägg till den första fältposten'
  if (source.queue.failed > 0) {
    fieldStatus = 'needs_attention'
    fieldStatusText = `${source.queue.failed} bakgrundsjobb behöver nytt försök`
  } else if (source.queue.total > 0) {
    fieldStatus = 'in_progress'
    fieldStatusText = `${source.queue.total} poster bearbetas i bakgrunden`
  } else if (hasSources && fieldworkCompleted) {
    fieldStatus = 'complete'
    fieldStatusText = `${validation?.observationCount ?? 0} fältposter · ${validation?.imageCount ?? 0} bilder`
  } else if (hasSources) {
    fieldStatus = 'in_progress'
    fieldStatusText = `${validation?.observationCount ?? 0} fältposter · dokumentation pågår`
  }

  let evidenceStatus: TuWorkflowStepState = hasSources ? 'in_progress' : 'not_started'
  let evidenceStatusText = hasSources ? 'Granska och sortera underlaget' : 'Väntar på fältunderlag'
  if (source.queue.total > 0) {
    evidenceStatus = 'in_progress'
    evidenceStatusText = `${source.queue.total} poster bearbetas innan granskningen är klar`
  } else if (hasSources && evidenceBlockers > 0) {
    evidenceStatus = 'needs_attention'
    evidenceStatusText = `${evidenceBlockers} punkter behöver hanteras`
  } else if (hasSources && validation && validation.unreviewedObservationCount === 0) {
    evidenceStatus = 'complete'
    evidenceStatusText = validation.unlinkedImageCount > 0
      ? `Granskat · ${validation.unlinkedImageCount} osorterade bilder`
      : 'Underlaget är granskat'
  }

  let assessmentStatus: TuWorkflowStepState = 'not_started'
  let assessmentStatusText = !hasSources
    ? 'Väntar på fältunderlag'
    : evidenceBlockers > 0 || source.queue.total > 0
      ? 'Slutför granskningen först'
      : 'Redo för samlad bedömning'
  let assessmentBlockers = !hasSources ? 1 : evidenceBlockers + source.queue.total
  if (analysisStale) {
    assessmentStatus = 'needs_attention'
    assessmentStatusText = 'Underlaget ändrades · analysen måste uppdateras'
    assessmentBlockers = Math.max(1, assessmentBlockers)
  } else if (analysisRun?.status === 'queued' || analysisRun?.status === 'processing') {
    assessmentStatus = 'in_progress'
    assessmentStatusText = analysisRun.progressMessage || 'Analys pågår i bakgrunden'
    assessmentBlockers = 0
  } else if (analysisRun?.status === 'failed') {
    assessmentStatus = 'needs_attention'
    assessmentStatusText = 'Analysen misslyckades · försök igen'
    assessmentBlockers = 1
  } else if (workflow?.status === 'analysis_ready') {
    assessmentStatus = 'in_progress'
    assessmentStatusText = 'Förbereder rapportutkastet'
    assessmentBlockers = 0
  } else if (workflow?.status === 'analysis_approved') {
    assessmentStatus = 'complete'
    assessmentStatusText = 'Underlaget är sammanställt'
    assessmentBlockers = 0
  }

  let reportStatus: TuWorkflowStepState = 'not_started'
  let reportStatusText = 'Väntar på godkänd bedömning'
  let reportBlockers = workflow?.status === 'analysis_approved' ? 0 : 1
  if (analysisStale && source.reportFilledSectionCount > 0) {
    reportStatus = 'needs_attention'
    reportStatusText = 'Underlaget ändrades · utlåtandet måste uppdateras'
    reportBlockers = 1
  } else if (reportProcessing) {
    reportStatus = 'in_progress'
    reportStatusText = reportRun?.progressMessage || 'Utlåtandeförslag skapas i bakgrunden'
    reportBlockers = 0
  } else if (reportFailed) {
    reportStatus = 'needs_attention'
    reportStatusText = 'Utlåtandeförslaget kunde inte skapas'
    reportBlockers = 1
  } else if (reportRun?.status === 'completed' && !reportApplied) {
    reportStatus = 'needs_attention'
    reportStatusText = 'Förslaget är klart för granskning'
    reportBlockers = source.reportDraft?.sections.filter((section) => section.status === 'pending').length ?? 1
  } else if (
    workflow?.status === 'analysis_approved'
    && (reportApplied || source.reportFilledSectionCount > 0)
  ) {
    reportStatus = 'in_progress'
    reportStatusText = `${source.reportFilledSectionCount} av ${source.reportSectionCount} delar har text`
    reportBlockers = 0
    if (source.reportSectionCount > 0 && source.reportFilledSectionCount >= source.reportSectionCount) {
      reportStatus = 'complete'
      reportStatusText = 'Utlåtandet är klart för slutgranskning'
    }
  }

  let deliveryStatus: TuWorkflowStepState = 'not_started'
  let deliveryStatusText = 'Fastställ när slutgranskningen är klar'
  if (locked && !currentRevisionPublished) {
    deliveryStatus = 'in_progress'
    deliveryStatusText = source.delivery?.pdfStatus === 'failed'
      ? 'Fastställt · PDF behöver skapas om'
      : 'Fastställt · inte skickat'
  } else if (locked && currentRevisionPublished) {
    deliveryStatus = 'complete'
    deliveryStatusText = source.delivery?.revisionNumber
      ? `Revision ${source.delivery.revisionNumber} är levererad`
      : 'Den fastställda revisionen är levererad'
  }

  return [
    {
      id: 'field',
      number: 1,
      title: 'Dokumentera på plats',
      shortTitle: 'Dokumentera',
      description: 'Anteckningar, röst och bilder',
      status: fieldStatus,
      statusText: fieldStatusText,
      blockerCount: source.queue.failed,
    },
    {
      id: 'evidence',
      number: 2,
      title: 'Sortera och granska',
      shortTitle: 'Granska underlag',
      description: 'Kontrollera fakta och kopplingar',
      status: evidenceStatus,
      statusText: evidenceStatusText,
      blockerCount: evidenceBlockers,
    },
    {
      id: 'assessment',
      number: 3,
      title: 'Skapa utlåtandet',
      shortTitle: 'Skapa',
      description: 'Samlad analys och sammanhållet textförslag',
      status: assessmentStatus,
      statusText: assessmentStatusText,
      blockerCount: assessmentBlockers,
    },
    {
      id: 'report',
      number: 4,
      title: 'Granska utlåtandet',
      shortTitle: 'Utlåtande',
      description: 'Redigera och slutgranska texten',
      status: reportStatus,
      statusText: reportStatusText,
      blockerCount: reportBlockers,
    },
    {
      id: 'delivery',
      number: 5,
      title: 'Fastställ och leverera',
      shortTitle: 'Leverera',
      description: 'Skapa revision, PDF och skicka',
      status: deliveryStatus,
      statusText: deliveryStatusText,
      blockerCount: 0,
    },
  ]
}
