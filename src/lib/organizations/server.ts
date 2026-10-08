import 'server-only'

import { hasCurrentUserAccess } from '@/lib/access/server'
import { getOrganizationCustomerNavigationContext } from '@/lib/customers/server'
import { requireTuContext } from '@/lib/tu/server'
import { requireMoistureContext } from '@/lib/moisture/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { OrganizationSwitcherSurface } from './navigation'
import { requireOrganizationContext } from './administration'
import { hasOrganizationTuAccess } from '@/lib/organizations/moduleAvailability'
import { getObOrganizationSwitcherContext, type ObOrganizationEntity } from '@/lib/ob/organizationBindings'

export type { OrganizationSwitcherSurface } from './navigation'

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
  requestedOrgId?: unknown,
  obEntity?: ObOrganizationEntity
): Promise<OrganizationSwitcherContext> {
  if (surface === 'settings') {
    const selected = await requireOrganizationContext(requestedOrgId)
    const { data, error } = await createSupabaseAdminClient().from('org_members')
      .select('org_id,is_default,created_at,organizations(name)')
      .eq('profile_id', selected.profileId).eq('is_active', true)
      .order('is_default', { ascending: false }).order('created_at').order('org_id')
    if (error) throw new Error('ORG_PROFILE_READ_FAILED')
    const organizations = ((data ?? []) as unknown as MembershipRow[]).map(row => ({
      id: row.org_id, name: organizationName(row.organizations), isDefault: row.is_default,
    }))
    const organization = organizations.find(row => row.id === selected.organization.id)
    if (!organization) throw new Error('ORG_MEMBERSHIP_REQUIRED')
    return { organization, organizations }
  }
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

  if (surface === 'ob') {
    return getObOrganizationSwitcherContext(requestedOrgId, obEntity)
  }

  const selected = surface === 'moisture'
    ? await requireMoistureContext(requestedOrgId)
    : await requireTuContext(requestedOrgId)
  const moduleKey = surface === 'moisture' ? 'moisture_safety' : 'technical_investigations'

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
    moduleKey,
    scopeType: 'global',
  })

  if (surface === 'tu' || !hasGlobalAccess) {
    const allowed = await Promise.all(
      organizations.map(async (organization) => {
        const hasOrganizationAccess = await hasCurrentUserAccess({
          productKey: 'dashboard',
          moduleKey,
          scopeType: 'organization',
          scopeId: organization.id,
        })
        return {
          id: organization.id,
          // The switcher must offer the same TU organizations as the request
          // guard, including when an old global grant is still present.
          allowed: surface === 'tu'
            ? await hasOrganizationTuAccess(organization.id, hasOrganizationAccess, hasGlobalAccess)
            : hasOrganizationAccess,
        }
      })
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
