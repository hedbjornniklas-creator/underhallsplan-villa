'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { PUBLIC_PRODUCTS, type PublicProductId } from '@/lib/publicNavigation'
import { PublicProductLink, usePublicSession } from './PublicSession'
import { PUBLIC_COMMERCIAL_CONTENT, publishedContact } from '@/lib/publicCommercialContent'

const navigation = [
  { href: '/besiktapp', label: 'För besiktningsmän' },
  { href: '/renoapp', label: 'För föreningen' },
  { href: '/#hjalp', label: 'Hjälp' },
  ...(publishedContact(PUBLIC_COMMERCIAL_CONTENT.contact) ? [{ href: '#kontakt', label: 'Kontakt' }] : []),
]

export default function PublicHeader({ activeProduct }: { activeProduct?: PublicProductId }) {
  const authenticated = usePublicSession()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    const menuButton = menuButtonRef.current
    if (!dialog || !menuOpen) return
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      menuButton?.focus()
    }
  }, [menuOpen])

  const accountHref = authenticated ? '/app' : '/login'
  const accountLabel = authenticated ? 'Öppna HusHub' : 'Logga in'

  return (
    <header className="public-header">
      <a href="#public-content" className="public-skip-link">Hoppa till innehållet</a>
      <div className="public-productstrip">
        <nav aria-label="Öppna produkt" className="public-container public-productbar">
          {(Object.entries(PUBLIC_PRODUCTS) as [PublicProductId, typeof PUBLIC_PRODUCTS[PublicProductId]][]).map(([id, product]) => (
            <PublicProductLink
              key={id}
              product={id}
              ariaLabel={`Öppna ${product.name}${id === 'renoapp' ? ' för styrelsen' : ''}`}
              className={`public-product-logo${activeProduct === id ? ' is-active' : ''}`}
            >
              <Image src={product.logo} alt={product.name} width={product.width} height={product.height} />
            </PublicProductLink>
          ))}
        </nav>
      </div>
      <div className="public-container public-brandbar">
        <Link href="/" className="public-brand" aria-label="HusHub – startsida">
          <Image src="/landing/Hushub-check2.png" alt="" width={709} height={532} className="public-brand-mark" priority />
          <span>HusHub</span>
        </Link>
        <nav aria-label="Huvudnavigation" className="public-desktop-nav">
          {navigation.map((item) => <Link key={item.href} href={item.href} aria-current={item.href === pathname ? 'page' : undefined}>{item.label}</Link>)}
        </nav>
        <div className="public-header-actions">
          <Link className="public-button public-button-small" href={accountHref} prefetch={false}>{accountLabel}</Link>
          <button
            type="button" className="public-menu-trigger" ref={menuButtonRef}
            onClick={() => setMenuOpen(true)} aria-expanded={menuOpen}
            aria-controls="public-mobile-menu" aria-label="Öppna menyn"
          ><Menu size={23} aria-hidden="true" /></button>
        </div>
      </div>
      <dialog
        ref={dialogRef} id="public-mobile-menu" className="public-mobile-menu"
        aria-label="Huvudnavigation" onCancel={() => setMenuOpen(false)} onClose={() => setMenuOpen(false)}
        onClick={(event) => { if (event.target === event.currentTarget) setMenuOpen(false) }}
      >
        <div className="public-menu-top">
          <span>Meny</span>
          <button type="button" onClick={() => setMenuOpen(false)} aria-label="Stäng menyn"><X size={24} aria-hidden="true" /></button>
        </div>
        <nav aria-label="Mobilnavigation" onClick={(event) => { if ((event.target as HTMLElement).closest('a')) setMenuOpen(false) }}>
          <Link href="/renoapp/apply">Ansök om renovering</Link>
          {navigation.map((item) => <Link key={item.href} href={item.href} aria-current={item.href === pathname ? 'page' : undefined}>{item.label}</Link>)}
          <Link href="/besiktapp/intresse">Intresse för BesiktApp</Link>
          <Link href="/renoapp/request-access">Anmäl föreningens intresse</Link>
          <Link href={accountHref} prefetch={false}>{accountLabel}</Link>
        </nav>
      </dialog>
    </header>
  )
}
