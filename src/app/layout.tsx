import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://hushub.se'),
  title: {
    default: 'HusHub | BesiktApp och RenoApp',
    template: '%s | HusHub',
  },
  description:
    'HusHub samlar BesiktApp för professionellt besiktningsarbete och RenoApp för renoveringsärenden i bostadsrättsföreningar.',
  icons: {
    icon: '/landing/Hushub_favicon.png',
    shortcut: '/landing/Hushub_favicon.png',
    apple: '/landing/Hushub_favicon.png',
  },
  openGraph: {
    title: 'HusHub | BesiktApp och RenoApp',
    description:
      'Två specialiserade verktyg på en gemensam grund: besiktningar från uppdrag till utlåtande och renoveringsärenden från ansökan till beslut.',
    url: '/',
    siteName: 'HusHub',
    locale: 'sv_SE',
    type: 'website',
    images: [
      {
        url: '/og.png',
        width: 1734,
        height: 907,
        alt: 'HusHub med de två arbetsflödena BesiktApp och RenoApp',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'HusHub | BesiktApp och RenoApp',
    description: 'Tydligare besiktningar och smidigare renoveringsärenden.',
    images: ['/og.png'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body className="bg-gray-50 text-gray-900">{children}</body>
    </html>
  )
}
