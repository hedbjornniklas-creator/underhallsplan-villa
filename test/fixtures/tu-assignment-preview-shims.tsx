import type { ReactNode } from 'react'
const org = '11111111-1111-4111-8111-111111111111'
const params = { id: 'assignment-1' }
const search = new URLSearchParams({ orgId: org })
const router = { push: (path: string) => { document.getElementById('navigation-result')!.textContent = path } }
export const useParams = () => params
export const useSearchParams = () => search
export const useRouter = () => router
export default function Protected({ children }: { children: ReactNode }) { return <>{children}</> }
