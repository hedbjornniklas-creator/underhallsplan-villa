import 'server-only'

import { hasCurrentUserAccess } from '@/lib/access/server'
import { getOrganizationCustomerNavigationContext } from '@/lib/customers/server'
import { requireTuContext } from '@/lib/tu/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export type OrganizationSwitcherSurface = 'tu' | 'customers'

export type OrganizationSwitcherOption = {
  id: string
  name: string | null
  isDefault: boolean
}

export type OrganizationSwitcherContext = {
  organization: OrganizationSwitcherOption
  organizations: OrganizationSwitcherOption[]
}

type MembershipRow = {
  org_id: string
  is_default: boolean
  created_at: string
  organizations: { name: string | null } | Array<{ name: string | null }> | null
}

function organizationName(value: MembershipRow['organizations']) {
  const organization = Array.isArray(value) ? value[0] : value
  const name = organization?.name?.trim()
  return name || null
}

export async function getOrganizationSwitcherContext(
  surface: OrganizationSwitcherSurface,
  requestedOrgId?: unknown
): Promise<OrganizationSwitcherContext> {
  if (surface === 'customers') {
    const context = await getOrganizationCustomerNavigationContext(requestedOrgId)
    return {
      organization: {
        id: context.organization.id,
        name: context.organization.name,
        isDefault: context.organization.isDefault,
      },
      organizations: context.organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        isDefault: organization.isDefault,
      })),
    }
  }

  const selected = await requireTuContext(requestedOrgId)

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('org_members')
    .select('org_id,is_default,created_at,organizations(name)')
    .eq('profile_id', selected.userId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .order('org_id', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta organisationer.')
  }

  let organizations = ((data ?? []) as unknown as MembershipRow[]).map(
    (membership): OrganizationSwitcherOption => ({
      id: membership.org_id,
      name: organizationName(membership.organizations),
      isDefault: membership.is_default,
    })
  )

  const hasGlobalAccess = await hasCurrentUserAccess({
    productKey: 'dashboard',
    moduleKey: 'technical_investigations',
    scopeType: 'global',
  })

  if (!hasGlobalAccess) {
    const allowed = await Promise.all(
      organizations.map(async (organization) => ({
        id: organization.id,
        allowed: await hasCurrentUserAccess({
          productKey: 'dashboard',
          moduleKey: 'technical_investigations',
          scopeType: 'organization',
          scopeId: organization.id,
        }),
      }))
    )
    const allowedIds = new Set(
      allowed.filter((item) => item.allowed).map((item) => item.id)
    )
    organizations = organizations.filter((organization) => allowedIds.has(organization.id))
  }

  const organization = organizations.find((item) => item.id === selected.orgId)
  if (!organization) {
    throw new Error('MODULE_ACCESS_REQUIRED')
  }

  return { organization, organizations }
}
