import 'server-only'

import { createHash } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export class AssignmentPdfArchiveError extends Error {}
const MAX_PDF_BYTES = 10 * 1024 * 1024

type ArchivedPdf = { pdf: Buffer; filename: string; acceptedAt: string; sha256: string }

function databaseFailure(code: string | undefined): never {
  if (code === '42P01' || code === 'PGRST205') {
    throw new AssignmentPdfArchiveError('PDF-arkivet är inte aktiverat ännu. Använd originalbilagan i kundens bekräftelsemejl.')
  }
  throw new Error('ASSIGNMENT_PDF_ARCHIVE_READ_FAILED')
}

export async function getArchivedAssignmentPdf(orgId: string, assignmentId: string): Promise<ArchivedPdf | null> {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('assignment_confirmation_pdfs')
    .select('filename,pdf_base64,pdf_sha256,byte_length,accepted_at')
    .eq('org_id', orgId).eq('assignment_id', assignmentId).maybeSingle()
  if (error) databaseFailure(error.code)
  if (!data) return null
  if (!Number.isInteger(data.byte_length) || data.byte_length < 5 || data.byte_length > MAX_PDF_BYTES ||
    typeof data.pdf_base64 !== 'string' || data.pdf_base64.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 ||
    !/^[a-z0-9._-]+\.pdf$/i.test(data.filename ?? '') ||
    !/^[a-f0-9]{64}$/.test(data.pdf_sha256 ?? '') || !Number.isFinite(Date.parse(data.accepted_at))) {
    throw new AssignmentPdfArchiveError('Originalfilen kunde inte verifieras. Ingen ersättningsfil har skapats.')
  }
  const pdf = Buffer.from(data.pdf_base64, 'base64')
  if (pdf.length !== data.byte_length || pdf.toString('base64') !== data.pdf_base64 || pdf.subarray(0, 5).toString() !== '%PDF-' ||
    createHash('sha256').update(pdf).digest('hex') !== data.pdf_sha256) {
    throw new AssignmentPdfArchiveError('Originalfilens kontrollsumma stämmer inte. Ingen ersättningsfil har skapats.')
  }
  return { pdf, filename: data.filename, acceptedAt: data.accepted_at, sha256: data.pdf_sha256 }
}

export async function archiveAcceptedAssignmentPdf(input: {
  orgId: string; assignmentId: string; acceptedAt: string; filename: string; pdf: Buffer
}): Promise<ArchivedPdf> {
  const existing = await getArchivedAssignmentPdf(input.orgId, input.assignmentId)
  if (existing) {
    if (Date.parse(existing.acceptedAt) !== Date.parse(input.acceptedAt)) throw new Error('ASSIGNMENT_PDF_ACCEPTANCE_MISMATCH')
    return existing
  }
  if (input.pdf.length < 5 || input.pdf.length > MAX_PDF_BYTES || input.pdf.subarray(0, 5).toString() !== '%PDF-' ||
    !/^[a-z0-9._-]+\.pdf$/i.test(input.filename)) throw new Error('ASSIGNMENT_PDF_INVALID')
  const admin = createSupabaseAdminClient()
  const { data: acceptance, error } = await admin.from('assignment_acceptances').select('id')
    .eq('org_id', input.orgId).eq('assignment_id', input.assignmentId).eq('accepted_at', input.acceptedAt).maybeSingle()
  if (error || !acceptance) throw new Error('ASSIGNMENT_PDF_ACCEPTANCE_MISSING')
  const { error: insertError } = await admin.from('assignment_confirmation_pdfs').upsert({
    org_id: input.orgId, assignment_id: input.assignmentId, acceptance_id: acceptance.id,
    accepted_at: input.acceptedAt, filename: input.filename, pdf_base64: input.pdf.toString('base64'),
  }, { onConflict: 'assignment_id', ignoreDuplicates: true })
  if (insertError) throw new Error('ASSIGNMENT_PDF_ARCHIVE_WRITE_FAILED')
  // A concurrent sender may have archived first. Both send that same original.
  const saved = await getArchivedAssignmentPdf(input.orgId, input.assignmentId)
  if (!saved || Date.parse(saved.acceptedAt) !== Date.parse(input.acceptedAt)) throw new Error('ASSIGNMENT_PDF_ARCHIVE_VERIFY_FAILED')
  return saved
}
