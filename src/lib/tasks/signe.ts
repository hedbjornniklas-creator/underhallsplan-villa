import 'server-only'

import { createHash } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const SIGNE_MODEL = process.env.OPENAI_TASK_SIGNE_MODEL?.trim() || 'gpt-4o-mini'
const RULESET_KEY = 'signe_tasks_v1'
const RULESET_VERSION = 1
const MAX_MODEL_SUGGESTIONS = 3
const RUN_STALE_AFTER_MS = 10 * 60 * 1000

const TERMINAL_STATUSES = new Set(['approved', 'cancelled'])

type SigneContext = {
  orgId: string
  userId: string
  isOrgAdmin: boolean
}

type TaskRow = {
  id: string
  org_id: string
  root_task_id: string
  parent_task_id: string | null
  issuer_profile_id: string
  title: string
  description: string | null
  context_label: string | null
  task_kind: string
  status: string
  depth: number
  due_at: string
  next_followup_at: string
  evidence_requirement: string
  version: number
  archived_at: string | null
}

type SettingsRow = {
  max_subtask_depth: number
  max_open_children_per_task: number
  max_ai_children_per_task: number
  max_pending_ai_suggestions_per_root: number
  max_active_descendants: number
}

type PendingSuggestionRow = {
  id: string
  task_id: string
  title: string
  dedupe_key: string | null
  suggestion_type: string
  status: string
  created_at: string
}

type OpenAiResponse = {
  id?: string
  model?: string
  status?: string
  output_text?: string
  output?: Array<{
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
}

type ModelSuggestion = {
  title: string
  description: string
  rationale: string
}

type ModelOutput = {
  summary: string
  suggestions: ModelSuggestion[]
}

type JsonRecord = Record<string, unknown>

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : ''
}

function normalizedTitle(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('sv-SE')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function suggestionDedupeKey(taskId: string, title: string) {
  const digest = createHash('sha256')
    .update(`${RULESET_KEY}:${taskId}:${normalizedTitle(title)}`, 'utf8')
    .digest('hex')
  return `${RULESET_KEY}:create_subtask:${digest}`
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function responseText(payload: OpenAiResponse) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }
  return (
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((content) => content.type === 'output_text' && typeof content.text === 'string')
      ?.text?.trim() ?? ''
  )
}

function parseModelOutput(payload: OpenAiResponse): ModelOutput {
  const text = responseText(payload)
  if (!text) throw new Error('SIGNE_RESPONSE_INVALID')

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('SIGNE_RESPONSE_INVALID')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('SIGNE_RESPONSE_INVALID')
  }

  const record = raw as JsonRecord
  const candidates = Array.isArray(record.suggestions) ? record.suggestions : []
  const suggestions = candidates
    .slice(0, MAX_MODEL_SUGGESTIONS)
    .map((candidate): ModelSuggestion | null => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
      const item = candidate as JsonRecord
      const title = cleanText(item.title, 180)
      if (!title) return null
      return {
        title,
        description: cleanText(item.description, 1200),
        rationale: cleanText(item.rationale, 600),
      }
    })
    .filter((item): item is ModelSuggestion => item !== null)

  return {
    summary: cleanText(record.summary, 800),
    suggestions,
  }
}

async function requireSigneTask(input: SigneContext & { taskId: string }) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('operational_tasks')
    .select(
      'id,org_id,root_task_id,parent_task_id,issuer_profile_id,title,description,context_label,task_kind,status,depth,due_at,next_followup_at,evidence_requirement,version,archived_at'
    )
    .eq('id', input.taskId)
    .eq('org_id', input.orgId)
    .is('archived_at', null)
    .maybeSingle()

  if (error) throw new Error('SIGNE_SCHEMA_REQUIRED')
  if (!data) throw new Error('TASK_NOT_FOUND')
  const task = data as TaskRow
  if (!input.isOrgAdmin && task.issuer_profile_id !== input.userId) {
    throw new Error('SIGNE_ANALYZE_FORBIDDEN')
  }
  return task
}

async function finishRunFailed(runId: string, errorCode: string) {
  const admin = createSupabaseAdminClient()
  const now = new Date().toISOString()
  await admin
    .from('task_ai_runs')
    .update({
      status: 'failed',
      error_message: errorCode,
      completed_at: now,
      heartbeat_at: now,
    })
    .eq('id', runId)
    .in('status', ['queued', 'processing'])
}

async function createRun(input: SigneContext & {
  task: TaskRow
  snapshot: JsonRecord
}) {
  const admin = createSupabaseAdminClient()
  const staleBefore = new Date(Date.now() - RUN_STALE_AFTER_MS).toISOString()
  const now = new Date().toISOString()

  await admin
    .from('task_ai_runs')
    .update({
      status: 'failed',
      error_message: 'SIGNE_RUN_TIMED_OUT',
      completed_at: now,
      heartbeat_at: now,
    })
    .eq('task_id', input.task.id)
    .eq('operation', 'next_task_suggestions')
    .in('status', ['queued', 'processing'])
    .lt('created_at', staleBefore)

  const { data, error } = await admin
    .from('task_ai_runs')
    .insert({
      org_id: input.orgId,
      task_id: input.task.id,
      root_task_id: input.task.root_task_id,
      operation: 'next_task_suggestions',
      status: 'processing',
      model: SIGNE_MODEL,
      ruleset_key: RULESET_KEY,
      ruleset_version: RULESET_VERSION,
      input_snapshot: input.snapshot,
      output_payload: null,
      error_message: null,
      attempt_count: 1,
      started_at: now,
      heartbeat_at: now,
      created_by_profile_id: input.userId,
    })
    .select('id')
    .single()

  if (error || !data) {
    if (error?.code === '23505') throw new Error('SIGNE_ALREADY_RUNNING')
    throw new Error('SIGNE_RUN_CREATE_FAILED')
  }
  return String((data as { id: string }).id)
}

async function callSigne(input: { apiKey: string; snapshot: JsonRecord; maxSuggestions: number }) {
  let response: Response
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(35_000),
      body: JSON.stringify({
        model: SIGNE_MODEL,
        store: false,
        instructions: [
          'Du är Signe, en försiktig svensk uppdragsassistent som hjälper uppdragsgivaren att se vad som konkret saknas för att ett uppdrag ska bli gjort.',
          'Du får endast föreslå möjliga underuppgifter. Du får aldrig skapa en uppgift, ändra status, tilldela någon, godkänna något eller formulera/skicka ett meddelande.',
          `Returnera högst ${input.maxSuggestions} förslag. Om inget nytt underuppdrag tydligt behövs ska suggestions vara en tom lista.`,
          'Föreslå inte sådant som redan finns som underuppgift eller väntande förslag. Dela inte upp arbetet mer än nödvändigt.',
          'Varje titel ska beskriva ett enda verifierbart resultat med ett aktivt verb. Beskrivning och motivering ska vara korta och grundade enbart i underlaget.',
          'Var särskilt uppmärksam på obligatoriska kontrollpunkter såsom skriftlig offert, skriftligt beställargodkännande och färdigbevis, men hitta aldrig på att de saknas om underlaget visar motsatsen.',
          'Svara på svenska och följ JSON-schemat exakt.',
        ].join('\n'),
        input: JSON.stringify(input.snapshot, null, 2),
        text: {
          format: {
            type: 'json_schema',
            name: 'signe_next_task_suggestions_v1',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                summary: { type: 'string' },
                suggestions: {
                  type: 'array',
                  maxItems: MAX_MODEL_SUGGESTIONS,
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      description: { type: 'string' },
                      rationale: { type: 'string' },
                    },
                    required: ['title', 'description', 'rationale'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['summary', 'suggestions'],
              additionalProperties: false,
            },
          },
        },
        max_output_tokens: 1200,
      }),
    })
  } catch (error) {
    console.error('[tasks.signe] OpenAI request unavailable', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    throw new Error('SIGNE_PROVIDER_UNAVAILABLE')
  }

  if (!response.ok) {
    console.error('[tasks.signe] OpenAI request failed', {
      status: response.status,
      requestId: response.headers.get('x-request-id'),
    })
    throw new Error('SIGNE_PROVIDER_UNAVAILABLE')
  }

  const payload = (await response.json().catch(() => null)) as OpenAiResponse | null
  if (!payload) throw new Error('SIGNE_RESPONSE_INVALID')
  return { payload, output: parseModelOutput(payload) }
}

export async function requestSigneSuggestions(input: SigneContext & { taskId: string }) {
  const task = await requireSigneTask(input)
  if (TERMINAL_STATUSES.has(task.status)) throw new Error('SIGNE_TASK_CLOSED')

  const admin = createSupabaseAdminClient()
  const [settingsResult, treeResult, requirementsResult, eventsResult, suggestionsResult] = await Promise.all([
    admin
      .from('task_organization_settings')
      .select(
        'max_subtask_depth,max_open_children_per_task,max_ai_children_per_task,max_pending_ai_suggestions_per_root,max_active_descendants'
      )
      .eq('org_id', input.orgId)
      .maybeSingle(),
    admin
      .from('operational_tasks')
      .select('id,parent_task_id,title,status,depth,due_at')
      .eq('org_id', input.orgId)
      .eq('root_task_id', task.root_task_id)
      .is('archived_at', null)
      .order('depth', { ascending: true })
      .order('created_at', { ascending: true }),
    admin
      .from('task_requirements')
      .select('requirement_key,label,status,is_required,verified_at')
      .eq('org_id', input.orgId)
      .eq('task_id', task.id)
      .order('created_at', { ascending: true }),
    admin
      .from('task_events')
      .select('event_type,message,created_at')
      .eq('org_id', input.orgId)
      .eq('task_id', task.id)
      .order('created_at', { ascending: false })
      .limit(10),
    admin
      .from('task_ai_suggestions')
      .select('id,task_id,title,dedupe_key,suggestion_type,status,created_at')
      .eq('org_id', input.orgId)
      .eq('root_task_id', task.root_task_id)
      .order('created_at', { ascending: true })
      .limit(500),
  ])

  if (
    settingsResult.error ||
    treeResult.error ||
    requirementsResult.error ||
    eventsResult.error ||
    suggestionsResult.error
  ) {
    throw new Error('SIGNE_SCHEMA_REQUIRED')
  }

  const defaults: SettingsRow = {
    max_subtask_depth: 2,
    max_open_children_per_task: 5,
    max_ai_children_per_task: 5,
    max_pending_ai_suggestions_per_root: 3,
    max_active_descendants: 15,
  }
  const rawSettings = (settingsResult.data ?? defaults) as Partial<SettingsRow>
  const settings: SettingsRow = {
    max_subtask_depth: positiveInteger(rawSettings.max_subtask_depth, defaults.max_subtask_depth),
    max_open_children_per_task: positiveInteger(
      rawSettings.max_open_children_per_task,
      defaults.max_open_children_per_task
    ),
    max_ai_children_per_task: positiveInteger(
      rawSettings.max_ai_children_per_task,
      defaults.max_ai_children_per_task
    ),
    max_pending_ai_suggestions_per_root: positiveInteger(
      rawSettings.max_pending_ai_suggestions_per_root,
      defaults.max_pending_ai_suggestions_per_root
    ),
    max_active_descendants: positiveInteger(
      rawSettings.max_active_descendants,
      defaults.max_active_descendants
    ),
  }

  const tree = (treeResult.data ?? []) as Array<{
    id: string
    parent_task_id: string | null
    title: string
    status: string
    depth: number
    due_at: string
  }>
  const allSuggestions = (suggestionsResult.data ?? []) as PendingSuggestionRow[]
  const pending = allSuggestions.filter((row) => row.status === 'pending')
  const directChildren = tree.filter((row) => row.parent_task_id === task.id)
  const openDirectChildren = directChildren.filter((row) => !TERMINAL_STATUSES.has(row.status))
  const activeDescendants = tree.filter(
    (row) => row.id !== task.root_task_id && !TERMINAL_STATUSES.has(row.status)
  )
  const pendingForTask = pending.filter(
    (row) => row.task_id === task.id && row.suggestion_type === 'create_subtask'
  )
  const pendingCreateForRoot = pending.filter((row) => row.suggestion_type === 'create_subtask')

  if (task.depth + 1 > settings.max_subtask_depth) throw new Error('SIGNE_MAX_DEPTH')

  const childBudget = Math.min(
    settings.max_open_children_per_task,
    settings.max_ai_children_per_task
  )
  const availableChildren = childBudget - openDirectChildren.length - pendingForTask.length
  const availablePending = settings.max_pending_ai_suggestions_per_root - pending.length
  const availableDescendants =
    settings.max_active_descendants - activeDescendants.length - pendingCreateForRoot.length
  const maxSuggestions = Math.min(
    MAX_MODEL_SUGGESTIONS,
    availableChildren,
    availablePending,
    availableDescendants
  )

  if (availableChildren <= 0) throw new Error('SIGNE_CHILD_BUDGET_REACHED')
  if (availablePending <= 0) throw new Error('SIGNE_PENDING_BUDGET_REACHED')
  if (availableDescendants <= 0) throw new Error('SIGNE_DESCENDANT_BUDGET_REACHED')

  const snapshot: JsonRecord = {
    auditVersion: 1,
    ruleset: { key: RULESET_KEY, version: RULESET_VERSION },
    sourceTask: {
      id: task.id,
      version: task.version,
      rootTaskId: task.root_task_id,
      parentTaskId: task.parent_task_id,
      depth: task.depth,
      title: task.title,
      description: task.description,
      contextLabel: task.context_label,
      taskKind: task.task_kind,
      status: task.status,
      dueAt: task.due_at,
      nextFollowupAt: task.next_followup_at,
      evidenceRequirement: task.evidence_requirement,
    },
    requirements: requirementsResult.data ?? [],
    directChildren: directChildren.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      dueAt: row.due_at,
    })),
    pendingSuggestions: pendingForTask.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
    })),
    recentEvents: (eventsResult.data ?? []).map((row) => ({
      eventType: row.event_type,
      message: cleanText(row.message, 500) || null,
      createdAt: row.created_at,
    })),
    enforcedLimits: {
      maxDepth: settings.max_subtask_depth,
      maxOpenChildren: settings.max_open_children_per_task,
      maxAiChildren: settings.max_ai_children_per_task,
      maxPendingSuggestionsPerRoot: settings.max_pending_ai_suggestions_per_root,
      maxActiveDescendants: settings.max_active_descendants,
      maxSuggestionsThisRun: maxSuggestions,
    },
    currentCounts: {
      openDirectChildren: openDirectChildren.length,
      activeDescendants: activeDescendants.length,
      pendingSuggestionsForRoot: pending.length,
      pendingCreateSuggestionsForTask: pendingForTask.length,
    },
  }

  const runId = await createRun({ ...input, task, snapshot })
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    await finishRunFailed(runId, 'SIGNE_CONFIGURATION_MISSING')
    throw new Error('MISSING_ENV:OPENAI_API_KEY')
  }

  try {
    const generated = await callSigne({ apiKey, snapshot, maxSuggestions })
    const existingTitles = new Set([
      ...directChildren.map((row) => normalizedTitle(row.title)),
      ...allSuggestions
        .filter((row) => row.task_id === task.id && row.suggestion_type === 'create_subtask')
        .map((row) => normalizedTitle(row.title)),
    ])
    const seenDedupeKeys = new Set(
      allSuggestions.map((row) => row.dedupe_key).filter((key): key is string => Boolean(key))
    )
    const validSuggestions: Array<ModelSuggestion & { dedupeKey: string }> = []

    for (const suggestion of generated.output.suggestions) {
      if (validSuggestions.length >= maxSuggestions) break
      const normalized = normalizedTitle(suggestion.title)
      if (!normalized || existingTitles.has(normalized)) continue
      const dedupeKey = suggestionDedupeKey(task.id, suggestion.title)
      if (seenDedupeKeys.has(dedupeKey)) continue
      existingTitles.add(normalized)
      seenDedupeKeys.add(dedupeKey)
      validSuggestions.push({ ...suggestion, dedupeKey })
    }

    let persisted: Array<{ id: string; title: string; dedupe_key: string | null }> = []
    if (validSuggestions.length > 0) {
      const { data, error } = await admin
        .from('task_ai_suggestions')
        .insert(
          validSuggestions.map((suggestion) => ({
            org_id: input.orgId,
            task_id: task.id,
            root_task_id: task.root_task_id,
            run_id: runId,
            suggestion_type: 'create_subtask',
            title: suggestion.title,
            description: suggestion.description || null,
            proposed_payload: {
              title: suggestion.title,
              description: suggestion.description,
              rationale: suggestion.rationale,
              sourceTaskVersion: task.version,
              rulesetKey: RULESET_KEY,
              rulesetVersion: RULESET_VERSION,
            },
            dedupe_key: suggestion.dedupeKey,
            status: 'pending',
          }))
        )
        .select('id,title,dedupe_key')

      if (error) {
        const budgetError = error.message?.match(/TASK_AI_[A-Z0-9_]+/)?.[0]
        if (budgetError) throw new Error(budgetError)
        if (error.code !== '23505') throw new Error('SIGNE_SUGGESTIONS_SAVE_FAILED')
      } else {
        persisted = (data ?? []) as Array<{ id: string; title: string; dedupe_key: string | null }>
      }
    }

    const completedAt = new Date().toISOString()
    const outputPayload = {
      auditVersion: 1,
      provider: {
        responseId: generated.payload.id ?? null,
        model: generated.payload.model ?? SIGNE_MODEL,
        status: generated.payload.status ?? 'completed',
        usage: {
          inputTokens: generated.payload.usage?.input_tokens ?? null,
          outputTokens: generated.payload.usage?.output_tokens ?? null,
          totalTokens: generated.payload.usage?.total_tokens ?? null,
        },
      },
      modelOutput: generated.output,
      persistedSuggestions: persisted.map((row) => ({
        id: row.id,
        title: row.title,
        dedupeKey: row.dedupe_key,
      })),
      filteredSuggestionCount: generated.output.suggestions.length - persisted.length,
    }
    const { error: completeError } = await admin
      .from('task_ai_runs')
      .update({
        status: 'completed',
        output_payload: outputPayload,
        error_message: null,
        completed_at: completedAt,
        heartbeat_at: completedAt,
      })
      .eq('id', runId)
      .eq('status', 'processing')

    if (completeError) throw new Error('SIGNE_RUN_COMPLETE_FAILED')

    if (persisted.length === 1) {
      return 'Signe skapade ett förslag. Inget har skapats eller skickats automatiskt.'
    }
    return persisted.length > 1
      ? `Signe skapade ${persisted.length} förslag. Inget har skapats eller skickats automatiskt.`
      : 'Signe hittade inget nytt underuppdrag att föreslå just nu.'
  } catch (error) {
    const safeCode =
      error instanceof Error && /^SIGNE_[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : 'SIGNE_ANALYSIS_FAILED'
    await finishRunFailed(runId, safeCode)
    throw new Error(safeCode)
  }
}

export async function rejectSigneSuggestion(
  input: SigneContext & { taskId: string; suggestionId: string; reason: string }
) {
  const reason = cleanText(input.reason, 1000)
  if (reason.length < 3) throw new Error('SIGNE_REJECTION_REASON_REQUIRED')

  const admin = createSupabaseAdminClient()
  const { data: suggestion, error: suggestionError } = await admin
    .from('task_ai_suggestions')
    .select('id,task_id,status')
    .eq('id', input.suggestionId)
    .eq('task_id', input.taskId)
    .eq('org_id', input.orgId)
    .maybeSingle()
  if (suggestionError) throw new Error('SIGNE_SCHEMA_REQUIRED')
  if (!suggestion) throw new Error('SIGNE_SUGGESTION_NOT_FOUND')
  if (suggestion.status !== 'pending') throw new Error('SIGNE_SUGGESTION_NOT_PENDING')

  const task = await requireSigneTask(input)
  if (!input.isOrgAdmin && task.issuer_profile_id !== input.userId) {
    throw new Error('SIGNE_REVIEW_FORBIDDEN')
  }

  const reviewedAt = new Date().toISOString()
  const { data: reviewed, error } = await admin
    .from('task_ai_suggestions')
    .update({
      status: 'rejected',
      reviewed_by_profile_id: input.userId,
      reviewed_at: reviewedAt,
      review_note: reason,
    })
    .eq('id', input.suggestionId)
    .eq('task_id', input.taskId)
    .eq('org_id', input.orgId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error) throw new Error('SIGNE_SUGGESTION_REJECT_FAILED')
  if (!reviewed) throw new Error('SIGNE_SUGGESTION_NOT_PENDING')
  return 'Förslaget avvisades och anledningen sparades.'
}
