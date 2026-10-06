import type { ComponentProps, ReactNode } from 'react'
import { useSyncExternalStore } from 'react'

export default function PreviewLink({ href, children, prefetch: _prefetch, ...props }: Omit<ComponentProps<'a'>, 'href'> & {
  href: string; children: ReactNode; prefetch?: boolean
}) {
  void _prefetch
  return <a href={href} {...props}>{children}</a>
}
function notifyNavigation(href: string) {
  window.history.replaceState(null, '', href)
  window.dispatchEvent(new Event('popstate'))
}
const router = {
  push(href: string) {
    window.__obHomeTest?.navigations.push(href)
    if (new URL(href, location.href).pathname === '/ob') notifyNavigation(href)
  },
  replace: notifyNavigation,
  refresh() {},
}
export function useRouter() { return router }
const subscribe = (callback: () => void) => { window.addEventListener('popstate', callback); return () => window.removeEventListener('popstate', callback) }
export function usePathname() { return useSyncExternalStore(subscribe, () => location.pathname) }
export function useSearchParams() { return new URLSearchParams(useSyncExternalStore(subscribe, () => location.search)) }
