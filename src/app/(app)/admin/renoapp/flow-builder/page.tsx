'use client'

import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import RenoAppAiFlowDrawer from '@/components/renoapp/admin/RenoAppAiFlowDrawer'

type ActionTypeItem = {
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
  impliesStructure: boolean
  impliesPlumbing: boolean
  impliesVentilation: boolean
  impliesElectrical: boolean
  impliesWetRoom: boolean
  impliesSurfaceOnly: boolean
  sortOrder: number
  isActive: boolean
  requirementCount: number
  questionCount: number
  participantRoleCount: number
}

type RequirementItem = {
  id: string
  documentTypeId: string
  documentLabel: string
  sortOrder: number
  isRequired: boolean
  note: string | null
}

type ActionTypeGroup = {
  actionType: ActionTypeItem
  requirements: RequirementItem[]
}

type ActionQuestionItem = {
  id: string
  questionId: string
  questionLabel: string
  isRequired: boolean
  sortOrder: number
}

type ActionTypeQuestionGroup = {
  actionType: ActionTypeItem
  questions: ActionQuestionItem[]
}

type ActionParticipantRoleItem = {
  id: string
  participantRoleId: string
  participantRoleLabel: string
  roleKind: 'contractor' | 'consultant'
  isRequired: boolean
  sortOrder: number
}

type ActionTypeParticipantRoleGroup = {
  actionType: ActionTypeItem
  participantRoles: ActionParticipantRoleItem[]
}

type QuestionOptionTriggerItem = {
  id: string
  triggerType: 'question' | 'document' | 'participant_role' | 'review_flag'
  questionId: string | null
  documentTypeId: string | null
  participantRoleId: string | null
  reviewFlagId: string | null
  sortOrder: number
  isActive: boolean
}

type QuestionOptionItem = {
  id: string
  key: string
  label: string
  description: string | null
  sortOrder: number
  isActive: boolean
  metadata: unknown
  triggers: QuestionOptionTriggerItem[]
}

type QuestionItem = {
  id: string
  key: string
  label: string
  helpText: string | null
  responseType: 'single_select' | 'multi_select' | 'boolean'
  sortOrder: number
  isActive: boolean
  metadata: unknown
  options: QuestionOptionItem[]
}

type DocumentTypeItem = {
  id: string
  key: string
  label: string
  description: string | null
  reviewGuidance: string | null
  defaultPhase: 'before_required' | 'during_execution' | 'after_completion'
  sortOrder: number
  isActive: boolean
}

type ParticipantRoleItem = {
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

type ReviewFlagItem = {
  id: string
  key: string
  label: string
  description: string | null
  severity: 'info' | 'warning' | 'high'
  category: string | null
  sortOrder: number
  isActive: boolean
}

type ReviewFlagLinkItem = {
  id: string
  reviewFlagId: string
  actionTypeId: string | null
  documentTypeId: string | null
  participantRoleId: string | null
  sortOrder: number
  isActive: boolean
}

type FlowNodeTone = 'stone' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet'

type FlowNodeRef =
  | { type: 'actionType'; actionTypeId: string }
  | { type: 'rootQuestion'; actionTypeId: string; questionId: string }
  | { type: 'rootRequirement'; actionTypeId: string; documentTypeId: string }
  | { type: 'rootParticipant'; actionTypeId: string; participantRoleId: string }
  | { type: 'question'; questionId: string }
  | { type: 'option'; questionId: string; optionId: string }
  | { type: 'optionQuestionTrigger'; questionId: string; optionId: string; targetQuestionId: string }
  | { type: 'optionDocumentTrigger'; questionId: string; optionId: string; targetDocumentTypeId: string }
  | { type: 'optionParticipantTrigger'; questionId: string; optionId: string; targetParticipantRoleId: string }
  | { type: 'optionReviewFlagTrigger'; questionId: string; optionId: string; targetReviewFlagId: string }
  | { type: 'actionTypeReviewFlag'; actionTypeId: string; targetReviewFlagId: string }
  | { type: 'documentReviewFlag'; documentTypeId: string; targetReviewFlagId: string }
  | { type: 'participantReviewFlag'; participantRoleId: string; targetReviewFlagId: string }
  | { type: 'status' }

type FlowNode = {
  id: string
  kind: 'root' | 'question' | 'option' | 'document' | 'participant' | 'flag' | 'status'
  title: string
  badges: string[]
  tone: FlowNodeTone
  children: FlowNode[]
  ref: FlowNodeRef
}

type AddType = 'question' | 'option' | 'document' | 'participant' | 'flag'
type ModalMode = 'summary' | 'edit' | 'add'
type AddSaveBehavior = 'save' | 'saveAndNew'

type ActionTypeDraft = {
  id?: string
  key: string
  label: string
  description: string
  riskLevel: ActionTypeItem['riskLevel']
  contractorRequirement: ActionTypeItem['contractorRequirement']
  impliesStructure: boolean
  impliesPlumbing: boolean
  impliesVentilation: boolean
  impliesElectrical: boolean
  impliesWetRoom: boolean
  impliesSurfaceOnly: boolean
  sortOrder: string
  isActive: boolean
}

type QuestionDraft = {
  id?: string
  key: string
  label: string
  helpText: string
  responseType: QuestionItem['responseType']
  sortOrder: string
  isActive: boolean
}

type OptionDraft = {
  id?: string
  key: string
  label: string
  description: string
  sortOrder: string
  isActive: boolean
}

type DocumentDraft = {
  id?: string
  key: string
  label: string
  description: string
  reviewGuidance: string
  defaultPhase: DocumentTypeItem['defaultPhase']
  sortOrder: string
  isActive: boolean
}

type ParticipantDraft = {
  id?: string
  key: string
  label: string
  description: string
  reviewGuidance: string
  roleKind: ParticipantRoleItem['roleKind']
  verificationInstructions: string
  verificationUrl: string
  insuranceRequired: boolean
  requiresCompanyName: boolean
  requiresOrgNumber: boolean
  requiresContactName: boolean
  requiresEmail: boolean
  requiresPhone: boolean
  requiresCertification: boolean
  sortOrder: string
  isActive: boolean
}

type ReviewFlagDraft = {
  id?: string
  key: string
  label: string
  description: string
  severity: ReviewFlagItem['severity']
  category: string
  sortOrder: string
  isActive: boolean
}

type RequirementLinkDraft = {
  isRequired: boolean
  note: string
  sortOrder: string
}

type QuestionLinkDraft = {
  isRequired: boolean
  sortOrder: string
}

type ParticipantLinkDraft = {
  isRequired: boolean
  sortOrder: string
}

const EMPTY_ACTION_TYPE_DRAFT: ActionTypeDraft = {
  key: '',
  label: '',
  description: '',
  riskLevel: 'medium',
  contractorRequirement: 'none',
  impliesStructure: false,
  impliesPlumbing: false,
  impliesVentilation: false,
  impliesElectrical: false,
  impliesWetRoom: false,
  impliesSurfaceOnly: false,
  sortOrder: '100',
  isActive: true,
}

const EMPTY_QUESTION_DRAFT: QuestionDraft = {
  key: '',
  label: '',
  helpText: '',
  responseType: 'single_select',
  sortOrder: '100',
  isActive: true,
}

const EMPTY_DOCUMENT_DRAFT: DocumentDraft = {
  key: '',
  label: '',
  description: '',
  reviewGuidance: '',
  defaultPhase: 'before_required',
  sortOrder: '100',
  isActive: true,
}

const EMPTY_OPTION_DRAFT: OptionDraft = {
  key: '',
  label: '',
  description: '',
  sortOrder: '100',
  isActive: true,
}

const EMPTY_PARTICIPANT_DRAFT: ParticipantDraft = {
  key: '',
  label: '',
  description: '',
  reviewGuidance: '',
  roleKind: 'contractor',
  verificationInstructions: '',
  verificationUrl: '',
  insuranceRequired: false,
  requiresCompanyName: true,
  requiresOrgNumber: true,
  requiresContactName: true,
  requiresEmail: true,
  requiresPhone: true,
  requiresCertification: false,
  sortOrder: '100',
  isActive: true,
}

const EMPTY_REVIEW_FLAG_DRAFT: ReviewFlagDraft = {
  key: '',
  label: '',
  description: '',
  severity: 'warning',
  category: 'general',
  sortOrder: '100',
  isActive: true,
}

const EMPTY_REQUIREMENT_LINK_DRAFT: RequirementLinkDraft = {
  isRequired: true,
  note: '',
  sortOrder: '100',
}

const EMPTY_QUESTION_LINK_DRAFT: QuestionLinkDraft = {
  isRequired: true,
  sortOrder: '100',
}

const EMPTY_PARTICIPANT_LINK_DRAFT: ParticipantLinkDraft = {
  isRequired: true,
  sortOrder: '100',
}

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

async function readJson<T>(response: Response) {
  return (await response.json().catch(() => ({}))) as T
}

function slugifyKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function slugifyUnderscoreKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
}

function generatedActionTypeKey(draft: ActionTypeDraft) {
  return draft.id && draft.key ? draft.key : slugifyKey(draft.label)
}

function generatedQuestionKey(draft: QuestionDraft) {
  return draft.id && draft.key ? draft.key : slugifyKey(draft.label)
}

function generatedOptionKey(draft: OptionDraft) {
  return draft.id && draft.key ? draft.key : slugifyKey(draft.label)
}

function generatedDocumentKey(draft: DocumentDraft) {
  return draft.id && draft.key ? draft.key : slugifyKey(draft.label)
}

function generatedParticipantKey(draft: ParticipantDraft) {
  return draft.id && draft.key ? draft.key : slugifyUnderscoreKey(draft.label)
}

function generatedReviewFlagKey(draft: ReviewFlagDraft) {
  return draft.id && draft.key ? draft.key : slugifyUnderscoreKey(draft.label)
}

function labelForResponseType(value: QuestionItem['responseType']) {
  if (value === 'multi_select') return 'Flera val'
  if (value === 'boolean') return 'Ja / nej'
  return 'Ett val'
}

function labelForPhase(value: DocumentTypeItem['defaultPhase']) {
  if (value === 'during_execution') return 'Under'
  if (value === 'after_completion') return 'Efter'
  return 'Före'
}

function labelForSeverity(value: ReviewFlagItem['severity']) {
  if (value === 'high') return 'Hög risk'
  if (value === 'warning') return 'Varning'
  return 'Info'
}

function labelForRiskLevel(value: ActionTypeItem['riskLevel']) {
  if (value === 'high') return 'Hög'
  if (value === 'low') return 'Låg'
  return 'Medel'
}

function labelForContractorRequirement(value: ActionTypeItem['contractorRequirement']) {
  if (value === 'qualified_contractor') return 'Kvalificerad entreprenör'
  if (value === 'authorized_electrician') return 'Registrerat elinstallationsföretag'
  if (value === 'safe_water') return 'Säker Vatten'
  if (value === 'bkr_or_gvk') return 'BKR eller GVK'
  if (value === 'structural_engineer') return 'Konstruktör'
  return 'Inget generellt krav'
}

function labelForNodeKind(value: FlowNode['kind']) {
  if (value === 'root') return 'Renoveringstyp'
  if (value === 'question') return 'Fråga'
  if (value === 'option') return 'Svar'
  if (value === 'document') return 'Underlag'
  if (value === 'participant') return 'Medverkande'
  if (value === 'flag') return 'Flagga'
  return 'Status'
}

function toneClasses(tone: FlowNodeTone) {
  if (tone === 'sky') return 'border-sky-200 bg-sky-50 text-sky-900'
  if (tone === 'emerald') return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (tone === 'rose') return 'border-rose-200 bg-rose-50 text-rose-900'
  if (tone === 'violet') return 'border-violet-200 bg-violet-50 text-violet-900'
  return 'border-stone-300 bg-white text-stone-900'
}

function collectExpandableNodeIds(nodes: FlowNode[]) {
  const ids: string[] = []
  const visit = (node: FlowNode) => {
    if (node.children.length > 0) ids.push(node.id)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return ids
}

function questionToRequestPayload(question: QuestionItem) {
  return {
    question: {
      id: question.id,
      key: question.key,
      label: question.label,
      helpText: question.helpText,
      responseType: question.responseType,
      sortOrder: question.sortOrder,
      isActive: question.isActive,
      metadata: question.metadata ?? {},
    },
    options: question.options.map((option) => ({
      id: option.id,
      key: option.key,
      label: option.label,
      description: option.description,
      sortOrder: option.sortOrder,
      isActive: option.isActive,
      metadata: option.metadata ?? {},
      triggers: option.triggers.map((trigger) => ({
        triggerType: trigger.triggerType,
        questionId: trigger.questionId,
        documentTypeId: trigger.documentTypeId,
        participantRoleId: trigger.participantRoleId,
        reviewFlagId: trigger.reviewFlagId,
        sortOrder: trigger.sortOrder,
        isActive: trigger.isActive,
      })),
    })),
  }
}

function createDuplicateQuestionDraft(question: QuestionItem): QuestionDraft {
  return {
    key: '',
    label: `${question.label} (kopia)`,
    helpText: question.helpText ?? '',
    responseType: question.responseType,
    sortOrder: String(question.sortOrder + 10),
    isActive: question.isActive,
  }
}

function createQuestionOptionDraft(overrides: Partial<OptionDraft> = {}): OptionDraft {
  return {
    key: '',
    label: 'Alternativ 1',
    description: '',
    sortOrder: '10',
    isActive: true,
    ...overrides,
  }
}

function createQuestionOptionDraftsFromQuestion(question: QuestionItem): OptionDraft[] {
  return question.options.map((option) =>
    createQuestionOptionDraft({
      key: '',
      label: option.label,
      description: option.description ?? '',
      sortOrder: String(option.sortOrder),
      isActive: option.isActive,
    })
  )
}

function FlowNodeCard({
  node,
  expanded,
  onToggle,
  onOpen,
}: {
  node: FlowNode
  expanded: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const expandable = node.children.length > 0

  return (
    <div className={cn('w-[158px] rounded-md border px-2.5 py-2 shadow-sm', toneClasses(node.tone))}>
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 text-left">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">{labelForNodeKind(node.kind)}</div>
          <div className="mt-1 text-[13px] font-semibold leading-4">{node.title}</div>
        </button>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onOpen} className="rounded border border-current/15 bg-white/80 px-1.5 py-0.5 text-[9px] font-semibold">
            Öppna
          </button>
          {expandable ? (
            <button type="button" onClick={onToggle} className="rounded border border-current/15 bg-white/80 px-1.5 py-0.5 text-[9px] font-semibold" aria-expanded={expanded}>
              {expanded ? '-' : '+'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {node.badges.map((badge) => (
          <span key={badge} className="rounded-full border border-current/15 bg-white/80 px-1.5 py-0.5 text-[9px] font-semibold">
            {badge}
          </span>
        ))}
      </div>
    </div>
  )
}

function HorizontalBranch({
  node,
  expandedNodeIds,
  onToggle,
  onOpen,
}: {
  node: FlowNode
  expandedNodeIds: string[]
  onToggle: (id: string) => void
  onOpen: (node: FlowNode) => void
}) {
  const expanded = expandedNodeIds.includes(node.id)

  return (
    <div className="flex items-start gap-3">
      <FlowNodeCard node={node} expanded={expanded} onToggle={() => onToggle(node.id)} onOpen={() => onOpen(node)} />
      {node.children.length > 0 && expanded ? (
        <div className="mt-5 flex min-w-0 items-start">
          <div className="mr-3 mt-5 h-px w-5 bg-stone-300" />
          <div className="relative space-y-3 border-l border-stone-300 pl-4">
            {node.children.map((child) => (
              <div key={child.id} className="relative">
                <div className="absolute left-[-16px] top-5 h-px w-4 bg-stone-300" />
                <HorizontalBranch node={child} expandedNodeIds={expandedNodeIds} onToggle={onToggle} onOpen={onOpen} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ModalField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{label}</span>
      {children}
    </label>
  )
}

function OverviewCard({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{label}</div>
      <div className="mt-1 font-medium text-stone-900">{value}</div>
    </div>
  )
}

function OverviewText({
  label,
  value,
  fallback = 'Ej angivet.',
}: {
  label: string
  value: string | null | undefined
  fallback?: string
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-stone-800">{value?.trim() ? value : fallback}</div>
    </div>
  )
}

function HelpField({
  name,
  children,
}: {
  name: string
  children: ReactNode
}) {
  return (
    <div className="border-t border-stone-200 py-2 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{name}</dt>
      <dd className="mt-1 text-sm leading-6 text-stone-700">{children}</dd>
    </div>
  )
}

function HelpGroup({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="rounded-md border border-stone-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
      <dl className="mt-3">{children}</dl>
    </section>
  )
}

function FlowBuilderHelpSection() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 text-sm leading-6 text-stone-700 xl:grid-cols-3">
        <div>
          <h3 className="font-semibold text-stone-900">Grundstruktur</h3>
          <p className="mt-1">
            En renoveringstyp är startpunkten för ett ärendeflöde. Den kan ha startfrågor, underlag som alltid ska begäras in och medverkande som alltid ska anges.
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-stone-900">Villkorade delar</h3>
          <p className="mt-1">
            Frågor har svarsalternativ. Ett svarsalternativ kan i sin tur lägga till följdfrågor, extra underlag, medverkande eller granskningsflaggor.
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-stone-900">Objekt och kopplingar</h3>
          <p className="mt-1">
            Ett objekt kan återanvändas i flera flöden. Ta bort från flödet tar bara bort kopplingen, medan radera överallt tar bort själva objektet.
          </p>
        </div>
      </div>

      <div className="rounded-md border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">
        <h3 className="font-semibold text-stone-900">Fält som inte fylls i manuellt</h3>
        <p className="mt-1">
          Intern nyckel visas för spårbarhet och teknisk stabilitet. Den skapas automatiskt från namnet när nya objekt skapas och kan inte ändras efter att objektet har skapats.
        </p>
      </div>

      <div className="rounded-md border border-violet-200 bg-violet-50 p-4 text-sm leading-6 text-violet-950">
        <h3 className="font-semibold">Bygg/granska med AI</h3>
        <p className="mt-1">
          AI-assistenten skapar ett källhänvisat förslag med diff och testfall. Förslaget ändrar inte flödet automatiskt; kontrollera alltid källornas tillämplighet och föreningens egna regler.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <HelpGroup title="Renoveringstyp">
          <HelpField name="Visningsnamn">Namnet administratörer ser i flödesbyggaren och som beskriver vilken typ av åtgärd flödet gäller.</HelpField>
          <HelpField name="Beskrivning">Intern förklaring av när renoveringstypen ska användas och vad den omfattar.</HelpField>
          <HelpField name="Risknivå">Övergripande riskklassning som används i ansökan och granskningen.</HelpField>
          <HelpField name="Entreprenörskrav">Anger om åtgärden normalt kräver en viss typ av företag eller sakkunnig.</HelpField>
          <HelpField name="Teknisk klassning">Markerar vilka teknikområden åtgärden berör. Endast ytskikt kan inte kombineras med övriga teknikområden.</HelpField>
          <HelpField name="Sortering">Styr ordningen i listor. Lägre tal visas tidigare.</HelpField>
          <HelpField name="Aktiv renoveringstyp">Avgör om renoveringstypen ska vara tillgänglig för användning.</HelpField>
        </HelpGroup>

        <HelpGroup title="Fråga">
          <HelpField name="Visningsnamn">Själva frågan som användaren eller administratören ska förstå och besvara.</HelpField>
          <HelpField name="Hjälptext">Förklarar vad frågan betyder, vad som ska vägas in och hur svaret bör tolkas.</HelpField>
          <HelpField name="Svarstyp">Bestämmer om frågan tillåter ett val, flera val eller ja/nej-svar.</HelpField>
          <HelpField name="Sortering">Styr frågans ordning bland andra frågor på samma nivå.</HelpField>
          <HelpField name="Aktiv fråga">Avgör om frågan kan användas i flöden och visas som valbar.</HelpField>
          <HelpField name="Obligatorisk i denna renoveringstyp">Anger om frågan måste besvaras när den ligger direkt under en renoveringstyp.</HelpField>
          <HelpField name="Kopplingens sortering">Styr ordningen för frågans koppling i just den valda renoveringstypen.</HelpField>
        </HelpGroup>

        <HelpGroup title="Svarsalternativ">
          <HelpField name="Svarstext">Texten på valet som användaren kan välja för en fråga.</HelpField>
          <HelpField name="Beskrivning">Förklarar valet när det behövs mer kontext än själva svarstexten.</HelpField>
          <HelpField name="Sortering">Styr ordningen mellan svarsalternativen i frågan.</HelpField>
          <HelpField name="Aktivt svarsalternativ">Avgör om valet ska visas och kunna trigga kopplade delar.</HelpField>
        </HelpGroup>

        <HelpGroup title="Underlag">
          <HelpField name="Visningsnamn">Namnet på dokumentet eller uppgiften som ska lämnas in.</HelpField>
          <HelpField name="Hjälptext till sökande">Text som förklarar för den sökande vad som ska bifogas eller beskrivas.</HelpField>
          <HelpField name="Granskningsstöd">Intern vägledning för handläggaren vid kontroll av underlaget.</HelpField>
          <HelpField name="Standardfas">Anger om underlaget normalt hör hemma före, under eller efter utförandet.</HelpField>
          <HelpField name="Sortering">Styr ordningen bland underlag av samma typ eller nivå.</HelpField>
          <HelpField name="Aktiv underlagstyp">Avgör om underlaget kan användas i nya flödeskopplingar.</HelpField>
          <HelpField name="Obligatoriskt i denna renoveringstyp">Anger om underlaget krävs när det ligger direkt under renoveringstypen.</HelpField>
          <HelpField name="Kopplingens sortering">Styr ordningen för underlaget i just den valda renoveringstypen.</HelpField>
          <HelpField name="Notering">Intern notering för kopplingen, till exempel särskilda villkor för varför underlaget behövs här.</HelpField>
        </HelpGroup>

        <HelpGroup title="Medverkande">
          <HelpField name="Visningsnamn">Namnet på rollen som ska anges, till exempel entreprenör eller konsult.</HelpField>
          <HelpField name="Hjälptext till sökande">Förklarar för den sökande vilken part som ska anges och vilka uppgifter som behövs.</HelpField>
          <HelpField name="Granskningsstöd">Intern vägledning för hur rollen ska kontrolleras vid granskning.</HelpField>
          <HelpField name="Typ">Markerar om rollen är entreprenör eller konsult.</HelpField>
          <HelpField name="Verifieringsinstruktion">Beskriver hur administratören ska verifiera rollen eller dess behörighet.</HelpField>
          <HelpField name="Verifieringslänk">Länk till extern kontroll, register eller instruktion som stödjer verifieringen.</HelpField>
          <HelpField name="Sortering">Styr ordningen mellan medverkande roller.</HelpField>
          <HelpField name="Försäkringsbevis krävs">Anger om rollen måste styrka försäkring.</HelpField>
          <HelpField name="Kräver företagsnamn">Anger om företagsnamn ska samlas in.</HelpField>
          <HelpField name="Kräver org.nr">Anger om organisationsnummer ska samlas in.</HelpField>
          <HelpField name="Kräver kontaktperson">Anger om kontaktperson ska samlas in.</HelpField>
          <HelpField name="Kräver e-post">Anger om e-postadress ska samlas in.</HelpField>
          <HelpField name="Kräver telefon">Anger om telefonnummer ska samlas in.</HelpField>
          <HelpField name="Kräver certifiering">Anger om certifiering ska samlas in eller kontrolleras.</HelpField>
          <HelpField name="Aktiv">Avgör om rollen kan användas i nya flödeskopplingar.</HelpField>
          <HelpField name="Obligatorisk i denna renoveringstyp">Anger om rollen måste anges när den ligger direkt under renoveringstypen.</HelpField>
          <HelpField name="Kopplingens sortering">Styr ordningen för rollen i just den valda renoveringstypen.</HelpField>
        </HelpGroup>

        <HelpGroup title="Granskningsflagga">
          <HelpField name="Visningsnamn">Namnet på risken, kontrollpunkten eller uppmärksammandet som ska visas för granskaren.</HelpField>
          <HelpField name="Allvar">Anger om flaggan är information, varning eller hög risk.</HelpField>
          <HelpField name="Kategori">Grupperar flaggor så de blir enklare att hitta, filtrera och förstå.</HelpField>
          <HelpField name="Sortering">Styr ordningen mellan flaggor när flera visas samtidigt.</HelpField>
          <HelpField name="Beskrivning">Förklarar vad flaggan betyder och vad granskaren bör vara uppmärksam på.</HelpField>
          <HelpField name="Aktiv flagga">Avgör om flaggan kan användas i nya flödeskopplingar.</HelpField>
        </HelpGroup>
      </div>
    </div>
  )
}

export default function RenoAppFlowBuilderPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false)

  const [actionTypes, setActionTypes] = useState<ActionTypeItem[]>([])
  const [questionItems, setQuestionItems] = useState<QuestionItem[]>([])
  const [documentTypes, setDocumentTypes] = useState<DocumentTypeItem[]>([])
  const [participantRoles, setParticipantRoles] = useState<ParticipantRoleItem[]>([])
  const [reviewFlags, setReviewFlags] = useState<ReviewFlagItem[]>([])
  const [reviewFlagLinks, setReviewFlagLinks] = useState<ReviewFlagLinkItem[]>([])
  const [requirementGroups, setRequirementGroups] = useState<ActionTypeGroup[]>([])
  const [questionGroups, setQuestionGroups] = useState<ActionTypeQuestionGroup[]>([])
  const [participantGroups, setParticipantGroups] = useState<ActionTypeParticipantRoleGroup[]>([])

  const [selectedActionTypeId, setSelectedActionTypeId] = useState<string | null>(null)
  const [expandedNodeIds, setExpandedNodeIds] = useState<string[]>([])

  const [activeNode, setActiveNode] = useState<FlowNode | null>(null)
  const [modalMode, setModalMode] = useState<ModalMode>('summary')
  const [modalError, setModalError] = useState<string | null>(null)
  const [modalSaving, setModalSaving] = useState(false)
  const [addType, setAddType] = useState<AddType | null>(null)
  const [addMode, setAddMode] = useState<'existing' | 'new'>('existing')
  const [existingTargetId, setExistingTargetId] = useState('')
  const [addPreviewQuestionId, setAddPreviewQuestionId] = useState<string | null>(null)
  const [duplicateQuestionSourceId, setDuplicateQuestionSourceId] = useState<string | null>(null)
  const [flagTargetOptionId, setFlagTargetOptionId] = useState('')

  const [actionTypeDraft, setActionTypeDraft] = useState<ActionTypeDraft>(EMPTY_ACTION_TYPE_DRAFT)
  const [questionDraft, setQuestionDraft] = useState<QuestionDraft>(EMPTY_QUESTION_DRAFT)
  const [optionDraft, setOptionDraft] = useState<OptionDraft>(EMPTY_OPTION_DRAFT)
  const [questionOptionDrafts, setQuestionOptionDrafts] = useState<OptionDraft[]>([
    createQuestionOptionDraft(),
  ])
  const [documentDraft, setDocumentDraft] = useState<DocumentDraft>(EMPTY_DOCUMENT_DRAFT)
  const [participantDraft, setParticipantDraft] = useState<ParticipantDraft>(EMPTY_PARTICIPANT_DRAFT)
  const [reviewFlagDraft, setReviewFlagDraft] = useState<ReviewFlagDraft>(EMPTY_REVIEW_FLAG_DRAFT)
  const [requirementLinkDraft, setRequirementLinkDraft] = useState<RequirementLinkDraft>(EMPTY_REQUIREMENT_LINK_DRAFT)
  const [questionLinkDraft, setQuestionLinkDraft] = useState<QuestionLinkDraft>(EMPTY_QUESTION_LINK_DRAFT)
  const [participantLinkDraft, setParticipantLinkDraft] = useState<ParticipantLinkDraft>(EMPTY_PARTICIPANT_LINK_DRAFT)

  const loadData = async (preferredActionTypeId?: string | null) => {
    setLoading(true)
    setError(null)

    try {
      const [
        actionTypesResponse,
        questionsResponse,
        documentTypesResponse,
        participantRolesResponse,
        reviewFlagsResponse,
        requirementsResponse,
        questionConfigResponse,
        participantConfigResponse,
        reviewFlagLinksResponse,
      ] = await Promise.all([
        fetch('/api/renoapp/admin/action-types', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/questions', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/document-types', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/participants', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/review-flags', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/requirements', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/action-type-questions', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/action-type-participants', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/review-flag-links', { cache: 'no-store' }),
      ])

      const [
        actionTypesPayload,
        questionsPayload,
        documentTypesPayload,
        participantRolesPayload,
        reviewFlagsPayload,
        requirementsPayload,
        questionConfigPayload,
        participantConfigPayload,
        reviewFlagLinksPayload,
      ] = await Promise.all([
        readJson<{ items?: ActionTypeItem[]; error?: string }>(actionTypesResponse),
        readJson<{ items?: QuestionItem[]; error?: string }>(questionsResponse),
        readJson<{ items?: DocumentTypeItem[]; error?: string }>(documentTypesResponse),
        readJson<{ items?: ParticipantRoleItem[]; error?: string }>(participantRolesResponse),
        readJson<{ items?: ReviewFlagItem[]; error?: string }>(reviewFlagsResponse),
        readJson<{ actionTypes?: ActionTypeGroup[]; error?: string }>(requirementsResponse),
        readJson<{ actionTypes?: ActionTypeQuestionGroup[]; error?: string }>(questionConfigResponse),
        readJson<{ actionTypes?: ActionTypeParticipantRoleGroup[]; error?: string }>(participantConfigResponse),
        readJson<{ items?: ReviewFlagLinkItem[]; error?: string }>(reviewFlagLinksResponse),
      ])

      if (!actionTypesResponse.ok) throw new Error(actionTypesPayload.error ?? 'Kunde inte läsa renoveringstyper.')
      if (!questionsResponse.ok) throw new Error(questionsPayload.error ?? 'Kunde inte läsa frågor.')
      if (!documentTypesResponse.ok) throw new Error(documentTypesPayload.error ?? 'Kunde inte läsa underlagstyper.')
      if (!participantRolesResponse.ok) throw new Error(participantRolesPayload.error ?? 'Kunde inte läsa medverkande.')
      if (!reviewFlagsResponse.ok) throw new Error(reviewFlagsPayload.error ?? 'Kunde inte läsa flaggor.')
      if (!requirementsResponse.ok) throw new Error(requirementsPayload.error ?? 'Kunde inte läsa dokumentkopplingar.')
      if (!questionConfigResponse.ok) throw new Error(questionConfigPayload.error ?? 'Kunde inte läsa frågekopplingar.')
      if (!participantConfigResponse.ok) throw new Error(participantConfigPayload.error ?? 'Kunde inte läsa medverkandekopplingar.')
      if (!reviewFlagLinksResponse.ok) throw new Error(reviewFlagLinksPayload.error ?? 'Kunde inte läsa flaggkopplingar.')

      const nextActionTypes = [...(actionTypesPayload.items ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
      )

      setActionTypes(nextActionTypes)
      setQuestionItems([...(questionsPayload.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv')))
      setDocumentTypes([...(documentTypesPayload.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv')))
      setParticipantRoles([...(participantRolesPayload.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv')))
      setReviewFlags([...(reviewFlagsPayload.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv')))
      setRequirementGroups(requirementsPayload.actionTypes ?? [])
      setQuestionGroups(questionConfigPayload.actionTypes ?? [])
      setParticipantGroups(participantConfigPayload.actionTypes ?? [])
      setReviewFlagLinks(reviewFlagLinksPayload.items ?? [])

      setSelectedActionTypeId((current) => {
        const candidate = preferredActionTypeId ?? current
        if (candidate && nextActionTypes.some((item) => item.id === candidate)) return candidate
        return nextActionTypes[0]?.id ?? null
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte läsa flödesvisaren.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    setExpandedNodeIds([])
  }, [selectedActionTypeId])

  const visibleActionTypes = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return actionTypes.filter((item) => {
      if (!normalized) return true
      return [item.label, item.key, item.description ?? ''].join(' ').toLowerCase().includes(normalized)
    })
  }, [actionTypes, query])

  const selectedAction = useMemo(
    () => actionTypes.find((item) => item.id === selectedActionTypeId) ?? null,
    [actionTypes, selectedActionTypeId]
  )

  const questionMap = useMemo(() => new Map(questionItems.map((item) => [item.id, item])), [questionItems])
  const documentTypeMap = useMemo(() => new Map(documentTypes.map((item) => [item.id, item])), [documentTypes])
  const participantRoleMap = useMemo(() => new Map(participantRoles.map((item) => [item.id, item])), [participantRoles])
  const reviewFlagMap = useMemo(() => new Map(reviewFlags.map((item) => [item.id, item])), [reviewFlags])
  const linkableQuestions = useMemo(() => questionItems.filter((item) => item.isActive), [questionItems])
  const linkableDocumentTypes = useMemo(() => documentTypes.filter((item) => item.isActive), [documentTypes])
  const linkableParticipantRoles = useMemo(() => participantRoles.filter((item) => item.isActive), [participantRoles])
  const linkableReviewFlags = useMemo(() => reviewFlags.filter((item) => item.isActive), [reviewFlags])

  const rootRequirements = useMemo(() => {
    const group = requirementGroups.find((item) => item.actionType.id === selectedActionTypeId)
    return [...(group?.requirements ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.documentLabel.localeCompare(b.documentLabel, 'sv'))
  }, [requirementGroups, selectedActionTypeId])

  const rootQuestions = useMemo(() => {
    const group = questionGroups.find((item) => item.actionType.id === selectedActionTypeId)
    return [...(group?.questions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.questionLabel.localeCompare(b.questionLabel, 'sv'))
  }, [questionGroups, selectedActionTypeId])

  const rootParticipants = useMemo(() => {
    const group = participantGroups.find((item) => item.actionType.id === selectedActionTypeId)
    return [...(group?.participantRoles ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.participantRoleLabel.localeCompare(b.participantRoleLabel, 'sv'))
  }, [participantGroups, selectedActionTypeId])

  const flowRootChildren = useMemo(() => {
    const buildReviewFlagNode = (
      flagId: string,
      ref:
        | { type: 'actionTypeReviewFlag'; actionTypeId: string; targetReviewFlagId: string }
        | { type: 'documentReviewFlag'; documentTypeId: string; targetReviewFlagId: string }
        | { type: 'participantReviewFlag'; participantRoleId: string; targetReviewFlagId: string },
      idPrefix: string
    ): FlowNode => {
      const flag = reviewFlagMap.get(flagId)
      return {
        id: `${idPrefix}:flag:${flagId}`,
        kind: 'flag',
        title: flag?.label ?? 'Flagga saknas',
        badges: [flag ? labelForSeverity(flag.severity) : 'Fel'],
        tone: (flag?.severity === 'high' ? 'rose' : flag?.severity === 'warning' ? 'amber' : flag ? 'violet' : 'rose') as FlowNodeTone,
        children: [],
        ref,
      }
    }

    const flagChildrenForActionType = (actionTypeId: string) =>
      reviewFlagLinks
        .filter((link) => link.isActive && link.actionTypeId === actionTypeId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((link) =>
          buildReviewFlagNode(
            link.reviewFlagId,
            { type: 'actionTypeReviewFlag', actionTypeId, targetReviewFlagId: link.reviewFlagId },
            `action:${actionTypeId}`
          )
        )

    const flagChildrenForDocumentType = (documentTypeId: string) =>
      reviewFlagLinks
        .filter((link) => link.isActive && link.documentTypeId === documentTypeId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((link) =>
          buildReviewFlagNode(
            link.reviewFlagId,
            { type: 'documentReviewFlag', documentTypeId, targetReviewFlagId: link.reviewFlagId },
            `document:${documentTypeId}`
          )
        )

    const flagChildrenForParticipantRole = (participantRoleId: string) =>
      reviewFlagLinks
        .filter((link) => link.isActive && link.participantRoleId === participantRoleId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((link) =>
          buildReviewFlagNode(
            link.reviewFlagId,
            { type: 'participantReviewFlag', participantRoleId, targetReviewFlagId: link.reviewFlagId },
            `participant:${participantRoleId}`
          )
        )

    const buildQuestionNode = (questionId: string, ancestry: string[], rootLink?: ActionQuestionItem): FlowNode => {
      const question = questionMap.get(questionId)
      if (!question) {
        return { id: `missing:${questionId}`, kind: 'status', title: 'Frågan saknas', badges: ['Fel'], tone: 'rose', children: [], ref: { type: 'status' } }
      }
      if (ancestry.includes(questionId)) {
        return { id: `cycle:${questionId}:${ancestry.join('>')}`, kind: 'status', title: 'Cirkelskydd', badges: ['Stopp'], tone: 'amber', children: [], ref: { type: 'status' } }
      }

      return {
        id: `question:${ancestry.join('>') || 'root'}:${question.id}`,
        kind: 'question',
        title: question.label,
        badges: [ancestry.length === 0 ? 'Startfråga' : 'Följdfråga', labelForResponseType(question.responseType), ...(rootLink ? [rootLink.isRequired ? 'Obligatorisk' : 'Valfri'] : [])],
        tone: 'stone',
        ref: ancestry.length === 0 && rootLink ? ({ type: 'rootQuestion', actionTypeId: selectedActionTypeId ?? '', questionId: question.id } as const) : ({ type: 'question', questionId: question.id } as const),
        children: [...question.options]
          .filter((option) => option.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv'))
          .map((option) => {
            const activeTriggers = [...option.triggers].filter((trigger) => trigger.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
            return {
              id: `option:${question.id}:${option.id}`,
              kind: 'option' as const,
              title: option.label,
              badges: activeTriggers.length > 0 ? [`${activeTriggers.length} kopplingar`] : ['Ingen koppling'],
              tone: 'stone' as const,
              ref: { type: 'option', questionId: question.id, optionId: option.id },
              children: [
                ...activeTriggers
                  .filter((trigger) => trigger.triggerType === 'question' && trigger.questionId)
                  .map((trigger) => ({
                    ...buildQuestionNode(trigger.questionId as string, [...ancestry, questionId]),
                    ref: {
                      type: 'optionQuestionTrigger' as const,
                      questionId: question.id,
                      optionId: option.id,
                      targetQuestionId: trigger.questionId as string,
                    },
                  })),
                ...activeTriggers
                  .filter((trigger) => trigger.triggerType === 'document' && trigger.documentTypeId)
                  .map((trigger) => {
                    const doc = documentTypeMap.get(trigger.documentTypeId as string)
                    return {
                      id: `document:${option.id}:${trigger.documentTypeId}`,
                      kind: 'document' as const,
                      title: doc?.label ?? 'Underlag saknas',
                      badges: [doc ? labelForPhase(doc.defaultPhase) : 'Fel'],
                      tone: (doc ? 'sky' : 'rose') as FlowNodeTone,
                      children: flagChildrenForDocumentType(trigger.documentTypeId as string),
                      ref: {
                        type: 'optionDocumentTrigger' as const,
                        questionId: question.id,
                        optionId: option.id,
                        targetDocumentTypeId: trigger.documentTypeId as string,
                      },
                    }
                  }),
                ...activeTriggers
                  .filter((trigger) => trigger.triggerType === 'participant_role' && trigger.participantRoleId)
                  .map((trigger) => {
                    const role = participantRoleMap.get(trigger.participantRoleId as string)
                    return {
                      id: `participant:${option.id}:${trigger.participantRoleId}`,
                      kind: 'participant' as const,
                      title: role?.label ?? 'Medverkande saknas',
                      badges: [role?.roleKind === 'consultant' ? 'Konsult' : 'Entreprenör'],
                      tone: (role?.roleKind === 'consultant' ? 'amber' : role ? 'emerald' : 'rose') as FlowNodeTone,
                      children: flagChildrenForParticipantRole(trigger.participantRoleId as string),
                      ref: {
                        type: 'optionParticipantTrigger' as const,
                        questionId: question.id,
                        optionId: option.id,
                        targetParticipantRoleId: trigger.participantRoleId as string,
                      },
                    }
                  }),
                ...activeTriggers
                  .filter((trigger) => trigger.triggerType === 'review_flag' && trigger.reviewFlagId)
                  .map((trigger) => {
                    const flag = reviewFlagMap.get(trigger.reviewFlagId as string)
                    return {
                      id: `flag:${option.id}:${trigger.reviewFlagId}`,
                      kind: 'flag' as const,
                      title: flag?.label ?? 'Flagga saknas',
                      badges: [flag ? labelForSeverity(flag.severity) : 'Fel'],
                      tone: (flag?.severity === 'high' ? 'rose' : flag?.severity === 'warning' ? 'amber' : flag ? 'violet' : 'rose') as FlowNodeTone,
                      children: [],
                      ref: {
                        type: 'optionReviewFlagTrigger' as const,
                        questionId: question.id,
                        optionId: option.id,
                        targetReviewFlagId: trigger.reviewFlagId as string,
                      },
                    }
                  }),
              ],
            }
          }),
      }
    }

    if (!selectedActionTypeId) return []

    return [
      ...flagChildrenForActionType(selectedActionTypeId),
      ...rootQuestions.map((item) => buildQuestionNode(item.questionId, [], item)),
      ...rootRequirements.map((item) => {
        const doc = documentTypeMap.get(item.documentTypeId)
        return { id: `root-document:${item.documentTypeId}`, kind: 'document' as const, title: item.documentLabel, badges: [doc ? labelForPhase(doc.defaultPhase) : 'Okänd fas', item.isRequired ? 'Obligatoriskt' : 'Valfritt'], tone: 'sky' as const, children: flagChildrenForDocumentType(item.documentTypeId), ref: { type: 'rootRequirement' as const, actionTypeId: selectedActionTypeId, documentTypeId: item.documentTypeId } }
      }),
      ...rootParticipants.map((item) => {
        const role = participantRoleMap.get(item.participantRoleId)
        return { id: `root-participant:${item.participantRoleId}`, kind: 'participant' as const, title: item.participantRoleLabel, badges: [role?.roleKind === 'consultant' ? 'Konsult' : 'Entreprenör', item.isRequired ? 'Obligatorisk' : 'Valfri'], tone: (role?.roleKind === 'consultant' ? 'amber' : 'emerald') as FlowNodeTone, children: flagChildrenForParticipantRole(item.participantRoleId), ref: { type: 'rootParticipant' as const, actionTypeId: selectedActionTypeId, participantRoleId: item.participantRoleId } }
      }),
    ]
  }, [documentTypeMap, participantRoleMap, questionMap, reviewFlagLinks, reviewFlagMap, rootParticipants, rootQuestions, rootRequirements, selectedActionTypeId])

  const allExpandableNodeIds = useMemo(() => collectExpandableNodeIds(flowRootChildren), [flowRootChildren])

  const openNodeModal = (node: FlowNode, nextMode: ModalMode = 'summary') => {
    setActiveNode(node)
    setModalMode(nextMode)
    setModalError(null)
    setModalSaving(false)
    setAddType(null)
    setAddMode('existing')
    setExistingTargetId('')
    setAddPreviewQuestionId(null)
    setDuplicateQuestionSourceId(null)
    setFlagTargetOptionId('')
    const ref = node.ref

    const question =
      ref.type === 'rootQuestion'
        ? questionMap.get(ref.questionId)
        : ref.type === 'question'
          ? questionMap.get(ref.questionId)
          : ref.type === 'optionQuestionTrigger'
            ? questionMap.get(ref.targetQuestionId)
            : null

    setQuestionDraft(
      question
        ? {
            id: question.id,
            key: question.key,
            label: question.label,
            helpText: question.helpText ?? '',
            responseType: question.responseType,
            sortOrder: String(question.sortOrder),
            isActive: question.isActive,
          }
        : EMPTY_QUESTION_DRAFT
    )

    const option =
      ref.type === 'option'
        ? questionMap.get(ref.questionId)?.options.find((item) => item.id === ref.optionId) ?? null
        : null

    setOptionDraft(
      option
        ? {
            id: option.id,
            key: option.key,
            label: option.label,
            description: option.description ?? '',
            sortOrder: String(option.sortOrder),
            isActive: option.isActive,
          }
        : EMPTY_OPTION_DRAFT
    )

    const documentType =
      ref.type === 'rootRequirement'
        ? documentTypeMap.get(ref.documentTypeId)
        : ref.type === 'optionDocumentTrigger'
          ? documentTypeMap.get(ref.targetDocumentTypeId)
          : null

    setDocumentDraft(
      documentType
        ? {
            id: documentType.id,
            key: documentType.key,
            label: documentType.label,
            description: documentType.description ?? '',
            reviewGuidance: documentType.reviewGuidance ?? '',
            defaultPhase: documentType.defaultPhase,
            sortOrder: String(documentType.sortOrder),
            isActive: documentType.isActive,
          }
        : EMPTY_DOCUMENT_DRAFT
    )

    const requirementLink =
      ref.type === 'rootRequirement'
        ? rootRequirements.find((item) => item.documentTypeId === ref.documentTypeId)
        : null

    setRequirementLinkDraft(
      requirementLink
        ? {
            isRequired: requirementLink.isRequired,
            note: requirementLink.note ?? '',
            sortOrder: String(requirementLink.sortOrder),
          }
        : EMPTY_REQUIREMENT_LINK_DRAFT
    )

    const questionLink =
      ref.type === 'rootQuestion'
        ? rootQuestions.find((item) => item.questionId === ref.questionId)
        : null

    setQuestionLinkDraft(
      questionLink
        ? {
            isRequired: questionLink.isRequired,
            sortOrder: String(questionLink.sortOrder),
          }
        : EMPTY_QUESTION_LINK_DRAFT
    )

    const participant =
      ref.type === 'rootParticipant'
        ? participantRoleMap.get(ref.participantRoleId)
        : ref.type === 'optionParticipantTrigger'
          ? participantRoleMap.get(ref.targetParticipantRoleId)
          : null

    setParticipantDraft(
      participant
        ? {
            id: participant.id,
            key: participant.key,
            label: participant.label,
            description: participant.description ?? '',
            reviewGuidance: participant.reviewGuidance ?? '',
            roleKind: participant.roleKind,
            verificationInstructions: participant.verificationInstructions ?? '',
            verificationUrl: participant.verificationUrl ?? '',
            insuranceRequired: participant.insuranceRequired,
            requiresCompanyName: participant.requiresCompanyName,
            requiresOrgNumber: participant.requiresOrgNumber,
            requiresContactName: participant.requiresContactName,
            requiresEmail: participant.requiresEmail,
            requiresPhone: participant.requiresPhone,
            requiresCertification: participant.requiresCertification,
            sortOrder: String(participant.sortOrder),
            isActive: participant.isActive,
          }
        : EMPTY_PARTICIPANT_DRAFT
    )

    const participantLink =
      ref.type === 'rootParticipant'
        ? rootParticipants.find((item) => item.participantRoleId === ref.participantRoleId)
        : null

    setParticipantLinkDraft(
      participantLink
        ? {
            isRequired: participantLink.isRequired,
            sortOrder: String(participantLink.sortOrder),
          }
        : EMPTY_PARTICIPANT_LINK_DRAFT
    )

    const reviewFlag =
      ref.type === 'optionReviewFlagTrigger' ||
      ref.type === 'actionTypeReviewFlag' ||
      ref.type === 'documentReviewFlag' ||
      ref.type === 'participantReviewFlag'
        ? reviewFlagMap.get(ref.targetReviewFlagId)
        : null
    setReviewFlagDraft(
      reviewFlag
        ? {
            id: reviewFlag.id,
            key: reviewFlag.key,
            label: reviewFlag.label,
            description: reviewFlag.description ?? '',
            severity: reviewFlag.severity,
            category: reviewFlag.category ?? '',
            sortOrder: String(reviewFlag.sortOrder),
            isActive: reviewFlag.isActive,
          }
        : EMPTY_REVIEW_FLAG_DRAFT
    )

    setActionTypeDraft(
      ref.type === 'actionType' && selectedAction && ref.actionTypeId === selectedAction.id
        ? {
            id: selectedAction.id,
            key: selectedAction.key,
            label: selectedAction.label,
            description: selectedAction.description ?? '',
            riskLevel: selectedAction.riskLevel,
            contractorRequirement: selectedAction.contractorRequirement,
            impliesStructure: selectedAction.impliesStructure,
            impliesPlumbing: selectedAction.impliesPlumbing,
            impliesVentilation: selectedAction.impliesVentilation,
            impliesElectrical: selectedAction.impliesElectrical,
            impliesWetRoom: selectedAction.impliesWetRoom,
            impliesSurfaceOnly: selectedAction.impliesSurfaceOnly,
            sortOrder: String(selectedAction.sortOrder),
            isActive: selectedAction.isActive,
          }
        : EMPTY_ACTION_TYPE_DRAFT
    )
  }

  const openCreateActionTypeModal = () => {
    openNodeModal(
      {
        id: 'action-type:new',
        kind: 'root',
        title: 'Ny renoveringstyp',
        badges: [],
        tone: 'stone',
        children: [],
        ref: { type: 'actionType', actionTypeId: '' },
      },
      'edit'
    )
  }

  const closeModal = () => {
    setActiveNode(null)
    setModalMode('summary')
    setModalError(null)
    setModalSaving(false)
    setAddType(null)
    setExistingTargetId('')
    setAddPreviewQuestionId(null)
    setDuplicateQuestionSourceId(null)
    setFlagTargetOptionId('')
  }

  const toggleNode = (id: string) => setExpandedNodeIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  const activeQuestionIdForOptionAdd =
    activeNode?.ref.type === 'rootQuestion'
      ? activeNode.ref.questionId
      : activeNode?.ref.type === 'question'
        ? activeNode.ref.questionId
        : activeNode?.ref.type === 'optionQuestionTrigger'
          ? activeNode.ref.targetQuestionId
          : null

  const activeQuestionSummary = useMemo(() => {
    if (!activeNode) return null
    if (activeNode.ref.type === 'rootQuestion') return questionMap.get(activeNode.ref.questionId) ?? null
    if (activeNode.ref.type === 'question') return questionMap.get(activeNode.ref.questionId) ?? null
    if (activeNode.ref.type === 'optionQuestionTrigger') return questionMap.get(activeNode.ref.targetQuestionId) ?? null
    return null
  }, [activeNode, questionMap])

  const isCreatingActionType = activeNode?.ref.type === 'actionType' && !actionTypeDraft.id

  const canEditNode = Boolean(
    activeNode &&
      (activeNode.ref.type === 'actionType' ||
        activeNode.ref.type === 'rootQuestion' ||
        activeNode.ref.type === 'question' ||
        activeNode.ref.type === 'optionQuestionTrigger' ||
        activeNode.ref.type === 'option' ||
        activeNode.ref.type === 'rootRequirement' ||
        activeNode.ref.type === 'optionDocumentTrigger' ||
        activeNode.ref.type === 'rootParticipant' ||
        activeNode.ref.type === 'optionParticipantTrigger' ||
        activeNode.ref.type === 'optionReviewFlagTrigger' ||
        activeNode.ref.type === 'actionTypeReviewFlag' ||
        activeNode.ref.type === 'documentReviewFlag' ||
        activeNode.ref.type === 'participantReviewFlag')
  )

  const addableTypes = useMemo<AddType[]>(() => {
    if (!activeNode) return []
    if (activeNode.ref.type === 'actionType') return ['question', 'document', 'participant', 'flag']
    if (
      activeNode.ref.type === 'rootQuestion' ||
      activeNode.ref.type === 'question' ||
      activeNode.ref.type === 'optionQuestionTrigger'
    ) {
      return ['option', 'flag']
    }
    if (activeNode.ref.type === 'option') return ['question', 'document', 'participant', 'flag']
    if (
      activeNode.ref.type === 'rootRequirement' ||
      activeNode.ref.type === 'optionDocumentTrigger' ||
      activeNode.ref.type === 'rootParticipant' ||
      activeNode.ref.type === 'optionParticipantTrigger'
    ) {
      return ['flag']
    }
    return []
  }, [activeNode])

  const canRemoveConnection = Boolean(
    activeNode &&
      (activeNode.ref.type === 'rootQuestion' ||
        activeNode.ref.type === 'rootRequirement' ||
        activeNode.ref.type === 'rootParticipant' ||
        activeNode.ref.type === 'optionQuestionTrigger' ||
        activeNode.ref.type === 'optionDocumentTrigger' ||
        activeNode.ref.type === 'optionParticipantTrigger' ||
        activeNode.ref.type === 'optionReviewFlagTrigger' ||
        activeNode.ref.type === 'actionTypeReviewFlag' ||
        activeNode.ref.type === 'documentReviewFlag' ||
        activeNode.ref.type === 'participantReviewFlag')
  )

  const canDeleteOption = activeNode?.ref.type === 'option'

  const canDuplicateNode = Boolean(
    activeNode &&
      activeNode.ref.type !== 'status' &&
      !isCreatingActionType
  )

  const canDeleteObject = Boolean(
    activeNode &&
      (activeNode.ref.type === 'actionType' ||
        activeNode.ref.type === 'rootQuestion' ||
        activeNode.ref.type === 'question' ||
        activeNode.ref.type === 'optionQuestionTrigger' ||
        activeNode.ref.type === 'rootRequirement' ||
        activeNode.ref.type === 'optionDocumentTrigger' ||
        activeNode.ref.type === 'rootParticipant' ||
        activeNode.ref.type === 'optionParticipantTrigger' ||
        activeNode.ref.type === 'optionReviewFlagTrigger' ||
        activeNode.ref.type === 'actionTypeReviewFlag' ||
        activeNode.ref.type === 'documentReviewFlag' ||
        activeNode.ref.type === 'participantReviewFlag') &&
      !isCreatingActionType
  )

  const existingAddOptions = useMemo(() => {
    if (!addType) return []
    if (addType === 'question') return linkableQuestions.map((item) => ({ id: item.id, label: item.label }))
    if (addType === 'document') return linkableDocumentTypes.map((item) => ({ id: item.id, label: item.label }))
    if (addType === 'participant') return linkableParticipantRoles.map((item) => ({ id: item.id, label: item.label }))
    return linkableReviewFlags.map((item) => ({ id: item.id, label: item.label }))
  }, [addType, linkableDocumentTypes, linkableParticipantRoles, linkableQuestions, linkableReviewFlags])

  const addPreviewQuestion = useMemo(
    () => (addPreviewQuestionId ? questionItems.find((item) => item.id === addPreviewQuestionId) ?? null : null),
    [addPreviewQuestionId, questionItems]
  )

  const persistQuestionWithOptions = async (question: QuestionItem) => {
    const response = await fetch('/api/renoapp/admin/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(questionToRequestPayload(question)),
    })
    const payload = await readJson<{ error?: string }>(response)
    if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara frågan.')
  }

  const updateOptionTriggers = async (
    questionId: string,
    optionId: string,
    updater: (triggers: QuestionOptionTriggerItem[]) => QuestionOptionTriggerItem[]
  ) => {
    const question = questionMap.get(questionId)
    if (!question) throw new Error('Frågan kunde inte hittas.')
    const nextQuestion: QuestionItem = {
      ...question,
      options: question.options.map((option) => (option.id === optionId ? { ...option, triggers: updater(option.triggers) } : option)),
    }
    await persistQuestionWithOptions(nextQuestion)
  }

  const saveReviewFlagLink = async (input: {
    reviewFlagId: string
    actionTypeId?: string | null
    documentTypeId?: string | null
    participantRoleId?: string | null
    isEnabled?: boolean
  }) => {
    const response = await fetch('/api/renoapp/admin/review-flag-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        isEnabled: input.isEnabled !== false,
        sortOrder: Math.max(0, ...reviewFlagLinks.map((item) => item.sortOrder)) + 10,
      }),
    })
    const payload = await readJson<{ error?: string }>(response)
    if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara flaggkoppling.')
  }

  const saveEdit = async () => {
    if (!activeNode) return
    setModalSaving(true)
    setModalError(null)

    try {
      if (activeNode.ref.type === 'actionType') {
        const response = await fetch('/api/renoapp/admin/action-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: actionTypeDraft.id,
            key: generatedActionTypeKey(actionTypeDraft),
            label: actionTypeDraft.label,
            description: actionTypeDraft.description || null,
            riskLevel: actionTypeDraft.riskLevel,
            contractorRequirement: actionTypeDraft.contractorRequirement,
            impliesStructure: actionTypeDraft.impliesStructure,
            impliesPlumbing: actionTypeDraft.impliesPlumbing,
            impliesVentilation: actionTypeDraft.impliesVentilation,
            impliesElectrical: actionTypeDraft.impliesElectrical,
            impliesWetRoom: actionTypeDraft.impliesWetRoom,
            impliesSurfaceOnly: actionTypeDraft.impliesSurfaceOnly,
            sortOrder: Number(actionTypeDraft.sortOrder || 100),
            isActive: actionTypeDraft.isActive,
          }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara renoveringstypen.')
      } else if (activeNode.ref.type === 'rootQuestion' || activeNode.ref.type === 'question' || activeNode.ref.type === 'optionQuestionTrigger') {
        const questionId =
          activeNode.ref.type === 'rootQuestion'
            ? activeNode.ref.questionId
            : activeNode.ref.type === 'question'
              ? activeNode.ref.questionId
              : activeNode.ref.targetQuestionId
        const currentQuestion = questionMap.get(questionId)
        if (!currentQuestion) throw new Error('Frågan kunde inte hittas.')
        await persistQuestionWithOptions({
          ...currentQuestion,
          key: generatedQuestionKey(questionDraft),
          label: questionDraft.label,
          helpText: questionDraft.helpText || null,
          responseType: questionDraft.responseType,
          sortOrder: Number(questionDraft.sortOrder || 100),
          isActive: questionDraft.isActive,
        })
        if (activeNode.ref.type === 'rootQuestion') {
          const relationResponse = await fetch('/api/renoapp/admin/action-type-questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actionTypeId: activeNode.ref.actionTypeId,
              questionId: activeNode.ref.questionId,
              isEnabled: true,
              isRequired: questionLinkDraft.isRequired,
              sortOrder: Number(questionLinkDraft.sortOrder || 100),
            }),
          })
          const relationPayload = await readJson<{ error?: string }>(relationResponse)
          if (!relationResponse.ok) throw new Error(relationPayload.error ?? 'Kunde inte spara frågekopplingen.')
        }
      } else if (activeNode.ref.type === 'option') {
        const ref = activeNode.ref
        const question = questionMap.get(ref.questionId)
        if (!question) throw new Error('Frågan kunde inte hittas.')
        const currentOption = question.options.find((item) => item.id === ref.optionId)
        if (!currentOption) throw new Error('Svarsalternativet kunde inte hittas.')
        await persistQuestionWithOptions({
          ...question,
          options: question.options.map((item) =>
            item.id === ref.optionId
              ? {
                  ...currentOption,
                  key: generatedOptionKey(optionDraft),
                  label: optionDraft.label,
                  description: optionDraft.description || null,
                  sortOrder: Number(optionDraft.sortOrder || 100),
                  isActive: optionDraft.isActive,
                }
              : item
          ),
        })
      } else if (activeNode.ref.type === 'rootRequirement' || activeNode.ref.type === 'optionDocumentTrigger') {
        const response = await fetch('/api/renoapp/admin/document-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: documentDraft.id,
            key: generatedDocumentKey(documentDraft),
            label: documentDraft.label,
            description: documentDraft.description || null,
            reviewGuidance: documentDraft.reviewGuidance || null,
            defaultPhase: documentDraft.defaultPhase,
            sortOrder: Number(documentDraft.sortOrder || 100),
            isActive: documentDraft.isActive,
          }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara underlaget.')
        if (activeNode.ref.type === 'rootRequirement') {
          const relationResponse = await fetch('/api/renoapp/admin/requirements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actionTypeId: activeNode.ref.actionTypeId,
              documentTypeId: activeNode.ref.documentTypeId,
              isEnabled: true,
              isRequired: requirementLinkDraft.isRequired,
              note: requirementLinkDraft.note || null,
              sortOrder: Number(requirementLinkDraft.sortOrder || 100),
            }),
          })
          const relationPayload = await readJson<{ error?: string }>(relationResponse)
          if (!relationResponse.ok) throw new Error(relationPayload.error ?? 'Kunde inte spara underlagskopplingen.')
        }
      } else if (activeNode.ref.type === 'rootParticipant' || activeNode.ref.type === 'optionParticipantTrigger') {
        const response = await fetch('/api/renoapp/admin/participants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: participantDraft.id,
            key: generatedParticipantKey(participantDraft),
            label: participantDraft.label,
            description: participantDraft.description || null,
            reviewGuidance: participantDraft.reviewGuidance || null,
            roleKind: participantDraft.roleKind,
            verificationInstructions: participantDraft.verificationInstructions || null,
            verificationUrl: participantDraft.verificationUrl || null,
            insuranceRequired: participantDraft.insuranceRequired,
            requiresCompanyName: participantDraft.requiresCompanyName,
            requiresOrgNumber: participantDraft.requiresOrgNumber,
            requiresContactName: participantDraft.requiresContactName,
            requiresEmail: participantDraft.requiresEmail,
            requiresPhone: participantDraft.requiresPhone,
            requiresCertification: participantDraft.requiresCertification,
            sortOrder: Number(participantDraft.sortOrder || 100),
            isActive: participantDraft.isActive,
          }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara medverkandetypen.')
        if (activeNode.ref.type === 'rootParticipant') {
          const relationResponse = await fetch('/api/renoapp/admin/action-type-participants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actionTypeId: activeNode.ref.actionTypeId,
              participantRoleId: activeNode.ref.participantRoleId,
              isEnabled: true,
              isRequired: participantLinkDraft.isRequired,
              sortOrder: Number(participantLinkDraft.sortOrder || 100),
            }),
          })
          const relationPayload = await readJson<{ error?: string }>(relationResponse)
          if (!relationResponse.ok) throw new Error(relationPayload.error ?? 'Kunde inte spara medverkandekopplingen.')
        }
      } else if (
        activeNode.ref.type === 'optionReviewFlagTrigger' ||
        activeNode.ref.type === 'actionTypeReviewFlag' ||
        activeNode.ref.type === 'documentReviewFlag' ||
        activeNode.ref.type === 'participantReviewFlag'
      ) {
        const response = await fetch('/api/renoapp/admin/review-flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: reviewFlagDraft.id,
            key: generatedReviewFlagKey(reviewFlagDraft),
            label: reviewFlagDraft.label,
            description: reviewFlagDraft.description || null,
            severity: reviewFlagDraft.severity,
            category: reviewFlagDraft.category || null,
            sortOrder: Number(reviewFlagDraft.sortOrder || 100),
            isActive: reviewFlagDraft.isActive,
          }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara flaggan.')
      }

      await loadData(selectedActionTypeId)
    } catch (saveError) {
      setModalError(saveError instanceof Error ? saveError.message : 'Kunde inte spara.')
    } finally {
      setModalSaving(false)
    }
  }

  const removeConnection = async () => {
    if (!activeNode) return
    setModalSaving(true)
    setModalError(null)
    const ref = activeNode.ref

    try {
      if (ref.type === 'rootQuestion') {
        const link = rootQuestions.find((item) => item.questionId === ref.questionId)
        const response = await fetch('/api/renoapp/admin/action-type-questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionTypeId: ref.actionTypeId, questionId: ref.questionId, isEnabled: false, isRequired: link?.isRequired ?? true, sortOrder: link?.sortOrder ?? 100 }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte ta bort frågekopplingen.')
      } else if (ref.type === 'rootRequirement') {
        const link = rootRequirements.find((item) => item.documentTypeId === ref.documentTypeId)
        const response = await fetch('/api/renoapp/admin/requirements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionTypeId: ref.actionTypeId, documentTypeId: ref.documentTypeId, isEnabled: false, isRequired: link?.isRequired ?? true, note: null, sortOrder: link?.sortOrder ?? 100 }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte ta bort dokumentkopplingen.')
      } else if (ref.type === 'rootParticipant') {
        const link = rootParticipants.find((item) => item.participantRoleId === ref.participantRoleId)
        const response = await fetch('/api/renoapp/admin/action-type-participants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionTypeId: ref.actionTypeId, participantRoleId: ref.participantRoleId, isEnabled: false, isRequired: link?.isRequired ?? true, sortOrder: link?.sortOrder ?? 100 }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte ta bort medverkandekopplingen.')
      } else if (ref.type === 'optionQuestionTrigger') {
        await updateOptionTriggers(ref.questionId, ref.optionId, (triggers) => triggers.filter((trigger) => !(trigger.triggerType === 'question' && trigger.questionId === ref.targetQuestionId)))
      } else if (ref.type === 'optionDocumentTrigger') {
        await updateOptionTriggers(ref.questionId, ref.optionId, (triggers) => triggers.filter((trigger) => !(trigger.triggerType === 'document' && trigger.documentTypeId === ref.targetDocumentTypeId)))
      } else if (ref.type === 'optionParticipantTrigger') {
        await updateOptionTriggers(ref.questionId, ref.optionId, (triggers) => triggers.filter((trigger) => !(trigger.triggerType === 'participant_role' && trigger.participantRoleId === ref.targetParticipantRoleId)))
      } else if (ref.type === 'optionReviewFlagTrigger') {
        await updateOptionTriggers(ref.questionId, ref.optionId, (triggers) => triggers.filter((trigger) => !(trigger.triggerType === 'review_flag' && trigger.reviewFlagId === ref.targetReviewFlagId)))
      } else if (ref.type === 'actionTypeReviewFlag') {
        await saveReviewFlagLink({ actionTypeId: ref.actionTypeId, reviewFlagId: ref.targetReviewFlagId, isEnabled: false })
      } else if (ref.type === 'documentReviewFlag') {
        await saveReviewFlagLink({ documentTypeId: ref.documentTypeId, reviewFlagId: ref.targetReviewFlagId, isEnabled: false })
      } else if (ref.type === 'participantReviewFlag') {
        await saveReviewFlagLink({ participantRoleId: ref.participantRoleId, reviewFlagId: ref.targetReviewFlagId, isEnabled: false })
      }

      await loadData(selectedActionTypeId)
      closeModal()
    } catch (removeError) {
      setModalError(removeError instanceof Error ? removeError.message : 'Kunde inte ta bort kopplingen.')
    } finally {
      setModalSaving(false)
    }
  }

  const deleteOptionNode = async () => {
    if (!activeNode || activeNode.ref.type !== 'option') return
    const ref = activeNode.ref
    setModalSaving(true)
    setModalError(null)

    try {
      const question = questionMap.get(ref.questionId)
      if (!question) throw new Error('Frågan kunde inte hittas.')
      await persistQuestionWithOptions({
        ...question,
        options: question.options.filter((item) => item.id !== ref.optionId),
      })
      await loadData(selectedActionTypeId)
      closeModal()
    } catch (deleteError) {
      setModalError(deleteError instanceof Error ? deleteError.message : 'Kunde inte radera svarsalternativet.')
    } finally {
      setModalSaving(false)
    }
  }

  const duplicateActiveNode = async () => {
    if (!activeNode) return
    setModalSaving(true)
    setModalError(null)

    try {
      const ref = activeNode.ref
      if (ref.type === 'option') {
        const question = questionMap.get(ref.questionId)
        const option = question?.options.find((item) => item.id === ref.optionId)
        if (!question || !option) throw new Error('Svarsalternativet kunde inte hittas.')
        await persistQuestionWithOptions({
          ...question,
          options: [
            ...question.options,
            {
              ...option,
              id: `new-${Date.now()}`,
              key: '',
              label: `${option.label} (kopia)`,
              sortOrder: Math.max(0, ...question.options.map((item) => item.sortOrder)) + 10,
              triggers: option.triggers.map((trigger, index) => ({
                ...trigger,
                id: `new-trigger-${Date.now()}-${index}`,
              })),
            },
          ],
        })
      } else if (ref.type === 'actionType' && selectedAction) {
        const response = await fetch('/api/renoapp/admin/action-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: null,
            key: `${selectedAction.key}-kopia-${Date.now()}`,
            label: `${selectedAction.label} (kopia)`,
            description: selectedAction.description ?? null,
            categoryId: selectedAction.categoryId,
            riskLevel: selectedAction.riskLevel,
            contractorRequirement: selectedAction.contractorRequirement,
            impliesStructure: selectedAction.impliesStructure,
            impliesPlumbing: selectedAction.impliesPlumbing,
            impliesVentilation: selectedAction.impliesVentilation,
            impliesElectrical: selectedAction.impliesElectrical,
            impliesWetRoom: selectedAction.impliesWetRoom,
            impliesSurfaceOnly: selectedAction.impliesSurfaceOnly,
            sortOrder: selectedAction.sortOrder + 10,
            isActive: selectedAction.isActive,
          }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte duplicera renoveringstypen.')
      } else if (ref.type === 'rootQuestion' || ref.type === 'question' || ref.type === 'optionQuestionTrigger') {
        const questionId =
          ref.type === 'rootQuestion' ? ref.questionId : ref.type === 'question' ? ref.questionId : ref.targetQuestionId
        const question = questionMap.get(questionId)
        if (!question) throw new Error('Frågan kunde inte hittas.')
        const response = await fetch('/api/renoapp/admin/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: {
              ...question,
              id: null,
              key: '',
              label: `${question.label} (kopia)`,
              sortOrder: question.sortOrder + 10,
            },
            options: question.options.map((option) => ({
              ...option,
              id: null,
              key: '',
              sortOrder: option.sortOrder,
              triggers: option.triggers.map((trigger) => ({
                ...trigger,
                id: null,
              })),
            })),
          }),
        })
        const payload = await readJson<{ item?: QuestionItem; error?: string }>(response)
        if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Kunde inte duplicera frågan.')
        if (ref.type === 'rootQuestion') {
          const linkResponse = await fetch('/api/renoapp/admin/action-type-questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actionTypeId: ref.actionTypeId,
              questionId: payload.item.id,
              isEnabled: true,
              isRequired: questionLinkDraft.isRequired,
              sortOrder: Number(questionLinkDraft.sortOrder || 100) + 10,
            }),
          })
          const linkPayload = await readJson<{ error?: string }>(linkResponse)
          if (!linkResponse.ok) throw new Error(linkPayload.error ?? 'Kunde inte koppla den duplicerade frågan.')
        } else if (ref.type === 'optionQuestionTrigger') {
          await updateOptionTriggers(ref.questionId, ref.optionId, (triggers) => [
            ...triggers,
            {
              id: `new-${Date.now()}`,
              triggerType: 'question',
              questionId: payload.item!.id,
              documentTypeId: null,
              participantRoleId: null,
              reviewFlagId: null,
              sortOrder: Math.max(0, ...triggers.map((item) => item.sortOrder)) + 10,
              isActive: true,
            },
          ])
        }
      } else if (ref.type === 'rootRequirement' || ref.type === 'optionDocumentTrigger') {
        const documentTypeId = ref.type === 'rootRequirement' ? ref.documentTypeId : ref.targetDocumentTypeId
        const documentType = documentTypeMap.get(documentTypeId)
        if (!documentType) throw new Error('Underlaget kunde inte hittas.')
        const response = await fetch('/api/renoapp/admin/document-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...documentType,
            id: null,
            key: '',
            label: `${documentType.label} (kopia)`,
            sortOrder: documentType.sortOrder + 10,
          }),
        })
        const payload = await readJson<{ item?: DocumentTypeItem; error?: string }>(response)
        if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Kunde inte duplicera underlaget.')
        if (ref.type === 'rootRequirement') {
          const linkResponse = await fetch('/api/renoapp/admin/requirements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actionTypeId: ref.actionTypeId,
              documentTypeId: payload.item.id,
              isEnabled: true,
              isRequired: requirementLinkDraft.isRequired,
              note: requirementLinkDraft.note || null,
              sortOrder: Number(requirementLinkDraft.sortOrder || 100) + 10,
            }),
          })
          const linkPayload = await readJson<{ error?: string }>(linkResponse)
          if (!linkResponse.ok) throw new Error(linkPayload.error ?? 'Kunde inte koppla det duplicerade underlaget.')
        } else {
          await updateOptionTriggers(ref.questionId, ref.optionId, (triggers) => [
            ...triggers,
            {
              id: `new-${Date.now()}`,
              triggerType: 'document',
              questionId: null,
              documentTypeId: payload.item!.id,
              participantRoleId: null,
              reviewFlagId: null,
              sortOrder: Math.max(0, ...triggers.map((item) => item.sortOrder)) + 10,
              isActive: true,
            },
          ])
        }
      } else if (ref.type === 'rootParticipant' || ref.type === 'optionParticipantTrigger') {
        const participantRoleId = ref.type === 'rootParticipant' ? ref.participantRoleId : ref.targetParticipantRoleId
        const participant = participantRoleMap.get(participantRoleId)
        if (!participant) throw new Error('Medverkandetypen kunde inte hittas.')
        const response = await fetch('/api/renoapp/admin/participants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...participant,
            id: null,
            key: '',
            label: `${participant.label} (kopia)`,
            sortOrder: participant.sortOrder + 10,
          }),
        })
        const payload = await readJson<{ item?: ParticipantRoleItem; error?: string }>(response)
        if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Kunde inte duplicera medverkandetypen.')
        if (ref.type === 'rootParticipant') {
          const linkResponse = await fetch('/api/renoapp/admin/action-type-participants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actionTypeId: ref.actionTypeId,
              participantRoleId: payload.item.id,
              isEnabled: true,
              isRequired: participantLinkDraft.isRequired,
              sortOrder: Number(participantLinkDraft.sortOrder || 100) + 10,
            }),
          })
          const linkPayload = await readJson<{ error?: string }>(linkResponse)
          if (!linkResponse.ok) throw new Error(linkPayload.error ?? 'Kunde inte koppla den duplicerade medverkandetypen.')
        } else {
          await updateOptionTriggers(ref.questionId, ref.optionId, (triggers) => [
            ...triggers,
            {
              id: `new-${Date.now()}`,
              triggerType: 'participant_role',
              questionId: null,
              documentTypeId: null,
              participantRoleId: payload.item!.id,
              reviewFlagId: null,
              sortOrder: Math.max(0, ...triggers.map((item) => item.sortOrder)) + 10,
              isActive: true,
            },
          ])
        }
      } else if (
        ref.type === 'optionReviewFlagTrigger' ||
        ref.type === 'actionTypeReviewFlag' ||
        ref.type === 'documentReviewFlag' ||
        ref.type === 'participantReviewFlag'
      ) {
        const flag = reviewFlagMap.get(ref.targetReviewFlagId)
        if (!flag) throw new Error('Flaggan kunde inte hittas.')
        const response = await fetch('/api/renoapp/admin/review-flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...flag,
            id: null,
            key: '',
            label: `${flag.label} (kopia)`,
            sortOrder: flag.sortOrder + 10,
          }),
        })
        const payload = await readJson<{ item?: ReviewFlagItem; error?: string }>(response)
        if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Kunde inte duplicera flaggan.')
        if (ref.type === 'optionReviewFlagTrigger') {
          await updateOptionTriggers(ref.questionId, ref.optionId, (triggers) => [
            ...triggers,
            {
              id: `new-${Date.now()}`,
              triggerType: 'review_flag',
              questionId: null,
              documentTypeId: null,
              participantRoleId: null,
              reviewFlagId: payload.item!.id,
              sortOrder: Math.max(0, ...triggers.map((item) => item.sortOrder)) + 10,
              isActive: true,
            },
          ])
        } else if (ref.type === 'actionTypeReviewFlag') {
          await saveReviewFlagLink({ actionTypeId: ref.actionTypeId, reviewFlagId: payload.item.id })
        } else if (ref.type === 'documentReviewFlag') {
          await saveReviewFlagLink({ documentTypeId: ref.documentTypeId, reviewFlagId: payload.item.id })
        } else if (ref.type === 'participantReviewFlag') {
          await saveReviewFlagLink({ participantRoleId: ref.participantRoleId, reviewFlagId: payload.item.id })
        }
      }

      await loadData(selectedActionTypeId)
      closeModal()
    } catch (duplicateError) {
      setModalError(duplicateError instanceof Error ? duplicateError.message : 'Kunde inte duplicera objektet.')
    } finally {
      setModalSaving(false)
    }
  }

  const deleteActiveObject = async () => {
    if (!activeNode) return
    setModalSaving(true)
    setModalError(null)

    try {
      const ref = activeNode.ref
      if (ref.type === 'actionType') {
        const response = await fetch('/api/renoapp/admin/action-types', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: ref.actionTypeId }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte radera renoveringstypen.')
      } else if (ref.type === 'rootQuestion' || ref.type === 'question' || ref.type === 'optionQuestionTrigger') {
        const questionId =
          ref.type === 'rootQuestion' ? ref.questionId : ref.type === 'question' ? ref.questionId : ref.targetQuestionId
        const response = await fetch('/api/renoapp/admin/questions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: questionId }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte radera frågan.')
      } else if (ref.type === 'rootRequirement' || ref.type === 'optionDocumentTrigger') {
        const documentTypeId = ref.type === 'rootRequirement' ? ref.documentTypeId : ref.targetDocumentTypeId
        const response = await fetch('/api/renoapp/admin/document-types', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: documentTypeId }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte radera underlaget.')
      } else if (ref.type === 'rootParticipant' || ref.type === 'optionParticipantTrigger') {
        const participantRoleId = ref.type === 'rootParticipant' ? ref.participantRoleId : ref.targetParticipantRoleId
        const response = await fetch('/api/renoapp/admin/participants', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: participantRoleId }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte radera medverkandetypen.')
      } else if (
        ref.type === 'optionReviewFlagTrigger' ||
        ref.type === 'actionTypeReviewFlag' ||
        ref.type === 'documentReviewFlag' ||
        ref.type === 'participantReviewFlag'
      ) {
        const response = await fetch('/api/renoapp/admin/review-flags', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: ref.targetReviewFlagId }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte radera flaggan.')
      }

      await loadData(selectedActionTypeId)
      closeModal()
    } catch (deleteError) {
      setModalError(deleteError instanceof Error ? deleteError.message : 'Kunde inte radera objektet.')
    } finally {
      setModalSaving(false)
    }
  }

  const resetNewDraftForType = (type: AddType) => {
    if (type === 'question') {
      setQuestionDraft(EMPTY_QUESTION_DRAFT)
      setQuestionOptionDrafts([createQuestionOptionDraft()])
    }
    if (type === 'option') setOptionDraft(EMPTY_OPTION_DRAFT)
    if (type === 'document') setDocumentDraft(EMPTY_DOCUMENT_DRAFT)
    if (type === 'participant') setParticipantDraft(EMPTY_PARTICIPANT_DRAFT)
    if (type === 'flag') setReviewFlagDraft(EMPTY_REVIEW_FLAG_DRAFT)
  }

  const saveAdd = async (behavior: AddSaveBehavior = 'save') => {
    if (!activeNode || !addType) return
    setModalSaving(true)
    setModalError(null)

    try {
      let targetId = existingTargetId

      if (addMode === 'new') {
        if (addType === 'option') {
          targetId = ''
        } else if (addType === 'question') {
          const nextOptions = questionOptionDrafts
            .map((option, index) => ({
              id: null,
              key: generatedOptionKey(option),
              label: option.label.trim(),
              description: option.description.trim() || null,
              sortOrder: Number(option.sortOrder || (index + 1) * 10),
              isActive: option.isActive,
              metadata: {},
              triggers: [],
            }))
            .filter((option) => option.label)

          if (nextOptions.length === 0) {
            throw new Error('Lägg till minst ett svarsalternativ innan frågan sparas.')
          }

          const response = await fetch('/api/renoapp/admin/questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question: {
                id: null,
                key: generatedQuestionKey(questionDraft),
                label: questionDraft.label,
                helpText: questionDraft.helpText || null,
                responseType: questionDraft.responseType,
                sortOrder: Number(questionDraft.sortOrder || 100),
                isActive: questionDraft.isActive,
                metadata: {},
              },
              options: nextOptions,
            }),
          })
          const payload = await readJson<{ item?: QuestionItem; error?: string }>(response)
          if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Kunde inte skapa frågan.')
          targetId = payload.item.id
        } else if (addType === 'document') {
          const response = await fetch('/api/renoapp/admin/document-types', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: null, key: generatedDocumentKey(documentDraft), label: documentDraft.label, description: documentDraft.description || null, reviewGuidance: documentDraft.reviewGuidance || null, defaultPhase: documentDraft.defaultPhase, sortOrder: Number(documentDraft.sortOrder || 100), isActive: documentDraft.isActive }),
          })
          const payload = await readJson<{ item?: DocumentTypeItem; error?: string }>(response)
          if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Kunde inte skapa underlaget.')
          targetId = payload.item.id
        } else if (addType === 'participant') {
          const response = await fetch('/api/renoapp/admin/participants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: null,
              key: generatedParticipantKey(participantDraft),
              label: participantDraft.label,
              description: participantDraft.description || null,
              reviewGuidance: participantDraft.reviewGuidance || null,
              roleKind: participantDraft.roleKind,
              verificationInstructions: participantDraft.verificationInstructions || null,
              verificationUrl: participantDraft.verificationUrl || null,
              insuranceRequired: participantDraft.insuranceRequired,
              requiresCompanyName: participantDraft.requiresCompanyName,
              requiresOrgNumber: participantDraft.requiresOrgNumber,
              requiresContactName: participantDraft.requiresContactName,
              requiresEmail: participantDraft.requiresEmail,
              requiresPhone: participantDraft.requiresPhone,
              requiresCertification: participantDraft.requiresCertification,
              sortOrder: Number(participantDraft.sortOrder || 100),
              isActive: participantDraft.isActive,
            }),
          })
          const payload = await readJson<{ item?: ParticipantRoleItem; error?: string }>(response)
          if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Kunde inte skapa medverkandetypen.')
          targetId = payload.item.id
        } else if (addType === 'flag') {
          const response = await fetch('/api/renoapp/admin/review-flags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: null, key: generatedReviewFlagKey(reviewFlagDraft), label: reviewFlagDraft.label, description: reviewFlagDraft.description || null, severity: reviewFlagDraft.severity, category: reviewFlagDraft.category || null, sortOrder: Number(reviewFlagDraft.sortOrder || 100), isActive: reviewFlagDraft.isActive }),
          })
          const payload = await readJson<{ item?: ReviewFlagItem; error?: string }>(response)
          if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Kunde inte skapa flaggan.')
          targetId = payload.item.id
        }
      }

      if (addType !== 'option' && !targetId) throw new Error('Välj först vad som ska läggas till.')

      if (activeNode.ref.type === 'actionType') {
        if (addType === 'question') {
          const response = await fetch('/api/renoapp/admin/action-type-questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actionTypeId: activeNode.ref.actionTypeId, questionId: targetId, isEnabled: true, isRequired: true, sortOrder: (rootQuestions.at(-1)?.sortOrder ?? 0) + 10 }),
          })
          const payload = await readJson<{ error?: string }>(response)
          if (!response.ok) throw new Error(payload.error ?? 'Kunde inte koppla frågan.')
        } else if (addType === 'document') {
          const response = await fetch('/api/renoapp/admin/requirements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actionTypeId: activeNode.ref.actionTypeId, documentTypeId: targetId, isEnabled: true, isRequired: true, note: null, sortOrder: (rootRequirements.at(-1)?.sortOrder ?? 0) + 10 }),
          })
          const payload = await readJson<{ error?: string }>(response)
          if (!response.ok) throw new Error(payload.error ?? 'Kunde inte koppla underlaget.')
        } else if (addType === 'participant') {
          const response = await fetch('/api/renoapp/admin/action-type-participants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actionTypeId: activeNode.ref.actionTypeId, participantRoleId: targetId, isEnabled: true, isRequired: true, sortOrder: (rootParticipants.at(-1)?.sortOrder ?? 0) + 10 }),
          })
          const payload = await readJson<{ error?: string }>(response)
          if (!response.ok) throw new Error(payload.error ?? 'Kunde inte koppla medverkandetypen.')
        } else if (addType === 'flag') {
          await saveReviewFlagLink({
            actionTypeId: activeNode.ref.actionTypeId,
            reviewFlagId: targetId,
          })
        }
      } else if (
        (activeNode.ref.type === 'rootQuestion' ||
          activeNode.ref.type === 'question' ||
          activeNode.ref.type === 'optionQuestionTrigger') &&
        addType === 'option'
      ) {
        const questionId = activeQuestionIdForOptionAdd
        if (!questionId) throw new Error('Frågan kunde inte hittas.')
        const question = questionMap.get(questionId)
        if (!question) throw new Error('Frågan kunde inte hittas.')
        await persistQuestionWithOptions({
          ...question,
          options: [
            ...question.options,
            {
              id: `new-${Date.now()}`,
              key: generatedOptionKey(optionDraft),
              label: optionDraft.label,
              description: optionDraft.description || null,
              sortOrder: Number(optionDraft.sortOrder || Math.max(0, ...question.options.map((item) => item.sortOrder)) + 10 || 100),
              isActive: optionDraft.isActive,
              metadata: {},
              triggers: [],
            },
          ],
        })
      } else if (
        (activeNode.ref.type === 'rootQuestion' ||
          activeNode.ref.type === 'question' ||
          activeNode.ref.type === 'optionQuestionTrigger') &&
        addType === 'flag'
      ) {
        const questionId = activeQuestionIdForOptionAdd
        if (!questionId) throw new Error('Frågan kunde inte hittas.')
        const targetOptionId = flagTargetOptionId || activeQuestionSummary?.options[0]?.id || ''
        if (!targetOptionId) throw new Error('Välj vilket svarsalternativ som ska trigga flaggan.')

        await updateOptionTriggers(questionId, targetOptionId, (triggers) => {
          const exists = triggers.some(
            (trigger) => trigger.triggerType === 'review_flag' && trigger.reviewFlagId === targetId
          )
          if (exists) return triggers

          return [
            ...triggers,
            {
              id: `new-${Date.now()}`,
              triggerType: 'review_flag',
              questionId: null,
              documentTypeId: null,
              participantRoleId: null,
              reviewFlagId: targetId,
              sortOrder: Math.max(0, ...triggers.map((item) => item.sortOrder)) + 10,
              isActive: true,
            },
          ]
        })
      } else if (
        (activeNode.ref.type === 'rootRequirement' || activeNode.ref.type === 'optionDocumentTrigger') &&
        addType === 'flag'
      ) {
        await saveReviewFlagLink({
          documentTypeId:
            activeNode.ref.type === 'rootRequirement'
              ? activeNode.ref.documentTypeId
              : activeNode.ref.targetDocumentTypeId,
          reviewFlagId: targetId,
        })
      } else if (
        (activeNode.ref.type === 'rootParticipant' || activeNode.ref.type === 'optionParticipantTrigger') &&
        addType === 'flag'
      ) {
        await saveReviewFlagLink({
          participantRoleId:
            activeNode.ref.type === 'rootParticipant'
              ? activeNode.ref.participantRoleId
              : activeNode.ref.targetParticipantRoleId,
          reviewFlagId: targetId,
        })
      } else if (activeNode.ref.type === 'option') {
        await updateOptionTriggers(activeNode.ref.questionId, activeNode.ref.optionId, (triggers) => {
          const exists = triggers.some((trigger) => {
            if (addType === 'question') return trigger.triggerType === 'question' && trigger.questionId === targetId
            if (addType === 'document') return trigger.triggerType === 'document' && trigger.documentTypeId === targetId
            if (addType === 'participant') return trigger.triggerType === 'participant_role' && trigger.participantRoleId === targetId
            return trigger.triggerType === 'review_flag' && trigger.reviewFlagId === targetId
          })
          if (exists) return triggers

          return [
            ...triggers,
            {
              id: `new-${Date.now()}`,
              triggerType: addType === 'question' ? 'question' : addType === 'document' ? 'document' : addType === 'participant' ? 'participant_role' : 'review_flag',
              questionId: addType === 'question' ? targetId : null,
              documentTypeId: addType === 'document' ? targetId : null,
              participantRoleId: addType === 'participant' ? targetId : null,
              reviewFlagId: addType === 'flag' ? targetId : null,
              sortOrder: Math.max(0, ...triggers.map((item) => item.sortOrder)) + 10,
              isActive: true,
            },
          ]
        })
      }

      await loadData(selectedActionTypeId)
      if (behavior === 'saveAndNew') {
        setAddMode('new')
        setExistingTargetId('')
        setAddPreviewQuestionId(null)
        setDuplicateQuestionSourceId(null)
        setFlagTargetOptionId('')
        resetNewDraftForType(addType)
      }
    } catch (addError) {
      setModalError(addError instanceof Error ? addError.message : 'Kunde inte lägga till kopplingen.')
    } finally {
      setModalSaving(false)
    }
  }

  const renderOverview = () => {
    if (!activeNode) return null

    const commonShell = (children: ReactNode) => (
      <div className="space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
        {children}
      </div>
    )

    if (activeNode.ref.type === 'actionType') {
      return commonShell(
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <OverviewCard label="Intern nyckel" value={actionTypeDraft.key || '-'} />
            <OverviewCard label="Status" value={actionTypeDraft.isActive ? 'Aktiv renoveringstyp' : 'Inaktiv renoveringstyp'} />
            <OverviewCard label="Risknivå" value={labelForRiskLevel(actionTypeDraft.riskLevel)} />
            <OverviewCard label="Entreprenörskrav" value={labelForContractorRequirement(actionTypeDraft.contractorRequirement)} />
            <OverviewCard
              label="Teknisk klassning"
              value={[
                actionTypeDraft.impliesStructure ? 'Konstruktion' : '',
                actionTypeDraft.impliesPlumbing ? 'VA' : '',
                actionTypeDraft.impliesVentilation ? 'Ventilation' : '',
                actionTypeDraft.impliesElectrical ? 'El' : '',
                actionTypeDraft.impliesWetRoom ? 'Våtrum' : '',
                actionTypeDraft.impliesSurfaceOnly ? 'Endast ytskikt' : '',
              ].filter(Boolean).join(', ') || 'Ingen angiven'}
            />
            <OverviewCard label="Sortering" value={actionTypeDraft.sortOrder} />
            <OverviewCard label="Kopplingar" value={`${rootQuestions.length} frågor, ${rootRequirements.length} underlag, ${rootParticipants.length} medverkande`} />
          </div>
          <OverviewText label="Beskrivning" value={actionTypeDraft.description} fallback="Ingen beskrivning angiven." />
        </>
      )
    }

    if (activeQuestionSummary) {
      return commonShell(
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <OverviewCard label="Intern nyckel" value={activeQuestionSummary.key} />
            <OverviewCard label="Svarstyp" value={labelForResponseType(activeQuestionSummary.responseType)} />
            <OverviewCard label="Sortering" value={activeQuestionSummary.sortOrder} />
            <OverviewCard label="Status" value={activeQuestionSummary.isActive ? 'Aktiv fråga' : 'Inaktiv fråga'} />
          </div>

          {activeNode.ref.type === 'rootQuestion' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <OverviewCard label="Koppling till renoveringstyp" value={questionLinkDraft.isRequired ? 'Obligatorisk' : 'Valfri'} />
              <OverviewCard label="Kopplingens sortering" value={questionLinkDraft.sortOrder} />
            </div>
          ) : null}

          <OverviewText label="Hjälptext" value={activeQuestionSummary.helpText} fallback="Ingen hjälptext angiven." />

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Svarsalternativ</div>
            {activeQuestionSummary.options.length > 0 ? (
              activeQuestionSummary.options
                .slice()
                .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv'))
                .map((option) => {
                  const activeTriggerCount = option.triggers.filter((trigger) => trigger.isActive).length
                  return (
                    <div key={option.id} className="rounded-lg border border-stone-200 bg-white px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-stone-900">{option.label}</div>
                          <div className="mt-1 text-xs text-stone-500">{option.key}</div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-1">
                          <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-semibold text-stone-700">{option.sortOrder}</span>
                          <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-semibold text-stone-700">{activeTriggerCount} kopplingar</span>
                          <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-semibold text-stone-700">{option.isActive ? 'Aktiv' : 'Inaktiv'}</span>
                        </div>
                      </div>
                      {option.description?.trim() ? <div className="mt-2 whitespace-pre-wrap text-sm text-stone-700">{option.description}</div> : null}
                    </div>
                  )
                })
            ) : (
              <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-3 text-stone-600">Inga svarsalternativ finns ännu.</div>
            )}
          </div>
        </>
      )
    }

    if (activeNode.ref.type === 'option') {
      const optionRef = activeNode.ref
      const optionTriggerCount =
        questionMap
          .get(optionRef.questionId)
          ?.options.find((item) => item.id === optionRef.optionId)
          ?.triggers.filter((trigger) => trigger.isActive).length ?? 0

      return commonShell(
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <OverviewCard label="Intern nyckel" value={optionDraft.key || generatedOptionKey(optionDraft) || '-'} />
            <OverviewCard label="Status" value={optionDraft.isActive ? 'Aktivt svarsalternativ' : 'Inaktivt svarsalternativ'} />
            <OverviewCard label="Sortering" value={optionDraft.sortOrder} />
            <OverviewCard label="Kopplingar" value={`${optionTriggerCount} kopplingar`} />
          </div>
          <OverviewText label="Beskrivning" value={optionDraft.description} fallback="Ingen beskrivning angiven." />
        </>
      )
    }

    if (activeNode.ref.type === 'rootRequirement' || activeNode.ref.type === 'optionDocumentTrigger') {
      return commonShell(
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <OverviewCard label="Intern nyckel" value={documentDraft.key || '-'} />
            <OverviewCard label="Standardfas" value={labelForPhase(documentDraft.defaultPhase)} />
            <OverviewCard label="Sortering" value={documentDraft.sortOrder} />
            <OverviewCard label="Status" value={documentDraft.isActive ? 'Aktiv underlagstyp' : 'Inaktiv underlagstyp'} />
          </div>
          {activeNode.ref.type === 'rootRequirement' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <OverviewCard label="Koppling till renoveringstyp" value={requirementLinkDraft.isRequired ? 'Obligatoriskt' : 'Valfritt'} />
              <OverviewCard label="Kopplingens sortering" value={requirementLinkDraft.sortOrder} />
            </div>
          ) : null}
          <OverviewText label="Hjälptext till sökande" value={documentDraft.description} fallback="Ingen hjälptext angiven." />
          <OverviewText label="Granskningsstöd" value={documentDraft.reviewGuidance} fallback="Inget granskningsstöd angivet." />
          {activeNode.ref.type === 'rootRequirement' ? <OverviewText label="Notering" value={requirementLinkDraft.note} fallback="Ingen notering angiven." /> : null}
        </>
      )
    }

    if (activeNode.ref.type === 'rootParticipant' || activeNode.ref.type === 'optionParticipantTrigger') {
      const requirements = [
        participantDraft.insuranceRequired ? 'Försäkringsbevis' : null,
        participantDraft.requiresCompanyName ? 'Företagsnamn' : null,
        participantDraft.requiresOrgNumber ? 'Org.nr' : null,
        participantDraft.requiresContactName ? 'Kontaktperson' : null,
        participantDraft.requiresEmail ? 'E-post' : null,
        participantDraft.requiresPhone ? 'Telefon' : null,
        participantDraft.requiresCertification ? 'Certifiering' : null,
      ].filter(Boolean).join(', ')

      return commonShell(
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <OverviewCard label="Intern nyckel" value={participantDraft.key || '-'} />
            <OverviewCard label="Typ" value={participantDraft.roleKind === 'consultant' ? 'Konsult' : 'Entreprenör'} />
            <OverviewCard label="Sortering" value={participantDraft.sortOrder} />
            <OverviewCard label="Status" value={participantDraft.isActive ? 'Aktiv medverkandetyp' : 'Inaktiv medverkandetyp'} />
          </div>
          {activeNode.ref.type === 'rootParticipant' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <OverviewCard label="Koppling till renoveringstyp" value={participantLinkDraft.isRequired ? 'Obligatorisk' : 'Valfri'} />
              <OverviewCard label="Kopplingens sortering" value={participantLinkDraft.sortOrder} />
            </div>
          ) : null}
          <OverviewCard label="Informationskrav" value={requirements || 'Inga särskilda informationskrav'} />
          <OverviewText label="Hjälptext till sökande" value={participantDraft.description} fallback="Ingen hjälptext angiven." />
          <OverviewText label="Granskningsstöd" value={participantDraft.reviewGuidance} fallback="Inget granskningsstöd angivet." />
          <OverviewText label="Verifieringsinstruktion" value={participantDraft.verificationInstructions} fallback="Ingen verifieringsinstruktion angiven." />
          <OverviewCard label="Verifieringslänk" value={participantDraft.verificationUrl || '-'} />
        </>
      )
    }

    if (
      activeNode.ref.type === 'optionReviewFlagTrigger' ||
      activeNode.ref.type === 'actionTypeReviewFlag' ||
      activeNode.ref.type === 'documentReviewFlag' ||
      activeNode.ref.type === 'participantReviewFlag'
    ) {
      return commonShell(
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <OverviewCard label="Intern nyckel" value={reviewFlagDraft.key || '-'} />
            <OverviewCard label="Allvar" value={labelForSeverity(reviewFlagDraft.severity)} />
            <OverviewCard label="Kategori" value={reviewFlagDraft.category || '-'} />
            <OverviewCard label="Status" value={reviewFlagDraft.isActive ? 'Aktiv flagga' : 'Inaktiv flagga'} />
            <OverviewCard label="Sortering" value={reviewFlagDraft.sortOrder} />
            <OverviewCard label="Kopplad från" value={labelForNodeKind(activeNode.kind)} />
          </div>
          <OverviewText label="Beskrivning" value={reviewFlagDraft.description} fallback="Ingen beskrivning angiven." />
        </>
      )
    }

    return commonShell(
      <>
        <p>Här ser du en snabb översikt av den valda noden.</p>
        <p className="text-xs text-stone-500">Använd <span className="font-semibold">Redigera</span> för att ändra innehåll eller <span className="font-semibold">Lägg till</span> för att bygga vidare i flödet.</p>
      </>
    )
  }

  return (
    <main className="w-full px-4 pb-6 pt-3 md:px-6">
      {error ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 lg:hidden">
        Flödesvisaren är byggd för större skärmar.
      </div>

      <div className="hidden space-y-3 lg:block">
        <div className="border-b border-stone-200 pb-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sök renoveringstyp..." className="mr-2 w-48 rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-900" />
            {visibleActionTypes.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedActionTypeId(item.id)} className={cn('rounded-md border px-2 py-1 text-xs font-semibold transition', item.id === selectedActionTypeId ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100')}>
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={openCreateActionTypeModal}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-dashed border-stone-300 bg-white text-lg font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
              aria-label="Skapa ny renoveringstyp"
              title="Skapa ny renoveringstyp"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setAiDrawerOpen(true)}
              className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-3 text-xs font-semibold text-violet-800 transition hover:border-violet-400 hover:bg-violet-100"
            >
              <span aria-hidden>✦</span>
              Bygg/granska med AI
            </button>
          </div>
        </div>

        <details className="rounded-md border border-stone-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-stone-900 hover:bg-stone-50">
            Hjälp för flödesbyggaren
          </summary>
          <div className="border-t border-stone-200 px-4 py-4">
            <FlowBuilderHelpSection />
          </div>
        </details>

        {!selectedAction ? (
          <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center text-sm text-stone-600">Välj en renoveringstyp ovan.</div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-stone-200 pb-2 text-sm">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">Namn</div>
                  <div className="mt-1 font-semibold text-stone-900">{selectedAction.label}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">Nyckel</div>
                  <div className="mt-1 text-stone-700">{selectedAction.key}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setExpandedNodeIds(allExpandableNodeIds)} className="rounded-md border border-stone-300 bg-white px-2.5 py-2 font-semibold text-stone-800 hover:bg-stone-100">Expandera alla</button>
                <button type="button" onClick={() => setExpandedNodeIds([])} className="rounded-md border border-stone-300 bg-white px-2.5 py-2 font-semibold text-stone-800 hover:bg-stone-100">Återställ vy</button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border border-stone-200 bg-slate-100 px-4 py-4">
              <div className="min-w-max">
                <div className="flex items-start gap-4">
                  <FlowNodeCard
                    node={{ id: `action-type:${selectedAction.id}`, kind: 'root', title: selectedAction.label, badges: [`${rootQuestions.length} frågor`, `${rootRequirements.length} underlag`, `${rootParticipants.length} medverkande`], tone: 'stone', children: flowRootChildren, ref: { type: 'actionType' as const, actionTypeId: selectedAction.id } }}
                    expanded
                    onToggle={() => setExpandedNodeIds((current) => (current.length === 0 ? allExpandableNodeIds : []))}
                    onOpen={() => openNodeModal({ id: `action-type:${selectedAction.id}`, kind: 'root', title: selectedAction.label, badges: [`${rootQuestions.length} frågor`, `${rootRequirements.length} underlag`, `${rootParticipants.length} medverkande`], tone: 'stone', children: flowRootChildren, ref: { type: 'actionType' as const, actionTypeId: selectedAction.id } })}
                  />

                  <div className="mt-6 h-px w-6 bg-stone-300" />

                  <div className="space-y-3">
                    {loading ? (
                      <div className="rounded-md border border-stone-300 bg-white px-4 py-3 text-sm text-stone-600">Laddar flöde...</div>
                    ) : flowRootChildren.length > 0 ? (
                      flowRootChildren.map((node) => <HorizontalBranch key={node.id} node={node} expandedNodeIds={expandedNodeIds} onToggle={toggleNode} onOpen={openNodeModal} />)
                    ) : (
                      <div className="rounded-md border border-dashed border-stone-300 bg-white px-4 py-3 text-sm text-stone-600">Inga frågor, underlag eller medverkande är kopplade ännu.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {aiDrawerOpen ? (
        <RenoAppAiFlowDrawer
          currentAction={selectedAction}
          onClose={() => setAiDrawerOpen(false)}
        />
      ) : null}

      {activeNode ? (
        <aside className="fixed inset-y-0 right-0 z-50 hidden w-full max-w-3xl border-l border-stone-200 bg-white shadow-2xl lg:block">
          <div className="h-full overflow-y-auto">
            <div className="flex items-start justify-between border-b border-stone-200 px-6 py-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Nod</div>
                <h2 className="mt-1 text-2xl font-semibold text-stone-900">{activeNode.title}</h2>
                <div className="mt-2 flex flex-wrap gap-1.5">{activeNode.badges.map((badge) => <span key={badge} className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-semibold text-stone-700">{badge}</span>)}</div>
              </div>
              <button type="button" onClick={closeModal} className="rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">Stäng</button>
            </div>

            <div className="space-y-6 px-6 py-5">
              {modalError ? <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{modalError}</div> : null}

              <div className="flex flex-wrap gap-2">
                {canEditNode ? <button type="button" onClick={() => setModalMode('edit')} className={cn('rounded-md border px-3 py-2 text-sm font-semibold', modalMode === 'edit' ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100')}>Redigera</button> : null}
                {addableTypes.length > 0 ? <button type="button" onClick={() => setModalMode('add')} className={cn('rounded-md border px-3 py-2 text-sm font-semibold', modalMode === 'add' ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100')}>Lägg till</button> : null}
                <button type="button" onClick={() => setModalMode('summary')} className={cn('rounded-md border px-3 py-2 text-sm font-semibold', modalMode === 'summary' ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100')}>Översikt</button>
                {canDuplicateNode ? <button type="button" onClick={() => { if (window.confirm('Skapa en fristående kopia av detta objekt?')) void duplicateActiveNode() }} className="rounded-md border border-sky-300 bg-white px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50">Skapa kopia</button> : null}
                {canDeleteOption ? <button type="button" onClick={() => { if (window.confirm('Radera detta svarsalternativ?')) void deleteOptionNode() }} className="rounded-md border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">Radera svar</button> : null}
                {canDeleteObject ? <button type="button" onClick={() => { if (window.confirm('Radera objektet överallt? Detta påverkar alla flöden och kopplingar som använder det.')) void deleteActiveObject() }} className="rounded-md border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">Radera överallt</button> : null}
                {canRemoveConnection ? <button type="button" onClick={() => { if (window.confirm('Ta bort denna koppling från det här flödet? Själva objektet finns kvar i systemet.')) void removeConnection() }} className="rounded-md border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">Ta bort från flödet</button> : null}
              </div>

              {modalMode === 'summary' ? renderOverview() : null}

              {modalMode === 'edit' && canEditNode ? (
                <div className="space-y-4">
                  {activeNode?.ref.type === 'actionType' ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <ModalField label="Visningsnamn">
                        <input
                          value={actionTypeDraft.label}
                          onChange={(event) => setActionTypeDraft((current) => ({ ...current, label: event.target.value }))}
                          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
                        />
                      </ModalField>
                      <ModalField label="Intern nyckel">
                        <input
                          value={generatedActionTypeKey(actionTypeDraft)}
                          readOnly
                          className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm"
                        />
                      </ModalField>
                      <ModalField label="Beskrivning">
                        <textarea value={actionTypeDraft.description} onChange={(event) => setActionTypeDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" />
                      </ModalField>
                      <ModalField label="Risknivå">
                        <select value={actionTypeDraft.riskLevel} onChange={(event) => setActionTypeDraft((current) => ({ ...current, riskLevel: event.target.value as ActionTypeDraft['riskLevel'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm">
                          <option value="low">Låg</option>
                          <option value="medium">Medel</option>
                          <option value="high">Hög</option>
                        </select>
                      </ModalField>
                      <ModalField label="Entreprenörskrav">
                        <select value={actionTypeDraft.contractorRequirement} onChange={(event) => setActionTypeDraft((current) => ({ ...current, contractorRequirement: event.target.value as ActionTypeDraft['contractorRequirement'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm">
                          <option value="none">Inget generellt krav</option>
                          <option value="qualified_contractor">Kvalificerad entreprenör</option>
                          <option value="authorized_electrician">Registrerat elinstallationsföretag</option>
                          <option value="safe_water">Säker Vatten</option>
                          <option value="bkr_or_gvk">BKR eller GVK</option>
                          <option value="structural_engineer">Konstruktör</option>
                        </select>
                      </ModalField>
                      <div className="grid gap-2 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700 md:col-span-2 md:grid-cols-3">
                        {([
                          ['impliesStructure', 'Berör konstruktion'],
                          ['impliesPlumbing', 'Berör VA'],
                          ['impliesVentilation', 'Berör ventilation'],
                          ['impliesElectrical', 'Berör el'],
                          ['impliesWetRoom', 'Berör våtrum'],
                        ] as const).map(([key, label]) => (
                          <label key={key} className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={actionTypeDraft[key]}
                              onChange={(event) => setActionTypeDraft((current) => ({
                                ...current,
                                [key]: event.target.checked,
                                ...(event.target.checked ? { impliesSurfaceOnly: false } : {}),
                              }))}
                              className="h-4 w-4 rounded border-stone-300"
                            />
                            {label}
                          </label>
                        ))}
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={actionTypeDraft.impliesSurfaceOnly}
                            onChange={(event) => setActionTypeDraft((current) => ({
                              ...current,
                              impliesSurfaceOnly: event.target.checked,
                              ...(event.target.checked
                                ? {
                                    impliesStructure: false,
                                    impliesPlumbing: false,
                                    impliesVentilation: false,
                                    impliesElectrical: false,
                                    impliesWetRoom: false,
                                  }
                                : {}),
                            }))}
                            className="h-4 w-4 rounded border-stone-300"
                          />
                          Endast ytskikt
                        </label>
                      </div>
                      <ModalField label="Sortering">
                        <input value={actionTypeDraft.sortOrder} onChange={(event) => setActionTypeDraft((current) => ({ ...current, sortOrder: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <label className="inline-flex items-center gap-2 text-sm text-stone-700">
                        <input type="checkbox" checked={actionTypeDraft.isActive} onChange={(event) => setActionTypeDraft((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                        Aktiv renoveringstyp
                      </label>
                    </div>
                  ) : null}
                  {(activeNode?.ref.type === 'rootQuestion' || activeNode?.ref.type === 'question' || activeNode?.ref.type === 'optionQuestionTrigger') ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <ModalField label="Visningsnamn">
                        <input value={questionDraft.label} onChange={(event) => setQuestionDraft((current) => ({ ...current, label: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Intern nyckel">
                        <input value={generatedQuestionKey(questionDraft)} readOnly className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Hjälptext">
                        <textarea value={questionDraft.helpText} onChange={(event) => setQuestionDraft((current) => ({ ...current, helpText: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" />
                      </ModalField>
                      <ModalField label="Svarstyp">
                        <select value={questionDraft.responseType} onChange={(event) => setQuestionDraft((current) => ({ ...current, responseType: event.target.value as QuestionDraft['responseType'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm">
                          <option value="single_select">Ett val</option>
                          <option value="multi_select">Flera val</option>
                          <option value="boolean">Ja/nej</option>
                        </select>
                      </ModalField>
                      <ModalField label="Sortering">
                        <input value={questionDraft.sortOrder} onChange={(event) => setQuestionDraft((current) => ({ ...current, sortOrder: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <label className="inline-flex items-center gap-2 text-sm text-stone-700">
                        <input type="checkbox" checked={questionDraft.isActive} onChange={(event) => setQuestionDraft((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                        Aktiv fråga
                      </label>
                      {activeNode?.ref.type === 'rootQuestion' ? (
                        <div className="grid gap-4 rounded-xl border border-stone-200 bg-stone-50 p-4 md:col-span-2 md:grid-cols-2">
                          <label className="inline-flex items-center gap-2 text-sm text-stone-700">
                            <input type="checkbox" checked={questionLinkDraft.isRequired} onChange={(event) => setQuestionLinkDraft((current) => ({ ...current, isRequired: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                            Obligatorisk i denna renoveringstyp
                          </label>
                          <ModalField label="Kopplingens sortering">
                            <input value={questionLinkDraft.sortOrder} onChange={(event) => setQuestionLinkDraft((current) => ({ ...current, sortOrder: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                          </ModalField>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {activeNode?.ref.type === 'option' ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <ModalField label="Svarstext">
                        <input value={optionDraft.label} onChange={(event) => setOptionDraft((current) => ({ ...current, label: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Intern nyckel">
                        <input value={generatedOptionKey(optionDraft)} readOnly className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Beskrivning">
                        <textarea value={optionDraft.description} onChange={(event) => setOptionDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" />
                      </ModalField>
                      <ModalField label="Sortering">
                        <input value={optionDraft.sortOrder} onChange={(event) => setOptionDraft((current) => ({ ...current, sortOrder: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <label className="inline-flex items-center gap-2 text-sm text-stone-700">
                        <input type="checkbox" checked={optionDraft.isActive} onChange={(event) => setOptionDraft((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                        Aktivt svarsalternativ
                      </label>
                    </div>
                  ) : null}
                  {(activeNode?.ref.type === 'rootRequirement' || activeNode?.ref.type === 'optionDocumentTrigger') ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <ModalField label="Visningsnamn">
                        <input value={documentDraft.label} onChange={(event) => setDocumentDraft((current) => ({ ...current, label: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Intern nyckel">
                        <input value={generatedDocumentKey(documentDraft)} readOnly className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Hjälpttext till sökande">
                        <textarea value={documentDraft.description} onChange={(event) => setDocumentDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" />
                      </ModalField>
                      <ModalField label="Granskningsstöd">
                        <textarea value={documentDraft.reviewGuidance} onChange={(event) => setDocumentDraft((current) => ({ ...current, reviewGuidance: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" />
                      </ModalField>
                      <ModalField label="Standardfas">
                        <select value={documentDraft.defaultPhase} onChange={(event) => setDocumentDraft((current) => ({ ...current, defaultPhase: event.target.value as DocumentDraft['defaultPhase'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="before_required">Före</option><option value="during_execution">Under</option><option value="after_completion">Efter</option></select>
                      </ModalField>
                      <ModalField label="Sortering">
                        <input value={documentDraft.sortOrder} onChange={(event) => setDocumentDraft((current) => ({ ...current, sortOrder: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <label className="inline-flex items-center gap-2 text-sm text-stone-700 md:col-span-2">
                        <input type="checkbox" checked={documentDraft.isActive} onChange={(event) => setDocumentDraft((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                        Aktiv underlagstyp
                      </label>
                      {activeNode?.ref.type === 'rootRequirement' ? (
                        <>
                          <label className="inline-flex items-center gap-2 text-sm text-stone-700">
                            <input type="checkbox" checked={requirementLinkDraft.isRequired} onChange={(event) => setRequirementLinkDraft((current) => ({ ...current, isRequired: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                            Obligatoriskt i denna renoveringstyp
                          </label>
                          <ModalField label="Kopplingens sortering">
                            <input value={requirementLinkDraft.sortOrder} onChange={(event) => setRequirementLinkDraft((current) => ({ ...current, sortOrder: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                          </ModalField>
                          <ModalField label="Notering">
                            <textarea value={requirementLinkDraft.note} onChange={(event) => setRequirementLinkDraft((current) => ({ ...current, note: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" />
                          </ModalField>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {(activeNode?.ref.type === 'rootParticipant' || activeNode?.ref.type === 'optionParticipantTrigger') ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="inline-flex items-center gap-2 text-sm text-stone-700 md:col-span-2">
                        <input type="checkbox" checked={participantDraft.isActive} onChange={(event) => setParticipantDraft((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                        Aktiv
                      </label>
                      <ModalField label="Visningsnamn">
                        <input value={participantDraft.label} onChange={(event) => setParticipantDraft((current) => ({ ...current, label: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Intern nyckel">
                        <input value={generatedParticipantKey(participantDraft)} readOnly className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Hjälpttext till sökande">
                        <textarea value={participantDraft.description} onChange={(event) => setParticipantDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" />
                      </ModalField>
                      <ModalField label="Granskningsstöd">
                        <textarea value={participantDraft.reviewGuidance} onChange={(event) => setParticipantDraft((current) => ({ ...current, reviewGuidance: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" />
                      </ModalField>
                      <ModalField label="Typ">
                        <select value={participantDraft.roleKind} onChange={(event) => setParticipantDraft((current) => ({ ...current, roleKind: event.target.value as ParticipantDraft['roleKind'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="contractor">Entreprenör</option><option value="consultant">Konsult</option></select>
                      </ModalField>
                      <ModalField label="Verifieringsinstruktion">
                        <textarea value={participantDraft.verificationInstructions} onChange={(event) => setParticipantDraft((current) => ({ ...current, verificationInstructions: event.target.value }))} rows={4} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" />
                      </ModalField>
                      <ModalField label="Verifieringslänk">
                        <input value={participantDraft.verificationUrl} onChange={(event) => setParticipantDraft((current) => ({ ...current, verificationUrl: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" />
                      </ModalField>
                      <ModalField label="Sortering">
                        <input value={participantDraft.sortOrder} onChange={(event) => setParticipantDraft((current) => ({ ...current, sortOrder: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <div className="grid gap-2 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700 md:col-span-2 md:grid-cols-2">
                        <label className="inline-flex items-center gap-2">
                          <input type="checkbox" checked={participantDraft.insuranceRequired} onChange={(event) => setParticipantDraft((current) => ({ ...current, insuranceRequired: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                          Försäkringsbevis krävs
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input type="checkbox" checked={participantDraft.requiresCompanyName} onChange={(event) => setParticipantDraft((current) => ({ ...current, requiresCompanyName: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                          Kräver företagsnamn
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input type="checkbox" checked={participantDraft.requiresOrgNumber} onChange={(event) => setParticipantDraft((current) => ({ ...current, requiresOrgNumber: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                          Kräver org.nr
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input type="checkbox" checked={participantDraft.requiresContactName} onChange={(event) => setParticipantDraft((current) => ({ ...current, requiresContactName: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                          Kräver kontaktperson
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input type="checkbox" checked={participantDraft.requiresEmail} onChange={(event) => setParticipantDraft((current) => ({ ...current, requiresEmail: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                          Kräver e-post
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input type="checkbox" checked={participantDraft.requiresPhone} onChange={(event) => setParticipantDraft((current) => ({ ...current, requiresPhone: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                          Kräver telefon
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input type="checkbox" checked={participantDraft.requiresCertification} onChange={(event) => setParticipantDraft((current) => ({ ...current, requiresCertification: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                          Kräver certifiering
                        </label>
                      </div>
                      {activeNode?.ref.type === 'rootParticipant' ? (
                        <div className="grid gap-4 rounded-xl border border-stone-200 bg-stone-50 p-4 md:col-span-2 md:grid-cols-2">
                          <label className="inline-flex items-center gap-2 text-sm text-stone-700">
                            <input type="checkbox" checked={participantLinkDraft.isRequired} onChange={(event) => setParticipantLinkDraft((current) => ({ ...current, isRequired: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                            Obligatorisk i denna renoveringstyp
                          </label>
                          <ModalField label="Kopplingens sortering">
                            <input value={participantLinkDraft.sortOrder} onChange={(event) => setParticipantLinkDraft((current) => ({ ...current, sortOrder: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                          </ModalField>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {activeNode?.ref.type === 'optionReviewFlagTrigger' ||
                  activeNode?.ref.type === 'actionTypeReviewFlag' ||
                  activeNode?.ref.type === 'documentReviewFlag' ||
                  activeNode?.ref.type === 'participantReviewFlag' ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <ModalField label="Visningsnamn">
                        <input value={reviewFlagDraft.label} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, label: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Intern nyckel">
                        <input value={generatedReviewFlagKey(reviewFlagDraft)} readOnly className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Allvar">
                        <select value={reviewFlagDraft.severity} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, severity: event.target.value as ReviewFlagDraft['severity'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="info">Info</option><option value="warning">Varning</option><option value="high">Hög risk</option></select>
                      </ModalField>
                      <ModalField label="Kategori">
                        <input value={reviewFlagDraft.category} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, category: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Sortering">
                        <input value={reviewFlagDraft.sortOrder} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, sortOrder: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Beskrivning">
                        <textarea value={reviewFlagDraft.description} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" />
                      </ModalField>
                      <label className="inline-flex items-center gap-2 text-sm text-stone-700 md:col-span-2">
                        <input type="checkbox" checked={reviewFlagDraft.isActive} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />
                        Aktiv flagga
                      </label>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setModalMode('summary')} className="rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">Avbryt</button>
                    <button type="button" onClick={() => void saveEdit()} disabled={modalSaving} className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{modalSaving ? 'Sparar...' : 'Spara'}</button>
                  </div>
                </div>
              ) : null}

              {modalMode === 'add' && addableTypes.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {addableTypes.map((type) => (
                      <button key={type} type="button" onClick={() => { setAddType(type); setExistingTargetId(''); setAddMode(type === 'option' ? 'new' : 'existing'); setAddPreviewQuestionId(null); setDuplicateQuestionSourceId(null); setFlagTargetOptionId(type === 'flag' ? activeQuestionSummary?.options[0]?.id ?? '' : ''); if (type === 'question') setQuestionOptionDrafts([createQuestionOptionDraft()]) }} className={cn('rounded-md border px-3 py-2 text-sm font-semibold', addType === type ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100')}>
                        {type === 'question' ? 'Fråga' : type === 'option' ? 'Svarsalternativ' : type === 'document' ? 'Underlag' : type === 'participant' ? 'Medverkande' : 'Flagga'}
                      </button>
                    ))}
                  </div>
                  {addType !== 'option' ? <div className="flex gap-2">
                    <button type="button" onClick={() => { setAddMode('existing'); setExistingTargetId(''); setAddPreviewQuestionId(null); setDuplicateQuestionSourceId(null) }} className={cn('rounded-md border px-3 py-2 text-sm font-semibold', addMode === 'existing' ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100')}>Lägg till befintlig</button>
                    <button type="button" onClick={() => { setAddMode('new'); setDuplicateQuestionSourceId(null); if (addType === 'question') setQuestionOptionDrafts([createQuestionOptionDraft()]) }} className={cn('rounded-md border px-3 py-2 text-sm font-semibold', addMode === 'new' ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100')}>Skapa ny</button>
                  </div> : null}
                  {addType === 'flag' && activeNode?.ref.type !== 'option' ? (
                    <ModalField label="Flaggan triggas av svar">
                      <select
                        value={flagTargetOptionId}
                        onChange={(event) => setFlagTargetOptionId(event.target.value)}
                        className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
                      >
                        <option value="">Välj svarsalternativ...</option>
                        {(activeQuestionSummary?.options ?? []).map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </ModalField>
                  ) : null}
                  {addMode === 'existing' && addType === 'question' ? (
                    <div className="space-y-4">
                      <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-stone-200 bg-stone-50 p-3">
                        {linkableQuestions.map((item) => (
                          <div key={item.id} className={cn('rounded-lg border px-3 py-3', existingTargetId === item.id ? 'border-stone-900 bg-white' : 'border-stone-200 bg-white')}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-semibold text-stone-900">{item.label}</div>
                                <div className="mt-1 text-xs text-stone-500">{item.key}</div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-semibold text-stone-700">{labelForResponseType(item.responseType)}</span>
                                  <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-semibold text-stone-700">{item.options.length} svar</span>
                                </div>
                              </div>
                              <div className="flex shrink-0 gap-2">
                                <button type="button" onClick={() => { setExistingTargetId(item.id); setAddPreviewQuestionId(item.id) }} className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-800 hover:bg-stone-100">Välj</button>
                                <button type="button" onClick={() => setAddPreviewQuestionId(item.id)} className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-800 hover:bg-stone-100">Öppna</button>
                                <button type="button" onClick={() => { setDuplicateQuestionSourceId(item.id); setQuestionDraft(createDuplicateQuestionDraft(item)); setQuestionOptionDrafts(createQuestionOptionDraftsFromQuestion(item)); setAddMode('new') }} className="rounded-md border border-sky-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50">Skapa kopia</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {addPreviewQuestion ? (
                        <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Förhandsvisning</div>
                            <div className="mt-1 text-lg font-semibold text-stone-900">{addPreviewQuestion.label}</div>
                            {addPreviewQuestion.helpText ? <p className="mt-2 text-sm text-stone-600">{addPreviewQuestion.helpText}</p> : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-semibold text-stone-700">{labelForResponseType(addPreviewQuestion.responseType)}</span>
                            <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-semibold text-stone-700">{addPreviewQuestion.options.length} svarsalternativ</span>
                          </div>
                          <div className="space-y-2">
                            {addPreviewQuestion.options
                              .slice()
                              .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv'))
                              .map((option) => (
                                <div key={option.id} className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                                  <div className="font-semibold text-stone-900">{option.label}</div>
                                  {option.description ? <div className="mt-1 text-stone-600">{option.description}</div> : null}
                                  <div className="mt-1 text-xs text-stone-500">{option.triggers.filter((trigger) => trigger.isActive).length} kopplingar</div>
                                </div>
                              ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : addMode === 'existing' && addType !== 'option' ? (
                    <ModalField label="Välj objekt">
                      <select value={existingTargetId} onChange={(event) => setExistingTargetId(event.target.value)} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="">Välj...</option>{existingAddOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
                    </ModalField>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {addType === 'question' ? <>
                        {duplicateQuestionSourceId ? <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 md:col-span-2">Du skapar nu en kopia av en befintlig fråga. Justera innehållet och spara för att lägga in kopian i flödet.</div> : null}
                        <ModalField label="Visningsnamn"><input value={questionDraft.label} onChange={(event) => setQuestionDraft((current) => ({ ...current, label: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Intern nyckel"><input value={generatedQuestionKey(questionDraft)} readOnly className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Hjälptext"><textarea value={questionDraft.helpText} onChange={(event) => setQuestionDraft((current) => ({ ...current, helpText: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" /></ModalField>
                        <ModalField label="Svarstyp"><select value={questionDraft.responseType} onChange={(event) => setQuestionDraft((current) => ({ ...current, responseType: event.target.value as QuestionDraft['responseType'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="single_select">Ett val</option><option value="multi_select">Flera val</option><option value="boolean">Ja/nej</option></select></ModalField>
                        <ModalField label="Sortering"><input value={questionDraft.sortOrder} onChange={(event) => setQuestionDraft((current) => ({ ...current, sortOrder: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" checked={questionDraft.isActive} onChange={(event) => setQuestionDraft((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />Aktiv fråga</label>
                        <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4 md:col-span-2">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-stone-900">Svarsalternativ</div>
                              <div className="mt-1 text-xs text-stone-500">Lägg till de svar som ska kunna väljas för frågan.</div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setQuestionOptionDrafts((current) => [
                                  ...current,
                                  createQuestionOptionDraft({
                                    label: '',
                                    sortOrder: String((current.length + 1) * 10),
                                  }),
                                ])
                              }
                              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-100"
                            >
                              + Lägg till svar
                            </button>
                          </div>
                          <div className="space-y-3">
                            {questionOptionDrafts.map((option, index) => (
                              <div key={index} className="grid gap-3 rounded-lg border border-stone-200 bg-white p-3 md:grid-cols-[1fr_1fr_90px_auto]">
                                <ModalField label="Svarstext">
                                  <input
                                    value={option.label}
                                    onChange={(event) =>
                                      setQuestionOptionDrafts((current) =>
                                        current.map((item, itemIndex) =>
                                          itemIndex === index ? { ...item, label: event.target.value } : item
                                        )
                                      )
                                    }
                                    className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
                                  />
                                </ModalField>
                                <ModalField label="Intern nyckel">
                                  <input value={generatedOptionKey(option)} readOnly className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm" />
                                </ModalField>
                                <ModalField label="Sortering">
                                  <input
                                    value={option.sortOrder}
                                    onChange={(event) =>
                                      setQuestionOptionDrafts((current) =>
                                        current.map((item, itemIndex) =>
                                          itemIndex === index ? { ...item, sortOrder: event.target.value } : item
                                        )
                                      )
                                    }
                                    className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
                                  />
                                </ModalField>
                                <div className="flex items-end gap-2">
                                  <label className="inline-flex h-9 items-center gap-2 text-sm text-stone-700">
                                    <input
                                      type="checkbox"
                                      checked={option.isActive}
                                      onChange={(event) =>
                                        setQuestionOptionDrafts((current) =>
                                          current.map((item, itemIndex) =>
                                            itemIndex === index ? { ...item, isActive: event.target.checked } : item
                                          )
                                        )
                                      }
                                      className="h-4 w-4 rounded border-stone-300"
                                    />
                                    Aktivt
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => setQuestionOptionDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                                    className="h-9 rounded-md border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                                  >
                                    Ta bort
                                  </button>
                                </div>
                                <ModalField label="Beskrivning">
                                  <textarea
                                    value={option.description}
                                    onChange={(event) =>
                                      setQuestionOptionDrafts((current) =>
                                        current.map((item, itemIndex) =>
                                          itemIndex === index ? { ...item, description: event.target.value } : item
                                        )
                                      )
                                    }
                                    rows={2}
                                    className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-4"
                                  />
                                </ModalField>
                              </div>
                            ))}
                          </div>
                        </div>
                      </> : null}
                      {addType === 'option' ? <>
                        <ModalField label="Svarstext"><input value={optionDraft.label} onChange={(event) => setOptionDraft((current) => ({ ...current, label: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Intern nyckel"><input value={generatedOptionKey(optionDraft)} readOnly className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Beskrivning"><textarea value={optionDraft.description} onChange={(event) => setOptionDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" /></ModalField>
                        <ModalField label="Sortering"><input value={optionDraft.sortOrder} onChange={(event) => setOptionDraft((current) => ({ ...current, sortOrder: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" checked={optionDraft.isActive} onChange={(event) => setOptionDraft((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />Aktivt svarsalternativ</label>
                      </> : null}
                      {addType === 'document' ? <>
                        <ModalField label="Visningsnamn"><input value={documentDraft.label} onChange={(event) => setDocumentDraft((current) => ({ ...current, label: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Intern nyckel"><input value={generatedDocumentKey(documentDraft)} readOnly className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Hjälpttext till sökande"><textarea value={documentDraft.description} onChange={(event) => setDocumentDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" /></ModalField>
                        <ModalField label="Granskningsstöd"><textarea value={documentDraft.reviewGuidance} onChange={(event) => setDocumentDraft((current) => ({ ...current, reviewGuidance: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" /></ModalField>
                        <ModalField label="Standardfas"><select value={documentDraft.defaultPhase} onChange={(event) => setDocumentDraft((current) => ({ ...current, defaultPhase: event.target.value as DocumentDraft['defaultPhase'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="before_required">Före</option><option value="during_execution">Under</option><option value="after_completion">Efter</option></select></ModalField>
                        <ModalField label="Sortering"><input value={documentDraft.sortOrder} onChange={(event) => setDocumentDraft((current) => ({ ...current, sortOrder: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-700 md:col-span-2"><input type="checkbox" checked={documentDraft.isActive} onChange={(event) => setDocumentDraft((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />Aktiv underlagstyp</label>
                      </> : null}
                      {addType === 'participant' ? <>
                        <ModalField label="Visningsnamn"><input value={participantDraft.label} onChange={(event) => setParticipantDraft((current) => ({ ...current, label: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Intern nyckel"><input value={generatedParticipantKey(participantDraft)} readOnly className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Hjälpttext till sökande"><textarea value={participantDraft.description} onChange={(event) => setParticipantDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" /></ModalField>
                        <ModalField label="Granskningsstöd"><textarea value={participantDraft.reviewGuidance} onChange={(event) => setParticipantDraft((current) => ({ ...current, reviewGuidance: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" /></ModalField>
                        <ModalField label="Typ"><select value={participantDraft.roleKind} onChange={(event) => setParticipantDraft((current) => ({ ...current, roleKind: event.target.value as ParticipantDraft['roleKind'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="contractor">Entreprenör</option><option value="consultant">Konsult</option></select></ModalField>
                        <ModalField label="Verifieringsinstruktion"><textarea value={participantDraft.verificationInstructions} onChange={(event) => setParticipantDraft((current) => ({ ...current, verificationInstructions: event.target.value }))} rows={4} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" /></ModalField>
                        <ModalField label="Verifieringslänk"><input value={participantDraft.verificationUrl} onChange={(event) => setParticipantDraft((current) => ({ ...current, verificationUrl: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" /></ModalField>
                        <ModalField label="Sortering"><input value={participantDraft.sortOrder} onChange={(event) => setParticipantDraft((current) => ({ ...current, sortOrder: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" checked={participantDraft.isActive} onChange={(event) => setParticipantDraft((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />Aktiv</label>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" checked={participantDraft.insuranceRequired} onChange={(event) => setParticipantDraft((current) => ({ ...current, insuranceRequired: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />Försäkringsbevis krävs</label>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" checked={participantDraft.requiresCompanyName} onChange={(event) => setParticipantDraft((current) => ({ ...current, requiresCompanyName: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />Kräver företagsnamn</label>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" checked={participantDraft.requiresOrgNumber} onChange={(event) => setParticipantDraft((current) => ({ ...current, requiresOrgNumber: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />Kräver org.nr</label>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" checked={participantDraft.requiresContactName} onChange={(event) => setParticipantDraft((current) => ({ ...current, requiresContactName: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />Kräver kontaktperson</label>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" checked={participantDraft.requiresEmail} onChange={(event) => setParticipantDraft((current) => ({ ...current, requiresEmail: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />Kräver e-post</label>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" checked={participantDraft.requiresPhone} onChange={(event) => setParticipantDraft((current) => ({ ...current, requiresPhone: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />Kräver telefon</label>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" checked={participantDraft.requiresCertification} onChange={(event) => setParticipantDraft((current) => ({ ...current, requiresCertification: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />Kräver certifiering</label>
                      </> : null}
                      {addType === 'flag' ? <>
                        <ModalField label="Visningsnamn"><input value={reviewFlagDraft.label} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, label: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Intern nyckel"><input value={generatedReviewFlagKey(reviewFlagDraft)} readOnly className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Allvar"><select value={reviewFlagDraft.severity} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, severity: event.target.value as ReviewFlagDraft['severity'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="info">Info</option><option value="warning">Varning</option><option value="high">Hög risk</option></select></ModalField>
                        <ModalField label="Kategori"><input value={reviewFlagDraft.category} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, category: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Sortering"><input value={reviewFlagDraft.sortOrder} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, sortOrder: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Beskrivning"><textarea value={reviewFlagDraft.description} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm md:col-span-2" /></ModalField>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-700 md:col-span-2"><input type="checkbox" checked={reviewFlagDraft.isActive} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 rounded border-stone-300" />Aktiv flagga</label>
                      </> : null}
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setModalMode('summary')} className="rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">Avbryt</button>
                    {addMode === 'new' ? (
                      <button
                        type="button"
                        onClick={() => void saveAdd('saveAndNew')}
                        disabled={modalSaving}
                        className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-100 disabled:opacity-60"
                      >
                        {modalSaving ? 'Sparar...' : 'Spara + Ny'}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => void saveAdd()} disabled={modalSaving} className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{modalSaving ? 'Sparar...' : 'Spara'}</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      ) : null}
    </main>
  )
}
