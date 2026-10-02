export type OrganizationSwitcherSurface = 'tu' | 'moisture' | 'customers' | 'settings'

export function organizationSwitcherSurfaceForPath(pathname: string): OrganizationSwitcherSurface | null {
  const normalized = pathname.toLowerCase()
  if (normalized === '/tu' || normalized.startsWith('/tu/')) return 'tu'
  if (normalized === '/fuktsakerhet' || normalized.startsWith('/fuktsakerhet/')) return 'moisture'
  if (normalized === '/settings/kunder' || normalized.startsWith('/settings/kunder/')) return 'customers'
  if (['/settings', '/settings/organisation', '/settings/profil'].includes(normalized)) return 'settings'
  return null
}

export function organizationSwitcherRoot(surface: OrganizationSwitcherSurface) {
  if (surface === 'tu') return '/tu'
  if (surface === 'moisture') return '/fuktsakerhet'
  if (surface === 'settings') return '/settings/organisation'
  return '/settings/kunder'
}

export function organizationSwitchDestination(input: {
  pathname: string
  search: string
  surface: OrganizationSwitcherSurface
  orgId: string
}) {
  const root = organizationSwitcherRoot(input.surface)
  const onSafeRoot = input.pathname === root ||
    (input.surface === 'tu' && input.pathname === '/tu/settings/profile') ||
    (input.surface === 'settings' && ['/settings', '/settings/profil'].includes(input.pathname))
  const targetPath = onSafeRoot ? input.pathname : root
  const next = onSafeRoot ? new URLSearchParams(input.search) : new URLSearchParams()
  next.set('orgId', input.orgId)
  return `${targetPath}?${next.toString()}`
}
