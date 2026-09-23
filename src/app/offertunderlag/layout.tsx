import type { ReactNode } from 'react'
import UppdragScope from '@/components/tasks/UppdragScope'

export const metadata = { icons: { icon: '/uppdrag/brand/symbol.svg' } }

export default function RfqLayout({ children }: { children: ReactNode }) {
  return <UppdragScope external>{children}</UppdragScope>
}
