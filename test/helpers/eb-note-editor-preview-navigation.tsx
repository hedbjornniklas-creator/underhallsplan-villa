import type { ReactNode } from 'react'

export default function PreviewWrapper({ children, href, ...props }: { children: ReactNode; href?: string }) {
  return href ? <a {...props} href={href} onClick={event => event.preventDefault()}>{children}</a> : <>{children}</>
}

const router = { replace() {}, push() {}, refresh() {} }
export function useRouter() { return router }
export function usePathname() { return '/eb/projects/project-alpha/inspections/editor-preview/perform' }
