import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { PUBLIC_PRODUCTS, type PublicProductId } from '@/lib/publicNavigation'
import { PUBLIC_COMMERCIAL_CONTENT, publishedPricing } from '@/lib/publicCommercialContent'
import { PublicProductLink } from './PublicSession'

export default function PublicProductIntro({ product, audience, title, children, interestHref, interestLabel, aside }: {
  product: PublicProductId
  audience: string
  title: string
  children: ReactNode
  interestHref: string
  interestLabel: string
  aside: ReactNode
}) {
  const info = PUBLIC_PRODUCTS[product]
  const pricing = publishedPricing(PUBLIC_COMMERCIAL_CONTENT.pricing[product])
  return (
    <section className="public-product-intro">
      <div className="public-container public-product-intro-grid">
        <div className="public-product-intro-copy">
          <Link href="/" className="public-back-link">Till HusHub</Link>
          <Image className="public-feature-logo" src={info.logo} alt={info.name} width={info.width} height={info.height} priority />
          <span className="public-eyebrow">{audience}</span>
          <h1>{title}</h1>
          <div className="public-product-lead">{children}</div>
          <div className="public-cta-row">
            <Link href={interestHref} className="public-button">{interestLabel}<ArrowRight size={18} aria-hidden="true" /></Link>
            <PublicProductLink product={product} className="public-text-link">{product === 'renoapp' ? 'Öppna styrelsens RenoApp' : 'Öppna BesiktApp'}</PublicProductLink>
          </div>
          {pricing && <a className="public-text-link public-pricing-link" href="#priser">Se priser</a>}
        </div>
        {aside}
      </div>
    </section>
  )
}
