import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { updateEbProject } from '@/lib/eb/server'

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
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('EB kräver egen modulbehörighet.', 403)
  if (message === 'EB_PROJECT_NOT_FOUND') return jsonError('Entreprenaden hittades inte.', 404)
  return jsonError(message || fallback, 500)
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const title = toText(body.title)

    if (!title) {
      return jsonError('Ange projektnamn.', 400)
    }

    const project = await updateEbProject({
      orgId: org.orgId,
      projectId,
      title,
      contractName: toText(body.contractName) || null,
      objectDescription: toText(body.objectDescription) || null,
      propertyDesignation: toText(body.propertyDesignation) || null,
      brfApartmentNumber: toText(body.brfApartmentNumber) || null,
      address: toText(body.address) || null,
      postalCode: toText(body.postalCode) || null,
      city: toText(body.city) || null,
      municipality: toText(body.municipality) || null,
      standardAgreement: toText(body.standardAgreement) || null,
      contractForm: toText(body.contractForm) || null,
      procurementForm: toText(body.procurementForm) || null,
      contractDate: toText(body.contractDate) || null,
      notePrefix: toText(body.notePrefix) || null,
      clientName: toText(body.clientName) || null,
      clientOrgNo: toText(body.clientOrgNo) || null,
      clientAddress: toText(body.clientAddress) || null,
      clientPostalCode: toText(body.clientPostalCode) || null,
      clientCity: toText(body.clientCity) || null,
      contractorName: toText(body.contractorName) || null,
      contractorOrgNo: toText(body.contractorOrgNo) || null,
      contractorAddress: toText(body.contractorAddress) || null,
      contractorPostalCode: toText(body.contractorPostalCode) || null,
      contractorCity: toText(body.contractorCity) || null,
      agreementItems: Array.isArray(body.agreementItems) ? body.agreementItems : [],
    })

    return NextResponse.json({ project })
  } catch (error) {
    return mapError(error, 'Kunde inte uppdatera EB-projekt.')
  }
}
