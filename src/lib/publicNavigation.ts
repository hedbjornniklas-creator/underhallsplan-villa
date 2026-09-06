export type PublicProductId = 'besiktapp' | 'renoapp'

export const PUBLIC_PRODUCTS = {
  besiktapp: {
    name: 'BesiktApp', logo: '/landing/BesiktApp.png', width: 1096, height: 311,
    appHref: '/dashboard-v1', loginHref: '/login?next=%2Fdashboard-v1', infoHref: '/#besiktapp',
  },
  renoapp: {
    name: 'RenoApp', logo: '/landing/Renoapp.png', width: 1240, height: 453,
    appHref: '/renoapp/app', loginHref: '/renoapp/login?next=%2Frenoapp%2Fapp', infoHref: '/renoapp',
  },
} as const

export function getPublicProductHref(product: PublicProductId, authenticated: boolean) {
  const destination = PUBLIC_PRODUCTS[product]
  return authenticated ? destination.appHref : destination.loginHref
}

export function isPublicRenoPage(pathname: string) {
  return ['/renoapp', '/renoapp/apply', '/renoapp/login', '/renoapp/request-access'].includes(pathname)
}

// Keep the existing login allowlist: query parameters never authorize a new destination.
export function getPublicLoginDestination(value: unknown) {
  return value === '/dashboard-v1' || value === '/renoapp/app' || value === '/mina-uppdrag' ? value : '/app'
}
