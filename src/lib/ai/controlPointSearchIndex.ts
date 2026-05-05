import { createHash } from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const CONTROL_POINT_EMBEDDING_MODEL = 'text-embedding-3-small'
export const CONTROL_POINT_EMBEDDING_DIMENSIONS = 1536

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'
const EMBEDDING_BATCH_SIZE = 64
const MAX_MATCH_POOL = 40
const SEARCH_TEXT_VERSION = 'control-point-search-v2'
const LOW_SIGNAL_QUERY_TERMS = new Set([
  'att',
  'det',
  'den',
  'der',
  'ett',
  'finns',
  'har',
  'med',
  'mot',
  'och',
  'pa',
  'runt',
  'som',
  'vid',
])
const SUPPORTING_QUERY_TERMS = new Set([
  'bristfallig',
  'bristfalligt',
  'fast',
  'fastsatt',
  'fastsattning',
  'infast',
  'infastning',
  'los',
  'losa',
  'lossnar',
  'lost',
  'sitter',
])
const SEARCH_SYNONYMS: Record<string, string[]> = {
  avluftning: ['avluftning', 'luftning', 'ventilation', 'ror'],
  beslag: ['beslag', 'platbeslag', 'skorstensbeslag'],
  brunn: ['brunn', 'golvbrunn'],
  glipa: ['glipa', 'springa', 'otat', 'otathet', 'anslutning'],
  genomforing: ['genomforing', 'takgenomforing', 'ror', 'avluftning'],
  los: ['los', 'lost', 'losa', 'lossnar', 'infastning', 'bristfalligt', 'bristfallig'],
  lost: ['lost', 'los', 'losa', 'lossnar', 'infastning', 'bristfalligt', 'bristfallig'],
  plat: [
    'plat',
    'platarbeten',
    'platdetalj',
    'platdetaljer',
    'platbeslag',
    'fonsterbleck',
    'skorstensbeslag',
    'takplat',
    'vindskiveplat',
    'randal',
  ],
  sitter: ['sitter', 'fastsatt', 'fastsattning', 'infastning', 'infast', 'lossnar'],
  tak: ['tak', 'yttertak', 'taktackning', 'takgenomforing'],
}

export type ControlPointSearchControlPoint = {
  id: string
  key: string
  title: string | null
  label: string | null
  description: string | null
  question?: string | null
  scope: string | null
  exterior_item_key: string | null
  default_risk_code?: string | null
  default_ftu_code?: string | null
  room_type_key?: string | null
  tags?: unknown
  risk_tags?: unknown
  trigger_room_types?: unknown
  trigger_component_keys?: unknown
  trigger_foundation_types?: unknown
  trigger_tags?: unknown
  trigger_year_from?: number | null
  trigger_year_to?: number | null
  applies_to?: unknown
}

export type ControlPointSearchOutcome = {
  id: string
  control_point_id: string | null
  outcome_key: string | null
  label: string | null
  severity: string | number | null
  note_template: string | null
  risk_template: string | null
  ftu_template: string | null
  sort_order: number | null
  is_active?: boolean | null
}

export type RankedControlPointSearchResult = ControlPointSearchControlPoint & {
  match_score: number
  search_hint: string
  outcomes: ControlPointSearchOutcome[]
}

type SearchIndexEntry = {
  controlPoint: ControlPointSearchControlPoint
  outcomes: ControlPointSearchOutcome[]
  searchText: string
  contentHash: string
}

type ExistingIndexRow = {
  control_point_id: string
  content_hash: string
  embedding_model: string | null
}

type MatchRow = {
  control_point_id: string
  similarity: number | null
  scope: string | null
  search_text: string | null
}

type QueryTermGroup = {
  terms: string[]
  weight: number
}

type OpenAiEmbeddingResponse = {
  data?: Array<{
    index?: number
    embedding?: number[]
  }>
}

const normalizeText = (value: unknown) =>
  String(value ?? '').replace(/\s+/g, ' ').trim()

const normalizeSearchText = (value: unknown) =>
  normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const compactPart = (label: string, value: unknown) => {
  const text = normalizeText(value)
  return text ? `${label}: ${text}` : ''
}

const normalizeJsonList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map(item => normalizeText(item)).filter(Boolean)
  }

  if (value && typeof value === 'object') {
    return Object.values(value).map(item => normalizeText(item)).filter(Boolean)
  }

  const text = normalizeText(value)
  return text ? [text] : []
}

const compactListPart = (label: string, value: unknown) => {
  const list = normalizeJsonList(value)
  return list.length > 0 ? `${label}: ${list.join(', ')}` : ''
}

const scopeLabel = (scope: string | null) => {
  if (scope === 'interior') return 'Insida'
  if (scope === 'exterior') return 'Utsida'
  return normalizeText(scope) || 'Kontrollpunkt'
}

const toHash = (value: string) =>
  createHash('sha256')
    .update(`${SEARCH_TEXT_VERSION}\n${value}`, 'utf8')
    .digest('hex')

const toVectorLiteral = (embedding: number[]) =>
  `[${embedding.map(value => (Number.isFinite(value) ? value : 0)).join(',')}]`

const chunk = <T,>(items: T[], size: number) => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export const buildControlPointSearchText = (
  controlPoint: ControlPointSearchControlPoint,
  outcomes: ControlPointSearchOutcome[]
) => {
  const outcomeText = outcomes
    .map((outcome, index) =>
      [
        `Chip ${index + 1}`,
        compactPart('Rubrik', outcome.label),
        compactPart('Allvar', outcome.severity),
        compactPart('Notering', outcome.note_template),
        compactPart('Riskanalys', outcome.risk_template),
        compactPart('FTU', outcome.ftu_template),
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n')

  return [
    compactPart('Kontrollpunkt', controlPoint.title || controlPoint.label || controlPoint.key),
    compactPart('Beskrivning', controlPoint.description),
    compactPart('Fraga', controlPoint.question),
    compactPart('Omrade', scopeLabel(controlPoint.scope)),
    compactPart('Utsidesdel', controlPoint.exterior_item_key),
    compactPart('Rumstyp', controlPoint.room_type_key),
    compactPart('Standard riskkod', controlPoint.default_risk_code),
    compactPart('Standard FTU-kod', controlPoint.default_ftu_code),
    compactListPart('Galler besiktningstyper', controlPoint.applies_to),
    compactListPart('Rumstriggers', controlPoint.trigger_room_types),
    compactListPart('Komponenttriggers', controlPoint.trigger_component_keys),
    compactListPart('Grundtriggers', controlPoint.trigger_foundation_types),
    compactListPart('Taggtriggers', controlPoint.trigger_tags),
    compactListPart('Taggar', controlPoint.tags),
    compactListPart('Risktaggar', controlPoint.risk_tags),
    compactPart('Ar fran', controlPoint.trigger_year_from),
    compactPart('Ar till', controlPoint.trigger_year_to),
    outcomeText ? `Chips och val:\n${outcomeText}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

const buildQueryTermGroups = (query: string): QueryTermGroup[] => {
  const tokens = Array.from(
    new Set(
      normalizeSearchText(query)
        .split(' ')
        .filter(token => token.length >= 3 && !LOW_SIGNAL_QUERY_TERMS.has(token))
    )
  )

  return tokens.map(token => {
    const terms = Array.from(new Set([token, ...(SEARCH_SYNONYMS[token] ?? [])]))
    const isSupporting = SUPPORTING_QUERY_TERMS.has(token)
    return {
      terms,
      weight: isSupporting ? 0.7 : 1.5,
    }
  })
}

const textMatchesAnyTerm = (text: string, terms: string[]) =>
  terms.some(term => text.includes(term))

const scoreField = (
  value: unknown,
  fieldWeight: number,
  queryGroups: QueryTermGroup[]
) => {
  const text = normalizeSearchText(value)
  if (!text) return 0

  return queryGroups.reduce((score, group) => {
    return textMatchesAnyTerm(text, group.terms)
      ? score + fieldWeight * group.weight
      : score
  }, 0)
}

const calculateLexicalScore = (
  controlPoint: ControlPointSearchControlPoint,
  outcomes: ControlPointSearchOutcome[],
  queryGroups: QueryTermGroup[]
) => {
  if (queryGroups.length === 0) return 0

  const outcomeLabels = outcomes.map(outcome => outcome.label).join(' ')
  const outcomeTemplates = outcomes
    .map(outcome =>
      [outcome.note_template, outcome.risk_template, outcome.ftu_template]
        .filter(Boolean)
        .join(' ')
    )
    .join(' ')
  const tagText = [
    ...normalizeJsonList(controlPoint.tags),
    ...normalizeJsonList(controlPoint.risk_tags),
    ...normalizeJsonList(controlPoint.trigger_room_types),
    ...normalizeJsonList(controlPoint.trigger_component_keys),
    ...normalizeJsonList(controlPoint.trigger_foundation_types),
    ...normalizeJsonList(controlPoint.trigger_tags),
  ].join(' ')
  const fullText = normalizeSearchText(
    [
      controlPoint.title,
      controlPoint.label,
      controlPoint.exterior_item_key,
      controlPoint.room_type_key,
      controlPoint.description,
      outcomeLabels,
      outcomeTemplates,
      tagText,
    ].join(' ')
  )
  const primaryGroups = queryGroups.filter(group => group.weight > 1)
  const hasPrimaryMatch =
    primaryGroups.length === 0 ||
    primaryGroups.some(group => textMatchesAnyTerm(fullText, group.terms))

  const rawScore =
    scoreField(
      [controlPoint.title, controlPoint.label].filter(Boolean).join(' '),
      4,
      queryGroups
    ) +
    scoreField(outcomeLabels, 3.5, queryGroups) +
    scoreField(controlPoint.exterior_item_key, 3, queryGroups) +
    scoreField(controlPoint.room_type_key, 2, queryGroups) +
    scoreField(controlPoint.description, 1.5, queryGroups) +
    scoreField(outcomeTemplates, 1.25, queryGroups) +
    scoreField(tagText, 1.25, queryGroups)

  const maxScore = queryGroups.reduce((sum, group) => sum + group.weight, 0) * 8
  const normalizedScore = Math.min(rawScore / Math.max(maxScore, 1), 1)
  return hasPrimaryMatch ? normalizedScore : Math.min(normalizedScore * 0.25, 0.2)
}

const embedTexts = async (apiKey: string, texts: string[]) => {
  if (texts.length === 0) return []

  const embeddings: number[][] = []
  for (const textsBatch of chunk(texts, EMBEDDING_BATCH_SIZE)) {
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CONTROL_POINT_EMBEDDING_MODEL,
        input: textsBatch,
        dimensions: CONTROL_POINT_EMBEDDING_DIMENSIONS,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `OpenAI embeddings failed (${response.status}): ${errorText.slice(0, 500)}`
      )
    }

    const payload = (await response.json()) as OpenAiEmbeddingResponse
    const batchEmbeddings = textsBatch.map((_, index) => {
      const item =
        payload.data?.find(row => row.index === index) ?? payload.data?.[index]
      if (!item?.embedding) {
        throw new Error('OpenAI embeddings response saknar embedding-data.')
      }
      return item.embedding
    })
    embeddings.push(...batchEmbeddings)
  }

  return embeddings
}

const fetchControlPointCatalog = async () => {
  const admin = createSupabaseAdminClient()

  const { data: controlPointRows, error: controlPointsError } = await admin
    .from('settings_control_points')
    .select(
      [
        'id',
        'key',
        'title',
        'label',
        'description',
        'question',
        'scope',
        'exterior_item_key',
        'default_risk_code',
        'default_ftu_code',
        'room_type_key',
        'tags',
        'risk_tags',
        'trigger_room_types',
        'trigger_component_keys',
        'trigger_foundation_types',
        'trigger_tags',
        'trigger_year_from',
        'trigger_year_to',
        'applies_to',
      ].join(', ')
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (controlPointsError) {
    throw new Error(`Kunde inte hamta kontrollpunkter: ${controlPointsError.message}`)
  }

  const controlPoints = (controlPointRows ?? []) as unknown as ControlPointSearchControlPoint[]
  const controlPointIds = controlPoints.map(controlPoint => controlPoint.id)

  const { data: outcomeRows, error: outcomesError } = controlPointIds.length
    ? await admin
        .from('settings_control_point_outcomes')
        .select(
          'id, control_point_id, outcome_key, label, severity, note_template, risk_template, ftu_template, sort_order, is_active'
        )
        .eq('is_active', true)
        .in('control_point_id', controlPointIds)
        .order('sort_order', { ascending: true })
    : { data: [], error: null }

  if (outcomesError) {
    throw new Error(`Kunde inte hamta chips: ${outcomesError.message}`)
  }

  const outcomes = (outcomeRows ?? []) as unknown as ControlPointSearchOutcome[]
  const outcomesByControlPointId = outcomes.reduce<Record<string, ControlPointSearchOutcome[]>>(
    (acc, outcome) => {
      if (!outcome.control_point_id) return acc
      acc[outcome.control_point_id] = acc[outcome.control_point_id] ?? []
      acc[outcome.control_point_id].push(outcome)
      return acc
    },
    {}
  )

  return { admin, controlPoints, outcomesByControlPointId }
}

export const getControlPointSearchIndexCount = async () => {
  const admin = createSupabaseAdminClient()
  const { count, error } = await admin
    .from('settings_control_point_search_index')
    .select('control_point_id', { count: 'exact', head: true })

  if (error) {
    throw new Error(`Kunde inte lasa AI-indexet: ${error.message}`)
  }

  return count ?? 0
}

export const rebuildControlPointSearchIndex = async (
  apiKey: string,
  options: { force?: boolean } = {}
) => {
  const { admin, controlPoints, outcomesByControlPointId } =
    await fetchControlPointCatalog()
  const entries: SearchIndexEntry[] = controlPoints.map(controlPoint => {
    const outcomes = outcomesByControlPointId[controlPoint.id] ?? []
    const searchText = buildControlPointSearchText(controlPoint, outcomes)
    return {
      controlPoint,
      outcomes,
      searchText,
      contentHash: toHash(searchText),
    }
  })

  const activeIds = new Set(controlPoints.map(controlPoint => controlPoint.id))
  const { data: existingRows, error: existingError } = await admin
    .from('settings_control_point_search_index')
    .select('control_point_id, content_hash, embedding_model')

  if (existingError) {
    throw new Error(`Kunde inte lasa befintligt AI-index: ${existingError.message}`)
  }

  const existing = ((existingRows ?? []) as unknown as ExistingIndexRow[]).reduce<
    Record<string, ExistingIndexRow>
  >((acc, row) => {
    acc[row.control_point_id] = row
    return acc
  }, {})

  const staleIds = Object.keys(existing).filter(id => !activeIds.has(id))
  if (staleIds.length > 0) {
    const { error: deleteError } = await admin
      .from('settings_control_point_search_index')
      .delete()
      .in('control_point_id', staleIds)

    if (deleteError) {
      throw new Error(`Kunde inte rensa gamla indexrader: ${deleteError.message}`)
    }
  }

  const changedEntries = entries.filter(entry => {
    const existingEntry = existing[entry.controlPoint.id]
    return (
      options.force ||
      !existingEntry ||
      existingEntry.content_hash !== entry.contentHash ||
      existingEntry.embedding_model !== CONTROL_POINT_EMBEDDING_MODEL
    )
  })

  let updated = 0
  for (const entriesBatch of chunk(changedEntries, EMBEDDING_BATCH_SIZE)) {
    const embeddings = await embedTexts(
      apiKey,
      entriesBatch.map(entry => entry.searchText)
    )

    const rows = entriesBatch.map((entry, index) => ({
      control_point_id: entry.controlPoint.id,
      scope: entry.controlPoint.scope ?? 'unknown',
      search_text: entry.searchText,
      content_hash: entry.contentHash,
      embedding: toVectorLiteral(embeddings[index] ?? []),
      embedding_model: CONTROL_POINT_EMBEDDING_MODEL,
      indexed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))

    const { error: upsertError } = await admin
      .from('settings_control_point_search_index')
      .upsert(rows, { onConflict: 'control_point_id' })

    if (upsertError) {
      throw new Error(`Kunde inte spara AI-indexet: ${upsertError.message}`)
    }

    updated += rows.length
  }

  return {
    total: entries.length,
    updated,
    skipped: entries.length - changedEntries.length,
    removed: staleIds.length,
    model: CONTROL_POINT_EMBEDDING_MODEL,
  }
}

export const searchControlPointIndex = async (
  apiKey: string,
  query: string,
  limit: number
) => {
  const admin = createSupabaseAdminClient()
  const [queryEmbedding] = await embedTexts(apiKey, [query])
  const matchCount = Math.max(Math.min(limit * 4, MAX_MATCH_POOL), limit)
  const queryGroups = buildQueryTermGroups(query)

  const { data: matchRows, error: matchError } = await admin.rpc(
    'match_settings_control_point_search_index',
    {
      query_embedding: toVectorLiteral(queryEmbedding ?? []),
      match_count: matchCount,
      match_threshold: 0,
    }
  )

  if (matchError) {
    throw new Error(`Kunde inte soka i AI-indexet: ${matchError.message}`)
  }

  const matches = ((matchRows ?? []) as unknown as MatchRow[]).filter(row =>
    Boolean(row.control_point_id)
  )
  const orderedIds = matches.map(match => match.control_point_id)
  if (orderedIds.length === 0) return []

  const { data: controlPointRows, error: controlPointsError } = await admin
    .from('settings_control_points')
    .select(
      [
        'id',
        'key',
        'title',
        'label',
        'description',
        'question',
        'scope',
        'exterior_item_key',
        'default_risk_code',
        'default_ftu_code',
        'room_type_key',
        'tags',
        'risk_tags',
        'trigger_room_types',
        'trigger_component_keys',
        'trigger_foundation_types',
        'trigger_tags',
        'trigger_year_from',
        'trigger_year_to',
        'applies_to',
      ].join(', ')
    )
    .eq('is_active', true)
    .in('id', orderedIds)

  if (controlPointsError) {
    throw new Error(`Kunde inte hamta AI-traffar: ${controlPointsError.message}`)
  }

  const controlPointById = new Map(
    ((controlPointRows ?? []) as unknown as ControlPointSearchControlPoint[]).map(controlPoint => [
      controlPoint.id,
      controlPoint,
    ])
  )

  const { data: outcomeRows, error: outcomesError } = await admin
    .from('settings_control_point_outcomes')
    .select(
      'id, control_point_id, outcome_key, label, severity, note_template, risk_template, ftu_template, sort_order, is_active'
    )
    .eq('is_active', true)
    .in('control_point_id', orderedIds)
    .order('sort_order', { ascending: true })

  if (outcomesError) {
    throw new Error(`Kunde inte hamta chips for AI-traffar: ${outcomesError.message}`)
  }

  const outcomesByControlPointId = ((outcomeRows ?? []) as unknown as ControlPointSearchOutcome[]).reduce<
    Record<string, ControlPointSearchOutcome[]>
  >((acc, outcome) => {
    if (!outcome.control_point_id) return acc
    acc[outcome.control_point_id] = acc[outcome.control_point_id] ?? []
    acc[outcome.control_point_id].push(outcome)
    return acc
  }, {})

  const seen = new Set<string>()
  return matches
    .map(match => {
      const controlPoint = controlPointById.get(match.control_point_id)
      if (!controlPoint || seen.has(controlPoint.id)) return null
      seen.add(controlPoint.id)
      const embeddingScore = Math.max(match.similarity ?? 0, 0)
      const outcomes = outcomesByControlPointId[controlPoint.id] ?? []
      const lexicalScore = calculateLexicalScore(controlPoint, outcomes, queryGroups)
      const score = Math.min(embeddingScore + lexicalScore * 0.45, 1)
      const percent = Math.round(score * 100)
      return {
        ...controlPoint,
        match_score: score,
        search_hint: `AI-traff ${percent}%`,
        outcomes,
      }
    })
    .filter((result): result is RankedControlPointSearchResult => Boolean(result))
    .sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0))
    .slice(0, limit)
}
