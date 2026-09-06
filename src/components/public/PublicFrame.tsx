import type { ReactNode } from 'react'
import Link from 'next/link'
import './public.css'
import Image from 'next/image'
import type { PublicProductId } from '@/lib/publicNavigation'
import PublicHeader from './PublicHeader'
import { PublicSessionProvider } from './PublicSession'

export default function PublicFrame({ children, activeProduct }: { children: ReactNode; activeProduct?: PublicProductId }) {
  return (
    <div className="public-site">
      <PublicSessionProvider>
        <PublicHeader activeProduct={activeProduct} />
        <main id="public-content" tabIndex={-1}>{children}</main>
        <footer className="public-footer">
          <div className="public-container public-footer-inner">
            <div><Link href="/" className="public-brand" aria-label="HusHub – startsida"><Image src="/landing/Hushub-check2.png" alt="" width={709} height={532} className="public-brand-mark" /><span>HusHub</span></Link><p>BesiktApp och RenoApp från HusHub.</p></div>
            <nav aria-label="Sidfot"><Link href="/#besiktapp">Om BesiktApp</Link><Link href="/renoapp">Om RenoApp</Link><Link href="/#hjalp">Hjälp</Link><Link href="/renoapp/request-access">Intresseanmälan för BRF</Link></nav>
          </div>
        </footer>
      </PublicSessionProvider>
    </div>
  )
}
