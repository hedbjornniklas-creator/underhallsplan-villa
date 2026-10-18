import type { ComponentProps, ReactNode } from 'react'

export default function PreviewLink({ href, children, prefetch: _prefetch, ...props }: Omit<ComponentProps<'a'>, 'href'> & {
  href: string; children: ReactNode; prefetch?: boolean
}) {
  void _prefetch
  return <a href={href} {...props}>{children}</a>
}

const router = {
  push(href: string) { window.__ebOverviewTest.navigations.push(href) },
  replace(href: string) { window.__ebOverviewTest.navigations.push(href) },
  refresh() { window.__ebOverviewTest.refreshes++ },
}
export function useRouter() { return router }
export function usePathname() { return '/eb' }
export function useSearchParams() { return new URLSearchParams(location.search) }
