import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { isOrganizationUuid } from '@/lib/organizations/administrationHttp'
import { parseSelfServiceOrganizationCreate } from '@/lib/organizations/selfServiceTypes'

export async function requireOrganizationCreationAccount() {
  const { data: { user }, error } = await createSupabaseServerClient().auth.getUser()
  if (error || !user) throw new Error('UNAUTHORIZED')
  // Confirmation comes from Auth, never a mutable profile or browser field.
  if (!user.email || !user.email_confirmed_at) throw new Error('ORG_EMAIL_UNVERIFIED')
  return user.id
}

export async function createSelfServiceOrganization(value: unknown) {
  const actor = await requireOrganizationCreationAccount()
  const { requestId, ...values } = parseSelfServiceOrganizationCreate(value)
  const { data, error } = await createSupabaseAdminClient().rpc('organization_self_service_create', {
    p_actor: actor, p_request_id: requestId, p_values: values,
  })
  if (error) {
    if (['42P01', '42703', 'PGRST205', 'PGRST202'].includes(error.code ?? '')) throw new Error('ORG_SCHEMA_REQUIRED')
    if (/^ORG_[A-Z_]+$/u.test(error.message ?? '')) throw new Error(error.message)
    throw new Error('ORG_REQUEST_FAILED')
  }
  if (data?.saved !== true || !isOrganizationUuid(data.organizationId)) throw new Error('ORG_REQUEST_FAILED')
  return { saved: true as const, organizationId: data.organizationId }
}
