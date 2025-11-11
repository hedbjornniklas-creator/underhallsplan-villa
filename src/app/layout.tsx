// src/app/layout.tsx
import './globals.css'

export const metadata = {
  title: 'Underhållsplan Villa',
  description: 'Digitalt verktyg för besiktningsmän och underhållsplaner',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body className="bg-gray-50 text-gray-900">{children}</body>
    </html>
  )
}
