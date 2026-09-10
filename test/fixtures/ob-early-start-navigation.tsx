import type { ReactNode } from 'react'

export const useParams = () => ({ id: 'test-assignment' })
const router = { push: (url: string) => { document.body.dataset.navigation = url } }
export const useRouter = () => router
export default function PreviewProtected({ children }: { children: ReactNode }) { return <>{children}</> }
