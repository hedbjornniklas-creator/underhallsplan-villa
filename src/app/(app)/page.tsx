import Image from 'next/image'
import Link from 'next/link'
import PublicFrame from '@/components/public/PublicFrame'
import PublicFaq from '@/components/public/PublicFaq'
import HomeRecoveryRedirect from '@/components/public/HomeRecoveryRedirect'
import PublicProductExplorer from '@/components/public/PublicProductExplorer'

export default function HomePage() {
  return (
    <PublicFrame>
      <HomeRecoveryRedirect />
      <section className="hushub-hero" aria-labelledby="home-title">
        <div className="public-container hushub-hero-inner">
          <div className="hushub-hero-copy">
            <h1 id="home-title">Digitala verktyg för<br />besiktning och renoveringsärenden.</h1>
            <p>BesiktApp för dig som arbetar med besiktningar. RenoApp för styrelsen och de boende i en bostadsrättsförening.</p>
            <div className="hushub-hero-actions">
              <Link href="#produkter" className="public-button hushub-button-light">Se våra verktyg</Link>
            </div>
          </div>
          <div className="hushub-hero-visual">
            <Image
              src="/landing/besiktning-editorial-v2.png"
              alt="Illustrationsbild: en besiktningsman arbetar med sin surfplatta i en villa."
              width={1122} height={1402} sizes="(max-width: 767px) 85vw, 440px"
              className="hushub-hero-photo" priority
            />
            <div className="hushub-hero-caption">
              <Image src="/landing/BesiktApp.png" alt="BesiktApp" width={1096} height={311} />
              <span>Från uppdrag till utlåtande.</span>
            </div>
          </div>
        </div>
      </section>

      <PublicProductExplorer />

      <section id="hjalp" className="public-help hushub-home-help" aria-labelledby="help-title">
        <div className="public-container public-help-grid">
          <h2 id="help-title">Hur kan vi hjälpa dig?</h2>
          <PublicFaq items={[
            { question: 'Jag vill ansöka om renovering', answer: <><Link href="/renoapp/apply">Hitta din förening</Link> och fyll i ansökan. Du behöver inget konto.</> },
            { question: 'Jag vill fortsätta med en påbörjad ansökan', answer: <>Öppna den personliga länk du sparade när du fyllde i ansökan, eller länken i mejlet om du fick ett sådant. Kontakta styrelsen om du saknar länken.</> },
            { question: 'Vår förening vill börja använda RenoApp', answer: <><Link href="/renoapp/request-access">Anmäl föreningens intresse.</Link> Om ni redan använder RenoApp kan den som administrerar föreningen bjuda in fler styrelsemedlemmar.</> },
            { question: 'Jag vill börja använda BesiktApp', answer: <><Link href="/besiktapp">Läs om BesiktApp</Link> eller <Link href="/besiktapp/intresse">anmäl ditt intresse</Link>. Vi går igenom ditt behov och hur du kan få tillgång. Om ditt företag redan använder tjänsten, ange företagets namn i din förfrågan.</> },
          ]} />
        </div>
      </section>
    </PublicFrame>
  )
}
