import { NextResponse } from 'next/server'
import { createScratchTuInvestigation, listTuInvestigations, requireTuContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function text(body: Record<string, unknown>, key: string) {
  const value = body[key]
  return typeof value === 'string' ? value.trim() : ''
}

function mapAccessError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  return null
}

export async function GET() {
  try {
    const context = await requireTuContext()
    const items = await listTuInvestigations(context.orgId)
    return NextResponse.json({ items })
  } catch (error) {
    const accessError = mapAccessError(error)
    if (accessError) return accessError
    return jsonError('Kunde inte hämta TU-utredningar.', 500)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireTuContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const result = await createScratchTuInvestigation({
      orgId: context.orgId,
      createdBy: context.userId,
      responsibleProfileId: text(body, 'responsibleProfileId') || context.userId,
      title: text(body, 'title') || null,
      scopeDescription: text(body, 'scopeDescription') || null,
      propertyAddress: text(body, 'propertyAddress') || null,
      propertyPostalCode: text(body, 'propertyPostalCode') || null,
      propertyCity: text(body, 'propertyCity') || null,
      propertyMunicipality: text(body, 'propertyMunicipality') || null,
      propertyOwnerName: text(body, 'propertyOwnerName') || null,
      cadastralId: text(body, 'cadastralId') || null,
      customerName: text(body, 'customerName') || null,
      customerEmail: text(body, 'customerEmail') || null,
      customerPhone: text(body, 'customerPhone') || null,
      customerAddress: text(body, 'customerAddress') || null,
      customerPostalCode: text(body, 'customerPostalCode') || null,
      customerCity: text(body, 'customerCity') || null,
      date: text(body, 'date') || null,
      time: text(body, 'time') || null,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const accessError = mapAccessError(error)
    if (accessError) return accessError
    return jsonError('Kunde inte skapa TU-utredning.', 500)
  }
}
