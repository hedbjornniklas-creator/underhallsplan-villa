import Link from 'next/link'
import type { Metadata } from 'next'
import PublicFrame from '@/components/public/PublicFrame'
import BesiktInterestForm from '@/components/public/BesiktInterestForm'
import { PublicProductLink } from '@/components/public/PublicSession'
import { isBesiktInterestAvailable } from '@/lib/besiktapp/interest'

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
          <p>Berätta kort om ditt arbete eller vad du vill veta. Vi kontaktar dig via mejl och pratar vidare om vad BesiktApp kan hjälpa dig med.</p>
          <div className="public-aside-help"><h2>Använder ditt företag redan BesiktApp?</h2><p>Be företagets administratör om en inbjudan. Har du ett konto kan du <PublicProductLink product="besiktapp">öppna BesiktApp</PublicProductLink>.</p></div>
        </section>
        <section className="public-form-section" aria-labelledby="interest-form-title">
          <h2 id="interest-form-title">Dina kontaktuppgifter</h2>
          {available ? <BesiktInterestForm /> : <div className="public-notice" role="status"><p>Intresseformuläret är tillfälligt stängt. Välkommen tillbaka senare.</p><Link href="/besiktapp" className="public-text-link">Läs mer om BesiktApp</Link></div>}
        </section>
      </div>
    </PublicFrame>
  )
}
