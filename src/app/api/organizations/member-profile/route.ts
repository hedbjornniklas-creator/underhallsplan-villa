import { requireOrganizationContext } from '@/lib/organizations/administration'
import { getOrganizationProfileWorkspace, resolveOrganizationProfileCard, saveOrganizationProfileCard, importLegacyOrganizationProfileMedia } from '@/lib/organizations/profileCard'
import { parseOrganizationProfileCardValues } from '@/lib/organizations/profileCardTypes'
import { organizationJson, organizationFailure, readOrganizationJson } from '@/lib/organizations/administrationHttp'

export const dynamic = 'force-dynamic'

export async function PUT(request: Request) {
  try {
    const body = await readOrganizationJson(request)
    if (Object.keys(body).length !== 3 || !Object.hasOwn(body, 'orgId') || !Object.hasOwn(body, 'card') || !Object.hasOwn(body, 'expectedVersion')) throw new Error('ORG_INPUT_INVALID')
    if (body.expectedVersion !== null && (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) <= 0)) throw new Error('ORG_INPUT_INVALID')
    const context = await requireOrganizationContext(body.orgId)
    if (context.migrationRequired) throw new Error('ORG_MIGRATION_REQUIRED')
    const personal = body.card
    const fields = ['displayName', 'title', 'phone', 'email', 'avatarPath', 'signaturePath']
    if (!personal || typeof personal !== 'object' || Array.isArray(personal) || Object.keys(personal).length !== fields.length || fields.some(field => !Object.hasOwn(personal, field))) throw new Error('ORG_INPUT_INVALID')
    const input = { orgId: context.organization.id, profileId: context.profileId }
    const current = await resolveOrganizationProfileCard(input)
    const values = parseOrganizationProfileCardValues({
      ...personal,
      companyName: current.companyName, companyOrgNo: current.companyOrgNo,
      companyAddress: current.companyAddress, companyPostalCode: current.companyPostalCode,
      companyCity: current.companyCity, logoPath: current.logoPath, reportFooterText: current.reportFooterText,
    })
    await saveOrganizationProfileCard({ ...input, actorProfileId: context.profileId, expectedVersion: body.expectedVersion as number | null, values })
    return organizationJson({ workspace: await getOrganizationProfileWorkspace({ ...input, orgName: context.organization.name, role: context.role }) })
  } catch (error) { return organizationFailure(error) }
}

export async function POST(request: Request) {
  try {
    const body = await readOrganizationJson(request)
    if (Object.keys(body).length !== 3 || body.action !== 'import_legacy_media' || !Object.hasOwn(body, 'orgId') || !Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1) throw new Error('ORG_INPUT_INVALID')
    const context = await requireOrganizationContext(body.orgId)
    if (context.migrationRequired) throw new Error('ORG_MIGRATION_REQUIRED')
    const input = { orgId: context.organization.id, profileId: context.profileId }
    await importLegacyOrganizationProfileMedia({ ...input, actorProfileId: context.profileId, expectedVersion: body.expectedVersion as number })
    return organizationJson({ workspace: await getOrganizationProfileWorkspace({ ...input, orgName: context.organization.name, role: context.role }) })
  } catch (error) { return organizationFailure(error) }
}
