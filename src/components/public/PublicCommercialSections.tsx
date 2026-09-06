import type { PublicProductId } from '@/lib/publicNavigation'
import { PUBLIC_COMMERCIAL_CONTENT, publishedContact, publishedPricing } from '@/lib/publicCommercialContent'

export function PublicPricingSection({ product }: { product: PublicProductId }) {
  const content = publishedPricing(PUBLIC_COMMERCIAL_CONTENT.pricing[product])
  if (!content) return null
  return (
    <section id="priser" className="public-product-section public-commercial-section" aria-labelledby="pricing-title">
      <div className="public-container">
        <div className="public-section-heading"><h2 id="pricing-title">{content.heading}</h2><p>{content.introduction}</p></div>
        <div className="public-pricing-grid">
          {content.plans.map(plan => (
            <article key={plan.name} className="public-price-plan">
              <h3>{plan.name}</h3><p className="public-price-value">{plan.price}</p><p>{plan.billing}</p>
              <ul>{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul>
            </article>
          ))}
        </div>
        <p className="public-commercial-note">{content.taxNote}</p>
      </div>
    </section>
  )
}

export function PublicContactSection() {
  const content = publishedContact(PUBLIC_COMMERCIAL_CONTENT.contact)
  if (!content) return null
  return (
    <section id="kontakt" className="public-product-section public-commercial-section" aria-labelledby="contact-title">
      <div className="public-container public-detail-grid">
        <div className="public-section-heading"><h2 id="contact-title">{content.heading}</h2><p>{content.introduction}</p></div>
        <address className="public-contact-details">
          <strong>{content.companyName}</strong>
          {content.email && <a href={`mailto:${content.email}`}>{content.email}</a>}
          {content.phone && <a href={`tel:${content.phone.replace(/[\s()-]/g, '')}`}>{content.phone}</a>}
          {content.address && <span>{content.address}</span>}
        </address>
      </div>
    </section>
  )
}
