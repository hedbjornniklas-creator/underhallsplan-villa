import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createEbProjectWithInitialSlb, listEbProjects } from '@/lib/eb/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function toText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

async function requireEbContext() {
  await requireModuleAccess({
    productKey: 'dashboard',
    moduleKey: 'construction_inspections',
  })
  return requireOrgContext()
}

function mapError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : 'Okänt fel.'
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') {
    return jsonError('Ingen organisationskoppling hittades.', 403)
  }
  if (message === 'MODULE_ACCESS_REQUIRED') {
    return jsonError('EB kräver egen modulbehörighet.', 403)
  }
  return jsonError(message || fallback, 500)
}

export async function GET() {
  try {
    const context = await requireEbContext()
    const projects = await listEbProjects(context.orgId)
    return NextResponse.json({ projects })
  } catch (error) {
    return mapError(error, 'Kunde inte hämta EB-projekt.')
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const title = toText(body.title)

    if (!title) {
      return jsonError('Ange projektnamn.', 400)
    }

    const project = await createEbProjectWithInitialSlb({
      orgId: context.orgId,
      requestedByUserId: context.userId,
      title,
      contractName: toText(body.contractName) || null,
      objectDescription: toText(body.objectDescription) || null,
      propertyDesignation: toText(body.propertyDesignation) || null,
      address: toText(body.address) || null,
      postalCode: toText(body.postalCode) || null,
      city: toText(body.city) || null,
      municipality: toText(body.municipality) || null,
      standardAgreement: toText(body.standardAgreement) || null,
      contractForm: toText(body.contractForm) || null,
      procurementForm: toText(body.procurementForm) || null,
      contractDate: toText(body.contractDate) || null,
      clientName: toText(body.clientName) || null,
      clientOrgNo: toText(body.clientOrgNo) || null,
      contractorName: toText(body.contractorName) || null,
      contractorOrgNo: toText(body.contractorOrgNo) || null,
      inspectionDate: toText(body.inspectionDate) || null,
      inspectionTime: toText(body.inspectionTime) || null,
      meetingPlace: toText(body.meetingPlace) || null,
      startMeetingTime: toText(body.startMeetingTime) || null,
      finalMeetingTime: toText(body.finalMeetingTime) || null,
    })

    return NextResponse.json({ project }, { status: 201 })
  } catch (error) {
    return mapError(error, 'Kunde inte skapa EB-projekt.')
  }
}
