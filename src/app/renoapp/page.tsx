import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import PublicFrame from '@/components/public/PublicFrame'
import PublicFaq from '@/components/public/PublicFaq'
import { PublicProductLink } from '@/components/public/PublicSession'

export const metadata: Metadata = {
  title: 'RenoApp | Renoveringsärenden för BRF',
  description: 'RenoApp samlar BRF:s renoveringsansökningar i ett tydligt flöde för boende, styrelse och föreningar som vill ansluta.',
}

export default function RenoAppLandingPage() {
  return (
    <PublicFrame activeProduct="renoapp">
      <section className="public-container public-reno-hero">
        <div className="public-page-intro">
          <Image className="public-feature-logo" src="/landing/Renoapp.png" alt="RenoApp" width={1240} height={453} priority />
          <h1>Renoveringsansökningar för er förening.</h1>
          <p>Låt de boende lämna in sina ansökningar i RenoApp. Styrelsen kan granska underlag, be om kompletteringar och dokumentera beslut i samma ärende.</p>
          <div className="public-cta-row">
            <PublicProductLink product="renoapp" className="public-button">Öppna styrelsens RenoApp <ArrowRight size={18} aria-hidden="true" /></PublicProductLink>
            <Link href="/renoapp/request-access" className="public-button public-button-secondary">Anmäl föreningens intresse</Link>
          </div>
        </div>
        <aside className="public-resident-aside">
          <span className="public-eyebrow">För dig som bor i föreningen</span>
          <h2>Vill du renovera din lägenhet?</h2>
          <p>Hitta din förening och börja ansökan. Du behöver inte logga in.</p>
          <Link href="/renoapp/apply" className="public-text-link">Till renoveringsansökan <ArrowRight size={18} aria-hidden="true" /></Link>
        </aside>
      </section>
      <section className="public-container public-reno-steps" aria-labelledby="reno-steps-title">
        <span className="public-eyebrow">Så fungerar RenoApp</span>
        <h2 id="reno-steps-title">Från ansökan till beslut</h2>
        <ol>
          <li><span>01 · Den boende</span><h3>Beskriver renoveringen</h3><p>Den boende öppnar föreningens ansökningssida, fyller i uppgifter om arbetet och bifogar handlingar. Ett utkast kan sparas för att fortsätta senare.</p></li>
          <li><span>02 · Styrelsen</span><h3>Granskar underlaget</h3><p>Styrelsen ser inkomna ansökningar och tillhörande dokument. Om något saknas kan styrelsen begära en komplettering.</p></li>
          <li><span>03 · Beslutet</span><h3>Sparas i ärendet</h3><p>Styrelsen dokumenterar sitt beslut och eventuella villkor. Ansökan, handlingarna och beslutet finns kvar tillsammans.</p></li>
        </ol>
      </section>
      <section className="public-help">
        <div className="public-container public-help-grid">
          <div><span className="public-eyebrow">Innan ni börjar</span><h2>Frågor om RenoApp</h2></div>
          <PublicFaq items={[
            { question: 'Behöver de boende skapa konton?', answer: <>Nej. De använder föreningens ansökningssida. En personlig länk används för att fortsätta med ett sparat utkast eller lämna kompletteringar.</> },
            { question: 'Hur börjar vår förening använda RenoApp?', answer: <><Link href="/renoapp/request-access">Skicka en intresseanmälan</Link> med föreningens uppgifter och en kontaktperson. Förfrågan granskas, och när den godkänts får styrelsen en inbjudan.</> },
            { question: 'Vår förening är redan ansluten. Hur får jag ett konto?', answer: <>Be den som administrerar föreningen i RenoApp att bjuda in dig. Har du redan ett konto kan du <PublicProductLink product="renoapp">öppna styrelsens RenoApp</PublicProductLink>.</> },
          ]} />
        </div>
      </section>
    </PublicFrame>
  )
}
