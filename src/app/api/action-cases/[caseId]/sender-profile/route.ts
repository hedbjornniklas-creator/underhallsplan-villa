import { customerOfferContext, customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { getCustomerOfferWorkspace } from '@/lib/action-cases/customerOffersServer'
import { getContractSenderWorkspace, selectContractSenderProfile } from '@/lib/action-cases/contractSenderProfileServer'
import { organizationJson, readOrganizationJson } from '@/lib/organizations/administrationHttp'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
type Params = { params: Promise<{ caseId: string }> }

async function failure(error: unknown) {
  const candidate = error instanceof Error ? error.message : ''
  if (candidate === 'ORG_ORIGIN_FORBIDDEN') return organizationJson({ error: 'Otillåten begäran.', code: 'CUSTOMER_SENDER_FORBIDDEN' }, 403)
  if (['ORG_REQUEST_INVALID', 'ORG_CONTENT_TYPE_INVALID', 'ORG_REQUEST_TOO_LARGE'].includes(candidate)) {
    return organizationJson({ error: 'Kontrollera avsändarvalet och försök igen.', code: 'CUSTOMER_SENDER_INVALID' }, candidate === 'ORG_REQUEST_TOO_LARGE' ? 413 : 400)
  }
  const response = customerOfferError(error)
  const code = /^(CUSTOMER_(SENDER_[A-Z_]+|OFFER_(STALE|LOCKED|ACCEPTED|NOT_FOUND|INVALID))|UNAUTHORIZED|MODULE_ACCESS_REQUIRED|PRODUCT_ACCESS_REQUIRED|ORG_MEMBERSHIP_REQUIRED|ORG_SELECTION_INVALID)$/u.test(candidate)
    ? candidate : 'CUSTOMER_SENDER_FAILED'
  return organizationJson({ ...await response.json(), code }, response.status)
}
export async function GET(_request: Request, { params }: Params) {
  try { return organizationJson(await getContractSenderWorkspace(await customerOfferContext(), (await params).caseId)) }
  catch (error) { return failure(error) }
}
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await customerOfferContext(), { caseId } = await params
    const body = await readOrganizationJson(request)
    await selectContractSenderProfile(ctx, caseId, body)
    return organizationJson({ saved: true, workspace: await getCustomerOfferWorkspace(ctx, caseId) })
  } catch (error) { return failure(error) }
}
