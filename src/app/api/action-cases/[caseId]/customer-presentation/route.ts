import { customerOfferContext, customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { getCustomerOfferWorkspace } from '@/lib/action-cases/customerOffersServer'
import { selectProjectCustomerPresentation } from '@/lib/action-cases/customerPresentationServer'
import { organizationJson, readOrganizationJson } from '@/lib/organizations/administrationHttp'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ caseId: string }> }
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await customerOfferContext(), { caseId } = await params
    await selectProjectCustomerPresentation(ctx, caseId, await readOrganizationJson(request))
    return organizationJson({ saved: true, workspace: await getCustomerOfferWorkspace(ctx, caseId) })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'ORG_ORIGIN_FORBIDDEN') return organizationJson({ error: 'Otillåten begäran.' }, 403)
    if (['ORG_REQUEST_INVALID', 'ORG_CONTENT_TYPE_INVALID', 'ORG_REQUEST_TOO_LARGE'].includes(code)) return organizationJson({ error: 'Kontrollera beställarvalet.' }, code === 'ORG_REQUEST_TOO_LARGE' ? 413 : 400)
    return customerOfferError(error)
  }
}
