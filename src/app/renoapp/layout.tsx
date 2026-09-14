import type { ReactNode } from 'react'
import RenoAppHeader from '@/components/renoapp/RenoAppHeader'
import '@/components/renoapp/renoapp-theme.css'

export const metadata = {
  title: 'RenoApp',
  icons: { icon: '/renoapp/brand/symbol.svg' },
  description:
    'RenoApp samlar renoveringsansökan, underlag, kompletteringar och beslut för bostadsrättsföreningar.',
}

export default function RenoAppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="renoapp-scope">
      <RenoAppHeader />
      {children}
    </div>
  )
}
