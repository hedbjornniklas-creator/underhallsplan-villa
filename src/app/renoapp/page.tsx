import Link from 'next/link'

const PRIMARY_ACTIONS = [
  {
    title: 'Skicka ansökan',
    description: 'För boende som redan har fått en BRF-specifik ansökningslänk.',
    href: '#boende',
    label: 'För boende',
    tone: 'border-amber-300 bg-[linear-gradient(145deg,rgba(255,251,235,0.96),rgba(255,255,255,0.92))]',
  },
  {
    title: 'BRF-login',
    description: 'För styrelse och BRF-användare som redan arbetar i RenoApp.',
    href: '/renoapp/login',
    label: 'Logga in',
    tone: 'border-stone-300 bg-white/92',
  },
  {
    title: 'Anslut BRF',
    description: 'För föreningar som vill ansöka om att börja använda RenoApp.',
    href: '/renoapp/request-access',
    label: 'Ansök om anslutning',
    tone: 'border-emerald-300 bg-[linear-gradient(145deg,rgba(236,253,245,0.96),rgba(255,255,255,0.92))]',
  },
] as const

const FAQ_ITEMS = [
  {
    question: 'Behöver boende skapa konto för att skicka in en ansökan?',
    answer:
      'Nej. Boende ansöker via en BRF-specifik länk och får vid behov en säker ärendelänk för kompletteringar.',
  },
  {
    question: 'Kan en BRF registrera sig fritt?',
    answer:
      'Nej. BRF skapas av admin eller via en godkänd intresseanmälan. Styrelsen får sedan en invite.',
  },
  {
    question: 'Vad använder styrelsen RenoApp till?',
    answer:
      'Styrelsen granskar ärenden, ser dokument, begär kompletteringar och fattar beslut i samma flöde.',
  },
] as const

export default function RenoAppLandingPage() {
  return (
    <main className="bg-[linear-gradient(180deg,#f8f3ea_0%,#f7f7f5_48%,#edf4f2_100%)]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-8 sm:px-6 md:px-10 lg:px-12">
        <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <div className="rounded-[30px] border border-stone-200/80 bg-white/82 p-6 shadow-[0_24px_70px_-44px_rgba(41,37,36,0.42)] sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">RenoApp</p>
            <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl lg:text-6xl">
              Renoveringsärenden för BRF, styrelse och boende.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-stone-700 sm:text-lg">
              Välj rätt väg direkt. Ansökan är för boende, login är för styrelse, och BRF-anslutning är för föreningar
              som vill komma igång med RenoApp.
            </p>
          </div>

          <div className="grid gap-4">
            {PRIMARY_ACTIONS.map((action) => (
              <article
                key={action.title}
                className={`rounded-[28px] border p-6 shadow-[0_24px_70px_-44px_rgba(41,37,36,0.42)] sm:p-7 ${action.tone}`}
              >
                <h2 className="text-2xl font-semibold tracking-tight text-stone-900">{action.title}</h2>
                <p className="mt-3 text-sm leading-7 text-stone-700 sm:text-base">{action.description}</p>
                <Link
                  href={action.href}
                  className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 sm:w-auto"
                >
                  {action.label}
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section id="boende" className="grid gap-6 py-8 lg:grid-cols-2">
          <article className="rounded-[30px] border border-stone-200/80 bg-white/88 p-6 shadow-[0_24px_70px_-44px_rgba(41,37,36,0.42)] sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">För boende</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-stone-900">När du ska skicka en ansökan</h2>
            <ul className="mt-5 space-y-3 text-sm leading-7 text-stone-700 sm:text-base">
              <li>Du använder länken du har fått från din BRF eller styrelse.</li>
              <li>Du fyller i åtgärd, kontaktuppgifter och relevant underlag.</li>
              <li>Om något saknas kan du komplettera via säker länk utan att börja om.</li>
            </ul>
          </article>

          <article className="rounded-[30px] border border-stone-200/80 bg-white/88 p-6 shadow-[0_24px_70px_-44px_rgba(41,37,36,0.42)] sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">För styrelse</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-stone-900">När du arbetar i RenoApp</h2>
            <ul className="mt-5 space-y-3 text-sm leading-7 text-stone-700 sm:text-base">
              <li>Logga in för att öppna ärenden, dokument och beslut.</li>
              <li>Begär kompletteringar när underlag saknas.</li>
              <li>Fatta beslut och följ status för varje renoveringsärende.</li>
            </ul>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/renoapp/login"
                className="inline-flex items-center justify-center rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
              >
                BRF-login
              </Link>
              <Link
                href="/renoapp/request-access"
                className="inline-flex items-center justify-center rounded-full border border-emerald-300 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100"
              >
                Anslut BRF
              </Link>
            </div>
          </article>
        </section>

        <section className="rounded-[32px] border border-stone-200/80 bg-white/86 p-6 shadow-[0_24px_70px_-44px_rgba(41,37,36,0.42)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">Vanliga frågor</p>
          <div className="mt-6 grid gap-4">
            {FAQ_ITEMS.map((item) => (
              <details key={item.question} className="rounded-[22px] border border-stone-200 bg-stone-50/80 px-4 py-4 sm:px-5">
                <summary className="cursor-pointer list-none text-base font-semibold leading-7 text-stone-900">
                  {item.question}
                </summary>
                <p className="mt-3 text-sm leading-7 text-stone-700 sm:text-base">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
