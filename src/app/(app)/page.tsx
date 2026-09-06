import Image from 'next/image'
import Link from 'next/link'
import { ArrowDown, ArrowRight, Building2, ClipboardCheck, House } from 'lucide-react'
import PublicFrame from '@/components/public/PublicFrame'
import PublicFaq from '@/components/public/PublicFaq'
import HomeRecoveryRedirect from '@/components/public/HomeRecoveryRedirect'
import { PublicProductLink } from '@/components/public/PublicSession'

export default function HomePage() {
  return (
    <PublicFrame>
      <HomeRecoveryRedirect />
      <section className="public-container public-hero" aria-labelledby="home-title">
        <div className="public-hero-heading">
          <h1 id="home-title">Besiktningar och<br />renoveringsansökningar.</h1>
          <div className="public-hero-intro"><p>Ansök om renovering, hantera föreningens ansökningar eller arbeta med besiktningar.</p><Link className="public-text-link" href="#produkter">Läs om produkterna <ArrowDown size={18} aria-hidden="true" /></Link></div>
        </div>
        <h2 className="public-eyebrow">Vad vill du göra?</h2>
        <div className="public-task-grid">
          <Link href="/renoapp/apply" className="public-task-card public-task-resident">
            <House size={26} aria-hidden="true" />
            <h3>Jag vill renovera min lägenhet</h3>
            <p>Skicka en ansökan till styrelsen. Du behöver inget konto.</p>
            <span className="public-card-action">Hitta din förening <ArrowRight size={19} aria-hidden="true" /></span>
          </Link>
          <PublicProductLink product="renoapp" className="public-task-card public-task-board">
            <Building2 size={26} aria-hidden="true" />
            <h3>Jag sitter i styrelsen</h3>
            <p>Granska ansökningar, begär kompletteringar och dokumentera beslut.</p>
            <span className="public-card-action">Öppna styrelsens RenoApp <ArrowRight size={19} aria-hidden="true" /></span>
          </PublicProductLink>
          <PublicProductLink product="besiktapp" className="public-task-card public-task-inspector">
            <ClipboardCheck size={26} aria-hidden="true" />
            <h3>Jag arbetar med besiktningar</h3>
            <p>Hantera uppdrag och skapa utlåtanden för överlåtelsebesiktningar, entreprenadbesiktningar och tekniska utredningar.</p>
            <span className="public-card-action">Öppna BesiktApp <ArrowRight size={19} aria-hidden="true" /></span>
          </PublicProductLink>
        </div>
        <div className="public-hero-bottom">
          <Link className="public-text-link" href="/renoapp/request-access">Vill er förening använda RenoApp? <ArrowRight size={18} aria-hidden="true" /></Link>
        </div>
      </section>

      <section id="produkter" className="public-container public-section" aria-labelledby="products-title">
        <h2 id="products-title" className="public-eyebrow">Produkter från HusHub</h2>
        <div className="public-feature">
          <div>
            <Image className="public-feature-logo" src="/landing/Renoapp.png" alt="RenoApp" width={1240} height={453} />
            <h3>Renoveringsansökningar<br />för er förening.</h3>
            <p>Den boende beskriver renoveringen och bifogar handlingar. Styrelsen får ansökan, kompletteringarna och beslutet i samma ärende.</p>
            <Link href="/renoapp" className="public-text-link">Så fungerar RenoApp <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
          <ol className="public-process">
            <li><span>01</span><div><h4>Den boende ansöker</h4><p>Väljer förening, beskriver arbetet och lämnar in underlag.</p></div></li>
            <li><span>02</span><div><h4>Styrelsen granskar</h4><p>Läser ansökan och ber om kompletteringar när något saknas.</p></div></li>
            <li><span>03</span><div><h4>Beslutet dokumenteras</h4><p>Beslut och eventuella villkor sparas tillsammans med ansökan.</p></div></li>
          </ol>
        </div>
        <div id="besiktapp" className="public-feature public-feature-divided">
          <div>
            <Image className="public-feature-logo" src="/landing/BesiktApp.png" alt="BesiktApp" width={1096} height={311} />
            <h3>Från anteckningar på plats<br />till färdigt utlåtande.</h3>
            <p>För besiktningsföretag som vill hantera uppdrag, dokumentera sina besiktningar och sammanställa utlåtanden.</p>
            <PublicProductLink product="besiktapp" className="public-text-link">Öppna BesiktApp <ArrowRight size={18} aria-hidden="true" /></PublicProductLink>
          </div>
          <dl className="public-module-list">
            <div><dt>Överlåtelsebesiktning</dt><dd>Uppdragsuppgifter, iakttagelser och utlåtande.</dd></div>
            <div><dt>Entreprenadbesiktning</dt><dd>Dokumentera besiktningen och sammanställ utlåtandet.</dd></div>
            <div><dt>Teknisk utredning</dt><dd>Samla utredningens underlag, observationer och bedömning.</dd></div>
          </dl>
        </div>
      </section>

      <section id="hjalp" className="public-help" aria-labelledby="help-title">
        <div className="public-container public-help-grid">
          <div><span className="public-eyebrow">Hjälp att komma vidare</span><h2 id="help-title">Vanliga frågor</h2></div>
          <PublicFaq items={[
            { question: 'Behöver jag ett konto för att ansöka om renovering?', answer: <>Nej. <Link href="/renoapp/apply">Hitta din förening</Link> och fyll i ansökan. Inloggningen i RenoApp är till för styrelsen.</> },
            { question: 'Hur fortsätter jag med en påbörjad ansökan?', answer: <>Öppna den personliga länk du sparade när du fyllde i ansökan, eller länken i mejlet om du fick ett sådant. Kontakta styrelsen om du saknar länken.</> },
            { question: 'Hur får styrelsen tillgång till RenoApp?', answer: <>Om er förening redan använder RenoApp kan den som administrerar föreningen bjuda in dig. Vill ni börja använda tjänsten? <Link href="/renoapp/request-access">Anmäl föreningens intresse.</Link></> },
            { question: 'Hur får jag tillgång till BesiktApp?', answer: <>BesiktApp öppnas för företag och användare genom inbjudan. Om ditt företag redan använder tjänsten, be företagets administratör om tillgång.</> },
          ]} />
        </div>
      </section>
    </PublicFrame>
  )
}
