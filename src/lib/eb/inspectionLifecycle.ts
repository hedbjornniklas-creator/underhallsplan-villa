export type EbInspectionLifecycleSource = {
  status?: string | null
  reportLockedAt?: string | null
  /** Evidence from the scoped unlock audit, never inferred from a missing lock. */
  reportReopenedAt?: string | null
  reportPdfStatus?: string | null
  reportDeliveryStatus?: string | null
  reportLastSentAt?: string | null
}

export type EbInspectionLifecycle = {
  workStatus: 'ongoing' | 'completed' | 'archived' | 'cancelled'
  workLabel: string
  isOpen: boolean
  needsAttention: boolean
  isReopened: boolean
  deliveryLabel: string
  deliveryAction: string | null
}

const normalize = (value?: string | null) => value?.trim().toLowerCase() || ''
const archived = new Set(['archived', 'arkiverad'])
const cancelled = new Set(['cancelled', 'canceled', 'avbokad', 'avbruten'])
const completed = new Set(['completed', 'done', 'klar'])

/** Shared by the EB overview and dashboard. The decision about the works is separate. */
export function getEbInspectionLifecycle(
  inspection: EbInspectionLifecycleSource,
  projectStatus?: string | null
): EbInspectionLifecycle {
  const status = normalize(inspection.status)
  const parentStatus = normalize(projectStatus)
  const isArchived = archived.has(status) || archived.has(parentStatus)
  const isCancelled = cancelled.has(status) || cancelled.has(parentStatus)
  const isReopened = !inspection.reportLockedAt && Boolean(inspection.reportReopenedAt)
  // A project's completion does not close its individual inspections. A legacy
  // completed inspection is reopened only when the unlock audit proves it.
  const workStatus = isArchived ? 'archived' : isCancelled ? 'cancelled'
    : inspection.reportLockedAt || (completed.has(status) && !isReopened) ? 'completed' : 'ongoing'
  const isOpen = workStatus === 'ongoing'
  let deliveryLabel = inspection.reportDeliveryStatus === 'sent' ? 'Skickat' : 'Ej skickat'
  let deliveryAction: string | null = null

  if (isOpen) {
    deliveryLabel = isReopened
      ? inspection.reportDeliveryStatus === 'sent' || inspection.reportLastSentAt ? 'Tidigare version skickad' : 'Under ändring'
      : 'Ej klart för leverans'
  } else if (workStatus === 'completed' && inspection.reportLockedAt) {
    if (inspection.reportDeliveryStatus === 'failed') {
      deliveryLabel = 'Utskick misslyckades'
      deliveryAction = 'Kontrollera och skicka utlåtandet igen'
    } else if (inspection.reportPdfStatus === 'failed') {
      deliveryLabel = inspection.reportDeliveryStatus === 'sent' ? 'Skickat · PDF saknas' : 'PDF kunde inte skapas'
      deliveryAction = 'Kontrollera PDF-filen'
    } else if (inspection.reportDeliveryStatus === 'sending') {
      deliveryLabel = 'Utskick pågår'
    } else if (inspection.reportDeliveryStatus !== 'sent') {
      deliveryLabel = 'Att leverera'
      deliveryAction = 'Leverera utlåtandet'
    } else if (['pending', 'processing'].includes(inspection.reportPdfStatus || '')) {
      deliveryLabel = 'Skickat · PDF förbereds'
    }
  }

  return {
    workStatus,
    workLabel: workStatus === 'archived' ? 'Arkiverad' : workStatus === 'cancelled' ? 'Avbokad'
      : workStatus === 'completed' ? 'Klar' : isReopened ? 'Under ändring' : 'Pågående',
    isOpen,
    needsAttention: Boolean(deliveryAction),
    isReopened: isOpen && isReopened,
    deliveryLabel,
    deliveryAction,
  }
}
