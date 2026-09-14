'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PublicProductLink, usePublicSession } from '@/components/public/PublicSession'
import RenoAppBrand from './RenoAppBrand'
import RenoAppMenu from './RenoAppMenu'

export default function RenoAppPublicHeader() {
  const pathname = usePathname()
  const authenticated = usePublicSession()
  const links = (
    <nav className="reno-nav" aria-label="RenoApp">
      <a href="https://renoapp.se/">Om RenoApp</a>
      <Link href="/renoapp/apply" aria-current={pathname === '/renoapp/apply' ? 'page' : undefined}>Ansök om renovering</Link>
      <a href="https://renoapp.se/kontakt">Kontakt</a>
      <PublicProductLink product="renoapp">{authenticated ? 'Styrelseportalen' : 'Logga in'}</PublicProductLink>
      <Link className="reno-button" href="/renoapp/request-access">Anslut föreningen</Link>
    </nav>
  )
  return (
    <header className="reno-header">
      <a href="#public-content" className="reno-skip-link">Till innehållet</a>
      <div className="reno-header-inner">
        <RenoAppBrand href="https://renoapp.se/" />
        <div className="reno-desktop-nav">{links}</div>
        <RenoAppMenu key={pathname}>{links}</RenoAppMenu>
      </div>
    </header>
  )
}
