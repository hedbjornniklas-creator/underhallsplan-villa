export type ActionCaseStatus =
  | 'preparing'
  | 'pricing'
  | 'quote_ready'
  | 'awaiting_customer'
  | 'approved'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

export type ActionItemStatus =
  | 'scope_needed'
  | 'pricing_needed'
  | 'waiting_subcontractor'
  | 'ready_for_quote'
  | 'offered'
  | 'approved'
  | 'declined'
  | 'scheduled'
  | 'in_progress'
  | 'ready_for_review'
  | 'completed'
  | 'cancelled'

export type ActionCaseItemView = {
  id: string
  title: string
  scope: string | null
  status: ActionItemStatus
  sortOrder: number
  ownLaborReady: boolean
  materialPriceReady: boolean
  subcontractorPriceReady: boolean
  wasteSolutionReady: boolean
  requiresSubcontractor: boolean
  estimatedCost: number | null
  customerPrice: number | null
  costLines: ActionCaseCostLineView[]
}

export type ActionCaseCostLineView = {
  id: string
  category: 'own_labor' | 'material' | 'subcontractor' | 'waste' | 'transport' | 'other'
  description: string
  quantity: number
  unit: string
  unitCost: number
  markupPercent: number
  vatRate: number
  priceSource: 'manual' | 'beijer' | 'subcontractor' | 'price_book' | 'ai_suggestion' | 'other'
  sourceUrl: string | null
  sourceCheckedAt: string | null
  verified: boolean
  sortOrder: number
}

export type ActionCaseParticipantView = {
  id: string
  role: 'customer' | 'subcontractor'
  name: string
  companyName: string | null
  email: string | null
  phone: string | null
}

export type ActionCaseAttachmentView = {
  id: string
  actionCaseItemId: string | null
  type: 'image' | 'document'
  title: string | null
  fileName: string
  contentType: string
  fileSizeBytes: number
  grantedParticipantIds: string[]
  createdAt: string
}

export type ActionCaseView = {
  id: string
  title: string
  customerName: string
  customerEmail: string | null
  customerPhone: string | null
  propertyAddress: string
  sourceKind: 'manual' | 'inspection' | 'email' | 'customer_request'
  sourceReference: string | null
  description: string | null
  status: ActionCaseStatus
  siteVisitAt: string | null
  createdAt: string
  updatedAt: string
  items: ActionCaseItemView[]
  participants: ActionCaseParticipantView[]
  attachments: ActionCaseAttachmentView[]
}

export type ActionCaseWorkspace = {
  cases: ActionCaseView[]
  summary: {
    active: number
    pricingNeeded: number
    waitingSubcontractor: number
    awaitingCustomer: number
    readyToSchedule: number
    readyToInvoice: number
  }
}

export type ActionCasePortal = {
  accessState: 'open' | 'expired' | 'revoked'
  participant: ActionCaseParticipantView
  actionCase: Pick<ActionCaseView, 'id' | 'title' | 'propertyAddress' | 'description' | 'status'> & {
    items: Array<Pick<ActionCaseItemView, 'id' | 'title' | 'scope' | 'status' | 'sortOrder'>>
    attachments: ActionCaseAttachmentView[]
  }
}
