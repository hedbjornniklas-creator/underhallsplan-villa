import 'server-only'

import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import type { StandardTextId } from '@/content/standardtexts/registry'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { resolveInspectorCertificationSummary } from '@/lib/certifications/profileResolver'
import { resolveEbAgreementVocabulary } from '@/lib/eb/vocabulary'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export type EbInspectionVariant = 'SLB' | 'FB' | 'EB' | 'GB' | 'KSB' | 'SAB'
export type EbInspectorAppointedBy = 'client' | 'parties_jointly' | 'contractor'
export type EbApprovalStatus = 'approved' | 'not_approved' | 'partly_approved'
export type EbPartyKey = 'client' | 'contractor' | 'other'
export type EbAfterInspectionRequestedBy = 'client' | 'contractor'
export type EbPreviousInspectionStatus = 'performed' | 'not_performed' | 'not_applicable'
export type EbInspectionDocumentStatus = 'present' | 'missing' | 'na'
export type EbProjectAgreementItemKind = 'change_order' | 'other'
export type EbDefectNoErrorPartsPolicy = 'not_listed' | 'listed_with_dash'
export type EbReportPdfStatus = 'pending' | 'processing' | 'ready' | 'failed'
export type EbProjectTemplateKey = 'drainage_foundation'
export type EbDrainageSystem = 'generic' | 'isodran' | 'pordran' | 'other'
export type EbDrainageInspectionStage = 'before_backfill' | 'after_backfill' | 'partial' | 'final'
export type EbInspectionCheckpointStatus =
  | 'not_checked'
  | 'ok'
  | 'deviation'
  | 'not_applicable'
  | 'not_accessible'
  | 'not_verifiable'

export type EbPreviousInspectionItem = {
  key: string
  label: string
  status: EbPreviousInspectionStatus | null
  date: string | null
}

export type EbInspectionDocument = {
  id: string | null
  documentTypeId: string
  code: string
  title: string
  category: string | null
  resultLabel: string | null
  resultUnit: string | null
  status: EbInspectionDocumentStatus
  documentDate: string | null
  note: string | null
  sortOrder: number
}

export type EbProjectAgreementItem = {
  id: string
  kind: EbProjectAgreementItemKind
  title: string
  documentDate: string | null
  note: string | null
  includeInReport: boolean
  sortOrder: number
}

export type EbInspectionSummary = {
  inspectionId: string
  projectId: string
  variant: EbInspectionVariant
  variantLabel: string
  sequenceNo: number
  parentInspectionId: string | null
  status: string | null
  date: string | null
  inspectionTime: string | null
  meetingPlace: string | null
  startMeetingTime: string | null
  finalMeetingTime: string | null
  clientName: string | null
  assignmentNumber: string | null
  invitationSentAt: string | null
  inspectorAppointedBy: EbInspectorAppointedBy | null
  invitationMethod: string | null
  invitationDate: string | null
  approvalStatus: EbApprovalStatus | null
  approvalNote: string | null
  requiresContinuedFinalInspection: boolean | null
  continuedFinalInspectionDate: string | null
  continuedFinalInspectionTime: string | null
  warrantyPeriodYears: number | null
  warrantyEndDate: string | null
  warrantyScope: string | null
  defaultRemedyDeadline: string | null
  afterInspectionRequested: boolean | null
  afterInspectionRequestedBy: EbAfterInspectionRequestedBy | null
  afterInspectionDueDate: string | null
  afterInspectionNoticeInReport: boolean
  inspectionCostDistribution: string | null
  reportDistributionDate: string | null
  previousInspections: EbPreviousInspectionItem[]
  defectNumberingExplanation: string | null
  defectNoErrorPartsPolicy: EbDefectNoErrorPartsPolicy | null
  reportLockedAt: string | null
  reportLockedBy: string | null
  reportPdfStatus: EbReportPdfStatus | null
  reportPdfError: string | null
  reportPdfDownloadUrl: string | null
  reportPdfCreatedAt: string | null
  createdAt: string | null
}

export type EbProjectListItem = {
  id: string
  orgId: string
  ownerProfileId: string
  propertyId: string | null
  projectTemplateKey: EbProjectTemplateKey | null
  drainageSystem: EbDrainageSystem | null
  drainageInspectionStage: EbDrainageInspectionStage | null
  drainageGuidanceVersion: string | null
  title: string
  contractName: string | null
  objectDescription: string | null
  propertyDesignation: string | null
  brfApartmentNumber: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  municipality: string | null
  standardAgreement: string | null
  contractForm: string | null
  procurementForm: string | null
  contractDate: string | null
  notePrefix: string
  clientName: string | null
  clientOrgNo: string | null
  clientAddress: string | null
  clientPostalCode: string | null
  clientCity: string | null
  contractorName: string | null
  contractorOrgNo: string | null
  contractorAddress: string | null
  contractorPostalCode: string | null
  contractorCity: string | null
  agreementItems: EbProjectAgreementItem[]
  status: string
  createdAt: string | null
  updatedAt: string | null
  inspections: EbInspectionSummary[]
}

export type EbDiscipline = {
  id: string
  key: string
  label: string
  littera: string | null
  sortOrder: number
  isActive: boolean
}

export type EbNoteMarker = {
  key: string
  label: string
  colorToken: string
  sortOrder: number
}

export type EbNoteStatus = {
  key: string
  label: string
  colorToken: string
  sortOrder: number
  isDefault: boolean
}

export type EbNote = {
  id: string
  projectId: string
  inspectionId: string
  disciplineId: string | null
  noteNumber: number | null
  location: string | null
  room: string | null
  placeDetail: string | null
  markerKey: string | null
  statusKey: string
  noteText: string
  responsibleParty: string | null
  tradeGroup: string | null
  investigationResponsibleParty: EbPartyKey | null
  investigationResponsibleNote: string | null
  investigationCostParty: Exclude<EbPartyKey, 'other'> | null
  investigationDueDate: string | null
  deductionAmount: string | null
  sortOrder: number
  createdAt: string | null
  updatedAt: string | null
  disciplineLabel: string | null
  disciplineLittera: string | null
  markerLabel: string | null
  statusLabel: string | null
}

export type EbNoteImage = {
  id: string
  noteId: string | null
  inspectionId: string
  filePath: string
  label: string | null
  sortOrder: number
  publicUrl: string
  createdAt: string | null
}

export type EbNoteSuggestion = {
  id: string
  phrase: string
  normalizedPrefix: string
  useCount: number
  lastUsedAt: string | null
}

export type EbAttachmentType = 'document' | 'image'

export type EbProjectAttachment = {
  id: string
  projectId: string
  attachmentType: EbAttachmentType
  title: string | null
  storageBucket: string
  filePath: string
  fileName: string | null
  contentType: string | null
  fileSizeBytes: number | null
  includeInReport: boolean
  littera: string | null
  documentDate: string | null
  documentNumber: string | null
  documentNote: string | null
  signedUrl: string | null
  uploadedBy: string | null
  createdAt: string | null
}

export type EbInspectionCheckpoint = {
  id: string
  projectId: string
  inspectionId: string
  checkpointKey: string
  templateKey: string
  systemKey: EbDrainageSystem
  groupKey: string
  groupLabel: string
  title: string
  guidance: string | null
  verificationMethod: string | null
  sourceUrl: string | null
  photoRequired: boolean
  status: EbInspectionCheckpointStatus
  comment: string | null
  noteId: string | null
  sortOrder: number
  updatedAt: string | null
}

export type EbInspectionRound = {
  project: EbProjectListItem
  inspection: EbInspectionSummary
  disciplines: EbDiscipline[]
  markers: EbNoteMarker[]
  statuses: EbNoteStatus[]
  notes: EbNote[]
  images: EbNoteImage[]
  suggestions: EbNoteSuggestion[]
  checkpoints: EbInspectionCheckpoint[]
}

export type EbReportSectionStatus = 'draft' | 'complete' | 'missing' | 'not_applicable'

export type EbReportSectionSource =
  | 'project'
  | 'inspection'
  | 'participants'
  | 'notes'
  | 'checkpoints'
  | 'standard_text'
  | 'manual'

export type EbReportDraftSection = {
  key: string
  title: string
  sbrPoint: string | null
  source: EbReportSectionSource
  status: EbReportSectionStatus
  isRelevant: boolean
  text: string
  updatedAt: string | null
}

export type EbReportDraft = {
  sections: EbReportDraftSection[]
  updatedAt: string | null
}

export type EbInspectionReport = EbInspectionRound & {
  participants: EbInvitationParticipant[]
  inspectionDocuments: EbInspectionDocument[]
  reportDraft: EbReportDraft
  branding: {
    inspectorLogoUrl: string | null
    inspectorAvatarUrl: string | null
    besiktAppLogoUrl: string
  }
}

export type EbInvitationParticipant = {
  id: string | null
  roleLabel: string | null
  companyName: string | null
  personName: string | null
  email: string | null
  phone: string | null
  receivesInvitation: boolean
  attended: boolean
  receivesReport: boolean
  representsPartyKey: EbPartyKey | null
  canRepresentParty: boolean
  sortOrder: number
}

export type EbInvitationContext = {
  project: EbProjectListItem
  inspection: EbInspectionSummary
  participants: EbInvitationParticipant[]
  subject: string
  body: string
}

export type EbInvitationParticipantInput = Omit<EbInvitationParticipant, 'id' | 'sortOrder'> & {
  id?: string | null
  sortOrder?: number | null
}

export type SendEbInvitationInput = {
  orgId: string
  requestedByUserId: string
  projectId: string
  inspectionId: string
  subject: string
  body: string
  participants: EbInvitationParticipantInput[]
}

export type SaveEbInvitationDraftInput = Omit<SendEbInvitationInput, 'subject' | 'body'> & {
  subject?: string | null
  body?: string | null
}

export type SendEbInvitationResult = {
  sentCount: number
  project: EbProjectListItem
}

export type SaveEbReportDraftInput = {
  orgId: string
  requestedByUserId: string
  projectId: string
  inspectionId: string
  sections: EbReportDraftSection[]
}

export type SaveEbInspectionDocumentsInput = {
  orgId: string
  requestedByUserId: string
  projectId: string
  inspectionId: string
  documents: EbInspectionDocument[]
}

export type SaveEbInspectionCheckpointsInput = {
  orgId: string
  requestedByUserId: string
  projectId: string
  inspectionId: string
  checkpoints: Array<{
    id?: string | null
    checkpointKey?: string | null
    status?: EbInspectionCheckpointStatus | null
    comment?: string | null
    noteId?: string | null
  }>
}

type EbProjectRow = {
  id: string
  org_id: string
  owner_profile_id: string
  property_id: string | null
  project_template_key?: string | null
  drainage_system?: string | null
  drainage_inspection_stage?: string | null
  drainage_guidance_version?: string | null
  title: string
  contract_name: string | null
  object_description: string | null
  property_designation: string | null
  brf_apartment_number?: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  municipality: string | null
  standard_agreement: string | null
  contract_form: string | null
  procurement_form: string | null
  contract_date: string | null
  note_prefix: string | null
  client_name: string | null
  client_org_no: string | null
  client_address: string | null
  client_postal_code: string | null
  client_city: string | null
  contractor_name: string | null
  contractor_org_no: string | null
  contractor_address: string | null
  contractor_postal_code: string | null
  contractor_city: string | null
  agreement_items?: unknown
  status: string | null
  created_at: string | null
  updated_at: string | null
}

type EbInspectionDetailRow = {
  inspection_id: string
  org_id: string
  eb_project_id: string
  parent_inspection_id: string | null
  inspection_variant: string | null
  sequence_no: number | null
  meeting_place: string | null
  start_meeting_time: string | null
  final_meeting_time: string | null
  invitation_sent_at: string | null
  inspector_appointed_by: string | null
  invitation_method: string | null
  invitation_date: string | null
  approval_status: string | null
  approval_note: string | null
  requires_continued_final_inspection: boolean | null
  continued_final_inspection_date?: string | null
  continued_final_inspection_time?: string | null
  warranty_period_years: number | null
  warranty_end_date: string | null
  warranty_scope?: string | null
  default_remedy_deadline: string | null
  after_inspection_requested: boolean | null
  after_inspection_requested_by?: string | null
  after_inspection_due_date: string | null
  after_inspection_notice_in_report: boolean | null
  inspection_cost_distribution?: string | null
  report_distribution_date: string | null
  previous_inspections?: unknown
  defect_numbering_explanation?: string | null
  defect_no_error_parts_policy?: string | null
  invitation_subject?: string | null
  invitation_body?: string | null
  report_locked_at: string | null
  report_locked_by?: string | null
  report_draft?: unknown
  report_draft_updated_at?: string | null
  created_at: string | null
}

type InspectionRow = {
  id: string
  property_id: string
  status: string | null
  date: string | null
  inspection_time: string | null
  client_name: string | null
  assignment_number: string | null
  created_at: string | null
}

type EbReportLinkRow = {
  inspection_id: string
  created_at: string | null
  pdf_status: string | null
  pdf_error: string | null
  pdf_storage_bucket: string | null
  pdf_storage_path: string | null
  pdf_base64: string | null
}

type EbDisciplineSettingRow = {
  key: string
  label: string
  littera_prefix: string | null
  sort_order: number | null
}

type EbInvitationDetailRow = {
  inspection_id: string
  eb_project_id: string
  inspection_variant: string | null
  meeting_place: string | null
  start_meeting_time: string | null
  final_meeting_time: string | null
  invitation_sent_at: string | null
  invitation_method: string | null
  invitation_date: string | null
  invitation_subject: string | null
  invitation_body: string | null
}

type EbParticipantRow = {
  id: string
  role_label: string | null
  company_name: string | null
  person_name: string | null
  email: string | null
  phone: string | null
  receives_invitation: boolean | null
  attended: boolean | null
  receives_report: boolean | null
  represents_party_key: string | null
  can_represent_party: boolean | null
  sort_order: number | null
}

type EbDisciplineRow = {
  id: string
  discipline_key: string
  label: string
  littera: string | null
  sort_order: number | null
  is_active: boolean | null
}

type EbNoteRow = {
  id: string
  eb_project_id: string
  inspection_id: string
  discipline_id: string | null
  note_number: number | null
  location: string | null
  room: string | null
  place_detail: string | null
  marker_key: string | null
  status_key: string | null
  note_text: string | null
  responsible_party: string | null
  trade_group: string | null
  investigation_responsible_party: string | null
  investigation_responsible_note: string | null
  investigation_cost_party: string | null
  investigation_due_date: string | null
  deduction_amount: string | null
  sort_order: number | null
  created_at: string | null
  updated_at: string | null
}

type EbMarkerRow = {
  key: string
  label: string
  color_token: string | null
  sort_order: number | null
}

type EbStatusRow = EbMarkerRow & {
  is_default: boolean | null
}

type EbNoteSuggestionRow = {
  id: string
  phrase: string
  normalized_prefix: string
  use_count: number | null
  last_used_at: string | null
}

type EbNoteImageRow = {
  id: string
  inspection_id: string
  eb_note_id: string | null
  file_path: string
  label: string | null
  sort_order: number | null
  created_at: string | null
}

type EbProjectAttachmentRow = {
  id: string
  eb_project_id: string
  attachment_type: string | null
  title: string | null
  storage_bucket: string | null
  file_path: string
  file_name: string | null
  content_type: string | null
  file_size_bytes: number | null
  include_in_report: boolean | null
  littera: string | null
  document_date: string | null
  document_number: string | null
  document_note: string | null
  uploaded_by: string | null
  created_at: string | null
}

type EbTemplateCheckpointRow = {
  id: string
  template_key: string
  key: string
  system_key: string | null
  group_key: string
  group_label: string
  title: string
  guidance: string | null
  verification_method: string | null
  source_url: string | null
  photo_required: boolean | null
  sort_order: number | null
}

type EbInspectionCheckpointRow = {
  id: string
  eb_project_id: string
  inspection_id: string
  checkpoint_key: string
  template_key: string
  system_key: string | null
  group_key: string
  group_label: string
  title: string
  guidance: string | null
  verification_method: string | null
  source_url: string | null
  photo_required: boolean | null
  status: string | null
  comment: string | null
  note_id: string | null
  sort_order: number | null
  updated_at: string | null
}

type DocumentTypeRow = {
  id: string
  code: string
  label: string
  category: string | null
  applicable_modules: string | null
  description: string | null
  result_label: string | null
  result_unit: string | null
  is_active: boolean | null
}

type InspectionDocumentRow = {
  id: string
  inspection_id: string
  document_type_id: string | null
  title: string
  status: string | null
  document_date: string | null
  note: string | null
  created_at: string | null
}

type EbAutoSourceNoteRow = {
  id: string
  source_record_id: string | null
  note_text: string | null
}

type ProfileContactRow = {
  id: string
  full_name: string | null
  email: string | null
  certification_number: string | null
  avatar_path: string | null
  logo_path: string | null
  logo_url: string | null
}

export type CreateEbProjectInput = {
  orgId: string
  requestedByUserId: string
  title: string
  projectTemplateKey?: EbProjectTemplateKey | null
  drainageSystem?: EbDrainageSystem | null
  drainageInspectionStage?: EbDrainageInspectionStage | null
  drainageGuidanceVersion?: string | null
  contractName?: string | null
  objectDescription?: string | null
  propertyDesignation?: string | null
  brfApartmentNumber?: string | null
  address?: string | null
  postalCode?: string | null
  city?: string | null
  municipality?: string | null
  standardAgreement?: string | null
  contractForm?: string | null
  procurementForm?: string | null
  contractDate?: string | null
  clientName?: string | null
  clientOrgNo?: string | null
  clientAddress?: string | null
  clientPostalCode?: string | null
  clientCity?: string | null
  contractorName?: string | null
  contractorOrgNo?: string | null
  contractorAddress?: string | null
  contractorPostalCode?: string | null
  contractorCity?: string | null
  agreementItems?: EbProjectAgreementItem[] | null
  inspectionDate?: string | null
  inspectionTime?: string | null
  meetingPlace?: string | null
  startMeetingTime?: string | null
  finalMeetingTime?: string | null
}

export type UpdateEbProjectInput = Omit<
  CreateEbProjectInput,
  | 'requestedByUserId'
  | 'inspectionDate'
  | 'inspectionTime'
  | 'meetingPlace'
  | 'startMeetingTime'
  | 'finalMeetingTime'
> & {
  projectId: string
  notePrefix?: string | null
}

export type CreateEbInspectionInput = {
  orgId: string
  requestedByUserId: string
  projectId: string
  variant: EbInspectionVariant
  parentInspectionId?: string | null
  inspectionDate?: string | null
  inspectionTime?: string | null
  meetingPlace?: string | null
  startMeetingTime?: string | null
  finalMeetingTime?: string | null
}

export type UpdateEbInspectionInput = {
  orgId: string
  requestedByUserId: string
  projectId: string
  inspectionId: string
  inspectionDate?: string | null
  inspectionTime?: string | null
  meetingPlace?: string | null
  startMeetingTime?: string | null
  finalMeetingTime?: string | null
  inspectorAppointedBy?: EbInspectorAppointedBy | null
  invitationMethod?: string | null
  invitationDate?: string | null
  approvalStatus?: EbApprovalStatus | null
  approvalNote?: string | null
  requiresContinuedFinalInspection?: boolean | null
  continuedFinalInspectionDate?: string | null
  continuedFinalInspectionTime?: string | null
  warrantyPeriodYears?: number | null
  warrantyEndDate?: string | null
  warrantyScope?: string | null
  defaultRemedyDeadline?: string | null
  afterInspectionRequested?: boolean | null
  afterInspectionRequestedBy?: EbAfterInspectionRequestedBy | null
  afterInspectionDueDate?: string | null
  afterInspectionNoticeInReport?: boolean
  inspectionCostDistribution?: string | null
  reportDistributionDate?: string | null
  previousInspections?: EbPreviousInspectionItem[] | null
  defectNumberingExplanation?: string | null
  defectNoErrorPartsPolicy?: EbDefectNoErrorPartsPolicy | null
}

export type SaveEbNoteInput = {
  orgId: string
  requestedByUserId: string
  projectId: string
  inspectionId: string
  noteId?: string | null
  disciplineId?: string | null
  location?: string | null
  room?: string | null
  placeDetail?: string | null
  markerKey?: string | null
  statusKey?: string | null
  noteText?: string | null
  responsibleParty?: string | null
  tradeGroup?: string | null
  investigationResponsibleParty?: EbPartyKey | null
  investigationResponsibleNote?: string | null
  investigationCostParty?: Exclude<EbPartyKey, 'other'> | null
  investigationDueDate?: string | null
  deductionAmount?: string | null
}

export type DeleteEbNoteInput = {
  orgId: string
  projectId: string
  inspectionId: string
  noteId: string
}

export type ReorderEbNoteInput = DeleteEbNoteInput & {
  direction: 'up' | 'down'
}

export type ReorderEbNotesInput = Omit<DeleteEbNoteInput, 'noteId'> & {
  orderedNoteIds: string[]
}

const VARIANT_LABELS: Record<EbInspectionVariant, string> = {
  SLB: 'Slutbesiktning',
  FB: 'Förbesiktning',
  EB: 'Efterbesiktning',
  GB: 'Garantibesiktning',
  KSB: 'Kompletterande slutbesiktning',
  SAB: 'Särskild besiktning',
}

const EB_VARIANTS = Object.keys(VARIANT_LABELS) as EbInspectionVariant[]
const INSPECTOR_APPOINTED_BY_VALUES = ['client', 'parties_jointly', 'contractor'] as const
const APPROVAL_STATUS_VALUES = ['approved', 'not_approved', 'partly_approved'] as const
const PARTY_KEY_VALUES = ['client', 'contractor', 'other'] as const
const AFTER_INSPECTION_REQUESTED_BY_VALUES = ['client', 'contractor'] as const
const PREVIOUS_INSPECTION_STATUS_VALUES = ['performed', 'not_performed', 'not_applicable'] as const
const DEFECT_NO_ERROR_PARTS_POLICY_VALUES = ['not_listed', 'listed_with_dash'] as const
const PROJECT_TEMPLATE_KEY_VALUES = ['drainage_foundation'] as const
const DRAINAGE_SYSTEM_VALUES = ['generic', 'isodran', 'pordran', 'other'] as const
const DRAINAGE_INSPECTION_STAGE_VALUES = ['before_backfill', 'after_backfill', 'partial', 'final'] as const
const CHECKPOINT_STATUS_VALUES = [
  'not_checked',
  'ok',
  'deviation',
  'not_applicable',
  'not_accessible',
  'not_verifiable',
] as const
const EB_MISSING_DOCUMENT_NOTE_SOURCE = 'eb_missing_document'
const INSPECTION_DOCUMENT_STATUS_VALUES = ['present', 'missing', 'na'] as const
const EB_DOCUMENT_TYPE_CODE_ORDER = [
  'EB_DOC_TATSKIKT_YTTERTAK_TERRASSBJALKLAG',
  'EB_DOC_TATSKIKT_VATRUM',
  'EB_DOC_GOLVLUTNINGAR_VATRUM',
  'EB_DOC_KVALITETSDOKUMENT_BBV',
  'EB_DOC_VATRUMSINTYG_GVK',
  'EB_DOC_ISOLATIONSPROVNING_EL',
  'EB_DOC_JORDFELSBRYTARTEST',
  'EB_DOC_SKYDDSLEDARE_KONTINUITET',
  'EB_DOC_SAKER_VATTEN',
  'EB_DOC_PROVTRYCKNING_ROR',
  'EB_DOC_INJUSTERING_VARME',
  'EB_DOC_INJUSTERING_VENTILATION_OVK',
  'EB_DOC_UTVANDIG_PUTS',
  'EB_DOC_GLASSAKERHET',
  'EB_DOC_IMKANALER_SAKKUNNIG',
  'EB_DOC_RELATIONSHANDLINGAR',
  'EB_DOC_DRIFT_SKOTSELINSTRUKTION',
  'EB_DOC_DRAINAGE_CONTRACT',
  'EB_DOC_DRAINAGE_DRAWING',
  'EB_DOC_DRAINAGE_STORMWATER_DRAWING',
  'EB_DOC_DRAINAGE_PHOTO_DOCUMENTATION',
  'EB_DOC_DRAINAGE_SELF_CHECK',
  'EB_DOC_DRAINAGE_RELATION_DRAWING',
  'EB_DOC_DRAINAGE_ISOCERT',
] as const
const EB_DOCUMENT_TYPE_ORDER: ReadonlyMap<string, number> = new Map(
  EB_DOCUMENT_TYPE_CODE_ORDER.map((code, index) => [code, (index + 1) * 10])
)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const EB_PROJECT_ATTACHMENTS_BUCKET = 'eb-project-attachments'
export const EB_NOTE_IMAGE_BUCKET = 'inspection-images'
const PROFILE_MEDIA_BUCKET = 'property-media'
const BESIKTAPP_REPORT_LOGO_SRC = '/report-assets/BesiktApp.png'
const EB_ATTACHMENT_SIGNED_URL_SECONDS = 60 * 60
export const DEFAULT_EB_DEFECT_NUMBERING_EXPLANATION =
  'Fönster, dörrar, väggar etc numreras från vänster till höger. Vägg 1 = vägg till vänster om entrévägg. Vägg 2 = nästa vägg till höger om vägg 1 osv.'

function normalizeText(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolvePublicMediaUrl(path: string | null | undefined) {
  const trimmed = normalizeText(path)
  if (!trimmed) return null
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (trimmed.startsWith('/storage/')) return base ? `${base}${trimmed}` : trimmed
  if (trimmed.startsWith('storage/')) return base ? `${base}/${trimmed}` : `/${trimmed}`
  if (trimmed.startsWith('/')) return trimmed

  return createSupabaseAdminClient().storage.from(PROFILE_MEDIA_BUCKET).getPublicUrl(trimmed).data.publicUrl
}

function resolveProfileLogoUrl(profile: ProfileContactRow | null | undefined) {
  return resolvePublicMediaUrl(profile?.logo_path ?? profile?.logo_url)
}

function resolveProfileAvatarUrl(profile: ProfileContactRow | null | undefined) {
  return resolvePublicMediaUrl(profile?.avatar_path)
}

function normalizeDate(value: string | null | undefined) {
  const trimmed = normalizeText(value)
  if (!trimmed) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

function normalizeTime(value: string | null | undefined) {
  const trimmed = normalizeText(value)
  if (!trimmed) return null
  return /^\d{2}:\d{2}(:\d{2})?$/.test(trimmed) ? trimmed : null
}

function normalizeInspectorAppointedBy(value: string | null | undefined): EbInspectorAppointedBy | null {
  const normalized = normalizeText(value)
  return INSPECTOR_APPOINTED_BY_VALUES.includes(normalized as EbInspectorAppointedBy)
    ? (normalized as EbInspectorAppointedBy)
    : null
}

function normalizeApprovalStatus(value: string | null | undefined): EbApprovalStatus | null {
  const normalized = normalizeText(value)
  return APPROVAL_STATUS_VALUES.includes(normalized as EbApprovalStatus)
    ? (normalized as EbApprovalStatus)
    : null
}

function normalizeAfterInspectionRequestedBy(
  value: string | null | undefined
): EbAfterInspectionRequestedBy | null {
  const normalized = normalizeText(value)
  return AFTER_INSPECTION_REQUESTED_BY_VALUES.includes(normalized as EbAfterInspectionRequestedBy)
    ? (normalized as EbAfterInspectionRequestedBy)
    : null
}

function normalizeDefectNoErrorPartsPolicy(
  value: string | null | undefined
): EbDefectNoErrorPartsPolicy | null {
  const normalized = normalizeText(value)
  return DEFECT_NO_ERROR_PARTS_POLICY_VALUES.includes(normalized as EbDefectNoErrorPartsPolicy)
    ? (normalized as EbDefectNoErrorPartsPolicy)
    : null
}

function normalizeProjectTemplateKey(value: string | null | undefined): EbProjectTemplateKey | null {
  const normalized = normalizeText(value)
  return PROJECT_TEMPLATE_KEY_VALUES.includes(normalized as EbProjectTemplateKey)
    ? (normalized as EbProjectTemplateKey)
    : null
}

function normalizeDrainageSystem(value: string | null | undefined): EbDrainageSystem | null {
  const normalized = normalizeText(value)
  return DRAINAGE_SYSTEM_VALUES.includes(normalized as EbDrainageSystem)
    ? (normalized as EbDrainageSystem)
    : null
}

function normalizeDrainageInspectionStage(
  value: string | null | undefined
): EbDrainageInspectionStage | null {
  const normalized = normalizeText(value)
  return DRAINAGE_INSPECTION_STAGE_VALUES.includes(normalized as EbDrainageInspectionStage)
    ? (normalized as EbDrainageInspectionStage)
    : null
}

function normalizeCheckpointStatus(value: string | null | undefined): EbInspectionCheckpointStatus {
  const normalized = normalizeText(value)
  return CHECKPOINT_STATUS_VALUES.includes(normalized as EbInspectionCheckpointStatus)
    ? (normalized as EbInspectionCheckpointStatus)
    : 'not_checked'
}

function normalizePartyKey(value: string | null | undefined): EbPartyKey | null {
  const normalized = normalizeText(value)
  return PARTY_KEY_VALUES.includes(normalized as EbPartyKey) ? (normalized as EbPartyKey) : null
}

function normalizePreviousInspectionStatus(
  value: string | null | undefined
): EbPreviousInspectionStatus | null {
  const normalized = normalizeText(value)
  return PREVIOUS_INSPECTION_STATUS_VALUES.includes(normalized as EbPreviousInspectionStatus)
    ? (normalized as EbPreviousInspectionStatus)
    : null
}

function normalizeInspectionDocumentStatus(
  value: string | null | undefined
): EbInspectionDocumentStatus {
  const normalized = normalizeText(value)
  return INSPECTION_DOCUMENT_STATUS_VALUES.includes(normalized as EbInspectionDocumentStatus)
    ? (normalized as EbInspectionDocumentStatus)
    : 'na'
}

function normalizeAgreementItemKind(value: string | null | undefined): EbProjectAgreementItemKind {
  return value === 'change_order' || value === 'other' ? value : 'other'
}

function normalizePreviousInspections(value: unknown): EbPreviousInspectionItem[] {
  const rows = Array.isArray(value) ? value : []

  return rows
    .map((row, index) => {
      if (!row || typeof row !== 'object') return null
      const record = row as Record<string, unknown>
      const key = normalizeText(typeof record.key === 'string' ? record.key : null) ?? `custom_${index + 1}`
      const label = normalizeText(typeof record.label === 'string' ? record.label : null)
      const status = normalizePreviousInspectionStatus(typeof record.status === 'string' ? record.status : null)
      const date = normalizeDate(typeof record.date === 'string' ? record.date : null)

      if (!label && !status && !date) return null

      return {
        key,
        label: label ?? '',
        status,
        date,
      }
    })
    .filter((row): row is EbPreviousInspectionItem => Boolean(row))
}

function normalizeAgreementItems(value: unknown): EbProjectAgreementItem[] {
  const rows = Array.isArray(value) ? value : []

  return rows
    .map((row, index) => {
      if (!row || typeof row !== 'object') return null
      const record = row as Record<string, unknown>
      const kind = normalizeAgreementItemKind(typeof record.kind === 'string' ? record.kind : null)
      const title = normalizeText(typeof record.title === 'string' ? record.title : null)
      const note = normalizeText(typeof record.note === 'string' ? record.note : null)
      const documentDate = normalizeDate(typeof record.documentDate === 'string' ? record.documentDate : null)

      if (!title && !note && !documentDate) return null

      return {
        id: normalizeText(typeof record.id === 'string' ? record.id : null) ?? `${kind}_${index + 1}`,
        kind,
        title: title ?? '',
        documentDate,
        note,
        includeInReport: typeof record.includeInReport === 'boolean' ? record.includeInReport : true,
        sortOrder: typeof record.sortOrder === 'number' && Number.isFinite(record.sortOrder)
          ? record.sortOrder
          : (index + 1) * 100,
      }
    })
    .filter((row): row is EbProjectAgreementItem => Boolean(row))
    .sort((left, right) => left.sortOrder - right.sortOrder)
}

function hasPreviousInspectionValue(row: EbPreviousInspectionItem) {
  return Boolean(row.status || row.date)
}

function resolvePreviousInspectionsForProject(
  inspection: EbInspectionSummary,
  inspections: EbInspectionSummary[]
): EbPreviousInspectionItem[] {
  const rows = normalizePreviousInspections(inspection.previousInspections)
  if (rows.some(hasPreviousInspectionValue)) return rows

  const preInspection = inspections
    .filter((item) => item.inspectionId !== inspection.inspectionId && item.variant === 'FB')
    .sort((left, right) => String(left.date ?? '').localeCompare(String(right.date ?? '')))
    .at(-1)

  if (!preInspection?.date) return rows

  return [
    ...rows,
    {
      key: `auto_pre_inspection_${preInspection.inspectionId}`,
      label: 'Förbesiktning',
      status: 'performed',
      date: preInspection.date,
    },
  ]
}

function normalizeBoolean(value: boolean | null | undefined) {
  return typeof value === 'boolean' ? value : null
}

function normalizeWarrantyYears(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value >= 1 && value <= 10 ? value : null
}

function getMailFromAddress() {
  const value = process.env.ASSIGNMENTS_MAIL_FROM
  if (!value || value.trim() === '') {
    throw new Error('MISSING_ENV:ASSIGNMENTS_MAIL_FROM')
  }
  return value.trim()
}

function normalizeEmail(value: string | null | undefined) {
  const email = normalizeText(value)?.toLowerCase() ?? null
  return email && EMAIL_REGEX.test(email) ? email : null
}

function normalizeSuggestionPrefix(value: string | null | undefined) {
  const normalized = normalizeText(value)?.toLocaleLowerCase('sv-SE') ?? null
  return normalized ? normalized.slice(0, 1) : null
}

function formatSwedishDate(value: string | null) {
  if (!value) return 'Ej satt'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
}

function formatTime(value: string | null) {
  if (!value) return 'Ej satt'
  return value.slice(0, 5)
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function textToHtml(value: string) {
  const paragraphs = value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  if (paragraphs.length === 0) return '<p></p>'

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
}

export function isEbInspectionVariant(value: string): value is EbInspectionVariant {
  return EB_VARIANTS.includes(value as EbInspectionVariant)
}

export function getEbInspectionVariantLabel(variant: EbInspectionVariant) {
  return VARIANT_LABELS[variant]
}

function toVariant(value: string | null | undefined): EbInspectionVariant {
  const normalized = String(value ?? '').trim().toUpperCase()
  return isEbInspectionVariant(normalized) ? normalized : 'SLB'
}

function toProjectTitle(input: {
  title?: string | null
  contractName?: string | null
  address?: string | null
}) {
  return (
    normalizeText(input.title) ??
    normalizeText(input.contractName) ??
    normalizeText(input.address) ??
    `Entreprenad ${new Date().toISOString().slice(0, 10)}`
  )
}

function isMissingColumnError(error: { code?: string | null; message?: string | null; details?: string | null }) {
  const text = [error.code, error.message, error.details].filter(Boolean).join(' ').toLowerCase()
  return (
    text.includes('42703') ||
    text.includes('column') && text.includes('does not exist') ||
    text.includes('could not find') && text.includes('column') ||
    text.includes('schema cache') && text.includes('column')
  )
}

function isMissingRelationError(error: { code?: string | null; message?: string | null; details?: string | null }) {
  const text = [error.code, error.message, error.details].filter(Boolean).join(' ').toLowerCase()
  return (
    text.includes('42p01') ||
    text.includes('relation') && text.includes('does not exist') ||
    text.includes('could not find') && text.includes('table') ||
    text.includes('schema cache') && text.includes('table')
  )
}

function toPropertyName(input: {
  address?: string | null
  propertyDesignation?: string | null
  brfApartmentNumber?: string | null
}, title: string) {
  return (
    normalizeText(input.address) ??
    normalizeText(input.propertyDesignation) ??
    normalizeText(input.brfApartmentNumber) ??
    title
  )
}

function normalizeEbReportPdfStatus(value: unknown): EbReportPdfStatus {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'processing') return 'processing'
  if (normalized === 'ready') return 'ready'
  if (normalized === 'failed') return 'failed'
  return 'pending'
}

function getEbReportPdfDownloadUrl(inspectionId: string, link: EbReportLinkRow | undefined) {
  if (!link) return null
  const hasStoragePdf =
    String(link.pdf_storage_bucket ?? '').trim().length > 0 &&
    String(link.pdf_storage_path ?? '').trim().length > 0
  const hasLegacyPdf = String(link.pdf_base64 ?? '').trim().length > 0
  if (normalizeEbReportPdfStatus(link.pdf_status) !== 'ready' || (!hasStoragePdf && !hasLegacyPdf)) {
    return null
  }
  return `/api/report-v2/${encodeURIComponent(inspectionId)}/pdf`
}

function mapInspectionSummary(
  detail: EbInspectionDetailRow,
  inspection: InspectionRow | undefined,
  reportLink?: EbReportLinkRow
): EbInspectionSummary {
  const variant = toVariant(detail.inspection_variant)
  const reportPdfStatus = reportLink ? normalizeEbReportPdfStatus(reportLink.pdf_status) : null

  return {
    inspectionId: detail.inspection_id,
    projectId: detail.eb_project_id,
    variant,
    variantLabel: getEbInspectionVariantLabel(variant),
    sequenceNo: detail.sequence_no ?? 1,
    parentInspectionId: detail.parent_inspection_id ?? null,
    status: inspection?.status ?? null,
    date: inspection?.date ?? null,
    inspectionTime: inspection?.inspection_time ?? null,
    meetingPlace: detail.meeting_place ?? null,
    startMeetingTime: detail.start_meeting_time ?? null,
    finalMeetingTime: detail.final_meeting_time ?? null,
    clientName: inspection?.client_name ?? null,
    assignmentNumber: inspection?.assignment_number ?? null,
    invitationSentAt: detail.invitation_sent_at ?? null,
    inspectorAppointedBy: normalizeInspectorAppointedBy(detail.inspector_appointed_by),
    invitationMethod: detail.invitation_method ?? null,
    invitationDate: detail.invitation_date ?? null,
    approvalStatus: normalizeApprovalStatus(detail.approval_status),
    approvalNote: detail.approval_note ?? null,
    requiresContinuedFinalInspection: detail.requires_continued_final_inspection ?? null,
    continuedFinalInspectionDate: detail.continued_final_inspection_date ?? null,
    continuedFinalInspectionTime: detail.continued_final_inspection_time ?? null,
    warrantyPeriodYears: detail.warranty_period_years ?? null,
    warrantyEndDate: detail.warranty_end_date ?? null,
    warrantyScope: detail.warranty_scope ?? null,
    defaultRemedyDeadline: detail.default_remedy_deadline ?? null,
    afterInspectionRequested: detail.after_inspection_requested ?? null,
    afterInspectionRequestedBy: normalizeAfterInspectionRequestedBy(detail.after_inspection_requested_by),
    afterInspectionDueDate: detail.after_inspection_due_date ?? null,
    afterInspectionNoticeInReport: detail.after_inspection_notice_in_report ?? false,
    inspectionCostDistribution: detail.inspection_cost_distribution ?? null,
    reportDistributionDate: detail.report_distribution_date ?? null,
    previousInspections: normalizePreviousInspections(detail.previous_inspections),
    defectNumberingExplanation: detail.defect_numbering_explanation ?? null,
    defectNoErrorPartsPolicy: normalizeDefectNoErrorPartsPolicy(detail.defect_no_error_parts_policy),
    reportLockedAt: detail.report_locked_at ?? null,
    reportLockedBy: detail.report_locked_by ?? null,
    reportPdfStatus,
    reportPdfError: reportLink?.pdf_error ?? null,
    reportPdfDownloadUrl: getEbReportPdfDownloadUrl(detail.inspection_id, reportLink),
    reportPdfCreatedAt: reportLink?.created_at ?? null,
    createdAt: inspection?.created_at ?? detail.created_at ?? null,
  }
}

function mapProject(
  project: EbProjectRow,
  detailsByProjectId: Map<string, EbInspectionDetailRow[]>,
  inspectionsById: Map<string, InspectionRow>,
  reportLinksByInspectionId: Map<string, EbReportLinkRow>
): EbProjectListItem {
  const inspections = (detailsByProjectId.get(project.id) ?? [])
    .map((detail) =>
      mapInspectionSummary(
        detail,
        inspectionsById.get(detail.inspection_id),
        reportLinksByInspectionId.get(detail.inspection_id)
      )
    )
    .sort((left, right) => {
      if (left.sequenceNo !== right.sequenceNo) return left.sequenceNo - right.sequenceNo
      return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
    })
  const inspectionsWithPreviousRows = inspections.map((inspection) => ({
    ...inspection,
    previousInspections: resolvePreviousInspectionsForProject(inspection, inspections),
  }))

  return {
    id: project.id,
    orgId: project.org_id,
    ownerProfileId: project.owner_profile_id,
    propertyId: project.property_id ?? null,
    projectTemplateKey: normalizeProjectTemplateKey(project.project_template_key),
    drainageSystem: normalizeDrainageSystem(project.drainage_system),
    drainageInspectionStage: normalizeDrainageInspectionStage(project.drainage_inspection_stage),
    drainageGuidanceVersion: project.drainage_guidance_version ?? null,
    title: project.title,
    contractName: project.contract_name ?? null,
    objectDescription: project.object_description ?? null,
    propertyDesignation: project.property_designation ?? null,
    brfApartmentNumber: project.brf_apartment_number ?? null,
    address: project.address ?? null,
    postalCode: project.postal_code ?? null,
    city: project.city ?? null,
    municipality: project.municipality ?? null,
    standardAgreement: project.standard_agreement ?? null,
    contractForm: project.contract_form ?? null,
    procurementForm: project.procurement_form ?? null,
    contractDate: project.contract_date ?? null,
    notePrefix: project.note_prefix ?? 'BES',
    clientName: project.client_name ?? null,
    clientOrgNo: project.client_org_no ?? null,
    clientAddress: project.client_address ?? null,
    clientPostalCode: project.client_postal_code ?? null,
    clientCity: project.client_city ?? null,
    contractorName: project.contractor_name ?? null,
    contractorOrgNo: project.contractor_org_no ?? null,
    contractorAddress: project.contractor_address ?? null,
    contractorPostalCode: project.contractor_postal_code ?? null,
    contractorCity: project.contractor_city ?? null,
    agreementItems: normalizeAgreementItems(project.agreement_items),
    status: project.status ?? 'draft',
    createdAt: project.created_at ?? null,
    updatedAt: project.updated_at ?? null,
    inspections: inspectionsWithPreviousRows,
  }
}

async function fetchProjectsByOrg(orgId: string, projectId?: string) {
  const admin = createSupabaseAdminClient()
  const baseSelect =
    'id,org_id,owner_profile_id,property_id,title,contract_name,object_description,property_designation,address,postal_code,city,municipality,standard_agreement,contract_form,procurement_form,contract_date,note_prefix,client_name,client_org_no,client_address,client_postal_code,client_city,contractor_name,contractor_org_no,contractor_address,contractor_postal_code,contractor_city,status,created_at,updated_at'
  const withTemplateSelect =
    'id,org_id,owner_profile_id,property_id,project_template_key,drainage_system,drainage_inspection_stage,drainage_guidance_version,title,contract_name,object_description,property_designation,brf_apartment_number,address,postal_code,city,municipality,standard_agreement,contract_form,procurement_form,contract_date,note_prefix,client_name,client_org_no,client_address,client_postal_code,client_city,contractor_name,contractor_org_no,contractor_address,contractor_postal_code,contractor_city,status,created_at,updated_at'
  const withAgreementItemsSelect = `${withTemplateSelect},agreement_items`
  let query = admin
    .from('eb_projects')
    .select(withAgreementItemsSelect)
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })

  if (projectId) {
    query = query.eq('id', projectId)
  }

  const { data, error } = await query

  if (error) {
    if (isMissingColumnError(error)) {
      let fallbackQuery = admin
        .from('eb_projects')
        .select(baseSelect)
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })

      if (projectId) {
        fallbackQuery = fallbackQuery.eq('id', projectId)
      }

      const fallback = await fallbackQuery
      if (fallback.error) {
        throw new Error(fallback.error.message ?? 'Kunde inte hämta EB-projekt.')
      }
      return (fallback.data ?? []) as EbProjectRow[]
    }
    throw new Error(error.message ?? 'Kunde inte hämta EB-projekt.')
  }

  return (data ?? []) as EbProjectRow[]
}

async function fetchDetailsForProjects(orgId: string, projectIds: string[]) {
  if (projectIds.length === 0) return []

  const admin = createSupabaseAdminClient()
  const baseSelect =
    'inspection_id,org_id,eb_project_id,parent_inspection_id,inspection_variant,sequence_no,meeting_place,start_meeting_time,final_meeting_time,invitation_sent_at,report_locked_at,created_at'
  const withStructuredReportSelect =
    'inspection_id,org_id,eb_project_id,parent_inspection_id,inspection_variant,sequence_no,meeting_place,start_meeting_time,final_meeting_time,invitation_sent_at,inspector_appointed_by,invitation_method,invitation_date,approval_status,approval_note,requires_continued_final_inspection,continued_final_inspection_date,continued_final_inspection_time,warranty_period_years,warranty_end_date,warranty_scope,default_remedy_deadline,after_inspection_requested,after_inspection_requested_by,after_inspection_due_date,after_inspection_notice_in_report,inspection_cost_distribution,report_distribution_date,previous_inspections,defect_numbering_explanation,defect_no_error_parts_policy,report_locked_at,report_locked_by,created_at'
  const { data, error } = await admin
    .from('eb_inspection_details')
    .select(withStructuredReportSelect)
    .eq('org_id', orgId)
    .in('eb_project_id', projectIds)
    .order('sequence_no', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    if (isMissingColumnError(error)) {
      const fallback = await admin
        .from('eb_inspection_details')
        .select(baseSelect)
        .eq('org_id', orgId)
        .in('eb_project_id', projectIds)
        .order('sequence_no', { ascending: true })
        .order('created_at', { ascending: true })

      if (fallback.error) {
        throw new Error(fallback.error.message ?? 'Kunde inte hämta EB-besiktningar.')
      }
      return (fallback.data ?? []) as EbInspectionDetailRow[]
    }
    throw new Error(error.message ?? 'Kunde inte hämta EB-besiktningar.')
  }

  return (data ?? []) as EbInspectionDetailRow[]
}

async function fetchInspectionsByIds(inspectionIds: string[]) {
  if (inspectionIds.length === 0) return new Map<string, InspectionRow>()

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('inspections')
    .select('id,property_id,status,date,inspection_time,client_name,assignment_number,created_at')
    .in('id', inspectionIds)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta inspections.')
  }

  return new Map(((data ?? []) as InspectionRow[]).map((inspection) => [inspection.id, inspection]))
}

async function fetchLatestReportLinksByInspectionIds(inspectionIds: string[]) {
  if (inspectionIds.length === 0) return new Map<string, EbReportLinkRow>()

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('inspection_report_links')
    .select(
      'inspection_id,created_at,pdf_status,pdf_error,pdf_storage_bucket,pdf_storage_path,pdf_base64'
    )
    .in('inspection_id', inspectionIds)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta sparade EB-PDF:er.')
  }

  const linksByInspectionId = new Map<string, EbReportLinkRow>()
  for (const row of (data ?? []) as EbReportLinkRow[]) {
    if (!linksByInspectionId.has(row.inspection_id)) {
      linksByInspectionId.set(row.inspection_id, row)
    }
  }
  return linksByInspectionId
}

async function buildProjectItems(projectRows: EbProjectRow[]) {
  const projectIds = projectRows.map((project) => project.id)
  const details = await fetchDetailsForProjects(projectRows[0]?.org_id ?? '', projectIds)
  const inspectionIds = details.map((detail) => detail.inspection_id)
  const [inspectionsById, reportLinksByInspectionId] = await Promise.all([
    fetchInspectionsByIds(inspectionIds),
    fetchLatestReportLinksByInspectionIds(inspectionIds),
  ])
  const detailsByProjectId = new Map<string, EbInspectionDetailRow[]>()

  for (const detail of details) {
    const rows = detailsByProjectId.get(detail.eb_project_id) ?? []
    rows.push(detail)
    detailsByProjectId.set(detail.eb_project_id, rows)
  }

  return projectRows.map((project) =>
    mapProject(project, detailsByProjectId, inspectionsById, reportLinksByInspectionId)
  )
}

export async function listEbProjects(orgId: string): Promise<EbProjectListItem[]> {
  const projects = await fetchProjectsByOrg(orgId)
  if (projects.length === 0) return []
  return buildProjectItems(projects)
}

export async function getEbProjectById(input: {
  orgId: string
  projectId: string
}): Promise<EbProjectListItem | null> {
  const projects = await fetchProjectsByOrg(input.orgId, input.projectId)
  if (projects.length === 0) return null
  const [project] = await buildProjectItems(projects)
  return project ?? null
}

function toAttachmentType(value: string | null | undefined): EbAttachmentType {
  return value === 'image' ? 'image' : 'document'
}

async function mapProjectAttachment(row: EbProjectAttachmentRow): Promise<EbProjectAttachment> {
  const admin = createSupabaseAdminClient()
  const storageBucket = row.storage_bucket ?? EB_PROJECT_ATTACHMENTS_BUCKET
  let signedUrl: string | null = null

  if (row.file_path) {
    const { data, error } = await admin.storage
      .from(storageBucket)
      .createSignedUrl(row.file_path, EB_ATTACHMENT_SIGNED_URL_SECONDS)

    if (!error) {
      signedUrl = data?.signedUrl ?? null
    }
  }

  return {
    id: row.id,
    projectId: row.eb_project_id,
    attachmentType: toAttachmentType(row.attachment_type),
    title: row.title ?? null,
    storageBucket,
    filePath: row.file_path,
    fileName: row.file_name ?? null,
    contentType: row.content_type ?? null,
    fileSizeBytes: row.file_size_bytes ?? null,
    includeInReport: row.include_in_report ?? true,
    littera: row.littera ?? null,
    documentDate: row.document_date ?? null,
    documentNumber: row.document_number ?? null,
    documentNote: row.document_note ?? null,
    signedUrl,
    uploadedBy: row.uploaded_by ?? null,
    createdAt: row.created_at ?? null,
  }
}

export async function listEbProjectAttachments(input: {
  orgId: string
  projectId: string
}): Promise<EbProjectAttachment[]> {
  const project = await getEbProjectById({ orgId: input.orgId, projectId: input.projectId })
  if (!project) {
    throw new Error('EB_PROJECT_NOT_FOUND')
  }

  const admin = createSupabaseAdminClient()
  const baseSelect =
    'id,eb_project_id,attachment_type,title,storage_bucket,file_path,file_name,content_type,file_size_bytes,uploaded_by,created_at'
  const withReportMetadataSelect =
    'id,eb_project_id,attachment_type,title,storage_bucket,file_path,file_name,content_type,file_size_bytes,include_in_report,littera,document_date,document_number,document_note,uploaded_by,created_at'
  const { data, error } = await admin
    .from('eb_project_attachments')
    .select(withReportMetadataSelect)
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .order('created_at', { ascending: false })

  if (error) {
    if (isMissingColumnError(error)) {
      const fallback = await admin
        .from('eb_project_attachments')
        .select(baseSelect)
        .eq('org_id', input.orgId)
        .eq('eb_project_id', input.projectId)
        .order('created_at', { ascending: false })

      if (fallback.error) {
        throw new Error(fallback.error.message ?? 'Kunde inte hämta EB-bilagor.')
      }
      return Promise.all(((fallback.data ?? []) as EbProjectAttachmentRow[]).map(mapProjectAttachment))
    }
    throw new Error(error.message ?? 'Kunde inte hämta EB-bilagor.')
  }

  return Promise.all(((data ?? []) as EbProjectAttachmentRow[]).map(mapProjectAttachment))
}

function parseApplicableModules(value: string | null | undefined) {
  return String(value ?? '')
    .split(/[,;|]/g)
    .map((module) => module.trim().toLowerCase())
    .filter(Boolean)
}

function documentTypeAppliesToEb(row: DocumentTypeRow) {
  return parseApplicableModules(row.applicable_modules).includes('eb')
}

function documentTypeSortOrder(row: DocumentTypeRow) {
  return EB_DOCUMENT_TYPE_ORDER.get(row.code) ?? 1000
}

function isHandoverDocumentResultLabel(value: string | null | undefined) {
  return normalizeText(value)?.toLocaleLowerCase('sv-SE').includes('överlämnas') ?? false
}

function mapInspectionDocument(
  documentType: DocumentTypeRow,
  document: InspectionDocumentRow | null
): EbInspectionDocument {
  return {
    id: document?.id ?? null,
    documentTypeId: documentType.id,
    code: documentType.code,
    title: documentType.label,
    category: documentType.category ?? null,
    resultLabel: documentType.result_label ?? null,
    resultUnit: documentType.result_unit ?? null,
    status: normalizeInspectionDocumentStatus(document?.status ?? null),
    documentDate: document?.document_date ?? null,
    note: document?.note ?? null,
    sortOrder: documentTypeSortOrder(documentType),
  }
}

async function listEbDocumentTypes() {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('document_types')
    .select('id,code,label,category,applicable_modules,description,result_label,result_unit,is_active')
    .eq('is_active', true)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta EB-dokumenttyper.')
  }

  return ((data ?? []) as DocumentTypeRow[])
    .filter(documentTypeAppliesToEb)
    .sort((left, right) => {
      const orderDiff = documentTypeSortOrder(left) - documentTypeSortOrder(right)
      if (orderDiff !== 0) return orderDiff
      return left.label.localeCompare(right.label, 'sv')
    })
}

async function listInspectionDocumentsForTypes(input: {
  inspectionId: string
  documentTypeIds: string[]
}) {
  if (input.documentTypeIds.length === 0) return []

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('inspection_documents')
    .select('id,inspection_id,document_type_id,title,status,document_date,note,created_at')
    .eq('inspection_id', input.inspectionId)
    .in('document_type_id', input.documentTypeIds)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta granskade handlingar.')
  }

  return (data ?? []) as InspectionDocumentRow[]
}

export async function listEbInspectionDocuments(input: {
  orgId: string
  projectId: string
  inspectionId: string
}): Promise<EbInspectionDocument[]> {
  await getEbInspectionRoundBase(input)

  const documentTypes = await listEbDocumentTypes()
  const documents = await listInspectionDocumentsForTypes({
    inspectionId: input.inspectionId,
    documentTypeIds: documentTypes.map((documentType) => documentType.id),
  })
  const documentsByTypeId = new Map<string, InspectionDocumentRow>()
  for (const document of documents) {
    const typeId = document.document_type_id
    if (!typeId || documentsByTypeId.has(typeId)) continue
    documentsByTypeId.set(typeId, document)
  }

  return documentTypes.map((documentType) =>
    mapInspectionDocument(documentType, documentsByTypeId.get(documentType.id) ?? null)
  )
}

function normalizeInspectionDocumentInput(
  document: EbInspectionDocument,
  documentType: DocumentTypeRow
) {
  return {
    document_type_id: documentType.id,
    title: documentType.label,
    status: normalizeInspectionDocumentStatus(document.status),
    document_date: normalizeDate(document.documentDate),
    document_value: null,
    note: normalizeText(document.note),
  }
}

function ebMissingDocumentNoteText(
  documentType: DocumentTypeRow,
  document: ReturnType<typeof normalizeInspectionDocumentInput>
) {
  const baseText = isHandoverDocumentResultLabel(documentType.result_label)
    ? `Avtalad dokumentation saknas: ${documentType.label} har inte överlämnats.`
    : `Avtalad dokumentation saknas: ${documentType.label} har inte redovisats.`

  return document.note ? `${baseText} Kommentar: ${document.note}` : baseText
}

async function syncMissingDocumentNotes(input: {
  orgId: string
  requestedByUserId: string
  projectId: string
  inspectionId: string
  contractorName: string | null
  documents: Array<{
    documentType: DocumentTypeRow
    document: ReturnType<typeof normalizeInspectionDocumentInput>
  }>
}) {
  const admin = createSupabaseAdminClient()
  const missingDocuments = input.documents.filter(({ document }) => document.status === 'missing')
  const missingTypeIds = new Set(missingDocuments.map(({ documentType }) => documentType.id))

  const { data, error } = await admin
    .from('eb_notes')
    .select('id,source_record_id,note_text')
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)
    .eq('source_system', EB_MISSING_DOCUMENT_NOTE_SOURCE)

  if (error) {
    if (isMissingColumnError(error)) return
    throw new Error(error.message ?? 'Kunde inte läsa automatiska dokumentnoteringar.')
  }

  const existingNotes = (data ?? []) as EbAutoSourceNoteRow[]
  const existingByTypeId = new Map<string, EbAutoSourceNoteRow>()
  const obsoleteNoteIds: string[] = []

  for (const note of existingNotes) {
    const sourceRecordId = normalizeText(note.source_record_id)
    if (!sourceRecordId || !missingTypeIds.has(sourceRecordId)) {
      obsoleteNoteIds.push(note.id)
      continue
    }
    if (existingByTypeId.has(sourceRecordId)) {
      obsoleteNoteIds.push(note.id)
      continue
    }
    existingByTypeId.set(sourceRecordId, note)
  }

  if (obsoleteNoteIds.length > 0) {
    const { error: imageDetachError } = await admin
      .from('inspection_images')
      .update({ eb_note_id: null })
      .eq('inspection_id', input.inspectionId)
      .in('eb_note_id', obsoleteNoteIds)

    if (imageDetachError) {
      throw new Error(imageDetachError.message ?? 'Kunde inte koppla loss bilder från dokumentnoteringar.')
    }

    const { error: deleteError } = await admin
      .from('eb_notes')
      .delete()
      .eq('org_id', input.orgId)
      .eq('eb_project_id', input.projectId)
      .eq('inspection_id', input.inspectionId)
      .eq('source_system', EB_MISSING_DOCUMENT_NOTE_SOURCE)
      .in('id', obsoleteNoteIds)

    if (deleteError) {
      throw new Error(deleteError.message ?? 'Kunde inte ta bort automatiska dokumentnoteringar.')
    }
  }

  const updateResults = await Promise.all(
    missingDocuments.map(({ documentType, document }) => {
      const existingNote = existingByTypeId.get(documentType.id)
      if (!existingNote) return Promise.resolve({ error: null })

      const noteText = ebMissingDocumentNoteText(documentType, document)
      if (existingNote.note_text === noteText) return Promise.resolve({ error: null })

      return admin
        .from('eb_notes')
        .update({
          note_text: noteText,
          location: 'Dokumentation',
          marker_key: 'E',
          status_key: 'open',
          responsible_party: input.contractorName,
          trade_group: 'Dokumentation',
          updated_by: input.requestedByUserId,
        })
        .eq('org_id', input.orgId)
        .eq('eb_project_id', input.projectId)
        .eq('inspection_id', input.inspectionId)
        .eq('id', existingNote.id)
    })
  )
  const updateError = updateResults.find((result) => result.error)?.error
  if (updateError) {
    throw new Error(updateError.message ?? 'Kunde inte uppdatera automatiska dokumentnoteringar.')
  }

  const documentsToInsert = missingDocuments.filter(({ documentType }) => !existingByTypeId.has(documentType.id))
  if (documentsToInsert.length === 0) return

  let nextNoteNumber = await getNextEbNoteNumber(input)
  const insertRows = documentsToInsert.map(({ documentType, document }) => {
    const noteNumber = nextNoteNumber
    nextNoteNumber += 1

    return {
      org_id: input.orgId,
      eb_project_id: input.projectId,
      inspection_id: input.inspectionId,
      discipline_id: null,
      note_number: noteNumber,
      location: 'Dokumentation',
      room: null,
      place_detail: null,
      marker_key: 'E',
      status_key: 'open',
      note_text: ebMissingDocumentNoteText(documentType, document),
      responsible_party: input.contractorName,
      trade_group: 'Dokumentation',
      sort_order: noteNumber * 100,
      created_by: input.requestedByUserId,
      updated_by: input.requestedByUserId,
      source_system: EB_MISSING_DOCUMENT_NOTE_SOURCE,
      source_record_id: documentType.id,
    }
  })

  const { error: insertError } = await admin.from('eb_notes').insert(insertRows)
  if (insertError) {
    throw new Error(insertError.message ?? 'Kunde inte skapa noteringar för saknade dokument.')
  }
}

export async function saveEbInspectionDocuments(
  input: SaveEbInspectionDocumentsInput
): Promise<EbInspectionDocument[]> {
  await assertEbInspectionEditable(input)
  const roundBase = await getEbInspectionRoundBase(input)

  const documentTypes = await listEbDocumentTypes()
  const typeById = new Map(documentTypes.map((documentType) => [documentType.id, documentType]))
  const knownTypeIds = documentTypes.map((documentType) => documentType.id)
  const admin = createSupabaseAdminClient()

  if (knownTypeIds.length > 0) {
    const { error: deleteError } = await admin
      .from('inspection_documents')
      .delete()
      .eq('inspection_id', input.inspectionId)
      .in('document_type_id', knownTypeIds)

    if (deleteError) {
      throw new Error(deleteError.message ?? 'Kunde inte uppdatera granskade handlingar.')
    }
  }

  const normalizedDocuments = input.documents
    .map((document) => {
      const documentType = typeById.get(document.documentTypeId)
      if (!documentType) return null
      const normalized = normalizeInspectionDocumentInput(document, documentType)
      return { documentType, document: normalized }
    })
    .filter((document): document is NonNullable<typeof document> => Boolean(document))

  const rows = normalizedDocuments
    .map(({ document: normalized }) => {
      if (normalized.status === 'na' && !normalized.document_date && !normalized.note) return null
      return {
        inspection_id: input.inspectionId,
        document_type_id: normalized.document_type_id,
        title: normalized.title,
        status: normalized.status,
        document_date: normalized.document_date,
        document_value: normalized.document_value,
        note: normalized.note,
      }
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))

  if (rows.length > 0) {
    const { error: insertError } = await admin.from('inspection_documents').insert(rows)
    if (insertError) {
      throw new Error(insertError.message ?? 'Kunde inte spara granskade handlingar.')
    }
  }

  await syncMissingDocumentNotes({
    orgId: input.orgId,
    requestedByUserId: input.requestedByUserId,
    projectId: input.projectId,
    inspectionId: input.inspectionId,
    contractorName: roundBase.project.contractorName,
    documents: normalizedDocuments,
  })

  return listEbInspectionDocuments(input)
}

function mapDiscipline(row: EbDisciplineRow): EbDiscipline {
  return {
    id: row.id,
    key: row.discipline_key,
    label: row.label,
    littera: row.littera ?? null,
    sortOrder: row.sort_order ?? 100,
    isActive: row.is_active ?? true,
  }
}

function mapMarker(row: EbMarkerRow): EbNoteMarker {
  return {
    key: row.key,
    label: row.label,
    colorToken: row.color_token ?? 'gray',
    sortOrder: row.sort_order ?? 100,
  }
}

function mapStatus(row: EbStatusRow): EbNoteStatus {
  return {
    ...mapMarker(row),
    isDefault: row.is_default ?? false,
  }
}

function mapSuggestion(row: EbNoteSuggestionRow): EbNoteSuggestion {
  return {
    id: row.id,
    phrase: row.phrase,
    normalizedPrefix: row.normalized_prefix,
    useCount: row.use_count ?? 1,
    lastUsedAt: row.last_used_at ?? null,
  }
}

function mapNote(
  row: EbNoteRow,
  disciplinesById: Map<string, EbDiscipline>,
  markersByKey: Map<string, EbNoteMarker>,
  statusesByKey: Map<string, EbNoteStatus>
): EbNote {
  const discipline = row.discipline_id ? disciplinesById.get(row.discipline_id) : null
  const marker = row.marker_key ? markersByKey.get(row.marker_key) : null
  const statusKey = row.status_key ?? 'open'
  const status = statusesByKey.get(statusKey)

  return {
    id: row.id,
    projectId: row.eb_project_id,
    inspectionId: row.inspection_id,
    disciplineId: row.discipline_id ?? null,
    noteNumber: row.note_number ?? null,
    location: row.location ?? null,
    room: row.room ?? null,
    placeDetail: row.place_detail ?? null,
    markerKey: row.marker_key ?? null,
    statusKey,
    noteText: row.note_text ?? '',
    responsibleParty: row.responsible_party ?? null,
    tradeGroup: row.trade_group ?? null,
    investigationResponsibleParty: normalizePartyKey(row.investigation_responsible_party),
    investigationResponsibleNote: row.investigation_responsible_note ?? null,
    investigationCostParty:
      row.investigation_cost_party === 'contractor' || row.investigation_cost_party === 'client'
        ? row.investigation_cost_party
        : null,
    investigationDueDate: row.investigation_due_date ?? null,
    deductionAmount: row.deduction_amount ?? null,
    sortOrder: row.sort_order ?? 100,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    disciplineLabel: discipline?.label ?? null,
    disciplineLittera: discipline?.littera ?? null,
    markerLabel: marker?.label ?? null,
    statusLabel: status?.label ?? null,
  }
}

function mapInspectionCheckpoint(row: EbInspectionCheckpointRow): EbInspectionCheckpoint {
  return {
    id: row.id,
    projectId: row.eb_project_id,
    inspectionId: row.inspection_id,
    checkpointKey: row.checkpoint_key,
    templateKey: row.template_key,
    systemKey: normalizeDrainageSystem(row.system_key) ?? 'generic',
    groupKey: row.group_key,
    groupLabel: row.group_label,
    title: row.title,
    guidance: row.guidance ?? null,
    verificationMethod: row.verification_method ?? null,
    sourceUrl: row.source_url ?? null,
    photoRequired: row.photo_required ?? false,
    status: normalizeCheckpointStatus(row.status),
    comment: row.comment ?? null,
    noteId: row.note_id ?? null,
    sortOrder: row.sort_order ?? 100,
    updatedAt: row.updated_at ?? null,
  }
}

function mapNoteImage(row: EbNoteImageRow, publicUrl: string): EbNoteImage {
  return {
    id: row.id,
    noteId: row.eb_note_id ?? null,
    inspectionId: row.inspection_id,
    filePath: row.file_path,
    label: row.label ?? null,
    sortOrder: row.sort_order ?? 100,
    publicUrl,
    createdAt: row.created_at ?? null,
  }
}

async function getEbInspectionRoundBase(input: {
  orgId: string
  projectId: string
  inspectionId: string
}) {
  const project = await getEbProjectById({ orgId: input.orgId, projectId: input.projectId })
  if (!project) {
    throw new Error('EB_PROJECT_NOT_FOUND')
  }

  const inspection = project.inspections.find((item) => item.inspectionId === input.inspectionId)
  if (!inspection) {
    throw new Error('EB_INSPECTION_NOT_FOUND')
  }

  return { project, inspection }
}

export async function assertEbInspectionEditable(input: {
  orgId: string
  projectId: string
  inspectionId: string
}) {
  const admin = createSupabaseAdminClient()
  const { data: detail, error: detailError } = await admin
    .from('eb_inspection_details')
    .select('inspection_id,report_locked_at')
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)
    .maybeSingle()

  if (detailError) {
    throw new Error(detailError.message ?? 'Kunde inte kontrollera EB-låsning.')
  }
  if (!detail) {
    throw new Error('EB_INSPECTION_NOT_FOUND')
  }
  if ((detail as { report_locked_at?: string | null }).report_locked_at) {
    throw new Error('EB_REPORT_LOCKED')
  }

  const { data: inspection, error: inspectionError } = await admin
    .from('inspections')
    .select('id,locked_at')
    .eq('id', input.inspectionId)
    .maybeSingle()

  if (inspectionError) {
    throw new Error(inspectionError.message ?? 'Kunde inte kontrollera besiktningslåsning.')
  }
  if ((inspection as { locked_at?: string | null } | null)?.locked_at) {
    throw new Error('EB_REPORT_LOCKED')
  }
}

async function listEbDisciplines(input: {
  orgId: string
  projectId: string
  inspectionId: string
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_disciplines')
    .select('id,discipline_key,label,littera,sort_order,is_active')
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta fack.')
  }

  return ((data ?? []) as EbDisciplineRow[]).map(mapDiscipline)
}

async function listEbNoteMarkers() {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('settings_eb_note_markers')
    .select('key,label,color_token,sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta beteckningar.')
  }

  return ((data ?? []) as EbMarkerRow[]).map(mapMarker)
}

async function listEbNoteStatuses() {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('settings_eb_note_statuses')
    .select('key,label,color_token,sort_order,is_default')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta noteringsstatusar.')
  }

  return ((data ?? []) as EbStatusRow[]).map(mapStatus)
}

async function listEbNotes(input: {
  orgId: string
  projectId: string
  inspectionId: string
  disciplines: EbDiscipline[]
  markers: EbNoteMarker[]
  statuses: EbNoteStatus[]
}) {
  const admin = createSupabaseAdminClient()
  const baseSelect =
    'id,eb_project_id,inspection_id,discipline_id,note_number,location,room,place_detail,marker_key,status_key,note_text,responsible_party,trade_group,sort_order,created_at,updated_at'
  const withReportMetadataSelect =
    'id,eb_project_id,inspection_id,discipline_id,note_number,location,room,place_detail,marker_key,status_key,note_text,responsible_party,trade_group,investigation_responsible_party,investigation_responsible_note,investigation_cost_party,investigation_due_date,deduction_amount,sort_order,created_at,updated_at'
  const { data, error } = await admin
    .from('eb_notes')
    .select(withReportMetadataSelect)
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('note_number', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error) {
    if (isMissingColumnError(error)) {
      const fallback = await admin
        .from('eb_notes')
        .select(baseSelect)
        .eq('org_id', input.orgId)
        .eq('eb_project_id', input.projectId)
        .eq('inspection_id', input.inspectionId)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('note_number', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })

      if (fallback.error) {
        throw new Error(fallback.error.message ?? 'Kunde inte hämta EB-noteringar.')
      }

      const disciplinesById = new Map(input.disciplines.map((discipline) => [discipline.id, discipline]))
      const markersByKey = new Map(input.markers.map((marker) => [marker.key, marker]))
      const statusesByKey = new Map(input.statuses.map((status) => [status.key, status]))
      return ((fallback.data ?? []) as EbNoteRow[]).map((row) =>
        mapNote(row, disciplinesById, markersByKey, statusesByKey)
      )
    }
    throw new Error(error.message ?? 'Kunde inte hämta EB-noteringar.')
  }

  const disciplinesById = new Map(input.disciplines.map((discipline) => [discipline.id, discipline]))
  const markersByKey = new Map(input.markers.map((marker) => [marker.key, marker]))
  const statusesByKey = new Map(input.statuses.map((status) => [status.key, status]))
  return ((data ?? []) as EbNoteRow[]).map((row) =>
    mapNote(row, disciplinesById, markersByKey, statusesByKey)
  )
}

async function listEbNoteImages(input: { inspectionId: string }) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('inspection_images')
    .select('id,inspection_id,eb_note_id,file_path,label,sort_order,created_at')
    .eq('inspection_id', input.inspectionId)
    .like('file_path', `${input.inspectionId}/eb-notes/%`)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta EB-bilder.')
  }

  return ((data ?? []) as EbNoteImageRow[]).map((row) =>
    mapNoteImage(row, admin.storage.from(EB_NOTE_IMAGE_BUCKET).getPublicUrl(row.file_path).data.publicUrl)
  )
}

async function listEbNoteSuggestions(input: {
  orgId: string
  profileId: string
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_note_suggestions')
    .select('id,phrase,normalized_prefix,use_count,last_used_at')
    .eq('org_id', input.orgId)
    .or(`profile_id.eq.${input.profileId},profile_id.is.null`)
    .order('use_count', { ascending: false })
    .order('last_used_at', { ascending: false })
    .limit(120)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta textförslag.')
  }

  return ((data ?? []) as EbNoteSuggestionRow[]).map(mapSuggestion)
}

function shouldUseEbTemplateCheckpoints(project: EbProjectListItem) {
  return project.projectTemplateKey === 'drainage_foundation'
}

function checkpointSystemsForProject(project: EbProjectListItem) {
  const system = project.drainageSystem ?? 'generic'
  return system === 'generic' ? ['generic'] : ['generic', system]
}

async function listTemplateCheckpointsForProject(project: EbProjectListItem) {
  if (!shouldUseEbTemplateCheckpoints(project)) return []

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('settings_eb_template_checkpoints')
    .select(
      'id,template_key,key,system_key,group_key,group_label,title,guidance,verification_method,source_url,photo_required,sort_order'
    )
    .eq('template_key', project.projectTemplateKey)
    .in('system_key', checkpointSystemsForProject(project))
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    if (isMissingRelationError(error)) return []
    throw new Error(error.message ?? 'Kunde inte hämta EB-mallens kontrollpunkter.')
  }

  return (data ?? []) as EbTemplateCheckpointRow[]
}

async function seedEbInspectionCheckpoints(input: {
  orgId: string
  requestedByUserId: string
  project: EbProjectListItem
  inspection: EbInspectionSummary
}) {
  if (!shouldUseEbTemplateCheckpoints(input.project)) return
  if (input.inspection.reportLockedAt) return

  const templateCheckpoints = await listTemplateCheckpointsForProject(input.project)
  if (templateCheckpoints.length === 0) return

  const admin = createSupabaseAdminClient()
  const rows = templateCheckpoints.map((checkpoint) => ({
    org_id: input.orgId,
    eb_project_id: input.project.id,
    inspection_id: input.inspection.inspectionId,
    template_checkpoint_id: checkpoint.id,
    checkpoint_key: checkpoint.key,
    template_key: checkpoint.template_key,
    system_key: normalizeDrainageSystem(checkpoint.system_key) ?? 'generic',
    group_key: checkpoint.group_key,
    group_label: checkpoint.group_label,
    title: checkpoint.title,
    guidance: checkpoint.guidance,
    verification_method: checkpoint.verification_method,
    source_url: checkpoint.source_url,
    photo_required: checkpoint.photo_required ?? false,
    status: 'not_checked',
    sort_order: checkpoint.sort_order ?? 100,
    created_by: input.requestedByUserId,
    updated_by: input.requestedByUserId,
  }))

  const { error } = await admin
    .from('eb_inspection_checkpoints')
    .upsert(rows, {
      onConflict: 'inspection_id,checkpoint_key',
      ignoreDuplicates: true,
    })

  if (error) {
    if (isMissingRelationError(error)) return
    throw new Error(error.message ?? 'Kunde inte skapa EB-kontrollpunkter.')
  }
}

async function listEbInspectionCheckpoints(input: {
  orgId: string
  requestedByUserId: string
  project: EbProjectListItem
  inspection: EbInspectionSummary
}) {
  const admin = createSupabaseAdminClient()
  const selectColumns =
    'id,eb_project_id,inspection_id,checkpoint_key,template_key,system_key,group_key,group_label,title,guidance,verification_method,source_url,photo_required,status,comment,note_id,sort_order,updated_at'

  const fetchRows = async () => {
    const result = await admin
      .from('eb_inspection_checkpoints')
      .select(selectColumns)
      .eq('org_id', input.orgId)
      .eq('eb_project_id', input.project.id)
      .eq('inspection_id', input.inspection.inspectionId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (result.error) {
      if (isMissingRelationError(result.error)) return []
      throw new Error(result.error.message ?? 'Kunde inte hämta EB-kontrollpunkter.')
    }

    return (result.data ?? []) as EbInspectionCheckpointRow[]
  }

  let rows = await fetchRows()
  if (rows.length === 0 && shouldUseEbTemplateCheckpoints(input.project) && !input.inspection.reportLockedAt) {
    await seedEbInspectionCheckpoints(input)
    rows = await fetchRows()
  }

  return rows.map(mapInspectionCheckpoint)
}

export async function getEbInspectionRound(input: {
  orgId: string
  requestedByUserId: string
  projectId: string
  inspectionId: string
}): Promise<EbInspectionRound> {
  const { project, inspection } = await getEbInspectionRoundBase(input)
  const [disciplines, markers, statuses, suggestions, checkpoints] = await Promise.all([
    listEbDisciplines(input),
    listEbNoteMarkers(),
    listEbNoteStatuses(),
    listEbNoteSuggestions({ orgId: input.orgId, profileId: input.requestedByUserId }),
    listEbInspectionCheckpoints({
      orgId: input.orgId,
      requestedByUserId: input.requestedByUserId,
      project,
      inspection,
    }),
  ])
  const [notes, images] = await Promise.all([
    listEbNotes({
      ...input,
      disciplines,
      markers,
      statuses,
    }),
    listEbNoteImages({ inspectionId: input.inspectionId }),
  ])

  return {
    project,
    inspection,
    disciplines,
    markers,
    statuses,
    notes,
    images,
    suggestions,
    checkpoints,
  }
}

export async function saveEbInspectionCheckpoints(
  input: SaveEbInspectionCheckpointsInput
): Promise<EbInspectionCheckpoint[]> {
  await assertEbInspectionEditable(input)
  const { project, inspection } = await getEbInspectionRoundBase(input)
  await seedEbInspectionCheckpoints({
    orgId: input.orgId,
    requestedByUserId: input.requestedByUserId,
    project,
    inspection,
  })

  const currentRows = await listEbInspectionCheckpoints({
    orgId: input.orgId,
    requestedByUserId: input.requestedByUserId,
    project,
    inspection,
  })
  const byId = new Map(currentRows.map((checkpoint) => [checkpoint.id, checkpoint]))
  const byKey = new Map(currentRows.map((checkpoint) => [checkpoint.checkpointKey, checkpoint]))
  const updates = input.checkpoints
    .map((checkpoint) => {
      const existing =
        (checkpoint.id ? byId.get(checkpoint.id) : null) ??
        (checkpoint.checkpointKey ? byKey.get(checkpoint.checkpointKey) : null)
      if (!existing) return null

      return {
        id: existing.id,
        status: normalizeCheckpointStatus(checkpoint.status),
        comment: normalizeText(checkpoint.comment),
        note_id: normalizeText(checkpoint.noteId),
      }
    })
    .filter((checkpoint): checkpoint is NonNullable<typeof checkpoint> => Boolean(checkpoint))

  if (updates.length === 0) {
    return currentRows
  }

  const admin = createSupabaseAdminClient()
  const results = await Promise.all(
    updates.map((checkpoint) =>
      admin
        .from('eb_inspection_checkpoints')
        .update({
          status: checkpoint.status,
          comment: checkpoint.comment,
          note_id: checkpoint.note_id,
          updated_by: input.requestedByUserId,
        })
        .eq('org_id', input.orgId)
        .eq('eb_project_id', input.projectId)
        .eq('inspection_id', input.inspectionId)
        .eq('id', checkpoint.id)
    )
  )

  const error = results.find((result) => result.error)?.error
  if (error) {
    throw new Error(error.message ?? 'Kunde inte spara EB-kontrollpunkter.')
  }

  return listEbInspectionCheckpoints({
    orgId: input.orgId,
    requestedByUserId: input.requestedByUserId,
    project,
    inspection,
  })
}

export async function getEbInspectionReport(input: {
  orgId: string
  requestedByUserId: string
  projectId: string
  inspectionId: string
}): Promise<EbInspectionReport> {
  const round = await getEbInspectionRound(input)
  const [participants, storedDraft, attachments, inspectionDocuments, inspectorProfile] = await Promise.all([
    listParticipantsForInspection(input),
    fetchEbReportDraft(input),
    listEbProjectAttachments({
      orgId: input.orgId,
      projectId: input.projectId,
    }),
    listEbInspectionDocuments(input),
    getProfileContact(input.requestedByUserId),
  ])
  const resolvedParticipants = participants.length > 0 ? participants : buildDefaultParticipants(round.project)
  const inspectorText = await buildInspectorReportText({
    orgId: input.orgId,
    profileId: input.requestedByUserId,
    inspector: inspectorProfile,
  })
  const inspectorLogoUrl = resolveProfileLogoUrl(inspectorProfile)
  const inspectorAvatarUrl = resolveProfileAvatarUrl(inspectorProfile)
  let ownerLogoUrl: string | null = null
  if (!inspectorLogoUrl && round.project.ownerProfileId !== input.requestedByUserId) {
    const ownerProfile = await getProfileContact(round.project.ownerProfileId)
    ownerLogoUrl = resolveProfileLogoUrl(ownerProfile)
  }

  return {
    ...round,
    participants: resolvedParticipants,
    inspectionDocuments,
    branding: {
      inspectorLogoUrl: inspectorLogoUrl ?? ownerLogoUrl,
      inspectorAvatarUrl,
      besiktAppLogoUrl: BESIKTAPP_REPORT_LOGO_SRC,
    },
    reportDraft: buildEbReportDraft({
      round,
      participants: resolvedParticipants,
      attachments,
      inspectionDocuments,
      inspectorText,
      storedDraft,
    }),
  }
}

async function fetchEbReportDraft(input: {
  orgId: string
  projectId: string
  inspectionId: string
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_inspection_details')
    .select('report_draft,report_draft_updated_at')
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)
    .maybeSingle()

  if (error) {
    if (isMissingColumnError(error)) {
      return normalizeEbReportDraft(null, null)
    }
    throw new Error(error.message ?? 'Kunde inte hämta utlåtandeutkast.')
  }

  const row = (data ?? null) as Pick<EbInspectionDetailRow, 'report_draft' | 'report_draft_updated_at'> | null
  return normalizeEbReportDraft(row?.report_draft, row?.report_draft_updated_at ?? null)
}

function normalizeEbReportDraft(value: unknown, updatedAt: string | null): EbReportDraft {
  if (!value || typeof value !== 'object') {
    return { sections: [], updatedAt }
  }

  const rawSections = Array.isArray((value as { sections?: unknown }).sections)
    ? (value as { sections: unknown[] }).sections
    : []

  return {
    updatedAt: typeof (value as { updatedAt?: unknown }).updatedAt === 'string'
      ? (value as { updatedAt: string }).updatedAt
      : updatedAt,
    sections: rawSections.map(normalizeEbReportDraftSection).filter(Boolean) as EbReportDraftSection[],
  }
}

function normalizeEbReportDraftSection(value: unknown): EbReportDraftSection | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<EbReportDraftSection>
  const key = normalizeText(raw.key)
  const title = normalizeText(raw.title)
  const text = typeof raw.text === 'string' ? raw.text : ''
  if (!key || !title) return null

  return {
    key,
    title,
    sbrPoint: normalizeText(raw.sbrPoint),
    source: isEbReportSource(raw.source) ? raw.source : 'manual',
    status: isEbReportStatus(raw.status) ? raw.status : 'draft',
    isRelevant: raw.isRelevant !== false,
    text,
    updatedAt: normalizeText(raw.updatedAt),
  }
}

function isEbReportStatus(value: unknown): value is EbReportSectionStatus {
  return value === 'draft' || value === 'complete' || value === 'missing' || value === 'not_applicable'
}

function isEbReportSource(value: unknown): value is EbReportSectionSource {
  return (
    value === 'project' ||
    value === 'inspection' ||
    value === 'participants' ||
    value === 'notes' ||
    value === 'checkpoints' ||
    value === 'standard_text' ||
    value === 'manual'
  )
}

async function seedDisciplinesForInspection(input: {
  orgId: string
  projectId: string
  inspectionId: string
  variant: EbInspectionVariant
  sequenceNo: number
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('settings_eb_disciplines')
    .select('key,label,littera_prefix,sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta EB-discipliner.')
  }

  const settings = (data ?? []) as EbDisciplineSettingRow[]
  if (settings.length === 0) return
  const inspectionLitteraSuffix = `${input.variant}${input.sequenceNo}`

  const { error: insertError } = await admin.from('eb_disciplines').insert(
    settings.map((setting) => ({
      org_id: input.orgId,
      eb_project_id: input.projectId,
      inspection_id: input.inspectionId,
      discipline_key: setting.key,
      label: setting.label,
      littera: [normalizeText(setting.littera_prefix), inspectionLitteraSuffix]
        .filter(Boolean)
        .join(' '),
      sort_order: setting.sort_order ?? 100,
      is_active: true,
    }))
  )

  if (insertError) {
    throw new Error(insertError.message ?? 'Kunde inte skapa EB-discipliner.')
  }
}

async function cleanupCreatedRows(input: {
  projectId?: string | null
  inspectionId?: string | null
  propertyId?: string | null
}) {
  const admin = createSupabaseAdminClient()
  if (input.projectId) {
    await admin.from('eb_projects').delete().eq('id', input.projectId)
  }
  if (input.inspectionId) {
    await admin.from('inspections').delete().eq('id', input.inspectionId)
  }
  if (input.propertyId) {
    await admin.from('properties').delete().eq('id', input.propertyId)
  }
}

async function seedInitialProjectParticipants(input: {
  orgId: string
  projectId: string
  inspectionId: string
  clientName: string | null
  clientOrgNo: string | null
  contractorName: string | null
  contractorOrgNo: string | null
}) {
  const rows = [
    input.clientName || input.clientOrgNo
      ? {
          org_id: input.orgId,
          eb_project_id: input.projectId,
          inspection_id: input.inspectionId,
          party_key: 'client',
          role_label: 'Beställare',
          company_name: input.clientName,
          org_no: input.clientOrgNo,
          receives_invitation: true,
          attended: false,
          receives_report: true,
          represents_party_key: 'client',
          can_represent_party: true,
          sort_order: 100,
        }
      : null,
    input.contractorName || input.contractorOrgNo
      ? {
          org_id: input.orgId,
          eb_project_id: input.projectId,
          inspection_id: input.inspectionId,
          party_key: 'contractor',
          role_label: 'Entreprenör',
          company_name: input.contractorName,
          org_no: input.contractorOrgNo,
          receives_invitation: true,
          attended: false,
          receives_report: true,
          represents_party_key: 'contractor',
          can_represent_party: true,
          sort_order: 200,
        }
      : null,
  ].filter((row): row is NonNullable<typeof row> => Boolean(row))

  if (rows.length === 0) return

  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('eb_participants').insert(rows)
  if (error) {
    throw new Error(error.message ?? 'Kunde inte skapa parter för EB-projektet.')
  }
}

export async function createEbProjectWithInitialSlb(
  input: CreateEbProjectInput
): Promise<EbProjectListItem> {
  const admin = createSupabaseAdminClient()
  const title = toProjectTitle(input)
  const normalizedAddress = normalizeText(input.address)
  const normalizedClientName = normalizeText(input.clientName)
  const normalizedClientOrgNo = normalizeText(input.clientOrgNo)
  const normalizedClientAddress = normalizeText(input.clientAddress)
  const normalizedClientPostalCode = normalizeText(input.clientPostalCode)
  const normalizedClientCity = normalizeText(input.clientCity)
  const normalizedContractorName = normalizeText(input.contractorName)
  const normalizedContractorOrgNo = normalizeText(input.contractorOrgNo)
  const normalizedContractorAddress = normalizeText(input.contractorAddress)
  const normalizedContractorPostalCode = normalizeText(input.contractorPostalCode)
  const normalizedContractorCity = normalizeText(input.contractorCity)
  const projectTemplateKey = normalizeProjectTemplateKey(input.projectTemplateKey)
  const drainageSystem = projectTemplateKey === 'drainage_foundation'
    ? normalizeDrainageSystem(input.drainageSystem) ?? 'generic'
    : null
  const drainageInspectionStage = projectTemplateKey === 'drainage_foundation'
    ? normalizeDrainageInspectionStage(input.drainageInspectionStage)
    : null
  const drainageGuidanceVersion = projectTemplateKey === 'drainage_foundation'
    ? normalizeText(input.drainageGuidanceVersion)
    : null
  const agreementItems = normalizeAgreementItems(input.agreementItems)
  let propertyId: string | null = null
  let inspectionId: string | null = null
  let projectId: string | null = null

  try {
    const { data: property, error: propertyError } = await admin
      .from('properties')
      .insert({
        owner: input.requestedByUserId,
        name: toPropertyName(input, title),
        status: 'Utkast',
        address: normalizedAddress,
        postal_code: normalizeText(input.postalCode),
        city: normalizeText(input.city),
        municipality: normalizeText(input.municipality),
        cadastral_id: normalizeText(input.propertyDesignation),
        client_name: normalizedClientName,
        owner_name: normalizedClientName,
      })
      .select('id')
      .single()

    if (propertyError || !property) {
      throw new Error(propertyError?.message ?? 'Kunde inte skapa fastighet för EB.')
    }

    propertyId = String(property.id)

    const { data: inspection, error: inspectionError } = await admin
      .from('inspections')
      .insert({
        property_id: propertyId,
        type: 'EB',
        inspection_family: 'EB',
        inspection_variant: 'SLB',
        status: 'draft',
        date: normalizeDate(input.inspectionDate),
        inspection_time: normalizeTime(input.inspectionTime),
        client_name: normalizedClientName,
        scope: getEbInspectionVariantLabel('SLB'),
      })
      .select('id')
      .single()

    if (inspectionError || !inspection) {
      throw new Error(inspectionError?.message ?? 'Kunde inte skapa slutbesiktning.')
    }

    inspectionId = String(inspection.id)

    const { data: project, error: projectError } = await admin
      .from('eb_projects')
      .insert({
        org_id: input.orgId,
        property_id: propertyId,
        owner_profile_id: input.requestedByUserId,
        created_by: input.requestedByUserId,
        project_template_key: projectTemplateKey,
        drainage_system: drainageSystem,
        drainage_inspection_stage: drainageInspectionStage,
        drainage_guidance_version: drainageGuidanceVersion,
        title,
        contract_name: normalizeText(input.contractName),
        object_description: normalizeText(input.objectDescription),
        property_designation: normalizeText(input.propertyDesignation),
        brf_apartment_number: normalizeText(input.brfApartmentNumber),
        address: normalizedAddress,
        postal_code: normalizeText(input.postalCode),
        city: normalizeText(input.city),
        municipality: normalizeText(input.municipality),
        standard_agreement: normalizeText(input.standardAgreement),
        contract_form: normalizeText(input.contractForm),
        procurement_form: normalizeText(input.procurementForm),
        contract_date: normalizeDate(input.contractDate),
        note_prefix: projectTemplateKey === 'drainage_foundation' ? 'DRÄN' : 'BES',
        client_name: normalizedClientName,
        client_org_no: normalizedClientOrgNo,
        client_address: normalizedClientAddress,
        client_postal_code: normalizedClientPostalCode,
        client_city: normalizedClientCity,
        contractor_name: normalizedContractorName,
        contractor_org_no: normalizedContractorOrgNo,
        contractor_address: normalizedContractorAddress,
        contractor_postal_code: normalizedContractorPostalCode,
        contractor_city: normalizedContractorCity,
        agreement_items: agreementItems,
        status: 'active',
      })
      .select('id')
      .single()

    if (projectError || !project) {
      throw new Error(projectError?.message ?? 'Kunde inte skapa EB-projekt.')
    }

    projectId = String(project.id)

    const { error: detailError } = await admin.from('eb_inspection_details').insert({
      inspection_id: inspectionId,
      org_id: input.orgId,
      eb_project_id: projectId,
      inspection_variant: 'SLB',
      sequence_no: 1,
      meeting_place: normalizeText(input.meetingPlace),
      start_meeting_time: normalizeTime(input.startMeetingTime),
      final_meeting_time: normalizeTime(input.finalMeetingTime),
      report_title: `Utlåtande ${getEbInspectionVariantLabel('SLB')}`,
    })

    if (detailError) {
      throw new Error(detailError.message ?? 'Kunde inte koppla slutbesiktningen till EB-projektet.')
    }

    await seedDisciplinesForInspection({
      orgId: input.orgId,
      projectId,
      inspectionId,
      variant: 'SLB',
      sequenceNo: 1,
    })

    await seedInitialProjectParticipants({
      orgId: input.orgId,
      projectId,
      inspectionId,
      clientName: normalizedClientName,
      clientOrgNo: normalizedClientOrgNo,
      contractorName: normalizedContractorName,
      contractorOrgNo: normalizedContractorOrgNo,
    })

    const created = await getEbProjectById({ orgId: input.orgId, projectId })
    if (!created) {
      throw new Error('EB-projektet skapades men kunde inte läsas tillbaka.')
    }

    return created
  } catch (error) {
    await cleanupCreatedRows({ projectId, inspectionId, propertyId })
    throw error
  }
}

export async function updateEbProject(input: UpdateEbProjectInput): Promise<EbProjectListItem> {
  const existing = await getEbProjectById({ orgId: input.orgId, projectId: input.projectId })
  if (!existing) {
    throw new Error('EB_PROJECT_NOT_FOUND')
  }

  const admin = createSupabaseAdminClient()
  const title = toProjectTitle(input)
  const normalizedAddress = normalizeText(input.address)
  const normalizedClientName = normalizeText(input.clientName)
  const normalizedClientOrgNo = normalizeText(input.clientOrgNo)
  const normalizedClientAddress = normalizeText(input.clientAddress)
  const normalizedClientPostalCode = normalizeText(input.clientPostalCode)
  const normalizedClientCity = normalizeText(input.clientCity)
  const normalizedContractorName = normalizeText(input.contractorName)
  const normalizedContractorOrgNo = normalizeText(input.contractorOrgNo)
  const normalizedContractorAddress = normalizeText(input.contractorAddress)
  const normalizedContractorPostalCode = normalizeText(input.contractorPostalCode)
  const normalizedContractorCity = normalizeText(input.contractorCity)
  const normalizedNotePrefix = normalizeText(input.notePrefix) ?? 'BES'
  const projectTemplateKey = normalizeProjectTemplateKey(input.projectTemplateKey)
  const drainageSystem = projectTemplateKey === 'drainage_foundation'
    ? normalizeDrainageSystem(input.drainageSystem) ?? 'generic'
    : null
  const drainageInspectionStage = projectTemplateKey === 'drainage_foundation'
    ? normalizeDrainageInspectionStage(input.drainageInspectionStage)
    : null
  const drainageGuidanceVersion = projectTemplateKey === 'drainage_foundation'
    ? normalizeText(input.drainageGuidanceVersion)
    : null
  const agreementItems = normalizeAgreementItems(input.agreementItems)

  const { error } = await admin
    .from('eb_projects')
    .update({
      project_template_key: projectTemplateKey,
      drainage_system: drainageSystem,
      drainage_inspection_stage: drainageInspectionStage,
      drainage_guidance_version: drainageGuidanceVersion,
      title,
      contract_name: normalizeText(input.contractName),
      object_description: normalizeText(input.objectDescription),
      property_designation: normalizeText(input.propertyDesignation),
      brf_apartment_number: normalizeText(input.brfApartmentNumber),
      address: normalizedAddress,
      postal_code: normalizeText(input.postalCode),
      city: normalizeText(input.city),
      municipality: normalizeText(input.municipality),
      standard_agreement: normalizeText(input.standardAgreement),
      contract_form: normalizeText(input.contractForm),
      procurement_form: normalizeText(input.procurementForm),
      contract_date: normalizeDate(input.contractDate),
      note_prefix: normalizedNotePrefix,
      client_name: normalizedClientName,
      client_org_no: normalizedClientOrgNo,
      client_address: normalizedClientAddress,
      client_postal_code: normalizedClientPostalCode,
      client_city: normalizedClientCity,
      contractor_name: normalizedContractorName,
      contractor_org_no: normalizedContractorOrgNo,
      contractor_address: normalizedContractorAddress,
      contractor_postal_code: normalizedContractorPostalCode,
      contractor_city: normalizedContractorCity,
      agreement_items: agreementItems,
    })
    .eq('org_id', input.orgId)
    .eq('id', input.projectId)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte uppdatera EB-projekt.')
  }

  if (existing.propertyId) {
    const { error: propertyError } = await admin
      .from('properties')
      .update({
        name: toPropertyName(input, title),
        address: normalizedAddress,
        postal_code: normalizeText(input.postalCode),
        city: normalizeText(input.city),
        municipality: normalizeText(input.municipality),
        cadastral_id: normalizeText(input.propertyDesignation),
        client_name: normalizedClientName,
        owner_name: normalizedClientName,
      })
      .eq('id', existing.propertyId)

    if (propertyError) {
      throw new Error(propertyError.message ?? 'Kunde inte uppdatera fastighetsuppgifter.')
    }
  }

  const updated = await getEbProjectById({ orgId: input.orgId, projectId: input.projectId })
  if (!updated) {
    throw new Error('EB_PROJECT_NOT_FOUND')
  }

  return updated
}

async function resolveProjectPropertyId(project: EbProjectListItem) {
  if (project.propertyId) return project.propertyId

  const firstInspectionId = project.inspections[0]?.inspectionId
  if (!firstInspectionId) return null

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('inspections')
    .select('property_id')
    .eq('id', firstInspectionId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta fastighetskoppling.')
  }

  return typeof data?.property_id === 'string' ? data.property_id : null
}

export async function createEbInspectionForProject(
  input: CreateEbInspectionInput
): Promise<EbProjectListItem> {
  const admin = createSupabaseAdminClient()
  const project = await getEbProjectById({
    orgId: input.orgId,
    projectId: input.projectId,
  })

  if (!project) {
    throw new Error('EB_PROJECT_NOT_FOUND')
  }

  const propertyId = await resolveProjectPropertyId(project)
  if (!propertyId) {
    throw new Error('EB_PROJECT_PROPERTY_MISSING')
  }

  let inspectionId: string | null = null
  const sequenceNo =
    project.inspections.reduce((max, inspection) => Math.max(max, inspection.sequenceNo), 0) + 1
  const parentInspectionId =
    normalizeText(input.parentInspectionId) ?? project.inspections.at(-1)?.inspectionId ?? null
  const variantLabel = getEbInspectionVariantLabel(input.variant)

  try {
    const { data: inspection, error: inspectionError } = await admin
      .from('inspections')
      .insert({
        property_id: propertyId,
        type: 'EB',
        inspection_family: 'EB',
        inspection_variant: input.variant,
        status: 'draft',
        date: normalizeDate(input.inspectionDate),
        inspection_time: normalizeTime(input.inspectionTime),
        client_name: project.clientName,
        scope: variantLabel,
      })
      .select('id')
      .single()

    if (inspectionError || !inspection) {
      throw new Error(inspectionError?.message ?? `Kunde inte skapa ${variantLabel}.`)
    }

    inspectionId = String(inspection.id)

    const { error: detailError } = await admin.from('eb_inspection_details').insert({
      inspection_id: inspectionId,
      org_id: input.orgId,
      eb_project_id: project.id,
      parent_inspection_id: parentInspectionId,
      inspection_variant: input.variant,
      sequence_no: sequenceNo,
      meeting_place: normalizeText(input.meetingPlace),
      start_meeting_time: normalizeTime(input.startMeetingTime),
      final_meeting_time: normalizeTime(input.finalMeetingTime),
      report_title: `Utlåtande ${variantLabel}`,
    })

    if (detailError) {
      throw new Error(detailError.message ?? 'Kunde inte koppla besiktningen till EB-projektet.')
    }

    await seedDisciplinesForInspection({
      orgId: input.orgId,
      projectId: project.id,
      inspectionId,
      variant: input.variant,
      sequenceNo,
    })

    const updated = await getEbProjectById({ orgId: input.orgId, projectId: project.id })
    if (!updated) {
      throw new Error('Besiktningen skapades men projektet kunde inte läsas tillbaka.')
    }

    return updated
  } catch (error) {
    if (inspectionId) {
      await admin.from('inspections').delete().eq('id', inspectionId)
    }
    throw error
  }
}

export async function updateEbInspection(input: UpdateEbInspectionInput): Promise<EbProjectListItem> {
  const project = await getEbProjectById({
    orgId: input.orgId,
    projectId: input.projectId,
  })

  if (!project) {
    throw new Error('EB_PROJECT_NOT_FOUND')
  }

  const inspection = project.inspections.find((item) => item.inspectionId === input.inspectionId)
  if (!inspection) {
    throw new Error('EB_INSPECTION_NOT_FOUND')
  }

  await assertEbInspectionEditable(input)

  const admin = createSupabaseAdminClient()
  const { error: inspectionError } = await admin
    .from('inspections')
    .update({
      date: normalizeDate(input.inspectionDate),
      inspection_time: normalizeTime(input.inspectionTime),
    })
    .eq('id', input.inspectionId)

  if (inspectionError) {
    throw new Error(inspectionError.message ?? 'Kunde inte uppdatera besiktningen.')
  }

  const { error: detailError } = await admin
    .from('eb_inspection_details')
    .update({
      meeting_place: normalizeText(input.meetingPlace),
      start_meeting_time: normalizeTime(input.startMeetingTime),
      final_meeting_time: normalizeTime(input.finalMeetingTime),
      inspector_appointed_by: normalizeInspectorAppointedBy(input.inspectorAppointedBy),
      invitation_method: normalizeText(input.invitationMethod),
      invitation_date: normalizeDate(input.invitationDate),
      approval_status: normalizeApprovalStatus(input.approvalStatus),
      approval_note: normalizeText(input.approvalNote),
      requires_continued_final_inspection: normalizeBoolean(input.requiresContinuedFinalInspection),
      continued_final_inspection_date: normalizeDate(input.continuedFinalInspectionDate),
      continued_final_inspection_time: normalizeTime(input.continuedFinalInspectionTime),
      warranty_period_years: normalizeWarrantyYears(input.warrantyPeriodYears),
      warranty_end_date: normalizeDate(input.warrantyEndDate),
      warranty_scope: normalizeText(input.warrantyScope),
      default_remedy_deadline: normalizeDate(input.defaultRemedyDeadline),
      after_inspection_requested: normalizeBoolean(input.afterInspectionRequested),
      after_inspection_requested_by: normalizeAfterInspectionRequestedBy(input.afterInspectionRequestedBy),
      after_inspection_due_date: normalizeDate(input.afterInspectionDueDate),
      after_inspection_notice_in_report: input.afterInspectionNoticeInReport === true,
      inspection_cost_distribution: normalizeText(input.inspectionCostDistribution),
      report_distribution_date: normalizeDate(input.reportDistributionDate),
      previous_inspections: normalizePreviousInspections(input.previousInspections),
      defect_numbering_explanation: normalizeText(input.defectNumberingExplanation),
      defect_no_error_parts_policy: normalizeDefectNoErrorPartsPolicy(input.defectNoErrorPartsPolicy),
    })
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)

  if (detailError) {
    throw new Error(detailError.message ?? 'Kunde inte uppdatera EB-besiktningsuppgifter.')
  }

  const updated = await getEbProjectById({ orgId: input.orgId, projectId: input.projectId })
  if (!updated) {
    throw new Error('EB_PROJECT_NOT_FOUND')
  }

  return updated
}

async function getNextEbNoteNumber(input: {
  orgId: string
  projectId: string
  inspectionId: string
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_notes')
    .select('note_number')
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)
    .not('note_number', 'is', null)
    .order('note_number', { ascending: false })
    .limit(1)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte räkna fram nästa noteringsnummer.')
  }

  const current = Number((data?.[0] as { note_number?: unknown } | undefined)?.note_number ?? 0)
  return Number.isFinite(current) ? current + 1 : 1
}

async function saveEbNoteSuggestion(input: {
  orgId: string
  profileId: string
  sourceNoteId: string
  phrase: string | null
}) {
  const phrase = normalizeText(input.phrase)
  const normalizedPrefix = normalizeSuggestionPrefix(phrase)
  if (!phrase || !normalizedPrefix || phrase.length < 3) return

  const admin = createSupabaseAdminClient()
  const { data: existing, error: selectError } = await admin
    .from('eb_note_suggestions')
    .select('id,use_count')
    .eq('org_id', input.orgId)
    .eq('profile_id', input.profileId)
    .eq('phrase', phrase)
    .maybeSingle()

  if (selectError) {
    throw new Error(selectError.message ?? 'Kunde inte läsa textförslag.')
  }

  const now = new Date().toISOString()
  if (existing?.id) {
    const useCount = Number((existing as { use_count?: unknown }).use_count ?? 1)
    const { error: updateError } = await admin
      .from('eb_note_suggestions')
      .update({
        source_note_id: input.sourceNoteId,
        normalized_prefix: normalizedPrefix,
        use_count: Number.isFinite(useCount) ? useCount + 1 : 2,
        last_used_at: now,
      })
      .eq('id', String(existing.id))

    if (updateError) {
      throw new Error(updateError.message ?? 'Kunde inte uppdatera textförslag.')
    }
    return
  }

  const { error: insertError } = await admin.from('eb_note_suggestions').insert({
    org_id: input.orgId,
    profile_id: input.profileId,
    source_note_id: input.sourceNoteId,
    phrase,
    normalized_prefix: normalizedPrefix,
    use_count: 1,
    last_used_at: now,
  })

  if (insertError) {
    throw new Error(insertError.message ?? 'Kunde inte spara textförslag.')
  }
}

function resolveEbNoteOptions(input: {
  disciplineId: string | null
  markerKey: string | null
  statusKey: string | null
  disciplines: EbDiscipline[]
  markers: EbNoteMarker[]
  statuses: EbNoteStatus[]
}) {
  const disciplineId = normalizeText(input.disciplineId)
  if (!disciplineId || !input.disciplines.some((discipline) => discipline.id === disciplineId)) {
    throw new Error('EB_DISCIPLINE_REQUIRED')
  }

  const firstMarker = input.markers[0]?.key ?? null
  const markerKey = input.markers.some((marker) => marker.key === input.markerKey)
    ? input.markerKey
    : firstMarker
  const defaultStatus =
    input.statuses.find((status) => status.isDefault)?.key ?? input.statuses[0]?.key ?? 'open'
  const statusKey = input.statuses.some((status) => status.key === input.statusKey)
    ? input.statusKey
    : defaultStatus

  return {
    disciplineId,
    markerKey,
    statusKey,
  }
}

async function buildEbNoteContext(input: {
  orgId: string
  requestedByUserId?: string
  projectId: string
  inspectionId: string
}) {
  await getEbInspectionRoundBase(input)
  const [disciplines, markers, statuses] = await Promise.all([
    listEbDisciplines(input),
    listEbNoteMarkers(),
    listEbNoteStatuses(),
  ])
  const disciplinesById = new Map(disciplines.map((discipline) => [discipline.id, discipline]))
  const markersByKey = new Map(markers.map((marker) => [marker.key, marker]))
  const statusesByKey = new Map(statuses.map((status) => [status.key, status]))

  return {
    disciplines,
    markers,
    statuses,
    disciplinesById,
    markersByKey,
    statusesByKey,
  }
}

export async function createEbNote(input: SaveEbNoteInput): Promise<EbNote> {
  await assertEbInspectionEditable(input)
  const admin = createSupabaseAdminClient()
  const context = await buildEbNoteContext(input)
  const noteText = normalizeText(input.noteText)
  if (!noteText) {
    throw new Error('EB_NOTE_TEXT_REQUIRED')
  }

  const options = resolveEbNoteOptions({
    disciplineId: input.disciplineId ?? null,
    markerKey: normalizeText(input.markerKey),
    statusKey: normalizeText(input.statusKey),
    disciplines: context.disciplines,
    markers: context.markers,
    statuses: context.statuses,
  })
  const noteNumber = await getNextEbNoteNumber(input)

  const { data, error } = await admin
    .from('eb_notes')
    .insert({
      org_id: input.orgId,
      eb_project_id: input.projectId,
      inspection_id: input.inspectionId,
      discipline_id: options.disciplineId,
      note_number: noteNumber,
      location: normalizeText(input.location),
      room: normalizeText(input.room),
      place_detail: normalizeText(input.placeDetail),
      marker_key: options.markerKey,
      status_key: options.statusKey,
      note_text: noteText,
      responsible_party: normalizeText(input.responsibleParty),
      trade_group: normalizeText(input.tradeGroup),
      investigation_responsible_party: normalizePartyKey(input.investigationResponsibleParty),
      investigation_responsible_note: normalizeText(input.investigationResponsibleNote),
      investigation_cost_party:
        input.investigationCostParty === 'contractor' || input.investigationCostParty === 'client'
          ? input.investigationCostParty
          : null,
      investigation_due_date: normalizeDate(input.investigationDueDate),
      deduction_amount: normalizeText(input.deductionAmount),
      sort_order: noteNumber * 100,
      created_by: input.requestedByUserId,
      updated_by: input.requestedByUserId,
    })
    .select(
      'id,eb_project_id,inspection_id,discipline_id,note_number,location,room,place_detail,marker_key,status_key,note_text,responsible_party,trade_group,investigation_responsible_party,investigation_responsible_note,investigation_cost_party,investigation_due_date,deduction_amount,sort_order,created_at,updated_at'
    )
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Kunde inte skapa EB-notering.')
  }

  const note = mapNote(
    data as EbNoteRow,
    context.disciplinesById,
    context.markersByKey,
    context.statusesByKey
  )

  await saveEbNoteSuggestion({
    orgId: input.orgId,
    profileId: input.requestedByUserId,
    sourceNoteId: note.id,
    phrase: noteText,
  })

  return note
}

export async function updateEbNote(input: SaveEbNoteInput & { noteId: string }): Promise<EbNote> {
  await assertEbInspectionEditable(input)
  const admin = createSupabaseAdminClient()
  const context = await buildEbNoteContext(input)
  const noteText = normalizeText(input.noteText)
  if (!noteText) {
    throw new Error('EB_NOTE_TEXT_REQUIRED')
  }

  const options = resolveEbNoteOptions({
    disciplineId: input.disciplineId ?? null,
    markerKey: normalizeText(input.markerKey),
    statusKey: normalizeText(input.statusKey),
    disciplines: context.disciplines,
    markers: context.markers,
    statuses: context.statuses,
  })

  const { data, error } = await admin
    .from('eb_notes')
    .update({
      discipline_id: options.disciplineId,
      location: normalizeText(input.location),
      room: normalizeText(input.room),
      place_detail: normalizeText(input.placeDetail),
      marker_key: options.markerKey,
      status_key: options.statusKey,
      note_text: noteText,
      responsible_party: normalizeText(input.responsibleParty),
      trade_group: normalizeText(input.tradeGroup),
      investigation_responsible_party: normalizePartyKey(input.investigationResponsibleParty),
      investigation_responsible_note: normalizeText(input.investigationResponsibleNote),
      investigation_cost_party:
        input.investigationCostParty === 'contractor' || input.investigationCostParty === 'client'
          ? input.investigationCostParty
          : null,
      investigation_due_date: normalizeDate(input.investigationDueDate),
      deduction_amount: normalizeText(input.deductionAmount),
      updated_by: input.requestedByUserId,
    })
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)
    .eq('id', input.noteId)
    .select(
      'id,eb_project_id,inspection_id,discipline_id,note_number,location,room,place_detail,marker_key,status_key,note_text,responsible_party,trade_group,investigation_responsible_party,investigation_responsible_note,investigation_cost_party,investigation_due_date,deduction_amount,sort_order,created_at,updated_at'
    )
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte uppdatera EB-notering.')
  }
  if (!data) {
    throw new Error('EB_NOTE_NOT_FOUND')
  }

  const note = mapNote(
    data as EbNoteRow,
    context.disciplinesById,
    context.markersByKey,
    context.statusesByKey
  )

  await saveEbNoteSuggestion({
    orgId: input.orgId,
    profileId: input.requestedByUserId,
    sourceNoteId: note.id,
    phrase: noteText,
  })

  return note
}

export async function deleteEbNote(input: DeleteEbNoteInput) {
  await assertEbInspectionEditable(input)
  await getEbInspectionRoundBase(input)
  const admin = createSupabaseAdminClient()
  const { error: imageDetachError } = await admin
    .from('inspection_images')
    .update({ eb_note_id: null })
    .eq('inspection_id', input.inspectionId)
    .eq('eb_note_id', input.noteId)
    .like('file_path', `${input.inspectionId}/eb-notes/%`)

  if (imageDetachError) {
    throw new Error(imageDetachError.message ?? 'Kunde inte koppla loss EB-bilder.')
  }

  const { error, count } = await admin
    .from('eb_notes')
    .delete({ count: 'exact' })
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)
    .eq('id', input.noteId)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte radera EB-notering.')
  }
  if (count === 0) {
    throw new Error('EB_NOTE_NOT_FOUND')
  }
}

export async function reorderEbNote(input: ReorderEbNoteInput) {
  await assertEbInspectionEditable(input)
  await getEbInspectionRoundBase(input)
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_notes')
    .select('id,note_number,sort_order,created_at')
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('note_number', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte läsa EB-noteringar.')
  }

  const rows = ((data ?? []) as Array<Pick<EbNoteRow, 'id' | 'note_number' | 'sort_order' | 'created_at'>>).sort((left, right) => {
    const leftSort = left.sort_order ?? (left.note_number ?? 0) * 100
    const rightSort = right.sort_order ?? (right.note_number ?? 0) * 100
    if (leftSort !== rightSort) return leftSort - rightSort
    if ((left.note_number ?? 0) !== (right.note_number ?? 0)) {
      return (left.note_number ?? 0) - (right.note_number ?? 0)
    }
    return String(left.created_at ?? '').localeCompare(String(right.created_at ?? ''))
  })
  const currentIndex = rows.findIndex((row) => row.id === input.noteId)
  if (currentIndex === -1) {
    throw new Error('EB_NOTE_NOT_FOUND')
  }

  const targetIndex = input.direction === 'up' ? currentIndex - 1 : currentIndex + 1
  if (targetIndex < 0 || targetIndex >= rows.length) {
    return
  }

  const current = rows[currentIndex]
  const target = rows[targetIndex]
  const currentSortOrder = current.sort_order ?? (currentIndex + 1) * 100
  const targetSortOrder = target.sort_order ?? (targetIndex + 1) * 100

  const updateResults = await Promise.all(
    [
      { id: current.id, sortOrder: targetSortOrder },
      { id: target.id, sortOrder: currentSortOrder },
    ].map((row) =>
      admin
        .from('eb_notes')
        .update({ sort_order: row.sortOrder })
        .eq('org_id', input.orgId)
        .eq('eb_project_id', input.projectId)
        .eq('inspection_id', input.inspectionId)
        .eq('id', row.id)
    )
  )
  const updateError = updateResults.find((result) => result.error)?.error
  if (updateError) {
    throw new Error(updateError.message ?? 'Kunde inte uppdatera noteringsordning.')
  }
}

export async function reorderEbNotes(input: ReorderEbNotesInput) {
  await assertEbInspectionEditable(input)
  await getEbInspectionRoundBase(input)
  const orderedNoteIds = Array.from(
    new Set(input.orderedNoteIds.map((id) => normalizeText(id)).filter(Boolean) as string[])
  )
  if (orderedNoteIds.length === 0) {
    throw new Error('EB_NOTE_ORDER_EMPTY')
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_notes')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte läsa EB-noteringar.')
  }

  const existingIds = new Set(((data ?? []) as Array<Pick<EbNoteRow, 'id'>>).map((row) => row.id))
  const hasEveryExistingNote = existingIds.size === orderedNoteIds.length &&
    orderedNoteIds.every((noteId) => existingIds.has(noteId))
  if (!hasEveryExistingNote) {
    throw new Error('EB_NOTE_ORDER_INVALID')
  }

  const updateResults = await Promise.all(
    orderedNoteIds.map((noteId, index) =>
      admin
        .from('eb_notes')
        .update({ sort_order: (index + 1) * 100 })
        .eq('org_id', input.orgId)
        .eq('eb_project_id', input.projectId)
        .eq('inspection_id', input.inspectionId)
        .eq('id', noteId)
    )
  )
  const updateError = updateResults.find((result) => result.error)?.error
  if (updateError) {
    throw new Error(updateError.message ?? 'Kunde inte uppdatera noteringsordning.')
  }
}

async function getEbInspectionDetail(input: {
  orgId: string
  projectId: string
  inspectionId: string
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_inspection_details')
    .select(
      'inspection_id,eb_project_id,inspection_variant,meeting_place,start_meeting_time,final_meeting_time,invitation_sent_at,invitation_method,invitation_date,invitation_subject,invitation_body'
    )
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta kallelseunderlag.')
  }

  return (data ?? null) as EbInvitationDetailRow | null
}

function mapParticipant(row: EbParticipantRow): EbInvitationParticipant {
  return {
    id: row.id,
    roleLabel: row.role_label ?? null,
    companyName: row.company_name ?? null,
    personName: row.person_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    receivesInvitation: row.receives_invitation ?? true,
    attended: row.attended ?? false,
    receivesReport: row.receives_report ?? true,
    representsPartyKey: normalizePartyKey(row.represents_party_key),
    canRepresentParty: row.can_represent_party ?? false,
    sortOrder: row.sort_order ?? 100,
  }
}

function buildDefaultParticipants(project: EbProjectListItem): EbInvitationParticipant[] {
  const rows: EbInvitationParticipant[] = []

  if (project.clientName) {
    rows.push({
      id: null,
      roleLabel: 'Beställare',
      companyName: project.clientName,
      personName: null,
      email: null,
      phone: null,
      receivesInvitation: true,
      attended: false,
      receivesReport: true,
      representsPartyKey: 'client',
      canRepresentParty: true,
      sortOrder: 100,
    })
  }

  if (project.contractorName) {
    rows.push({
      id: null,
      roleLabel: 'Entreprenör',
      companyName: project.contractorName,
      personName: null,
      email: null,
      phone: null,
      receivesInvitation: true,
      attended: false,
      receivesReport: true,
      representsPartyKey: 'contractor',
      canRepresentParty: true,
      sortOrder: 200,
    })
  }

  if (rows.length > 0) return rows

  return [
    {
      id: null,
      roleLabel: 'Mottagare',
      companyName: null,
      personName: null,
      email: null,
      phone: null,
      receivesInvitation: true,
      attended: false,
      receivesReport: true,
      representsPartyKey: null,
      canRepresentParty: false,
      sortOrder: 100,
    },
  ]
}

function reportLine(label: string, value: string | null | undefined) {
  return `${label}: ${normalizeText(value) ?? 'Ej angivet'}`
}

function reportList(values: Array<string | null | undefined>) {
  const lines = values.map(normalizeText).filter(Boolean)
  return lines.length > 0 ? lines.join('\n') : 'Ej angivet'
}

function optionalReportLine(label: string, value: string | null | undefined) {
  const normalized = normalizeText(value)
  return normalized ? `${label}: ${normalized}` : null
}

function appointedByLabel(value: EbInspectorAppointedBy | null) {
  if (value === 'client') return 'Beställare'
  if (value === 'parties_jointly') return 'Parterna gemensamt'
  if (value === 'contractor') return 'Entreprenör'
  return null
}

function approvalStatusLabel(value: EbApprovalStatus | null) {
  if (value === 'approved') return 'Godkänd'
  if (value === 'not_approved') return 'Ej godkänd'
  if (value === 'partly_approved') return 'Delvis godkänd'
  return null
}

function yesNoLabel(value: boolean | null) {
  if (value === true) return 'Ja'
  if (value === false) return 'Nej'
  return null
}

function partyLabel(value: EbPartyKey | null) {
  if (value === 'client') return 'Beställare'
  if (value === 'contractor') return 'Entreprenör'
  if (value === 'other') return 'Annan'
  return null
}

function afterInspectionRequestedByReportLabel(value: EbAfterInspectionRequestedBy | null) {
  if (value === 'client') return 'beställaren'
  if (value === 'contractor') return 'hantverkaren'
  return 'beställaren / hantverkaren'
}

function drainageSystemLabel(value: EbDrainageSystem | null) {
  if (value === 'isodran') return 'Isodrän'
  if (value === 'pordran') return 'Pordrän'
  if (value === 'other') return 'Annat system'
  if (value === 'generic') return 'Allmän dräneringsmall'
  return null
}

function drainageInspectionStageLabel(value: EbDrainageInspectionStage | null) {
  if (value === 'before_backfill') return 'Före återfyllning'
  if (value === 'after_backfill') return 'Efter återfyllning'
  if (value === 'partial') return 'Delvis återfyllt / delvis åtkomligt'
  if (value === 'final') return 'Slutkontroll'
  return null
}

function checkpointStatusLabel(value: EbInspectionCheckpointStatus) {
  if (value === 'ok') return 'OK'
  if (value === 'deviation') return 'Avvikelse'
  if (value === 'not_applicable') return 'Ej aktuellt'
  if (value === 'not_accessible') return 'Ej åtkomligt'
  if (value === 'not_verifiable') return 'Ej verifierbart'
  return 'Ej kontrollerat'
}

function reportParticipantRow(participant: EbInvitationParticipant) {
  const name = [participant.companyName, participant.personName].map(normalizeText).filter(Boolean).join(', ')
  const contact = [participant.email, participant.phone].map(normalizeText).filter(Boolean).join(', ')
  const representation =
    participant.canRepresentParty && participant.representsPartyKey
      ? `För talan för: ${partyLabel(participant.representsPartyKey)}`
      : null

  return reportList([
    participant.roleLabel ? `${participant.roleLabel}: ${name || 'Ej angivet'}` : name,
    contact,
    representation,
  ])
}

function hasText(value: string | null | undefined) {
  return Boolean(normalizeText(value))
}

function ebDrainageChecklistReportText(round: EbInspectionRound) {
  if (round.checkpoints.length === 0) {
    return 'Ingen dräneringskontrollista är registrerad för besiktningen.'
  }

  const statusCounts = new Map<EbInspectionCheckpointStatus, number>()
  for (const checkpoint of round.checkpoints) {
    statusCounts.set(checkpoint.status, (statusCounts.get(checkpoint.status) ?? 0) + 1)
  }

  const statusSummary = CHECKPOINT_STATUS_VALUES
    .map((status) => {
      const count = statusCounts.get(status)
      return count ? `${checkpointStatusLabel(status)}: ${count}` : null
    })
    .filter(Boolean)
    .join(', ')

  const notVerifiableCount =
    (statusCounts.get('not_accessible') ?? 0) + (statusCounts.get('not_verifiable') ?? 0)

  return reportList([
    optionalReportLine('Mall', 'Dränering och fuktskydd grund/källarvägg'),
    optionalReportLine('System', drainageSystemLabel(round.project.drainageSystem)),
    optionalReportLine('Besiktningsläge', drainageInspectionStageLabel(round.project.drainageInspectionStage)),
    optionalReportLine('Anvisning/version', round.project.drainageGuidanceVersion),
    `Kontrollpunkter: ${round.checkpoints.length}`,
    statusSummary ? `Status: ${statusSummary}` : null,
    notVerifiableCount > 0
      ? `${notVerifiableCount} kontrollpunkter är markerade som ej åtkomliga eller ej verifierbara.`
      : null,
  ])
}

function ebStandardText(id: StandardTextId) {
  return loadStandardText(id).trim()
}

function ebAttachmentTitle(attachment: EbProjectAttachment) {
  return attachment.title || attachment.fileName || 'Bilaga'
}

function ebAttachmentReportRow(attachment: EbProjectAttachment) {
  const heading = attachment.littera
    ? `${attachment.littera}. ${ebAttachmentTitle(attachment)}`
    : ebAttachmentTitle(attachment)
  const details = [
    optionalReportLine('Datum', attachment.documentDate),
    optionalReportLine('Nr/revision', attachment.documentNumber),
    attachment.documentNote,
  ].map(normalizeText).filter(Boolean)
  return details.length > 0 ? `${heading}\n${details.join('\n')}` : heading
}

function isHandoverDocument(document: EbInspectionDocument) {
  return normalizeText(document.resultLabel)?.toLocaleLowerCase('sv-SE').includes('överlämnas') ?? false
}

function ebInspectionDocumentReportRow(document: EbInspectionDocument) {
  if (isHandoverDocument(document)) {
    if (document.status === 'present') return `• ${document.title} överlämnas.`
    return null
  }

  if (document.status === 'present') {
    const date = document.documentDate ?? 'datum ej angivet'
    return `• ${document.title} Datum: ${date}`
  }
  return null
}

function ebTestingDocumentationReportText(documents: EbInspectionDocument[]) {
  const standardText = ebStandardText('EB_REPORT_TESTING_DOCUMENTATION')
  const [intro, ...rest] = standardText.split(/\n{2,}/)
  const beforeList = rest.length > 1 ? rest.slice(0, -1).join('\n\n') : ''
  const conclusion = rest.length > 1 ? rest[rest.length - 1] : rest.join('\n\n')
  const documentRows = documents
    .map(ebInspectionDocumentReportRow)
    .filter((row): row is string => Boolean(row))

  const documentText =
    documentRows.length > 0
      ? documentRows.join('\n')
      : 'Inga dokument har markerats som redovisade för granskning.'

  return [intro, beforeList, documentText, conclusion].map(normalizeText).filter(Boolean).join('\n\n')
}

function ebNoteReportReference(round: EbInspectionRound, note: EbNote) {
  return `${round.project.notePrefix} ${note.noteNumber ?? '-'}`
}

function ebSummonsReportText(round: EbInspectionRound) {
  const method = normalizeText(round.inspection.invitationMethod)
  const invitationDate = normalizeText(
    round.inspection.invitationDate ?? round.inspection.invitationSentAt
  )

  if (method && invitationDate) {
    return `Besiktningsmannen har ${invitationDate} kallat parterna per ${method}.`
  }
  if (invitationDate) {
    return `Besiktningsmannen har kallat parterna ${invitationDate}.`
  }
  if (method) {
    return `Besiktningsmannen har kallat parterna per ${method}.`
  }
  return ebStandardText('EB_REPORT_SUMMONS_MISSING')
}

function ebApprovalDecisionReportText(round: EbInspectionRound) {
  const decisionDate = normalizeText(round.inspection.date)
  const decisionLabel = approvalStatusLabel(round.inspection.approvalStatus)
  if (!round.inspection.approvalStatus || !decisionLabel) {
    return ebStandardText('EB_REPORT_APPROVAL_DECISION')
  }

  const dateSuffix = decisionDate ? ` ${decisionDate}` : ''
  const decisionText =
    round.inspection.approvalStatus === 'approved'
      ? `De delar av entreprenaden som omfattas av besiktningen godkänns${dateSuffix}.`
      : round.inspection.approvalStatus === 'not_approved'
        ? `De delar av entreprenaden som omfattas av besiktningen godkänns inte${dateSuffix}.`
        : `De delar av entreprenaden som omfattas av besiktningen godkänns delvis${dateSuffix}.`

  return reportList([
    decisionText,
    round.inspection.approvalNote,
    decisionDate ? 'Beslutet meddelades av besiktningsmannen till parterna vid besiktningen.' : null,
  ])
}

function ebContinuedFinalInspectionReportText(round: EbInspectionRound) {
  const date = normalizeText(round.inspection.continuedFinalInspectionDate)
  const time = normalizeText(round.inspection.continuedFinalInspectionTime)?.slice(0, 5)
  const scheduleLine =
    date || time
      ? `Enligt överenskommelse verkställs ny slutbesiktning ${date ?? 'Klicka här - ange datum'}, kl ${time ?? '??:??'}.`
      : null

  return reportList([
    ebStandardText('EB_REPORT_CONTINUED_FINAL_INSPECTION'),
    scheduleLine,
  ])
}

function ebRemedyDeadlineAgreementReportText(round: EbInspectionRound) {
  const remedyDeadline = normalizeText(round.inspection.defaultRemedyDeadline)
  const afterInspectionDate = normalizeText(round.inspection.afterInspectionDueDate)
  const afterInspectionRequestedBy = afterInspectionRequestedByReportLabel(
    round.inspection.afterInspectionRequestedBy
  )

  return reportList([
    remedyDeadline
      ? `Parterna har överenskommit att fel skall vara avhjälpta senast till ${remedyDeadline}.`
      : 'Parterna har inte angett någon överenskommelse om när fel skall vara avhjälpta.',
    round.inspection.afterInspectionRequested === true
      ? `Efterbesiktning som påkallats av ${afterInspectionRequestedBy} görs ${
          afterInspectionDate ?? 'datum ej angivet'
        }.`
      : round.inspection.afterInspectionRequested === false
        ? 'Efterbesiktning har inte påkallats vid tidpunkten för utlåtandets upprättande.'
        : null,
    round.inspection.afterInspectionNoticeInReport ? 'Denna notering gäller som kallelse.' : null,
  ])
}

function ebReclamationNoticeReportText(round: EbInspectionRound) {
  const warrantyEndDate = normalizeText(round.inspection.warrantyEndDate)
  const warrantyScope = normalizeText(round.inspection.warrantyScope)
  const warrantyText =
    warrantyEndDate && warrantyScope
      ? [
          'Särskild varugaranti enligt nedan gäller till och med:',
          `• ${warrantyEndDate} för ${warrantyScope}`,
        ].join('\n')
      : 'Särskild varugaranti enligt nedan gäller till och med:\n-'

  return reportList([
    ebStandardText('EB_REPORT_RECLAMATION_NOTICE'),
    warrantyText,
  ])
}

function addressCityLine(postalCode: string | null | undefined, city: string | null | undefined) {
  return [normalizeText(postalCode), normalizeText(city)].filter(Boolean).join(' ') || '-'
}

function ebContractPartiesReportText(round: EbInspectionRound) {
  const vocabulary = resolveEbAgreementVocabulary(round.project.standardAgreement)

  return reportList([
    `Avtalsform: ${vocabulary.agreementLine}`,
    'Parter',
    reportList([
      `${vocabulary.clientLabel}: ${normalizeText(round.project.clientName) ?? '-'}`,
      `Adress: ${normalizeText(round.project.clientAddress) ?? '-'}`,
      `Adress: ${addressCityLine(round.project.clientPostalCode, round.project.clientCity)}`,
    ]),
    reportList([
      `${vocabulary.contractorLabel}: ${normalizeText(round.project.contractorName) ?? '-'}`,
      `Adress: ${normalizeText(round.project.contractorAddress) ?? '-'}`,
      `Adress: ${addressCityLine(round.project.contractorPostalCode, round.project.contractorCity)}`,
      `Org.nr: ${normalizeText(round.project.contractorOrgNo) ?? '-'}`,
    ]),
  ])
}

function sentenceWithPeriod(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function agreementReference(standardAgreement: string | null | undefined) {
  const vocabulary = resolveEbAgreementVocabulary(standardAgreement)
  return vocabulary.agreementLine.replace(/^Enligt\s+/i, '')
}

function ebAgreementChangeOrderLine(item: EbProjectAgreementItem) {
  const title = normalizeText(item.title) ?? 'Bilaga till avtalet enligt formulär Ändring och tilläggsarbeten'
  const dateText = item.documentDate ? ` undertecknat av parterna ${item.documentDate}` : ''
  const noteText = item.note ? ` ${item.note}` : ''
  return sentenceWithPeriod(`${title}${dateText}${noteText}`)
}

function ebAgreementOtherLine(item: EbProjectAgreementItem) {
  const title = normalizeText(item.title) ?? 'Övrig handling eller överenskommelse'
  const note = normalizeText(item.note)
  const dateText = item.documentDate ? `, ${item.documentDate}` : ''
  return `• ${sentenceWithPeriod([title, note].filter(Boolean).join(' - ') + dateText)}`
}

function ebContractDocumentsReportText(round: EbInspectionRound) {
  const reportItems = round.project.agreementItems.filter((item) => item.includeInReport)
  const changeOrders = reportItems.filter((item) => item.kind === 'change_order')
  const otherAgreementItems = reportItems.filter((item) => item.kind === 'other')
  const otherRows = otherAgreementItems.map(ebAgreementOtherLine)

  return [
    `Arbetenas omfattning framgår av skriftligt avtal enligt ${agreementReference(round.project.standardAgreement)} undertecknat av parterna ${round.project.contractDate ?? 'datum ej angivet'}.`,
    [
      'Därutöver har skriftligt avtalats om ändringar och tilläggsarbeten enligt följande:',
      changeOrders.length > 0
        ? changeOrders.map(ebAgreementChangeOrderLine).join('\n')
        : 'Inga ÄTA-handlingar är registrerade.',
    ].join('\n'),
    [
      'I övrigt har för besiktningen följande handlingar och överenskommelser utgjort underlag:',
      otherRows.length > 0
        ? otherRows.join('\n')
        : '• Inga övriga handlingar eller överenskommelser är registrerade.',
    ].join('\n'),
  ].join('\n\n')
}

function previousInspectionStatusLabel(value: EbPreviousInspectionStatus | null) {
  if (value === 'performed') return 'Utförd'
  if (value === 'not_performed') return 'Ej utförd'
  if (value === 'not_applicable') return 'Ej aktuell'
  return 'Ej angivet'
}

function ebPreviousInspectionsReportText(round: EbInspectionRound) {
  const rows = round.inspection.previousInspections.filter(
    (row) => normalizeText(row.label) || row.status || row.date
  )
  if (rows.length === 0) return '-'

  return rows
    .map((row) =>
      reportList([
        row.label || '-',
        previousInspectionStatusLabel(row.status),
        row.status === 'performed'
          ? row.date ?? 'Klicka här - ange datum'
          : row.date,
      ])
    )
    .join('\n\n')
}

function ebSpecialInvestigationReportRow(round: EbInspectionRound, note: EbNote) {
  return reportList([
    `${ebNoteReportReference(round, note)}: ${note.noteText}`,
    optionalReportLine('Ansvarig', partyLabel(note.investigationResponsibleParty)),
    note.investigationResponsibleNote,
    optionalReportLine('Kostnadsansvar', partyLabel(note.investigationCostParty)),
    optionalReportLine('Klar senast', note.investigationDueDate),
  ])
}

function ebDeductionReportRow(round: EbInspectionRound, note: EbNote) {
  return reportList([
    `${ebNoteReportReference(round, note)}: ${note.noteText}`,
    optionalReportLine('Belopp', note.deductionAmount),
  ])
}

function isReportInstructionText(text: string | null | undefined) {
  const normalized = normalizeText(String(text ?? '').replace(/\r\n/g, '\n').replace(/\\n/g, '\n'))
  if (!normalized) return false
  return (
    normalized.startsWith('Ange ') ||
    normalized.includes(' Komplettera ') ||
    normalized.includes('Komplettera om ')
  )
}

function shouldKeepStoredReportSection(
  existing: EbReportDraftSection | undefined,
  fallback: EbReportDraftSection
): existing is EbReportDraftSection {
  if (!existing) return false
  if (isReportInstructionText(existing.text)) return false
  if (existing.status === 'missing' && fallback.status !== 'missing') return false
  return true
}

function isObCertificationText(value: string | null | undefined) {
  const normalized = normalizeText(value)?.toLocaleLowerCase('sv-SE') ?? ''
  return normalized.includes('överlåtelse') || normalized.includes('overlatelse')
}

function buildEbReportDraft(input: {
  round: EbInspectionRound
  participants: EbInvitationParticipant[]
  attachments: EbProjectAttachment[]
  inspectionDocuments: EbInspectionDocument[]
  inspectorText: string
  storedDraft: EbReportDraft
}): EbReportDraft {
  const { round, participants, attachments, inspectionDocuments, inspectorText, storedDraft } = input
  const now = new Date().toISOString()
  const today = now.slice(0, 10)
  const existingByKey = new Map(storedDraft.sections.map((section) => [section.key, section]))
  const noteCount = round.notes.length
  const checkpointCount = round.checkpoints.length
  const drainageChecklistRelevant = shouldUseEbTemplateCheckpoints(round.project) || checkpointCount > 0
  const notAccessibleNotes = round.notes.filter((note) => note.statusKey === 'not_accessible')
  const participantRows = participants.map(reportParticipantRow)
  const presentParticipantRows =
    participants.some((participant) => participant.attended)
      ? participants.filter((participant) => participant.attended).map(reportParticipantRow)
      : participantRows
  const reportRecipientRows =
    participants.filter((participant) => participant.receivesReport).map(reportParticipantRow)
  const conflictOfInterestRelevant = round.inspection.inspectorAppointedBy === 'parties_jointly'
  const includedAttachments = attachments.filter((attachment) => attachment.includeInReport)
  const contractDocuments = ebContractDocumentsReportText(round)
  const includedAgreementItems = round.project.agreementItems.filter((item) => item.includeInReport)
  const testingDocumentationText = ebTestingDocumentationReportText(inspectionDocuments)
  const hasReviewedDocuments = inspectionDocuments.some((document) => document.status === 'present')
  const hasDocumentRemarks = inspectionDocuments.some((document) => document.status !== 'na')
  const appendices = includedAttachments.length > 0
    ? includedAttachments.map(ebAttachmentReportRow).join('\n\n')
    : ebStandardText('EB_REPORT_APPENDICES')
  const specialInvestigationNotes = round.notes.filter(
    (note) =>
      note.markerKey === 'S' ||
      Boolean(
        note.investigationResponsibleParty ||
          note.investigationResponsibleNote ||
          note.investigationCostParty ||
          note.investigationDueDate
      )
  )
  const deductionNotes = round.notes.filter(
    (note) => note.markerKey === 'N' || Boolean(note.deductionAmount)
  )

  const defaults: EbReportDraftSection[] = [
    {
      key: 'inspection_type',
      title: 'Typ av besiktning',
      sbrPoint: '1',
      source: 'inspection',
      status: 'complete',
      isRelevant: true,
      text: `${round.inspection.variantLabel} ${round.inspection.sequenceNo}.`,
      updatedAt: null,
    },
    {
      key: 'scope',
      title: 'Besiktningens omfattning',
      sbrPoint: '2',
      source: 'standard_text',
      status: 'complete',
      isRelevant: true,
      text: ebStandardText('EB_REPORT_SCOPE'),
      updatedAt: null,
    },
    {
      key: 'inspection_time',
      title: 'Tid för besiktningen',
      sbrPoint: '3',
      source: 'inspection',
      status: round.inspection.date ? 'complete' : 'missing',
      isRelevant: true,
      text: reportList([
        optionalReportLine('Datum', round.inspection.date),
        optionalReportLine('Tid', round.inspection.inspectionTime),
      ]),
      updatedAt: null,
    },
    {
      key: 'contract_parties',
      title: 'Avtalade arbeten och parter',
      sbrPoint: '4',
      source: 'project',
      status: 'complete',
      isRelevant: true,
      text: ebContractPartiesReportText(round),
      updatedAt: null,
    },
    {
      key: 'inspectors',
      title: 'Besiktningsman',
      sbrPoint: '5',
      source: 'manual',
      status: hasText(inspectorText) ? 'complete' : 'missing',
      isRelevant: true,
      text: reportList([
        inspectorText,
        round.inspection.inspectorAppointedBy
          ? reportLine('Utsedd av', appointedByLabel(round.inspection.inspectorAppointedBy))
          : null,
      ]),
      updatedAt: null,
    },
    {
      key: 'participants',
      title: 'Närvarande',
      sbrPoint: '6',
      source: 'participants',
      status: presentParticipantRows.length > 0 ? 'complete' : 'missing',
      isRelevant: true,
      text: presentParticipantRows.length > 0 ? presentParticipantRows.join('\n\n') : 'Inga närvarande är registrerade.',
      updatedAt: null,
    },
    {
      key: 'summons',
      title: 'Sättet för kallelse',
      sbrPoint: '7',
      source: 'inspection',
      status: round.inspection.invitationDate || round.inspection.invitationSentAt ? 'complete' : 'draft',
      isRelevant: true,
      text: ebSummonsReportText(round),
      updatedAt: null,
    },
    {
      key: 'conflict_of_interest',
      title: 'Fråga om jäv',
      sbrPoint: '8',
      source: 'standard_text',
      status: conflictOfInterestRelevant ? 'draft' : 'not_applicable',
      isRelevant: conflictOfInterestRelevant,
      text: ebStandardText('EB_REPORT_CONFLICT_OF_INTEREST'),
      updatedAt: null,
    },
    {
      key: 'previous_inspections_tests',
      title: 'Tidigare besiktningar och provningar',
      sbrPoint: '9',
      source: 'manual',
      status: 'complete',
      isRelevant: true,
      text: ebPreviousInspectionsReportText(round),
      updatedAt: null,
    },
    {
      key: 'testing_documentation',
      title: 'Provning, dokumentation',
      sbrPoint: '9',
      source: 'manual',
      status: hasReviewedDocuments || hasDocumentRemarks ? 'complete' : 'draft',
      isRelevant: true,
      text: testingDocumentationText,
      updatedAt: null,
    },
    {
      key: 'contract_documents',
      title: 'Avtal, handlingar och andra överenskommelser',
      sbrPoint: '10',
      source: 'project',
      status: round.project.contractDate || includedAgreementItems.length > 0
        ? 'complete'
        : 'draft',
      isRelevant: true,
      text: contractDocuments,
      updatedAt: null,
    },
    {
      key: 'not_accessible',
      title: 'Delar som inte varit åtkomliga',
      sbrPoint: '11',
      source: 'notes',
      status: 'complete',
      isRelevant: true,
      text:
        notAccessibleNotes.length > 0
          ? notAccessibleNotes.map((note) => `${ebNoteReportReference(round, note)}: ${note.noteText}`).join('\n')
          : ebStandardText('EB_REPORT_NOT_ACCESSIBLE_NONE'),
      updatedAt: null,
    },
    {
      key: 'documentation_only',
      title: 'Delar besiktigade endast genom handling',
      sbrPoint: '12',
      source: 'manual',
      status: 'complete',
      isRelevant: true,
      text: ebStandardText('EB_REPORT_DOCUMENTATION_ONLY'),
      updatedAt: null,
    },
    {
      key: 'appendices',
      title: 'Bilagor och littera',
      sbrPoint: null,
      source: 'project',
      status: includedAttachments.length > 0 ? 'complete' : 'draft',
      isRelevant: true,
      text: appendices,
      updatedAt: null,
    },
    {
      key: 'drainage_checklist',
      title: 'Kontrollunderlag dränering',
      sbrPoint: null,
      source: 'checkpoints',
      status: checkpointCount > 0 ? 'complete' : 'draft',
      isRelevant: drainageChecklistRelevant,
      text: ebDrainageChecklistReportText(round),
      updatedAt: null,
    },
    {
      key: 'defects_appendices',
      title: 'Fel och förhållanden',
      sbrPoint: '13-17, 23',
      source: 'notes',
      status: noteCount > 0 ? 'complete' : 'missing',
      isRelevant: true,
      text:
        noteCount > 0
          ? 'Under denna rubrik är angivna förhållanden som besiktningsmannen anser utgöra fel.'
          : ebStandardText('EB_REPORT_DEFECTS_APPENDICES_EMPTY'),
      updatedAt: null,
    },
    {
      key: 'marker_legend',
      title: 'Beteckningar för noteringar',
      sbrPoint: '13-17, 23',
      source: 'notes',
      status: round.markers.length > 0 ? 'complete' : 'missing',
      isRelevant: true,
      text:
        round.markers.length > 0
          ? reportList([
              round.markers.map((marker) => `${marker.key}: ${marker.label}`).join('\n'),
              ebStandardText('EB_REPORT_NOTE_LEGEND'),
            ])
          : ebStandardText('EB_REPORT_MARKER_LEGEND_MISSING'),
      updatedAt: null,
    },
    {
      key: 'special_investigation',
      title: 'Särskild utredning',
      sbrPoint: '13-17, 23',
      source: 'notes',
      status: 'not_applicable',
      isRelevant: false,
      text:
        specialInvestigationNotes.length > 0
          ? specialInvestigationNotes.map((note) => ebSpecialInvestigationReportRow(round, note)).join('\n\n')
          : ebStandardText('EB_REPORT_SPECIAL_INVESTIGATION'),
      updatedAt: null,
    },
    {
      key: 'deduction',
      title: 'Nedsättning',
      sbrPoint: '13-17, 23',
      source: 'notes',
      status: deductionNotes.length > 0 ? 'complete' : 'draft',
      isRelevant: true,
      text:
        deductionNotes.length > 0
          ? deductionNotes.map((note) => ebDeductionReportRow(round, note)).join('\n\n')
          : ebStandardText('EB_REPORT_DEDUCTION'),
      updatedAt: null,
    },
    {
      key: 'notes',
      title: 'Noteringar',
      sbrPoint: null,
      source: 'notes',
      status: noteCount > 0 ? 'complete' : 'missing',
      isRelevant: true,
      text: noteCount > 0 ? `${noteCount} noteringar finns registrerade i besiktningen.` : ebStandardText('EB_REPORT_NOTES_EMPTY'),
      updatedAt: null,
    },
    {
      key: 'approval_decision',
      title: 'Besked om godkännande',
      sbrPoint: '18',
      source: 'manual',
      status: round.inspection.approvalStatus ? 'complete' : 'draft',
      isRelevant: true,
      text: ebApprovalDecisionReportText(round),
      updatedAt: null,
    },
    {
      key: 'continued_final_inspection',
      title: 'Föreskrift om en ny slutbesiktning',
      sbrPoint: '19',
      source: 'standard_text',
      status: round.inspection.requiresContinuedFinalInspection === true ? 'complete' : 'not_applicable',
      isRelevant: round.inspection.requiresContinuedFinalInspection === true,
      text: ebContinuedFinalInspectionReportText(round),
      updatedAt: null,
    },
    {
      key: 'warranty_end',
      title: 'Garantitidens slut',
      sbrPoint: '20',
      source: 'manual',
      status: 'not_applicable',
      isRelevant: false,
      text:
        round.inspection.warrantyPeriodYears || round.inspection.warrantyEndDate
          ? reportList([
              round.inspection.warrantyPeriodYears
                ? reportLine('Garantitid', `${round.inspection.warrantyPeriodYears} år`)
                : null,
              optionalReportLine('Garantitidens slut', round.inspection.warrantyEndDate),
            ])
          : ebStandardText('EB_REPORT_WARRANTY_END'),
      updatedAt: null,
    },
    {
      key: 'reclamation_notice',
      title: 'Reklamationsfrister',
      sbrPoint: null,
      source: 'standard_text',
      status: 'complete',
      isRelevant: true,
      text: ebReclamationNoticeReportText(round),
      updatedAt: null,
    },
    {
      key: 'remedy_deadline',
      title: 'Parternas överenskommelse om när fel skall vara avhjälpta',
      sbrPoint: '24',
      source: 'manual',
      status:
        round.inspection.defaultRemedyDeadline ||
        typeof round.inspection.afterInspectionRequested === 'boolean'
          ? 'complete'
          : 'draft',
      isRelevant: true,
      text: ebRemedyDeadlineAgreementReportText(round),
      updatedAt: null,
    },
    {
      key: 'remedy_cost',
      title: 'Kostnad för avhjälpande',
      sbrPoint: '24',
      source: 'standard_text',
      status: 'not_applicable',
      isRelevant: false,
      text: ebStandardText('EB_REPORT_REMEDY_COST'),
      updatedAt: null,
    },
    {
      key: 'after_inspection',
      title: 'Efterbesiktning',
      sbrPoint: '24',
      source: 'manual',
      status: 'not_applicable',
      isRelevant: false,
      text:
        typeof round.inspection.afterInspectionRequested === 'boolean'
          ? reportList([
              optionalReportLine('Efterbesiktning påkallad', yesNoLabel(round.inspection.afterInspectionRequested)),
              optionalReportLine('Efterbesiktning senast', round.inspection.afterInspectionDueDate),
              round.inspection.afterInspectionNoticeInReport
                ? ebStandardText('EB_REPORT_AFTER_INSPECTION')
                : null,
            ])
          : 'Efterbesiktning har inte påkallats vid tidpunkten för utlåtandets upprättande.',
      updatedAt: null,
    },
    {
      key: 'inspection_cost_distribution',
      title: 'Besiktningskostnadens fördelning',
      sbrPoint: null,
      source: 'manual',
      status: round.inspection.inspectionCostDistribution ? 'complete' : 'draft',
      isRelevant: Boolean(round.inspection.inspectionCostDistribution),
      text: round.inspection.inspectionCostDistribution ?? 'Ej angivet',
      updatedAt: null,
    },
    {
      key: 'other_notes',
      title: 'Övriga noteringar',
      sbrPoint: null,
      source: 'manual',
      status: 'complete',
      isRelevant: true,
      text: ebStandardText('EB_REPORT_OTHER_NOTES'),
      updatedAt: null,
    },
    {
      key: 'distribution_list',
      title: 'Sändlista',
      sbrPoint: '25',
      source: 'participants',
      status: reportRecipientRows.length > 0 ? 'complete' : 'draft',
      isRelevant: true,
      text: reportList([
        optionalReportLine('Distributionsdatum', round.inspection.reportDistributionDate),
        reportRecipientRows.length > 0
          ? reportRecipientRows.join('\n\n')
          : ebStandardText('EB_REPORT_DISTRIBUTION_LIST_MISSING'),
      ]),
      updatedAt: null,
    },
    {
      key: 'signature_certificate',
      title: 'Underskrift och certifiering',
      sbrPoint: null,
      source: 'manual',
      status: hasText(inspectorText) ? 'complete' : 'draft',
      isRelevant: true,
      text: reportList([
        ebStandardText('EB_REPORT_SIGNATURE_CERTIFICATE'),
        inspectorText,
        optionalReportLine('Datum', round.inspection.reportDistributionDate ?? today),
      ]),
      updatedAt: null,
    },
  ]

  return {
    updatedAt: storedDraft.updatedAt,
    sections: defaults.map((section) => {
      const existing = existingByKey.get(section.key)
      if (section.key === 'scope' || section.key === 'contract_parties' || section.key === 'contract_documents') {
        return section
      }
      if (section.key === 'testing_documentation') {
        return section
      }
      if (section.key === 'drainage_checklist') {
        return section
      }
      if (section.key === 'conflict_of_interest' && !conflictOfInterestRelevant) {
        return section
      }
      if (section.key === 'continued_final_inspection') {
        return section
      }
      if (section.key === 'warranty_end') {
        return section
      }
      if (section.key === 'reclamation_notice') {
        return section
      }
      if (section.key === 'distribution_list' || section.key === 'signature_certificate') {
        return section
      }
      if (
        section.key === 'special_investigation' ||
        section.key === 'remedy_deadline' ||
        section.key === 'remedy_cost' ||
        section.key === 'after_inspection' ||
        section.key === 'inspection_cost_distribution'
      ) {
        return section
      }
      if (!shouldKeepStoredReportSection(existing, section)) {
        return section
      }
      return {
        ...section,
        status: existing.status,
        isRelevant: existing.isRelevant,
        text: existing.text,
        updatedAt: existing.updatedAt ?? storedDraft.updatedAt ?? now,
      }
    }),
  }
}

export async function saveEbReportDraft(input: SaveEbReportDraftInput): Promise<EbReportDraft> {
  await assertEbInspectionEditable(input)
  const round = await getEbInspectionRound(input)
  const participants = await listParticipantsForInspection(input)
  const resolvedParticipants = participants.length > 0 ? participants : buildDefaultParticipants(round.project)
  const [attachments, inspectionDocuments] = await Promise.all([
    listEbProjectAttachments({
      orgId: input.orgId,
      projectId: input.projectId,
    }),
    listEbInspectionDocuments(input),
  ])
  const inspectorText = await buildInspectorReportText({
    orgId: input.orgId,
    profileId: input.requestedByUserId,
  })
  const baseDraft = buildEbReportDraft({
    round,
    participants: resolvedParticipants,
    attachments,
    inspectionDocuments,
    inspectorText,
    storedDraft: await fetchEbReportDraft(input),
  })
  const now = new Date().toISOString()
  const allowedKeys = new Set(baseDraft.sections.map((section) => section.key))
  const sanitizedSections = input.sections
    .map(normalizeEbReportDraftSection)
    .filter((section): section is EbReportDraftSection => Boolean(section && allowedKeys.has(section.key)))
    .map((section) => ({ ...section, updatedAt: now }))

  if (sanitizedSections.length === 0) {
    throw new Error('EB_REPORT_DRAFT_EMPTY')
  }

  const byKey = new Map(baseDraft.sections.map((section) => [section.key, section]))
  for (const section of sanitizedSections) {
    byKey.set(section.key, section)
  }

  const savedDraft: EbReportDraft = {
    updatedAt: now,
    sections: baseDraft.sections.map((section) => byKey.get(section.key) ?? section),
  }

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('eb_inspection_details')
    .update({
      report_draft: savedDraft,
      report_draft_updated_at: now,
    })
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte spara utlåtandeutkast.')
  }

  return savedDraft
}

async function listParticipantsForInspection(input: {
  orgId: string
  projectId: string
  inspectionId: string
}) {
  const admin = createSupabaseAdminClient()
  const baseSelect = 'id,role_label,company_name,person_name,email,phone,receives_invitation,sort_order'
  const withAttendanceSelect =
    'id,role_label,company_name,person_name,email,phone,receives_invitation,attended,receives_report,represents_party_key,can_represent_party,sort_order'
  const { data, error } = await admin
    .from('eb_participants')
    .select(withAttendanceSelect)
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)
    .order('sort_order', { ascending: true })

  if (error) {
    if (isMissingColumnError(error)) {
      const fallback = await admin
        .from('eb_participants')
        .select(baseSelect)
        .eq('org_id', input.orgId)
        .eq('eb_project_id', input.projectId)
        .eq('inspection_id', input.inspectionId)
        .order('sort_order', { ascending: true })

      if (fallback.error) {
        throw new Error(fallback.error.message ?? 'Kunde inte hämta deltagare.')
      }
      return ((fallback.data ?? []) as EbParticipantRow[]).map(mapParticipant)
    }
    throw new Error(error.message ?? 'Kunde inte hämta deltagare.')
  }

  const rows = (data ?? []) as EbParticipantRow[]
  return rows.map(mapParticipant)
}

function buildInvitationSubject(input: {
  project: EbProjectListItem
  inspection: EbInspectionSummary
  detail: EbInvitationDetailRow
}) {
  const existingSubject = normalizeText(input.detail.invitation_subject)
  if (existingSubject) return existingSubject

  return `Kallelse till ${input.inspection.variantLabel} - ${input.project.title}`
}

function buildInvitationBody(input: {
  project: EbProjectListItem
  inspection: EbInspectionSummary
  detail: EbInvitationDetailRow
  inspector: ProfileContactRow | null
}) {
  const existingBody = normalizeText(input.detail.invitation_body)
  if (existingBody) return existingBody

  const address = [input.project.address, input.project.postalCode, input.project.city]
    .filter(Boolean)
    .join(', ')
  const inspectorName = normalizeText(input.inspector?.full_name) ?? 'Besiktningsmannen'
  const inspectorEmail = normalizeText(input.inspector?.email)
  const contactLine = inspectorEmail ? `${inspectorName}, ${inspectorEmail}` : inspectorName

  return [
    'Hej,',
    '',
    `Härmed kallas ni till ${input.inspection.variantLabel.toLowerCase()}.`,
    '',
    `Entreprenad: ${input.project.contractName ?? input.project.title}`,
    `Fastighet/adress: ${address || input.project.propertyDesignation || input.project.brfApartmentNumber || 'Ej satt'}`,
    `Beställare: ${input.project.clientName ?? 'Ej satt'}`,
    `Entreprenör: ${input.project.contractorName ?? 'Ej satt'}`,
    `Datum: ${formatSwedishDate(input.inspection.date)}`,
    `Tid: ${formatTime(input.inspection.inspectionTime)}`,
    `Samlingsplats: ${input.detail.meeting_place ?? 'Ej satt'}`,
    `Startmöte: ${formatTime(input.detail.start_meeting_time)}`,
    `Slutmöte: ${formatTime(input.detail.final_meeting_time)}`,
    '',
    'Om tiden inte fungerar, kontakta besiktningsmannen direkt.',
    '',
    'Med vänlig hälsning',
    contactLine,
    'BesiktApp',
  ].join('\n')
}

async function getProfileContact(profileId: string) {
  const admin = createSupabaseAdminClient()
  const selectAttempts = [
    'id,full_name,email,avatar_path,logo_path,logo_url,certification_number',
    'id,full_name,email,avatar_path,logo_path,logo_url',
    'id,full_name,email,avatar_path,logo_path',
    'id,full_name,email',
  ]

  for (const select of selectAttempts) {
    const { data, error } = await admin
      .from('profiles')
      .select(select)
      .eq('id', profileId)
      .maybeSingle()

    if (error) {
      if (isMissingColumnError(error)) continue
      throw new Error(error.message ?? 'Kunde inte hämta besiktningsman.')
    }

    const row = (data ?? null) as Partial<ProfileContactRow> | null
    if (!row) return null
    if (!row.id) return null

    return {
      id: row.id,
      full_name: row.full_name ?? null,
      email: row.email ?? null,
      certification_number: row.certification_number ?? null,
      avatar_path: row.avatar_path ?? null,
      logo_path: row.logo_path ?? null,
      logo_url: row.logo_url ?? null,
    }
  }

  throw new Error('Kunde inte hämta besiktningsman.')
}

async function buildInspectorReportText(input: {
  orgId: string
  profileId: string
  inspector?: ProfileContactRow | null
}) {
  const admin = createSupabaseAdminClient()
  const inspector = input.inspector ?? (await getProfileContact(input.profileId))
  const { summary } = await resolveInspectorCertificationSummary(admin, {
    orgId: input.orgId,
    profileId: input.profileId,
    legacy: {
      certification_number: inspector?.certification_number ?? null,
    },
  })
  const certificationName = isObCertificationText(summary.status_name) ? null : summary.status_name
  const membershipName = isObCertificationText(summary.membership_name) ? null : summary.membership_name

  return [
    inspector?.full_name ? reportLine('Besiktningsman', inspector.full_name) : null,
    inspector?.email ? reportLine('E-post', inspector.email) : null,
    certificationName ? reportLine('Certifiering', certificationName) : null,
    certificationName && summary.certification_number
      ? reportLine('Certifikatnummer', summary.certification_number)
      : null,
    membershipName ? reportLine('Medlemskap', membershipName) : null,
    membershipName && summary.membership_number ? reportLine('Medlemsnummer', summary.membership_number) : null,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join('\n')
}

export async function getEbInvitationContext(input: {
  orgId: string
  requestedByUserId: string
  projectId: string
  inspectionId: string
}): Promise<EbInvitationContext> {
  const project = await getEbProjectById({
    orgId: input.orgId,
    projectId: input.projectId,
  })

  if (!project) {
    throw new Error('EB_PROJECT_NOT_FOUND')
  }

  const inspection = project.inspections.find((item) => item.inspectionId === input.inspectionId)
  if (!inspection) {
    throw new Error('EB_INSPECTION_NOT_FOUND')
  }

  const detail = await getEbInspectionDetail(input)
  if (!detail) {
    throw new Error('EB_INSPECTION_NOT_FOUND')
  }

  const inspector = await getProfileContact(input.requestedByUserId)
  const participants = await listParticipantsForInspection(input)
  const resolvedParticipants = participants.length > 0 ? participants : buildDefaultParticipants(project)

  return {
    project,
    inspection,
    participants: resolvedParticipants,
    subject: buildInvitationSubject({ project, inspection, detail }),
    body: buildInvitationBody({ project, inspection, detail, inspector }),
  }
}

function normalizeParticipantInput(
  participant: EbInvitationParticipantInput,
  index: number
): EbInvitationParticipant {
  return {
    id: normalizeText(participant.id) ?? null,
    roleLabel: normalizeText(participant.roleLabel),
    companyName: normalizeText(participant.companyName),
    personName: normalizeText(participant.personName),
    email: normalizeEmail(participant.email),
    phone: normalizeText(participant.phone),
    receivesInvitation: Boolean(participant.receivesInvitation),
    attended: Boolean(participant.attended),
    receivesReport: participant.receivesReport !== false,
    representsPartyKey: normalizePartyKey(participant.representsPartyKey),
    canRepresentParty: Boolean(participant.canRepresentParty),
    sortOrder: participant.sortOrder ?? (index + 1) * 100,
  }
}

function participantHasContent(participant: EbInvitationParticipant) {
  return Boolean(
    participant.roleLabel ||
      participant.companyName ||
      participant.personName ||
      participant.email ||
      participant.phone
  )
}

async function replaceInspectionParticipants(input: {
  orgId: string
  projectId: string
  inspectionId: string
  participants: EbInvitationParticipant[]
}) {
  const admin = createSupabaseAdminClient()

  const { error: deleteError } = await admin
    .from('eb_participants')
    .delete()
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)

  if (deleteError) {
    throw new Error(deleteError.message ?? 'Kunde inte uppdatera deltagare.')
  }

  const rows = input.participants.filter(participantHasContent)
  if (rows.length === 0) return

  const { error: insertError } = await admin.from('eb_participants').insert(
    rows.map((participant, index) => ({
      org_id: input.orgId,
      eb_project_id: input.projectId,
      inspection_id: input.inspectionId,
      role_label: participant.roleLabel,
      company_name: participant.companyName,
      person_name: participant.personName,
      email: participant.email,
      phone: participant.phone,
      receives_invitation: participant.receivesInvitation,
      attended: participant.attended,
      receives_report: participant.receivesReport,
      represents_party_key: participant.representsPartyKey,
      can_represent_party: participant.canRepresentParty,
      sort_order: participant.sortOrder || (index + 1) * 100,
    }))
  )

  if (insertError) {
    throw new Error(insertError.message ?? 'Kunde inte spara deltagare.')
  }
}

function resolveRecipientName(participant: EbInvitationParticipant) {
  return (
    normalizeText(participant.personName) ??
    normalizeText(participant.companyName) ??
    normalizeText(participant.roleLabel) ??
    'Mottagare'
  )
}

export async function sendEbInvitation(input: SendEbInvitationInput): Promise<SendEbInvitationResult> {
  await assertEbInspectionEditable(input)
  await getEbInvitationContext(input)
  const subject = normalizeText(input.subject)
  const body = normalizeText(input.body)

  if (!subject) {
    throw new Error('INVITATION_SUBJECT_REQUIRED')
  }
  if (!body) {
    throw new Error('INVITATION_BODY_REQUIRED')
  }

  const participants = input.participants.map(normalizeParticipantInput).filter(participantHasContent)
  const recipients = participants.filter(
    (participant) => participant.receivesInvitation && Boolean(participant.email)
  )

  if (recipients.length === 0) {
    throw new Error('INVITATION_RECIPIENT_REQUIRED')
  }

  await replaceInspectionParticipants({
    orgId: input.orgId,
    projectId: input.projectId,
    inspectionId: input.inspectionId,
    participants,
  })

  const admin = createSupabaseAdminClient()
  const fromAddress = getMailFromAddress()
  const inspector = await getProfileContact(input.requestedByUserId)
  const replyTo = normalizeEmail(inspector?.email)
  const sentMessageIds: string[] = []
  const failures: string[] = []

  for (const recipient of recipients) {
    const recipientEmail = recipient.email
    if (!recipientEmail) continue

    const { data: messageData, error: messageError } = await admin
      .from('outbound_messages')
      .insert({
        org_id: input.orgId,
        inspection_id: input.inspectionId,
        eb_project_id: input.projectId,
        channel: 'email',
        recipient_email: recipientEmail,
        subject,
        template_key: 'eb_invitation',
        status: 'pending',
        created_by: input.requestedByUserId,
        reply_to_email: replyTo,
      })
      .select('id')
      .single()

    if (messageError || !messageData) {
      failures.push(`${resolveRecipientName(recipient)}: kunde inte skapa mejllogg`)
      continue
    }

    const messageId = String(messageData.id)

    try {
      const sendResult = await sendAssignmentEmail({
        to: recipientEmail,
        from: fromAddress,
        replyTo,
        subject,
        html: textToHtml(body),
        text: body,
      })

      await admin
        .from('outbound_messages')
        .update({
          status: 'sent',
          provider: sendResult.provider,
          provider_message_id: sendResult.providerMessageId,
          sent_at: new Date().toISOString(),
        })
        .eq('id', messageId)

      sentMessageIds.push(messageId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Okänt fel vid mejlutskick.'
      await admin
        .from('outbound_messages')
        .update({
          status: 'failed',
          error_message: message,
        })
        .eq('id', messageId)

      failures.push(`${resolveRecipientName(recipient)}: ${message}`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`INVITATION_SEND_FAILED:${failures.join(' | ')}`)
  }

  const now = new Date().toISOString()
  const { error: detailUpdateError } = await admin
    .from('eb_inspection_details')
    .update({
      invitation_sent_at: now,
      invitation_sent_by: input.requestedByUserId,
      invitation_message_id: sentMessageIds[0] ?? null,
      invitation_method: 'E-post',
      invitation_date: now.slice(0, 10),
      invitation_subject: subject,
      invitation_body: body,
    })
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)

  if (detailUpdateError) {
    throw new Error(detailUpdateError.message ?? 'Kallelsen skickades men kunde inte sparas på besiktningen.')
  }

  const updatedProject = await getEbProjectById({
    orgId: input.orgId,
    projectId: input.projectId,
  })

  if (!updatedProject) {
    throw new Error('Kallelsen skickades men projektet kunde inte läsas tillbaka.')
  }

  return {
    sentCount: sentMessageIds.length,
    project: updatedProject,
  }
}

export async function saveEbInvitationDraft(input: SaveEbInvitationDraftInput): Promise<EbInvitationContext> {
  await assertEbInspectionEditable(input)
  await getEbInvitationContext(input)
  const participants = input.participants.map(normalizeParticipantInput).filter(participantHasContent)

  await replaceInspectionParticipants({
    orgId: input.orgId,
    projectId: input.projectId,
    inspectionId: input.inspectionId,
    participants,
  })

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('eb_inspection_details')
    .update({
      invitation_subject: normalizeText(input.subject),
      invitation_body: normalizeText(input.body),
    })
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte spara kallelse och deltagare.')
  }

  return getEbInvitationContext(input)
}
