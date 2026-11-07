/** Amounts are integer öre, stored as magnitudes. Credit documents reverse the sign in totals. */
export type InvoiceDocumentKind = 'invoice' | 'credit'
export type InvoiceApprovalStatus = 'registered' | 'approved' | 'disputed' | 'void'
export type InvoiceCostCategory = 'material' | 'subcontractor' | 'waste' | 'transport' | 'other'

export type SupplierInvoiceAllocation = {
  id?: string
  changeId?: string | null
  caseId: string
  itemId: string | null
  category: InvoiceCostCategory
  description: string
  amountOre: number
}

export type ProjectInvoiceTarget = { id: string; kind: 'item' | 'change'; title: string; mode: 'fixed' | 'running' | 'budget' | 'unknown'; markupPercent: number | null; parts?: { key: string; mode: string; markupPercent: number | null }[] }
export type SupplierInvoiceBasisLink = { invoiceId: string; allocationId: string; basisId: string; lineId: string; customerNetOre: number; agreement: string }
export type ProjectInvoiceWorkspace = SupplierInvoiceWorkspace & {
  userId: string; status: string; targets: ProjectInvoiceTarget[]; links: SupplierInvoiceBasisLink[]
}

export type SupplierInvoiceDraft = {
  supplierName: string
  supplierOrgNumber: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  documentKind: InvoiceDocumentKind
  creditReferenceInvoiceId: string | null
  currency: 'SEK'
  netAmountOre: number
  vatAmountOre: number
  approvalStatus: InvoiceApprovalStatus
  paymentStatus: 'unpaid' | 'paid'
  paidOn: string | null
  notes: string
  sourceText: string
  allocations: SupplierInvoiceAllocation[]
}

export type SupplierInvoiceAttachment = {
  id: string
  fileName: string
  contentType: string
  fileSizeBytes: number
  createdAt: string
}

export type SupplierInvoice = SupplierInvoiceDraft & {
  id: string
  revision: number
  source: 'manual' | 'fortnox'
  externalId: string | null
  createdAt: string
  updatedAt: string
  attachments: SupplierInvoiceAttachment[]
}

export type SupplierInvoiceWorkspace = {
  invoices: SupplierInvoice[]
}

export type SupplierInvoiceSaveRequest = {
  operation: 'save'
  id: string
  expectedRevision: number
  invoice: SupplierInvoiceDraft
}

/** The committed revision belongs to the submitted draft, even if the workspace has newer changes. */
export type SupplierInvoiceSaveResult = SupplierInvoiceWorkspace & {
  saved: { id: string; revision: number }
}
