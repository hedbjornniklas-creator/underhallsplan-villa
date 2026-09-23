import type { ReactNode } from 'react'

export const useParams = () => ({ token: 'brand-test' })
export const usePathname = () => window.location.pathname
export const useSearchParams = () => new URLSearchParams(window.location.search)
const router = { push: (href: string) => { location.href = href }, replace: (href: string) => { location.href = href }, refresh() {} }
export const useRouter = () => router
export const notFound = () => { throw new Error('Fixture not found') }
export default function Protected({ children }: { children: ReactNode }) { return children }
