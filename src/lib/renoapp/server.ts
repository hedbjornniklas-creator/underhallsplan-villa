import crypto from 'node:crypto'
import { cookies } from 'next/headers'
import { getCurrentUserPlatformAccessContext, type PlatformAccessAssignment } from '@/lib/access/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ORG_NUMBER_REGEX = /^\d{6}-\d{4}$/
const POSTAL_CODE_REGEX = /^\d{3}\s\d{2}$/
const INVITE_TTL_HOURS = 24 * 7

type BrfAssociationRow = {
  id: string
  name: string
  slug: string
  org_number: string | null
  address: string | null
  address_line_2: string | null
  postal_code: string | null
  city: string | null
  email: string | null
  phone: string | null
  property_designation: string | null
  invoice_address: string | null
  invoice_email: string | null
  invoice_reference: string | null
  primary_contact_name: string | null
  primary_contact_email: string | null
  primary_contact_phone: string | null
  unit_count: number | null
  technical_contact: string | null
  is_public_apply_enabled: boolean
  is_public_apply_listed: boolean
  apply_intro_text: string | null
  onboarding_completed_at: string | null
}

type ActionTypeRow = {
  id: string
  category_id: string | null
  key: string
  label: string
  description: string | null
  risk_level: 'low' | 'medium' | 'high'
  contractor_requirement:
    | 'none'
    | 'qualified_contractor'
    | 'authorized_electrician'
    | 'safe_water'
    | 'bkr_or_gvk'
    | 'structural_engineer'
  implies_structure: boolean
  implies_plumbing: boolean
  implies_ventilation: boolean
  implies_electrical: boolean
  implies_wet_room: boolean
  implies_surface_only: boolean
  sort_order: number
  is_active: boolean
}

type ActionCategoryRow = {
  id: string
  slug: string
  label: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type DocumentTypeRow = {
  id: string
  key: string
  label: string
  description: string | null
  review_guidance: string | null
  default_phase: 'before_required' | 'during_execution' | 'after_completion'
  sort_order: number
  is_active: boolean
}

type ParticipantRoleRow = {
  id: string
  key: string
  label: string
  description: string | null
  review_guidance: string | null
  role_kind: 'contractor' | 'consultant'
  verification_instructions: string | null
  verification_url: string | null
  insurance_required: boolean
  requires_company_name: boolean
  requires_org_number: boolean
  requires_contact_name: boolean
  requires_email: boolean
  requires_phone: boolean
  requires_certification: boolean
  sort_order: number
  is_active: boolean
}

type ApplyQuestionRow = {
  id: string
  key: string
  label: string
  help_text: string | null
  response_type: 'single_select' | 'multi_select' | 'boolean'
  sort_order: number
  is_locked: boolean
  is_active: boolean
  metadata: unknown
}

type ApplyQuestionOptionRow = {
  id: string
  question_id: string
  key: string
  label: string
  description: string | null
  sort_order: number
  is_active: boolean
  metadata: unknown
}

type ApplyOptionTriggerRow = {
  id: string
  option_id: string
  trigger_type: 'question' | 'document' | 'participant_role' | 'review_flag'
  question_id: string | null
  document_type_id: string | null
  participant_role_id: string | null
  review_flag_id: string | null
  sort_order: number
  is_active: boolean
}

type ReviewFlagRow = {
  id: string
  key: string
  label: string
  description: string | null
  severity: 'info' | 'warning' | 'high'
  category: string
  sort_order: number
  is_active: boolean
}

type ActionTypeQuestionRow = {
  id: string
  action_type_id: string
  question_id: string
  sort_order: number
  is_required: boolean
  is_active: boolean
}

type ActionTypeParticipantRoleRow = {
  id: string
  action_type_id: string
  participant_role_id: string
  is_required: boolean
  sort_order: number
  is_active: boolean
}

type CaseQuestionAnswerRow = {
  id: string
  case_id: string
  question_id: string
  option_id: string
}

type CaseParticipantRow = {
  id: string
  case_id: string
  participant_role_id: string
  company_name: string | null
  org_number: string | null
  contact_name: string | null
  email: string | null
  phone: string | null
  certification_reference: string | null
  has_verified_authorization: boolean
  accepts_responsibility: boolean
}

type TerminologyGroupRow = {
  id: string
  key: string
  label: string
  description: string | null
  sort_order: number
  is_locked: boolean
  is_active: boolean
}

type TerminologyTermRow = {
  id: string
  group_id: string
  code: string
  label: string
  definition: string | null
  term_level: 'ux' | 'technical' | 'classification' | 'status' | 'document_phase' | 'decision'
  input_kind: 'user_visible' | 'system_internal' | 'system_generated'
  is_locked: boolean
  is_user_selectable: boolean
  is_system_generated: boolean
  is_active: boolean
  sort_order: number
  metadata: unknown
}

type TerminologyAliasRow = {
  id: string
  term_id: string
  alias: string
  sort_order: number
  is_active: boolean
}

type TerminologyRuleRow = {
  id: string
  term_id: string
  rule_key: string
  label: string
  description: string | null
  config: unknown
  sort_order: number
  is_active: boolean
}

type RequirementRow = {
  id: string
  brf_id: string | null
  action_type_id: string
  document_type_id: string
  is_required: boolean
  phase: 'before_required' | 'before_conditional' | 'during_execution' | 'after_completion'
  note: string | null
  sort_order: number
}

type ContactRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
}

type UnitRow = {
  id: string
  brf_id: string
  unit_number_internal: string | null
  unit_number_skatteverket: string | null
  status: string
  updated_at: string
}

type CaseRow = {
  id: string
  brf_id: string
  unit_id: string | null
  applicant_contact_id: string | null
  action_type_id: string | null
  case_number: string
  title: string
  description: string | null
  contractor_name: string | null
  contractor_org_number: string | null
  contractor_email: string | null
  contractor_phone: string | null
  contractor_has_required_certification: boolean
  status: string
  risk_level: string | null
  blocked_at: string | null
  blocked_reason: string | null
  submitted_at: string
  updated_at: string
}

type CaseAccessLinkRow = {
  id: string
  case_id: string
  email: string | null
  scope: 'read' | 'upload_documents' | 'answer_questions'
  expires_at: string
  revoked_at: string | null
  last_used_at: string | null
  plain_token: string | null
}

type CaseMessageRow = {
  id: string
  case_id: string
  type: 'request_for_info' | 'applicant_reply' | 'document_uploaded' | 'decision' | 'status_change'
  author_role: 'board' | 'applicant' | 'system'
  author_profile_id: string | null
  author_contact_id: string | null
  message: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

type CaseActionTypeRow = {
  case_id: string
  action_type_id: string
}

type BrfMemberRow = {
  brf_id: string
  role: 'board' | 'admin'
  is_active: boolean
  brf_associations:
    | {
        name: string | null
        slug: string | null
      }
    | Array<{
        name: string | null
        slug: string | null
      }>
    | null
}

type ProfileLite = {
  id: string
  full_name: string | null
  email: string | null
  is_admin: boolean
}

type SupabaseError = {
  message?: string
  details?: string | null
  hint?: string | null
  code?: string | null
} | null

type SupabaseResponse<T> = Promise<{ data: T | null; error: SupabaseError }>
type SupabaseListResponse<T> = { data: T[] | null; error: SupabaseError }

type QueryBuilder<T = Record<string, unknown>> = {
  then: <TResult1 = SupabaseListResponse<T>, TResult2 = never>(
    onfulfilled?:
      | ((value: SupabaseListResponse<T>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => PromiseLike<TResult1 | TResult2>
  select: (columns: string) => QueryBuilder<T>
  insert: (values: unknown) => QueryBuilder<T>
  update: (values: unknown) => QueryBuilder<T>
  delete: () => QueryBuilder<T>
  eq: (column: string, value: unknown) => QueryBuilder<T>
  is: (column: string, value: unknown) => QueryBuilder<T>
  in: (column: string, values: unknown[]) => QueryBuilder<T>
  like: (column: string, pattern: string) => QueryBuilder<T>
  order: (
    column: string,
    options?: {
      ascending?: boolean
      nullsFirst?: boolean
    }
  ) => QueryBuilder<T>
  limit: (count: number) => QueryBuilder<T>
  single: () => SupabaseResponse<T>
  maybeSingle: () => SupabaseResponse<T>
}

type SupabaseAdminClient = {
  from: (table: string) => QueryBuilder
}

const RENOAPP_TERMINOLOGY_GROUP_FALLBACKS: Record<
  string,
  {
    label: string
    description: string | null
  }
> = {
  'action-categories': {
    label: 'Action categories',
    description: 'Huvudgrupper som boende m\u00f6ter i ans\u00f6kningsguiden.',
  },
  'action-types': {
    label: 'Action types',
    description: 'Renoveringstyper och anv\u00e4ndarval som driver RenoApps fl\u00f6de.',
  },
  'ux-definitions': {
    label: 'UX-definitioner',
    description: 'L\u00e5sta definitioner av ord i boendefl\u00f6det.',
  },
  'technical-impacts': {
    label: 'Technical impacts',
    description: 'Tekniska p\u00e5verkansomr\u00e5den som styr logik, dokument och beslut.',
  },
  'legal-classifications': {
    label: 'Juridisk klassning',
    description: 'Systemgenererade klassningar som RenoApp h\u00e4rleder.',
  },
  statuses: {
    label: 'Statusar',
    description: 'L\u00e5sta statuskoder f\u00f6r ans\u00f6kans livscykel.',
  },
  'document-phases': {
    label: 'Dokumentfaser',
    description: 'Faser som styr n\u00e4r dokument ska finnas tillg\u00e4ngliga.',
  },
  'decision-terms': {
    label: 'Besluts- och uppf\u00f6ljningstermer',
    description: 'Termer f\u00f6r beslut, villkor och uppf\u00f6ljning.',
  },
}

const RENOAPP_TERMINOLOGY_TERM_FALLBACKS: Record<
  string,
  {
    label: string
    definition: string | null
  }
> = {
  'action-categories:vatrum': {
    label: 'V\u00e5trum',
    definition: 'Arbeten i badrum, tv\u00e4ttutrymmen och andra v\u00e5trum.',
  },
  'action-categories:kok': {
    label: 'K\u00f6k',
    definition: 'Arbeten i k\u00f6k, k\u00f6ksinredning och k\u00f6ksn\u00e4ra installationer.',
  },
  'action-categories:ytskikt': {
    label: 'Ytskikt',
    definition: 'M\u00e5lning, golv och andra enklare inv\u00e4ndiga ytskikt.',
  },
  'action-categories:vaggar_planlosning': {
    label: 'V\u00e4ggar och planl\u00f6sning',
    definition: '\u00c4ndringar av v\u00e4ggar och planl\u00f6sning i bostaden.',
  },
  'action-categories:installationer': {
    label: 'Installationer',
    definition: 'Arbeten som p\u00e5verkar VVS, el eller ventilation.',
  },
  'action-categories:ovrigt': {
    label: '\u00d6vrigt',
    definition: '\u00d6vriga renoveringar som inte passar i de vanliga kategorierna.',
  },
  'action-categories:fasad_fonster_balkong': {
    label: 'Fasad, f\u00f6nster, balkong',
    definition: 'Framtida kategori f\u00f6r arbeten som p\u00e5verkar fasad eller yttre delar.',
  },
  'action-categories:storre_renovering': {
    label: 'St\u00f6rre renovering',
    definition: 'Framtida samlingskategori f\u00f6r mer omfattande renoveringar.',
  },
  'action-types:bathroom': {
    label: 'Badrum',
    definition: 'Renovering av badrum, tv\u00e4ttutrymme eller andra v\u00e5trum.',
  },
  'action-types:kitchen': {
    label: 'K\u00f6k',
    definition: '\u00c4ndringar i k\u00f6k, k\u00f6ksinredning eller installationer kopplade till k\u00f6k.',
  },
  'action-types:wall': {
    label: 'V\u00e4ggar och planl\u00f6sning',
    definition: 'Rivning, flytt eller uppbyggnad av v\u00e4ggar och planl\u00f6snings\u00e4ndringar.',
  },
  'action-types:plumbing': {
    label: 'VVS-arbete',
    definition: '\u00c4ndringar i vatten, avlopp eller annan VVS-installation.',
  },
  'action-types:electrical': {
    label: 'Elarbete',
    definition: '\u00c4ndringar i elinstallationer, fasta elpunkter eller eldragning.',
  },
  'action-types:ventilation': {
    label: 'Ventilation',
    definition: '\u00c4ndringar som p\u00e5verkar ventilation eller fr\u00e5nluftssystem.',
  },
  'action-types:surface': {
    label: 'Ytskiktsrenovering',
    definition: 'Ytskiktsrenovering som m\u00e5lning, golv eller andra ytskikt utan st\u00f6rre ingrepp.',
  },
  'ux-definitions:renovera': {
    label: 'Renovera',
    definition:
      '\u00c5terst\u00e4lla eller uppgradera ett befintligt utrymme utan att anv\u00e4ndaren sj\u00e4lv beh\u00f6ver avg\u00f6ra juridisk klassning.',
  },
  'ux-definitions:bygga_nytt': {
    label: 'Bygga nytt',
    definition: 'Skapa en funktion som inte tidigare fanns i utrymmet.',
  },
  'ux-definitions:flytta': {
    label: 'Flytta',
    definition: '\u00c4ndra placering av funktion, installation eller rumslig l\u00f6sning.',
  },
  'ux-definitions:installera': {
    label: 'Installera',
    definition: 'L\u00e4gga till en ny komponent eller utrustning.',
  },
  'ux-definitions:andra': {
    label: '\u00c4ndra',
    definition: 'Justera befintlig l\u00f6sning eller system.',
  },
  'technical-impacts:wet_room': {
    label: 'wet_room',
    definition: 'T\u00e4tskikt, golvbrunn eller v\u00e5trumsmilj\u00f6 p\u00e5verkas.',
  },
  'technical-impacts:plumbing': {
    label: 'plumbing',
    definition: 'Vatten, avlopp, r\u00f6r eller golvbrunn p\u00e5verkas.',
  },
  'technical-impacts:electrical': {
    label: 'electrical',
    definition: 'Fast installerad el p\u00e5verkas.',
  },
  'technical-impacts:ventilation': {
    label: 'ventilation',
    definition: 'Luftfl\u00f6de, ventil eller ventilationssystem p\u00e5verkas.',
  },
  'technical-impacts:structure': {
    label: 'structure',
    definition: 'V\u00e4gg, bj\u00e4lklag eller b\u00e4rande/stabiliserande del p\u00e5verkas.',
  },
  'technical-impacts:surface_only': {
    label: 'surface_only',
    definition: 'Arbetet \u00e4r begr\u00e4nsat till enklare ytskikt utan tekniska ingrepp.',
  },
  'technical-impacts:facade': {
    label: 'facade',
    definition: 'Byggnadens utsida p\u00e5verkas.',
  },
  'technical-impacts:balcony': {
    label: 'balcony',
    definition: 'Balkong, terrass eller uteplats p\u00e5verkas.',
  },
  'technical-impacts:heating': {
    label: 'heating',
    definition: 'V\u00e4rmesystem eller golvv\u00e4rme p\u00e5verkas.',
  },
  'technical-impacts:fire': {
    label: 'fire',
    definition: 'Brandklassning eller brandskydd p\u00e5verkas.',
  },
  'technical-impacts:noise': {
    label: 'noise',
    definition: 'Ljudisolering eller ljudp\u00e5verkan f\u00f6r\u00e4ndras.',
  },
  'technical-impacts:drainage': {
    label: 'drainage',
    definition: 'Vattenavledning, lutning eller dr\u00e4neringsliknande funktion p\u00e5verkas.',
  },
  'legal-classifications:underhall': {
    label: 'underh\u00e5ll',
    definition: '\u00c5tg\u00e4rd som normalt inte \u00e4ndrar funktion eller teknisk huvudl\u00f6sning.',
  },
  'legal-classifications:renovering': {
    label: 'renovering',
    definition: 'Uppgradering eller \u00e5terst\u00e4llning utan st\u00f6rre funktions\u00e4ndring.',
  },
  'legal-classifications:ombyggnad': {
    label: 'ombyggnad',
    definition: '\u00c4ndring av funktion, planl\u00f6sning eller teknisk huvudl\u00f6sning.',
  },
  'legal-classifications:tillbyggnad': {
    label: 'tillbyggnad',
    definition: '\u00d6kning av byggnadens volym.',
  },
  'legal-classifications:nyinstallation': {
    label: 'nyinstallation',
    definition: 'Ny teknisk funktion eller installation tillf\u00f6rs.',
  },
  'statuses:draft': {
    label: 'Utkast',
    definition: 'Utkast som \u00e4nnu inte skickats in.',
  },
  'statuses:submitted': {
    label: 'Inskickad',
    definition: 'Ans\u00f6kan \u00e4r inskickad.',
  },
  'statuses:need_info': {
    label: 'Beh\u00f6ver komplettering',
    definition: 'Komplettering kr\u00e4vs innan \u00e4rendet kan granskas vidare.',
  },
  'statuses:ready_for_review': {
    label: 'Klar f\u00f6r granskning',
    definition: '\u00c4rendet \u00e4r tillr\u00e4ckligt komplett f\u00f6r granskning.',
  },
  'statuses:approved': {
    label: 'Godk\u00e4nd',
    definition: '\u00c4rendet \u00e4r godk\u00e4nt utan s\u00e4rskilda villkor.',
  },
  'statuses:approved_with_conditions': {
    label: 'Godk\u00e4nd med villkor',
    definition: '\u00c4rendet \u00e4r godk\u00e4nt med villkor som m\u00e5ste f\u00f6ljas.',
  },
  'statuses:rejected': {
    label: 'Avslagen',
    definition: '\u00c4rendet \u00e4r avslaget.',
  },
  'statuses:completed': {
    label: 'Avslutad',
    definition: '\u00c4rendet \u00e4r slutredovisat, uppf\u00f6ljt och avslutat.',
  },
  'document-phases:before_required': {
    label: 'before_required',
    definition: 'Dokument som alltid m\u00e5ste finnas f\u00f6re ans\u00f6kan eller granskning.',
  },
  'document-phases:before_conditional': {
    label: 'before_conditional',
    definition: 'Dokument som kr\u00e4vs om viss teknisk p\u00e5verkan eller vissa svar finns.',
  },
  'document-phases:after_completion': {
    label: 'after_completion',
    definition: 'Dokument som ska l\u00e4mnas in efter att arbetet har utf\u00f6rts.',
  },
  'decision-terms:beslut': {
    label: 'Beslut',
    definition: 'Formellt st\u00e4llningstagande till ans\u00f6kan.',
  },
  'decision-terms:villkor': {
    label: 'Villkor',
    definition: 'Krav som kopplas till beslutet och som ska f\u00f6ljas under genomf\u00f6randet.',
  },
  'decision-terms:kontrollpunkt': {
    label: 'Kontrollpunkt',
    definition:
      'Punkt som f\u00f6ljs upp efter utf\u00f6rt arbete f\u00f6r att verifiera att beslut och utf\u00f6rande st\u00e4mmer.',
  },
  'decision-terms:komplettering': {
    label: 'Komplettering',
    definition: 'Efterfr\u00e5gat underlag eller svar som beh\u00f6vs f\u00f6r fortsatt handl\u00e4ggning.',
  },
  'decision-terms:slutredovisning': {
    label: 'Slutredovisning',
    definition: 'Underlag som visar att arbetet \u00e4r utf\u00f6rt och kan avslutas.',
  },
}

type PublicRequirement = {
  id: string
  documentTypeId: string
  documentKey: string
  documentLabel: string
  documentDescription: string | null
  isRequired: boolean
  phase?: 'before_required' | 'before_conditional' | 'during_execution' | 'after_completion'
  note: string | null
  sortOrder: number
}

export type PublicParticipantRole = {
  id: string
  key: string
  label: string
  description: string | null
  reviewGuidance: string | null
  roleKind: 'contractor' | 'consultant'
  verificationInstructions: string | null
  verificationUrl: string | null
  insuranceRequired: boolean
  requiresCompanyName: boolean
  requiresOrgNumber: boolean
  requiresContactName: boolean
  requiresEmail: boolean
  requiresPhone: boolean
  requiresCertification: boolean
  isRequired: boolean
  sortOrder: number
}

type PublicActionCategory = {
  id: string
  slug: string
  label: string
  description: string | null
  sortOrder: number
}

type PublicActionType = {
  id: string
  category?: PublicActionCategory
  key: string
  label: string
  description?: string | null
  riskLevel?: 'low' | 'medium' | 'high'
  contractorRequirement?:
    | 'none'
    | 'qualified_contractor'
    | 'authorized_electrician'
    | 'safe_water'
    | 'bkr_or_gvk'
    | 'structural_engineer'
  sortOrder: number
  requirements: PublicRequirement[]
  participantRoles: PublicParticipantRole[]
  questions: PublicApplyQuestion[]
}

export type PublicApplyQuestionOption = {
  id: string
  key: string
  label: string
  description: string | null
  sortOrder: number
  triggers: PublicApplyQuestionOptionTrigger[]
}

export type PublicApplyQuestionOptionTrigger = {
  id: string
  triggerType: 'question' | 'document' | 'participant_role' | 'review_flag'
  questionId: string | null
  documentTypeId: string | null
  documentKey: string | null
  documentLabel: string | null
  documentDescription: string | null
  documentPhase: 'before_required' | 'during_execution' | 'after_completion' | null
  participantRoleId: string | null
  participantRole: PublicParticipantRole | null
  reviewFlagId: string | null
  reviewFlag: {
    id: string
    key: string
    label: string
    description: string | null
    severity: 'info' | 'warning' | 'high'
    category: string
  } | null
  sortOrder: number
}

export type PublicApplyQuestion = {
  id: string
  key: string
  label: string
  helpText: string | null
  responseType: 'single_select' | 'multi_select' | 'boolean'
  sortOrder: number
  isRequired: boolean
  options: PublicApplyQuestionOption[]
}

export type RenoAppPublicBrfConfig = {
  brf: {
    id: string
    name: string
    slug: string
    applyIntroText: string | null
  }
  actionTypes: PublicActionType[]
  questionBank: PublicApplyQuestion[]
}

export type RenoAppPublicBrfListItem = {
  id: string
  name: string
  slug: string
  address: string | null
}

export type CreatePublicApplicationInput = {
  brfSlug: string
  draftToken?: string | null
  mode?: 'draft' | 'submit'
  applicantName: string
  applicantEmail: string
  applicantPhone?: string | null
  unitNumberInternal?: string | null
  unitNumberSkatteverket?: string | null
  description: string
  replyMessage?: string | null
  contractorName?: string | null
  contractorOrgNumber?: string | null
  contractorEmail?: string | null
  contractorPhone?: string | null
  contractorHasRequiredCertification?: boolean
  participantEntries?: Array<{
    participantRoleId: string
    companyName?: string | null
    orgNumber?: string | null
    contactName?: string | null
    email?: string | null
    phone?: string | null
    certificationReference?: string | null
    hasVerifiedAuthorization?: boolean
    acceptsResponsibility?: boolean
  }>
  actionTypeKeys: string[]
  questionAnswers?: Record<string, string[]>
  checks?: {
    affectsStructure: boolean
    affectsPlumbing: boolean
    affectsVentilation: boolean
    affectsElectrical: boolean
    affectsWetRoom: boolean
    affectsSurfaceOnly: boolean
  }
}

export type CreatePublicApplicationResult = {
  caseId: string
  caseNumber: string
  accessUrl: string
  resumeUrl: string
  status: 'draft' | 'submitted'
  emailSent: boolean
  emailError: string | null
}

export type RenoAppCaseMessage = {
  id: string
  type: 'request_for_info' | 'applicant_reply' | 'document_uploaded' | 'decision' | 'status_change'
  authorRole: 'board' | 'applicant' | 'system'
  authorName: string | null
  message: string | null
  createdAt: string
}

export type RenoAppPublicApplicationDraft = {
  state: 'open' | 'expired' | 'revoked'
  access: {
    email: string
    expiresAt: string
    lastUsedAt: string | null
  }
  brf: {
    id: string
    name: string
    slug: string
  }
  form: {
    applicantName: string
    applicantEmail: string
    applicantPhone: string
    unitNumberInternal: string
    unitNumberSkatteverket: string
    description: string
    contractorName: string
    contractorOrgNumber: string
    contractorEmail: string
    contractorPhone: string
    contractorHasRequiredCertification: boolean
    participantEntries: Array<{
      participantRoleId: string
      companyName: string
      orgNumber: string
      contactName: string
      email: string
      phone: string
      certificationReference: string
      hasVerifiedAuthorization: boolean
      acceptsResponsibility: boolean
    }>
    actionTypeKeys: string[]
    questionAnswers: Record<string, string[]>
  }
  case: {
    id: string
    caseNumber: string
    status: string
    submittedAt: string
    updatedAt: string
  }
  documents: Array<{
    id: string
    documentTypeId: string | null
    participantRoleId: string | null
    documentScope: 'general' | 'participant_insurance'
    fileName: string | null
    status: string
    uploadedAt: string
    note: string | null
  }>
  messages: RenoAppCaseMessage[]
}

export type RenoAppAdminActionType = {
  id: string
  categoryId: string | null
  key: string
  label: string
  description: string | null
  riskLevel: 'low' | 'medium' | 'high'
  contractorRequirement:
    | 'none'
    | 'qualified_contractor'
    | 'authorized_electrician'
    | 'safe_water'
    | 'bkr_or_gvk'
    | 'structural_engineer'
  sortOrder: number
  isActive: boolean
  requirementCount: number
  questionCount: number
  participantRoleCount: number
}

export type RenoAppAdminDocumentRequirement = {
  id: string
  documentTypeId: string
  documentKey: string
  documentLabel: string
  documentDescription: string | null
  isRequired: boolean
  phase?: 'before_required' | 'before_conditional' | 'during_execution' | 'after_completion'
  note: string | null
  sortOrder: number
}

export type RenoAppAdminRequirementGroup = {
  actionType: RenoAppAdminActionType
  requirements: RenoAppAdminDocumentRequirement[]
}

export type RenoAppAdminDocumentType = {
  id: string
  key: string
  label: string
  description: string | null
  reviewGuidance: string | null
  defaultPhase: 'before_required' | 'during_execution' | 'after_completion'
  sortOrder: number
  isActive: boolean
}

export type RenoAppAdminParticipantRole = {
  id: string
  key: string
  label: string
  description: string | null
  reviewGuidance: string | null
  roleKind: 'contractor' | 'consultant'
  verificationInstructions: string | null
  verificationUrl: string | null
  insuranceRequired: boolean
  requiresCompanyName: boolean
  requiresOrgNumber: boolean
  requiresContactName: boolean
  requiresEmail: boolean
  requiresPhone: boolean
  requiresCertification: boolean
  sortOrder: number
  isActive: boolean
}

export type RenoAppAdminQuestionOption = {
  id: string
  key: string
  label: string
  description: string | null
  sortOrder: number
  isActive: boolean
  metadata: unknown
  triggers: RenoAppAdminQuestionOptionTrigger[]
}

export type RenoAppAdminQuestionOptionTrigger = {
  id: string
  triggerType: 'question' | 'document' | 'participant_role' | 'review_flag'
  questionId: string | null
  questionLabel: string | null
  documentTypeId: string | null
  documentTypeLabel: string | null
  participantRoleId: string | null
  participantRoleLabel: string | null
  reviewFlagId: string | null
  reviewFlagLabel: string | null
  sortOrder: number
  isActive: boolean
}

export type RenoAppAdminQuestion = {
  id: string
  key: string
  label: string
  helpText: string | null
  responseType: 'single_select' | 'multi_select' | 'boolean'
  sortOrder: number
  isActive: boolean
  metadata: unknown
  options: RenoAppAdminQuestionOption[]
}

export type RenoAppAdminReviewFlag = {
  id: string
  key: string
  label: string
  description: string | null
  severity: 'info' | 'warning' | 'high'
  category: string
  sortOrder: number
  isActive: boolean
}

export type RenoAppAdminActionTypeParticipantRole = {
  id: string
  participantRoleId: string
  participantRoleKey: string
  participantRoleLabel: string
  participantRoleDescription: string | null
  roleKind: 'contractor' | 'consultant'
  isRequired: boolean
  sortOrder: number
}

export type RenoAppAdminActionTypeParticipantRoleGroup = {
  actionType: RenoAppAdminActionType
  participantRoles: RenoAppAdminActionTypeParticipantRole[]
}

export type RenoAppAdminActionTypeQuestion = {
  id: string
  questionId: string
  questionKey: string
  questionLabel: string
  questionHelpText: string | null
  isRequired: boolean
  sortOrder: number
}

export type RenoAppAdminActionTypeQuestionGroup = {
  actionType: RenoAppAdminActionType
  questions: RenoAppAdminActionTypeQuestion[]
}

export type RenoAppAdminActionCategory = {
  id: string
  slug: string
  label: string
  description: string | null
  sortOrder: number
  isActive: boolean
}

export type RenoAppAdminTerminologyGroup = {
  id: string
  key: string
  label: string
  description: string | null
  sortOrder: number
  isLocked: boolean
  isActive: boolean
}

export type RenoAppAdminTerminologyAlias = {
  id: string
  alias: string
  sortOrder: number
  isActive: boolean
}

export type RenoAppAdminTerminologyRule = {
  id: string
  ruleKey: string
  label: string
  description: string | null
  config: unknown
  sortOrder: number
  isActive: boolean
}

export type RenoAppAdminTerminologyTerm = {
  id: string
  groupId: string
  groupKey: string
  groupLabel: string
  code: string
  label: string
  definition: string | null
  termLevel: 'ux' | 'technical' | 'classification' | 'status' | 'document_phase' | 'decision'
  inputKind: 'user_visible' | 'system_internal' | 'system_generated'
  isLocked: boolean
  isUserSelectable: boolean
  isSystemGenerated: boolean
  isActive: boolean
  sortOrder: number
  metadata: unknown
  aliases: RenoAppAdminTerminologyAlias[]
  rules: RenoAppAdminTerminologyRule[]
}

export type RenoAppCaseAccessResult = {
  state: 'open' | 'expired' | 'revoked'
  access: {
    scope: CaseAccessLinkRow['scope']
    allowedActions: string[]
    expiresAt: string
    revokedAt: string | null
    lastUsedAt: string | null
  }
  brf: {
    id: string
    name: string
    slug: string
  }
  case: {
    id: string
    caseNumber: string
    title: string
    description: string | null
    status: string
    riskLevel: string | null
    submittedAt: string
    blockedAt: string | null
    blockedReason: string | null
    actionType: {
      key: string
      label: string
    } | null
  }
  contact: {
    id: string | null
    name: string | null
    email: string | null
    phone: string | null
  }
  unit: {
    id: string | null
    unitNumberInternal: string | null
    unitNumberSkatteverket: string | null
    status: string | null
  }
  documents: Array<{
    id: string
    fileName: string | null
    status: string
    uploadedAt: string
    note: string | null
  }>
  documentOptions: Array<{
    id: string
    label: string
    description: string | null
    isRequired: boolean
  }>
}

export type RenoAppViewerContext = {
  userId: string
  profile: ProfileLite
  isInternalAdmin: boolean
  brfs: Array<{
    id: string
    name: string | null
    slug: string | null
    role: 'board' | 'admin'
  }>
  activeBrfId: string | null
  accessibleBrfIds: string[] | null
}

export type RenoAppDashboardSummary = {
  accessibleBrfs: RenoAppViewerContext['brfs']
  activeBrfId: string | null
  viewerName: string | null
  stats: {
    newCases: number
    needInfoCases: number
    handledCases: number
  }
}

export type RenoAppUserListItem = {
  brf: {
    id: string
    name: string | null
    slug: string | null
  }
  members: Array<{
    profileId: string
    fullName: string | null
    email: string | null
    role: 'board' | 'admin'
    acceptedAt: string | null
    receivesGeneralInfoEmails: boolean
    receivesCaseEventEmails: boolean
  }>
  pendingInvites: Array<{
    id: string
    fullName: string | null
    email: string
    expiresAt: string
    createdAt: string
  }>
}

type RenoAppNotificationRecipient = {
  email: string
  fullName: string | null
}

export type CreateRenoAppUserInviteResult = {
  invite: {
    id: string
    email: string
    fullName: string | null
    expiresAt: string
    inviteUrl: string
    emailSent: boolean
    emailError: string | null
  }
}

export type RenoAppEditableBrf = {
  id: string
  name: string
  slug: string
  orgNumber: string | null
  propertyDesignation: string | null
  address: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  generalEmail: string | null
  brfPhone: string | null
  invoiceAddress: string | null
  invoiceEmail: string | null
  invoiceReference: string | null
  primaryContactName: string | null
  primaryContactEmail: string | null
  primaryContactPhone: string | null
  unitCount: number | null
  technicalContact: string | null
  applyIntroText: string | null
  isPublicApplyEnabled: boolean
  isPublicApplyListed: boolean
  onboardingCompletedAt: string | null
}

type UpdateRenoAppBrfInput = {
  brfId: string
  name: string
  orgNumber: string
  propertyDesignation: string
  address: string
  addressLine2?: string | null
  postalCode: string
  city: string
  generalEmail?: string | null
  brfPhone?: string | null
  invoiceAddress: string
  invoiceEmail: string
  invoiceReference?: string | null
  primaryContactName: string
  primaryContactEmail: string
  primaryContactPhone: string
  unitCount?: string | number | null
  technicalContact?: string | null
  applyIntroText?: string | null
  isPublicApplyEnabled: boolean
  isPublicApplyListed: boolean
}

export type RenoAppCaseListItem = {
  id: string
  caseNumber: string
  title: string
  status: string
  riskLevel: string | null
  updatedAt: string
  submittedAt: string
  brf: {
    id: string
    name: string | null
    slug: string | null
  }
  actionType: {
    key: string
    label: string
  } | null
  applicant: {
    name: string | null
    email: string | null
  }
}

export type RenoAppUnitListItem = {
  id: string
  unitNumberInternal: string | null
  unitNumberSkatteverket: string | null
  status: string
  updatedAt: string
  brf: {
    id: string
    name: string | null
    slug: string | null
  }
  currentContacts: Array<{
    id: string
    name: string | null
    email: string | null
    verificationStatus: string
    relationshipType: string
  }>
}

export type RenoAppCaseDetail = {
  id: string
  caseNumber: string
  title: string
  description: string | null
  status: string
  riskLevel: string | null
  submittedAt: string
  updatedAt: string
  blockedAt: string | null
  blockedReason: string | null
  brf: {
    id: string
    name: string | null
    slug: string | null
  }
  actionType: {
    id: string | null
    key: string | null
    label: string | null
  }
  actionTypes: Array<{
    id: string
    key: string
    label: string
  }>
  applicant: {
    id: string | null
    name: string | null
    email: string | null
    phone: string | null
  }
  unit: {
    id: string | null
    unitNumberInternal: string | null
    unitNumberSkatteverket: string | null
    status: string | null
  }
  checks: {
    affectsStructure: boolean
    affectsPlumbing: boolean
    affectsVentilation: boolean
    affectsElectrical: boolean
    affectsWetRoom: boolean
    affectsSurfaceOnly: boolean
  } | null
  currentContacts: Array<{
    id: string
    name: string | null
    email: string | null
    verificationStatus: string
    relationshipType: string
  }>
  documents: Array<{
    id: string
    documentTypeId: string | null
    documentTypeLabel: string | null
    fileName: string | null
    status: string
    uploadedAt: string
    note: string | null
  }>
  underlag: Array<{
    id: string
    category: 'document' | 'participant'
    label: string
    reviewGuidance: string | null
    checked: boolean
    documentId: string | null
    summary: string[]
    details: {
      companyName: string | null
      contactName: string | null
      orgNumber: string | null
      email: string | null
      phone: string | null
      certificationReference: string | null
      hasVerifiedAuthorization: boolean
      acceptsResponsibility: boolean
    } | null
  }>
  requirements: PublicRequirement[]
  decisions: Array<{
    id: string
    decision: string
    conditions: string | null
    reason: string | null
    decidedAt: string
  }>
  accessLinks: Array<{
    id: string
    email: string
    scope: string
    expiresAt: string
    revokedAt: string | null
    lastUsedAt: string | null
  }>
  reviewFlags: Array<{
    id: string
    code: string
    label: string
    description: string | null
    severity: 'info' | 'warning' | 'high'
    category: string
    sourceType: 'answer_rule' | 'missing_document' | 'participant'
    sourceLabel: string | null
  }>
  messages: RenoAppCaseMessage[]
}

export type UpdateRenoAppCaseStatusInput = {
  status: 'review' | 'need_info' | 'approved' | 'conditional' | 'rejected'
  reason?: string | null
  conditions?: string | null
  requestOrigin?: string | null
}

function parseBrfAssociationValue(value: BrfMemberRow['brf_associations']) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function mapRenoAppRoleFromAssignment(roleKey: PlatformAccessAssignment['roleKey']): 'board' | 'admin' {
  return roleKey === 'renoapp_admin' ? 'admin' : 'board'
}

async function loadNormalizedRenoAppBrfs(
  admin: SupabaseAdminClient,
  assignments: PlatformAccessAssignment[]
): Promise<RenoAppViewerContext['brfs']> {
  const scopedAssignments = assignments.filter(
    (assignment) =>
      assignment.productKey === 'renoapp' &&
      (assignment.moduleKey === null || assignment.moduleKey === 'board_portal') &&
      assignment.scopeType === 'brf' &&
      Boolean(assignment.scopeId)
  )

  if (scopedAssignments.length === 0) {
    return []
  }

  const roleByBrfId = new Map<string, 'board' | 'admin'>()
  for (const assignment of scopedAssignments) {
    const brfId = assignment.scopeId
    if (!brfId) continue

    const nextRole = mapRenoAppRoleFromAssignment(assignment.roleKey)
    const currentRole = roleByBrfId.get(brfId)
    if (currentRole === 'admin') continue
    roleByBrfId.set(brfId, nextRole)
  }

  const brfIds = Array.from(roleByBrfId.keys())
  const brfResult =
    brfIds.length > 0
      ? await admin.from('brf_associations').select('id,name,slug').in('id', brfIds)
      : { data: [], error: null }

  if (brfResult.error) {
    throw new Error(brfResult.error.message ?? 'Kunde inte lasa RenoApp-BRF:er via platform_access_assignments.')
  }

  const brfMap = new Map(
    ((brfResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        name: typeof row.name === 'string' ? row.name : null,
        slug: typeof row.slug === 'string' ? row.slug : null,
      },
    ])
  )

  return brfIds.map((brfId) => {
    const brf = brfMap.get(brfId)
    return {
      id: brfId,
      name: brf?.name ?? null,
      slug: brf?.slug ?? null,
      role: roleByBrfId.get(brfId) ?? 'board',
    }
  })
}

async function loadLegacyRenoAppBrfs(
  admin: SupabaseAdminClient,
  profileId: string
): Promise<RenoAppViewerContext['brfs']> {
  const { data: memberRows, error: memberError } = await admin
    .from('brf_members')
    .select('brf_id,role,is_active,brf_associations(name,slug)')
    .eq('profile_id', profileId)
    .eq('is_active', true)

  if (memberError) {
    throw new Error(memberError.message ?? 'Kunde inte lasa RenoApp-medlemskap.')
  }

  return ((memberRows ?? []) as BrfMemberRow[]).map((row) => {
    const brf = parseBrfAssociationValue(row.brf_associations)
    return {
      id: row.brf_id,
      name: brf?.name ?? null,
      slug: brf?.slug ?? null,
      role: row.role,
    }
  })
}

function computeRiskLevelFromActionTypes(actionTypes: ActionTypeRow[]) {
  if (actionTypes.some((item) => item.risk_level === 'high')) return 'high'
  if (actionTypes.some((item) => item.risk_level === 'medium')) return 'medium'
  if (actionTypes.some((item) => item.risk_level === 'low')) return 'low'
  return null
}

function computeRiskLevel(checks?: CreatePublicApplicationInput['checks']) {
  if (!checks) return null
  if (checks.affectsStructure || checks.affectsPlumbing || checks.affectsVentilation) return 'high'
  if (checks.affectsElectrical || checks.affectsWetRoom) return 'medium'
  if (checks.affectsSurfaceOnly) return 'low'
  return null
}

function deriveChecksFromActionTypes(actionTypes: ActionTypeRow[]) {
  return {
    affectsStructure: actionTypes.some((item) => item.implies_structure),
    affectsPlumbing: actionTypes.some((item) => item.implies_plumbing),
    affectsVentilation: actionTypes.some((item) => item.implies_ventilation),
    affectsElectrical: actionTypes.some((item) => item.implies_electrical),
    affectsWetRoom: actionTypes.some((item) => item.implies_wet_room),
    affectsSurfaceOnly:
      actionTypes.length > 0 &&
      actionTypes.every((item) => item.implies_surface_only) &&
      !actionTypes.some(
        (item) =>
          item.implies_structure ||
          item.implies_plumbing ||
          item.implies_ventilation ||
          item.implies_electrical ||
          item.implies_wet_room
      ),
  }
}

function requiresQualifiedContractor(actionTypes: ActionTypeRow[]) {
  return actionTypes.some((item) => item.contractor_requirement !== 'none')
}

function getContractorRequirementLabel(requirement: ActionTypeRow['contractor_requirement']) {
  if (requirement === 'authorized_electrician') return 'Behörig elektriker'
  if (requirement === 'safe_water') return 'Säker Vatten-auktoriserad VVS-entreprenör'
  if (requirement === 'bkr_or_gvk') return 'Behörig våtrumsentreprenör enligt BKR eller GVK'
  if (requirement === 'structural_engineer') return 'Konstruktör eller särskilt sakkunnig'
  if (requirement === 'qualified_contractor') return 'Kvalificerad entreprenör'
  return 'Ingen särskild entreprenör krävs'
}

function buildContractorRequirementSummary(actionTypes: ActionTypeRow[]) {
  return Array.from(new Set(actionTypes.map((item) => item.contractor_requirement)))
    .filter((item) => item !== 'none')
    .map((item) => ({
      code: item,
      label: getContractorRequirementLabel(item),
    }))
}

function allowedActionsFromScope(scope: CaseAccessLinkRow['scope']) {
  if (scope === 'answer_questions') return ['read', 'upload_documents', 'answer_questions']
  if (scope === 'upload_documents') return ['read', 'upload_documents']
  return ['read']
}

function mapCaseMessage(row: CaseMessageRow): RenoAppCaseMessage {
  return {
    id: row.id,
    type: row.type,
    authorRole: row.author_role,
    authorName: null,
    message: row.message,
    createdAt: row.created_at,
  }
}

async function listCaseMessages(admin: SupabaseAdminClient, caseId: string) {
  const { data, error } = await admin
    .from('renovation_case_messages')
    .select('id,case_id,type,author_role,author_profile_id,author_contact_id,message,metadata,created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte lÃ¤sa Ã¤rendemeddelanden.')
  }

  const rows = (data ?? []) as CaseMessageRow[]
  const profileIds = Array.from(new Set(rows.map((row) => row.author_profile_id).filter(Boolean))) as string[]
  const contactIds = Array.from(new Set(rows.map((row) => row.author_contact_id).filter(Boolean))) as string[]

  const [profilesResult, contactsResult] = await Promise.all([
    profileIds.length > 0
      ? admin.from('profiles').select('id,full_name').in('id', profileIds)
      : Promise.resolve({ data: [], error: null }),
    contactIds.length > 0
      ? admin.from('contacts').select('id,name').in('id', contactIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message ?? 'Kunde inte lÃ¤sa anvÃ¤ndarnamn fÃ¶r Ã¤rendehistorik.')
  }
  if (contactsResult.error) {
    throw new Error(contactsResult.error.message ?? 'Kunde inte lÃ¤sa kontaktnamn fÃ¶r Ã¤rendehistorik.')
  }

  const profileNameById = new Map(
    ((profilesResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      (row.full_name as string | null | undefined) ?? null,
    ])
  )
  const contactNameById = new Map(
    ((contactsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      (row.name as string | null | undefined) ?? null,
    ])
  )

  return rows.map((row) => ({
    ...mapCaseMessage(row),
    authorName:
      (row.author_profile_id ? profileNameById.get(row.author_profile_id) ?? null : null) ??
      (row.author_contact_id ? contactNameById.get(row.author_contact_id) ?? null : null),
  }))
}

async function insertCaseMessage(input: {
  admin: SupabaseAdminClient
  caseId: string
  type: CaseMessageRow['type']
  authorRole: CaseMessageRow['author_role']
  authorProfileId?: string | null
  authorContactId?: string | null
  message?: string | null
  metadata?: Record<string, unknown>
}) {
  const { admin, caseId, type, authorRole, authorProfileId = null, authorContactId = null, message = null, metadata = {} } = input

  const { error } = await admin.from('renovation_case_messages').insert({
    case_id: caseId,
    type,
    author_role: authorRole,
    author_profile_id: authorProfileId,
    author_contact_id: authorContactId,
    message,
    metadata,
  })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte spara Ã¤rendemeddelande.')
  }
}

async function createUniqueCaseNumber(admin: SupabaseAdminClient) {
  const stockholmParts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = stockholmParts.find((part) => part.type === 'year')?.value ?? String(new Date().getFullYear())
  const month = stockholmParts.find((part) => part.type === 'month')?.value ?? '01'
  const day = stockholmParts.find((part) => part.type === 'day')?.value ?? '01'
  const prefix = `RA-${year}-${month}${day}-`

  const { data, error } = await admin
    .from('renovation_cases')
    .select('case_number')
    .like('case_number', `${prefix}%`)
    .order('case_number', { ascending: false })
    .limit(100)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte generera ?rendenummer.')
  }

  const existingNumbers = ((data ?? []) as Array<{ case_number?: string | null }>)
    .map((item) => String(item.case_number ?? ''))
    .filter((value) => value.startsWith(prefix))

  const highestSequence = existingNumbers.reduce((max, value) => {
    const suffix = value.slice(prefix.length)
    const parsed = Number.parseInt(suffix, 10)
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max
  }, 0)

  const nextSequence = highestSequence + 1
  if (nextSequence > 99) {
    throw new Error('Kunde inte generera ?rendenummer f?r dagen.')
  }

  return `${prefix}${String(nextSequence).padStart(2, '0')}`
}

async function getPublicBrfBySlug(admin: SupabaseAdminClient, slug: string) {
  const { data, error } = await admin
    .from('brf_associations')
    .select('id,name,slug,email,is_public_apply_enabled,apply_intro_text')
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hÃ¤mta BRF.')
  }

  return (data ?? null) as BrfAssociationRow | null
}

export async function listRenoAppPublicBrfs(): Promise<RenoAppPublicBrfListItem[]> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const { data, error } = await admin
    .from('brf_associations')
    .select('id,name,slug,address,is_public_apply_enabled,is_public_apply_listed')
    .eq('is_public_apply_enabled', true)
    .eq('is_public_apply_listed', true)
    .order('name', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hÃ¤mta publika BRF:er.')
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    address: (row.address as string | null | undefined) ?? null,
  }))
}

async function listActiveActionTypes(admin: SupabaseAdminClient) {
  const { data, error } = await admin
    .from('renovation_action_types')
    .select(
      'id,category_id,key,label,description,risk_level,contractor_requirement,implies_structure,implies_plumbing,implies_ventilation,implies_electrical,implies_wet_room,implies_surface_only,sort_order,is_active'
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hÃ¤mta Ã¥tgÃ¤rdstyper.')
  }

  return (data ?? []) as ActionTypeRow[]
}

async function listActiveActionCategories(admin: SupabaseAdminClient) {
  const { data, error } = await admin
    .from('renovation_action_categories')
    .select('id,slug,label,description,sort_order,is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hÃ¤mta Ã¥tgÃ¤rdskategorier.')
  }

  return (data ?? []) as ActionCategoryRow[]
}

async function listActiveDocumentTypes(admin: SupabaseAdminClient) {
  const { data, error } = await admin
    .from('renovation_document_types')
    .select('id,key,label,description,review_guidance,default_phase,sort_order,is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hÃ¤mta dokumenttyper.')
  }

  return (data ?? []) as DocumentTypeRow[]
}

async function listActiveParticipantRoles(admin: SupabaseAdminClient) {
  const { data, error } = await admin
    .from('renoapp_participant_roles')
    .select(
      'id,key,label,description,review_guidance,role_kind,verification_instructions,verification_url,insurance_required,requires_company_name,requires_org_number,requires_contact_name,requires_email,requires_phone,requires_certification,sort_order,is_active'
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hÃ¤mta medverkandetyper.')
  }

  return (data ?? []) as ParticipantRoleRow[]
}

async function listActiveReviewFlags(admin: SupabaseAdminClient) {
  const { data, error } = await admin
    .from('renoapp_review_flags')
    .select('id,key,label,description,severity,category,sort_order,is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hÃ¤mta granskningsflaggor.')
  }

  return (data ?? []) as ReviewFlagRow[]
}

function mapParticipantRoleToPublic(
  row: ParticipantRoleRow,
  overrides?: Partial<Pick<PublicParticipantRole, 'isRequired' | 'sortOrder'>>
): PublicParticipantRole {
  return {
    id: row.id,
    key: row.key,
    label: repairLikelyMojibakeText(row.label) ?? '',
    description: repairLikelyMojibakeText(row.description ?? null),
    reviewGuidance: repairLikelyMojibakeText(row.review_guidance ?? null),
    roleKind: row.role_kind,
    verificationInstructions: repairLikelyMojibakeText(row.verification_instructions ?? null),
    verificationUrl: row.verification_url ?? null,
    insuranceRequired: row.insurance_required === true,
    requiresCompanyName: row.requires_company_name,
    requiresOrgNumber: row.requires_org_number,
    requiresContactName: row.requires_contact_name,
    requiresEmail: row.requires_email,
    requiresPhone: row.requires_phone,
    requiresCertification: row.requires_certification,
    isRequired: overrides?.isRequired ?? true,
    sortOrder: overrides?.sortOrder ?? row.sort_order,
  }
}

function mapParticipantRoleToAdmin(row: ParticipantRoleRow): RenoAppAdminParticipantRole {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description ?? null,
    reviewGuidance: row.review_guidance ?? null,
    roleKind: row.role_kind,
    verificationInstructions: row.verification_instructions ?? null,
    verificationUrl: row.verification_url ?? null,
    insuranceRequired: row.insurance_required === true,
    requiresCompanyName: row.requires_company_name,
    requiresOrgNumber: row.requires_org_number,
    requiresContactName: row.requires_contact_name,
    requiresEmail: row.requires_email,
    requiresPhone: row.requires_phone,
    requiresCertification: row.requires_certification,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

function mapReviewFlagToAdmin(row: ReviewFlagRow): RenoAppAdminReviewFlag {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description ?? null,
    severity: row.severity,
    category: row.category,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

async function listRequirements(admin: SupabaseAdminClient, brfId: string) {
  const globalQuery = await admin
    .from('renovation_action_document_requirements')
    .select('id,brf_id,action_type_id,document_type_id,is_required,phase,note,sort_order')
    .is('brf_id', null)
    .order('sort_order', { ascending: true })

  if (globalQuery.error) {
    throw new Error(globalQuery.error.message ?? 'Kunde inte hÃ¤mta globala dokumentkrav.')
  }

  const localQuery = await admin
    .from('renovation_action_document_requirements')
    .select('id,brf_id,action_type_id,document_type_id,is_required,phase,note,sort_order')
    .eq('brf_id', brfId)
    .order('sort_order', { ascending: true })

  if (localQuery.error) {
    throw new Error(localQuery.error.message ?? 'Kunde inte hÃ¤mta BRF-specifika dokumentkrav.')
  }

  return [...((globalQuery.data ?? []) as RequirementRow[]), ...((localQuery.data ?? []) as RequirementRow[])]
}

async function listActiveApplyQuestions(admin: SupabaseAdminClient) {
  const [questionRows, optionRows, linkRows, triggerRows] = await Promise.all([
    admin
      .from('renoapp_apply_questions')
      .select('id,key,label,help_text,response_type,sort_order,is_locked,is_active,metadata')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    admin
      .from('renoapp_apply_question_options')
      .select('id,question_id,key,label,description,sort_order,is_active,metadata')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    admin
      .from('renoapp_action_type_questions')
      .select('id,action_type_id,question_id,sort_order,is_required,is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    admin
      .from('renoapp_apply_option_triggers')
      .select('id,option_id,trigger_type,question_id,document_type_id,participant_role_id,review_flag_id,sort_order,is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])

  if (questionRows.error) throw new Error(questionRows.error.message ?? 'Kunde inte hÃ¤mta frÃ¥gor.')
  if (optionRows.error) throw new Error(optionRows.error.message ?? 'Kunde inte hÃ¤mta svarsalternativ.')
  if (linkRows.error) throw new Error(linkRows.error.message ?? 'Kunde inte hÃ¤mta frÃ¥gekopplingar.')
  if (triggerRows.error) throw new Error(triggerRows.error.message ?? 'Kunde inte hÃ¤mta frÃ¥getriggers.')

  return {
    questions: (questionRows.data ?? []) as ApplyQuestionRow[],
    options: (optionRows.data ?? []) as ApplyQuestionOptionRow[],
    links: (linkRows.data ?? []) as ActionTypeQuestionRow[],
    triggers: (triggerRows.data ?? []) as ApplyOptionTriggerRow[],
  }
}

function buildPublicActionTypes(
  categories: ActionCategoryRow[],
  actionTypes: ActionTypeRow[],
  documentTypes: DocumentTypeRow[],
  requirements: RequirementRow[],
  participantRoles: ParticipantRoleRow[] = [],
  actionTypeParticipantRoles: ActionTypeParticipantRoleRow[] = [],
  questionRows: ApplyQuestionRow[] = [],
  optionRows: ApplyQuestionOptionRow[] = [],
  questionLinks: ActionTypeQuestionRow[] = [],
  triggerRows: ApplyOptionTriggerRow[] = [],
  reviewFlags: ReviewFlagRow[] = []
): PublicActionType[] {
  const categoryById = new Map(categories.map((item) => [item.id, item]))
  const documentById = new Map(documentTypes.map((item) => [item.id, item]))
  const participantRoleById = new Map(participantRoles.map((item) => [item.id, item]))
  const reviewFlagById = new Map(reviewFlags.map((item) => [item.id, item]))
  const requirementMap = new Map<string, RequirementRow>()
  const questionById = new Map(questionRows.map((item) => [item.id, item]))

  for (const requirement of requirements) {
    const key = `${requirement.action_type_id}:${requirement.document_type_id}`
    requirementMap.set(key, requirement)
  }

  return actionTypes.map((actionType) => ({
    id: actionType.id,
    category: (() => {
      const category = actionType.category_id ? categoryById.get(actionType.category_id) : null
      return {
        id: category?.id ?? '',
        slug: category?.slug ?? 'ovrigt',
        label: repairLikelyMojibakeText(category?.label ?? null) ?? 'Övrigt',
        description: repairLikelyMojibakeText(category?.description ?? null),
        sortOrder: category?.sort_order ?? 999,
      }
    })(),
    key: actionType.key,
    label: repairLikelyMojibakeText(actionType.label) ?? '',
    description: repairLikelyMojibakeText(actionType.description ?? null),
    riskLevel: actionType.risk_level,
    contractorRequirement: actionType.contractor_requirement,
    sortOrder: actionType.sort_order,
    requirements: Array.from(requirementMap.values())
      .filter((requirement) => requirement.action_type_id === actionType.id)
      .map((requirement) => {
        const documentType = documentById.get(requirement.document_type_id)

        return {
          id: requirement.id,
          documentTypeId: requirement.document_type_id,
          documentKey: documentType?.key ?? 'unknown',
          documentLabel: repairLikelyMojibakeText(documentType?.label ?? null) ?? 'Okänd dokumenttyp',
          documentDescription: repairLikelyMojibakeText(documentType?.description ?? null),
          isRequired: requirement.is_required,
          phase: requirement.phase,
          note: repairLikelyMojibakeText(requirement.note),
          sortOrder: requirement.sort_order,
        }
      })
      .sort((left, right) => left.sortOrder - right.sortOrder),
    participantRoles: actionTypeParticipantRoles
      .filter((link) => link.action_type_id === actionType.id && link.is_active)
      .map((link) => {
        const participantRole = participantRoleById.get(link.participant_role_id)
        if (!participantRole) return null
        return mapParticipantRoleToPublic(participantRole, {
          isRequired: link.is_required,
          sortOrder: link.sort_order,
        })
      })
      .filter((item): item is PublicParticipantRole => Boolean(item))
      .sort((left, right) => left.sortOrder - right.sortOrder),
    questions: questionLinks
      .filter((link) => link.action_type_id === actionType.id)
      .map((link) => {
        const question = questionById.get(link.question_id)
        if (!question) return null

        return {
          id: question.id,
          key: question.key,
          label: repairLikelyMojibakeText(question.label) ?? '',
          helpText: repairLikelyMojibakeText(question.help_text ?? null),
          responseType: question.response_type,
          sortOrder: link.sort_order,
          isRequired: link.is_required,
          options: optionRows
            .filter((option) => option.question_id === question.id)
            .map((option) => ({
              id: option.id,
              key: option.key,
              label: repairLikelyMojibakeText(option.label) ?? '',
              description: repairLikelyMojibakeText(option.description ?? null),
              sortOrder: option.sort_order,
              triggers: triggerRows
                .filter((trigger) => trigger.option_id === option.id)
                .map((trigger) => {
                  const documentType = trigger.document_type_id
                    ? documentById.get(trigger.document_type_id)
                    : null
                  const participantRole = trigger.participant_role_id
                    ? participantRoleById.get(trigger.participant_role_id)
                    : null
                  const reviewFlag = trigger.review_flag_id
                    ? reviewFlagById.get(trigger.review_flag_id)
                    : null

                  return {
                    id: trigger.id,
                    triggerType: trigger.trigger_type,
                    questionId: trigger.question_id ?? null,
                    documentTypeId: trigger.document_type_id ?? null,
                    documentKey: documentType?.key ?? null,
                    documentLabel: documentType?.label ?? null,
                    documentDescription: documentType?.description ?? null,
                    documentPhase: documentType?.default_phase ?? null,
                    participantRoleId: trigger.participant_role_id ?? null,
                    participantRole: participantRole
                      ? mapParticipantRoleToPublic(participantRole)
                      : null,
                    reviewFlagId: trigger.review_flag_id ?? null,
                    reviewFlag: reviewFlag
                      ? {
                          id: reviewFlag.id,
                          key: reviewFlag.key,
                          label: reviewFlag.label,
                          description: reviewFlag.description ?? null,
                          severity: reviewFlag.severity,
                          category: reviewFlag.category,
                        }
                      : null,
                    sortOrder: trigger.sort_order,
                  } satisfies PublicApplyQuestionOptionTrigger
                })
                .sort((left, right) => left.sortOrder - right.sortOrder),
            }))
            .sort((left, right) => left.sortOrder - right.sortOrder),
        } satisfies PublicApplyQuestion
      })
      .filter((item): item is PublicApplyQuestion => Boolean(item))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')),
  }))
}

function buildPublicQuestionBank(
  questionRows: ApplyQuestionRow[],
  optionRows: ApplyQuestionOptionRow[],
  documentTypes: DocumentTypeRow[],
  participantRoles: ParticipantRoleRow[],
  triggerRows: ApplyOptionTriggerRow[],
  reviewFlags: ReviewFlagRow[] = []
): PublicApplyQuestion[] {
  const documentById = new Map(documentTypes.map((item) => [item.id, item]))
  const participantRoleById = new Map(participantRoles.map((item) => [item.id, item]))
  const reviewFlagById = new Map(reviewFlags.map((item) => [item.id, item]))

  return questionRows
    .map((question) => ({
      id: question.id,
      key: question.key,
      label: repairLikelyMojibakeText(question.label) ?? '',
      helpText: repairLikelyMojibakeText(question.help_text ?? null),
      responseType: question.response_type,
      sortOrder: question.sort_order,
      isRequired: false,
      options: optionRows
        .filter((option) => option.question_id === question.id)
        .map((option) => ({
          id: option.id,
          key: option.key,
          label: repairLikelyMojibakeText(option.label) ?? '',
          description: repairLikelyMojibakeText(option.description ?? null),
          sortOrder: option.sort_order,
          triggers: triggerRows
            .filter((trigger) => trigger.option_id === option.id)
            .map((trigger) => {
              const documentType = trigger.document_type_id
                ? documentById.get(trigger.document_type_id)
                : null
              const participantRole = trigger.participant_role_id
                ? participantRoleById.get(trigger.participant_role_id)
                : null
              const reviewFlag = trigger.review_flag_id
                ? reviewFlagById.get(trigger.review_flag_id)
                : null

              return {
                id: trigger.id,
                triggerType: trigger.trigger_type,
                questionId: trigger.question_id ?? null,
                documentTypeId: trigger.document_type_id ?? null,
                documentKey: documentType?.key ?? null,
                documentLabel: documentType?.label ?? null,
                documentDescription: documentType?.description ?? null,
                documentPhase: documentType?.default_phase ?? null,
                participantRoleId: trigger.participant_role_id ?? null,
                participantRole: participantRole ? mapParticipantRoleToPublic(participantRole) : null,
                reviewFlagId: trigger.review_flag_id ?? null,
                reviewFlag: reviewFlag
                  ? {
                      id: reviewFlag.id,
                      key: reviewFlag.key,
                      label: reviewFlag.label,
                      description: reviewFlag.description ?? null,
                      severity: reviewFlag.severity,
                      category: reviewFlag.category,
                    }
                  : null,
                sortOrder: trigger.sort_order,
              } satisfies PublicApplyQuestionOptionTrigger
            })
            .sort((left, right) => left.sortOrder - right.sortOrder),
        }))
        .sort((left, right) => left.sortOrder - right.sortOrder),
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv'))
}

function resolveApplicableQuestionsForSelection(params: {
  selectedActionTypes: ActionTypeRow[]
  questionRows: ApplyQuestionRow[]
  optionRows: ApplyQuestionOptionRow[]
  questionLinks: ActionTypeQuestionRow[]
  triggerRows: ApplyOptionTriggerRow[]
  questionAnswers: Record<string, string[]>
}): PublicApplyQuestion[] {
  const { selectedActionTypes, questionRows, optionRows, questionLinks, triggerRows, questionAnswers } = params
  const selectedActionTypeIds = new Set(selectedActionTypes.map((item) => item.id))
  const questionById = new Map(questionRows.map((item) => [item.id, item]))
  const optionRowsByQuestionId = new Map<string, ApplyQuestionOptionRow[]>()
  const triggerRowsByOptionId = new Map<string, ApplyOptionTriggerRow[]>()

  for (const option of optionRows) {
    const current = optionRowsByQuestionId.get(option.question_id) ?? []
    current.push(option)
    optionRowsByQuestionId.set(option.question_id, current)
  }

  for (const trigger of triggerRows) {
    const current = triggerRowsByOptionId.get(trigger.option_id) ?? []
    current.push(trigger)
    triggerRowsByOptionId.set(trigger.option_id, current)
  }

  const questionBankById = new Map<string, PublicApplyQuestion>()
  for (const questionRow of questionRows) {
    questionBankById.set(questionRow.id, {
      id: questionRow.id,
      key: questionRow.key,
      label: questionRow.label,
      helpText: questionRow.help_text ?? null,
      responseType: questionRow.response_type,
      sortOrder: questionRow.sort_order,
      isRequired: false,
      options: (optionRowsByQuestionId.get(questionRow.id) ?? [])
        .map((optionRow) => ({
          id: optionRow.id,
          key: optionRow.key,
          label: optionRow.label,
          description: optionRow.description ?? null,
          sortOrder: optionRow.sort_order,
          triggers: (triggerRowsByOptionId.get(optionRow.id) ?? [])
            .map((triggerRow) => ({
              id: triggerRow.id,
              triggerType: triggerRow.trigger_type,
              questionId: triggerRow.question_id ?? null,
              documentTypeId: triggerRow.document_type_id ?? null,
              documentKey: null,
              documentLabel: null,
              documentDescription: null,
              documentPhase: null,
              participantRoleId: triggerRow.participant_role_id ?? null,
              participantRole: null,
              reviewFlagId: triggerRow.review_flag_id ?? null,
              reviewFlag: null,
              sortOrder: triggerRow.sort_order,
            }))
            .sort((left, right) => left.sortOrder - right.sortOrder),
        }))
        .sort((left, right) => left.sortOrder - right.sortOrder),
    })
  }

  const resolvedQuestionMap = new Map<string, PublicApplyQuestion>()

  const mergeQuestion = (candidate: PublicApplyQuestion) => {
    const current = resolvedQuestionMap.get(candidate.id)
    if (!current) {
      resolvedQuestionMap.set(candidate.id, candidate)
      return true
    }

    const next = {
      ...current,
      isRequired: current.isRequired || candidate.isRequired,
      sortOrder: Math.min(current.sortOrder, candidate.sortOrder),
      options: current.options.length > 0 ? current.options : candidate.options,
    }

    const changed =
      next.isRequired !== current.isRequired ||
      next.sortOrder !== current.sortOrder ||
      next.options !== current.options

    if (changed) {
      resolvedQuestionMap.set(candidate.id, next)
    }

    return changed
  }

  for (const link of questionLinks) {
    if (!selectedActionTypeIds.has(link.action_type_id)) continue
    const questionRow = questionById.get(link.question_id)
    const question = questionRow ? questionBankById.get(questionRow.id) : null
    if (!question) continue

    mergeQuestion({
      ...question,
      isRequired: link.is_required,
      sortOrder: Math.min(question.sortOrder, link.sort_order),
    })
  }

  let changed = true
  while (changed) {
    changed = false

    for (const question of Array.from(resolvedQuestionMap.values())) {
      const selectedOptionKeys = questionAnswers[question.key] ?? []
      if (selectedOptionKeys.length === 0) continue

      for (const option of question.options) {
        if (!selectedOptionKeys.includes(option.key)) continue

        for (const trigger of option.triggers) {
          if (trigger.triggerType !== 'question' || !trigger.questionId) continue
          const triggeredQuestion = questionBankById.get(trigger.questionId)
          if (!triggeredQuestion) continue

          changed =
            mergeQuestion({
              ...triggeredQuestion,
              isRequired: true,
            }) || changed
        }
      }
    }
  }

  return Array.from(resolvedQuestionMap.values()).sort(
    (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
  )
}

async function listCaseActionTypes(admin: SupabaseAdminClient, caseIds: string[]) {
  if (caseIds.length === 0) return [] as CaseActionTypeRow[]

  const { data, error } = await admin
    .from('renovation_case_action_types')
    .select('case_id,action_type_id')
    .in('case_id', caseIds)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte lÃ¤sa Ã¤rendets Ã¥tgÃ¤rdstyper.')
  }

  return (data ?? []) as CaseActionTypeRow[]
}

async function listCaseQuestionAnswers(admin: SupabaseAdminClient, caseIds: string[]) {
  if (caseIds.length === 0) return [] as CaseQuestionAnswerRow[]

  const { data, error } = await admin
    .from('renoapp_case_question_answers')
    .select('id,case_id,question_id,option_id')
    .in('case_id', caseIds)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte lÃ¤sa Ã¤rendets frÃ¥gesvar.')
  }

  return (data ?? []) as CaseQuestionAnswerRow[]
}

async function listCaseParticipants(admin: SupabaseAdminClient, caseIds: string[]) {
  if (caseIds.length === 0) return [] as CaseParticipantRow[]

  const { data, error } = await admin
    .from('renoapp_case_participants')
    .select(
      'id,case_id,participant_role_id,company_name,org_number,contact_name,email,phone,certification_reference,has_verified_authorization,accepts_responsibility'
    )
    .in('case_id', caseIds)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte lÃ¤sa Ã¤rendets entreprenÃ¶rer och konsulter.')
  }

  return (data ?? []) as CaseParticipantRow[]
}

function mergeReviewFlagSourceLabel(current: string | null, next: string | null) {
  if (!next) return current
  if (!current) return next
  if (current.includes(next)) return current
  return `${current}; ${next}`
}

function addCaseReviewFlag(
  flagMap: Map<string, RenoAppCaseDetail['reviewFlags'][number]>,
  item: RenoAppCaseDetail['reviewFlags'][number]
) {
  const existing = flagMap.get(item.code)
  if (!existing) {
    flagMap.set(item.code, item)
    return
  }

  const severityRank = { info: 1, warning: 2, high: 3 } as const
  if (severityRank[item.severity] > severityRank[existing.severity]) {
    existing.severity = item.severity
  }
  if (!existing.description && item.description) {
    existing.description = item.description
  }
  existing.sourceLabel = mergeReviewFlagSourceLabel(existing.sourceLabel, item.sourceLabel)
}

function buildCaseReviewFlags(params: {
  selectedActionTypes: ActionTypeRow[]
  requirements: RequirementRow[]
  questionConfig: {
    questions: ApplyQuestionRow[]
    options: ApplyQuestionOptionRow[]
    links: ActionTypeQuestionRow[]
    triggers: ApplyOptionTriggerRow[]
  }
  questionAnswerRows: CaseQuestionAnswerRow[]
  reviewFlags: ReviewFlagRow[]
  documentTypes: DocumentTypeRow[]
  documents: Array<{
    documentTypeId: string | null
    status: string
  }>
}): RenoAppCaseDetail['reviewFlags'] {
  const {
    selectedActionTypes,
    requirements,
    questionConfig,
    questionAnswerRows,
    reviewFlags,
    documentTypes,
    documents,
  } = params

  const selectedActionTypeIds = new Set(selectedActionTypes.map((item) => item.id))
  const questionById = new Map(questionConfig.questions.map((item) => [item.id, item]))
  const optionById = new Map(questionConfig.options.map((item) => [item.id, item]))
  const reviewFlagById = new Map(reviewFlags.map((item) => [item.id, item]))
  const documentTypeById = new Map(documentTypes.map((item) => [item.id, item]))
  const actionTypeById = new Map(selectedActionTypes.map((item) => [item.id, item]))
  const uploadedDocumentTypeIds = new Set(
    documents
      .filter((item) => item.documentTypeId && item.status !== 'missing' && item.status !== 'rejected')
      .map((item) => item.documentTypeId as string)
  )

  const questionAnswers: Record<string, string[]> = {}
  for (const answer of questionAnswerRows) {
    const question = questionById.get(answer.question_id)
    const option = optionById.get(answer.option_id)
    if (!question || !option) continue
    const current = questionAnswers[question.key] ?? []
    if (!current.includes(option.key)) {
      current.push(option.key)
      questionAnswers[question.key] = current
    }
  }

  const applicableQuestions = resolveApplicableQuestionsForSelection({
    selectedActionTypes,
    questionRows: questionConfig.questions,
    optionRows: questionConfig.options,
    questionLinks: questionConfig.links,
    triggerRows: questionConfig.triggers,
    questionAnswers,
  })

  const flagMap = new Map<string, RenoAppCaseDetail['reviewFlags'][number]>()

  for (const question of applicableQuestions) {
    const selectedOptionKeys = questionAnswers[question.key] ?? []
    if (selectedOptionKeys.length === 0) continue

    for (const option of question.options) {
      if (!selectedOptionKeys.includes(option.key)) continue

      for (const trigger of option.triggers) {
        if (trigger.triggerType === 'review_flag' && trigger.reviewFlagId) {
          const reviewFlag = reviewFlagById.get(trigger.reviewFlagId)
          if (!reviewFlag) continue

          addCaseReviewFlag(flagMap, {
            id: reviewFlag.id,
            code: reviewFlag.key,
            label: reviewFlag.label,
            description: reviewFlag.description ?? null,
            severity: reviewFlag.severity,
            category: reviewFlag.category,
            sourceType: 'answer_rule',
            sourceLabel: `${question.label}: ${option.label}`,
          })
        }

        if (
          trigger.triggerType === 'document' &&
          trigger.documentTypeId &&
          !uploadedDocumentTypeIds.has(trigger.documentTypeId)
        ) {
          const documentType = documentTypeById.get(trigger.documentTypeId)
          addCaseReviewFlag(flagMap, {
            id: `missing-document-${trigger.documentTypeId}`,
            code: `missing_document:${trigger.documentTypeId}`,
            label: `Saknat underlag: ${documentType?.label ?? trigger.documentLabel ?? 'OkÃ¤nt underlag'}`,
            description: trigger.documentDescription ?? documentType?.description ?? null,
            severity: 'warning',
            category: 'dokument',
            sourceType: 'missing_document',
            sourceLabel: `${question.label}: ${option.label}`,
          })
        }
      }
    }
  }

  for (const requirement of requirements) {
    if (!selectedActionTypeIds.has(requirement.action_type_id)) continue
    if (!requirement.is_required) continue
    if (requirement.phase !== 'before_required' && requirement.phase !== 'before_conditional') continue
    if (uploadedDocumentTypeIds.has(requirement.document_type_id)) continue

    const documentType = documentTypeById.get(requirement.document_type_id)
    const actionType = actionTypeById.get(requirement.action_type_id)

    addCaseReviewFlag(flagMap, {
      id: `missing-document-${requirement.document_type_id}`,
      code: `missing_document:${requirement.document_type_id}`,
      label: `Saknat underlag: ${documentType?.label ?? 'OkÃ¤nt underlag'}`,
      description: requirement.note ?? documentType?.description ?? null,
      severity: 'warning',
      category: 'dokument',
      sourceType: 'missing_document',
      sourceLabel: actionType?.label ?? 'Grundkrav',
    })
  }

  return Array.from(flagMap.values()).sort((left, right) => {
    const severityRank = { high: 0, warning: 1, info: 2 } as const
    return (
      severityRank[left.severity] - severityRank[right.severity] ||
      left.category.localeCompare(right.category, 'sv') ||
      left.label.localeCompare(right.label, 'sv')
    )
  })
}

function buildCaseUnderlagItems(params: {
  selectedActionTypes: ActionTypeRow[]
  requirements: RequirementRow[]
  questionConfig: {
    questions: ApplyQuestionRow[]
    options: ApplyQuestionOptionRow[]
    links: ActionTypeQuestionRow[]
    triggers: ApplyOptionTriggerRow[]
  }
  questionAnswerRows: CaseQuestionAnswerRow[]
  documentTypes: DocumentTypeRow[]
  documents: Array<{
    id: string
    documentTypeId: string | null
    participantRoleId: string | null
    documentScope: 'general' | 'participant_insurance'
    status: string
  }>
  participantRows: CaseParticipantRow[]
  participantRoles: ParticipantRoleRow[]
  actionTypeParticipantRoles: ActionTypeParticipantRoleRow[]
}): RenoAppCaseDetail['underlag'] {
  const {
    selectedActionTypes,
    requirements,
    questionConfig,
    questionAnswerRows,
    documentTypes,
    documents,
    participantRows,
    participantRoles,
    actionTypeParticipantRoles,
  } = params

  const isAcceptedDocument = (status: string) => status !== 'missing' && status !== 'rejected'
  const selectedActionTypeIds = new Set(selectedActionTypes.map((item) => item.id))
  const documentTypeById = new Map(documentTypes.map((item) => [item.id, item]))
  const participantRoleById = new Map(participantRoles.map((item) => [item.id, item]))
  const questionById = new Map(questionConfig.questions.map((item) => [item.id, item]))
  const optionById = new Map(questionConfig.options.map((item) => [item.id, item]))
  const acceptedDocuments = documents.filter((item) => isAcceptedDocument(item.status))
  const latestDocumentByTypeId = new Map<string, (typeof acceptedDocuments)[number]>()
  const latestParticipantInsuranceByRoleId = new Map<string, (typeof acceptedDocuments)[number]>()
  const participantByRoleId = new Map(participantRows.map((item) => [item.participant_role_id, item] as const))

  for (const document of acceptedDocuments) {
    if (document.documentTypeId && !latestDocumentByTypeId.has(document.documentTypeId)) {
      latestDocumentByTypeId.set(document.documentTypeId, document)
    }
    if (
      document.documentScope === 'participant_insurance' &&
      document.participantRoleId &&
      !latestParticipantInsuranceByRoleId.has(document.participantRoleId)
    ) {
      latestParticipantInsuranceByRoleId.set(document.participantRoleId, document)
    }
  }

  const questionAnswers: Record<string, string[]> = {}
  for (const answer of questionAnswerRows) {
    const question = questionById.get(answer.question_id)
    const option = optionById.get(answer.option_id)
    if (!question || !option) continue
    const current = questionAnswers[question.key] ?? []
    if (!current.includes(option.key)) {
      current.push(option.key)
      questionAnswers[question.key] = current
    }
  }

  const applicableQuestions = resolveApplicableQuestionsForSelection({
    selectedActionTypes,
    questionRows: questionConfig.questions,
    optionRows: questionConfig.options,
    questionLinks: questionConfig.links,
    triggerRows: questionConfig.triggers,
    questionAnswers,
  })

  const itemMap = new Map<
    string,
    RenoAppCaseDetail['underlag'][number] & {
      sortOrder: number
    }
  >()

  const addItem = (
    key: string,
    category: 'document' | 'participant',
    label: string,
    sortOrder: number,
    checked: boolean,
    documentId: string | null = null,
    summary: string[] = [],
    details: RenoAppCaseDetail['underlag'][number]['details'] = null,
    reviewGuidance: string | null = null
  ) => {
    const existing = itemMap.get(key)
    if (!existing) {
      itemMap.set(key, {
        id: key,
        category,
        label,
        reviewGuidance,
        checked,
        documentId,
        summary,
        details,
        sortOrder,
      })
      return
    }

    existing.label = existing.label || label
    existing.reviewGuidance = existing.reviewGuidance ?? reviewGuidance
    existing.checked = existing.checked || checked
    existing.documentId = existing.documentId ?? documentId
    existing.summary = existing.summary.length > 0 ? existing.summary : summary
    existing.details = existing.details ?? details
    existing.sortOrder = Math.min(existing.sortOrder, sortOrder)
  }

  for (const requirement of requirements) {
    if (!selectedActionTypeIds.has(requirement.action_type_id)) continue
    const documentType = documentTypeById.get(requirement.document_type_id)
    const document = latestDocumentByTypeId.get(requirement.document_type_id)
    addItem(
      `document:${requirement.document_type_id}`,
      'document',
      documentType?.label ?? 'OkÃ¤nt underlag',
      requirement.sort_order,
      Boolean(document),
      document?.id ?? null,
      [],
      null,
      documentType?.review_guidance ?? null
    )
  }

  for (const question of applicableQuestions) {
    const selectedOptionKeys = questionAnswers[question.key] ?? []
    if (selectedOptionKeys.length === 0) continue

    for (const option of question.options) {
      if (!selectedOptionKeys.includes(option.key)) continue

      for (const trigger of option.triggers) {
        if (trigger.triggerType === 'document' && trigger.documentTypeId) {
          const documentType = documentTypeById.get(trigger.documentTypeId)
          const document = latestDocumentByTypeId.get(trigger.documentTypeId)
          addItem(
            `document:${trigger.documentTypeId}`,
            'document',
            trigger.documentLabel ?? documentType?.label ?? 'OkÃ¤nt underlag',
            1000 + question.sortOrder * 10 + trigger.sortOrder,
            Boolean(document),
            document?.id ?? null,
            [],
            null,
            documentType?.review_guidance ?? null
          )
        }

        if (trigger.triggerType === 'participant_role' && trigger.participantRoleId) {
          const participantRole = trigger.participantRole
            ? {
                id: trigger.participantRole.id,
                label: trigger.participantRole.label,
                reviewGuidance: trigger.participantRole.reviewGuidance,
                insuranceRequired: trigger.participantRole.insuranceRequired,
                sortOrder: trigger.participantRole.sortOrder,
              }
            : (() => {
                const role = participantRoleById.get(trigger.participantRoleId)
                if (!role) return null
                return {
                  id: role.id,
                  label: role.label,
                  reviewGuidance: role.review_guidance ?? null,
                  insuranceRequired: role.insurance_required === true,
                  sortOrder: role.sort_order,
                }
              })()
          if (!participantRole) continue

          const participant = participantByRoleId.get(participantRole.id)
          const hasName = Boolean(
            String(participant?.company_name ?? participant?.contact_name ?? '')
              .trim()
          )
          const hasVerification = participant?.has_verified_authorization === true
          const hasTruthConfirmation = participant?.accepts_responsibility === true
          const insuranceDocument = participantRole.insuranceRequired
            ? latestParticipantInsuranceByRoleId.get(participantRole.id) ?? null
            : null
          const isComplete =
            hasName &&
            hasVerification &&
            hasTruthConfirmation &&
            (!participantRole.insuranceRequired || Boolean(insuranceDocument))
          const summary = [
            hasName ? 'Namn finns' : 'Namn saknas',
            participant?.has_verified_authorization ? 'Verifierad av sÃ¶kande' : 'Verifiering saknas',
            participant?.accepts_responsibility ? 'SanningsfÃ¶rsÃ¤kran finns' : 'SanningsfÃ¶rsÃ¤kran saknas',
            ...(participantRole.insuranceRequired
              ? [insuranceDocument ? 'FÃ¶rsÃ¤kringsbevis finns' : 'FÃ¶rsÃ¤kringsbevis saknas']
              : []),
          ]
          addItem(
            `participant:${participantRole.id}`,
            'participant',
            participantRole.label,
            2000 + question.sortOrder * 10 + trigger.sortOrder,
            isComplete,
            insuranceDocument?.id ?? null,
            summary,
            participant
              ? {
                  companyName: participant.company_name ?? null,
                  contactName: participant.contact_name ?? null,
                  orgNumber: participant.org_number ?? null,
                  email: participant.email ?? null,
                  phone: participant.phone ?? null,
                  certificationReference: participant.certification_reference ?? null,
                  hasVerifiedAuthorization: participant.has_verified_authorization === true,
                  acceptsResponsibility: participant.accepts_responsibility === true,
                }
              : null,
            participantRole.reviewGuidance ?? null
          )
        }
      }
    }
  }

  for (const link of actionTypeParticipantRoles) {
    if (!selectedActionTypeIds.has(link.action_type_id) || !link.is_active || !link.is_required) continue
    const role = participantRoleById.get(link.participant_role_id)
    if (!role) continue

    const participant = participantByRoleId.get(role.id)
    const hasName = Boolean(
      String(participant?.company_name ?? participant?.contact_name ?? '')
        .trim()
    )
    const hasVerification = participant?.has_verified_authorization === true
    const hasTruthConfirmation = participant?.accepts_responsibility === true
    const insuranceDocument = role.insurance_required === true ? latestParticipantInsuranceByRoleId.get(role.id) ?? null : null
    const isComplete =
      hasName &&
      hasVerification &&
      hasTruthConfirmation &&
      (role.insurance_required !== true || Boolean(insuranceDocument))
    const summary = [
      hasName ? 'Namn finns' : 'Namn saknas',
      participant?.has_verified_authorization ? 'Verifierad av sÃ¶kande' : 'Verifiering saknas',
      participant?.accepts_responsibility ? 'SanningsfÃ¶rsÃ¤kran finns' : 'SanningsfÃ¶rsÃ¤kran saknas',
      ...(role.insurance_required === true
        ? [insuranceDocument ? 'FÃ¶rsÃ¤kringsbevis finns' : 'FÃ¶rsÃ¤kringsbevis saknas']
        : []),
    ]

    addItem(
      `participant:${role.id}`,
      'participant',
      role.label,
      3000 + link.sort_order,
      isComplete,
      insuranceDocument?.id ?? null,
      summary,
      participant
        ? {
            companyName: participant.company_name ?? null,
            contactName: participant.contact_name ?? null,
            orgNumber: participant.org_number ?? null,
            email: participant.email ?? null,
            phone: participant.phone ?? null,
            certificationReference: participant.certification_reference ?? null,
            hasVerifiedAuthorization: participant.has_verified_authorization === true,
            acceptsResponsibility: participant.accepts_responsibility === true,
          }
        : null,
      role.review_guidance ?? null
    )
  }

  return Array.from(itemMap.values())
    .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv'))
    .map(({ sortOrder: _sortOrder, ...item }) => item)
}

export async function getRenoAppPublicConfig(slug: string): Promise<RenoAppPublicBrfConfig | null> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const brf = await getPublicBrfBySlug(admin, slug)

  if (!brf || !brf.is_public_apply_enabled) {
    return null
  }

  const [categories, actionTypes, documentTypes, requirements, questionConfig, participantRoles, participantRoleConfig, reviewFlags] =
    await Promise.all([
    listActiveActionCategories(admin),
    listActiveActionTypes(admin),
    listActiveDocumentTypes(admin),
    listRequirements(admin, brf.id),
    listActiveApplyQuestions(admin),
    listActiveParticipantRoles(admin),
    admin
      .from('renoapp_action_type_participant_roles')
      .select('id,action_type_id,participant_role_id,is_required,sort_order,is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    listActiveReviewFlags(admin),
    ])

  if (participantRoleConfig.error) {
    throw new Error(participantRoleConfig.error.message ?? 'Kunde inte lÃ¤sa medverkandekopplingar.')
  }

  const publicActionTypes = buildPublicActionTypes(
    categories,
    actionTypes,
    documentTypes,
    requirements,
    participantRoles,
    (participantRoleConfig.data ?? []) as ActionTypeParticipantRoleRow[],
    questionConfig.questions,
    questionConfig.options,
    questionConfig.links,
    questionConfig.triggers,
    reviewFlags
  )

  return {
    brf: {
      id: brf.id,
      name: brf.name,
      slug: brf.slug,
      applyIntroText: brf.apply_intro_text,
    },
    actionTypes: publicActionTypes,
    questionBank: buildPublicQuestionBank(
      questionConfig.questions,
      questionConfig.options,
      documentTypes,
      participantRoles,
      questionConfig.triggers,
      reviewFlags
    ),
  }
/*
  return {
    brf: {
      id: brf.id,
      name: brf.name,
      slug: brf.slug,
      applyIntroText: brf.apply_intro_text,
    },
    actionTypes: actionTypes.map((actionType) => ({
      id: actionType.id,
      key: actionType.key,
      label: actionType.label,
      sortOrder: actionType.sort_order,
      requirements: Array.from(requirementMap.values())
        .filter((requirement) => requirement.action_type_id === actionType.id)
        .map((requirement) => {
          const documentType = documentById.get(requirement.document_type_id)

          return {
            id: requirement.id,
            documentTypeId: requirement.document_type_id,
            documentKey: documentType?.key ?? 'unknown',
            documentLabel: documentType?.label ?? 'OkÃ¤nd dokumenttyp',
            documentDescription: documentType?.description ?? null,
            isRequired: requirement.is_required,
            note: requirement.note,
            sortOrder: requirement.sort_order,
          }
        })
        .sort((left, right) => left.sortOrder - right.sortOrder),
    })),
  }*/
}

export async function createPublicApplication(
  input: CreatePublicApplicationInput,
  requestOrigin: string
): Promise<CreatePublicApplicationResult> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const brf = await getPublicBrfBySlug(admin, input.brfSlug)

  if (!brf || !brf.is_public_apply_enabled) {
    throw new Error('BRF_NOT_FOUND')
  }

  const applicantName = normalizeText(input.applicantName)
  const applicantEmail = normalizeEmail(input.applicantEmail)
  const applicantPhone = normalizeText(input.applicantPhone)
  const unitNumberInternal = normalizeText(input.unitNumberInternal)
  const unitNumberSkatteverket = normalizeText(input.unitNumberSkatteverket)
  const description = normalizeText(input.description)
  const actionTypeKey = normalizeText(input.actionTypeKeys?.[0] ?? null)

  if (!applicantName) throw new Error('APPLICANT_NAME_REQUIRED')
  assertValidEmail(applicantEmail, 'APPLICANT_EMAIL_INVALID')
  if (!unitNumberInternal && !unitNumberSkatteverket) throw new Error('UNIT_NUMBER_REQUIRED')
  if (!description) throw new Error('DESCRIPTION_REQUIRED')
  if (!actionTypeKey) throw new Error('ACTION_TYPE_REQUIRED')
  /*
  /*
  /*
  /*
  const { error: deleteParticipantError } = await admin
    .from('renoapp_case_participants')
    .delete()
    .eq('case_id', caseId)

  if (deleteParticipantError) {
    throw new Error(deleteParticipantError.message ?? 'Kunde inte uppdatera entreprenÃ¶rer och konsulter.')
  }

  const participantRowsToInsert = participantEntriesInput
    .filter((item) =>
      Boolean(
        item.companyName ||
          item.orgNumber ||
          item.contactName ||
          item.email ||
          item.phone ||
          item.certificationReference ||
          item.hasVerifiedAuthorization ||
          item.acceptsResponsibility
      )
    )
    .map((item) => ({
      case_id: caseId,
      participant_role_id: item.participantRoleId,
      company_name: item.companyName || null,
      org_number: item.orgNumber || null,
      contact_name: item.contactName || null,
      email: item.email || null,
      phone: item.phone || null,
      certification_reference: item.certificationReference || null,
      has_verified_authorization: item.hasVerifiedAuthorization,
      accepts_responsibility: item.acceptsResponsibility,
    }))

  if (participantRowsToInsert.length > 0) {
    const { error: insertParticipantError } = await admin
      .from('renoapp_case_participants')
      .insert(participantRowsToInsert)

    if (insertParticipantError) {
      throw new Error(insertParticipantError.message ?? 'Kunde inte spara entreprenÃ¶rer och konsulter.')
    }
  }

  /*
  const { error: deleteParticipantError } = await admin
    .from('renoapp_case_participants')
    .delete()
    .eq('case_id', caseId)

  if (deleteParticipantError) {
    throw new Error(deleteParticipantError.message ?? 'Kunde inte uppdatera entreprenÃ¶rer och konsulter.')
  }

  const participantRowsToInsert = participantEntriesInput
    .filter((item) =>
      Boolean(
        item.companyName ||
          item.orgNumber ||
          item.contactName ||
          item.email ||
          item.phone ||
          item.certificationReference ||
          item.hasVerifiedAuthorization ||
          item.acceptsResponsibility
      )
    )
    .map((item) => ({
      case_id: caseId,
      participant_role_id: item.participantRoleId,
      company_name: item.companyName || null,
      org_number: item.orgNumber || null,
      contact_name: item.contactName || null,
      email: item.email || null,
      phone: item.phone || null,
      certification_reference: item.certificationReference || null,
      has_verified_authorization: item.hasVerifiedAuthorization,
      accepts_responsibility: item.acceptsResponsibility,
    }))

  if (participantRowsToInsert.length > 0) {
    const { error: insertParticipantError } = await admin
      .from('renoapp_case_participants')
      .insert(participantRowsToInsert)

    if (insertParticipantError) {
      throw new Error(insertParticipantError.message ?? 'Kunde inte spara entreprenÃ¶rer och konsulter.')
    }
  }

  /*
  const { error: deleteParticipantError } = await admin
    .from('renoapp_case_participants')
    .delete()
    .eq('case_id', caseId)

  if (deleteParticipantError) {
    throw new Error(deleteParticipantError.message ?? 'Kunde inte uppdatera entreprenÃ¶rer och konsulter.')
  }

  const participantRowsToInsert = participantEntriesInput
    .filter((item) =>
      Boolean(
        item.companyName ||
          item.orgNumber ||
          item.contactName ||
          item.email ||
          item.phone ||
          item.certificationReference ||
          item.hasVerifiedAuthorization ||
          item.acceptsResponsibility
      )
    )
    .map((item) => ({
      case_id: caseId,
      participant_role_id: item.participantRoleId,
      company_name: item.companyName || null,
      org_number: item.orgNumber || null,
      contact_name: item.contactName || null,
      email: item.email || null,
      phone: item.phone || null,
      certification_reference: item.certificationReference || null,
      has_verified_authorization: item.hasVerifiedAuthorization,
      accepts_responsibility: item.acceptsResponsibility,
    }))

  if (participantRowsToInsert.length > 0) {
    const { error: insertParticipantError } = await admin
      .from('renoapp_case_participants')
      .insert(participantRowsToInsert)

    if (insertParticipantError) {
      throw new Error(insertParticipantError.message ?? 'Kunde inte spara entreprenÃ¶rer och konsulter.')
    }
  }

  */
  const applicantEmailValue = applicantEmail as string

  const { data: actionType, error: actionTypeError } = await admin
    .from('renovation_action_types')
    .select('id,key,label,sort_order,is_active')
    .eq('key', actionTypeKey)
    .eq('is_active', true)
    .maybeSingle()

  if (actionTypeError) {
    throw new Error(actionTypeError.message ?? 'Kunde inte hÃ¤mta Ã¥tgÃ¤rdstyp.')
  }

  if (!actionType) {
    throw new Error('ACTION_TYPE_REQUIRED')
  }

  let contact: ContactRow | null = null
  if (applicantEmail) {
    const { data } = await admin
      .from('contacts')
      .select('id,name,email,phone')
      .eq('email', applicantEmailValue)
      .limit(1)
      .maybeSingle()
    contact = (data ?? null) as ContactRow | null
  }

  if (!contact && applicantPhone) {
    const { data } = await admin
      .from('contacts')
      .select('id,name,email,phone')
      .eq('phone', applicantPhone)
      .limit(1)
      .maybeSingle()
    contact = (data ?? null) as ContactRow | null
  }

  if (!contact) {
    const { data, error } = await admin
      .from('contacts')
      .insert({
        name: applicantName,
        email: applicantEmailValue,
        phone: applicantPhone,
      })
      .select('id,name,email,phone')
      .single()

    if (error) {
      throw new Error(error.message ?? 'Kunde inte skapa kontakt.')
    }

    contact = data as ContactRow
  }

  let unit: UnitRow | null = null
  if (unitNumberInternal) {
    const { data } = await admin
      .from('brf_units')
      .select('id,brf_id,unit_number_internal,unit_number_skatteverket,status,updated_at')
      .eq('brf_id', brf.id)
      .eq('unit_number_internal', unitNumberInternal)
      .limit(1)
      .maybeSingle()
    unit = (data ?? null) as UnitRow | null
  }

  if (!unit && unitNumberSkatteverket) {
    const { data } = await admin
      .from('brf_units')
      .select('id,brf_id,unit_number_internal,unit_number_skatteverket,status,updated_at')
      .eq('brf_id', brf.id)
      .eq('unit_number_skatteverket', unitNumberSkatteverket)
      .limit(1)
      .maybeSingle()
    unit = (data ?? null) as UnitRow | null
  }

  if (!unit) {
    const { data, error } = await admin
      .from('brf_units')
      .insert({
        brf_id: brf.id,
        unit_number_internal: unitNumberInternal,
        unit_number_skatteverket: unitNumberSkatteverket,
        status: 'preliminary',
      })
      .select('id,brf_id,unit_number_internal,unit_number_skatteverket,status,updated_at')
      .single()

    if (error) {
      throw new Error(error.message ?? 'Kunde inte skapa lÃ¤genhet.')
    }

    unit = data as UnitRow
  }

  const { data: existingUnitContact } = await admin
    .from('unit_contacts')
    .select('id')
    .eq('unit_id', unit.id)
    .eq('contact_id', contact.id)
    .eq('is_current', true)
    .limit(1)
    .maybeSingle()

  if (!existingUnitContact) {
    const { error } = await admin.from('unit_contacts').insert({
      unit_id: unit.id,
      contact_id: contact.id,
      relationship_type: 'unknown',
      verification_status: 'unverified',
      is_current: true,
    })

    if (error) {
      throw new Error(error.message ?? 'Kunde inte koppla kontakt till lÃ¤genhet.')
    }
  }

  const caseNumber = await createUniqueCaseNumber(admin)
  const riskLevel = computeRiskLevel(input.checks)
  const title = `Renovering: ${(actionType as ActionTypeRow).label}`

  const { data: insertedCase, error: caseError } = await admin
    .from('renovation_cases')
    .insert({
      brf_id: brf.id,
      unit_id: unit.id,
      applicant_contact_id: contact.id,
      action_type_id: (actionType as ActionTypeRow).id,
      case_number: caseNumber,
      title,
      description,
      status: 'submitted',
      risk_level: riskLevel,
      submitted_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (caseError || !insertedCase) {
    throw new Error(caseError?.message ?? 'Kunde inte skapa Ã¤rende.')
  }

  const { error: checksError } = await admin.from('renovation_case_checks').insert({
    case_id: insertedCase.id,
    affects_structure: !!input.checks?.affectsStructure,
    affects_plumbing: !!input.checks?.affectsPlumbing,
    affects_ventilation: !!input.checks?.affectsVentilation,
    affects_electrical: !!input.checks?.affectsElectrical,
    affects_wet_room: !!input.checks?.affectsWetRoom,
    affects_surface_only: !!input.checks?.affectsSurfaceOnly,
  })

  if (checksError) {
    throw new Error(checksError.message ?? 'Kunde inte spara teknisk pÃ¥verkan.')
  }

  const plainToken = makeToken()
  const tokenHash = hashToken(plainToken)
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()

  const { error: accessError } = await admin.from('case_access_links').insert({
    case_id: insertedCase.id,
    token_hash: tokenHash,
    plain_token: plainToken,
    email: applicantEmailValue,
    scope: 'answer_questions',
    expires_at: expiresAt,
  })

  if (accessError) {
    throw new Error(accessError.message ?? 'Kunde inte skapa Ã¥tkomstlÃ¤nk.')
  }

  const accessUrl = buildAbsoluteUrl(requestOrigin, `/renoapp/case/${plainToken}`)
  const resumeUrl = buildAbsoluteUrl(requestOrigin, `/renoapp/brf/${brf.slug}/apply?draft=${plainToken}`)
  let emailSent = false
  let emailError: string | null = null

  const mailFrom = getMailFromAddress()
  if (mailFrom && applicantEmailValue) {
    try {
      await sendAssignmentEmail({
        to: applicantEmailValue,
        from: mailFrom,
        replyTo: brf.email ?? null,
        subject: `RenoApp: ditt Ã¤rende ${caseNumber}`,
        html: [
          `<p>Hej ${applicantName},</p>`,
          `<p>Vi har tagit emot din renoveringsansÃ¶kan fÃ¶r <strong>${brf.name}</strong>.</p>`,
          `<p>Ã„rendenummer: <strong>${caseNumber}</strong></p>`,
          `<p>Ã–ppna och komplettera ditt Ã¤rende via lÃ¤nken nedan:</p>`,
          `<p><a href="${resumeUrl}">${resumeUrl}</a></p>`,
          `<p>LÃ¤nken gÃ¤ller till ${new Date(expiresAt).toLocaleString('sv-SE')}.</p>`,
        ].join(''),
        text: [
          `Hej ${applicantName},`,
          ``,
          `Vi har tagit emot din renoveringsansÃ¶kan fÃ¶r ${brf.name}.`,
          `Ã„rendenummer: ${caseNumber}`,
          `Ã–ppna och komplettera ditt Ã¤rende hÃ¤r: ${resumeUrl}`,
          `LÃ¤nken gÃ¤ller till ${new Date(expiresAt).toLocaleString('sv-SE')}.`,
        ].join('\n'),
      })
      emailSent = true
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Mejlutskick misslyckades.'
    }
  } else if (!applicantEmailValue) {
    emailError = 'Ingen e-postadress Ã¤r angiven. AnsÃ¶kan sparades men inget mejl kunde skickas.'
  } else {
    emailError = 'ASSIGNMENTS_MAIL_FROM saknas. Ã…tkomstlÃ¤nken skapades men inget mejl skickades.'
  }

  return {
    caseId: insertedCase.id as string,
    caseNumber,
    accessUrl,
    resumeUrl,
    status: 'submitted',
    emailSent,
    emailError,
  }
}

async function loadActiveActionTypesByKeys(admin: SupabaseAdminClient, keys: string[]) {
  const normalizedKeys = Array.from(new Set(keys.map((key) => normalizeText(key)).filter((value): value is string => Boolean(value))))
  if (normalizedKeys.length === 0) return [] as ActionTypeRow[]

  const { data, error } = await admin
    .from('renovation_action_types')
    .select(
      'id,category_id,key,label,description,risk_level,contractor_requirement,implies_structure,implies_plumbing,implies_ventilation,implies_electrical,implies_wet_room,implies_surface_only,sort_order,is_active'
    )
    .in('key', normalizedKeys)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte lÃ¤sa Ã¥tgÃ¤rdstyper.')
  }

  return (data ?? []) as ActionTypeRow[]
}

async function loadActiveActionTypesByIds(admin: SupabaseAdminClient, ids: string[]) {
  const normalizedIds = Array.from(new Set(ids.map((value) => normalizeText(value)).filter((value): value is string => Boolean(value))))
  if (normalizedIds.length === 0) return [] as ActionTypeRow[]

  const { data, error } = await admin
    .from('renovation_action_types')
    .select(
      'id,category_id,key,label,description,risk_level,contractor_requirement,implies_structure,implies_plumbing,implies_ventilation,implies_electrical,implies_wet_room,implies_surface_only,sort_order,is_active'
    )
    .in('id', normalizedIds)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte lÃ¤sa Ã¥tgÃ¤rdstyper.')
  }

  return (data ?? []) as ActionTypeRow[]
}

function buildPublicCaseTitle(actionTypes: ActionTypeRow[]) {
  if (actionTypes.length === 0) return 'RenoveringsansÃ¶kan'
  if (actionTypes.length === 1) return `Renovering: ${actionTypes[0].label}`
  return `Renovering: ${actionTypes.map((item) => item.label).join(', ')}`
}

async function ensureUnitForPublicApplication(input: {
  admin: SupabaseAdminClient
  brfId: string
  unitNumberInternal: string | null
  unitNumberSkatteverket: string | null
}) {
  const { admin, brfId, unitNumberInternal, unitNumberSkatteverket } = input

  if (!unitNumberInternal && !unitNumberSkatteverket) {
    return null
  }

  let unit: UnitRow | null = null

  if (unitNumberInternal) {
    const { data } = await admin
      .from('brf_units')
      .select('id,brf_id,unit_number_internal,unit_number_skatteverket,status,updated_at')
      .eq('brf_id', brfId)
      .eq('unit_number_internal', unitNumberInternal)
      .limit(1)
      .maybeSingle()
    unit = (data ?? null) as UnitRow | null
  }

  if (!unit && unitNumberSkatteverket) {
    const { data } = await admin
      .from('brf_units')
      .select('id,brf_id,unit_number_internal,unit_number_skatteverket,status,updated_at')
      .eq('brf_id', brfId)
      .eq('unit_number_skatteverket', unitNumberSkatteverket)
      .limit(1)
      .maybeSingle()
    unit = (data ?? null) as UnitRow | null
  }

  if (!unit) {
    const { data, error } = await admin
      .from('brf_units')
      .insert({
        brf_id: brfId,
        unit_number_internal: unitNumberInternal,
        unit_number_skatteverket: unitNumberSkatteverket,
        status: 'preliminary',
      })
      .select('id,brf_id,unit_number_internal,unit_number_skatteverket,status,updated_at')
      .single()

    if (error) {
      throw new Error(error.message ?? 'Kunde inte skapa lÃ¤genhet.')
    }

    unit = data as UnitRow
  }

  return unit
}

async function ensureCurrentUnitContact(input: {
  admin: SupabaseAdminClient
  unitId: string | null
  contactId: string | null
}) {
  const { admin, unitId, contactId } = input
  if (!unitId || !contactId) return

  const { data: existingUnitContact } = await admin
    .from('unit_contacts')
    .select('id')
    .eq('unit_id', unitId)
    .eq('contact_id', contactId)
    .eq('is_current', true)
    .limit(1)
    .maybeSingle()

  if (!existingUnitContact) {
    const { error } = await admin.from('unit_contacts').insert({
      unit_id: unitId,
      contact_id: contactId,
      relationship_type: 'unknown',
      verification_status: 'unverified',
      is_current: true,
    })

    if (error) {
      throw new Error(error.message ?? 'Kunde inte koppla kontakt till lÃ¤genhet.')
    }
  }
}

async function upsertPublicApplicationContact(input: {
  admin: SupabaseAdminClient
  existingContactId?: string | null
  applicantName: string | null
  applicantEmail: string | null
  applicantPhone: string | null
  requireContact: boolean
}) {
  const { admin, existingContactId, applicantName, applicantEmail, applicantPhone, requireContact } = input

  if (!applicantName && !applicantEmail && !applicantPhone) {
    if (requireContact) {
      throw new Error('APPLICANT_NAME_REQUIRED')
    }
    return null
  }

  if (applicantEmail) {
    assertValidEmail(applicantEmail, 'APPLICANT_EMAIL_INVALID')
  }

  if (!applicantName || (!applicantEmail && !applicantPhone)) {
    if (requireContact) {
      if (!applicantName) throw new Error('APPLICANT_NAME_REQUIRED')
      throw new Error('APPLICANT_EMAIL_INVALID')
    }
    return null
  }

  if (existingContactId) {
    const { data, error } = await admin
      .from('contacts')
      .update({
        name: applicantName,
        email: applicantEmail,
        phone: applicantPhone,
      })
      .eq('id', existingContactId)
      .select('id,name,email,phone')
      .single()

    if (error || !data) {
      throw new Error(error?.message ?? 'Kunde inte uppdatera kontakt.')
    }

    return data as ContactRow
  }

  let contact: ContactRow | null = null
  const applicantEmailValue = applicantEmail as string

  const { data: byEmail } = await admin
    .from('contacts')
    .select('id,name,email,phone')
    .eq('email', applicantEmailValue)
    .limit(1)
    .maybeSingle()
  contact = (byEmail ?? null) as ContactRow | null

  if (!contact && applicantPhone) {
    const { data: byPhone } = await admin
      .from('contacts')
      .select('id,name,email,phone')
      .eq('phone', applicantPhone)
      .limit(1)
      .maybeSingle()
    contact = (byPhone ?? null) as ContactRow | null
  }

  if (contact) {
    const { data, error } = await admin
      .from('contacts')
      .update({
        name: applicantName,
        email: applicantEmail,
        phone: applicantPhone,
      })
      .eq('id', contact.id)
      .select('id,name,email,phone')
      .single()

    if (error || !data) {
      throw new Error(error?.message ?? 'Kunde inte uppdatera kontakt.')
    }

    return data as ContactRow
  }

  const { data, error } = await admin
    .from('contacts')
    .insert({
      name: applicantName,
      email: applicantEmail,
      phone: applicantPhone,
    })
    .select('id,name,email,phone')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Kunde inte skapa kontakt.')
  }

  return data as ContactRow
}

async function replaceCaseActionTypes(admin: SupabaseAdminClient, caseId: string, actionTypeIds: string[]) {
  const { error: deleteError } = await admin.from('renovation_case_action_types').delete().eq('case_id', caseId)
  if (deleteError) {
    throw new Error(deleteError.message ?? 'Kunde inte uppdatera Ã¤rendets Ã¥tgÃ¤rdstyper.')
  }

  if (actionTypeIds.length === 0) return

  const { error: insertError } = await admin.from('renovation_case_action_types').insert(
    actionTypeIds.map((actionTypeId) => ({
      case_id: caseId,
      action_type_id: actionTypeId,
    }))
  )

  if (insertError) {
    throw new Error(insertError.message ?? 'Kunde inte spara Ã¤rendets Ã¥tgÃ¤rdstyper.')
  }
}

async function createCaseAccessToken(admin: SupabaseAdminClient, caseId: string, email: string | null) {
  const plainToken = makeToken()
  const tokenHash = hashToken(plainToken)
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()

  const { error } = await admin.from('case_access_links').insert({
    case_id: caseId,
    token_hash: tokenHash,
    plain_token: plainToken,
    email,
    scope: 'answer_questions',
    expires_at: expiresAt,
  })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte skapa Ã¥tkomstlÃ¤nk.')
  }

  return { token: plainToken, expiresAt }
}

async function findReusableCaseAccessToken(admin: SupabaseAdminClient, caseId: string) {
  const { data, error } = await admin
    .from('case_access_links')
    .select('id,email,plain_token,revoked_at,expires_at')
    .eq('case_id', caseId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte lÃ¤sa Ã¥tkomstlÃ¤nk.')
  }

  if (!data) return null

  return {
    id: String(data.id ?? ''),
    email: (data.email as string | null | undefined) ?? null,
    token: (data.plain_token as string | null | undefined) ?? null,
  }
}

async function ensureReusableCaseAccessToken(input: {
  admin: SupabaseAdminClient
  caseId: string
  email?: string | null
}) {
  const { admin, caseId, email = null } = input
  const existing = await findReusableCaseAccessToken(admin, caseId)

  if (existing?.token) {
    if (email && existing.email !== email) {
      await admin.from('case_access_links').update({ email }).eq('id', existing.id)
    }
    return existing.token
  }

  const created = await createCaseAccessToken(admin, caseId, email ?? existing?.email ?? null)
  return created.token
}

export async function getRenoAppPublicGuideConfig(slug: string): Promise<RenoAppPublicBrfConfig | null> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const brf = await getPublicBrfBySlug(admin, slug)

  if (!brf || !brf.is_public_apply_enabled) {
    return null
  }

  const [categories, actionTypes, documentTypes, requirements, questionConfig, participantRoles, participantRoleConfig, reviewFlags] =
    await Promise.all([
    listActiveActionCategories(admin),
    listActiveActionTypes(admin),
    listActiveDocumentTypes(admin),
    listRequirements(admin, brf.id),
    listActiveApplyQuestions(admin),
    listActiveParticipantRoles(admin),
    admin
      .from('renoapp_action_type_participant_roles')
      .select('id,action_type_id,participant_role_id,is_required,sort_order,is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    listActiveReviewFlags(admin),
    ])

  if (participantRoleConfig.error) {
    throw new Error(participantRoleConfig.error.message ?? 'Kunde inte lÃ¤sa medverkandekopplingar.')
  }

  return {
    brf: {
      id: brf.id,
      name: brf.name,
      slug: brf.slug,
      applyIntroText: brf.apply_intro_text,
    },
    actionTypes: buildPublicActionTypes(
      categories,
      actionTypes,
      documentTypes,
      requirements,
      participantRoles,
      (participantRoleConfig.data ?? []) as ActionTypeParticipantRoleRow[],
      questionConfig.questions,
      questionConfig.options,
      questionConfig.links,
      questionConfig.triggers,
      reviewFlags
    ),
    questionBank: buildPublicQuestionBank(
      questionConfig.questions,
      questionConfig.options,
      documentTypes,
      participantRoles,
      questionConfig.triggers,
      reviewFlags
    ),
  }
}

export async function getPublicApplicationDraftByToken(token: string): Promise<RenoAppPublicApplicationDraft | null> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const tokenHash = hashToken(token)

  const { data: accessData, error: accessError } = await admin
    .from('case_access_links')
    .select('id,case_id,email,plain_token,expires_at,revoked_at,last_used_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (accessError) {
    throw new Error(accessError.message ?? 'Kunde inte lÃ¤sa utkastslÃ¤nk.')
  }
  if (!accessData) {
    return null
  }

  if (!accessData.plain_token) {
    await admin.from('case_access_links').update({ plain_token: token }).eq('id', String(accessData.id ?? ''))
  }

  const access = accessData as Record<string, unknown>
  const isRevoked = Boolean(access.revoked_at)
  const isExpired = new Date(String(access.expires_at ?? '')).getTime() < Date.now()
  const state: RenoAppPublicApplicationDraft['state'] = isRevoked ? 'revoked' : isExpired ? 'expired' : 'open'

  const { data: caseData, error: caseError } = await admin
    .from('renovation_cases')
    .select(
      'id,brf_id,unit_id,applicant_contact_id,case_number,description,contractor_name,contractor_org_number,contractor_email,contractor_phone,contractor_has_required_certification,status,submitted_at,updated_at'
    )
    .eq('id', String(access.case_id ?? ''))
    .maybeSingle()

  if (caseError) {
    throw new Error(caseError.message ?? 'Kunde inte lÃ¤sa utkast.')
  }
  if (!caseData) {
    return null
  }

  const caseRow = caseData as Record<string, unknown>
  const brfId = String(caseRow.brf_id ?? '')
  const [brfResult, contactResult, unitResult, actionTypeRows, actionTypes, documentsResult, answerRows, participantRows, questionRows, optionRows, messages] = await Promise.all([
    admin.from('brf_associations').select('id,name,slug').eq('id', brfId).maybeSingle(),
    caseRow.applicant_contact_id
      ? admin.from('contacts').select('id,name,email,phone').eq('id', String(caseRow.applicant_contact_id)).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    caseRow.unit_id
      ? admin
          .from('brf_units')
          .select('id,unit_number_internal,unit_number_skatteverket,status')
          .eq('id', String(caseRow.unit_id))
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    listCaseActionTypes(admin, [String(caseRow.id ?? '')]),
    listActiveActionTypes(admin),
    admin
      .from('renovation_case_documents')
      .select('id,document_type_id,participant_role_id,document_scope,file_name,status,uploaded_at,note')
      .eq('case_id', String(caseRow.id ?? ''))
      .order('uploaded_at', { ascending: false }),
    listCaseQuestionAnswers(admin, [String(caseRow.id ?? '')]),
    listCaseParticipants(admin, [String(caseRow.id ?? '')]),
    admin.from('renoapp_apply_questions').select('id,key').order('sort_order', { ascending: true }),
    admin.from('renoapp_apply_question_options').select('id,question_id,key').order('sort_order', { ascending: true }),
    listCaseMessages(admin, String(caseRow.id ?? '')),
  ])

  if (brfResult.error) throw new Error(brfResult.error.message ?? 'Kunde inte lÃ¤sa BRF.')
  if (contactResult.error) throw new Error(contactResult.error.message ?? 'Kunde inte lÃ¤sa kontakt.')
  if (unitResult.error) throw new Error(unitResult.error.message ?? 'Kunde inte lÃ¤sa lÃ¤genhet.')

  if (documentsResult.error) throw new Error(documentsResult.error.message ?? 'Kunde inte lasa dokument.')
  if (questionRows.error) throw new Error(questionRows.error.message ?? 'Kunde inte lasa frÃ¥gor.')
  if (optionRows.error) throw new Error(optionRows.error.message ?? 'Kunde inte lasa svarsalternativ.')

  const actionTypeIdSet = new Set(
    actionTypeRows
      .filter((row) => row.case_id === String(caseRow.id ?? ''))
      .map((row) => row.action_type_id)
  )
  const questionKeyById = new Map(
    ((questionRows.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      String(row.key ?? ''),
    ])
  )
  const optionById = new Map(
    ((optionRows.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        questionId: String(row.question_id ?? ''),
        key: String(row.key ?? ''),
      },
    ])
  )
  const questionAnswers = (answerRows ?? []).reduce(
    (acc, row) => {
      const questionKey = questionKeyById.get(row.question_id)
      const option = optionById.get(row.option_id)
      if (!questionKey || !option?.key) return acc
      acc[questionKey] = [...(acc[questionKey] ?? []), option.key]
      return acc
    },
    {} as Record<string, string[]>
  )

  return {
    state,
    access: {
      email: String(access.email ?? ''),
      expiresAt: String(access.expires_at ?? ''),
      lastUsedAt: (access.last_used_at as string | null | undefined) ?? null,
    },
    brf: {
      id: String(brfResult.data?.id ?? brfId),
      name: String(brfResult.data?.name ?? ''),
      slug: String(brfResult.data?.slug ?? ''),
    },
    form: {
      applicantName: (contactResult.data?.name as string | null | undefined) ?? '',
      applicantEmail: (contactResult.data?.email as string | null | undefined) ?? String(access.email ?? ''),
      applicantPhone: (contactResult.data?.phone as string | null | undefined) ?? '',
      unitNumberInternal: (unitResult.data?.unit_number_internal as string | null | undefined) ?? '',
      unitNumberSkatteverket: (unitResult.data?.unit_number_skatteverket as string | null | undefined) ?? '',
      description: (caseRow.description as string | null | undefined) ?? '',
      contractorName: (caseRow.contractor_name as string | null | undefined) ?? '',
      contractorOrgNumber: (caseRow.contractor_org_number as string | null | undefined) ?? '',
      contractorEmail: (caseRow.contractor_email as string | null | undefined) ?? '',
      contractorPhone: (caseRow.contractor_phone as string | null | undefined) ?? '',
      contractorHasRequiredCertification: Boolean(caseRow.contractor_has_required_certification),
      participantEntries: (participantRows ?? []).map((row) => ({
        participantRoleId: row.participant_role_id,
        companyName: row.company_name ?? '',
        orgNumber: row.org_number ?? '',
        contactName: row.contact_name ?? '',
        email: row.email ?? '',
        phone: row.phone ?? '',
        certificationReference: row.certification_reference ?? '',
        hasVerifiedAuthorization: row.has_verified_authorization === true,
        acceptsResponsibility: row.accepts_responsibility === true,
      })),
      actionTypeKeys: actionTypes.filter((item) => actionTypeIdSet.has(item.id)).map((item) => item.key),
      questionAnswers,
    },
    case: {
      id: String(caseRow.id ?? ''),
      caseNumber: String(caseRow.case_number ?? ''),
      status: String(caseRow.status ?? ''),
      submittedAt: String(caseRow.submitted_at ?? ''),
      updatedAt: String(caseRow.updated_at ?? ''),
    },
    documents: ((documentsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      documentTypeId: (row.document_type_id as string | null | undefined) ?? null,
      participantRoleId: (row.participant_role_id as string | null | undefined) ?? null,
      documentScope:
        ((row.document_scope as 'general' | 'participant_insurance' | null | undefined) ?? 'general'),
      fileName: (row.file_name as string | null | undefined) ?? null,
      status: String(row.status ?? ''),
      uploadedAt: String(row.uploaded_at ?? ''),
      note: (row.note as string | null | undefined) ?? null,
    })),
    messages,
  }
}

export async function upsertPublicApplication(
  input: CreatePublicApplicationInput,
  requestOrigin: string
): Promise<CreatePublicApplicationResult> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const brf = await getPublicBrfBySlug(admin, input.brfSlug)

  if (!brf || !brf.is_public_apply_enabled) {
    throw new Error('BRF_NOT_FOUND')
  }

  const mode = input.mode === 'draft' ? 'draft' : 'submit'
  const applicantName = normalizeText(input.applicantName)
  const applicantEmail = normalizeEmail(input.applicantEmail)
  const applicantPhone = normalizeText(input.applicantPhone)
  const unitNumberInternal = normalizeText(input.unitNumberInternal)
  const unitNumberSkatteverket = normalizeText(input.unitNumberSkatteverket)
  const description = normalizeText(input.description)
  const replyMessage = normalizeText(input.replyMessage)
  const contractorName = normalizeText(input.contractorName)
  const contractorOrgNumber = normalizeText(input.contractorOrgNumber)
  const contractorEmail = normalizeEmail(input.contractorEmail)
  const contractorPhone = normalizeText(input.contractorPhone)
  const contractorHasRequiredCertification = input.contractorHasRequiredCertification === true
  const actionTypeKeys = Array.from(
    new Set((input.actionTypeKeys ?? []).map((value) => normalizeText(value)).filter((value): value is string => Boolean(value)))
  )
  const questionAnswersInput = Object.fromEntries(
    Object.entries(input.questionAnswers ?? {}).map(([questionKey, optionKeys]) => [
      normalizeMachineKey(questionKey) ?? '',
      Array.isArray(optionKeys)
        ? Array.from(
            new Set(
              optionKeys
                .map((value) => normalizeMachineKey(value))
                .filter((value): value is string => Boolean(value))
            )
          )
        : [],
    ])
  ) as Record<string, string[]>
  const participantEntriesInput = Array.from(
    new Map(
      (input.participantEntries ?? [])
        .map((item) => {
          const participantRoleId = normalizeText(item.participantRoleId)
          if (!participantRoleId) return null

          return [
            participantRoleId,
            {
              participantRoleId,
              companyName: normalizeText(item.companyName) ?? '',
              orgNumber: normalizeText(item.orgNumber) ?? '',
              contactName: normalizeText(item.contactName) ?? '',
              email: normalizeEmail(item.email) ?? '',
              phone: normalizeText(item.phone) ?? '',
              certificationReference: normalizeText(item.certificationReference) ?? '',
              hasVerifiedAuthorization: item.hasVerifiedAuthorization === true,
              acceptsResponsibility: item.acceptsResponsibility === true,
            },
          ] as const
        })
        .filter(
          (
            item
          ): item is readonly [
            string,
            {
              participantRoleId: string
              companyName: string
              orgNumber: string
              contactName: string
              email: string
              phone: string
              certificationReference: string
              hasVerifiedAuthorization: boolean
              acceptsResponsibility: boolean
            },
          ] => Boolean(item)
        )
    ).values()
  )

  if (applicantEmail) {
    assertValidEmail(applicantEmail, 'APPLICANT_EMAIL_INVALID')
  }

  const selectedActionTypes = await loadActiveActionTypesByKeys(admin, actionTypeKeys)
  const publicQuestionConfig =
    selectedActionTypes.length > 0
      ? await listActiveApplyQuestions(admin)
      : { questions: [], options: [], links: [], triggers: [] }
  const contractorRequirementSummary = buildContractorRequirementSummary(selectedActionTypes)
  const contractorCertification = requiresQualifiedContractor(selectedActionTypes)
    ? contractorHasRequiredCertification
    : false

  const applicableQuestions = resolveApplicableQuestionsForSelection({
    selectedActionTypes,
    questionRows: publicQuestionConfig.questions,
    optionRows: publicQuestionConfig.options,
    questionLinks: publicQuestionConfig.links,
    triggerRows: publicQuestionConfig.triggers,
    questionAnswers: questionAnswersInput,
  })

  let draftCaseId: string | null = null
  let accessTokenForResult: string | null = null
  let isNewDraft = false

  if (input.draftToken) {
    const tokenHash = hashToken(input.draftToken)
    const { data: existingLink, error: existingLinkError } = await admin
      .from('case_access_links')
      .select('case_id,revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (existingLinkError) {
      throw new Error(existingLinkError.message ?? 'Kunde inte lÃ¤sa utkastslÃ¤nk.')
    }

    if (existingLink?.revoked_at) {
      throw new Error('DRAFT_LINK_INVALID')
    }

    draftCaseId = existingLink ? String(existingLink.case_id ?? '') : null
    accessTokenForResult = input.draftToken
  }

  let existingCase: Record<string, unknown> | null = null
  if (draftCaseId) {
    const { data: caseData, error: caseError } = await admin
      .from('renovation_cases')
      .select('id,applicant_contact_id,unit_id,case_number,status,submitted_at')
      .eq('id', draftCaseId)
      .maybeSingle()

    if (caseError) {
      throw new Error(caseError.message ?? 'Kunde inte lÃ¤sa utkastÃ¤rende.')
    }

    existingCase = (caseData ?? null) as Record<string, unknown> | null
    if (!existingCase) {
      throw new Error('DRAFT_LINK_INVALID')
    }
  }

  const lockedStatuses = new Set(['approved', 'rejected'])
  if (existingCase && lockedStatuses.has(String(existingCase.status ?? ''))) {
    throw new Error('CASE_LOCKED')
  }

  const contact = await upsertPublicApplicationContact({
    admin,
    existingContactId: (existingCase?.applicant_contact_id as string | null | undefined) ?? null,
    applicantName,
    applicantEmail,
    applicantPhone,
    requireContact: false,
  })

  const unit = await ensureUnitForPublicApplication({
    admin,
    brfId: brf.id,
    unitNumberInternal,
    unitNumberSkatteverket,
  })

  await ensureCurrentUnitContact({
    admin,
    unitId: unit?.id ?? null,
    contactId: contact?.id ?? null,
  })

  const derivedChecks = deriveChecksFromActionTypes(selectedActionTypes)
  const riskLevel = computeRiskLevelFromActionTypes(selectedActionTypes)
  const title = buildPublicCaseTitle(selectedActionTypes)
  const existingStatus = String(existingCase?.status ?? '')
  const nextStatus =
    mode === 'draft'
      ? existingStatus && existingStatus !== 'draft'
        ? existingStatus
        : 'draft'
      : 'review'

  let caseId = existingCase ? String(existingCase.id ?? '') : ''
  let caseNumber = existingCase ? String(existingCase.case_number ?? '') : ''

  if (!existingCase) {
    caseNumber = await createUniqueCaseNumber(admin)
    const submittedAt = mode === 'submit' ? new Date().toISOString() : new Date().toISOString()

    const { data: insertedCase, error: insertCaseError } = await admin
      .from('renovation_cases')
      .insert({
        brf_id: brf.id,
        unit_id: unit?.id ?? null,
        applicant_contact_id: contact?.id ?? null,
        action_type_id: selectedActionTypes[0]?.id ?? null,
        case_number: caseNumber,
        title,
        description,
        contractor_name: contractorName,
        contractor_org_number: contractorOrgNumber,
        contractor_email: contractorEmail,
        contractor_phone: contractorPhone,
        contractor_has_required_certification: contractorCertification,
        status: nextStatus,
        risk_level: riskLevel,
        submitted_at: submittedAt,
      })
      .select('id')
      .single()

    if (insertCaseError || !insertedCase) {
      throw new Error(insertCaseError?.message ?? 'Kunde inte skapa Ã¤rende.')
    }

    caseId = String(insertedCase.id ?? '')
    isNewDraft = true

    const { error: checksError } = await admin.from('renovation_case_checks').insert({
      case_id: caseId,
      affects_structure: derivedChecks.affectsStructure,
      affects_plumbing: derivedChecks.affectsPlumbing,
      affects_ventilation: derivedChecks.affectsVentilation,
      affects_electrical: derivedChecks.affectsElectrical,
      affects_wet_room: derivedChecks.affectsWetRoom,
      affects_surface_only: derivedChecks.affectsSurfaceOnly,
    })

    if (checksError) {
      throw new Error(checksError.message ?? 'Kunde inte spara teknisk pÃ¥verkan.')
    }
  } else {
    const { error: updateCaseError } = await admin
      .from('renovation_cases')
      .update({
        unit_id: unit?.id ?? null,
        applicant_contact_id: contact?.id ?? null,
        action_type_id: selectedActionTypes[0]?.id ?? null,
        title,
        description,
        contractor_name: contractorName,
        contractor_org_number: contractorOrgNumber,
        contractor_email: contractorEmail,
        contractor_phone: contractorPhone,
        contractor_has_required_certification: contractorCertification,
        status: nextStatus,
        risk_level: riskLevel,
        submitted_at: mode === 'submit' ? new Date().toISOString() : String(existingCase.submitted_at ?? new Date().toISOString()),
      })
      .eq('id', caseId)

    if (updateCaseError) {
      throw new Error(updateCaseError.message ?? 'Kunde inte uppdatera Ã¤rendet.')
    }

    const { error: checksError } = await admin
      .from('renovation_case_checks')
      .update({
        affects_structure: derivedChecks.affectsStructure,
        affects_plumbing: derivedChecks.affectsPlumbing,
        affects_ventilation: derivedChecks.affectsVentilation,
        affects_electrical: derivedChecks.affectsElectrical,
        affects_wet_room: derivedChecks.affectsWetRoom,
        affects_surface_only: derivedChecks.affectsSurfaceOnly,
      })
      .eq('case_id', caseId)

    if (checksError) {
      throw new Error(checksError.message ?? 'Kunde inte uppdatera teknisk pÃ¥verkan.')
    }
  }

  await replaceCaseActionTypes(
    admin,
    caseId,
    selectedActionTypes.map((item) => item.id)
  )

  const optionIdByQuestionAndKey = new Map<string, string>()
  for (const question of applicableQuestions) {
    for (const option of question.options) {
      optionIdByQuestionAndKey.set(`${question.id}:${option.key}`, option.id)
    }
  }

  const { error: deleteAnswerError } = await admin
    .from('renoapp_case_question_answers')
    .delete()
    .eq('case_id', caseId)

  if (deleteAnswerError) {
    throw new Error(deleteAnswerError.message ?? 'Kunde inte uppdatera frÃ¥gesvar.')
  }

  const answerRowsToInsert = applicableQuestions.flatMap((question) => {
    const selectedOptionKeys = questionAnswersInput[question.key] ?? []
    const normalizedSelectedKeys =
      question.responseType === 'multi_select' ? selectedOptionKeys : selectedOptionKeys.slice(0, 1)

    return normalizedSelectedKeys
      .map((optionKey) => optionIdByQuestionAndKey.get(`${question.id}:${optionKey}`))
      .filter((optionId): optionId is string => Boolean(optionId))
      .map((optionId) => ({
        case_id: caseId,
        question_id: question.id,
        option_id: optionId,
      }))
  })

  if (answerRowsToInsert.length > 0) {
    const { error: insertAnswerError } = await admin
      .from('renoapp_case_question_answers')
      .insert(answerRowsToInsert)

    if (insertAnswerError) {
      throw new Error(insertAnswerError.message ?? 'Kunde inte spara frÃ¥gesvar.')
    }
  }

  const applicantEmailValue = applicantEmail ?? null
  const { error: deleteParticipantError } = await admin
    .from('renoapp_case_participants')
    .delete()
    .eq('case_id', caseId)

  if (deleteParticipantError) {
    throw new Error(deleteParticipantError.message ?? 'Kunde inte uppdatera entreprenÃ¶rer och konsulter.')
  }

  const participantRowsToInsert = participantEntriesInput
    .filter((item) =>
      Boolean(
        item.companyName ||
          item.orgNumber ||
          item.contactName ||
          item.email ||
          item.phone ||
          item.certificationReference ||
          item.hasVerifiedAuthorization ||
          item.acceptsResponsibility
      )
    )
    .map((item) => ({
      case_id: caseId,
      participant_role_id: item.participantRoleId,
      company_name: item.companyName || null,
      org_number: item.orgNumber || null,
      contact_name: item.contactName || null,
      email: item.email || null,
      phone: item.phone || null,
      certification_reference: item.certificationReference || null,
      has_verified_authorization: item.hasVerifiedAuthorization,
      accepts_responsibility: item.acceptsResponsibility,
    }))

  if (participantRowsToInsert.length > 0) {
    const { error: insertParticipantError } = await admin
      .from('renoapp_case_participants')
      .insert(participantRowsToInsert)

    if (insertParticipantError) {
      throw new Error(insertParticipantError.message ?? 'Kunde inte spara entreprenÃ¶rer och konsulter.')
    }
  }

  let token = accessTokenForResult
  if (!token) {
    const createdLink = await createCaseAccessToken(admin, caseId, applicantEmailValue)
    token = createdLink.token
  } else {
    await admin
      .from('case_access_links')
      .update({
        plain_token: token,
        email: applicantEmailValue,
      })
      .eq('token_hash', hashToken(token))
  }

  const accessUrl = buildAbsoluteUrl(requestOrigin, `/renoapp/case/${token}`)
  const resumeUrl = buildAbsoluteUrl(requestOrigin, `/renoapp/brf/${brf.slug}/apply?draft=${token}`)
  const caseAdminUrl = buildAbsoluteUrl(requestOrigin, `/renoapp/app/cases/${caseId}`)
  const applicantDisplayName = contact?.name ?? applicantName ?? 'OkÃ¤nd sÃ¶kande'
  const caseTitle = title.trim()
  const isCompletionSubmit = mode === 'submit' && String(existingCase?.status ?? '') === 'need_info'

  if (isCompletionSubmit) {
    await insertCaseMessage({
      admin,
      caseId,
      type: 'applicant_reply',
      authorRole: 'applicant',
      authorContactId: contact?.id ?? null,
      message: replyMessage ?? 'Komplettering inskickad.',
      metadata: {
        nextStatus,
      },
    })
  }

  if (mode === 'submit') {
    if (isCompletionSubmit) {
      await sendRenoAppCaseEventNotification({
        admin,
        brfId: brf.id,
        requestOrigin,
        replyTo: brf.email ?? null,
        subject: `RenoApp: komplettering klar ${caseNumber}`,
        preheader: `Komplettering klar fÃ¶r ${caseNumber}`,
        bodyHtml: `
          <p>En medlem har skickat in begÃ¤rd komplettering i RenoApp.</p>
          <p>Ã„rendenummer: <strong>${escapeHtml(caseNumber)}</strong></p>
          ${caseTitle ? `<p>Renovering: <strong>${escapeHtml(caseTitle)}</strong></p>` : ''}
          <p>SÃ¶kande: <strong>${escapeHtml(applicantDisplayName)}</strong></p>
          <p>Ã–ppna Ã¤rendet hÃ¤r:</p>
          <p><a href="${caseAdminUrl}">${caseAdminUrl}</a></p>
        `,
        text: [
          'En medlem har skickat in begÃ¤rd komplettering i RenoApp.',
          `Ã„rendenummer: ${caseNumber}`,
          ...(caseTitle ? [`Renovering: ${caseTitle}`] : []),
          `SÃ¶kande: ${applicantDisplayName}`,
          '',
          `Ã–ppna Ã¤rendet hÃ¤r: ${caseAdminUrl}`,
        ].join('\n'),
      })
    } else {
      await sendRenoAppCaseEventNotification({
        admin,
        brfId: brf.id,
        requestOrigin,
        replyTo: brf.email ?? null,
        subject: `RenoApp: ny ansÃ¶kan ${caseNumber}`,
        preheader: `Ny ansÃ¶kan inkommen ${caseNumber}`,
        bodyHtml: `
          <p>En ny ansÃ¶kan har kommit in i RenoApp.</p>
          <p>Ã„rendenummer: <strong>${escapeHtml(caseNumber)}</strong></p>
          ${caseTitle ? `<p>Renovering: <strong>${escapeHtml(caseTitle)}</strong></p>` : ''}
          <p>SÃ¶kande: <strong>${escapeHtml(applicantDisplayName)}</strong></p>
          <p>Ã–ppna Ã¤rendet hÃ¤r:</p>
          <p><a href="${caseAdminUrl}">${caseAdminUrl}</a></p>
        `,
        text: [
          'En ny ansÃ¶kan har kommit in i RenoApp.',
          `Ã„rendenummer: ${caseNumber}`,
          ...(caseTitle ? [`Renovering: ${caseTitle}`] : []),
          `SÃ¶kande: ${applicantDisplayName}`,
          '',
          `Ã–ppna Ã¤rendet hÃ¤r: ${caseAdminUrl}`,
        ].join('\n'),
      })
    }
  }

  const mailFrom = getMailFromAddress()
  let emailSent = false
  let emailError: string | null = null

  if (mailFrom && applicantEmailValue) {
    try {
      if (mode === 'draft') {
        if (isNewDraft) {
          await sendAssignmentEmail({
            to: applicantEmailValue,
            from: mailFrom,
            replyTo: brf.email ?? null,
            subject: `RenoApp: fortsÃ¤tt din ansÃ¶kan fÃ¶r ${brf.name}`,
            html: buildRenoAppEmailHtml({
              origin: requestOrigin,
              preheader: `FortsÃ¤tt din ansÃ¶kan fÃ¶r ${brf.name}`,
              bodyHtml: `
              <p>Hej ${escapeHtml(applicantDisplayName)},</p>
              <p>Vi har sparat ditt utkast fÃ¶r <strong>${escapeHtml(brf.name)}</strong>.</p>
              ${
                contractorRequirementSummary.length > 0
                  ? `<p>Kom ihÃ¥g att fÃ¶ljande entreprenÃ¶rskrav gÃ¤ller: ${escapeHtml(
                      contractorRequirementSummary.map((item) => item.label).join(', ')
                    )}.</p>`
                  : ''
              }
              <p>Ã–ppna lÃ¤nken nedan fÃ¶r att fortsÃ¤tta senare:</p>
                <p><a href="${resumeUrl}">${resumeUrl}</a></p>
              `,
            }),
            text: [
              `Hej ${applicantDisplayName},`,
              `Vi har sparat ditt utkast fÃ¶r ${brf.name}.`,
              `FortsÃ¤tt hÃ¤r: ${resumeUrl}`,
            ].join('\n'),
          })
          emailSent = true
        }
      } else {
        await sendAssignmentEmail({
          to: applicantEmailValue,
          from: mailFrom,
          replyTo: brf.email ?? null,
          subject: `RenoApp: din ansÃ¶kan ${caseNumber}`,
          html: buildRenoAppEmailHtml({
            origin: requestOrigin,
            preheader: `Din ansÃ¶kan ${caseNumber}`,
            bodyHtml: `
              <p>Hej ${escapeHtml(applicantDisplayName)},</p>
              <p>Vi har tagit emot din renoveringsansÃ¶kan fÃ¶r <strong>${escapeHtml(brf.name)}</strong>.</p>
              <p>Ã„rendenummer: <strong>${escapeHtml(caseNumber)}</strong></p>
              ${
                contractorRequirementSummary.length > 0
                  ? `<p>AnsÃ¶kan gÃ¤ller arbete dÃ¤r fÃ¶ljande entreprenÃ¶rskrav normalt gÃ¤ller: ${escapeHtml(
                      contractorRequirementSummary.map((item) => item.label).join(', ')
                    )}.</p>`
                  : ''
              }
              <p>Ã–ppna och komplettera ditt Ã¤rende via lÃ¤nken nedan:</p>
              <p><a href="${resumeUrl}">${resumeUrl}</a></p>
            `,
          }),
          text: [
            `Hej ${applicantDisplayName},`,
            `Vi har tagit emot din renoveringsansÃ¶kan fÃ¶r ${brf.name}.`,
            `Ã„rendenummer: ${caseNumber}`,
            `Ã–ppna Ã¤rendet hÃ¤r: ${resumeUrl}`,
          ].join('\n'),
        })
        emailSent = true
      }
    } catch (mailError) {
      emailError = mailError instanceof Error ? mailError.message : 'Mejlutskick misslyckades.'
    }
  } else if (!applicantEmailValue) {
    emailError = 'Ingen e-postadress Ã¤r angiven. AnsÃ¶kan sparades men inget mejl kunde skickas.'
  } else if (mode === 'draft' && isNewDraft) {
    emailError = 'ASSIGNMENTS_MAIL_FROM saknas. Utkastet sparades men ingen fortsÃ¤tt-lÃ¤nk skickades.'
  } else if (mode === 'submit') {
    emailError = 'ASSIGNMENTS_MAIL_FROM saknas. Ã„rendet skapades men inget mejl skickades.'
  }

  return {
    caseId,
    caseNumber,
    accessUrl,
    resumeUrl,
    status: mode === 'submit' ? 'submitted' : 'draft',
    emailSent,
    emailError,
  }
}

export async function getCaseAccessByToken(token: string): Promise<RenoAppCaseAccessResult | null> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const tokenHash = hashToken(token)

  const { data: accessData, error: accessError } = await admin
    .from('case_access_links')
    .select('id,case_id,email,scope,expires_at,revoked_at,last_used_at,created_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (accessError) {
    throw new Error(accessError.message ?? 'Kunde inte lÃ¤sa Ã¥tkomstlÃ¤nk.')
  }

  if (!accessData) {
    return null
  }

  const access = accessData as CaseAccessLinkRow
  const now = Date.now()
  const isRevoked = !!access.revoked_at
  const isExpired = new Date(access.expires_at).getTime() < now

  if (!isRevoked && !isExpired) {
    await admin.from('case_access_links').update({ last_used_at: new Date().toISOString() }).eq('id', access.id)
  }

  const { data: caseData, error: caseError } = await admin
    .from('renovation_cases')
    .select('id,brf_id,unit_id,applicant_contact_id,action_type_id,case_number,title,description,status,risk_level,blocked_at,blocked_reason,submitted_at,updated_at')
    .eq('id', access.case_id)
    .maybeSingle()

  if (caseError || !caseData) {
    throw new Error(caseError?.message ?? 'Kunde inte hÃ¤mta Ã¤rende.')
  }

  const caseRow = caseData as CaseRow

  const [brfResult, contactResult, unitResult, actionResult, documentsResult] = await Promise.all([
    admin.from('brf_associations').select('id,name,slug').eq('id', caseRow.brf_id).maybeSingle(),
    caseRow.applicant_contact_id
      ? admin.from('contacts').select('id,name,email,phone').eq('id', caseRow.applicant_contact_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    caseRow.unit_id
      ? admin
          .from('brf_units')
          .select('id,unit_number_internal,unit_number_skatteverket,status')
          .eq('id', caseRow.unit_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    caseRow.action_type_id
      ? admin.from('renovation_action_types').select('key,label').eq('id', caseRow.action_type_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from('renovation_case_documents')
      .select('id,file_name,status,uploaded_at,note')
      .eq('case_id', caseRow.id)
      .order('uploaded_at', { ascending: false }),
  ])

  if (brfResult.error) throw new Error(brfResult.error.message ?? 'Kunde inte hÃ¤mta BRF.')
  if (contactResult.error) throw new Error(contactResult.error.message ?? 'Kunde inte hÃ¤mta kontakt.')
  if (unitResult.error) throw new Error(unitResult.error.message ?? 'Kunde inte hÃ¤mta lÃ¤genhet.')
  if (actionResult.error) throw new Error(actionResult.error.message ?? 'Kunde inte hÃ¤mta Ã¥tgÃ¤rdstyp.')
  if (documentsResult.error) throw new Error(documentsResult.error.message ?? 'Kunde inte hÃ¤mta dokument.')

  const [activeDocumentTypes, caseRequirements] = caseRow.action_type_id
    ? await Promise.all([listActiveDocumentTypes(admin), listRequirements(admin, caseRow.brf_id)])
    : [[], [] as RequirementRow[]]
  const requirementByDocumentId = new Map(
    caseRequirements
      .filter((item) => item.action_type_id === caseRow.action_type_id)
      .map((item) => [item.document_type_id, item] as const)
  )

  return {
    state: isRevoked ? 'revoked' : isExpired ? 'expired' : 'open',
    access: {
      scope: access.scope,
      allowedActions: allowedActionsFromScope(access.scope),
      expiresAt: access.expires_at,
      revokedAt: access.revoked_at,
      lastUsedAt: access.last_used_at,
    },
    brf: {
      id: String(brfResult.data?.id ?? ''),
      name: String(brfResult.data?.name ?? ''),
      slug: String(brfResult.data?.slug ?? ''),
    },
    case: {
      id: caseRow.id,
      caseNumber: caseRow.case_number,
      title: caseRow.title,
      description: caseRow.description,
      status: caseRow.status,
      riskLevel: caseRow.risk_level,
      submittedAt: caseRow.submitted_at,
      blockedAt: caseRow.blocked_at,
      blockedReason: caseRow.blocked_reason,
      actionType: actionResult.data
        ? {
            key: String(actionResult.data.key ?? ''),
            label: String(actionResult.data.label ?? ''),
          }
        : null,
    },
    contact: {
      id: (contactResult.data?.id as string | null | undefined) ?? null,
      name: (contactResult.data?.name as string | null | undefined) ?? null,
      email: (contactResult.data?.email as string | null | undefined) ?? null,
      phone: (contactResult.data?.phone as string | null | undefined) ?? null,
    },
    unit: {
      id: (unitResult.data?.id as string | null | undefined) ?? null,
      unitNumberInternal: (unitResult.data?.unit_number_internal as string | null | undefined) ?? null,
      unitNumberSkatteverket: (unitResult.data?.unit_number_skatteverket as string | null | undefined) ?? null,
      status: (unitResult.data?.status as string | null | undefined) ?? null,
    },
    documents: ((documentsResult.data ?? []) as Array<Record<string, unknown>>).map((document) => ({
      id: String(document.id ?? ''),
      fileName: (document.file_name as string | null | undefined) ?? null,
      status: String(document.status ?? ''),
      uploadedAt: String(document.uploaded_at ?? ''),
      note: (document.note as string | null | undefined) ?? null,
    })),
    documentOptions: activeDocumentTypes
      .filter((item) => requirementByDocumentId.size === 0 || requirementByDocumentId.has(item.id))
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description,
        isRequired: requirementByDocumentId.get(item.id)?.is_required ?? false,
      })),
  }
}

export async function requireRenoAppViewerContext(): Promise<RenoAppViewerContext> {
  const accessContext = await getCurrentUserPlatformAccessContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const normalizedRenoAppAssignments = accessContext.assignments.filter(
    (assignment) =>
      assignment.productKey === 'renoapp' &&
      (assignment.moduleKey === null || assignment.moduleKey === 'board_portal')
  )
  const profile: ProfileLite = {
    id: accessContext.identity.profileId,
    full_name: accessContext.identity.fullName,
    email: accessContext.identity.email,
    is_admin: accessContext.identity.isLegacyAdmin,
  }
  const brfs =
    normalizedRenoAppAssignments.length > 0
      ? await loadNormalizedRenoAppBrfs(admin, normalizedRenoAppAssignments)
      : await loadLegacyRenoAppBrfs(admin, accessContext.identity.profileId)

  if (brfs.length === 0 && !accessContext.identity.isLegacyAdmin) {
    throw new Error('RENOAPP_MEMBERSHIP_REQUIRED')
  }

  const cookieStore = (await cookies()) as {
    get?: (name: string) => { value?: string } | undefined
  }
  const requestedBrfId = cookieStore.get?.('renoapp_active_brf_id')?.value ?? null
  const fallbackBrfId = brfs[0]?.id ?? null
  const activeBrfId =
    requestedBrfId && brfs.some((item) => item.id === requestedBrfId) ? requestedBrfId : fallbackBrfId

  return {
    userId: accessContext.identity.userId,
    profile,
    isInternalAdmin: accessContext.identity.isLegacyAdmin,
    brfs,
    activeBrfId,
    accessibleBrfIds: activeBrfId ? [activeBrfId] : brfs.length > 0 ? brfs.map((item) => item.id) : null,
  }
}

async function requireRenoAppAdminProfile() {
  const context = await requireRenoAppViewerContext()
  if (!context.isInternalAdmin) {
    throw new Error('ADMIN_REQUIRED')
  }
  return context
}

function applyBrfScope(query: QueryBuilder, accessibleBrfIds: string[] | null) {
  if (accessibleBrfIds && accessibleBrfIds.length > 0) {
    return query.in('brf_id', accessibleBrfIds)
  }

  return query
}

function applyBrfAssociationScope(query: QueryBuilder, accessibleBrfIds: string[] | null) {
  if (accessibleBrfIds && accessibleBrfIds.length > 0) {
    return query.in('id', accessibleBrfIds)
  }

  return query
}

function normalizeText(value: unknown) {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

function repairLikelyMojibakeText(value: string | null) {
  if (!value || !/[\u00c2\u00c3\u00e2]/.test(value)) return value

  try {
    const repaired = Buffer.from(value, 'latin1').toString('utf8')
    return repaired.includes('\uFFFD') ? value : repaired
  } catch {
    return value
  }
}

function terminologyTextLooksBroken(value: string | null) {
  if (!value) return true

  return (
    value.includes('\uFFFD') ||
    /[\u00c2\u00c3\u00e2]/.test(value) ||
    value.includes('\u00ef\u00bf\u00bd') ||
    value.includes('f\u00c2') ||
    value.includes('Ã¯Â¿Â½')
  )
}

function pickTerminologyText(value: string | null, fallback: string | null) {
  const repaired = repairLikelyMojibakeText(value)
  if (fallback && terminologyTextLooksBroken(repaired)) return fallback
  return repaired
}

function repairLikelyMojibakeValue(value: unknown): unknown {
  if (typeof value === 'string') return repairLikelyMojibakeText(value)
  if (Array.isArray(value)) return value.map((item) => repairLikelyMojibakeValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        repairLikelyMojibakeValue(item),
      ])
    )
  }

  return value
}

function normalizeTerminologyText(value: unknown) {
  return repairLikelyMojibakeText(normalizeText(value))
}

function normalizeMachineKey(value: unknown) {
  const text = normalizeText(value)
  if (!text) return null

  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function normalizeTerminologyCode(value: unknown) {
  const text = normalizeText(value)
  if (!text) return null

  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
}

function normalizeEmail(value: unknown) {
  const text = normalizeText(value)
  return text ? text.toLowerCase() : null
}

function normalizeTerminologyTermLevel(
  value: unknown
): 'ux' | 'technical' | 'classification' | 'status' | 'document_phase' | 'decision' {
  return value === 'technical' ||
    value === 'classification' ||
    value === 'status' ||
    value === 'document_phase' ||
    value === 'decision'
    ? value
    : 'ux'
}

function normalizeTerminologyInputKind(
  value: unknown
): 'user_visible' | 'system_internal' | 'system_generated' {
  return value === 'system_internal' || value === 'system_generated' ? value : 'user_visible'
}

function normalizeQuestionResponseType(value: unknown): 'single_select' | 'multi_select' | 'boolean' {
  return value === 'multi_select' || value === 'boolean' ? value : 'single_select'
}

function normalizeJsonValue(value: unknown) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    Array.isArray(value) ||
    (typeof value === 'object' && value !== null)
  ) {
    return value
  }

  return {}
}

function normalizePostalCode(value: unknown) {
  const text = normalizeText(value)
  if (!text) return null

  const digits = text.replace(/\s+/g, '')
  if (!/^\d{5}$/.test(digits)) {
    return text
  }

  return `${digits.slice(0, 3)} ${digits.slice(3)}`
}

function assertValidEmail(value: string | null, fieldName: string) {
  if (!value || !EMAIL_REGEX.test(value)) {
    throw new Error(fieldName)
  }
}

function assertValidOrgNumber(value: string | null, fieldName: string) {
  if (!value || !ORG_NUMBER_REGEX.test(value)) {
    throw new Error(fieldName)
  }
}

function assertRequiredText(value: string | null, fieldName: string) {
  if (!value) {
    throw new Error(fieldName)
  }
}

function assertValidPostalCode(value: string | null, fieldName: string) {
  if (!value || !POSTAL_CODE_REGEX.test(value)) {
    throw new Error(fieldName)
  }
}

function parseOptionalPositiveInteger(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('UNIT_COUNT_INVALID')
  }

  return parsed
}

function mapEditableBrfRow(row: BrfAssociationRow): RenoAppEditableBrf {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    orgNumber: row.org_number ?? null,
    propertyDesignation: row.property_designation ?? null,
    address: row.address ?? null,
    addressLine2: row.address_line_2 ?? null,
    postalCode: row.postal_code ?? null,
    city: row.city ?? null,
    generalEmail: row.email ?? null,
    brfPhone: row.phone ?? null,
    invoiceAddress: row.invoice_address ?? null,
    invoiceEmail: row.invoice_email ?? null,
    invoiceReference: row.invoice_reference ?? null,
    primaryContactName: row.primary_contact_name ?? null,
    primaryContactEmail: row.primary_contact_email ?? null,
    primaryContactPhone: row.primary_contact_phone ?? null,
    unitCount: row.unit_count ?? null,
    technicalContact: row.technical_contact ?? null,
    applyIntroText: row.apply_intro_text ?? null,
    isPublicApplyEnabled: Boolean(row.is_public_apply_enabled),
    isPublicApplyListed: Boolean(row.is_public_apply_listed),
    onboardingCompletedAt: row.onboarding_completed_at ?? null,
  }
}

function makeToken() {
  return crypto.randomBytes(24).toString('base64url')
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function buildAbsoluteUrl(origin: string, path: string) {
  return `${origin.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

function getMailFromAddress() {
  const mailFrom = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  if (!mailFrom) return null
  return mailFrom
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildRenoAppEmailHtml(input: {
  origin: string
  preheader?: string | null
  bodyHtml: string
}) {
  const logoUrl = buildAbsoluteUrl(input.origin, '/landing/Renoapp.png')
  const preheader = input.preheader ? escapeHtml(input.preheader) : null

  return `
    <div style="margin:0;padding:0;background:#f6f1ea;color:#1c1917;font-family:Arial,sans-serif;">
      ${
        preheader
          ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>`
          : ''
      }
      <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
        <div style="background:#ffffff;border:1px solid #e7e5e4;border-radius:24px;padding:32px;">
          <div style="margin-bottom:24px;">
            <img
              src="${logoUrl}"
              alt="RenoApp"
              width="132"
              style="display:block;width:132px;max-width:132px;height:auto;border:0;outline:none;text-decoration:none;"
            />
          </div>
          <div style="font-size:16px;line-height:1.75;color:#292524;">
            ${input.bodyHtml}
            <p style="margin:24px 0 0;">Med vÃ¤nlig hÃ¤lsning,<br />RenoApp-teamet pÃ¥ HusHub</p>
          </div>
        </div>
      </div>
    </div>
  `
}

export async function getRenoAppDashboardSummary(): Promise<RenoAppDashboardSummary> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const casesQuery = applyBrfScope(
    admin.from('renovation_cases').select('id,status'),
    context.accessibleBrfIds
  )
  const [casesResult] = await Promise.all([casesQuery])

  if (casesResult.error) {
    throw new Error(casesResult.error.message ?? 'Kunde inte hÃ¤mta RenoApp-Ã¤renden.')
  }


  const cases = (casesResult.data ?? []) as Array<{ status: string }>

  return {
    accessibleBrfs: context.brfs,
    activeBrfId: context.activeBrfId,
    viewerName: context.profile.full_name ?? null,
    stats: {
      newCases: cases.filter((item) => ['submitted', 'review'].includes(item.status)).length,
      needInfoCases: cases.filter((item) => item.status === 'need_info').length,
      handledCases: cases.filter((item) => ['need_info', 'approved', 'conditional', 'rejected'].includes(item.status)).length,
    },
  }
}

export async function listRenoAppCases(): Promise<RenoAppCaseListItem[]> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const casesQuery = applyBrfScope(
    admin
      .from('renovation_cases')
      .select('id,brf_id,applicant_contact_id,action_type_id,case_number,title,status,risk_level,submitted_at,updated_at')
      .order('updated_at', { ascending: false })
      .limit(100),
    context.accessibleBrfIds
  )

  const { data, error } = await casesQuery

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hÃ¤mta RenoApp-Ã¤renden.')
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const brfIds = Array.from(new Set(rows.map((row) => String(row.brf_id ?? '')).filter(Boolean)))
  const actionTypeIds = Array.from(new Set(rows.map((row) => String(row.action_type_id ?? '')).filter(Boolean)))
  const contactIds = Array.from(new Set(rows.map((row) => String(row.applicant_contact_id ?? '')).filter(Boolean)))

  const [brfsResult, actionTypesResult, contactsResult] = await Promise.all([
    brfIds.length > 0
      ? admin.from('brf_associations').select('id,name,slug').in('id', brfIds)
      : Promise.resolve({ data: [], error: null }),
    actionTypeIds.length > 0
      ? admin.from('renovation_action_types').select('id,key,label').in('id', actionTypeIds)
      : Promise.resolve({ data: [], error: null }),
    contactIds.length > 0
      ? admin.from('contacts').select('id,name,email').in('id', contactIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (brfsResult.error) throw new Error(brfsResult.error.message ?? 'Kunde inte hÃ¤mta BRF-data.')
  if (actionTypesResult.error) throw new Error(actionTypesResult.error.message ?? 'Kunde inte hÃ¤mta Ã¥tgÃ¤rdstyper.')
  if (contactsResult.error) throw new Error(contactsResult.error.message ?? 'Kunde inte hÃ¤mta kontakter.')

  const brfMap = new Map(
    ((brfsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        id: String(row.id ?? ''),
        name: (row.name as string | null | undefined) ?? null,
        slug: (row.slug as string | null | undefined) ?? null,
      },
    ])
  )
  const actionMap = new Map(
    ((actionTypesResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        key: String(row.key ?? ''),
        label: String(row.label ?? ''),
      },
    ])
  )
  const contactMap = new Map(
    ((contactsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        name: (row.name as string | null | undefined) ?? null,
        email: (row.email as string | null | undefined) ?? null,
      },
    ])
  )

  return rows.map((row) => {
    const brfId = String(row.brf_id ?? '')
    const actionTypeId = String(row.action_type_id ?? '')
    const contactId = String(row.applicant_contact_id ?? '')

    return {
      id: String(row.id ?? ''),
      caseNumber: String(row.case_number ?? ''),
      title: String(row.title ?? ''),
      status: String(row.status ?? ''),
      riskLevel: (row.risk_level as string | null | undefined) ?? null,
      updatedAt: String(row.updated_at ?? ''),
      submittedAt: String(row.submitted_at ?? ''),
      brf: brfMap.get(brfId) ?? { id: brfId, name: null, slug: null },
      actionType: actionTypeId ? actionMap.get(actionTypeId) ?? null : null,
      applicant: contactId ? contactMap.get(contactId) ?? { name: null, email: null } : { name: null, email: null },
    }
  })
}

export async function listRenoAppUnits(): Promise<RenoAppUnitListItem[]> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const unitsQuery = applyBrfScope(
    admin
      .from('brf_units')
      .select('id,brf_id,unit_number_internal,unit_number_skatteverket,status,updated_at')
      .order('updated_at', { ascending: false })
      .limit(100),
    context.accessibleBrfIds
  )

  const { data, error } = await unitsQuery

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hÃ¤mta RenoApp-lÃ¤genheter.')
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const brfIds = Array.from(new Set(rows.map((row) => String(row.brf_id ?? '')).filter(Boolean)))
  const unitIds = rows.map((row) => String(row.id ?? '')).filter(Boolean)

  const [brfsResult, unitContactsResult] = await Promise.all([
    brfIds.length > 0
      ? admin.from('brf_associations').select('id,name,slug').in('id', brfIds)
      : Promise.resolve({ data: [], error: null }),
    unitIds.length > 0
      ? admin
          .from('unit_contacts')
          .select('id,unit_id,contact_id,verification_status,relationship_type,is_current')
          .in('unit_id', unitIds)
          .eq('is_current', true)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (brfsResult.error) throw new Error(brfsResult.error.message ?? 'Kunde inte hÃ¤mta BRF-data.')
  if (unitContactsResult.error) throw new Error(unitContactsResult.error.message ?? 'Kunde inte hÃ¤mta kontaktkopplingar.')

  const unitContactRows = (unitContactsResult.data ?? []) as Array<Record<string, unknown>>
  const contactIds = Array.from(new Set(unitContactRows.map((row) => String(row.contact_id ?? '')).filter(Boolean)))

  const contactsResult =
    contactIds.length > 0
      ? await admin.from('contacts').select('id,name,email').in('id', contactIds)
      : { data: [], error: null }

  if (contactsResult.error) throw new Error(contactsResult.error.message ?? 'Kunde inte hÃ¤mta kontakter.')

  const brfMap = new Map(
    ((brfsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        id: String(row.id ?? ''),
        name: (row.name as string | null | undefined) ?? null,
        slug: (row.slug as string | null | undefined) ?? null,
      },
    ])
  )
  const contactMap = new Map(
    ((contactsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        id: String(row.id ?? ''),
        name: (row.name as string | null | undefined) ?? null,
        email: (row.email as string | null | undefined) ?? null,
      },
    ])
  )
  const contactsByUnitId = new Map<string, RenoAppUnitListItem['currentContacts']>()

  for (const row of unitContactRows) {
    const unitId = String(row.unit_id ?? '')
    const contactId = String(row.contact_id ?? '')
    const contact = contactMap.get(contactId) ?? { id: contactId, name: null, email: null }
    const current = contactsByUnitId.get(unitId) ?? []
    current.push({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      verificationStatus: String(row.verification_status ?? ''),
      relationshipType: String(row.relationship_type ?? ''),
    })
    contactsByUnitId.set(unitId, current)
  }

  return rows.map((row) => {
    const unitId = String(row.id ?? '')
    const brfId = String(row.brf_id ?? '')

    return {
      id: unitId,
      unitNumberInternal: (row.unit_number_internal as string | null | undefined) ?? null,
      unitNumberSkatteverket: (row.unit_number_skatteverket as string | null | undefined) ?? null,
      status: String(row.status ?? ''),
      updatedAt: String(row.updated_at ?? ''),
      brf: brfMap.get(brfId) ?? { id: brfId, name: null, slug: null },
      currentContacts: contactsByUnitId.get(unitId) ?? [],
    }
  })
}

export async function listRenoAppUsers(): Promise<RenoAppUserListItem[]> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const brfIds = context.accessibleBrfIds ?? context.brfs.map((item) => item.id)

  if (brfIds.length === 0) {
    return []
  }

  const [brfsResult, initialMembersResult, invitesResult] = await Promise.all([
    admin.from('brf_associations').select('id,name,slug').in('id', brfIds),
    admin
      .from('brf_members')
      .select(
        'brf_id,profile_id,role,accepted_at,is_active,renoapp_email_general_enabled,renoapp_email_case_events_enabled'
      )
      .in('brf_id', brfIds)
      .eq('is_active', true),
    admin
      .from('brf_member_invites')
      .select('id,brf_id,email,full_name,expires_at,accepted_at,revoked_at,created_at')
      .in('brf_id', brfIds)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
  ])

  const membersResult =
    initialMembersResult.error &&
    (initialMembersResult.error.message?.includes('renoapp_email_general_enabled') ||
      initialMembersResult.error.message?.includes('renoapp_email_case_events_enabled'))
      ? await admin
          .from('brf_members')
          .select('brf_id,profile_id,role,accepted_at,is_active')
          .in('brf_id', brfIds)
          .eq('is_active', true)
      : initialMembersResult

  if (brfsResult.error) throw new Error(brfsResult.error.message ?? 'Kunde inte hÃ¤mta BRF-data.')
  if (membersResult.error) throw new Error(membersResult.error.message ?? 'Kunde inte hÃ¤mta RenoApp-anvÃ¤ndare.')
  if (invitesResult.error) throw new Error(invitesResult.error.message ?? 'Kunde inte hÃ¤mta vÃ¤ntande invites.')

  const memberRows = (membersResult.data ?? []) as Array<Record<string, unknown>>
  const profileIds = Array.from(new Set(memberRows.map((row) => String(row.profile_id ?? '')).filter(Boolean)))
  const profilesResult =
    profileIds.length > 0
      ? await admin.from('profiles').select('id,full_name,email').in('id', profileIds)
      : { data: [], error: null }

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message ?? 'Kunde inte hÃ¤mta anvÃ¤ndarprofiler.')
  }

  const brfMap = new Map(
    ((brfsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        id: String(row.id ?? ''),
        name: (row.name as string | null | undefined) ?? null,
        slug: (row.slug as string | null | undefined) ?? null,
      },
    ])
  )

  const profileMap = new Map(
    ((profilesResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        fullName: (row.full_name as string | null | undefined) ?? null,
        email: (row.email as string | null | undefined) ?? null,
      },
    ])
  )

  const membersByBrfId = new Map<string, RenoAppUserListItem['members']>()
  for (const row of memberRows) {
    const brfId = String(row.brf_id ?? '')
    const profileId = String(row.profile_id ?? '')
    const profile = profileMap.get(profileId) ?? { fullName: null, email: null }
    const bucket = membersByBrfId.get(brfId) ?? []
    bucket.push({
      profileId,
      fullName: profile.fullName,
      email: profile.email,
      role: String(row.role ?? 'board') as 'board' | 'admin',
      acceptedAt: (row.accepted_at as string | null | undefined) ?? null,
      receivesGeneralInfoEmails: row.renoapp_email_general_enabled === true,
      receivesCaseEventEmails:
        row.renoapp_email_case_events_enabled === undefined ? true : row.renoapp_email_case_events_enabled === true,
    })
    membersByBrfId.set(brfId, bucket)
  }

  const invitesByBrfId = new Map<string, RenoAppUserListItem['pendingInvites']>()
  for (const row of (invitesResult.data ?? []) as Array<Record<string, unknown>>) {
    const brfId = String(row.brf_id ?? '')
    const bucket = invitesByBrfId.get(brfId) ?? []
    bucket.push({
      id: String(row.id ?? ''),
      fullName: (row.full_name as string | null | undefined) ?? null,
      email: String(row.email ?? ''),
      expiresAt: String(row.expires_at ?? ''),
      createdAt: String(row.created_at ?? ''),
    })
    invitesByBrfId.set(brfId, bucket)
  }

  return brfIds.map((brfId) => ({
    brf: brfMap.get(brfId) ?? { id: brfId, name: null, slug: null },
    members: membersByBrfId.get(brfId) ?? [],
    pendingInvites: invitesByBrfId.get(brfId) ?? [],
  }))
}

export async function updateRenoAppUserMemberEmailPreferences(input: {
  brfId: string
  profileId: string
  receivesGeneralInfoEmails: boolean
  receivesCaseEventEmails: boolean
}) {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  if (context.accessibleBrfIds && !context.accessibleBrfIds.includes(input.brfId)) {
    throw new Error('BRF_NOT_FOUND')
  }

  const { data: memberData, error: memberError } = await admin
    .from('brf_members')
    .select('id,is_active')
    .eq('brf_id', input.brfId)
    .eq('profile_id', input.profileId)
    .maybeSingle()

  if (memberError) {
    throw new Error(memberError.message ?? 'Kunde inte lÃ¤sa BRF-anvÃ¤ndare.')
  }
  if (!memberData || !(memberData as Record<string, unknown>).is_active) {
    throw new Error('MEMBER_NOT_FOUND')
  }

  const { error: updateError } = await admin
    .from('brf_members')
    .update({
      renoapp_email_general_enabled: input.receivesGeneralInfoEmails,
      renoapp_email_case_events_enabled: input.receivesCaseEventEmails,
    })
    .eq('brf_id', input.brfId)
    .eq('profile_id', input.profileId)

  if (updateError) {
    if (
      updateError.message?.includes('renoapp_email_general_enabled') ||
      updateError.message?.includes('renoapp_email_case_events_enabled')
    ) {
      throw new Error('EMAIL_PREFERENCES_MIGRATION_REQUIRED')
    }
    throw new Error(updateError.message ?? 'Kunde inte spara e-postinstÃ¤llningar.')
  }

  return { saved: true as const }
}

async function listRenoAppNotificationRecipients(input: {
  admin: SupabaseAdminClient
  brfId: string
  preference: 'general' | 'case_events'
}): Promise<RenoAppNotificationRecipient[]> {
  const preferenceColumn =
    input.preference === 'general' ? 'renoapp_email_general_enabled' : 'renoapp_email_case_events_enabled'

  const { data: memberRows, error: memberError } = await input.admin
    .from('brf_members')
    .select(`profile_id,${preferenceColumn}`)
    .eq('brf_id', input.brfId)
    .eq('is_active', true)
    .eq(preferenceColumn, true)

  if (memberError) {
    throw new Error(memberError.message ?? 'Kunde inte lÃ¤sa BRF-anvÃ¤ndare fÃ¶r notifiering.')
  }

  const profileIds = Array.from(
    new Set(((memberRows ?? []) as Array<Record<string, unknown>>).map((row) => String(row.profile_id ?? '')).filter(Boolean))
  )

  if (profileIds.length === 0) {
    return []
  }

  const { data: profileRows, error: profileError } = await input.admin
    .from('profiles')
    .select('id,full_name,email')
    .in('id', profileIds)

  if (profileError) {
    throw new Error(profileError.message ?? 'Kunde inte lÃ¤sa profiler fÃ¶r notifiering.')
  }

  return ((profileRows ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      email: normalizeEmail(row.email),
      fullName: (row.full_name as string | null | undefined) ?? null,
    }))
    .filter((item): item is RenoAppNotificationRecipient => Boolean(item.email))
}

async function sendRenoAppCaseEventNotification(input: {
  admin: SupabaseAdminClient
  brfId: string
  requestOrigin: string
  subject: string
  preheader: string
  bodyHtml: string
  text: string
  replyTo?: string | null
}) {
  const mailFrom = getMailFromAddress()
  if (!mailFrom) {
    return
  }

  const recipients = await listRenoAppNotificationRecipients({
    admin: input.admin,
    brfId: input.brfId,
    preference: 'case_events',
  })

  for (const recipient of recipients) {
    try {
      await sendAssignmentEmail({
        to: recipient.email,
        from: mailFrom,
        replyTo: input.replyTo ?? null,
        subject: input.subject,
        html: buildRenoAppEmailHtml({
          origin: input.requestOrigin,
          preheader: input.preheader,
          bodyHtml: input.bodyHtml,
        }),
        text: input.text,
      })
    } catch {
      // Ignore single-recipient mail errors so the case flow itself is not blocked.
    }
  }
}

export async function listEditableRenoAppBrfs(): Promise<RenoAppEditableBrf[]> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const query = applyBrfAssociationScope(
    admin
      .from('brf_associations')
      .select(
        'id,name,slug,org_number,address,address_line_2,postal_code,city,email,phone,property_designation,invoice_address,invoice_email,invoice_reference,primary_contact_name,primary_contact_email,primary_contact_phone,unit_count,technical_contact,is_public_apply_enabled,is_public_apply_listed,apply_intro_text,onboarding_completed_at'
      )
      .order('name', { ascending: true }),
    context.accessibleBrfIds
  )

  const { data, error } = await query

  if (error) {
    throw new Error(error.message ?? 'Kunde inte lÃ¤sa BRF-data.')
  }

  return ((data ?? []) as BrfAssociationRow[]).map(mapEditableBrfRow)
}

export async function updateEditableRenoAppBrf(input: UpdateRenoAppBrfInput): Promise<RenoAppEditableBrf> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  if (!input.brfId) {
    throw new Error('BRF_NOT_FOUND')
  }

  const name = normalizeText(input.name)
  const orgNumber = normalizeText(input.orgNumber)
  const propertyDesignation = normalizeText(input.propertyDesignation)
  const address = normalizeText(input.address)
  const addressLine2 = normalizeText(input.addressLine2)
  const postalCode = normalizePostalCode(input.postalCode)
  const city = normalizeText(input.city)
  const generalEmail = normalizeEmail(input.generalEmail)
  const brfPhone = normalizeText(input.brfPhone)
  const invoiceAddress = normalizeText(input.invoiceAddress)
  const invoiceEmail = normalizeEmail(input.invoiceEmail)
  const invoiceReference = normalizeText(input.invoiceReference)
  const primaryContactName = normalizeText(input.primaryContactName)
  const primaryContactEmail = normalizeEmail(input.primaryContactEmail)
  const primaryContactPhone = normalizeText(input.primaryContactPhone)
  const unitCount = parseOptionalPositiveInteger(input.unitCount)
  const technicalContact = normalizeText(input.technicalContact)
  const applyIntroText = normalizeText(input.applyIntroText)
  const isPublicApplyEnabled = Boolean(input.isPublicApplyEnabled)
  const isPublicApplyListed = isPublicApplyEnabled ? Boolean(input.isPublicApplyListed) : false

  assertRequiredText(name, 'NAME_REQUIRED')
  assertValidOrgNumber(orgNumber, 'ORG_NUMBER_INVALID')
  assertRequiredText(propertyDesignation, 'PROPERTY_DESIGNATION_REQUIRED')
  assertRequiredText(address, 'ADDRESS_REQUIRED')
  assertValidPostalCode(postalCode, 'POSTAL_CODE_INVALID')
  assertRequiredText(city, 'CITY_REQUIRED')
  assertRequiredText(invoiceAddress, 'INVOICE_ADDRESS_REQUIRED')
  assertValidEmail(invoiceEmail, 'INVOICE_EMAIL_INVALID')
  assertRequiredText(primaryContactName, 'PRIMARY_CONTACT_NAME_REQUIRED')
  assertValidEmail(primaryContactEmail, 'PRIMARY_CONTACT_EMAIL_INVALID')
  assertRequiredText(primaryContactPhone, 'PRIMARY_CONTACT_PHONE_REQUIRED')

  if (generalEmail) {
    assertValidEmail(generalEmail, 'GENERAL_EMAIL_INVALID')
  }

  const scopedQuery = applyBrfAssociationScope(
    admin
      .from('brf_associations')
      .select(
        'id,name,slug,org_number,address,address_line_2,postal_code,city,email,phone,property_designation,invoice_address,invoice_email,invoice_reference,primary_contact_name,primary_contact_email,primary_contact_phone,unit_count,technical_contact,is_public_apply_enabled,is_public_apply_listed,apply_intro_text,onboarding_completed_at'
      )
      .eq('id', input.brfId),
    context.accessibleBrfIds
  )
  const { data: existingBrf, error: existingBrfError } = await scopedQuery.maybeSingle()

  if (existingBrfError) {
    throw new Error(existingBrfError.message ?? 'Kunde inte lÃ¤sa BRF.')
  }
  if (!existingBrf) {
    throw new Error('BRF_NOT_FOUND')
  }

  const { data: updatedBrf, error: updateError } = await admin
    .from('brf_associations')
    .update({
      name,
      org_number: orgNumber,
      property_designation: propertyDesignation,
      address,
      address_line_2: addressLine2,
      postal_code: postalCode,
      city,
      email: generalEmail,
      phone: brfPhone,
      invoice_address: invoiceAddress,
      invoice_email: invoiceEmail,
      invoice_reference: invoiceReference,
      primary_contact_name: primaryContactName,
      primary_contact_email: primaryContactEmail,
      primary_contact_phone: primaryContactPhone,
      unit_count: unitCount,
      technical_contact: technicalContact,
      apply_intro_text: applyIntroText,
      is_public_apply_enabled: isPublicApplyEnabled,
      is_public_apply_listed: isPublicApplyListed,
    })
    .eq('id', input.brfId)
    .select(
      'id,name,slug,org_number,address,address_line_2,postal_code,city,email,phone,property_designation,invoice_address,invoice_email,invoice_reference,primary_contact_name,primary_contact_email,primary_contact_phone,unit_count,technical_contact,is_public_apply_enabled,is_public_apply_listed,apply_intro_text,onboarding_completed_at'
    )
    .single()

  if (updateError || !updatedBrf) {
    throw new Error(updateError?.message ?? 'Kunde inte uppdatera BRF.')
  }

  return mapEditableBrfRow(updatedBrf as BrfAssociationRow)
}

export async function sendRenoAppPublicApplyLink(input: {
  brfId: string
  fullName: string
  email: string
  origin: string
}): Promise<{
  delivery: {
    email: string
    fullName: string
    applyUrl: string
    emailSent: boolean
    emailError: string | null
  }
}> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  if (!input.brfId) {
    throw new Error('BRF_NOT_FOUND')
  }

  const fullName = normalizeText(input.fullName)
  const email = normalizeEmail(input.email)
  const origin = String(input.origin ?? '').trim()

  assertRequiredText(fullName, 'FULL_NAME_REQUIRED')
  if (!email) {
    throw new Error('EMAIL_INVALID')
  }
  const fullNameValue = fullName ?? ''

  const scopedQuery = applyBrfAssociationScope(
    admin
      .from('brf_associations')
      .select('id,name,slug,is_public_apply_enabled,is_public_apply_listed')
      .eq('id', input.brfId),
    context.accessibleBrfIds
  )
  const { data: brfData, error: brfError } = await scopedQuery.maybeSingle()

  if (brfError) {
    throw new Error(brfError.message ?? 'Kunde inte lÃ¤sa BRF.')
  }
  if (!brfData) {
    throw new Error('BRF_NOT_FOUND')
  }
  const slug = String(brfData.slug ?? '').trim()
  if (!slug) {
    throw new Error('BRF_NOT_FOUND')
  }
  const useDirectLink = brfData.is_public_apply_listed === true
  const applyUrl = useDirectLink
    ? buildAbsoluteUrl(origin, `/renoapp/brf/${slug}/apply`)
    : (
        await upsertPublicApplication(
          {
            brfSlug: slug,
            draftToken: null,
            mode: 'draft',
            applicantName: fullNameValue,
            applicantEmail: email,
            applicantPhone: null,
            unitNumberInternal: null,
            unitNumberSkatteverket: null,
            description: '',
            replyMessage: null,
            contractorName: null,
            contractorOrgNumber: null,
            contractorEmail: null,
            contractorPhone: null,
            contractorHasRequiredCertification: false,
            participantEntries: [],
            actionTypeKeys: [],
            questionAnswers: {},
          },
          origin
        )
      ).resumeUrl
  const mailFrom = getMailFromAddress()
  let emailSent = false
  let emailError: string | null = null

  if (mailFrom) {
    try {
      const subject = `RenoApp: ansökningslänk för ${String(brfData.name ?? 'er BRF')}`
      await sendAssignmentEmail({
        to: email,
        from: mailFrom,
        subject,
        html: buildRenoAppEmailHtml({
          origin,
          preheader: subject,
          bodyHtml: `
            <div style="height:16px;"></div>
            <p>Hej ${escapeHtml(fullNameValue)},</p>
            <p>Här är din ansökningslänk till <strong>${escapeHtml(String(brfData.name ?? 'er BRF'))}</strong>.</p>
            <p>Öppna ansökan här:</p>
            <p><a href="${applyUrl}">${applyUrl}</a></p>
            <p>Du kan börja fylla i ansökan direkt och fortsätta senare via samma länk.</p>
          `,
        }),
        text: [
          `Hej ${fullNameValue},`,
          `Här är din ansökningslänk till ${String(brfData.name ?? 'er BRF')}.`,
          `Öppna ansökan här: ${applyUrl}`,
          'Du kan börja fylla i ansökan direkt och fortsätta senare via samma länk.',
          '',
          'Med vänlig hälsning,',
          'RenoApp-teamet på HusHub',
        ].join('\n'),
      })
      emailSent = true
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Mejlutskick misslyckades.'
    }
  } else {
    emailError = 'ASSIGNMENTS_MAIL_FROM saknas. Ansökningslänken kunde inte skickas.'
  }

  return {
    delivery: {
      email,
      fullName: fullNameValue,
      applyUrl,
      emailSent,
      emailError,
    },
  }
}

export async function listRenoAppAdminActionTypes(): Promise<RenoAppAdminActionType[]> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const [actionTypeRows, requirementRows, questionRows, participantRoleRows] = await Promise.all([
    admin
      .from('renovation_action_types')
      .select('id,category_id,key,label,description,risk_level,contractor_requirement,sort_order,is_active')
      .order('sort_order', { ascending: true }),
    admin.from('renovation_action_document_requirements').select('action_type_id,document_type_id').is('brf_id', null),
    admin.from('renoapp_action_type_questions').select('action_type_id,question_id').eq('is_active', true),
    admin
      .from('renoapp_action_type_participant_roles')
      .select('action_type_id,participant_role_id')
      .eq('is_active', true),
  ])

  if (actionTypeRows.error) {
    throw new Error(actionTypeRows.error.message ?? 'Kunde inte lÃ¤sa renoveringstyper.')
  }
  if (requirementRows.error) {
    throw new Error(requirementRows.error.message ?? 'Kunde inte lÃ¤sa underlagskopplingar.')
  }
  if (questionRows.error) {
    throw new Error(questionRows.error.message ?? 'Kunde inte lÃ¤sa frÃ¥gekopplingar.')
  }
  if (participantRoleRows.error) {
    throw new Error(participantRoleRows.error.message ?? 'Kunde inte lÃ¤sa medverkandekopplingar.')
  }

  const requirementCountByActionTypeId = new Map<string, number>()
  for (const row of (requirementRows.data ?? []) as Array<{ action_type_id: string | null; document_type_id: string | null }>) {
    if (!row.action_type_id || !row.document_type_id) continue
    requirementCountByActionTypeId.set(
      row.action_type_id,
      (requirementCountByActionTypeId.get(row.action_type_id) ?? 0) + 1
    )
  }

  const questionCountByActionTypeId = new Map<string, number>()
  for (const row of (questionRows.data ?? []) as Array<{ action_type_id: string | null; question_id: string | null }>) {
    if (!row.action_type_id || !row.question_id) continue
    questionCountByActionTypeId.set(
      row.action_type_id,
      (questionCountByActionTypeId.get(row.action_type_id) ?? 0) + 1
    )
  }

  const participantRoleCountByActionTypeId = new Map<string, number>()
  for (const row of (participantRoleRows.data ?? []) as Array<{ action_type_id: string | null; participant_role_id: string | null }>) {
    if (!row.action_type_id || !row.participant_role_id) continue
    participantRoleCountByActionTypeId.set(
      row.action_type_id,
      (participantRoleCountByActionTypeId.get(row.action_type_id) ?? 0) + 1
    )
  }

  return ((actionTypeRows.data ?? []) as ActionTypeRow[]).map((item) => ({
    id: item.id,
    categoryId: item.category_id,
    key: item.key,
    label: item.label,
    description: item.description ?? null,
    riskLevel: item.risk_level,
    contractorRequirement: item.contractor_requirement,
    sortOrder: item.sort_order,
    isActive: item.is_active,
    requirementCount: requirementCountByActionTypeId.get(item.id) ?? 0,
    questionCount: questionCountByActionTypeId.get(item.id) ?? 0,
    participantRoleCount: participantRoleCountByActionTypeId.get(item.id) ?? 0,
  }))
}

export async function listRenoAppAdminDocumentTypes(): Promise<RenoAppAdminDocumentType[]> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const { data, error } = await admin
    .from('renovation_document_types')
    .select('id,key,label,description,review_guidance,default_phase,sort_order,is_active')
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte lÃ¤sa dokumenttyper.')
  }

  return ((data ?? []) as DocumentTypeRow[]).map((item) => ({
    id: item.id,
    key: item.key,
    label: item.label,
    description: item.description ?? null,
    reviewGuidance: item.review_guidance ?? null,
    defaultPhase: item.default_phase,
    sortOrder: item.sort_order,
    isActive: item.is_active,
  }))
}

export async function listRenoAppAdminTerminology(): Promise<{
  groups: RenoAppAdminTerminologyGroup[]
  terms: RenoAppAdminTerminologyTerm[]
}> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const [groupRows, termRows, aliasRows, ruleRows] = await Promise.all([
    admin
      .from('renoapp_terminology_groups')
      .select('id,key,label,description,sort_order,is_locked,is_active')
      .order('sort_order', { ascending: true }),
    admin
      .from('renoapp_terminology_terms')
      .select(
        'id,group_id,code,label,definition,term_level,input_kind,is_locked,is_user_selectable,is_system_generated,is_active,sort_order,metadata'
      )
      .order('sort_order', { ascending: true }),
    admin
      .from('renoapp_terminology_aliases')
      .select('id,term_id,alias,sort_order,is_active')
      .order('sort_order', { ascending: true }),
    admin
      .from('renoapp_terminology_rules')
      .select('id,term_id,rule_key,label,description,config,sort_order,is_active')
      .order('sort_order', { ascending: true }),
  ])

  if (groupRows.error) throw new Error(groupRows.error.message ?? 'Kunde inte lasa terminologigrupper.')
  if (termRows.error) throw new Error(termRows.error.message ?? 'Kunde inte lasa terminologi.')
  if (aliasRows.error) throw new Error(aliasRows.error.message ?? 'Kunde inte lasa alias.')
  if (ruleRows.error) throw new Error(ruleRows.error.message ?? 'Kunde inte lasa regler.')

  const groups = ((groupRows.data ?? []) as TerminologyGroupRow[]).map((item) => {
    const fallback = RENOAPP_TERMINOLOGY_GROUP_FALLBACKS[item.key]
    return {
      id: item.id,
      key: item.key,
      label: pickTerminologyText(item.label, fallback?.label ?? null) ?? '',
      description: pickTerminologyText(item.description ?? null, fallback?.description ?? null),
      sortOrder: item.sort_order,
      isLocked: item.is_locked,
      isActive: item.is_active,
    }
  })

  const groupMap = new Map(groups.map((item) => [item.id, item]))
  const aliases = (aliasRows.data ?? []) as TerminologyAliasRow[]
  const rules = (ruleRows.data ?? []) as TerminologyRuleRow[]

  const terms = ((termRows.data ?? []) as TerminologyTermRow[]).map((item) => {
    const group = groupMap.get(item.group_id)
    const fallback = RENOAPP_TERMINOLOGY_TERM_FALLBACKS[`${group?.key ?? ''}:${item.code}`]
    return {
      id: item.id,
      groupId: item.group_id,
      groupKey: group?.key ?? '',
      groupLabel: pickTerminologyText(
        group?.label ?? '',
        RENOAPP_TERMINOLOGY_GROUP_FALLBACKS[group?.key ?? '']?.label ?? null
      ) ?? '',
      code: item.code,
      label: pickTerminologyText(item.label, fallback?.label ?? null) ?? '',
      definition: pickTerminologyText(item.definition ?? null, fallback?.definition ?? null),
      termLevel: item.term_level,
      inputKind: item.input_kind,
      isLocked: item.is_locked,
      isUserSelectable: item.is_user_selectable,
      isSystemGenerated: item.is_system_generated,
      isActive: item.is_active,
      sortOrder: item.sort_order,
      metadata: repairLikelyMojibakeValue(item.metadata ?? {}),
      aliases: aliases
        .filter((alias) => alias.term_id === item.id)
        .map((alias) => ({
          id: alias.id,
          alias: repairLikelyMojibakeText(alias.alias) ?? '',
          sortOrder: alias.sort_order,
          isActive: alias.is_active,
        })),
      rules: rules
        .filter((rule) => rule.term_id === item.id)
        .map((rule) => ({
          id: rule.id,
          ruleKey: rule.rule_key,
          label: repairLikelyMojibakeText(rule.label) ?? '',
          description: repairLikelyMojibakeText(rule.description ?? null),
          config: repairLikelyMojibakeValue(rule.config ?? {}),
          sortOrder: rule.sort_order,
          isActive: rule.is_active,
        })),
    }
  })

  return { groups, terms }
}

export async function saveRenoAppAdminDocumentType(input: {
  id?: string | null
  key: string
  label: string
  description?: string | null
  reviewGuidance?: string | null
  defaultPhase?: 'before_required' | 'during_execution' | 'after_completion' | null
  sortOrder?: number | null
  isActive?: boolean
}): Promise<RenoAppAdminDocumentType> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const label = normalizeText(input.label)
  const key = normalizeMachineKey(label) ?? null
  const description = normalizeText(input.description)
  const reviewGuidance = normalizeText(input.reviewGuidance)
  const defaultPhase =
    input.defaultPhase === 'during_execution' || input.defaultPhase === 'after_completion'
      ? input.defaultPhase
      : 'before_required'
  const sortOrder = Number.isFinite(input.sortOrder) && Number(input.sortOrder) > 0 ? Number(input.sortOrder) : 100
  const isActive = input.isActive !== false

  assertRequiredText(key, 'DOCUMENT_TYPE_KEY_REQUIRED')
  assertRequiredText(label, 'DOCUMENT_TYPE_LABEL_REQUIRED')

  const payload = {
    key,
    label,
    description,
    review_guidance: reviewGuidance,
    default_phase: defaultPhase,
    sort_order: sortOrder,
    is_active: isActive,
  }

  const query = input.id
    ? admin.from('renovation_document_types').update(payload).eq('id', input.id)
    : admin.from('renovation_document_types').insert(payload)

  const { data, error } = await query
    .select('id,key,label,description,review_guidance,default_phase,sort_order,is_active')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Kunde inte spara dokumenttyp.')
  }

  const row = data as DocumentTypeRow
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description ?? null,
    reviewGuidance: row.review_guidance ?? null,
    defaultPhase: row.default_phase,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

export async function deleteRenoAppAdminDocumentType(id: string): Promise<void> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const { error } = await admin.from('renovation_document_types').delete().eq('id', id)
  if (error) {
    throw new Error(error.message ?? 'Kunde inte radera dokumenttyp.')
  }
}

export async function listRenoAppAdminParticipantRoles(): Promise<RenoAppAdminParticipantRole[]> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const rows = await listActiveParticipantRoles(admin)
  return rows.map(mapParticipantRoleToAdmin)
}

export async function saveRenoAppAdminParticipantRole(input: {
  id?: string | null
  key: string
  label: string
  description?: string | null
  reviewGuidance?: string | null
  roleKind?: 'contractor' | 'consultant' | null
  verificationInstructions?: string | null
  verificationUrl?: string | null
  insuranceRequired?: boolean
  requiresCompanyName?: boolean
  requiresOrgNumber?: boolean
  requiresContactName?: boolean
  requiresEmail?: boolean
  requiresPhone?: boolean
  requiresCertification?: boolean
  sortOrder?: number | null
  isActive?: boolean
}): Promise<RenoAppAdminParticipantRole> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const label = normalizeText(input.label)
  const key = normalizeMachineKey(label) ?? null
  const description = normalizeText(input.description)
  const reviewGuidance = normalizeText(input.reviewGuidance)
  const roleKind = input.roleKind === 'consultant' ? 'consultant' : 'contractor'
  const verificationInstructions = normalizeText(input.verificationInstructions)
  const verificationUrl = normalizeText(input.verificationUrl)
  const sortOrder = Number.isFinite(input.sortOrder) && Number(input.sortOrder) > 0 ? Number(input.sortOrder) : 100
  const payload = {
    key,
    label,
    description,
    review_guidance: reviewGuidance,
    role_kind: roleKind,
    verification_instructions: verificationInstructions,
    verification_url: verificationUrl,
    insurance_required: input.insuranceRequired === true,
    requires_company_name: input.requiresCompanyName !== false,
    requires_org_number: input.requiresOrgNumber === true,
    requires_contact_name: input.requiresContactName === true,
    requires_email: input.requiresEmail === true,
    requires_phone: input.requiresPhone === true,
    requires_certification: input.requiresCertification === true,
    sort_order: sortOrder,
    is_active: input.isActive !== false,
  }

  assertRequiredText(key, 'PARTICIPANT_ROLE_KEY_REQUIRED')
  assertRequiredText(label, 'PARTICIPANT_ROLE_LABEL_REQUIRED')

  const query = input.id
    ? admin.from('renoapp_participant_roles').update(payload).eq('id', input.id)
    : admin.from('renoapp_participant_roles').insert(payload)

  const { data, error } = await query
    .select(
      'id,key,label,description,review_guidance,role_kind,verification_instructions,verification_url,insurance_required,requires_company_name,requires_org_number,requires_contact_name,requires_email,requires_phone,requires_certification,sort_order,is_active'
    )
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Kunde inte spara medverkandetyp.')
  }

  return mapParticipantRoleToAdmin(data as ParticipantRoleRow)
}

export async function deleteRenoAppAdminParticipantRole(id: string): Promise<void> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const { error } = await admin.from('renoapp_participant_roles').delete().eq('id', id)
  if (error) {
    throw new Error(error.message ?? 'Kunde inte radera medverkandetyp.')
  }
}

export async function listRenoAppAdminReviewFlags(): Promise<RenoAppAdminReviewFlag[]> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const { data, error } = await admin
    .from('renoapp_review_flags')
    .select('id,key,label,description,severity,category,sort_order,is_active')
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte lÃ¤sa granskningsflaggor.')
  }

  return ((data ?? []) as ReviewFlagRow[]).map(mapReviewFlagToAdmin)
}

export async function saveRenoAppAdminReviewFlag(input: {
  id?: string | null
  key: string
  label: string
  description?: string | null
  severity?: 'info' | 'warning' | 'high' | null
  category?: string | null
  sortOrder?: number | null
  isActive?: boolean
}): Promise<RenoAppAdminReviewFlag> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const label = normalizeText(input.label)
  const key = normalizeMachineKey(input.key) ?? normalizeMachineKey(label) ?? null
  const description = normalizeText(input.description)
  const severity = input.severity === 'info' || input.severity === 'high' ? input.severity : 'warning'
  const category = normalizeText(input.category) ?? 'general'
  const sortOrder = Number.isFinite(input.sortOrder) && Number(input.sortOrder) > 0 ? Number(input.sortOrder) : 100
  const isActive = input.isActive !== false

  assertRequiredText(key, 'REVIEW_FLAG_KEY_REQUIRED')
  assertRequiredText(label, 'REVIEW_FLAG_LABEL_REQUIRED')

  const payload = {
    key,
    label,
    description,
    severity,
    category,
    sort_order: sortOrder,
    is_active: isActive,
  }

  const query = input.id
    ? admin.from('renoapp_review_flags').update(payload).eq('id', input.id)
    : admin.from('renoapp_review_flags').insert(payload)

  const { data, error } = await query
    .select('id,key,label,description,severity,category,sort_order,is_active')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Kunde inte spara granskningsflagga.')
  }

  return mapReviewFlagToAdmin(data as ReviewFlagRow)
}

export async function deleteRenoAppAdminReviewFlag(id: string): Promise<void> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const { error } = await admin.from('renoapp_review_flags').delete().eq('id', id)
  if (error) {
    throw new Error(error.message ?? 'Kunde inte radera granskningsflagga.')
  }
}

export async function listRenoAppAdminParticipantRoleConfig(): Promise<{
  participantRoles: RenoAppAdminParticipantRole[]
  actionTypes: RenoAppAdminActionTypeParticipantRoleGroup[]
}> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const [actionTypeRows, participantRoleRows, linkRows] = await Promise.all([
    admin
      .from('renovation_action_types')
      .select('id,category_id,key,label,description,risk_level,contractor_requirement,sort_order,is_active')
      .order('sort_order', { ascending: true }),
    admin
      .from('renoapp_participant_roles')
      .select(
        'id,key,label,description,review_guidance,role_kind,verification_instructions,verification_url,insurance_required,requires_company_name,requires_org_number,requires_contact_name,requires_email,requires_phone,requires_certification,sort_order,is_active'
      )
      .order('sort_order', { ascending: true }),
    admin
      .from('renoapp_action_type_participant_roles')
      .select('id,action_type_id,participant_role_id,is_required,sort_order,is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])

  if (actionTypeRows.error) throw new Error(actionTypeRows.error.message ?? 'Kunde inte lÃ¤sa renoveringstyper.')
  if (participantRoleRows.error) throw new Error(participantRoleRows.error.message ?? 'Kunde inte lÃ¤sa medverkandetyper.')
  if (linkRows.error) throw new Error(linkRows.error.message ?? 'Kunde inte lÃ¤sa medverkandekopplingar.')

  const participantRoles = ((participantRoleRows.data ?? []) as ParticipantRoleRow[]).map(mapParticipantRoleToAdmin)
  const participantRoleMap = new Map(participantRoles.map((item) => [item.id, item]))
  const actionTypes = ((actionTypeRows.data ?? []) as ActionTypeRow[]).map((row) => ({
    id: row.id,
    categoryId: row.category_id ?? null,
    key: row.key,
    label: row.label,
    description: row.description ?? null,
    riskLevel: row.risk_level,
    contractorRequirement: row.contractor_requirement,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    requirementCount: 0,
    questionCount: 0,
    participantRoleCount: 0,
  }))

  return {
    participantRoles,
    actionTypes: actionTypes.map((actionType) => ({
      actionType,
      participantRoles: ((linkRows.data ?? []) as ActionTypeParticipantRoleRow[])
        .filter((link) => link.action_type_id === actionType.id)
        .map((link) => {
          const participantRole = participantRoleMap.get(link.participant_role_id)
          if (!participantRole) return null
          return {
            id: link.id,
            participantRoleId: participantRole.id,
            participantRoleKey: participantRole.key,
            participantRoleLabel: participantRole.label,
            participantRoleDescription: participantRole.description,
            roleKind: participantRole.roleKind,
            isRequired: link.is_required,
            sortOrder: link.sort_order,
          } satisfies RenoAppAdminActionTypeParticipantRole
        })
        .filter((item): item is RenoAppAdminActionTypeParticipantRole => Boolean(item))
        .sort((left, right) => left.sortOrder - right.sortOrder),
    })),
  }
}

export async function saveRenoAppAdminActionTypeParticipantRole(input: {
  actionTypeId: string
  participantRoleId: string
  isEnabled: boolean
  isRequired?: boolean
  sortOrder?: number | null
}): Promise<void> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  if (!input.actionTypeId || !input.participantRoleId) {
    throw new Error('PARTICIPANT_ROLE_TARGET_REQUIRED')
  }

  const { data: existingLink, error: existingLinkError } = await admin
    .from('renoapp_action_type_participant_roles')
    .select('id')
    .eq('action_type_id', input.actionTypeId)
    .eq('participant_role_id', input.participantRoleId)
    .maybeSingle()

  if (existingLinkError) {
    throw new Error(existingLinkError.message ?? 'Kunde inte lÃ¤sa medverkandekoppling.')
  }

  if (!input.isEnabled) {
    if (existingLink?.id) {
      const { error } = await admin
        .from('renoapp_action_type_participant_roles')
        .delete()
        .eq('id', existingLink.id)
      if (error) throw new Error(error.message ?? 'Kunde inte ta bort medverkandekoppling.')
    }
    return
  }

  const payload = {
    action_type_id: input.actionTypeId,
    participant_role_id: input.participantRoleId,
    is_required: input.isRequired !== false,
    sort_order: Number.isFinite(input.sortOrder) && Number(input.sortOrder) > 0 ? Number(input.sortOrder) : 100,
    is_active: true,
  }

  const query = existingLink?.id
    ? admin.from('renoapp_action_type_participant_roles').update(payload).eq('id', existingLink.id)
    : admin.from('renoapp_action_type_participant_roles').insert(payload)

  const { error } = await query.select('id').single()
  if (error) {
    throw new Error(error.message ?? 'Kunde inte spara medverkandekoppling.')
  }
}

export async function listRenoAppAdminQuestions(): Promise<RenoAppAdminQuestion[]> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const [questionRows, optionRows, triggerRows, documentRows, participantRoleRows, reviewFlagRows] = await Promise.all([
    admin
      .from('renoapp_apply_questions')
      .select('id,key,label,help_text,response_type,sort_order,is_locked,is_active,metadata')
      .order('sort_order', { ascending: true }),
    admin
      .from('renoapp_apply_question_options')
      .select('id,question_id,key,label,description,sort_order,is_active,metadata')
      .order('sort_order', { ascending: true }),
    admin
      .from('renoapp_apply_option_triggers')
      .select('id,option_id,trigger_type,question_id,document_type_id,participant_role_id,review_flag_id,sort_order,is_active')
      .order('sort_order', { ascending: true }),
    admin
      .from('renovation_document_types')
      .select('id,key,label,description,review_guidance,default_phase,sort_order,is_active')
      .order('sort_order', { ascending: true }),
    admin
      .from('renoapp_participant_roles')
      .select(
        'id,key,label,description,review_guidance,role_kind,requires_company_name,requires_org_number,requires_contact_name,requires_email,requires_phone,requires_certification,sort_order,is_active'
      )
      .order('sort_order', { ascending: true }),
    admin
      .from('renoapp_review_flags')
      .select('id,key,label,description,severity,category,sort_order,is_active')
      .order('sort_order', { ascending: true }),
  ])

  if (questionRows.error) throw new Error(questionRows.error.message ?? 'Kunde inte lasa fragor.')
  if (optionRows.error) throw new Error(optionRows.error.message ?? 'Kunde inte lasa svarsalternativ.')
  if (triggerRows.error) throw new Error(triggerRows.error.message ?? 'Kunde inte lasa svarstriggers.')
  if (documentRows.error) throw new Error(documentRows.error.message ?? 'Kunde inte lasa dokumenttyper.')
  if (participantRoleRows.error) {
    throw new Error(participantRoleRows.error.message ?? 'Kunde inte lasa medverkandetyper.')
  }
  if (reviewFlagRows.error) {
    throw new Error(reviewFlagRows.error.message ?? 'Kunde inte lasa granskningsflaggor.')
  }

  const options = (optionRows.data ?? []) as ApplyQuestionOptionRow[]
  const triggers = (triggerRows.data ?? []) as ApplyOptionTriggerRow[]
  const questions = (questionRows.data ?? []) as ApplyQuestionRow[]
  const documentById = new Map(((documentRows.data ?? []) as DocumentTypeRow[]).map((item) => [item.id, item]))
  const participantRoleById = new Map(
    ((participantRoleRows.data ?? []) as ParticipantRoleRow[]).map((item) => [item.id, item])
  )
  const reviewFlagById = new Map(
    ((reviewFlagRows.data ?? []) as ReviewFlagRow[]).map((item) => [item.id, item])
  )
  const questionById = new Map(questions.map((item) => [item.id, item]))

  return questions.map((item) => ({
    id: item.id,
    key: item.key,
    label: repairLikelyMojibakeText(item.label) ?? '',
    helpText: repairLikelyMojibakeText(item.help_text ?? null),
    responseType: item.response_type,
    sortOrder: item.sort_order,
    isActive: item.is_active,
    metadata: repairLikelyMojibakeValue(item.metadata ?? {}),
    options: options
      .filter((option) => option.question_id === item.id)
      .map((option) => ({
        id: option.id,
        key: option.key,
        label: repairLikelyMojibakeText(option.label) ?? '',
        description: repairLikelyMojibakeText(option.description ?? null),
        sortOrder: option.sort_order,
        isActive: option.is_active,
        metadata: repairLikelyMojibakeValue(option.metadata ?? {}),
        triggers: triggers
          .filter((trigger) => trigger.option_id === option.id)
          .map((trigger) => ({
            id: trigger.id,
            triggerType: trigger.trigger_type,
            questionId: trigger.question_id ?? null,
            questionLabel: trigger.question_id
              ? repairLikelyMojibakeText(questionById.get(trigger.question_id)?.label ?? null)
              : null,
            documentTypeId: trigger.document_type_id ?? null,
            documentTypeLabel: trigger.document_type_id
              ? repairLikelyMojibakeText(documentById.get(trigger.document_type_id)?.label ?? null)
              : null,
            participantRoleId: trigger.participant_role_id ?? null,
            participantRoleLabel: trigger.participant_role_id
              ? repairLikelyMojibakeText(participantRoleById.get(trigger.participant_role_id)?.label ?? null)
              : null,
            reviewFlagId: trigger.review_flag_id ?? null,
            reviewFlagLabel: trigger.review_flag_id
              ? repairLikelyMojibakeText(reviewFlagById.get(trigger.review_flag_id)?.label ?? null)
              : null,
            sortOrder: trigger.sort_order,
            isActive: trigger.is_active,
          })),
      })),
  }))
}

export async function saveRenoAppAdminQuestion(input: {
  question: {
    id?: string | null
    key: string
    label: string
    helpText?: string | null
    responseType?: 'single_select' | 'multi_select' | 'boolean'
    sortOrder?: number | null
    isActive?: boolean
    metadata?: unknown
  }
  options?: Array<{
    id?: string | null
    key: string
    label: string
    description?: string | null
    sortOrder?: number | null
    isActive?: boolean
    metadata?: unknown
    triggers?: Array<{
      triggerType: 'question' | 'document' | 'participant_role' | 'review_flag'
      questionId?: string | null
      documentTypeId?: string | null
      participantRoleId?: string | null
      reviewFlagId?: string | null
      sortOrder?: number | null
      isActive?: boolean
    }>
  }>
}): Promise<RenoAppAdminQuestion> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const label = normalizeTerminologyText(input.question.label)
  const computedKey = normalizeMachineKey(input.question.key) ?? normalizeMachineKey(label) ?? null
  const key = computedKey
  const helpText = normalizeTerminologyText(input.question.helpText)
  const responseType = normalizeQuestionResponseType(input.question.responseType)
  const sortOrder =
    Number.isFinite(input.question.sortOrder) && Number(input.question.sortOrder) > 0
      ? Number(input.question.sortOrder)
      : 100
  const isActive = input.question.isActive !== false
  const metadata = normalizeJsonValue(input.question.metadata ?? {})

  assertRequiredText(key, 'QUESTION_KEY_REQUIRED')
  assertRequiredText(label, 'QUESTION_LABEL_REQUIRED')

  const payload = {
    key,
    label,
    help_text: helpText,
    response_type: responseType,
    sort_order: sortOrder,
    is_active: isActive,
    metadata,
  }

  const questionQuery = input.question.id
    ? admin.from('renoapp_apply_questions').update(payload).eq('id', input.question.id)
    : admin.from('renoapp_apply_questions').insert(payload)

  const { data: savedQuestionData, error: savedQuestionError } = await questionQuery
    .select('id,key,label,help_text,response_type,sort_order,is_locked,is_active,metadata')
    .single()

  if (savedQuestionError || !savedQuestionData) {
    throw new Error(savedQuestionError?.message ?? 'Kunde inte spara fraga.')
  }

  const savedQuestion = savedQuestionData as ApplyQuestionRow
  const questionId = savedQuestion.id

  const existingOptionsResult = await admin
    .from('renoapp_apply_question_options')
    .select('id,question_id,key,label,description,sort_order,is_active,metadata')
    .eq('question_id', questionId)

  if (existingOptionsResult.error) {
    throw new Error(existingOptionsResult.error.message ?? 'Kunde inte lasa svarsalternativ.')
  }

  const keptOptionIds = new Set<string>()
  const options = (input.options ?? []).filter((item) => normalizeText(item.label))

  for (const optionInput of options) {
    const optionLabel = normalizeTerminologyText(optionInput.label)
    const computedOptionKey =
      normalizeMachineKey(optionInput.key) ?? normalizeMachineKey(optionLabel) ?? null
    const optionDescription = normalizeTerminologyText(optionInput.description)
    const optionSortOrder =
      Number.isFinite(optionInput.sortOrder) && Number(optionInput.sortOrder) > 0
        ? Number(optionInput.sortOrder)
        : 100

    if (!optionLabel || !computedOptionKey) continue

    const optionPayload = {
      question_id: questionId,
      key: computedOptionKey,
      label: optionLabel,
      description: optionDescription,
      sort_order: optionSortOrder,
      is_active: optionInput.isActive !== false,
      metadata: normalizeJsonValue(optionInput.metadata ?? {}),
    }

    const optionQuery = optionInput.id
      ? admin.from('renoapp_apply_question_options').update(optionPayload).eq('id', optionInput.id)
      : admin.from('renoapp_apply_question_options').insert(optionPayload)

    const { data: savedOptionData, error: savedOptionError } = await optionQuery
      .select('id')
      .single()

    if (savedOptionError || !savedOptionData) {
      throw new Error(savedOptionError?.message ?? 'Kunde inte spara svarsalternativ.')
    }

    const savedOptionId = String(savedOptionData.id)
    keptOptionIds.add(savedOptionId)

    const { error: deleteTriggerError } = await admin
      .from('renoapp_apply_option_triggers')
      .delete()
      .eq('option_id', savedOptionId)

    if (deleteTriggerError) {
      throw new Error(deleteTriggerError.message ?? 'Kunde inte uppdatera svarstriggers.')
    }

    const triggerRowsToInsert = (optionInput.triggers ?? [])
      .map((triggerInput, index) => {
        const triggerType = triggerInput.triggerType
        const targetQuestionId =
          triggerType === 'question' && triggerInput.questionId && triggerInput.questionId !== questionId
            ? triggerInput.questionId
            : null
        const targetDocumentTypeId =
          triggerType === 'document' && triggerInput.documentTypeId ? triggerInput.documentTypeId : null
        const targetParticipantRoleId =
          triggerType === 'participant_role' && triggerInput.participantRoleId
            ? triggerInput.participantRoleId
            : null
        const targetReviewFlagId =
          triggerType === 'review_flag' && triggerInput.reviewFlagId
            ? triggerInput.reviewFlagId
            : null
        const triggerSortOrder =
          Number.isFinite(triggerInput.sortOrder) && Number(triggerInput.sortOrder) > 0
            ? Number(triggerInput.sortOrder)
            : (index + 1) * 10

        if (triggerType === 'question' && !targetQuestionId) return null
        if (triggerType === 'document' && !targetDocumentTypeId) return null
        if (triggerType === 'participant_role' && !targetParticipantRoleId) return null
        if (triggerType === 'review_flag' && !targetReviewFlagId) return null

        return {
          option_id: savedOptionId,
          trigger_type: triggerType,
          question_id: targetQuestionId,
          document_type_id: targetDocumentTypeId,
          participant_role_id: targetParticipantRoleId,
          review_flag_id: targetReviewFlagId,
          sort_order: triggerSortOrder,
          is_active: triggerInput.isActive !== false,
        }
      })
      .filter(
        (
          item
        ): item is {
          option_id: string
          trigger_type: 'question' | 'document' | 'participant_role' | 'review_flag'
          question_id: string | null
          document_type_id: string | null
          participant_role_id: string | null
          review_flag_id: string | null
          sort_order: number
          is_active: boolean
        } => Boolean(item)
      )

    if (triggerRowsToInsert.length > 0) {
      const { error: insertTriggerError } = await admin
        .from('renoapp_apply_option_triggers')
        .insert(triggerRowsToInsert)

      if (insertTriggerError) {
        throw new Error(insertTriggerError.message ?? 'Kunde inte spara svarstriggers.')
      }
    }
  }

  for (const existingOption of (existingOptionsResult.data ?? []) as ApplyQuestionOptionRow[]) {
    if (!keptOptionIds.has(existingOption.id)) {
      const { error } = await admin
        .from('renoapp_apply_question_options')
        .delete()
        .eq('id', existingOption.id)
      if (error) {
        throw new Error(error.message ?? 'Kunde inte ta bort svarsalternativ.')
      }
    }
  }

  const questions = await listRenoAppAdminQuestions()
  const saved = questions.find((item) => item.id === questionId)
  if (!saved) {
    throw new Error('Kunde inte lasa sparad fraga.')
  }

  return saved
}

export async function deleteRenoAppAdminQuestion(id: string): Promise<void> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const { error } = await admin.from('renoapp_apply_questions').delete().eq('id', id)
  if (error) {
    throw new Error(error.message ?? 'Kunde inte radera fraga.')
  }
}

export async function listRenoAppAdminActionTypeQuestionConfig(): Promise<{
  questions: RenoAppAdminQuestion[]
  actionTypes: RenoAppAdminActionTypeQuestionGroup[]
}> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const [questions, actionTypes, linkRows] = await Promise.all([
    listRenoAppAdminQuestions(),
    listRenoAppAdminActionTypes(),
    admin
      .from('renoapp_action_type_questions')
      .select('id,action_type_id,question_id,sort_order,is_required,is_active')
      .order('sort_order', { ascending: true }),
  ])

  if (linkRows.error) {
    throw new Error(linkRows.error.message ?? 'Kunde inte lasa fragekopplingar.')
  }

  const questionMap = new Map(questions.map((item) => [item.id, item]))
  const links = (linkRows.data ?? []) as ActionTypeQuestionRow[]

  return {
    questions,
    actionTypes: actionTypes.map((actionType) => ({
      actionType,
      questions: links
        .filter((link) => link.action_type_id === actionType.id && link.is_active)
        .map((link) => {
          const question = questionMap.get(link.question_id)
          return {
            id: link.id,
            questionId: link.question_id,
            questionKey: question?.key ?? '',
            questionLabel: question?.label ?? '',
            questionHelpText: question?.helpText ?? null,
            isRequired: link.is_required,
            sortOrder: link.sort_order,
          }
        })
        .filter((item) => item.questionId)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.questionLabel.localeCompare(right.questionLabel, 'sv')),
    })),
  }
}

export async function saveRenoAppAdminActionTypeQuestion(input: {
  actionTypeId: string
  questionId: string
  isEnabled: boolean
  isRequired?: boolean
  sortOrder?: number | null
}): Promise<void> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  if (!input.actionTypeId || !input.questionId) {
    throw new Error('ACTION_TYPE_QUESTION_TARGET_REQUIRED')
  }

  const { data: existingLink, error: existingLinkError } = await admin
    .from('renoapp_action_type_questions')
    .select('id')
    .eq('action_type_id', input.actionTypeId)
    .eq('question_id', input.questionId)
    .maybeSingle()

  if (existingLinkError) {
    throw new Error(existingLinkError.message ?? 'Kunde inte lasa fragekoppling.')
  }

  if (!input.isEnabled) {
    if (existingLink?.id) {
      const { error } = await admin.from('renoapp_action_type_questions').delete().eq('id', existingLink.id)
      if (error) {
        throw new Error(error.message ?? 'Kunde inte ta bort fragekoppling.')
      }
    }
    return
  }

  const payload = {
    action_type_id: input.actionTypeId,
    question_id: input.questionId,
    sort_order:
      Number.isFinite(input.sortOrder) && Number(input.sortOrder) > 0 ? Number(input.sortOrder) : 100,
    is_required: input.isRequired !== false,
    is_active: true,
  }

  const query = existingLink?.id
    ? admin.from('renoapp_action_type_questions').update(payload).eq('id', existingLink.id)
    : admin.from('renoapp_action_type_questions').insert(payload)

  const { error } = await query.select('id').single()
  if (error) {
    throw new Error(error.message ?? 'Kunde inte spara fragekoppling.')
  }
}

export async function saveRenoAppAdminTerminology(input: {
  term: {
    id?: string | null
    groupId: string
    code: string
    label: string
    definition?: string | null
    termLevel?: 'ux' | 'technical' | 'classification' | 'status' | 'document_phase' | 'decision'
    inputKind?: 'user_visible' | 'system_internal' | 'system_generated'
    isLocked?: boolean
    isUserSelectable?: boolean
    isSystemGenerated?: boolean
    isActive?: boolean
    sortOrder?: number | null
    metadata?: unknown
  }
  aliases?: Array<{
    id?: string | null
    alias: string
    sortOrder?: number | null
    isActive?: boolean
  }>
  rules?: Array<{
    id?: string | null
    ruleKey: string
    label: string
    description?: string | null
    config?: unknown
    sortOrder?: number | null
    isActive?: boolean
  }>
}): Promise<RenoAppAdminTerminologyTerm> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const existingTerm = input.term.id
    ? await admin
        .from('renoapp_terminology_terms')
        .select(
          'id,group_id,code,label,definition,term_level,input_kind,is_locked,is_user_selectable,is_system_generated,is_active,sort_order,metadata'
        )
        .eq('id', input.term.id)
        .maybeSingle()
    : null

  if (existingTerm?.error) {
    throw new Error(existingTerm.error.message ?? 'Kunde inte lasa terminologiterm.')
  }

  const existingTermRow = (existingTerm?.data ?? null) as TerminologyTermRow | null
  const label = normalizeTerminologyText(input.term.label)
  const computedCode = normalizeTerminologyCode(input.term.code) ?? normalizeTerminologyCode(label) ?? null
  const code = existingTermRow?.is_locked ? existingTermRow.code : computedCode
  const definition = normalizeTerminologyText(input.term.definition)
  const groupId = normalizeText(input.term.groupId)
  const termLevel = normalizeTerminologyTermLevel(input.term.termLevel)
  const inputKind = normalizeTerminologyInputKind(input.term.inputKind)
  const isLocked = existingTermRow?.is_locked ?? input.term.isLocked !== false
  const isUserSelectable = input.term.isUserSelectable !== false
  const isSystemGenerated = input.term.isSystemGenerated === true
  const isActive = input.term.isActive !== false
  const sortOrder =
    Number.isFinite(input.term.sortOrder) && Number(input.term.sortOrder) > 0
      ? Number(input.term.sortOrder)
      : 100
  const metadata = normalizeJsonValue(input.term.metadata ?? {})

  assertRequiredText(groupId, 'TERMINOLOGY_GROUP_REQUIRED')
  assertRequiredText(code, 'TERMINOLOGY_CODE_REQUIRED')
  assertRequiredText(label, 'TERMINOLOGY_LABEL_REQUIRED')

  const payload = {
    group_id: groupId,
    code,
    label,
    definition,
    term_level: termLevel,
    input_kind: inputKind,
    is_locked: isLocked,
    is_user_selectable: isUserSelectable,
    is_system_generated: isSystemGenerated,
    is_active: isActive,
    sort_order: sortOrder,
    metadata,
  }

  const termQuery = input.term.id
    ? admin.from('renoapp_terminology_terms').update(payload).eq('id', input.term.id)
    : admin.from('renoapp_terminology_terms').insert(payload)

  const { data: savedTermData, error: savedTermError } = await termQuery
    .select(
      'id,group_id,code,label,definition,term_level,input_kind,is_locked,is_user_selectable,is_system_generated,is_active,sort_order,metadata'
    )
    .single()

  if (savedTermError || !savedTermData) {
    throw new Error(savedTermError?.message ?? 'Kunde inte spara terminologiterm.')
  }

  const savedTerm = savedTermData as TerminologyTermRow
  const termId = savedTerm.id

  const existingAliasesResult = await admin
    .from('renoapp_terminology_aliases')
    .select('id,term_id,alias,sort_order,is_active')
    .eq('term_id', termId)

  if (existingAliasesResult.error) {
    throw new Error(existingAliasesResult.error.message ?? 'Kunde inte lasa alias.')
  }

  const existingRulesResult = await admin
    .from('renoapp_terminology_rules')
    .select('id,term_id,rule_key,label,description,config,sort_order,is_active')
    .eq('term_id', termId)

  if (existingRulesResult.error) {
    throw new Error(existingRulesResult.error.message ?? 'Kunde inte lasa regler.')
  }

  const keptAliasIds = new Set<string>()
  const aliases = (input.aliases ?? []).filter((item) => normalizeText(item.alias))

  for (const aliasInput of aliases) {
    const alias = normalizeTerminologyText(aliasInput.alias)
    const aliasSortOrder =
      Number.isFinite(aliasInput.sortOrder) && Number(aliasInput.sortOrder) > 0
        ? Number(aliasInput.sortOrder)
        : 100

    if (!alias) continue

    const aliasPayload = {
      term_id: termId,
      alias,
      sort_order: aliasSortOrder,
      is_active: aliasInput.isActive !== false,
    }

    const aliasQuery = aliasInput.id
      ? admin.from('renoapp_terminology_aliases').update(aliasPayload).eq('id', aliasInput.id)
      : admin.from('renoapp_terminology_aliases').insert(aliasPayload)

    const { data: savedAliasData, error: savedAliasError } = await aliasQuery
      .select('id,term_id,alias,sort_order,is_active')
      .single()

    if (savedAliasError || !savedAliasData) {
      throw new Error(savedAliasError?.message ?? 'Kunde inte spara alias.')
    }

    keptAliasIds.add(String((savedAliasData as TerminologyAliasRow).id))
  }

  for (const existingAlias of (existingAliasesResult.data ?? []) as TerminologyAliasRow[]) {
    if (!keptAliasIds.has(existingAlias.id)) {
      const { error } = await admin.from('renoapp_terminology_aliases').delete().eq('id', existingAlias.id)
      if (error) {
        throw new Error(error.message ?? 'Kunde inte ta bort alias.')
      }
    }
  }

  const keptRuleIds = new Set<string>()
  const rules = (input.rules ?? []).filter(
    (item) => normalizeTerminologyCode(item.ruleKey) && normalizeText(item.label)
  )

  for (const ruleInput of rules) {
    const ruleKey = normalizeTerminologyCode(ruleInput.ruleKey)
    const ruleLabel = normalizeTerminologyText(ruleInput.label)
    const ruleDescription = normalizeTerminologyText(ruleInput.description)
    const ruleSortOrder =
      Number.isFinite(ruleInput.sortOrder) && Number(ruleInput.sortOrder) > 0
        ? Number(ruleInput.sortOrder)
        : 100

    if (!ruleKey || !ruleLabel) continue

    const rulePayload = {
      term_id: termId,
      rule_key: ruleKey,
      label: ruleLabel,
      description: ruleDescription,
      config: normalizeJsonValue(ruleInput.config ?? {}),
      sort_order: ruleSortOrder,
      is_active: ruleInput.isActive !== false,
    }

    const ruleQuery = ruleInput.id
      ? admin.from('renoapp_terminology_rules').update(rulePayload).eq('id', ruleInput.id)
      : admin.from('renoapp_terminology_rules').insert(rulePayload)

    const { data: savedRuleData, error: savedRuleError } = await ruleQuery
      .select('id,term_id,rule_key,label,description,config,sort_order,is_active')
      .single()

    if (savedRuleError || !savedRuleData) {
      throw new Error(savedRuleError?.message ?? 'Kunde inte spara regel.')
    }

    keptRuleIds.add(String((savedRuleData as TerminologyRuleRow).id))
  }

  for (const existingRule of (existingRulesResult.data ?? []) as TerminologyRuleRow[]) {
    if (!keptRuleIds.has(existingRule.id)) {
      const { error } = await admin.from('renoapp_terminology_rules').delete().eq('id', existingRule.id)
      if (error) {
        throw new Error(error.message ?? 'Kunde inte ta bort regel.')
      }
    }
  }

  const terminology = await listRenoAppAdminTerminology()
  const saved = terminology.terms.find((item) => item.id === termId)
  if (!saved) {
    throw new Error('Kunde inte lasa sparad terminologiterm.')
  }

  return saved
}

export async function deleteRenoAppAdminTerminologyTerm(id: string): Promise<void> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const { error } = await admin.from('renoapp_terminology_terms').delete().eq('id', id)
  if (error) {
    throw new Error(error.message ?? 'Kunde inte radera terminologiterm.')
  }
}

export async function saveRenoAppAdminActionType(input: {
  id?: string | null
  categoryId?: string | null
  key: string
  label: string
  description?: string | null
  riskLevel?: 'low' | 'medium' | 'high'
  contractorRequirement?:
    | 'none'
    | 'qualified_contractor'
    | 'authorized_electrician'
    | 'safe_water'
    | 'bkr_or_gvk'
    | 'structural_engineer'
  sortOrder?: number | null
  isActive?: boolean
}): Promise<RenoAppAdminActionType> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const key = normalizeText(input.key)?.toLowerCase() ?? null
  const label = normalizeText(input.label)
  const description = normalizeText(input.description)
  const categoryId = normalizeText(input.categoryId)
  const riskLevel = input.riskLevel === 'low' || input.riskLevel === 'high' ? input.riskLevel : 'medium'
  const contractorRequirement =
    input.contractorRequirement && input.contractorRequirement !== 'none'
      ? input.contractorRequirement
      : 'none'
  const sortOrder = Number.isFinite(input.sortOrder) && Number(input.sortOrder) > 0 ? Number(input.sortOrder) : 100
  const isActive = input.isActive !== false

  assertRequiredText(key, 'ACTION_TYPE_KEY_REQUIRED')
  assertRequiredText(label, 'ACTION_TYPE_LABEL_REQUIRED')

  const payload = {
    category_id: categoryId,
    key,
    label,
    description,
    risk_level: riskLevel,
    contractor_requirement: contractorRequirement,
    sort_order: sortOrder,
    is_active: isActive,
  }

  const query = input.id
    ? admin.from('renovation_action_types').update(payload).eq('id', input.id)
    : admin.from('renovation_action_types').insert(payload)

  const { data, error } = await query
    .select('id,category_id,key,label,description,risk_level,contractor_requirement,sort_order,is_active')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Kunde inte spara renoveringstyp.')
  }

  const row = data as ActionTypeRow
  return {
    id: row.id,
    categoryId: row.category_id,
    key: row.key,
    label: row.label,
    description: row.description ?? null,
    riskLevel: row.risk_level,
    contractorRequirement: row.contractor_requirement,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    requirementCount: 0,
    questionCount: 0,
    participantRoleCount: 0,
  }
}

export async function deleteRenoAppAdminActionType(id: string): Promise<void> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const { error } = await admin.from('renovation_action_types').delete().eq('id', id)
  if (error) {
    throw new Error(error.message ?? 'Kunde inte radera renoveringstyp.')
  }
}

export async function listRenoAppAdminRequirementConfig(): Promise<{
  categories?: RenoAppAdminActionCategory[]
  documentTypes: RenoAppAdminDocumentType[]
  actionTypes: RenoAppAdminRequirementGroup[]
}> {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const [actionTypeRows, documentTypeRows, requirementRows] = await Promise.all([
    admin
      .from('renovation_action_types')
      .select('id,category_id,key,label,description,risk_level,contractor_requirement,sort_order,is_active')
      .order('sort_order', { ascending: true }),
    admin
      .from('renovation_document_types')
      .select('id,key,label,description,review_guidance,default_phase,sort_order,is_active')
      .order('sort_order', { ascending: true }),
    admin
      .from('renovation_action_document_requirements')
      .select('id,brf_id,action_type_id,document_type_id,is_required,phase,note,sort_order')
      .is('brf_id', null)
      .order('sort_order', { ascending: true }),
  ])

  if (actionTypeRows.error) throw new Error(actionTypeRows.error.message ?? 'Kunde inte lÃ¤sa renoveringstyper.')
  if (documentTypeRows.error) throw new Error(documentTypeRows.error.message ?? 'Kunde inte lÃ¤sa dokumenttyper.')
  if (requirementRows.error) throw new Error(requirementRows.error.message ?? 'Kunde inte lÃ¤sa dokumentkrav.')

  const actionTypes = (actionTypeRows.data ?? []) as ActionTypeRow[]
  const documentTypes = (documentTypeRows.data ?? []) as DocumentTypeRow[]
  const requirements = (requirementRows.data ?? []) as RequirementRow[]

  const publicActionTypes = buildPublicActionTypes([], actionTypes, documentTypes, requirements)

  return {
    documentTypes: documentTypes.map((item) => ({
      id: item.id,
      key: item.key,
      label: item.label,
      description: item.description ?? null,
      reviewGuidance: item.review_guidance ?? null,
      defaultPhase: item.default_phase,
      sortOrder: item.sort_order,
      isActive: item.is_active,
    })),
    actionTypes: publicActionTypes.map((item) => ({
      actionType: {
        id: item.id,
        categoryId: actionTypes.find((actionType) => actionType.id === item.id)?.category_id ?? null,
        key: item.key,
        label: item.label,
        description: item.description ?? null,
        riskLevel: actionTypes.find((actionType) => actionType.id === item.id)?.risk_level ?? 'low',
        contractorRequirement:
          actionTypes.find((actionType) => actionType.id === item.id)?.contractor_requirement ?? 'none',
        sortOrder: item.sortOrder,
        isActive: actionTypes.find((actionType) => actionType.id === item.id)?.is_active ?? true,
        requirementCount: item.requirements.length,
        questionCount: 0,
        participantRoleCount: 0,
      },
      requirements: item.requirements.map((requirement) => ({
        id: requirement.id,
        documentTypeId: requirement.documentTypeId,
        documentKey: requirement.documentKey,
        documentLabel: requirement.documentLabel,
        documentDescription: requirement.documentDescription,
        isRequired: requirement.isRequired,
        phase: requirement.phase,
        note: requirement.note,
        sortOrder: requirement.sortOrder,
      })),
    })),
  }
}

export async function saveRenoAppAdminRequirement(input: {
  actionTypeId: string
  documentTypeId: string
  isEnabled: boolean
  isRequired?: boolean
  note?: string | null
  sortOrder?: number | null
}) {
  await requireRenoAppAdminProfile()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  if (!input.actionTypeId || !input.documentTypeId) {
    throw new Error('REQUIREMENT_TARGET_REQUIRED')
  }

  const note = normalizeText(input.note)
  const sortOrder = Number.isFinite(input.sortOrder) && Number(input.sortOrder) > 0 ? Number(input.sortOrder) : 100
  const { data: documentTypeRow, error: documentTypeError } = await admin
    .from('renovation_document_types')
    .select('id,default_phase')
    .eq('id', input.documentTypeId)
    .single()

  if (documentTypeError || !documentTypeRow) {
    throw new Error(documentTypeError?.message ?? 'Kunde inte lÃ¤sa underlagstyp.')
  }

  const defaultPhase =
    (documentTypeRow as Pick<DocumentTypeRow, 'default_phase'>).default_phase ?? 'before_required'

  const { data: existingRequirement, error: existingRequirementError } = await admin
    .from('renovation_action_document_requirements')
    .select('id')
    .is('brf_id', null)
    .eq('action_type_id', input.actionTypeId)
    .eq('document_type_id', input.documentTypeId)
    .maybeSingle()

  if (existingRequirementError) {
    throw new Error(existingRequirementError.message ?? 'Kunde inte lÃ¤sa dokumentkrav.')
  }

  if (!input.isEnabled) {
    if (existingRequirement) {
      const { error } = await admin
        .from('renovation_action_document_requirements')
        .delete()
        .eq('id', String((existingRequirement as Record<string, unknown>).id ?? ''))

      if (error) {
        throw new Error(error.message ?? 'Kunde inte ta bort dokumentkrav.')
      }
    }

    return { saved: true as const }
  }

  const payload = {
    brf_id: null,
    action_type_id: input.actionTypeId,
    document_type_id: input.documentTypeId,
    is_required: input.isRequired !== false,
    phase: defaultPhase,
    note,
    sort_order: sortOrder,
  }

  if (existingRequirement) {
    const { error } = await admin
      .from('renovation_action_document_requirements')
      .update(payload)
      .eq('id', String((existingRequirement as Record<string, unknown>).id ?? ''))

    if (error) {
      throw new Error(error.message ?? 'Kunde inte uppdatera dokumentkrav.')
    }
  } else {
    const { error } = await admin.from('renovation_action_document_requirements').insert(payload)

    if (error) {
      throw new Error(error.message ?? 'Kunde inte skapa dokumentkrav.')
    }
  }

  return { saved: true as const }
}

export async function createRenoAppUserInvite(input: {
  brfId: string
  fullName: string
  email: string
  origin: string
}): Promise<CreateRenoAppUserInviteResult> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  if (context.accessibleBrfIds && !context.accessibleBrfIds.includes(input.brfId)) {
    throw new Error('BRF_NOT_FOUND')
  }

  const fullName = normalizeText(input.fullName)
  const email = normalizeEmail(input.email)
  const origin = normalizeText(input.origin) ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushub.se'

  if (!fullName) throw new Error('FULL_NAME_REQUIRED')
  assertValidEmail(email, 'EMAIL_INVALID')

  const { data: brfData, error: brfError } = await admin
    .from('brf_associations')
    .select('id,name,slug')
    .eq('id', input.brfId)
    .maybeSingle()

  if (brfError) {
    throw new Error(brfError.message ?? 'Kunde inte lÃ¤sa BRF.')
  }
  if (!brfData) {
    throw new Error('BRF_NOT_FOUND')
  }

  const { data: existingMemberRows, error: existingMemberError } = await admin
    .from('brf_members')
    .select('profile_id')
    .eq('brf_id', input.brfId)
    .eq('is_active', true)

  if (existingMemberError) {
    throw new Error(existingMemberError.message ?? 'Kunde inte lÃ¤sa anvÃ¤ndare.')
  }

  const profileIds = Array.from(
    new Set(((existingMemberRows ?? []) as Array<Record<string, unknown>>).map((row) => String(row.profile_id ?? '')).filter(Boolean))
  )
  const profilesResult =
    profileIds.length > 0
      ? await admin.from('profiles').select('id,email').in('id', profileIds)
      : { data: [], error: null }

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message ?? 'Kunde inte lÃ¤sa anvÃ¤ndarprofiler.')
  }

  const activeEmails = new Set(
    ((profilesResult.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => normalizeEmail(row.email))
      .filter((value): value is string => Boolean(value))
  )
  if (email && activeEmails.has(email)) {
    throw new Error('EMAIL_ALREADY_MEMBER')
  }

  const { data: existingInvite, error: existingInviteError } = await admin
    .from('brf_member_invites')
    .select('id')
    .eq('brf_id', input.brfId)
    .eq('email', email)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .maybeSingle()

  if (existingInviteError) {
    throw new Error(existingInviteError.message ?? 'Kunde inte lÃ¤sa befintliga invites.')
  }
  if (existingInvite) {
    throw new Error('EMAIL_ALREADY_INVITED')
  }

  const token = makeToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000).toISOString()

  const { data: inviteData, error: insertError } = await admin
    .from('brf_member_invites')
    .insert({
      brf_id: input.brfId,
      email,
      full_name: fullName,
      role: 'board',
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: context.userId,
    })
    .select('id')
    .single()

  if (insertError || !inviteData) {
    throw new Error(insertError?.message ?? 'Kunde inte skapa invite.')
  }

  const inviteUrl = buildAbsoluteUrl(origin, `/renoapp/invite/${token}`)
  const mailFrom = getMailFromAddress()
  let emailSent = false
  let emailError: string | null = null

  if (mailFrom) {
    try {
      const subject = `Inbjudan till RenoApp fÃ¶r ${String(brfData.name ?? 'er BRF')}`
      await sendAssignmentEmail({
        to: email as string,
        from: mailFrom,
        subject,
        html: buildRenoAppEmailHtml({
          origin,
          preheader: subject,
          bodyHtml: `
            <p>Hej ${escapeHtml(fullName as string)},</p>
            <p>Du har blivit inbjuden till RenoApp fÃ¶r <strong>${escapeHtml(String(brfData.name ?? 'er BRF'))}</strong>.</p>
            <p>Ã–ppna lÃ¤nken nedan fÃ¶r att aktivera ditt konto:</p>
            <p><a href="${inviteUrl}">${inviteUrl}</a></p>
            <p>LÃ¤nken gÃ¤ller till ${new Date(expiresAt).toLocaleString('sv-SE')}.</p>
          `,
        }),
        text: [
          `Hej ${fullName},`,
          `Du har blivit inbjuden till RenoApp fÃ¶r ${String(brfData.name ?? 'er BRF')}.`,
          `Ã–ppna lÃ¤nken fÃ¶r att aktivera ditt konto: ${inviteUrl}`,
          `LÃ¤nken gÃ¤ller till ${new Date(expiresAt).toLocaleString('sv-SE')}.`,
          '',
          'Med vÃ¤nlig hÃ¤lsning,',
          'RenoApp-teamet pÃ¥ HusHub',
        ].join('\n'),
      })
      emailSent = true
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Mejlutskick misslyckades.'
    }
  } else {
    emailError = 'ASSIGNMENTS_MAIL_FROM saknas. Invite skapades men inget mejl skickades.'
  }

  return {
    invite: {
      id: String(inviteData.id ?? ''),
      email: email as string,
      fullName,
      expiresAt,
      inviteUrl,
      emailSent,
      emailError,
    },
  }
}

export async function revokeRenoAppUserInvite(inviteId: string) {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const { data: inviteData, error: inviteError } = await admin
    .from('brf_member_invites')
    .select('id,brf_id,accepted_at,revoked_at')
    .eq('id', inviteId)
    .maybeSingle()

  if (inviteError) {
    throw new Error(inviteError.message ?? 'Kunde inte lÃ¤sa invite.')
  }
  if (!inviteData) {
    throw new Error('INVITE_NOT_FOUND')
  }

  const brfId = String((inviteData as Record<string, unknown>).brf_id ?? '')
  if (context.accessibleBrfIds && !context.accessibleBrfIds.includes(brfId)) {
    throw new Error('INVITE_NOT_FOUND')
  }
  if ((inviteData as Record<string, unknown>).accepted_at) {
    throw new Error('INVITE_ALREADY_ACCEPTED')
  }
  if ((inviteData as Record<string, unknown>).revoked_at) {
    throw new Error('INVITE_ALREADY_REVOKED')
  }

  const { error: updateError } = await admin
    .from('brf_member_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)

  if (updateError) {
    throw new Error(updateError.message ?? 'Kunde inte Ã¥terkalla invite.')
  }

  return { revoked: true as const }
}

export async function removeRenoAppUserMember(input: { brfId: string; profileId: string }) {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  if (context.accessibleBrfIds && !context.accessibleBrfIds.includes(input.brfId)) {
    throw new Error('BRF_NOT_FOUND')
  }

  if (input.profileId === context.userId) {
    throw new Error('CANNOT_REMOVE_SELF')
  }

  const { data: memberData, error: memberError } = await admin
    .from('brf_members')
    .select('id,brf_id,profile_id,is_active')
    .eq('brf_id', input.brfId)
    .eq('profile_id', input.profileId)
    .maybeSingle()

  if (memberError) {
    throw new Error(memberError.message ?? 'Kunde inte lÃ¤sa BRF-anvÃ¤ndare.')
  }
  if (!memberData || !(memberData as Record<string, unknown>).is_active) {
    throw new Error('MEMBER_NOT_FOUND')
  }

  const { data: activeMembers, error: activeMembersError } = await admin
    .from('brf_members')
    .select('profile_id')
    .eq('brf_id', input.brfId)
    .eq('is_active', true)

  if (activeMembersError) {
    throw new Error(activeMembersError.message ?? 'Kunde inte lÃ¤sa aktiva BRF-anvÃ¤ndare.')
  }

  const activeCount = ((activeMembers ?? []) as Array<Record<string, unknown>>).length
  if (activeCount <= 1) {
    throw new Error('CANNOT_REMOVE_LAST_MEMBER')
  }

  const { error: updateError } = await admin
    .from('brf_members')
    .update({ is_active: false })
    .eq('brf_id', input.brfId)
    .eq('profile_id', input.profileId)

  if (updateError) {
    throw new Error(updateError.message ?? 'Kunde inte ta bort anvÃ¤ndaren.')
  }

  return { removed: true as const }
}

export async function getRenoAppCaseDetail(caseId: string): Promise<RenoAppCaseDetail | null> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const { data: caseData, error: caseError } = await admin
    .from('renovation_cases')
    .select(
      'id,brf_id,unit_id,applicant_contact_id,action_type_id,case_number,title,description,status,risk_level,blocked_at,blocked_reason,submitted_at,updated_at'
    )
    .eq('id', caseId)
    .maybeSingle()

  if (caseError) {
    throw new Error(caseError.message ?? 'Kunde inte lÃ¤sa RenoApp-Ã¤rende.')
  }

  if (!caseData) {
    return null
  }

  const caseRow = caseData as CaseRow
  if (context.accessibleBrfIds && !context.accessibleBrfIds.includes(caseRow.brf_id)) {
    throw new Error('CASE_NOT_FOUND')
  }

  const [
    brfResult,
    contactResult,
    unitResult,
    checksResult,
    docsResult,
    decisionsResult,
    linksResult,
    actionResult,
    caseActionTypesResult,
    caseQuestionAnswersResult,
    questionConfig,
    participantRows,
    participantRoleRows,
    participantRoleConfig,
    reviewFlagRows,
    messages,
  ] =
    await Promise.all([
      admin.from('brf_associations').select('id,name,slug').eq('id', caseRow.brf_id).maybeSingle(),
      caseRow.applicant_contact_id
        ? admin.from('contacts').select('id,name,email,phone').eq('id', caseRow.applicant_contact_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      caseRow.unit_id
        ? admin
            .from('brf_units')
            .select('id,unit_number_internal,unit_number_skatteverket,status')
            .eq('id', caseRow.unit_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin
        .from('renovation_case_checks')
        .select(
          'affects_structure,affects_plumbing,affects_ventilation,affects_electrical,affects_wet_room,affects_surface_only'
        )
        .eq('case_id', caseId)
        .maybeSingle(),
      admin
        .from('renovation_case_documents')
        .select('id,document_type_id,participant_role_id,document_scope,file_name,status,uploaded_at,note')
        .eq('case_id', caseId)
        .order('uploaded_at', { ascending: false }),
      admin
        .from('renovation_case_decisions')
        .select('id,decision,conditions,reason,decided_at')
        .eq('case_id', caseId)
        .order('decided_at', { ascending: false }),
      admin
        .from('case_access_links')
        .select('id,email,scope,expires_at,revoked_at,last_used_at')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false }),
      caseRow.action_type_id
        ? admin.from('renovation_action_types').select('id,key,label').eq('id', caseRow.action_type_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      listCaseActionTypes(admin, [caseId]),
      listCaseQuestionAnswers(admin, [caseId]),
      listActiveApplyQuestions(admin),
      listCaseParticipants(admin, [caseId]),
      listActiveParticipantRoles(admin),
      admin
        .from('renoapp_action_type_participant_roles')
        .select('id,action_type_id,participant_role_id,is_required,sort_order,is_active')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      listActiveReviewFlags(admin),
      listCaseMessages(admin, caseId),
    ])

  if (brfResult.error) throw new Error(brfResult.error.message ?? 'Kunde inte lÃ¤sa BRF.')
  if (contactResult.error) throw new Error(contactResult.error.message ?? 'Kunde inte lÃ¤sa kontakt.')
  if (unitResult.error) throw new Error(unitResult.error.message ?? 'Kunde inte lÃ¤sa lÃ¤genhet.')
  if (checksResult.error) throw new Error(checksResult.error.message ?? 'Kunde inte lÃ¤sa Ã¤rendechecks.')
  if (docsResult.error) throw new Error(docsResult.error.message ?? 'Kunde inte lÃ¤sa dokument.')
  if (decisionsResult.error) throw new Error(decisionsResult.error.message ?? 'Kunde inte lÃ¤sa beslut.')
  if (linksResult.error) throw new Error(linksResult.error.message ?? 'Kunde inte lÃ¤sa access links.')
  if (actionResult.error) throw new Error(actionResult.error.message ?? 'Kunde inte lÃ¤sa Ã¥tgÃ¤rdstyp.')
  if (participantRoleConfig.error) {
    throw new Error(participantRoleConfig.error.message ?? 'Kunde inte lÃ¤sa deltagarroller fÃ¶r Ã¥tgÃ¤rdstyp.')
  }

  const currentContactsResult =
    caseRow.unit_id
      ? await admin
          .from('unit_contacts')
          .select('contact_id,verification_status,relationship_type')
          .eq('unit_id', caseRow.unit_id)
          .eq('is_current', true)
      : { data: [], error: null }

  if (currentContactsResult.error) {
    throw new Error(currentContactsResult.error.message ?? 'Kunde inte lÃ¤sa kontaktkopplingar.')
  }

  const currentContactRows = (currentContactsResult.data ?? []) as Array<Record<string, unknown>>
  const caseActionTypeIds = Array.from(
    new Set([
      ...((caseActionTypesResult ?? []) as CaseActionTypeRow[]).map((row) => row.action_type_id),
      ...(caseRow.action_type_id ? [caseRow.action_type_id] : []),
    ])
  )
  const selectedActionTypes = await loadActiveActionTypesByIds(admin, caseActionTypeIds)
  const selectedActionTypeIds = new Set(selectedActionTypes.map((item) => item.id))
  const currentContactIds = Array.from(
    new Set(currentContactRows.map((row) => String(row.contact_id ?? '')).filter(Boolean))
  )
  const documentTypeIds = Array.from(
    new Set(
      ((docsResult.data ?? []) as Array<Record<string, unknown>>)
        .map((row) => String(row.document_type_id ?? ''))
        .filter(Boolean)
    )
  )

  const [currentContactsLookup, documentTypesLookup, requirements] = await Promise.all([
    currentContactIds.length > 0
      ? admin.from('contacts').select('id,name,email').in('id', currentContactIds)
      : Promise.resolve({ data: [], error: null }),
    documentTypeIds.length > 0
      ? admin.from('renovation_document_types').select('id,label').in('id', documentTypeIds)
      : Promise.resolve({ data: [], error: null }),
    selectedActionTypeIds.size > 0 ? listRequirements(admin, caseRow.brf_id) : Promise.resolve([] as RequirementRow[]),
  ])

  if (currentContactsLookup.error) {
    throw new Error(currentContactsLookup.error.message ?? 'Kunde inte lÃ¤sa kontaktdata.')
  }
  if (documentTypesLookup.error) {
    throw new Error(documentTypesLookup.error.message ?? 'Kunde inte lÃ¤sa dokumenttyper.')
  }

  const contactMap = new Map(
    ((currentContactsLookup.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        id: String(row.id ?? ''),
        name: (row.name as string | null | undefined) ?? null,
        email: (row.email as string | null | undefined) ?? null,
      },
    ])
  )
  const documentTypeMap = new Map(
    ((documentTypesLookup.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      (row.label as string | null | undefined) ?? null,
    ])
  )

  const requiredDocumentTypes = selectedActionTypeIds.size > 0 ? await listActiveDocumentTypes(admin) : []
  const requiredDocumentTypeMap = new Map(requiredDocumentTypes.map((item) => [item.id, item]))
  const requirementMap = new Map<string, RequirementRow>()
  for (const requirement of requirements) {
    const key = `${requirement.action_type_id}:${requirement.document_type_id}`
    requirementMap.set(key, requirement)
  }

  const requirementItems: PublicRequirement[] = selectedActionTypeIds.size > 0
    ? Array.from(requirementMap.values())
        .filter((item) => selectedActionTypeIds.has(item.action_type_id))
        .map((item) => {
          const documentType = requiredDocumentTypeMap.get(item.document_type_id)
          return {
            id: item.id,
            documentTypeId: item.document_type_id,
            documentKey: documentType?.key ?? 'unknown',
            documentLabel: documentType?.label ?? 'OkÃ¤nd dokumenttyp',
            documentDescription: documentType?.description ?? null,
            isRequired: item.is_required,
            note: item.note,
            sortOrder: item.sort_order,
          }
        })
        .sort((left, right) => left.sortOrder - right.sortOrder)
    : []

  const reviewFlags = buildCaseReviewFlags({
    selectedActionTypes,
    requirements,
    questionConfig,
    questionAnswerRows: caseQuestionAnswersResult ?? [],
    reviewFlags: reviewFlagRows,
    documentTypes: requiredDocumentTypes,
    documents: ((docsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      documentTypeId: (row.document_type_id as string | null | undefined) ?? null,
      status: String(row.status ?? ''),
    })),
  })
  const underlag = buildCaseUnderlagItems({
    selectedActionTypes,
    requirements,
    questionConfig,
    questionAnswerRows: caseQuestionAnswersResult ?? [],
    documentTypes: requiredDocumentTypes,
    documents: ((docsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      documentTypeId: (row.document_type_id as string | null | undefined) ?? null,
      participantRoleId: (row.participant_role_id as string | null | undefined) ?? null,
      documentScope: ((row.document_scope as 'general' | 'participant_insurance' | null | undefined) ?? 'general'),
      status: String(row.status ?? ''),
    })),
    participantRows: participantRows ?? [],
    participantRoles: participantRoleRows,
    actionTypeParticipantRoles: (participantRoleConfig.data ?? []) as ActionTypeParticipantRoleRow[],
  })

  return {
    id: caseRow.id,
    caseNumber: caseRow.case_number,
    title: caseRow.title,
    description: caseRow.description,
    status: caseRow.status,
    riskLevel: caseRow.risk_level,
    submittedAt: caseRow.submitted_at,
    updatedAt: caseRow.updated_at,
    blockedAt: caseRow.blocked_at,
    blockedReason: caseRow.blocked_reason,
    brf: {
      id: String(brfResult.data?.id ?? caseRow.brf_id),
      name: (brfResult.data?.name as string | null | undefined) ?? null,
      slug: (brfResult.data?.slug as string | null | undefined) ?? null,
    },
    actionType: {
      id: (actionResult.data?.id as string | null | undefined) ?? null,
      key: (actionResult.data?.key as string | null | undefined) ?? null,
      label: (actionResult.data?.label as string | null | undefined) ?? null,
    },
    actionTypes: selectedActionTypes
      .slice()
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((actionType) => ({
        id: actionType.id,
        key: actionType.key,
        label: actionType.label,
      })),
    applicant: {
      id: (contactResult.data?.id as string | null | undefined) ?? null,
      name: (contactResult.data?.name as string | null | undefined) ?? null,
      email: (contactResult.data?.email as string | null | undefined) ?? null,
      phone: (contactResult.data?.phone as string | null | undefined) ?? null,
    },
    unit: {
      id: (unitResult.data?.id as string | null | undefined) ?? null,
      unitNumberInternal: (unitResult.data?.unit_number_internal as string | null | undefined) ?? null,
      unitNumberSkatteverket: (unitResult.data?.unit_number_skatteverket as string | null | undefined) ?? null,
      status: (unitResult.data?.status as string | null | undefined) ?? null,
    },
    checks: checksResult.data
      ? {
          affectsStructure: Boolean(checksResult.data.affects_structure),
          affectsPlumbing: Boolean(checksResult.data.affects_plumbing),
          affectsVentilation: Boolean(checksResult.data.affects_ventilation),
          affectsElectrical: Boolean(checksResult.data.affects_electrical),
          affectsWetRoom: Boolean(checksResult.data.affects_wet_room),
          affectsSurfaceOnly: Boolean(checksResult.data.affects_surface_only),
        }
      : null,
    currentContacts: currentContactRows.map((row) => {
      const contact = contactMap.get(String(row.contact_id ?? '')) ?? { id: String(row.contact_id ?? ''), name: null, email: null }
      return {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        verificationStatus: String(row.verification_status ?? ''),
        relationshipType: String(row.relationship_type ?? ''),
      }
    }),
    documents: ((docsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      documentTypeId: (row.document_type_id as string | null | undefined) ?? null,
      documentTypeLabel: documentTypeMap.get(String(row.document_type_id ?? '')) ?? null,
      fileName: (row.file_name as string | null | undefined) ?? null,
      status: String(row.status ?? ''),
      uploadedAt: String(row.uploaded_at ?? ''),
      note: (row.note as string | null | undefined) ?? null,
    })),
    underlag,
    requirements: requirementItems,
    decisions: ((decisionsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      decision: String(row.decision ?? ''),
      conditions: (row.conditions as string | null | undefined) ?? null,
      reason: (row.reason as string | null | undefined) ?? null,
      decidedAt: String(row.decided_at ?? ''),
    })),
    accessLinks: ((linksResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      email: String(row.email ?? ''),
      scope: String(row.scope ?? ''),
      expiresAt: String(row.expires_at ?? ''),
      revokedAt: (row.revoked_at as string | null | undefined) ?? null,
      lastUsedAt: (row.last_used_at as string | null | undefined) ?? null,
    })),
    reviewFlags,
    messages,
  }
}

export async function updateRenoAppCaseStatus(
  caseId: string,
  input: UpdateRenoAppCaseStatusInput
): Promise<RenoAppCaseDetail> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const allowedStatuses = new Set(['review', 'need_info', 'approved', 'conditional', 'rejected'])
  const decisionStatuses = new Set(['approved', 'conditional', 'rejected'])

  if (!allowedStatuses.has(input.status)) {
    throw new Error('INVALID_CASE_STATUS')
  }

  const reason = normalizeText(input.reason)
  const conditions = normalizeText(input.conditions)

  if (input.status === 'need_info' && !reason) {
    throw new Error('NEED_INFO_MESSAGE_REQUIRED')
  }

  if (input.status === 'rejected' && !reason) {
    throw new Error('DECISION_REASON_REQUIRED')
  }

  if (input.status === 'conditional' && !conditions) {
    throw new Error('DECISION_CONDITIONS_REQUIRED')
  }

  const { data: caseData, error: caseError } = await admin
    .from('renovation_cases')
    .select('id,brf_id,status,case_number,title,applicant_contact_id')
    .eq('id', caseId)
    .maybeSingle()

  if (caseError) {
    throw new Error(caseError.message ?? 'Kunde inte lÃ¤sa RenoApp-Ã¤rende.')
  }

  if (!caseData) {
    throw new Error('CASE_NOT_FOUND')
  }

  const brfId = String(caseData.brf_id ?? '')
  const currentStatus = String(caseData.status ?? '')
  if (context.accessibleBrfIds && !context.accessibleBrfIds.includes(brfId)) {
    throw new Error('CASE_NOT_FOUND')
  }

  if (currentStatus === 'draft') {
    throw new Error('DRAFT_CASE_LOCKED')
  }

  const { error: updateError } = await admin.from('renovation_cases').update({ status: input.status }).eq('id', caseId)

  if (updateError) {
    throw new Error(updateError.message ?? 'Kunde inte uppdatera RenoApp-Ã¤rende.')
  }

  if (input.status === 'need_info') {
    await insertCaseMessage({
      admin,
      caseId,
      type: 'request_for_info',
      authorRole: 'board',
      authorProfileId: context.profile.id,
      message: reason,
      metadata: {
        previousStatus: currentStatus,
        nextStatus: input.status,
      },
    })

    const [brfResult, contactResult] = await Promise.all([
      admin.from('brf_associations').select('name,slug,email').eq('id', brfId).maybeSingle(),
      caseData.applicant_contact_id
        ? admin
            .from('contacts')
            .select('id,name,email')
            .eq('id', String(caseData.applicant_contact_id))
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    if (brfResult.error) {
      throw new Error(brfResult.error.message ?? 'Kunde inte lÃ¤sa BRF.')
    }
    if (contactResult.error) {
      throw new Error(contactResult.error.message ?? 'Kunde inte lÃ¤sa kontakt.')
    }

    const applicantEmail = (contactResult.data?.email as string | null | undefined) ?? null
    const applicantName = (contactResult.data?.name as string | null | undefined) ?? 'hej'
    const brfName = String(brfResult.data?.name ?? 'din BRF')
    const brfSlug = String(brfResult.data?.slug ?? '')

    if (input.requestOrigin && brfSlug) {
      const token = await ensureReusableCaseAccessToken({
        admin,
        caseId,
        email: applicantEmail,
      })

      const resumeUrl = buildAbsoluteUrl(input.requestOrigin, `/renoapp/brf/${brfSlug}/apply?draft=${token}`)
      const mailFrom = getMailFromAddress()

      if (mailFrom && applicantEmail) {
        try {
          const caseTitle = String(caseData.title ?? '').trim()

          await sendAssignmentEmail({
            to: applicantEmail,
            from: mailFrom,
            replyTo: (brfResult.data?.email as string | null | undefined) ?? null,
            subject: `RenoApp: ditt Ã¤rende ${String(caseData.case_number ?? '')} behÃ¶ver kompletteras`,
            html: buildRenoAppEmailHtml({
              origin: input.requestOrigin,
              preheader: `Ditt Ã¤rende ${String(caseData.case_number ?? '')} behÃ¶ver kompletteras`,
              bodyHtml: `
                <div style="height:16px;"></div>
                <p>Hej ${escapeHtml(applicantName)},</p>
                <p>Styrelsen behÃ¶ver komplettering i ditt Ã¤rende fÃ¶r <strong>${escapeHtml(brfName)}</strong>.</p>
                <p>Ã„rendenummer: <strong>${escapeHtml(String(caseData.case_number ?? ''))}</strong></p>
                ${caseTitle ? `<p>Renovering: <strong>${escapeHtml(caseTitle)}</strong></p>` : ''}
                <p><strong>BegÃ¤ran om komplettering:</strong></p>
                <p>${escapeHtml(reason ?? '')}</p>
                <p>Ã–ppna din ansÃ¶kningssida hÃ¤r:</p>
                <p><a href="${resumeUrl}">${resumeUrl}</a></p>
              `,
            }),
            text: [
              `Hej ${applicantName},`,
              `Styrelsen behÃ¶ver komplettering i ditt Ã¤rende fÃ¶r ${brfName}.`,
              `Ã„rendenummer: ${String(caseData.case_number ?? '')}`,
              ...(caseTitle ? [`Renovering: ${caseTitle}`] : []),
              ``,
              `BegÃ¤ran om komplettering:`,
              reason ?? '',
              ``,
              `Ã–ppna din ansÃ¶kningssida hÃ¤r: ${resumeUrl}`,
            ].join('\n'),
          })
        } catch {
          // Status och Ã¤rendehistorik ska sparas Ã¤ven om mejlet inte gÃ¥r ivÃ¤g.
        }
      }
    }
  }

  if (decisionStatuses.has(input.status)) {
    const { error: insertError } = await admin.from('renovation_case_decisions').insert({
      case_id: caseId,
      decision: input.status,
      conditions,
      reason,
      decided_by: context.profile.id,
    })

    if (insertError) {
      throw new Error(insertError.message ?? 'Kunde inte spara beslut.')
    }

    const decisionMessage =
      input.status === 'conditional'
        ? conditions
        : reason ?? `Status uppdaterad till ${input.status}.`

    await insertCaseMessage({
      admin,
      caseId,
      type: 'decision',
      authorRole: 'board',
      authorProfileId: context.profile.id,
      message: decisionMessage,
      metadata: {
        decision: input.status,
        previousStatus: currentStatus,
        nextStatus: input.status,
      },
    })
  } else if (input.status === 'review') {
    await insertCaseMessage({
      admin,
      caseId,
      type: 'status_change',
      authorRole: 'board',
      authorProfileId: context.profile.id,
      message: 'Ã„rendet Ã¥ter sattes till granskning.',
      metadata: {
        previousStatus: currentStatus,
        nextStatus: input.status,
      },
    })
  }

  const updatedCase = await getRenoAppCaseDetail(caseId)
  if (!updatedCase) {
    throw new Error('CASE_NOT_FOUND')
  }

  return updatedCase
}
