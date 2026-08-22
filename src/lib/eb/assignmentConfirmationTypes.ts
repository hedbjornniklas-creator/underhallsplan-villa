import type { AssignmentStatus } from '@/lib/assignments/server'

export type EbAssignmentPricingModel = 'fixed' | 'hourly'

export type EbAssignmentDetails = {
  schema: 'eb-v1'
  pricingModel: EbAssignmentPricingModel
  vatIncluded: boolean
  contractTerms: string
  paymentTerms: string
  travelIncluded: boolean
  travelTerms: string
  assistantHourlyRate: number | null
  budgetAmount: number | null
  expenseMarkupPercent: number | null
  cancellationTerms: string
  basisDocuments: string
  executionNotes: string
  scheduleNotes: string
  insuranceTerms: string
  specialTerms: string
  invoiceReference: string
  invoicePostalCode: string
  invoiceCity: string
}

export type EbAssignmentConfirmationSummary = {
  assignmentId: string
  inspectionId: string
  versionNo: number
  status: AssignmentStatus
  acceptedAt: string | null
  lastSentAt: string | null
  customerEmail: string
  priceAmount: number | null
  currency: string
  pricingModel: EbAssignmentPricingModel
}

export type EbAssignmentConfirmationForm = {
  assignmentId: string | null
  versionNo: number
  status: AssignmentStatus | 'not_created'
  acceptedAt: string | null
  lastSentAt: string | null
  customerName: string
  customerEmail: string
  customerPhone: string
  customerAddress: string
  customerPostalCode: string
  customerCity: string
  propertyAddress: string
  propertyPostalCode: string
  propertyCity: string
  propertyMunicipality: string
  propertyDesignation: string
  propertyOwnerName: string
  scopeDescription: string
  preferredDate: string
  preferredTime: string
  priceAmount: number | null
  currency: string
  invoiceName: string
  invoiceOrgNo: string
  invoiceEmail: string
  invoiceAddress: string
  details: EbAssignmentDetails
}
