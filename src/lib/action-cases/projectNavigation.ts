import type { ActionCaseView } from './contracts'

export const projectViews = ['overview', 'work', 'offer', 'contract', 'choices', 'payments', 'schedule', 'files', 'customer', 'review', 'offerReview'] as const
export type ProjectView = typeof projectViews[number]

export function parseProjectView(value: string | null | undefined): ProjectView {
  return projectViews.includes(value as ProjectView) ? value as ProjectView : 'overview'
}

export function projectUrl(caseId: string, view: ProjectView = 'overview') {
  return `/uppdrag/${encodeURIComponent(caseId)}${view === 'overview' ? '' : `?view=${view}`}`
}

export const projectStatus: Record<ActionCaseView['status'], string> = {
  preparing: 'Samla underlag', pricing: 'Kalkyl pågår', quote_ready: 'Offert klar',
  awaiting_customer: 'Väntar på kund', approved: 'Godkänt', in_progress: 'Pågår',
  completed: 'Slutfört', cancelled: 'Avbrutet',
}

export function projectNeeds(actionCase: ActionCaseView) {
  const scope = actionCase.items.filter((i) => i.status === 'scope_needed').length
  const pricing = actionCase.items.filter((i) => i.status === 'pricing_needed').length
  const ue = actionCase.items.filter((i) => i.status === 'waiting_subcontractor').length
  if (actionCase.status === 'completed' || actionCase.status === 'cancelled') return projectStatus[actionCase.status]
  return [scope && `${scope} saknar omfattning`, pricing && `${pricing} behöver pris`, ue && `${ue} väntar på UE`].filter(Boolean).join(' · ') || 'Inget markerat åtgärdsbehov'
}
