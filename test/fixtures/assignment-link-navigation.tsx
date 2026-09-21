import type { ReactNode } from 'react'
export function useParams() { return { token: window.location.pathname.split('/').at(-1), id: 'synthetic-assignment' } }
export function useRouter() { return { push: (url: string) => { window.location.href = url }, back: () => window.history.back() } }
export default function Protected({ children }: { children: ReactNode }) { return <>{children}</> }
