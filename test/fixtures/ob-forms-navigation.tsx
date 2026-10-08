// Present the /round fixture as an OB entity while retaining its local preview URL.
import { useMemo } from 'react'
import { usePathname as usePreviewPathname, useRouter as usePreviewRouter } from './ob-overview-navigation'
export { default, useSearchParams } from './ob-overview-navigation'

const entityPath = '/properties/synthetic-property/ob/10000000-0000-4000-8000-000000000001'
const router = {
  replace(href: string) {
    const url = new URL(href, location.href)
    window.history.replaceState(null, '', `${url.pathname === entityPath ? '/round' : url.pathname}${url.search}${url.hash}`)
    window.dispatchEvent(new Event('popstate'))
  },
}
export function usePathname() {
  const pathname = usePreviewPathname()
  return pathname === '/round' ? entityPath : pathname
}
export function useRouter() {
  const preview = usePreviewRouter()
  return useMemo(() => ({ ...preview, replace: router.replace }), [preview])
}
