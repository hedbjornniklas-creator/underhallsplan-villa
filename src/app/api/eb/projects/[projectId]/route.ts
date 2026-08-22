import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import {
  updateEbProject,
  type EbDrainageInspectionStage,
  type EbDrainageSystem,
  type EbProjectTemplateKey,
} from '@/lib/eb/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function toText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
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
  return jsonError(fallback, 500)
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
      projectTemplateKey: (toText(body.projectTemplateKey) || null) as EbProjectTemplateKey | null,
      drainageSystem: (toText(body.drainageSystem) || null) as EbDrainageSystem | null,
      drainageInspectionStage: (toText(body.drainageInspectionStage) || null) as
        | EbDrainageInspectionStage
        | null,
      drainageGuidanceVersion: toText(body.drainageGuidanceVersion) || null,
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
      agreementNote: toText(body.agreementNote) || null,
      notePrefix: toText(body.notePrefix) || null,
      clientName: toText(body.clientName) || null,
      clientOrgNo: toText(body.clientOrgNo) || null,
      clientEmail: toText(body.clientEmail) || null,
      clientPhone: toText(body.clientPhone) || null,
      clientAddressMatchesObject: toBoolean(body.clientAddressMatchesObject, false),
      clientAddress: toText(body.clientAddress) || null,
      clientPostalCode: toText(body.clientPostalCode) || null,
      clientCity: toText(body.clientCity) || null,
      clientIsPropertyOwner: toBoolean(body.clientIsPropertyOwner, true),
      propertyOwnerName: toText(body.propertyOwnerName) || null,
      contractorName: toText(body.contractorName) || null,
      contractorOrgNo: toText(body.contractorOrgNo) || null,
      contractorEmail: toText(body.contractorEmail) || null,
      contractorPhone: toText(body.contractorPhone) || null,
      contractorAddress: toText(body.contractorAddress) || null,
      contractorPostalCode: toText(body.contractorPostalCode) || null,
      contractorCity: toText(body.contractorCity) || null,
      invoiceRecipientMatchesClient: toBoolean(body.invoiceRecipientMatchesClient, true),
      invoiceName: toText(body.invoiceName) || null,
      invoiceOrgNo: toText(body.invoiceOrgNo) || null,
      invoiceReference: toText(body.invoiceReference) || null,
      invoiceEmailMatchesClient: toBoolean(body.invoiceEmailMatchesClient, true),
      invoiceEmail: toText(body.invoiceEmail) || null,
      invoiceAddressMatchesClient: toBoolean(body.invoiceAddressMatchesClient, true),
      invoiceAddress: toText(body.invoiceAddress) || null,
      invoicePostalCode: toText(body.invoicePostalCode) || null,
      invoiceCity: toText(body.invoiceCity) || null,
      agreementItems: Array.isArray(body.agreementItems) ? body.agreementItems : [],
    })

    return NextResponse.json({ project })
  } catch (error) {
    return mapError(error, 'Kunde inte uppdatera EB-projekt.')
  }
}
