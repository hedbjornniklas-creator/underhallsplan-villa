import { createSelfServiceOrganization, requireOrganizationCreationAccount } from '@/lib/organizations/selfService'
import { organizationFailure, organizationJson, readOrganizationJson } from '@/lib/organizations/administrationHttp'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    await requireOrganizationCreationAccount()
    return organizationJson(await createSelfServiceOrganization(await readOrganizationJson(request)))
  } catch (error) { return organizationFailure(error) }
}
