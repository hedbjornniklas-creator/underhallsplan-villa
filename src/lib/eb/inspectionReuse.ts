import type {
  EbInspectionReport,
  EbInspectionSummary,
  EbInspectionVariant,
  EbInvitationParticipant,
  EbReportDraft,
} from './server'
// @ts-expect-error Native Node tests use explicit TypeScript extensions.
import { ebImageDisplayCaption, ebImageOriginLabel } from './inspectionReuseDisplay.ts'

/** Historical evidence, not a live relation or a new observation at this visit. */
export type EbInspectionReuseSource = {
  inspectionId: string
  inspectionDate: string | null
  variant: EbInspectionVariant
  sequenceNo: number
  noteId: string
  noteNumber: number | null
  imageId?: string
}

export function parseEbInspectionReuseSource(value: unknown): EbInspectionReuseSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (typeof source.inspectionId !== 'string' || !source.inspectionId ||
      typeof source.noteId !== 'string' || !source.noteId ||
      !['SLB', 'FB', 'EB', 'GB', 'KSB', 'SAB'].includes(String(source.variant)) ||
      typeof source.sequenceNo !== 'number' || !Number.isInteger(source.sequenceNo) || source.sequenceNo < 1) return null
  return {
    inspectionId: source.inspectionId,
    inspectionDate: typeof source.inspectionDate === 'string' ? source.inspectionDate : null,
    variant: source.variant as EbInspectionVariant,
    sequenceNo: source.sequenceNo,
    noteId: source.noteId,
    noteNumber: typeof source.noteNumber === 'number' ? source.noteNumber : null,
    ...(typeof source.imageId === 'string' ? { imageId: source.imageId } : {}),
  }
}

export function assertEbInspectionReuseEligible(input: {
  projectId: string
  targetVariant: EbInspectionVariant
  sourceInspectionId: string | null
  source: EbInspectionSummary | undefined
}) {
  const { source } = input
  if (!input.sourceInspectionId || !source || source.inspectionId !== input.sourceInspectionId ||
      source.projectId !== input.projectId) throw new Error('EB_REUSE_SOURCE_NOT_FOUND')
  if (input.targetVariant !== 'SLB' || source.variant !== 'SLB' ||
      source.approvalStatus !== 'not_approved' || !source.reportLockedAt) {
    throw new Error('EB_REUSE_SOURCE_NOT_ELIGIBLE')
  }
}

export function assertEbInspectionReuseReport(input: {
  orgId: string
  projectId: string
  source: EbInspectionSummary
  report: EbInspectionReport
}) {
  const { report, source } = input
  if (report.project?.id !== input.projectId || report.project.orgId !== input.orgId ||
      report.inspection?.inspectionId !== source.inspectionId ||
      report.inspection.projectId !== input.projectId || report.inspection.variant !== 'SLB' ||
      report.inspection.approvalStatus !== 'not_approved' ||
      Date.parse(report.inspection.reportLockedAt ?? '') !== Date.parse(source.reportLockedAt ?? '') ||
      !Array.isArray(report.notes) || !Array.isArray(report.images) || !Array.isArray(report.disciplines) ||
      !Array.isArray(report.participants) || !Array.isArray(report.checkpoints) ||
      !Array.isArray(report.inspectionDocuments) || !Array.isArray(report.reportDraft?.sections)) {
    throw new Error('EB_REUSE_SOURCE_SNAPSHOT_INVALID')
  }
}

type Row = Record<string, unknown>
type PrivateParticipant = EbInvitationParticipant & { orgNo?: string | null; partyKey?: string | null }
export type EbInspectionReusePlan = {
  inspectionId: string
  rows: Array<{ table: string; rows: Row[] }>
  fileCopies: Array<{ from: string; to: string }>
  detailPatch: Row
}

// Never carry a previous decision, attendance, invitation occurrence, signature,
// deadline, distribution or statement of successful inspection into a new visit.
const REUSABLE_TEXT_SECTIONS = new Set([
  'scope', 'conflict_of_interest', 'not_accessible', 'documentation_only',
  'inspection_cost_distribution', 'other_notes', 'marker_legend', 'defects_appendices', 'testing_documentation',
])

function nextLittera(littera: string | null, source: EbInspectionSummary, targetSequence: number) {
  const suffix = `${source.variant}${source.sequenceNo}`
  const target = `SLB${targetSequence}`
  if (!littera) return target
  return littera.endsWith(suffix) ? `${littera.slice(0, -suffix.length)}${target}` : littera
}

function fileExtension(path: string) {
  const extension = path.match(/\.[a-z0-9]{1,8}$/i)?.[0]
  return extension ?? '.jpg'
}

export function buildEbInspectionReusePlan(input: {
  orgId: string
  projectId: string
  userId: string
  targetInspectionId: string
  targetSequenceNo: number
  source: EbInspectionReport
  /** Locked authoring rows retain phone/billing data intentionally absent from public snapshots. */
  privateInspection: EbInspectionSummary
  participants: PrivateParticipant[]
  noteSources: Map<string, { sourceSystem: string | null; sourceRecordId: string | null }>
  includePreviousNotes: boolean
  now: string
  newId: () => string
}): EbInspectionReusePlan {
  const { source, targetInspectionId, newId } = input
  assertEbInspectionReuseReport({ orgId: input.orgId, projectId: input.projectId,
    source: input.privateInspection, report: source })
  const scope = { org_id: input.orgId, eb_project_id: input.projectId, inspection_id: targetInspectionId }
  const audit = { created_by: input.userId, updated_by: input.userId }
  const disciplineIds = new Map(source.disciplines.map(discipline => [discipline.id, newId()]))
  const noteIds = new Map(input.includePreviousNotes ? source.notes.map(note => [note.id, newId()]) : [])
  const disciplines = source.disciplines.map(discipline => ({
    ...scope, id: disciplineIds.get(discipline.id), discipline_key: discipline.key,
    label: discipline.label, littera: nextLittera(discipline.littera, source.inspection, input.targetSequenceNo),
    sort_order: discipline.sortOrder, is_active: discipline.isActive,
  }))
  const participants = input.participants.map(participant => ({
    ...scope, id: newId(), role_label: participant.roleLabel, company_name: participant.companyName,
    person_name: participant.personName, email: participant.email, phone: participant.phone,
    org_no: participant.orgNo ?? null, party_key: participant.partyKey ?? participant.representsPartyKey,
    receives_invitation: participant.receivesInvitation, attended: false,
    receives_report: participant.receivesReport, represents_party_key: participant.representsPartyKey,
    can_represent_party: participant.canRepresentParty, sort_order: participant.sortOrder,
  }))
  const sourceOfNote = (note: EbInspectionReport['notes'][number]): EbInspectionReuseSource => ({
    inspectionId: source.inspection.inspectionId, inspectionDate: source.inspection.date,
    variant: source.inspection.variant, sequenceNo: source.inspection.sequenceNo,
    noteId: note.id, noteNumber: note.noteNumber,
  })
  const notes = input.includePreviousNotes ? source.notes.map(note => {
    if (note.inspectionId !== source.inspection.inspectionId || note.projectId !== input.projectId) {
      throw new Error('EB_REUSE_SOURCE_SNAPSHOT_INVALID')
    }
    return {
      ...scope, ...audit, id: noteIds.get(note.id), source_note_id: note.id,
      discipline_id: note.disciplineId ? disciplineIds.get(note.disciplineId) ?? null : null,
      note_number: note.noteNumber, location: note.location, room: note.room, place_detail: note.placeDetail,
      marker_key: note.markerKey, status_key: 'open', note_text: note.noteText,
      responsible_party: note.responsibleParty, trade_group: note.tradeGroup,
      remediation_assignee_id: note.remediationAssigneeId, investigation_responsible_party: note.investigationResponsibleParty,
      investigation_responsible_note: note.investigationResponsibleNote,
      investigation_cost_party: note.investigationCostParty, investigation_due_date: null,
      deduction_amount: note.deductionAmount, sort_order: note.sortOrder, reuse_source: sourceOfNote(note),
      source_system: input.noteSources.get(note.id)?.sourceSystem ?? null,
      source_record_id: input.noteSources.get(note.id)?.sourceRecordId ?? null,
    }
  }) : []
  const noteById = new Map(source.notes.map(note => [note.id, note]))
  const imageIds = new Map<string, string>()
  const images: Row[] = []
  const imageLinks: Row[] = []
  const fileCopies: EbInspectionReusePlan['fileCopies'] = []
  const linkedPairs = new Set<string>()
  if (input.includePreviousNotes) for (const image of source.images) {
    const note = image.noteId ? noteById.get(image.noteId) : null
    if (!note || !noteIds.has(note.id)) continue
    const pair = `${image.id}:${note.id}`
    if (linkedPairs.has(pair)) continue
    linkedPairs.add(pair)
    let id = imageIds.get(image.id)
    if (!id) {
      if (image.inspectionId !== source.inspection.inspectionId ||
          !image.filePath.startsWith(`${source.inspection.inspectionId}/eb-notes/`) ||
          image.filePath.includes('..') || (image.thumbnailFilePath &&
          (!image.thumbnailFilePath.startsWith(`${source.inspection.inspectionId}/eb-notes/`) || image.thumbnailFilePath.includes('..')))) {
        throw new Error('EB_REUSE_SOURCE_SNAPSHOT_INVALID')
      }
      id = newId()
      imageIds.set(image.id, id)
      const path = `${targetInspectionId}/eb-notes/reused/${id}${fileExtension(image.filePath)}`
      const thumbnail = image.thumbnailFilePath ? `${targetInspectionId}/eb-notes/reused/thumb-${id}${fileExtension(image.thumbnailFilePath)}` : null
      fileCopies.push({ from: image.filePath, to: path })
      if (thumbnail && image.thumbnailFilePath) fileCopies.push({ from: image.thumbnailFilePath, to: thumbnail })
      const origin = parseEbInspectionReuseSource(image.reusedFrom) ?? { ...sourceOfNote(note), imageId: image.id }
      // Immutable reuse_source is the authoritative provenance. A single caption
      // fallback also keeps older PDF/image consumers explicit without stacking labels.
      const caption = ebImageDisplayCaption({ label: image.label, reusedFrom: origin })
      images.push({ id, inspection_id: targetInspectionId, eb_note_id: null, source_attachment_id: null,
        file_path: path, thumbnail_file_path: thumbnail, sort_order: image.sortOrder,
        label: [ebImageOriginLabel({ reusedFrom: origin }), caption].filter(Boolean).join('\n'),
        reuse_source: origin,
      })
    }
    imageLinks.push({ ...scope, id: newId(), eb_note_id: noteIds.get(note.id), inspection_image_id: id,
      sort_order: image.sortOrder })
  }
  const checkpoints = source.checkpoints.map(checkpoint => ({
    ...scope, ...audit, id: newId(), checkpoint_key: checkpoint.checkpointKey,
    template_key: checkpoint.templateKey, system_key: checkpoint.systemKey,
    group_key: checkpoint.groupKey, group_label: checkpoint.groupLabel, title: checkpoint.title,
    guidance: checkpoint.guidance, verification_method: checkpoint.verificationMethod, source_url: checkpoint.sourceUrl,
    photo_required: checkpoint.photoRequired, status: 'not_checked', comment: checkpoint.comment,
    note_id: checkpoint.noteId ? noteIds.get(checkpoint.noteId) ?? null : null, sort_order: checkpoint.sortOrder,
  }))
  const documents = source.inspectionDocuments.filter(document => document.id).map(document => ({
    id: newId(), inspection_id: targetInspectionId, document_type_id: document.documentTypeId,
    title: document.title, status: document.status, document_date: document.documentDate, note: document.note,
  }))
  const previous = (source.inspection.previousInspections ?? []).map(row => ({ ...row }))
  const historyKey = `inspection:${source.inspection.inspectionId}`
  if (!previous.some(row => row.key === historyKey)) previous.push({ key: historyKey,
    label: `${source.inspection.variantLabel} ${source.inspection.sequenceNo} – ej godkänd`,
    status: 'performed', date: source.inspection.date })
  const reportDraft: EbReportDraft = {
    ...source.reportDraft, sourceSnapshot: null, initializedAt: null, updatedAt: input.now,
    projectSourceRefreshBaseUpdatedAt: null,
    sections: source.reportDraft.sections.filter(section => REUSABLE_TEXT_SECTIONS.has(section.key) &&
      (input.includePreviousNotes || !['marker_legend', 'defects_appendices'].includes(section.key)))
      .map(section => ({ ...section,
        contentMode: section.contentMode ?? (['marker_legend', 'defects_appendices', 'testing_documentation'].includes(section.key) ? 'mixed' : 'editable'),
        status: section.isRelevant ? 'draft' : 'not_applicable', updatedAt: input.now })),
    noteHeadings: input.includePreviousNotes ? (source.reportDraft.noteHeadings ?? []).map(heading => ({ ...heading,
      id: newId(), beforeNoteId: heading.beforeNoteId ? noteIds.get(heading.beforeNoteId) ?? null : null,
      updatedAt: input.now,
    })) : [],
  }
  const invoice = input.privateInspection
  return {
    inspectionId: targetInspectionId, fileCopies,
    rows: [
      { table: 'eb_disciplines', rows: disciplines }, { table: 'eb_participants', rows: participants },
      { table: 'eb_notes', rows: notes }, { table: 'inspection_images', rows: images },
      { table: 'eb_note_image_links', rows: imageLinks }, { table: 'eb_inspection_checkpoints', rows: checkpoints },
      { table: 'inspection_documents', rows: documents },
    ],
    detailPatch: {
      inspector_appointed_by: source.inspection.inspectorAppointedBy,
      defect_numbering_explanation: source.inspection.defectNumberingExplanation,
      defect_no_error_parts_policy: source.inspection.defectNoErrorPartsPolicy,
      previous_inspections: previous,
      invitation_sent_at: null, invitation_sent_by: null, invitation_message_id: null,
      invitation_method: null, invitation_date: null, invitation_subject: null, invitation_body: null,
      approval_status: null, approval_note: null, requires_continued_final_inspection: null,
      continued_final_inspection_date: null, continued_final_inspection_time: null,
      warranty_period_years: null, warranty_end_date: null, warranty_scope: null,
      default_remedy_deadline: null, after_inspection_requested: null, after_inspection_requested_by: null,
      after_inspection_due_date: null, after_inspection_notice_in_report: false,
      report_distribution_date: null, report_locked_at: null, report_locked_by: null,
      invoice_recipient_matches_client: invoice.invoiceRecipientMatchesClient,
      invoice_name: invoice.invoiceName, invoice_org_no: invoice.invoiceOrgNo, invoice_reference: invoice.invoiceReference,
      invoice_email_matches_client: invoice.invoiceEmailMatchesClient, invoice_email: invoice.invoiceEmail,
      invoice_address_matches_client: invoice.invoiceAddressMatchesClient, invoice_address: invoice.invoiceAddress,
      invoice_postal_code: invoice.invoicePostalCode, invoice_city: invoice.invoiceCity,
      report_draft: reportDraft, report_draft_updated_at: input.now, report_draft_initialized_at: null,
      report_template_key: reportDraft.templateKey, report_template_title: reportDraft.templateTitle,
      report_template_version: reportDraft.templateVersion,
    },
  }
}

/** All I/O is explicit so failure rollback can be exercised without production access. */
export async function applyEbInspectionReusePlan(plan: EbInspectionReusePlan, io: {
  copyFile: (from: string, to: string) => Promise<void>
  insertRows: (table: string, rows: Row[]) => Promise<void>
  updateDetails: (patch: Row) => Promise<void>
  finishDraft: () => Promise<void>
}) {
  // Bound storage concurrency, and settle the entire batch before throwing so
  // an in-flight sibling cannot finish writing AFTER target cleanup has run.
  for (let index = 0; index < plan.fileCopies.length; index += 4) {
    const results = await Promise.allSettled(plan.fileCopies.slice(index, index + 4)
      .map(file => io.copyFile(file.from, file.to)))
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed) throw failed.reason
  }
  for (const group of plan.rows) if (group.rows.length) await io.insertRows(group.table, group.rows)
  await io.updateDetails(plan.detailPatch)
  await io.finishDraft()
}
