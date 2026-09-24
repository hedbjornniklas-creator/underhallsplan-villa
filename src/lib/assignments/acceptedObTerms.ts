import 'server-only'

import { getAssignmentTermsDocument, type AssignmentTermsDocument } from './terms'

export type AcceptedObTerms =
  | { available: true; acceptedAt: string; document: AssignmentTermsDocument }
  | {
      available: false
      reason: 'not_accepted' | 'missing_reference' | 'unavailable_version'
      version: string | null
    }

export function getAcceptedObTerms(assignment: {
  accepted_at: string | null
  terms_version: string | null
  terms_document_hash: string | null
}): AcceptedObTerms {
  const version = assignment.terms_version
  if (!assignment.accepted_at) return { available: false, reason: 'not_accepted', version }
  const hash = assignment.terms_document_hash?.trim().toLowerCase()
  if (!version || !hash) return { available: false, reason: 'missing_reference', version }

  // Match the approved content, not today's editable customer role or status.
  for (const role of ['buyer', 'seller', 'apartment'] as const) {
    const document = getAssignmentTermsDocument(role)
    if (document.version === version && document.documentHash === hash) {
      return { available: true, acceptedAt: assignment.accepted_at, document }
    }
  }
  return { available: false, reason: 'unavailable_version', version }
}
