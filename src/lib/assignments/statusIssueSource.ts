import 'server-only'

import { createHash } from 'node:crypto'
import type { AssignmentTermsDocument } from './terms'
import type { AssignmentConfirmationPdfInspector } from './acceptedConfirmationPdf'

export type StatusIssueSource = {
  schemaVersion: 'ob-confirmation-v1'
  statusScopeDescription: string
  statusPriceAmount: number
  terms: AssignmentTermsDocument
  issuerName: string | null
  inspector: AssignmentConfirmationPdfInspector
}

// Validate the stored issue, not today's source file. A new source version must
// never rewrite the agreement shown by an already-issued link.
export function requireStatusIssueSource(value: unknown, version: string | null): StatusIssueSource {
  const source = value as StatusIssueSource | null
  const terms = source?.terms
  if (!source || source.schemaVersion !== 'ob-confirmation-v1' || !terms ||
    typeof source.statusScopeDescription !== 'string' || !source.statusScopeDescription.trim() ||
    typeof source.statusPriceAmount !== 'number' || !Number.isFinite(source.statusPriceAmount) || source.statusPriceAmount < 0 ||
    terms.role !== 'status' || terms.verbatim !== true || terms.version !== version ||
    terms.templateId !== 'STD_ASSIGNMENT_TEMPLATE_STATUS_2026' ||
    typeof terms.sourceId !== 'string' || !terms.sourceId.startsWith('OB_STATUS_') ||
    typeof terms.sourceFileHash !== 'string' || !/^[a-f0-9]{64}$/i.test(terms.sourceFileHash) ||
    typeof terms.text !== 'string' || !terms.text ||
    createHash('sha256').update(terms.text, 'utf8').digest('hex') !== terms.documentHash ||
    !terms.confirmationTexts || Object.values(terms.confirmationTexts).some(text =>
      typeof text !== 'string' || !terms.text.includes(text)) ||
    !source.inspector || !Array.isArray(source.inspector.certifications)) {
    throw new Error('STATUS_ISSUED_SOURCE_INVALID')
  }
  return source
}
