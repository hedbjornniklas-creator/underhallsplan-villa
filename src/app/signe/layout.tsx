import type { ReactNode } from 'react'
import UppdragScope from '@/components/tasks/UppdragScope'

export const metadata = { title: { absolute: 'Uppdrag | HusHub' }, icons: { icon: '/uppdrag/brand/symbol.svg' }, robots: { index: false, follow: false } }

export default function TaskLinkLayout({ children }: { children: ReactNode }) {
  return <UppdragScope>{children}</UppdragScope>
}
