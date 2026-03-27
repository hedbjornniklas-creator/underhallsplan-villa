import Link from 'next/link'

const primaryCards = [
  {
    eyebrow: 'Boende',
    title: 'Skicka ansökan',
    description:
      'Ansökan sker utan konto via den BRF-specifika länk du får från din förening eller styrelse.',
    href: '#boende',
    label: 'Så ansöker du',
    tone: 'border-amber-300 bg-amber-50/90',
  },
  {
    eyebrow: 'BRF',
    title: 'Anslut din BRF',
    description:
      'För styrelser som vill börja hantera renoveringsärenden strukturerat med ansökan, komplettering och beslut.',
    href: '#brf',
    label: 'Så ansluter ni',
    tone: 'border-emerald-300 bg-emerald-50/90',
  },
  {
    eyebrow: 'Styrelse',
    title: 'BRF-login',
    description:
      'För föreningar som redan använder RenoApp och vill gå direkt till sin handläggningsyta.',
    href: '/renoapp/login',
    label: 'Logga in',
    tone: 'border-stone-300 bg-white/90',
  },
]

const steps = [
  {
    title: '1. Boende skickar ansökan',
    description: 'Ansökan skickas in via BRF-länk utan att boende först behöver skapa ett konto.',
  },
  {
    title: '2. Styrelsen granskar',
    description: 'Ärendet hamnar i RenoApp där styrelsen kan se uppgifter, dokument och teknisk påverkan.',
  },
  {
    title: '3. Komplettering vid behov',
    description: 'Boende kan få en säker länk för att komplettera underlag utan att tappa bort ärendet.',
  },
  {
    title: '4. Beslut och spårbarhet',
    description: 'Godkännande, villkor eller avslag dokumenteras direkt i handläggningsflödet.',
  },
]

const faqItems = [
  {
    question: 'Behöver boende skapa konto för att skicka in en ansökan?',
    answer:
      'Nej. Grundflödet i RenoApp bygger på att boende ansöker utan konto via en BRF-specifik länk och därefter får tillgång till sitt ärende via säker länk.',
  },
  {
    question: 'Hur får vi vår egen ansökningslänk?',
    answer:
      'Varje BRF får en egen publik länk enligt formatet /renoapp/brf/[slug]/apply. När föreningen är upplagd pekar länken till just den föreningens ansökan.',
  },
  {
    question: 'Vad kan styrelsen göra i RenoApp?',
    answer:
      'Styrelsen kan granska ärenden, se dokument, begära komplettering, fatta beslut och följa status för varje renoveringsärende.',
  },
  {
    question: 'Är RenoApp samma sak som Dashboard?',
    answer:
      'Nej. Dashboard är den interna arbetsytan för teamet, medan RenoApp är den separata upplevelsen för BRF och renoveringsärenden.',
  },
]

export default function RenoAppLandingPage() {
  return (
    <main className="relative overflow-hidden bg-[linear-gradient(180deg,#f8f3ea_0%,#f7f7f5_42%,#edf4f2_100%)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(180,123,70,0.18),transparent_34%),radial-gradient(circle_at_82%_16%,rgba(23,92,102,0.16),transparent_28%),linear-gradient(140deg,rgba(255,255,255,0.72),rgba(255,255,255,0))]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-12 md:px-10 lg:px-12">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-500">RenoApp</p>
            <p className="mt-2 text-sm text-stone-600">För BRF, boende och renoveringsärenden med tydlig handläggning.</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="#boende"
              className="rounded-full border border-stone-300 bg-white/80 px-5 py-3 text-sm font-semibold text-stone-800 transition hover:bg-white"
            >
              För boende
            </Link>
            <Link
              href="#brf"
              className="rounded-full border border-emerald-300 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100"
            >
              För BRF
            </Link>
            <Link
              href="/renoapp/login"
              className="rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
            >
              BRF-login
            </Link>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.1fr_0.9fr] lg:py-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.26em] text-amber-800">Publik RenoApp-sida</p>
            <h1 className="mt-5 max-w-4xl text-5xl font-semibold tracking-tight text-stone-900 sm:text-6xl lg:text-7xl">
              Renoveringsärenden för BRF med mindre friktion och tydligare flöde.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-700 sm:text-xl">
              RenoApp gör det lättare att samla in ansökningar, begära kompletteringar och dokumentera beslut utan att
              blanda ihop boendes upplevelse med styrelsens handläggning.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="#boende"
                className="rounded-full bg-stone-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
              >
                Skicka ansökan
              </Link>
              <Link
                href="#brf"
                className="rounded-full border border-emerald-700 bg-emerald-50 px-6 py-3 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100"
              >
                Anslut din BRF
              </Link>
              <Link
                href="/renoapp/login"
                className="rounded-full border border-stone-300 bg-white/80 px-6 py-3 text-sm font-semibold text-stone-800 transition hover:bg-white"
              >
                BRF-login
              </Link>
            </div>
          </div>

          <aside className="grid gap-4">
            {primaryCards.map((card) => (
              <article
                key={card.title}
                className={`rounded-[30px] border p-6 shadow-[0_24px_70px_-42px_rgba(41,37,36,0.45)] ${card.tone}`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">{card.eyebrow}</p>
                <h2 className="mt-3 text-2xl font-semibold text-stone-900">{card.title}</h2>
                <p className="mt-3 text-sm leading-7 text-stone-700">{card.description}</p>
                <Link
                  href={card.href}
                  className="mt-6 inline-flex items-center rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
                >
                  {card.label}
                </Link>
              </article>
            ))}
          </aside>
        </section>

        <section className="grid gap-5 pb-6 md:grid-cols-2 xl:grid-cols-4">
          {steps.map((step) => (
            <article
              key={step.title}
              className="rounded-[28px] border border-stone-200/80 bg-white/85 p-6 shadow-[0_24px_60px_-40px_rgba(41,37,36,0.42)]"
            >
              <h2 className="text-xl font-semibold text-stone-900">{step.title}</h2>
              <p className="mt-3 text-sm leading-7 text-stone-700">{step.description}</p>
            </article>
          ))}
        </section>

        <section id="boende" className="grid gap-6 py-8 lg:grid-cols-2">
          <article className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.44)]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">För boende</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-stone-900">Så skickar du en ansökan</h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-stone-700">
              I RenoApp behöver boende normalt inte skapa konto i första steget. Ansökan skickas via en länk från din
              BRF, och därefter kan kompletteringar hanteras via säker ärendelänk.
            </p>
            <ul className="mt-6 space-y-3 text-sm leading-7 text-stone-700">
              <li>Du använder den BRF-länk du fått av styrelsen eller föreningen.</li>
              <li>Du fyller i åtgärd, kontaktuppgifter, lägenhetsuppgifter och relevant teknisk påverkan.</li>
              <li>Om underlag saknas kan du komplettera via länk utan att börja om från början.</li>
            </ul>
          </article>

          <article className="rounded-[32px] border border-amber-200/90 bg-[linear-gradient(145deg,rgba(255,251,235,0.96),rgba(255,255,255,0.92))] p-8 shadow-[0_24px_70px_-40px_rgba(180,83,9,0.16)]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-800">Vanliga frågor från boende</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-stone-900">Innan du ansöker</h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-stone-700">
              Förbered gärna beskrivning av åtgärden och de dokument din BRF brukar efterfråga, till exempel ritning,
              intyg eller entreprenörsuppgifter.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="#faq"
                className="rounded-full bg-amber-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-amber-600"
              >
                Läs FAQ
              </Link>
              <Link
                href="#om"
                className="rounded-full border border-amber-300 px-5 py-3 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
              >
                Om RenoApp
              </Link>
            </div>
          </article>
        </section>

        <section id="brf" className="grid gap-6 py-8 lg:grid-cols-2">
          <article className="rounded-[32px] border border-emerald-200/90 bg-[linear-gradient(145deg,rgba(236,253,245,0.96),rgba(255,255,255,0.92))] p-8 shadow-[0_24px_70px_-40px_rgba(6,95,70,0.2)]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-800">För BRF och styrelse</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-stone-900">Anslut din BRF</h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-stone-700">
              RenoApp passar BRF:er som vill få bättre kontroll på renoveringsärenden, dokumentkrav och kommunikation
              mellan boende och styrelse.
            </p>
            <ul className="mt-6 space-y-3 text-sm leading-7 text-stone-700">
              <li>Ni får en egen publik ansökningslänk för föreningen.</li>
              <li>Styrelsen får en separat inloggad yta för granskning och beslut.</li>
              <li>Ärenden, kompletteringar och beslut blir spårbara från start.</li>
            </ul>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/renoapp/login"
                className="rounded-full bg-emerald-800 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                BRF-login
              </Link>
              <Link
                href="#faq"
                className="rounded-full border border-emerald-300 px-5 py-3 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100"
              >
                Frågor och svar
              </Link>
            </div>
          </article>

          <article id="om" className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.44)]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Om RenoApp</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-stone-900">En separat produktupplevelse i HusHub</h2>
            <p className="mt-4 text-base leading-8 text-stone-700">
              RenoApp är byggd som en egen yta i HusHub för att ge boende, BRF och styrelse ett tydligare flöde än den
              interna Dashboarden. Det gör det möjligt att hålla publik ansökan, handläggning och intern drift åtskilda.
            </p>
            <p className="mt-4 text-base leading-8 text-stone-700">
              Fokus i första versionen är enkel ansökan, kompletteringsloop, dokumenthantering och beslut, utan att
              boende måste börja med full kontoregistrering.
            </p>
          </article>
        </section>

        <section id="faq" className="rounded-[36px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.44)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">FAQ</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">Vanliga frågor om RenoApp</h2>
          <div className="mt-8 grid gap-4">
            {faqItems.map((item) => (
              <details
                key={item.question}
                className="rounded-[24px] border border-stone-200 bg-stone-50/80 px-5 py-4 text-stone-800"
              >
                <summary className="cursor-pointer list-none text-base font-semibold leading-7">{item.question}</summary>
                <p className="mt-3 text-sm leading-7 text-stone-700">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
