import type { ReactNode } from 'react'
export function useParams() { return { token: window.location.pathname.split('/').at(-1), id: 'synthetic-assignment' } }
export function usePathname() { return window.location.pathname }
export function useOrganizationContext() {
  return { organization: { id: 'synthetic-org', name: 'Synthetic organization', isDefault: true }, error: null }
}
export function useRouter() { return { push: (url: string) => { window.location.href = url }, back: () => window.history.back() } }
export default function Protected({ children }: { children: ReactNode }) { return <>{children}</> }
