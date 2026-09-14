import type { ReactNode } from 'react'
import { PublicSessionProvider } from '@/components/public/PublicSession'
import PublicCompanyIdentity from '@/components/public/PublicCompanyIdentity'
import RenoAppBrand from './RenoAppBrand'
import RenoAppPublicHeader from './RenoAppPublicHeader'
import '@/components/public/public.css'

export default function RenoAppPublicFrame({ children }: { children: ReactNode; activeProduct?: 'renoapp' }) {
  return (
    <div className="public-site reno-public-site">
      <PublicSessionProvider>
        <RenoAppPublicHeader />
        <main id="public-content" tabIndex={-1}>{children}</main>
        <footer className="reno-footer">
          <div><RenoAppBrand href="https://renoapp.se/" /><p>En tjänst från HusHub.</p><PublicCompanyIdentity /></div>
          <nav aria-label="Sidfot">
            <a href="https://renoapp.se/kontakt">Kontakt</a>
            <a href="https://renoapp.se/">Om RenoApp</a>
            <a href="https://hushub.se/">Till HusHub</a>
            <a href="/om-hushub">Om företaget</a>
          </nav>
        </footer>
      </PublicSessionProvider>
    </div>
  )
}
