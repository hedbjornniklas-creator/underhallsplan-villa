export const RULES_BUCKET = 'renoapp-brf-rules'
export const RULES_MAX_FILE_BYTES = 15 * 1024 * 1024
export const RULES_MAX_TEXT_LENGTH = 50000

export type RenovationRulesVersion = {
  id: string
  brfId: string
  version: number
  format: 'text' | 'pdf'
  body: string | null
  fileName: string | null
  publishedAt: string
}

export type RenovationRulesAcceptance = {
  version: RenovationRulesVersion | null
  acceptedAt: string | null
  acceptedName: string | null
  acceptedEmail: string | null
  checkedAt: string | null
}

export function rulesAcceptanceFields(input: {
  mode: 'draft' | 'submit'
  isCompletion: boolean
  versionId?: string | null
  accepted?: boolean
  applicantName: string
  applicantEmail: string
}) {
  if (input.mode === 'draft' || input.isCompletion) return {}
  return {
    rules_version_id: input.versionId || null,
    rules_accepted_at: input.accepted === true ? new Date().toISOString() : null,
    rules_accepted_name: input.accepted === true ? input.applicantName : null,
    rules_accepted_email: input.accepted === true ? input.applicantEmail : null,
  }
}

export function rulesFileUrl(versionId: string, token?: string | null, download = false) {
  const query = new URLSearchParams()
  if (token) query.set('token', token)
  if (download) query.set('download', '1')
  return `/api/renoapp/rules/${encodeURIComponent(versionId)}/file?${query}`
}

export const RULES_ERRORS: Record<string, { message: string; status: number }> = {
  RULES_VERSION_CHANGED: { message: 'Renoveringsreglerna har ändrats. Läs den aktuella versionen och godkänn den innan du skickar in.', status: 409 },
  RULES_ACCEPTANCE_REQUIRED: { message: 'Du måste godkänna föreningens renoveringsregler innan du skickar in ansökan.', status: 400 },
  RULES_TEXT_REQUIRED: { message: 'Ange renoveringsreglerna som text (högst 50 000 tecken).', status: 400 },
  RULES_PDF_INVALID: { message: 'Välj en giltig PDF-fil, högst 15 MB.', status: 400 },
  RULES_UPLOAD_INVALID: { message: 'Uppladdningen kunde inte verifieras. Välj filen och försök igen.', status: 400 },
  RULES_NOT_FOUND: { message: 'Renoveringsreglerna kunde inte hittas.', status: 404 },
  RULES_FORBIDDEN: { message: 'Du saknar behörighet till föreningens renoveringsregler.', status: 403 },
}
