import Link from 'next/link'
import type { Metadata } from 'next'
import PublicFrame from '@/components/public/PublicFrame'
import PublicFaq from '@/components/public/PublicFaq'
import PublicProductIntro from '@/components/public/PublicProductIntro'
import { PublicPricingSection } from '@/components/public/PublicCommercialSections'

export const metadata: Metadata = {
  title: 'BesiktApp – verktyg för besiktningsmän',
  description: 'Samla uppdrag, anteckningar och bilder i BesiktApp. Stöd för överlåtelsebesiktningar, entreprenadbesiktningar och tekniska utredningar.',
  alternates: { canonical: '/besiktapp' },
}

export default function BesiktAppPage() {
  return (
    <PublicFrame activeProduct="besiktapp">
      <PublicProductIntro product="besiktapp" audience="För besiktningsmän och besiktningsföretag"
        title="Lägg mer tid på besiktningen. Mindre på efterarbetet."
        interestHref="/besiktapp/intresse" interestLabel="Jag är intresserad"
        aside={
          <figure className="public-work-example">
            <figcaption>Exempel på innehåll i en överlåtelsebesiktning · fiktiva uppgifter</figcaption>
            <div className="public-example-heading"><span>Överlåtelsebesiktning</span><h2>Exempelvägen 12</h2><p>Invändigt / Övre plan / Badrum</p></div>
            <dl className="public-example-record">
              <div><dt>Notering</dt><dd>Missfärgning syns i taket intill frånluftsventilen.</dd></div>
              <div><dt>Bild</dt><dd>Översiktsbild kopplad till badrummet.</dd></div>
              <div><dt>Fortsatt arbete</dt><dd>Besiktningsmannen bedömer observationen och formulerar utlåtandet.</dd></div>
            </dl>
            <p className="public-example-note">Ett förenklat exempel – inte en skärmbild eller ett färdigt utlåtande.</p>
          </figure>
        }>
        <p>Håll ihop uppdrag, anteckningar och bilder från första kundkontakten till utlåtandet. BesiktApp hjälper dig att dokumentera arbetet och hitta tillbaka till tidigare besiktningar.</p>
      </PublicProductIntro>

      <section className="public-product-section">
        <div className="public-container public-detail-grid">
          <div className="public-section-heading"><span className="public-eyebrow">Före, under och efter besiktningen</span><h2>Slipp börja om med samma uppgifter.</h2><p>Adress, kontaktuppgifter och dokumentation hör till uppdraget. Du kan arbeta vidare med det du redan har lagt in.</p></div>
          <ol className="public-feature-list">
            <li><h3>Förbered nästa uppdrag</h3><p>Vid överlåtelsebesiktning följer uppgifterna från uppdragsbekräftelsen med till besiktningen. Du slipper fylla i adress och kunduppgifter en gång till.</p></li>
            <li><h3>Dokumentera där du är</h3><p>Knyt bilder och noteringar till rätt rum eller byggnadsdel. Håll interna snabbanteckningar åtskilda från texten som ska stå i utlåtandet.</p></li>
            <li><h3>Hitta tillbaka när kunden ringer</h3><p>Sök efter tidigare besiktningar med adress, kund eller uppdragsnummer. Då kan du gå tillbaka till underlaget när en fråga dyker upp.</p></li>
          </ol>
        </div>
      </section>

      <section className="public-product-section public-product-tint">
        <div className="public-container public-detail-grid">
          <div className="public-section-heading"><span className="public-eyebrow">AI som stöd i arbetet</span><h2>Hjälp med texten.<br />Du står för bedömningen.</h2><p>Verktygen skiljer sig åt mellan besiktningstyperna. Förslag är ett arbetsunderlag som du granskar, inte ett färdigt sakkunnigutlåtande.</p></div>
          <div className="public-feature-list public-feature-list-plain">
            <div><h3>Överlåtelsebesiktning</h3><p>Sök efter relevanta kontrollpunkter med AI-stöd och använd textmallar för noteringar, risker och fortsatt teknisk utredning.</p></div>
            <div><h3>Teknisk utredning</h3><p>Arbeta med röstanteckningar, transkribering och AI-stödda rapportutkast. Granska förslagen och välj vad du vill använda eller ändra.</p></div>
          </div>
        </div>
      </section>

      <PublicPricingSection product="besiktapp" />

      <section className="public-help">
        <div className="public-container public-help-grid">
          <div><span className="public-eyebrow">Innan du börjar</span><h2>Frågor om BesiktApp</h2></div>
          <PublicFaq items={[
            { question: 'Vilka typer av besiktningar finns det stöd för?', answer: <>Överlåtelsebesiktningar (ÖB), entreprenadbesiktningar (EB) och tekniska utredningar (TU). Innehåll och verktyg är anpassade efter besiktningstyp – alla funktioner finns inte i alla delar.</> },
            { question: 'Kan jag använda enbart överlåtelsebesiktning?', answer: <>Ja. Du kan arbeta med överlåtelsebesiktningar utan att använda RenoApp eller en underhållsplan. De andra tjänsterna är inget extra moment i din besiktning.</> },
            { question: 'Gör AI:n bedömningen åt mig?', answer: <>Nej. AI-stödet hjälper med sökning och textarbete i de delar där det finns tillgängligt. Du granskar dokumentationen och ansvarar för den byggtekniska bedömningen.</> },
            { question: 'Hur börjar jag använda BesiktApp?', answer: <><Link href="/besiktapp/intresse">Anmäl ditt intresse</Link> så kontaktar vi dig om BesiktApp. Använder ditt företag redan tjänsten kan företagets administratör bjuda in dig.</> },
          ]} />
        </div>
      </section>
      <section className="public-product-closing"><div className="public-container"><h2>Vill du veta om BesiktApp passar ditt arbete?</h2><Link href="/besiktapp/intresse" className="public-button">Anmäl ditt intresse</Link></div></section>
    </PublicFrame>
  )
}
