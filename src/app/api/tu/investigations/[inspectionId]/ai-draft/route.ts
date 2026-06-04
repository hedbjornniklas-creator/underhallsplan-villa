import { NextResponse } from 'next/server'
import {
  getTuInvestigationById,
  requireTuContext,
  type TuReportSectionKey,
} from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const TU_AI_MODEL = process.env.OPENAI_TU_TEXT_MODEL?.trim() || 'gpt-4o-mini'

const NON_EDITABLE_AI_SECTION_KEYS = new Set<string>(['assignment_parties', 'signature'])

type OpenAiResponse = {
  output_text?: string
  output?: Array<{
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}

type AiSuggestion = {
  sectionKey: TuReportSectionKey
  title: string
  text: string
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  return null
}

function extractText(payload: OpenAiResponse) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  return (
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .find((text): text is string => typeof text === 'string' && text.trim().length > 0)
      ?.trim() ?? ''
  )
}

function isEditableAiSectionKey(value: unknown): value is TuReportSectionKey {
  return typeof value === 'string' && value.trim() !== '' && !NON_EDITABLE_AI_SECTION_KEYS.has(value)
}

function parseSuggestions(text: string, allowedSectionKeys: Set<string>): AiSuggestion[] {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()

  const parsed = JSON.parse(cleaned) as unknown
  const rawSuggestions =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as { suggestions?: unknown }).suggestions)
      ? (parsed as { suggestions: unknown[] }).suggestions
      : []

  return rawSuggestions
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const sectionKey = (item as { sectionKey?: unknown }).sectionKey
      const title = (item as { title?: unknown }).title
      const suggestionText = (item as { text?: unknown }).text
      if (typeof sectionKey !== 'string' || !allowedSectionKeys.has(sectionKey)) return null
      if (typeof suggestionText !== 'string' || !suggestionText.trim()) return null
      return {
        sectionKey: sectionKey as TuReportSectionKey,
        title: typeof title === 'string' && title.trim() ? title.trim() : sectionKey,
        text: suggestionText.trim(),
      }
    })
    .filter((item): item is AiSuggestion => Boolean(item))
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return jsonError('OPENAI_API_KEY saknas på servern.', 500)

  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const investigation = await getTuInvestigationById({
      orgId: orgContext.orgId,
      inspectionId,
      inspectorProfileId: orgContext.userId,
    })
    if (!investigation) return jsonError('TU-utredningen hittades inte.', 404)
    if (investigation.reportLockedAt) return jsonError('Utlåtandet är låst och kan inte ändras.', 409)

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    const mode = body.mode === 'fill_empty' ? 'fill_empty' : 'suggest'
    const targetSectionKey = isEditableAiSectionKey(body.sectionKey) ? body.sectionKey : null

    if (prompt.length < 8) return jsonError('Skriv en lite tydligare instruktion till AI:n.', 400)

    const allowedSections = investigation.reportDraft.sections
      .filter((section) => isEditableAiSectionKey(section.key))
      .filter((section) => !targetSectionKey || section.key === targetSectionKey)
      .filter((section) => mode !== 'fill_empty' || !section.text.trim())

    if (allowedSections.length === 0) {
      return NextResponse.json({ suggestions: [] })
    }

    const contextPayload = {
      title: investigation.title,
      assignmentNumber: investigation.assignmentNumber,
      object: {
        type: investigation.objectType,
        address: investigation.propertyAddress,
        city: investigation.propertyCity,
        cadastralId: investigation.cadastralId,
        brfName: investigation.brfName,
        apartmentNumber: investigation.apartmentNumber,
        apartmentHolderName: investigation.apartmentHolderName,
      },
      assignment: {
        customerName: investigation.assignment?.customer_name ?? investigation.inspection.customer_name,
        customerRole: investigation.assignment?.orderer_role,
        scopeDescription: investigation.scopeDescription,
        inspectionDate: investigation.inspection.date,
        inspectionTime: investigation.inspection.inspection_time,
      },
      inspector: {
        name: investigation.inspector?.full_name,
        company: investigation.inspector?.company_name,
      },
      sections: allowedSections.map((section) => ({
        sectionKey: section.key,
        title: section.title,
        currentText: section.text,
      })),
    }

    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TU_AI_MODEL,
        instructions: [
          'Du hjälper en svensk besiktningsman att skriva texter till ett utlåtande för teknisk utredning.',
          'Använd endast informationen i användarens instruktion och JSON-kontexten. Hitta inte på fakta, mätvärden, orsaker, ansvar eller åtgärder.',
          'Om något är osäkert, formulera det som en osäkerhet eller ett behov av fortsatt kontroll.',
          'Avslutande kommentarer ska innehålla neutralt juridiskt skydd: uppdragets begränsning, att utlåtandet bygger på tillgängligt underlag och att dolda/ej åtkomliga förhållanden inte omfattas.',
          'Skriv sakligt, fackmässigt och neutralt på svenska. Undvik marknadsförande språk.',
          'Returnera endast giltig JSON enligt formatet {"suggestions":[{"sectionKey":"...","title":"...","text":"..."}]}.',
          'Skapa bara förslag för sectionKey som finns i kontexten.',
        ].join('\n'),
        input: [
          `Användarens instruktion:\n${prompt}`,
          `Kontext:\n${JSON.stringify(contextPayload, null, 2)}`,
        ].join('\n\n'),
        max_output_tokens: 1800,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[api/tu/investigations/ai-draft] OpenAI request failed', {
        status: response.status,
        body: errorText.slice(0, 500),
      })
      return jsonError('AI-anropet misslyckades.', 500)
    }

    const text = extractText((await response.json()) as OpenAiResponse)
    const suggestions = parseSuggestions(text, new Set(allowedSections.map((section) => section.key)))

    return NextResponse.json({ model: TU_AI_MODEL, suggestions })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[api/tu/investigations/ai-draft] unexpected error', error)
    return jsonError('Kunde inte skapa AI-förslag.', 500)
  }
}
