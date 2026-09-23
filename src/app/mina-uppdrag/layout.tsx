import type { Metadata } from 'next'
import UppdragScope from '@/components/tasks/UppdragScope'

export const metadata: Metadata = {
  title: { absolute: 'Mina uppdrag | HusHub Uppdrag' },
  icons: { icon: '/uppdrag/brand/symbol.svg' },
  description: 'Dina tilldelade uppdrag och nästa steg.',
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
}

export default function RecipientPortalLayout({ children }: { children: React.ReactNode }) {
  return <UppdragScope>{children}</UppdragScope>
}
