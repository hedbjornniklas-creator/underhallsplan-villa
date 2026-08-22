import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Mina uppdrag',
  description: 'Dina tilldelade uppdrag och nästa steg.',
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
}

export default function RecipientPortalLayout({ children }: { children: React.ReactNode }) {
  return children
}
