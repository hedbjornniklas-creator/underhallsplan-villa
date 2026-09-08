import Link from 'next/link'
import type { Metadata } from 'next'
import PublicFrame from '@/components/public/PublicFrame'
import BesiktInterestForm from '@/components/public/BesiktInterestForm'
import { PublicProductLink } from '@/components/public/PublicSession'
import { isBesiktInterestAvailable } from '@/lib/besiktapp/interest'
import BesiktInterestUnavailable from '@/components/public/BesiktInterestUnavailable'
import { PUBLIC_BESIKTAPP_CONTACT_EMAIL } from '@/lib/publicCompanyInfo'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Anmäl intresse för BesiktApp',
  description: 'Vill du veta mer om BesiktApp? Lämna dina kontaktuppgifter så kontaktar vi dig om verktyg för ditt besiktningsarbete.',
  alternates: { canonical: '/besiktapp/intresse' },
}

export default function BesiktInterestPage() {
  const available = isBesiktInterestAvailable()
  return (
    <PublicFrame activeProduct="besiktapp">
      <div className="public-container public-interest">
        <section className="public-page-intro">
          <Link href="/besiktapp" className="public-text-link">Tillbaka till BesiktApp</Link>
          <h1>Nyfiken på BesiktApp?</h1>
          <p>{available ? 'Lämna dina kontaktuppgifter så kontaktar vi dig via mejl. Vi går igenom ditt behov och hur du kan få tillgång till BesiktApp. Anmälan skapar inte ett konto.' : 'Tillgång till BesiktApp ordnas efter kontakt med oss. Du kan inte skapa ett konto direkt på hemsidan.'}</p>
          <div className="public-aside-help"><h2>Använder ditt företag redan BesiktApp?</h2><p>Ange företagets namn när du kontaktar oss om tillgång. Har du redan ett konto kan du <PublicProductLink product="besiktapp">öppna BesiktApp</PublicProductLink>.</p></div>
        </section>
        <section className="public-form-section" aria-labelledby="interest-form-title">
          <h2 id="interest-form-title">{available ? 'Dina kontaktuppgifter' : 'Kontakta oss om BesiktApp'}</h2>
          {available ? <BesiktInterestForm /> : <BesiktInterestUnavailable />}
          {available && <p className="public-field-hint">Du kan också mejla oss på <a href={`mailto:${PUBLIC_BESIKTAPP_CONTACT_EMAIL}?subject=Intresse%20f%C3%B6r%20BesiktApp`} className="public-text-link">{PUBLIC_BESIKTAPP_CONTACT_EMAIL}</a>.</p>}
        </section>
      </div>
    </PublicFrame>
  )
}
