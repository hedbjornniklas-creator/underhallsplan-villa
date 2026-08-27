import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { analyzeTaskEmailPdf } from '@/lib/tasks/emailPdfAnalysis'
import {
  TASK_EMAIL_PDF_ANALYSIS_MODES,
  TASK_EMAIL_PDF_DOCUMENT_TYPE_HINTS,
  TASK_EMAIL_PDF_INSTRUCTION_MAX_LENGTH,
  TASK_EMAIL_PDF_MAX_BYTES,
  TASK_EMAIL_PDF_MAX_MEGABYTES,
  type TaskEmailPdfAnalysisMode,
  type TaskEmailPdfDocumentTypeHint,
} from '@/lib/tasks/emailPdfAnalysisContracts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MULTIPART_OVERHEAD_BYTES = 128 * 1024

function jsonError(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status })
}

function errorResponse(error: unknown) {
  const errorCode = error instanceof Error ? error.message : 'TASK_EMAIL_PDF_ANALYSIS_FAILED'
  const mapped: Record<string, [string, number]> = {
    UNAUTHORIZED: ['Inte inloggad.', 401],
    ORG_MEMBERSHIP_REQUIRED: ['Du saknar en aktiv organisation.', 403],
    PRODUCT_ACCESS_REQUIRED: ['Du saknar behörighet till Uppdrag.', 403],
    MODULE_ACCESS_REQUIRED: ['Du saknar behörighet till Uppdrag.', 403],
    TASK_EMAIL_PDF_REQUEST_INVALID: ['Begäran kunde inte läsas. Försök lägga till PDF-filen igen.', 400],
    TASK_EMAIL_PDF_FILE_REQUIRED: ['Lägg till ett dokument i PDF-format.', 400],
    TASK_EMAIL_PDF_MULTIPLE_FILES: ['Gizmo kan analysera en PDF-fil åt gången.', 400],
    TASK_EMAIL_PDF_EMPTY: ['PDF-filen är tom.', 400],
    TASK_EMAIL_PDF_TOO_LARGE: [
      `PDF-filen får vara högst ${TASK_EMAIL_PDF_MAX_MEGABYTES} MB.`,
      413,
    ],
    TASK_EMAIL_PDF_TYPE_INVALID: ['Filen måste vara en PDF med filändelsen .pdf.', 415],
    TASK_EMAIL_PDF_SIGNATURE_INVALID: ['Filen verkar inte vara en giltig PDF.', 415],
    TASK_EMAIL_PDF_INSTRUCTION_REQUIRED: ['Beskriv kort vad du vill att Gizmo ska göra.', 400],
    TASK_EMAIL_PDF_INSTRUCTION_TOO_LONG: [
      `Beskrivningen får vara högst ${TASK_EMAIL_PDF_INSTRUCTION_MAX_LENGTH} tecken.`,
      400,
    ],
    TASK_EMAIL_PDF_DOCUMENT_TYPE_INVALID: ['Välj en giltig dokumenttyp.', 400],
    TASK_EMAIL_PDF_ANALYSIS_MODE_INVALID: ['Välj en giltig analysnivå.', 400],
    'MISSING_ENV:OPENAI_API_KEY': ['Gizmo är inte konfigurerad på servern ännu.', 503],
    TASK_EMAIL_PDF_PROVIDER_TIMEOUT: ['Analysen tog för lång tid. Försök igen om en stund.', 504],
    TASK_EMAIL_PDF_RATE_LIMITED: [
      'Du har gjort många dokumentanalyser på kort tid. Vänta en stund och försök igen.',
      429,
    ],
    TASK_EMAIL_PDF_RATE_LIMIT_CHECK_FAILED: [
      'Analysgränsen kunde inte kontrolleras just nu. Försök igen om en stund.',
      503,
    ],
    TASK_EMAIL_PDF_PROVIDER_MISCONFIGURED: [
      'Gizmo är inte korrekt konfigurerad på servern ännu.',
      503,
    ],
    TASK_EMAIL_PDF_PROVIDER_RATE_LIMITED: [
      'Gizmo har nått sin tillfälliga analysgräns. Försök igen om en stund.',
      503,
    ],
    TASK_EMAIL_PDF_PROVIDER_UNAVAILABLE: ['Gizmo kunde inte analysera PDF-filen just nu.', 502],
    TASK_EMAIL_PDF_RESPONSE_INCOMPLETE: [
      'Gizmos förslag blev för långt. Be om en mer avgränsad analys och försök igen.',
      422,
    ],
    TASK_EMAIL_PDF_RESPONSE_REFUSED: [
      'Gizmo kunde inte ta fram ett förslag från det här underlaget.',
      422,
    ],
    TASK_EMAIL_PDF_RESPONSE_INVALID: ['Gizmo returnerade inget användbart förslag. Försök igen.', 502],
  }
  const response = mapped[errorCode]
  if (!response) {
    console.error('[tasks.email-pdf-analysis] Unexpected route error', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    return jsonError(
      'Dokumentet kunde inte analyseras.',
      500,
      'TASK_EMAIL_PDF_ANALYSIS_FAILED'
    )
  }
  return jsonError(response[0], response[1], errorCode)
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length'))
    if (
      Number.isFinite(contentLength)
      && contentLength > TASK_EMAIL_PDF_MAX_BYTES + MULTIPART_OVERHEAD_BYTES
    ) {
      throw new Error('TASK_EMAIL_PDF_TOO_LARGE')
    }

    const org = await requireOrgContext()
    await requireModuleAccess({
      productKey: 'dashboard',
      moduleKey: 'tasks',
      scopeType: 'organization',
      scopeId: org.orgId,
    })

    const form = await request.formData().catch(() => {
      throw new Error('TASK_EMAIL_PDF_REQUEST_INVALID')
    })
    const fileEntries = form.getAll('file')
    if (fileEntries.length === 0) throw new Error('TASK_EMAIL_PDF_FILE_REQUIRED')
    if (fileEntries.length !== 1) throw new Error('TASK_EMAIL_PDF_MULTIPLE_FILES')
    const file = fileEntries[0]
    if (!(file instanceof File)) throw new Error('TASK_EMAIL_PDF_FILE_REQUIRED')

    const instructionEntries = form.getAll('instruction')
    if (instructionEntries.length !== 1 || typeof instructionEntries[0] !== 'string') {
      throw new Error('TASK_EMAIL_PDF_INSTRUCTION_REQUIRED')
    }

    const documentTypeEntries = form.getAll('documentType')
    if (
      documentTypeEntries.length > 1
      || (
        documentTypeEntries.length === 1
        && (
          typeof documentTypeEntries[0] !== 'string'
          || !TASK_EMAIL_PDF_DOCUMENT_TYPE_HINTS.includes(
            documentTypeEntries[0] as TaskEmailPdfDocumentTypeHint
          )
        )
      )
    ) {
      throw new Error('TASK_EMAIL_PDF_DOCUMENT_TYPE_INVALID')
    }
    const documentType = (documentTypeEntries[0] ?? 'auto') as TaskEmailPdfDocumentTypeHint

    const analysisModeEntries = form.getAll('analysisMode')
    if (
      analysisModeEntries.length > 1
      || (
        analysisModeEntries.length === 1
        && (
          typeof analysisModeEntries[0] !== 'string'
          || !TASK_EMAIL_PDF_ANALYSIS_MODES.includes(
            analysisModeEntries[0] as TaskEmailPdfAnalysisMode
          )
        )
      )
    ) {
      throw new Error('TASK_EMAIL_PDF_ANALYSIS_MODE_INVALID')
    }
    const analysisMode = (analysisModeEntries[0] ?? 'explicit') as TaskEmailPdfAnalysisMode

    const analysis = await analyzeTaskEmailPdf({
      orgId: org.orgId,
      userId: org.userId,
      file,
      instruction: instructionEntries[0],
      documentType,
      analysisMode,
    })
    return NextResponse.json({ analysis })
  } catch (error) {
    return errorResponse(error)
  }
}
