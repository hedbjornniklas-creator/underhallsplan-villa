'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleOff,
  ExternalLink,
  FlaskConical,
  Layers3,
  Link2,
  Loader2,
  PencilLine,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'

export type RenoAppAiFlowMode = 'review' | 'extend' | 'create'

export type RenoAppAiFlowActionContext = {
  id: string
  key?: string | null
  label: string
  description?: string | null
}

export type RenoAppAiFlowChangeOperation = 'add' | 'update' | 'deactivate' | 'reuse'

export type RenoAppAiFlowSource = {
  id: string
  title: string
  url?: string | null
  publisher?: string | null
  sourceType?: string | null
  retrievedAt?: string | null
  effectiveDate?: string | null
  reference?: string | null
  claim?: string | null
  verified?: boolean
  summary?: string | null
  supports?: string[]
}

export type RenoAppAiFlowChange = {
  id: string
  operation: RenoAppAiFlowChangeOperation
  entityType: string
  title: string
  key?: string | null
  path?: string | null
  summary?: string | null
  reason?: string | null
  before?: unknown
  after?: unknown
  sourceIds: string[]
  warnings: string[]
  requiresExpertReview?: boolean
  risk?: 'low' | 'medium' | 'high' | string | null
  validationStatus?: 'valid' | 'warning' | 'blocked' | string | null
}

export type RenoAppAiFlowTestScenario = {
  id: string
  title: string
  description?: string | null
  input?: unknown
  expectedOutcome?: unknown
  warnings: string[]
}

export type RenoAppAiFlowProposal = {
  mode: RenoAppAiFlowMode
  summary: string
  warnings: string[]
  changes: RenoAppAiFlowChange[]
  sources: RenoAppAiFlowSource[]
  testScenarios: RenoAppAiFlowTestScenario[]
  validationIssues?: RenoAppAiFlowValidationIssue[]
  canApply?: boolean
}

export type RenoAppAiFlowValidationIssue = {
  id: string
  code?: string | null
  severity: 'warning' | 'error'
  message: string
  changeId?: string | null
  sourceId?: string | null
}

export type RenoAppAiFlowResult = {
  proposal: RenoAppAiFlowProposal
  snapshotFingerprint?: string | null
  generatedAt?: string | null
  model?: string | null
}

export type RenoAppAiFlowDrawerProps = {
  currentAction: RenoAppAiFlowActionContext | null
  snapshot?: unknown
  snapshotFingerprint?: string
  onClose: () => void
  open?: boolean
  initialInstruction?: string
  initialMode?: RenoAppAiFlowMode
  onProposal?: (result: RenoAppAiFlowResult) => void
}

type DrawerTab = 'summary' | 'changes' | 'sources' | 'test'
type JsonRecord = Record<string, unknown>

type FlowAiProgress = {
  status: string
  message: string
  responseId?: string
  pollCount: number
}

type FlowAiPendingTicket = {
  responseId: string
  mode: RenoAppAiFlowMode
  snapshotFingerprint: string
  status: string
  message: string
  pollAfterMs: number
}

const FLOW_AI_POLL_INTERVAL_MS = 2000
const FLOW_AI_MAX_RETRY_DELAY_MS = 15 * 1000
const FLOW_AI_MAX_TOTAL_WAIT_MS = 9 * 60 * 1000
const FLOW_AI_TRANSIENT_POLL_STATUSES = new Set([429, 502, 503, 504])

const TABS: Array<{ id: DrawerTab; label: string }> = [
  { id: 'summary', label: 'Sammanfattning' },
  { id: 'changes', label: 'Ändringar' },
  { id: 'sources', label: 'Källor' },
  { id: 'test', label: 'Testa' },
]

const MODE_OPTIONS: Array<{
  id: RenoAppAiFlowMode
  label: string
  requiresAction: boolean
}> = [
  { id: 'review', label: 'Granska', requiresAction: true },
  { id: 'extend', label: 'Bygg ut', requiresAction: true },
  { id: 'create', label: 'Skapa nytt', requiresAction: false },
]

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function firstString(record: JsonRecord, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return fallback
}

function optionalString(record: JsonRecord, keys: string[]) {
  const value = firstString(record, keys)
  return value || null
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim())
}

function firstStringList(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const values = stringList(record[key])
    if (values.length > 0) return values
  }
  return []
}

function normalizeMode(value: unknown, fallback: RenoAppAiFlowMode): RenoAppAiFlowMode {
  if (value === 'review' || value === 'extend' || value === 'create') return value
  if (value === 'revise' || value === 'audit') return 'review'
  if (value === 'expand') return 'extend'
  return fallback
}

function normalizeOperation(value: unknown): RenoAppAiFlowChangeOperation {
  if (value === 'update' || value === 'deactivate' || value === 'reuse') return value
  if (value === 'modify' || value === 'replace') return 'update'
  if (value === 'remove' || value === 'disable') return 'deactivate'
  if (value === 'link' || value === 'connect') return 'reuse'
  return 'add'
}

function normalizeSource(value: unknown, index: number): RenoAppAiFlowSource | null {
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim()
    return {
      id: `source-${index + 1}`,
      title: trimmed,
      url: trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : null,
    }
  }
  if (!isRecord(value)) return null

  const url = optionalString(value, ['url', 'href', 'link'])
  return {
    id: firstString(value, ['id', 'key', 'sourceId'], url || `source-${index + 1}`),
    title: firstString(value, ['title', 'name', 'label'], `Källa ${index + 1}`),
    url,
    publisher: optionalString(value, ['publisher', 'authority', 'organization', 'organisation']),
    sourceType: optionalString(value, ['sourceType', 'type', 'category']),
    retrievedAt: optionalString(value, ['retrievedAt', 'accessedAt', 'verifiedAt', 'fetchedAt']),
    effectiveDate: optionalString(value, ['effectiveDate', 'effectiveFrom', 'validFrom']),
    reference: optionalString(value, ['reference', 'section', 'paragraph']),
    claim: optionalString(value, ['claim', 'requirement']),
    verified: typeof value.verified === 'boolean' ? value.verified : undefined,
    summary: optionalString(value, ['summary', 'description', 'excerpt', 'note', 'claim']),
    supports: firstStringList(value, ['supports', 'claims', 'requirements']),
  }
}

function jsonValue(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (value === undefined) continue
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as unknown
      } catch {
        return value
      }
    }
    return value
  }
  return undefined
}

function normalizeChange(value: unknown, index: number): RenoAppAiFlowChange | null {
  if (!isRecord(value)) return null
  const sourceIds = firstStringList(value, ['sourceIds', 'source_refs', 'sourceRefs', 'citations'])
  const operation = normalizeOperation(value.operation ?? value.action ?? value.changeType)
  const key = optionalString(value, ['key', 'targetKey', 'entityKey', 'semanticKey'])

  return {
    id: firstString(value, ['id', 'changeId'], `change-${index + 1}`),
    operation,
    entityType: firstString(value, ['entityType', 'targetType', 'entity', 'kind'], 'flödesdel'),
    title: firstString(value, ['title', 'label', 'name'], key || `Ändring ${index + 1}`),
    key,
    path: optionalString(value, ['path', 'location', 'parentKey', 'parentSemanticKey']),
    summary: optionalString(value, ['summary', 'description', 'change', 'details']),
    reason: optionalString(value, ['reason', 'rationale', 'motivation']),
    before: jsonValue(value, ['before', 'beforeJson', 'previous', 'current']),
    after: jsonValue(value, ['after', 'afterJson', 'proposed', 'payload', 'fieldsJson']),
    sourceIds,
    warnings: firstStringList(value, ['warnings', 'risks']),
    requiresExpertReview: value.requiresExpertReview === true || value.expertReviewRequired === true,
    risk: optionalString(value, ['risk', 'riskLevel']),
    validationStatus: optionalString(value, ['validationStatus', 'status']),
  }
}

function normalizeTestScenario(value: unknown, index: number): RenoAppAiFlowTestScenario | null {
  if (!isRecord(value)) return null
  const expectedParts = {
    documentKeys: stringList(value.expectedDocumentKeys),
    participantKeys: stringList(value.expectedParticipantKeys),
    reviewFlagKeys: stringList(value.expectedReviewFlagKeys),
  }
  const hasExpectedParts = Object.values(expectedParts).some((items) => items.length > 0)
  return {
    id: firstString(value, ['id', 'key', 'scenarioId'], `scenario-${index + 1}`),
    title: firstString(value, ['title', 'name', 'scenario'], `Testfall ${index + 1}`),
    description: optionalString(value, ['description', 'summary', 'purpose']),
    input: value.input ?? value.answers ?? value.given,
    expectedOutcome: value.expectedOutcome ?? value.expected ?? value.outcome ?? (hasExpectedParts ? expectedParts : undefined),
    warnings: firstStringList(value, ['warnings', 'notes']),
  }
}

function normalizeValidationIssue(value: unknown, index: number): RenoAppAiFlowValidationIssue | null {
  if (!isRecord(value)) return null
  const message = firstString(value, ['message', 'description', 'detail'])
  if (!message) return null
  return {
    id: firstString(value, ['id'], `validation-${index + 1}`),
    code: optionalString(value, ['code']),
    severity: value.severity === 'error' ? 'error' : 'warning',
    message,
    changeId: optionalString(value, ['changeId']),
    sourceId: optionalString(value, ['sourceId']),
  }
}

function arrayFrom(record: JsonRecord, keys: string[]): unknown[] {
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[]
  }
  return []
}

function normalizeResult(payload: unknown, fallbackMode: RenoAppAiFlowMode): RenoAppAiFlowResult {
  if (!isRecord(payload)) throw new Error('AI-tjänsten returnerade ett svar i oväntat format.')

  const resultContainer = isRecord(payload.result) ? payload.result : payload
  const dataContainer = isRecord(resultContainer.data) ? resultContainer.data : resultContainer
  const proposal = isRecord(dataContainer.proposal)
    ? dataContainer.proposal
    : isRecord(resultContainer.proposal)
      ? resultContainer.proposal
      : dataContainer

  const sources = arrayFrom(proposal, ['sources', 'references'])
    .map(normalizeSource)
    .filter((item): item is RenoAppAiFlowSource => item !== null)
  const validationIssues = arrayFrom(proposal, ['validationIssues', 'issues'])
    .map(normalizeValidationIssue)
    .filter((item): item is RenoAppAiFlowValidationIssue => item !== null)
  const changes = arrayFrom(proposal, ['changes', 'diff', 'operations'])
    .map(normalizeChange)
    .filter((item): item is RenoAppAiFlowChange => item !== null)
    .map((change) => ({
      ...change,
      warnings: [
        ...change.warnings,
        ...validationIssues.filter((issue) => issue.changeId === change.id).map((issue) => issue.message),
      ],
    }))
  const testScenarios = arrayFrom(proposal, ['testScenarios', 'tests', 'scenarios'])
    .map(normalizeTestScenario)
    .filter((item): item is RenoAppAiFlowTestScenario => item !== null)

  return {
    proposal: {
      mode: normalizeMode(proposal.mode, fallbackMode),
      summary: firstString(proposal, ['summary', 'overview', 'message'], 'AI:n skapade ett flödesförslag.'),
      warnings: firstStringList(proposal, ['warnings', 'risks']),
      changes,
      sources,
      testScenarios,
      validationIssues,
      canApply: typeof proposal.canApply === 'boolean' ? proposal.canApply : undefined,
    },
    snapshotFingerprint: optionalString(resultContainer, ['snapshotFingerprint', 'fingerprint'])
      ?? optionalString(payload, ['snapshotFingerprint', 'fingerprint']),
    generatedAt: optionalString(resultContainer, ['generatedAt', 'createdAt'])
      ?? optionalString(payload, ['generatedAt', 'createdAt']),
    model: optionalString(resultContainer, ['model']) ?? optionalString(payload, ['model']),
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function responsePayloadError(payload: unknown, fallback: string) {
  if (isRecord(payload)) {
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim()
    if (isRecord(payload.error)) {
      const nested = firstString(payload.error, ['message', 'detail'])
      if (nested) return nested
    }
    const message = firstString(payload, ['message', 'detail'])
    if (message) return message
  }
  return fallback
}

async function readResponsePayload(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>
}

function nestedResponseRecord(payload: unknown) {
  if (!isRecord(payload)) return null
  if (isRecord(payload.result)) {
    return isRecord(payload.result.data) ? payload.result.data : payload.result
  }
  return isRecord(payload.data) ? payload.data : payload
}

function hasProposalPayload(payload: unknown) {
  if (!isRecord(payload)) return false
  const nested = nestedResponseRecord(payload)
  if (isRecord(payload.proposal) || isRecord(nested?.proposal)) return true
  return Boolean(
    nested
    && typeof nested.summary === 'string'
    && (Array.isArray(nested.changes) || Array.isArray(nested.sources) || Array.isArray(nested.testScenarios))
  )
}

function pendingStatus(payload: unknown) {
  if (!isRecord(payload)) return ''
  const nested = nestedResponseRecord(payload)
  return firstString(payload, ['status', 'state']) || (nested ? firstString(nested, ['status', 'state']) : '')
}

function numericResponseValue(payload: unknown, keys: string[]) {
  if (!isRecord(payload)) return null
  const nested = nestedResponseRecord(payload)
  for (const record of nested && nested !== payload ? [payload, nested] : [payload]) {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value)
        if (Number.isFinite(parsed) && parsed >= 0) return parsed
      }
    }
  }
  return null
}

function retryAfterHeaderMs(response: Response) {
  const value = response.headers.get('Retry-After')?.trim()
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return Math.max(0, date.getTime() - Date.now())
}

function suggestedPollDelayMs(response: Response, payload: unknown, fallback = FLOW_AI_POLL_INTERVAL_MS) {
  const retryAfter = retryAfterHeaderMs(response)
  const pollAfter = numericResponseValue(payload, ['pollAfterMs'])
  const suggested = retryAfter ?? pollAfter ?? fallback
  return Math.min(FLOW_AI_MAX_RETRY_DELAY_MS, Math.max(500, suggested))
}

function progressMessageForStatus(status: string, payload: unknown, pollCount: number) {
  const nested = nestedResponseRecord(payload)
  const explicit = nested
    ? firstString(nested, ['progressMessage', 'statusMessage', 'message'])
    : ''
  if (explicit) return explicit

  const normalized = status.toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
  if (normalized === 'queued' || normalized === 'pending') {
    return 'Analysen väntar kort i OpenAI-kön. Status kontrolleras automatiskt.'
  }
  if (normalized === 'validating' || normalized === 'finalizing') {
    return 'Kontrollerar ändringsförslaget, källorna och testfallen.'
  }
  if (normalized === 'searching' || normalized === 'researching') {
    return 'Söker källstöd och jämför regelverk med det valda flödet.'
  }
  if (normalized === 'processing' || normalized === 'in_progress' || normalized === 'running') {
    return pollCount > 2
      ? 'AI:n arbetar fortfarande med analysen. Omfattande källkontroller kan ta flera minuter.'
      : 'AI:n analyserar flödet och bygger ett granskningsbart förslag.'
  }
  return pollCount > 0
    ? 'Analysen pågår. Kontrollerar om förslaget är klart…'
    : 'Förbereder flödet och startar AI-analysen…'
}

function progressStatusLabel(status: string) {
  const normalized = status.toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
  if (normalized === 'retrying') return 'Återansluter'
  if (normalized === 'queued' || normalized === 'pending') return 'Väntar i kö'
  if (normalized === 'validating' || normalized === 'finalizing') return 'Validerar förslag'
  if (normalized === 'searching' || normalized === 'researching') return 'Kontrollerar källor'
  if (normalized === 'processing' || normalized === 'in_progress' || normalized === 'running') return 'Analys pågår'
  return 'Startar analys'
}

function isTerminalFailureStatus(status: string) {
  const normalized = status.toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
  return normalized === 'failed'
    || normalized === 'cancelled'
    || normalized === 'canceled'
    || normalized === 'expired'
    || normalized === 'incomplete'
}

function pendingTicket(
  payload: unknown,
  fallbackMode: RenoAppAiFlowMode,
  fallbackFingerprint: string
): FlowAiPendingTicket | null {
  if (!isRecord(payload)) return null
  const nested = nestedResponseRecord(payload) ?? payload
  const responseId = firstString(payload, ['responseId', 'id'])
    || firstString(nested, ['responseId', 'id'])
  if (!responseId) return null
  const status = pendingStatus(payload) || 'queued'
  return {
    responseId,
    mode: normalizeMode(payload.mode ?? nested.mode, fallbackMode),
    snapshotFingerprint: firstString(payload, ['snapshotFingerprint', 'fingerprint'])
      || firstString(nested, ['snapshotFingerprint', 'fingerprint'])
      || fallbackFingerprint,
    status,
    message: progressMessageForStatus(status, payload, 0),
    pollAfterMs: numericResponseValue(payload, ['pollAfterMs']) ?? FLOW_AI_POLL_INTERVAL_MS,
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function pollForProposal({
  ticket,
  actionTypeId,
  signal,
  onProgress,
}: {
  ticket: FlowAiPendingTicket
  actionTypeId: string | null
  signal: AbortSignal
  onProgress: (progress: FlowAiProgress) => void
}) {
  let pollCount = 0
  let transientFailureCount = 0
  const pollingStartedAt = Date.now()
  let nextPollDelayMs = Math.min(
    FLOW_AI_MAX_RETRY_DELAY_MS,
    Math.max(500, ticket.pollAfterMs)
  )

  while (!signal.aborted) {
    if (Date.now() - pollingStartedAt >= FLOW_AI_MAX_TOTAL_WAIT_MS) {
      throw new Error('AI-körningen har tagit för lång tid och statuskontrollen stoppades. Starta en ny granskning.')
    }
    await abortableDelay(nextPollDelayMs, signal)
    pollCount += 1

    const search = new URLSearchParams({
      responseId: ticket.responseId,
      mode: ticket.mode,
      snapshotFingerprint: ticket.snapshotFingerprint,
    })
    if (actionTypeId) search.set('actionTypeId', actionTypeId)

    const response = await fetch(`/api/renoapp/admin/flow-ai?${search.toString()}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
    const payload = await readResponsePayload(response)
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

    if (response.ok && hasProposalPayload(payload)) return normalizeResult(payload, ticket.mode)

    const status = pendingStatus(payload) || (response.status === 202 ? 'processing' : '')
    if (isTerminalFailureStatus(status)) {
      throw new Error(responsePayloadError(payload, 'AI-analysen avslutades utan något förslag.'))
    }
    if (FLOW_AI_TRANSIENT_POLL_STATUSES.has(response.status)) {
      transientFailureCount += 1
      const exponentialDelay = Math.min(
        30_000,
        FLOW_AI_POLL_INTERVAL_MS * (2 ** Math.min(transientFailureCount - 1, 4))
      )
      nextPollDelayMs = Math.min(
        FLOW_AI_MAX_RETRY_DELAY_MS,
        Math.max(exponentialDelay, suggestedPollDelayMs(response, payload))
      )
      onProgress({
        status: 'retrying',
        message: `Statuskontrollen svarade tillfälligt inte (${response.status}). Körningen finns kvar och vi försöker igen om cirka ${Math.ceil(nextPollDelayMs / 1000)} sekunder.`,
        responseId: ticket.responseId,
        pollCount,
      })
      continue
    }
    if (!response.ok && response.status !== 202) {
      throw new Error(responsePayloadError(payload, 'Kunde inte hämta status för AI-analysen.'))
    }
    if (response.status === 200 && status.toLowerCase() === 'completed') {
      throw new Error('AI-analysen slutfördes men något förslag kunde inte hämtas.')
    }

    transientFailureCount = 0
    nextPollDelayMs = suggestedPollDelayMs(response, payload)
    onProgress({
      status: status || 'processing',
      message: progressMessageForStatus(status, payload, pollCount),
      responseId: ticket.responseId,
      pollCount,
    })
  }

  throw new DOMException('Aborted', 'AbortError')
}

function operationLabel(operation: RenoAppAiFlowChangeOperation) {
  if (operation === 'update') return 'Ändra'
  if (operation === 'deactivate') return 'Inaktivera'
  if (operation === 'reuse') return 'Återanvänd'
  return 'Lägg till'
}

function operationTone(operation: RenoAppAiFlowChangeOperation) {
  if (operation === 'update') return 'border-sky-200 bg-sky-50 text-sky-800'
  if (operation === 'deactivate') return 'border-rose-200 bg-rose-50 text-rose-800'
  if (operation === 'reuse') return 'border-violet-200 bg-violet-50 text-violet-800'
  return 'border-emerald-200 bg-emerald-50 text-emerald-800'
}

function OperationIcon({ operation }: { operation: RenoAppAiFlowChangeOperation }) {
  if (operation === 'update') return <PencilLine size={15} aria-hidden />
  if (operation === 'deactivate') return <CircleOff size={15} aria-hidden />
  if (operation === 'reuse') return <Link2 size={15} aria-hidden />
  return <PlusCircle size={15} aria-hidden />
}

function entityLabel(value: string) {
  const normalized = value.toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
  const labels: Record<string, string> = {
    action: 'Renoveringstyp',
    action_type: 'Renoveringstyp',
    actiontype: 'Renoveringstyp',
    question: 'Fråga',
    option: 'Svarsalternativ',
    question_option: 'Svarsalternativ',
    document: 'Underlag',
    document_type: 'Underlag',
    requirement: 'Underlag',
    participant: 'Medverkande',
    participant_role: 'Medverkande',
    review_flag: 'Granskningsflagga',
    trigger: 'Villkor',
    connection: 'Koppling',
    action_question_link: 'Frågekoppling',
    action_document_link: 'Underlagskoppling',
    action_participant_link: 'Medverkandekoppling',
    option_trigger: 'Villkor',
    review_flag_link: 'Flaggkoppling',
    metadata: 'Klassificering',
  }
  return labels[normalized] ?? value
}

function sourceTypeLabel(value?: string | null) {
  if (!value) return null
  const normalized = value.toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
  const labels: Record<string, string> = {
    law: 'Lag',
    regulation: 'Föreskrift',
    authority: 'Myndighet',
    authority_guidance: 'Myndighetsvägledning',
    industry: 'Branschpraxis',
    industry_practice: 'Branschpraxis',
    standard: 'Standard',
    municipal: 'Kommunalt krav',
    organization_policy: 'Organisationsregel',
    local_policy: 'Lokalt krav',
    brf_policy: 'Föreningsregel',
  }
  return labels[normalized] ?? value
}

function formatTimestamp(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function safeExternalUrl(value?: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function displayValue(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'string') return value
  try {
    const serialized = JSON.stringify(value, null, 2)
    return serialized.length > 5000 ? `${serialized.slice(0, 5000)}\n…` : serialized
  } catch {
    return String(value)
  }
}

function ChangeValue({ label, value, tone }: { label: string; value: unknown; tone: 'before' | 'after' }) {
  const content = displayValue(value)
  if (!content) return null
  return (
    <div>
      <p className={`mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${tone === 'after' ? 'text-violet-700' : 'text-stone-500'}`}>
        {label}
      </p>
      <pre className={`max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border px-3 py-2.5 font-sans text-xs leading-5 ${tone === 'after' ? 'border-violet-200 bg-violet-50/60 text-stone-900' : 'border-stone-200 bg-stone-50 text-stone-700'}`}>
        {content}
      </pre>
    </div>
  )
}

export default function RenoAppAiFlowDrawer({
  currentAction,
  snapshot,
  snapshotFingerprint = '',
  onClose,
  open = true,
  initialInstruction = '',
  initialMode,
  onProposal,
}: RenoAppAiFlowDrawerProps) {
  const contextualDefaultMode = initialMode ?? (currentAction ? 'review' : 'create')
  const titleId = useId()
  const tabPrefix = useId()
  const instructionRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [instruction, setInstruction] = useState(initialInstruction)
  const [mode, setMode] = useState<RenoAppAiFlowMode>(contextualDefaultMode)
  const [activeTab, setActiveTab] = useState<DrawerTab>('summary')
  const [result, setResult] = useState<RenoAppAiFlowResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<FlowAiProgress | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const closeDrawer = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => instructionRef.current?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      const activeController = abortRef.current
      abortRef.current = null
      activeController?.abort()
      previousFocus?.focus()
    }
  }, [closeDrawer, open])

  useEffect(() => {
    const activeController = abortRef.current
    abortRef.current = null
    activeController?.abort()
    setInstruction(initialInstruction)
    setMode(contextualDefaultMode)
    setActiveTab('summary')
    setResult(null)
    setLoading(false)
    setProgress(null)
    setNotice(null)
    setError(null)
  }, [contextualDefaultMode, currentAction?.id, initialInstruction, snapshotFingerprint])

  const stopWaiting = useCallback(() => {
    const activeController = abortRef.current
    abortRef.current = null
    activeController?.abort()
    setLoading(false)
    setProgress(null)
    setNotice('Du slutade vänta på resultatet. AI-körningen kan fortsätta en kort stund, men inga flödesändringar sparas.')
  }, [])

  const changesByOperation = useMemo(() => {
    const counts: Record<RenoAppAiFlowChangeOperation, number> = {
      add: 0,
      update: 0,
      deactivate: 0,
      reuse: 0,
    }
    for (const change of result?.proposal.changes ?? []) counts[change.operation] += 1
    return counts
  }, [result])

  const sourceMap = useMemo(
    () => new Map((result?.proposal.sources ?? []).map((source) => [source.id, source])),
    [result]
  )

  const fingerprintMismatch = Boolean(
    result?.snapshotFingerprint
    && snapshotFingerprint
    && result.snapshotFingerprint !== snapshotFingerprint
  )

  const submitPrompt = async () => {
    const normalizedInstruction = instruction.trim()
    if (normalizedInstruction.length < 3) {
      setError('Beskriv vad AI:n ska skapa, granska eller bygga ut.')
      instructionRef.current?.focus()
      return
    }
    if ((mode === 'review' || mode === 'extend') && !currentAction) {
      setError('Välj en renoveringstyp för att granska eller bygga ut ett befintligt flöde.')
      return
    }

    const previousController = abortRef.current
    abortRef.current = null
    previousController?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setProgress({
      status: 'starting',
      message: 'Förbereder flödet och startar AI-analysen…',
      pollCount: 0,
    })
    setNotice(null)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/renoapp/admin/flow-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({
          instruction: normalizedInstruction,
          mode,
          actionTypeId: mode === 'create' ? null : currentAction?.id ?? null,
          snapshot,
          snapshotFingerprint,
        }),
      })
      const payload = await readResponsePayload(response)
      if (controller.signal.aborted) return
      if (!response.ok && response.status !== 202) {
        throw new Error(responsePayloadError(payload, 'Kunde inte skapa AI-förslaget.'))
      }

      let parsed: RenoAppAiFlowResult
      if (hasProposalPayload(payload)) {
        parsed = normalizeResult(payload, mode)
      } else {
        const status = pendingStatus(payload)
        if (isTerminalFailureStatus(status)) {
          throw new Error(responsePayloadError(payload, 'AI-analysen avslutades utan något förslag.'))
        }
        const ticket = pendingTicket(payload, mode, snapshotFingerprint)
        if (!ticket) {
          throw new Error('AI-tjänsten startade ingen spårbar analys. Försök igen.')
        }
        setProgress({
          status: ticket.status,
          message: ticket.message,
          responseId: ticket.responseId,
          pollCount: 0,
        })
        parsed = await pollForProposal({
          ticket,
          actionTypeId: mode === 'create' ? null : currentAction?.id ?? null,
          signal: controller.signal,
          onProgress: setProgress,
        })
      }

      if (controller.signal.aborted) return
      setResult(parsed)
      setProgress(null)
      setActiveTab('summary')
      onProposal?.(parsed)
    } catch (submitError) {
      if (submitError instanceof DOMException && submitError.name === 'AbortError') return
      setProgress(null)
      setError(errorMessage(submitError, 'Kunde inte skapa AI-förslaget. Försök igen.'))
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setLoading(false)
        setProgress(null)
      }
    }
  }

  if (!open) return null

  const proposal = result?.proposal ?? null
  const modePlaceholder = mode === 'create'
    ? 'Exempel: Skapa ett komplett flöde för installation av hiss i lägenhet.'
    : mode === 'extend'
      ? `Exempel: Lägg till frågor om våtrum och gemensamma system i ${currentAction?.label ?? 'det valda flödet'}.`
      : `Exempel: Granska ${currentAction?.label ?? 'det valda flödet'} mot aktuella regelverk och branschpraxis.`

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-end bg-stone-950/35"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeDrawer()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full w-full flex-col bg-white shadow-2xl sm:max-w-3xl sm:border-l sm:border-stone-200"
      >
        <header className="shrink-0 border-b border-stone-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700">
                <Sparkles size={20} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">AI-assistent</p>
                <h2 id={titleId} className="mt-1 truncate text-xl font-semibold text-stone-950">
                  Bygg och granska flöden
                </h2>
                <p className="mt-1 text-sm leading-5 text-stone-600">
                  {currentAction ? `Arbetar med ${currentAction.label}` : 'Skapa ett förslag till en ny renoveringstyp'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={closeDrawer}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-violet-200"
              aria-label="Stäng AI-assistenten"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
            <ShieldCheck size={14} aria-hidden />
            Förslag – inga ändringar har sparats
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-5 px-4 py-5 sm:px-6">
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void submitPrompt()
              }}
              className="space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-4"
            >
              <fieldset>
                <legend className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Uppgift</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {MODE_OPTIONS.map((option) => {
                    const disabled = option.requiresAction && !currentAction
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={disabled || loading}
                        onClick={() => setMode(option.id)}
                        className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${mode === option.id ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'} disabled:cursor-not-allowed disabled:opacity-40`}
                        aria-pressed={mode === option.id}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <div>
                <label htmlFor={`${titleId}-instruction`} className="block text-sm font-semibold text-stone-900">
                  Vad vill du att AI:n ska göra?
                </label>
                <textarea
                  ref={instructionRef}
                  id={`${titleId}-instruction`}
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  disabled={loading}
                  rows={4}
                  placeholder={modePlaceholder}
                  className="mt-2 w-full resize-y rounded-md border border-stone-300 bg-white px-3 py-3 text-sm leading-6 text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-stone-100"
                />
                <p className="mt-1.5 text-xs leading-5 text-stone-500">
                  Skriv gärna omfattning, särskilda risker eller föreningsregler som ska beaktas.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={loading || instruction.trim().length < 3}
                  className="inline-flex h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:cursor-not-allowed disabled:bg-stone-300"
                >
                  {loading ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Sparkles size={17} aria-hidden />}
                  {loading ? 'Tar fram förslag…' : result ? 'Skapa nytt förslag' : 'Skapa förslag'}
                </button>
                {result ? (
                  <span className="text-xs text-stone-500">
                    Ett nytt förslag ersätter bara förhandsvisningen nedan.
                  </span>
                ) : null}
              </div>
            </form>

            {error ? (
              <div role="alert" className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm leading-5 text-rose-800">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            ) : null}

            {notice ? (
              <div role="status" className="flex gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-3 text-sm leading-5 text-stone-700">
                <ShieldCheck size={17} className="mt-0.5 shrink-0 text-stone-500" aria-hidden />
                <span>{notice}</span>
              </div>
            ) : null}

            {loading ? (
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-5" aria-live="polite">
                <div className="flex items-start gap-3">
                  <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin text-violet-700" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-700">
                      {progressStatusLabel(progress?.status ?? 'starting')}
                    </p>
                    <h3 className="mt-1 font-semibold text-stone-950">Tar fram ett källstyrt flödesförslag</h3>
                    <p className="mt-1 text-sm leading-6 text-stone-700">
                      {progress?.message ?? 'Förbereder flödet och startar AI-analysen…'}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-stone-600">
                      Håll panelen öppen för att få resultatet. Om du slutar vänta eller stänger visas inte den pågående analysen här.
                    </p>
                    <button
                      type="button"
                      onClick={stopWaiting}
                      className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-violet-300 bg-white px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-200"
                    >
                      <X size={14} aria-hidden />
                      Sluta vänta
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {!loading && !result ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { icon: Layers3, title: 'Struktur', text: 'Frågor, villkor, underlag och medverkande.' },
                  { icon: BookOpen, title: 'Källstöd', text: 'Regelverk och praxis redovisas separat.' },
                  { icon: FlaskConical, title: 'Testfall', text: 'Exempelsvar visar hur förslaget faller ut.' },
                ].map((item) => (
                  <div key={item.title} className="rounded-lg border border-stone-200 bg-white p-4">
                    <item.icon size={18} className="text-violet-700" aria-hidden />
                    <h3 className="mt-3 text-sm font-semibold text-stone-900">{item.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-stone-600">{item.text}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {result && proposal ? (
              <div className="space-y-5">
                <div className="overflow-x-auto border-b border-stone-200" role="tablist" aria-label="AI-förslagets innehåll">
                  <div className="flex min-w-max gap-1">
                    {TABS.map((tab) => {
                      const count = tab.id === 'changes'
                        ? proposal.changes.length
                        : tab.id === 'sources'
                          ? proposal.sources.length
                          : tab.id === 'test'
                            ? proposal.testScenarios.length
                            : null
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          id={`${tabPrefix}-${tab.id}-tab`}
                          aria-controls={`${tabPrefix}-${tab.id}-panel`}
                          aria-selected={activeTab === tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`border-b-2 px-3 py-2.5 text-sm font-semibold transition ${activeTab === tab.id ? 'border-violet-700 text-violet-800' : 'border-transparent text-stone-600 hover:border-stone-300 hover:text-stone-900'}`}
                        >
                          {tab.label}{count === null ? '' : ` (${count})`}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {activeTab === 'summary' ? (
                  <section
                    role="tabpanel"
                    id={`${tabPrefix}-summary-panel`}
                    aria-labelledby={`${tabPrefix}-summary-tab`}
                    className="space-y-4"
                  >
                    <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4">
                      <div className="flex items-start gap-3">
                        <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-violet-700" aria-hidden />
                        <div>
                          <h3 className="font-semibold text-stone-950">Förslaget är klart för manuell granskning</h3>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700">{proposal.summary}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {([
                        ['add', 'Lägg till'],
                        ['update', 'Ändra'],
                        ['deactivate', 'Inaktivera'],
                        ['reuse', 'Återanvänd'],
                      ] as Array<[RenoAppAiFlowChangeOperation, string]>).map(([operation, label]) => (
                        <div key={operation} className="rounded-lg border border-stone-200 bg-white px-3 py-3">
                          <div className="text-2xl font-semibold text-stone-950">{changesByOperation[operation]}</div>
                          <div className="mt-1 text-xs text-stone-500">{label}</div>
                        </div>
                      ))}
                    </div>

                    {proposal.warnings.map((warning, index) => (
                      <div key={`${warning}-${index}`} className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-5 text-amber-900">
                        <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
                        <span>{warning}</span>
                      </div>
                    ))}

                    {(proposal.validationIssues ?? []).map((issue) => (
                      <div
                        key={issue.id}
                        className={`flex gap-2 rounded-md border px-3 py-3 text-sm leading-5 ${issue.severity === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
                      >
                        <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
                        <span>
                          {issue.code ? <span className="mr-1 font-semibold">{issue.code}:</span> : null}
                          {issue.message}
                        </span>
                      </div>
                    ))}

                    {fingerprintMismatch ? (
                      <div className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm leading-5 text-rose-800">
                        <RefreshCw size={17} className="mt-0.5 shrink-0" aria-hidden />
                        <span>Flödet har ändrats sedan analysen startade. Skapa ett nytt förslag innan något senare tillämpas.</span>
                      </div>
                    ) : null}

                    <dl className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs text-stone-600 sm:grid-cols-3">
                      <div>
                        <dt className="font-semibold uppercase tracking-[0.12em] text-stone-500">Underlag</dt>
                        <dd className="mt-1 break-all">{(result.snapshotFingerprint ?? snapshotFingerprint) || 'Fingeravtryck saknas'}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold uppercase tracking-[0.12em] text-stone-500">Skapad</dt>
                        <dd className="mt-1">{formatTimestamp(result.generatedAt) ?? 'Nu'}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold uppercase tracking-[0.12em] text-stone-500">Modell</dt>
                        <dd className="mt-1">{result.model ?? 'Ej angiven'}</dd>
                      </div>
                    </dl>
                  </section>
                ) : null}

                {activeTab === 'changes' ? (
                  <section
                    role="tabpanel"
                    id={`${tabPrefix}-changes-panel`}
                    aria-labelledby={`${tabPrefix}-changes-tab`}
                    className="space-y-3"
                  >
                    {proposal.changes.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-center text-sm text-stone-600">
                        AI:n föreslår inga strukturella ändringar.
                      </div>
                    ) : proposal.changes.map((change) => {
                      const linkedSources = change.sourceIds
                        .map((sourceId) => sourceMap.get(sourceId))
                        .filter((source): source is RenoAppAiFlowSource => Boolean(source))
                      return (
                        <article key={change.id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${operationTone(change.operation)}`}>
                                  <OperationIcon operation={change.operation} />
                                  {operationLabel(change.operation)}
                                </span>
                                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
                                  {entityLabel(change.entityType)}
                                </span>
                              </div>
                              <h3 className="mt-2 text-base font-semibold text-stone-950">{change.title}</h3>
                              {change.key || change.path ? (
                                <p className="mt-1 break-all font-mono text-[11px] text-stone-500">
                                  {[change.path, change.key].filter(Boolean).join(' · ')}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                              {change.risk ? (
                                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${change.risk === 'high' ? 'border-rose-200 bg-rose-50 text-rose-800' : change.risk === 'medium' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-stone-200 bg-stone-50 text-stone-600'}`}>
                                  Risk: {change.risk === 'high' ? 'hög' : change.risk === 'medium' ? 'medel' : change.risk === 'low' ? 'låg' : change.risk}
                                </span>
                              ) : null}
                              {change.validationStatus === 'blocked' ? (
                                <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800">Blockerad</span>
                              ) : change.validationStatus === 'warning' ? (
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">Kontroll krävs</span>
                              ) : null}
                              {change.requiresExpertReview ? (
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
                                  Kräver sakkunnig kontroll
                                </span>
                              ) : null}
                            </div>
                          </div>

                          {change.summary ? <p className="mt-3 text-sm leading-6 text-stone-700">{change.summary}</p> : null}
                          {change.reason ? (
                            <div className="mt-3 flex items-start gap-2 text-sm leading-6 text-stone-600">
                              <ArrowRight size={16} className="mt-1 shrink-0 text-violet-700" aria-hidden />
                              <span>{change.reason}</span>
                            </div>
                          ) : null}

                          {change.before !== undefined || change.after !== undefined ? (
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <ChangeValue label="Före" value={change.before} tone="before" />
                              <ChangeValue label="Föreslaget" value={change.after} tone="after" />
                            </div>
                          ) : null}

                          {change.warnings.map((warning, index) => (
                            <div key={`${warning}-${index}`} className="mt-3 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
                              <span>{warning}</span>
                            </div>
                          ))}

                          {linkedSources.length > 0 ? (
                            <div className="mt-4 border-t border-stone-100 pt-3">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">Källstöd</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {linkedSources.map((source) => {
                                  const url = safeExternalUrl(source.url)
                                  return url ? (
                                    <a
                                      key={source.id}
                                      href={url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-700 hover:border-violet-300 hover:text-violet-800"
                                    >
                                      {source.title} <ExternalLink size={12} aria-hidden />
                                    </a>
                                  ) : (
                                    <span key={source.id} className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-700">
                                      {source.title}
                                    </span>
                                  )
                                })}
                              </div>
                            </div>
                          ) : change.sourceIds.length > 0 ? (
                            <p className="mt-3 text-xs text-amber-800">Källreferens: {change.sourceIds.join(', ')}</p>
                          ) : null}
                        </article>
                      )
                    })}
                  </section>
                ) : null}

                {activeTab === 'sources' ? (
                  <section
                    role="tabpanel"
                    id={`${tabPrefix}-sources-panel`}
                    aria-labelledby={`${tabPrefix}-sources-tab`}
                    className="space-y-3"
                  >
                    <div className="flex gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-3 text-sm leading-5 text-sky-900">
                      <BookOpen size={17} className="mt-0.5 shrink-0" aria-hidden />
                      <span>Kontrollera alltid att källan gäller rätt åtgärd, byggnad och tidpunkt. Branschpraxis är inte samma sak som bindande regel.</span>
                    </div>
                    {proposal.sources.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-8 text-center text-sm text-amber-900">
                        Inga källor returnerades. Förslaget ska inte betraktas som verifierat.
                      </div>
                    ) : proposal.sources.map((source) => {
                      const url = safeExternalUrl(source.url)
                      const typeLabel = sourceTypeLabel(source.sourceType)
                      return (
                        <article key={source.id} className="rounded-xl border border-stone-200 bg-white p-4">
                          <div className="flex flex-wrap gap-2">
                            {typeLabel ? <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800">{typeLabel}</span> : null}
                            {source.publisher ? <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-600">{source.publisher}</span> : null}
                            {source.verified === true ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">Verifierad domän</span> : null}
                            {source.verified === false ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">Ej verifierad</span> : null}
                          </div>
                          <h3 className="mt-3 font-semibold leading-6 text-stone-950">
                            {url ? (
                              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1.5 hover:text-violet-800 hover:underline">
                                {source.title} <ExternalLink size={14} className="mt-1 shrink-0" aria-hidden />
                              </a>
                            ) : source.title}
                          </h3>
                          {source.summary ? <p className="mt-2 text-sm leading-6 text-stone-700">{source.summary}</p> : null}
                          {source.reference ? <p className="mt-2 text-xs font-medium text-stone-600">Hänvisning: {source.reference}</p> : null}
                          {source.supports && source.supports.length > 0 ? (
                            <div className="mt-3">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">Stödjer</p>
                              <ul className="mt-1.5 space-y-1 text-xs leading-5 text-stone-600">
                                {source.supports.map((claim, index) => <li key={`${claim}-${index}`}>• {claim}</li>)}
                              </ul>
                            </div>
                          ) : null}
                          {source.retrievedAt || source.effectiveDate ? (
                            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-stone-100 pt-3 text-xs text-stone-500">
                              {source.retrievedAt ? <span>Kontrollerad: {formatTimestamp(source.retrievedAt)}</span> : null}
                              {source.effectiveDate ? <span>Gäller från: {formatTimestamp(source.effectiveDate)}</span> : null}
                            </div>
                          ) : null}
                        </article>
                      )
                    })}
                  </section>
                ) : null}

                {activeTab === 'test' ? (
                  <section
                    role="tabpanel"
                    id={`${tabPrefix}-test-panel`}
                    aria-labelledby={`${tabPrefix}-test-tab`}
                    className="space-y-3"
                  >
                    <p className="text-sm leading-6 text-stone-600">
                      Testfallen visar hur AI:n förväntar sig att villkoren ska slå. De körs inte mot det publicerade flödet i denna MVP.
                    </p>
                    {proposal.testScenarios.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-center text-sm text-stone-600">
                        Inga testfall skapades för förslaget.
                      </div>
                    ) : proposal.testScenarios.map((scenario, index) => (
                      <article key={scenario.id} className="rounded-xl border border-stone-200 bg-white p-4">
                        <div className="flex items-start gap-3">
                          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-800">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <h3 className="font-semibold text-stone-950">{scenario.title}</h3>
                            {scenario.description ? <p className="mt-1 text-sm leading-6 text-stone-600">{scenario.description}</p> : null}
                          </div>
                        </div>
                        {scenario.input !== undefined || scenario.expectedOutcome !== undefined ? (
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <ChangeValue label="Testdata / svar" value={scenario.input} tone="before" />
                            <ChangeValue label="Förväntat utfall" value={scenario.expectedOutcome} tone="after" />
                          </div>
                        ) : null}
                        {scenario.warnings.map((warning, warningIndex) => (
                          <div key={`${warning}-${warningIndex}`} className="mt-3 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
                            <span>{warning}</span>
                          </div>
                        ))}
                      </article>
                    ))}
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <footer className="shrink-0 border-t border-stone-200 bg-white px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex max-w-xl items-start gap-2 text-xs leading-5 text-stone-600">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />
              <p>
                <span className="font-semibold text-stone-900">Förslag – inga ändringar har sparats.</span>{' '}
                Kontrollera juridik, källor och föreningens egna regler innan ett flöde senare tillämpas eller publiceras.
              </p>
            </div>
            <button
              type="button"
              onClick={closeDrawer}
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-violet-200"
            >
              Stäng
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
