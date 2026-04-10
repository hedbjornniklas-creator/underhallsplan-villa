import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Underhållsplan Villa',
  description: 'Digitalt verktyg för besiktningsmän och underhållsplaner',
  icons: {
    icon: '/landing/Hushub_favicon.png',
    shortcut: '/landing/Hushub_favicon.png',
    apple: '/landing/Hushub_favicon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body className="bg-gray-50 text-gray-900">{children}</body>
    </html>
  )
}
