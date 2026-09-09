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
  scopeAttachmentIds?: string[] | null
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
  updatedAt: string
  costSuggestion: ActionCaseCostSuggestion | null
}

export type ActionCaseCostLineView = {
  id: string
  category: 'own_labor' | 'material' | 'subcontractor' | 'waste' | 'transport' | 'other'
  description: string
  quantity: number | null
  unit: string
  unitCost: number | null
  markupPercent: number
  vatRate: number
  priceSource: 'manual' | 'beijer' | 'subcontractor' | 'price_book' | 'ai_suggestion' | 'other'
  sourceUrl: string | null
  sourceCheckedAt: string | null
  verified: boolean
  sortOrder: number
  quantityBasis: 'provided' | 'calculated' | 'estimated' | 'unknown'
  notes: string | null
  pricingMethod?: 'direct' | 'quotes'
  selectedQuoteId?: string | null
  coveredByQuoteId?: string | null
  quotes?: ActionCaseQuote[]
  updatedAt?: string
}

export type ActionCaseQuote = {
  id: string
  requestId?: string | null
  separatePricesConfirmed?: boolean
  supplierName: string
  supplierEmail: string | null
  amount: number | null
  offeredScope: string
  exclusions: string
  validUntil: string | null
  availableFrom: string | null
  materials: 'included' | 'excluded' | 'unspecified'
  travel: 'included' | 'excluded' | 'unspecified'
  waste: 'included' | 'excluded' | 'unspecified'
  coveredLineIds: string[]
  documentId: string | null
  checked: boolean
  scopeSnapshot: string
  descriptionSnapshot: string
  requestSubject: string
  requestBody: string
  requestAttachmentIds: string[]
  deliveryStatus: 'draft' | 'sending' | 'sent' | 'failed' | 'unknown'
  sentAt: string | null
  updatedAt: string
}

export type ActionCaseRequestLine = {
  costLineId: string
  itemId: string
  itemTitle: string
  scope: string
  description: string
}

export type ActionCaseQuoteRequest = {
  id: string
  supplierName: string
  supplierEmail: string
  subject: string
  message: string
  requirements: Array<{ key: string; label: string; text: string; kind: 'included' | 'separate' }>
  otherRequirements: string
  lines: ActionCaseRequestLine[]
  attachmentIds: string[]
  body: string
  supplementsId: string | null
  responseMode: 'pending' | 'itemized' | 'package'
  packageAmount: number | null
  responseNotes: string
  responseDocumentId: string | null
  deliveryStatus: ActionCaseQuote['deliveryStatus']
  sentAt: string | null
  firstAttemptAt: string | null
  updatedAt: string
}

export type ActionCaseSuggestedCostLine = Pick<ActionCaseCostLineView,
  'category' | 'description' | 'quantity' | 'unit' | 'quantityBasis' | 'notes'> & { id: string }

export type ActionCaseCostSuggestion = {
  id: string
  sourceUpdatedAt: string
  createdAt: string
  lines: ActionCaseSuggestedCostLine[]
  warnings: string[]
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
  isQuoteDocument?: boolean
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
  quoteRequests?: ActionCaseQuoteRequest[]
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
