import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { buildReportPdfFileName } from '@/lib/report/reportFileName'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
const REPORT_PDF_SIGNED_URL_TTL_SECONDS = Math.max(
  30,
  Number(process.env.REPORT_PDF_SIGNED_URL_TTL_SECONDS ?? 120)
)

const decodeStoredPdf = (base64: string) => {
  try {
    const pdfBuffer = Buffer.from(base64, 'base64')
    return pdfBuffer.length > 0 ? pdfBuffer : null
  } catch {
    return null
  }
}

const normalizePdfStatus = (value: unknown): 'pending' | 'processing' | 'ready' | 'failed' => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'processing') return 'processing'
  if (normalized === 'ready') return 'ready'
  if (normalized === 'failed') return 'failed'
  return 'pending'
}

type LinkPdfRow = {
  id: string
  pdf_base64: string | null
  pdf_storage_bucket: string | null
  pdf_storage_path: string | null
  pdf_status: string | null
  pdf_error: string | null
  created_at: string
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

type InspectionForPdf = {
  id: string
  status: string | null
  assignment_number: string | null
  date: string | null
  inspection_family: string | null
  property_id: string | null
}

async function createSignedPdfUrl(
  admin: AdminClient,
  bucket: string,
  path: string,
  fileName: string
) {
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, REPORT_PDF_SIGNED_URL_TTL_SECONDS, {
      download: fileName,
    })
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

async function hasAssignmentAccess(admin: AdminClient, orgId: string, inspectionId: string) {
  const { data, error } = await admin
    .from('assignments')
    .select('id')
    .eq('org_id', orgId)
    .eq('inspection_id', inspectionId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte verifiera access till utlåtandet.')
  }

  return Boolean(data)
}

async function hasTechnicalInvestigationAccess(admin: AdminClient, orgId: string, inspectionId: string) {
  const { data, error } = await admin
    .from('technical_investigation_details')
    .select('inspection_id')
    .eq('org_id', orgId)
    .eq('inspection_id', inspectionId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte verifiera access till utlåtandet.')
  }

  return Boolean(data)
}

async function hasEbInspectionAccess(admin: AdminClient, orgId: string, inspectionId: string) {
  const { data, error } = await admin
    .from('eb_inspection_details')
    .select('inspection_id')
    .eq('org_id', orgId)
    .eq('inspection_id', inspectionId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte verifiera access till EB-utlåtandet.')
  }

  return Boolean(data)
}

async function isInspectionOwnedByUser(
  admin: AdminClient,
  propertyId: string | null,
  userId: string
) {
  if (!propertyId) return false

  const { data, error } = await admin
    .from('properties')
    .select('id')
    .eq('id', propertyId)
    .eq('owner', userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte verifiera access till utlåtandet.')
  }

  return Boolean(data)
}

export async function GET(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  const { inspectionId } = await context.params

  if (!inspectionId) {
    return new NextResponse('Missing inspectionId', { status: 400 })
  }

  try {
    const admin = createSupabaseAdminClient()
    const orgContext = await requireOrgContext()

    const { data: inspection, error: inspectionError } = await admin
      .from('inspections')
      .select('id,status,assignment_number,date,inspection_family,property_id')
      .eq('id', inspectionId)
      .maybeSingle()

    if (inspectionError) {
      return new NextResponse(inspectionError.message ?? 'Could not read inspection.', { status: 500 })
    }

    if (!inspection) {
      return new NextResponse('Inspection not found.', { status: 404 })
    }

    const inspectionRow = inspection as InspectionForPdf
    const hasAccess =
      (await hasAssignmentAccess(admin, orgContext.orgId, inspectionId)) ||
      (await hasTechnicalInvestigationAccess(admin, orgContext.orgId, inspectionId)) ||
      (await hasEbInspectionAccess(admin, orgContext.orgId, inspectionId)) ||
      (await isInspectionOwnedByUser(admin, inspectionRow.property_id, orgContext.userId))

    if (!hasAccess) {
      return new NextResponse('Du saknar behörighet att ladda ner detta utlåtande.', {
        status: 403,
      })
    }

    const fileName = buildReportPdfFileName({
      assignmentNumber: inspectionRow.assignment_number,
      inspectionDate: inspectionRow.date,
      inspectionFamily: inspectionRow.inspection_family,
    })

    const { data: linkRows, error: linkError } = await admin
      .from('inspection_report_links')
      .select('id,pdf_base64,pdf_storage_bucket,pdf_storage_path,pdf_status,pdf_error,created_at')
      .eq('inspection_id', inspectionId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(25)

    if (linkError) {
      console.error('[report-v2.pdf] failed to read stored report pdf', {
        inspectionId,
        error: linkError.message ?? linkError,
      })
      return new NextResponse('Could not load stored report PDF.', { status: 500 })
    }

    const rows = (Array.isArray(linkRows) ? linkRows : []) as LinkPdfRow[]
    const storageReadyRow = rows.find((row) => {
      const bucket = String(row.pdf_storage_bucket ?? '').trim()
      const path = String(row.pdf_storage_path ?? '').trim()
      return bucket.length > 0 && path.length > 0 && normalizePdfStatus(row.pdf_status) === 'ready'
    })

    if (storageReadyRow) {
      const bucket = String(storageReadyRow.pdf_storage_bucket ?? '').trim()
      const path = String(storageReadyRow.pdf_storage_path ?? '').trim()
      const signedUrl = await createSignedPdfUrl(admin, bucket, path, fileName)
      if (signedUrl) {
        return NextResponse.redirect(signedUrl, 302)
      }
      return new NextResponse('Kunde inte skapa säker nedladdningslänk för PDF.', { status: 500 })
    }

    const legacyReadyRow = rows.find((row) => String(row.pdf_base64 ?? '').trim().length > 0)
    if (legacyReadyRow) {
      const storedPdfBase64 = String(legacyReadyRow.pdf_base64 ?? '').trim()
      const storedPdfBuffer = decodeStoredPdf(storedPdfBase64)
      if (storedPdfBuffer) {
        const encodedFileName = encodeURIComponent(fileName)
        return new NextResponse(new Uint8Array(storedPdfBuffer), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodedFileName}`,
            'Cache-Control': 'private, no-store',
          },
        })
      }
    }

    const latestRow = rows[0] ?? null
    const pdfStatus = normalizePdfStatus(latestRow?.pdf_status)
    const pdfError = String(latestRow?.pdf_error ?? '').trim()
    if (pdfStatus === 'pending' || pdfStatus === 'processing') {
      return new NextResponse('PDF genereras fortfarande i bakgrunden. Försök igen om en stund.', {
        status: 409,
      })
    }
    if (pdfStatus === 'failed') {
      const suffix = pdfError ? ` (${pdfError})` : ''
      return new NextResponse(`PDF-generering misslyckades${suffix}.`, { status: 500 })
    }
    return new NextResponse('Ingen lagrad PDF hittades för denna besiktning.', { status: 404 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (message === 'UNAUTHORIZED') {
      return new NextResponse('Du behöver vara inloggad för att ladda ner utlåtandet.', {
        status: 401,
      })
    }
    if (message === 'ORG_MEMBERSHIP_REQUIRED') {
      return new NextResponse('Du saknar organisationstillhörighet.', { status: 403 })
    }
    return new NextResponse(message, { status: 500 })
  }
}
