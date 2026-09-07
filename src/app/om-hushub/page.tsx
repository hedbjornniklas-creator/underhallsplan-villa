import type { Metadata } from 'next'
import Link from 'next/link'
import PublicFrame from '@/components/public/PublicFrame'
import { PUBLIC_COMPANY_INFO, PUBLIC_COMPANY_PAGE } from '@/lib/publicCompanyInfo'

export const metadata: Metadata = {
  title: 'Om HusHub – företagsuppgifter',
  description: `HusHub ägs och drivs av ${PUBLIC_COMPANY_INFO.name}, organisationsnummer ${PUBLIC_COMPANY_INFO.organizationNumber}. Företagsuppgifter och adress.`,
  alternates: { canonical: PUBLIC_COMPANY_PAGE },
}

export default function AboutHusHubPage() {
  const company = PUBLIC_COMPANY_INFO
  return (
    <PublicFrame>
      <section className="public-container public-company-page" aria-labelledby="company-title">
        <Link href="/" className="public-back-link">Till HusHub</Link>
        <div className="public-page-intro">
          <h1 id="company-title">Om HusHub</h1>
          <p>HusHub ägs och drivs av {company.name}. BesiktApp och RenoApp är våra verktyg för besiktningsarbete och renoveringsärenden.</p>
        </div>
        <div className="public-company-grid">
          <section aria-labelledby="company-details-title">
            <h2 id="company-details-title">Företagsuppgifter</h2>
            <dl className="public-company-facts">
              <div><dt>Företagsnamn</dt><dd>{company.name}</dd></div>
              <div><dt>Organisationsnummer</dt><dd>{company.organizationNumber}</dd></div>
              <div><dt>Momsregistreringsnummer</dt><dd>{company.vatNumber}</dd></div>
            </dl>
          </section>
          <section aria-labelledby="company-address-title">
            <h2 id="company-address-title">Adress{company.email ? ' och kontakt' : ''}</h2>
            <address className="public-company-address">
              <span>{company.name}</span>
              <span>{company.address.street}</span>
              <span>{company.address.postalCode} {company.address.city}</span>
              <span>{company.address.country}</span>
              {company.email && <a className="public-text-link" href={`mailto:${company.email}`}>{company.email}</a>}
            </address>
          </section>
        </div>
      </section>
    </PublicFrame>
  )
}
