import 'server-only'

import type { createSupabaseAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>
type CustomerScope = { admin: AdminClient; orgId: string; projectId: string; inspectionId: string }

export type EbFollowUpCustomerResolution = {
  email: string | null
  source: 'confirmed' | 'assignment' | 'missing' | 'conflict'
}

export type EbFollowUpCustomerSettings = EbFollowUpCustomerResolution & {
  projectEmail: string | null
  assignmentEmail: string | null
  confirmedAt: string | null
  confirmedBy: string | null
  purchased: boolean
  purchasedEmail: string | null
}

export type EbFollowUpDeliveryCustomer = {
  email: string | null
  established: boolean
  purchased: boolean
}

function email(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null
}

// Keep in sync with eb_resolve_follow_up_customer_email in the customer migration.
// The shared acceptance workflow calls accepted assignments "ordered"/"booked".
export function isAcceptedEbFollowUpAssignment(assignment: { status?: unknown; accepted_at?: unknown } | null) {
  return Boolean(assignment?.accepted_at) &&
    ['ordered', 'booked', 'completed', 'accepted'].includes(String(assignment?.status ?? ''))
}

export function selectEbFollowUpCustomer(input: {
  confirmedEmail: unknown
  assignmentEmail: unknown
  projectEmail: unknown
}): EbFollowUpCustomerResolution {
  const confirmedEmail = email(input.confirmedEmail)
  if (confirmedEmail) return { email: confirmedEmail, source: 'confirmed' }
  const assignmentEmail = email(input.assignmentEmail)
  if (!assignmentEmail) return { email: null, source: 'missing' }
  const projectEmail = email(input.projectEmail)
  // A nonempty malformed project address also requires an explicit decision.
  if (String(input.projectEmail ?? '').trim() && projectEmail !== assignmentEmail) {
    return { email: null, source: 'conflict' }
  }
  return { email: assignmentEmail, source: 'assignment' }
}

function assertQuery(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) {
    throw new Error('EB_FOLLOW_UP_CONFIGURATION')
  }
  throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
}

async function deliveryCustomerOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (failure) {
    if (failure instanceof Error && [
      'EB_INSPECTION_NOT_FOUND', 'EB_FOLLOW_UP_CONFIGURATION', 'EB_FOLLOW_UP_UNAVAILABLE',
      'EB_FOLLOW_UP_EMAIL_INVALID', 'EB_FOLLOW_UP_ACTOR_INVALID',
    ].includes(failure.message)) throw failure
    // Supabase can reject before returning its usual { data, error } envelope.
    // Keep optional customer metadata isolated from report/PDF availability.
    throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  }
}

async function loadCustomerSources(input: CustomerScope) {
  const { admin, orgId, projectId, inspectionId } = input
  const [detail, project, confirmed, confirmation] = await Promise.all([
    admin.from('eb_inspection_details').select('inspection_id')
      .eq('org_id', orgId).eq('eb_project_id', projectId).eq('inspection_id', inspectionId).maybeSingle(),
    admin.from('eb_projects').select('client_email').eq('org_id', orgId).eq('id', projectId).maybeSingle(),
    admin.from('eb_follow_up_customers').select('email,confirmed_at,confirmed_by')
      .eq('org_id', orgId).eq('eb_project_id', projectId).eq('inspection_id', inspectionId).maybeSingle(),
    admin.from('eb_assignment_confirmations').select('assignment_id')
      .eq('org_id', orgId).eq('inspection_id', inspectionId).eq('is_current', true).maybeSingle(),
  ])
  for (const result of [detail, project, confirmed, confirmation]) assertQuery(result.error)
  if (!project.data || !detail.data) throw new Error('EB_INSPECTION_NOT_FOUND')
  let assignmentEmail: string | null = null
  if (confirmation.data?.assignment_id) {
    const assignment = await admin.from('assignments').select('customer_email,accepted_at,status')
      .eq('org_id', orgId).eq('id', confirmation.data.assignment_id).maybeSingle()
    assertQuery(assignment.error)
    if (isAcceptedEbFollowUpAssignment(assignment.data)) assignmentEmail = email(assignment.data?.customer_email)
  }
  return {
    ...selectEbFollowUpCustomer({
      confirmedEmail: confirmed.data?.email,
      assignmentEmail,
      projectEmail: project.data.client_email,
    }),
    projectEmail: email(project.data.client_email),
    assignmentEmail,
    confirmedAt: (confirmed.data?.confirmed_at as string | null) ?? null,
    confirmedBy: (confirmed.data?.confirmed_by as string | null) ?? null,
  }
}

/** Resolves NEW purchases only. Existing orders must use their immutable buyer snapshot. */
export async function resolveEbFollowUpCustomer(input: CustomerScope): Promise<EbFollowUpCustomerResolution> {
  const { email, source } = await loadCustomerSources(input)
  return { email, source }
}

export async function getEbFollowUpCustomerSettings(input: CustomerScope): Promise<EbFollowUpCustomerSettings> {
  const sources = await loadCustomerSources(input)
  const order = await input.admin.from('eb_follow_up_orders').select('buyer_snapshot')
    .eq('org_id', input.orgId).eq('eb_project_id', input.projectId).eq('inspection_id', input.inspectionId).maybeSingle()
  assertQuery(order.error)
  return { ...sources, purchased: Boolean(order.data), purchasedEmail: email(order.data?.buyer_snapshot?.email) }
}

/** Suggestions fill the delivery form; only an established contact or accepted assignment grants authority. */
export async function getEbFollowUpDeliveryCustomerDefaults(input: CustomerScope): Promise<EbFollowUpDeliveryCustomer> {
  return deliveryCustomerOperation(async () => {
    const order = await input.admin.from('eb_follow_up_orders').select('buyer_snapshot')
      .eq('org_id', input.orgId).eq('eb_project_id', input.projectId).eq('inspection_id', input.inspectionId).maybeSingle()
    assertQuery(order.error)
    if (order.data) return { email: email(order.data.buyer_snapshot?.email), established: true, purchased: true }
    const sources = await loadCustomerSources(input)
    const established = sources.source === 'confirmed'
    return {
      email: established ? sources.email : sources.assignmentEmail ?? sources.projectEmail,
      established,
      purchased: false,
    }
  })
}

/** First real delivery establishes the customer. Resending never silently transfers an existing contact/order. */
export async function initializeEbFollowUpDeliveryCustomer(
  input: CustomerScope & { email: unknown; userId: string },
): Promise<EbFollowUpDeliveryCustomer> {
  return deliveryCustomerOperation(async () => {
    const normalized = email(input.email)
    if (!normalized) throw new Error('EB_FOLLOW_UP_EMAIL_INVALID')
    const { data, error } = await input.admin.rpc('eb_initialize_follow_up_delivery_customer', {
      p_org_id: input.orgId,
      p_project_id: input.projectId,
      p_inspection_id: input.inspectionId,
      p_email: normalized,
      p_actor: input.userId,
    })
    for (const code of ['EB_INSPECTION_NOT_FOUND', 'EB_FOLLOW_UP_EMAIL_INVALID', 'EB_FOLLOW_UP_ACTOR_INVALID']) {
      if (error?.message?.includes(code)) throw new Error(code)
    }
    assertQuery(error)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
    const result = data as Record<string, unknown>
    if (result.established !== true || typeof result.purchased !== 'boolean') throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
    return { email: email(result.email), established: true, purchased: result.purchased }
  })
}

/** Only authenticated, org/inspection-authorized server callers may confirm a contact. */
export async function confirmEbFollowUpCustomer(input: CustomerScope & { email: unknown; userId: string }) {
  const normalized = email(input.email)
  if (!normalized) throw new Error('EB_FOLLOW_UP_EMAIL_INVALID')
  // The RPC repeats the scope check, records the actor/time, and serializes against purchases.
  const { error } = await input.admin.rpc('eb_confirm_follow_up_customer', {
    p_org_id: input.orgId,
    p_project_id: input.projectId,
    p_inspection_id: input.inspectionId,
    p_email: normalized,
    p_actor: input.userId,
  })
  if (error?.message?.includes('EB_FOLLOW_UP_CUSTOMER_FROZEN')) throw new Error('EB_FOLLOW_UP_CUSTOMER_FROZEN')
  if (error?.message?.includes('EB_INSPECTION_NOT_FOUND')) throw new Error('EB_INSPECTION_NOT_FOUND')
  assertQuery(error)
  return getEbFollowUpCustomerSettings(input)
}

/** An entry link is not authorization; checkout still requires recipient email verification. */
export function ebFollowUpCustomerEntryUrl(publicUrl: string, recipient: string, customerEmail: string | null) {
  if (!customerEmail || email(recipient) !== email(customerEmail)) return null
  const url = new URL(publicUrl)
  url.search = ''
  url.hash = ''
  url.searchParams.set('customer', '1')
  return url.toString()
}

/** Report delivery must still work when follow-up is not configured, without exposing a customer entry. */
export async function resolveEbFollowUpDeliveryCustomer(input: CustomerScope): Promise<string | null> {
  try {
    // Frozen owner is checked first so assignment changes cannot move a paid-order entry.
    const order = await input.admin.from('eb_follow_up_orders').select('buyer_snapshot')
      .eq('org_id', input.orgId).eq('eb_project_id', input.projectId).eq('inspection_id', input.inspectionId).maybeSingle()
    assertQuery(order.error)
    if (order.data) return email(order.data.buyer_snapshot?.email)
    return (await resolveEbFollowUpCustomer(input)).email
  } catch {
    return null
  }
}
