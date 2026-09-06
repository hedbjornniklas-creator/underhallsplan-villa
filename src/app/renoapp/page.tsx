import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import PublicFrame from '@/components/public/PublicFrame'
import PublicFaq from '@/components/public/PublicFaq'
import { PublicProductLink } from '@/components/public/PublicSession'
import PublicProductIntro from '@/components/public/PublicProductIntro'
import { PublicPricingSection } from '@/components/public/PublicCommercialSections'

export const metadata: Metadata = {
  title: 'RenoApp – renoveringsansökningar för BRF',
  description: 'Guidade renoveringsansökningar för de boende och stöd för styrelsens granskning. Samla underlag, kompletteringar och beslut i samma ärende.',
  alternates: { canonical: '/renoapp' },
}

export default function RenoAppLandingPage() {
  return (
    <PublicFrame activeProduct="renoapp">
      <PublicProductIntro product="renoapp" audience="För bostadsrättsföreningar"
        title="Bättre underlag från början. Mindre att jaga i efterhand."
        interestHref="/renoapp/request-access" interestLabel="Anmäl föreningens intresse"
        aside={
          <aside className="public-resident-aside">
            <span className="public-eyebrow">För dig som bor i föreningen</span>
            <h2>Vill du renovera din lägenhet?</h2>
            <p>Hitta din förening och börja ansökan. Du behöver inte skapa ett konto eller logga in.</p>
            <Link href="/renoapp/apply" className="public-text-link">Till renoveringsansökan <ArrowRight size={18} aria-hidden="true" /></Link>
          </aside>
        }>
        <p>RenoApp guidar den boende genom renoveringsansökan. Styrelsen får hjälp att granska underlaget, be om det som saknas och dokumentera beslutet.</p>
      </PublicProductIntro>

      <section className="public-product-section">
        <div className="public-container public-detail-grid">
          <div className="public-section-heading"><span className="public-eyebrow">För den boende</span><h2>En ansökan som följer det du ska göra.</h2><p>Beskriv renoveringen och svara på frågorna som gäller ditt arbete. Styrelsen kan sedan be om de handlingar och uppgifter som behövs.</p></div>
          <ol className="public-feature-list">
            <li><h3>Beskriv renoveringen steg för steg</h3><p>Beskriv vad du vill göra och svara på följdfrågorna. Hjälptexterna förklarar vad som efterfrågas.</p></li>
            <li><h3>Fortsätt när det passar dig</h3><p>Skapa ett utkast och spara din personliga länk. Då kan du återvända till ansökan utan ett konto.</p></li>
            <li><h3>Komplettera det som saknas</h3><p>Om styrelsen behöver mer information får du komplettera de delar som efterfrågas. Tidigare inskickade handlingar finns kvar.</p></li>
          </ol>
        </div>
      </section>

      <section className="public-product-section public-product-tint">
        <div className="public-container public-detail-grid">
          <div className="public-section-heading"><span className="public-eyebrow">För styrelsen</span><h2>Stöd i granskningen.<br />Beslutet är fortfarande ert.</h2><p>Se varför ett underlag föreslås och använd de granskningsanvisningar som finns för ärendet. Ni avgör vad som ska begäras in.</p><p>När ni fattat beslut kan ni spara motivering och villkor tillsammans med ansökan. Historiken visar vad som har hänt, när och av vem.</p></div>
          <figure className="public-work-example">
            <figcaption>Förenklat exempel på en komplettering · fiktiva uppgifter</figcaption>
            <div className="public-example-heading"><span>Badrumsrenovering</span><h3>Så går en komplettering till</h3></div>
            <ol className="public-example-timeline">
              <li><strong>Styrelsen begär en komplettering</strong><p>”Bifoga en planritning som visar den nya placeringen av golvbrunnen.”</p></li>
              <li><strong>Den boende lämnar underlaget</strong><p>Ritningen läggs till via den personliga länken.</p></li>
              <li><strong>Styrelsen fortsätter granskningen</strong><p>Kompletteringen finns tillsammans med tidigare handlingar.</p></li>
            </ol>
          </figure>
        </div>
      </section>

      <PublicPricingSection product="renoapp" />
      <section className="public-help">
        <div className="public-container public-help-grid">
          <div><span className="public-eyebrow">Innan ni börjar</span><h2>Frågor om RenoApp</h2></div>
          <PublicFaq items={[
            { question: 'Behöver de boende skapa konton?', answer: <>Nej. De använder föreningens ansökningssida. En personlig länk används för att fortsätta med ett sparat utkast eller lämna kompletteringar.</> },
            { question: 'Bedömer RenoApp om en renovering kan godkännas?', answer: <>Nej. RenoApp hjälper er att samla in och granska underlaget. Styrelsen gör bedömningen och fattar beslutet. Vid behov behöver ni ta in en sakkunnig.</> },
            { question: 'Ingår personlig rådgivning till styrelsen?', answer: <>Inte i dag. RenoApp har hjälptexter och granskningsstöd i tjänsten. Personlig hjälp är en planerad funktion.</> },
            { question: 'Hur börjar vår förening använda RenoApp?', answer: <><Link href="/renoapp/request-access">Skicka en intresseanmälan</Link> med föreningens uppgifter och en kontaktperson. Förfrågan granskas, och när den godkänts får styrelsen en inbjudan.</> },
            { question: 'Vår förening är redan ansluten. Hur får jag ett konto?', answer: <>Be den som administrerar föreningen i RenoApp att bjuda in dig. Har du redan ett konto kan du <PublicProductLink product="renoapp">öppna styrelsens RenoApp</PublicProductLink>.</> },
          ]} />
        </div>
      </section>
      <section className="public-product-closing"><div className="public-container"><h2>Vill ni använda RenoApp i er förening?</h2><Link href="/renoapp/request-access" className="public-button">Anmäl föreningens intresse</Link></div></section>
    </PublicFrame>
  )
}
