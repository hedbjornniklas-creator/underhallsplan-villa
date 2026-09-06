import Image from 'next/image'
import Link from 'next/link'
import PublicFrame from '@/components/public/PublicFrame'
import PublicFaq from '@/components/public/PublicFaq'
import HomeRecoveryRedirect from '@/components/public/HomeRecoveryRedirect'
import { PublicProductLink } from '@/components/public/PublicSession'

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
              <Link href="/renoapp/apply" className="hushub-hero-link">Ansök om renovering</Link>
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

      <section id="produkter" className="hushub-products" aria-label="Våra produkter">
        <div className="public-container hushub-product-layout">
          <div className="hushub-product-photo hushub-photo-renovation">
            <Image
              src="/landing/renovering-editorial-v2.png"
              alt="Illustrationsbild: två boende planerar sin renovering vid köksbordet."
              width={1122} height={1402} sizes="(max-width: 767px) 90vw, 480px"
            />
          </div>
          <div className="hushub-product-copy">
            <Image className="hushub-product-wordmark" src="/landing/Renoapp.png" alt="RenoApp" width={1240} height={453} />
            <h2>En ansökan från den boende.<br />Ett ärende för styrelsen.</h2>
            <p>Den boende får hjälp att beskriva sin renovering och lämna rätt underlag. Styrelsen får stöd i granskningen och kan begära kompletteringar i samma ärende.</p>
            <div className="hushub-product-actions">
              <Link href="/renoapp" className="public-button">Läs om RenoApp</Link>
              <PublicProductLink product="renoapp" className="public-text-link">Till styrelsens RenoApp</PublicProductLink>
            </div>
          </div>
        </div>
      </section>

      <section id="besiktapp" className="hushub-inspection" aria-label="BesiktApp för besiktningsföretag">
        <div className="public-container hushub-product-layout">
          <div className="hushub-product-photo hushub-photo-inspection">
            <Image
              src="/landing/besiktning-editorial-v2.png"
              alt="Illustrationsbild: besiktningsarbete på plats i ett hus."
              width={1122} height={1402} sizes="(max-width: 767px) 90vw, 480px"
            />
          </div>
          <div className="hushub-product-copy">
            <Image className="hushub-product-wordmark" src="/landing/BesiktApp.png" alt="BesiktApp" width={1096} height={311} />
            <h2>Från besiktning på plats<br />till färdigt utlåtande.</h2>
            <p>Samla uppdrag, bilder och noteringar. Använd mallar och AI-stöd i delar av dokumentationsarbetet, och hitta tillbaka till underlaget när kunden hör av sig.</p>
            <div className="hushub-product-actions"><Link href="/besiktapp" className="public-button">Läs om BesiktApp</Link><PublicProductLink product="besiktapp" className="public-text-link">Öppna BesiktApp</PublicProductLink></div>
          </div>
        </div>
      </section>

      <section id="hjalp" className="public-help hushub-home-help" aria-labelledby="help-title">
        <div className="public-container public-help-grid">
          <h2 id="help-title">Hur kan vi hjälpa dig?</h2>
          <PublicFaq items={[
            { question: 'Jag vill ansöka om renovering', answer: <><Link href="/renoapp/apply">Hitta din förening</Link> och fyll i ansökan. Du behöver inget konto.</> },
            { question: 'Jag vill fortsätta med en påbörjad ansökan', answer: <>Öppna den personliga länk du sparade när du fyllde i ansökan, eller länken i mejlet om du fick ett sådant. Kontakta styrelsen om du saknar länken.</> },
            { question: 'Vår förening vill börja använda RenoApp', answer: <><Link href="/renoapp/request-access">Anmäl föreningens intresse.</Link> Om ni redan använder RenoApp kan den som administrerar föreningen bjuda in fler styrelsemedlemmar.</> },
            { question: 'Jag vill börja använda BesiktApp', answer: <><Link href="/besiktapp">Läs om BesiktApp</Link> eller <Link href="/besiktapp/intresse">anmäl ditt intresse</Link>. Om ditt företag redan använder tjänsten, be företagets administratör om en inbjudan.</> },
          ]} />
        </div>
      </section>
    </PublicFrame>
  )
}
