import Link from 'next/link'

const FAQ_ITEMS = [
  {
    question: 'Behöver boende skapa konto för att skicka in en ansökan?',
    answer:
      'Nej. Boende ansöker via sin BRF:s ansökningssida och får vid behov en säker ärendelänk för kompletteringar.',
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
    <main>
      <div className="mx-auto flex min-h-[calc(100vh-73px)] w-full max-w-[1800px] flex-col px-6 py-8 sm:px-8 lg:px-10">
        <section className="border-b border-stone-200 pb-8">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-stone-500">RenoApp</p>
          <h1 className="mt-5 max-w-[14ch] text-5xl font-semibold tracking-tight text-stone-950 sm:text-6xl xl:text-7xl">
            Renoveringsärenden för BRF, styrelse och boende
          </h1>
          <p className="mt-6 max-w-[48rem] text-lg leading-8 text-stone-700 sm:text-xl sm:leading-9">
            Välj rätt väg direkt. Ansökan är för boende, login är för styrelse och BRF-användare,
            och anslutning är för föreningar som vill börja arbeta i RenoApp.
          </p>
        </section>

        <section className="flex flex-1 flex-col md:min-h-[560px] md:flex-row">
          <Link
            href="/renoapp/apply"
            className="group flex flex-1 flex-col justify-center border-b border-stone-200 px-2 py-14 transition duration-300 ease-out hover:bg-stone-950/[0.025] md:border-b-0 md:border-r md:border-stone-200 md:px-12 md:py-20 lg:px-16 xl:px-20"
          >
            <div className="mx-auto w-full max-w-[36rem] origin-center transition duration-300 ease-out group-hover:scale-[1.02]">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
                För boende och lägenhetsinnehavare
              </p>
              <h2 className="mt-5 max-w-[10ch] text-5xl font-semibold tracking-tight text-stone-950 sm:text-6xl xl:text-7xl">
                Skicka ansökan
              </h2>
              <p className="mt-6 max-w-[34rem] text-lg leading-8 text-stone-700 sm:text-xl sm:leading-9">
                Gå vidare till din BRF:s ansökan, fyll i projektet och komplettera underlag i samma flöde.
              </p>
              <div className="mt-12 text-base font-semibold text-stone-950 sm:text-lg">
                Till ansökan <span aria-hidden="true">→</span>
              </div>
            </div>
          </Link>

          <div className="flex flex-1 flex-col">
            <Link
              href="/renoapp/login"
              className="group flex flex-1 flex-col justify-center border-b border-stone-200 px-2 py-14 transition duration-300 ease-out hover:bg-stone-950/[0.025] md:px-12 md:py-16 lg:px-16 xl:px-20"
            >
              <div className="mx-auto w-full max-w-[32rem] origin-center transition duration-300 ease-out group-hover:scale-[1.02]">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
                  För styrelse och BRF-användare
                </p>
                <h2 className="mt-4 text-4xl font-semibold tracking-tight text-stone-950 sm:text-5xl">
                  BRF-login
                </h2>
                <p className="mt-5 max-w-[30rem] text-base leading-8 text-stone-700 sm:text-lg">
                  Öppna ärenden, dokument och beslut för föreningens pågående renoveringsärenden.
                </p>
                <div className="mt-10 text-base font-semibold text-stone-950">
                  Logga in <span aria-hidden="true">→</span>
                </div>
              </div>
            </Link>

            <Link
              href="/renoapp/request-access"
              className="group flex flex-1 flex-col justify-center px-2 py-14 transition duration-300 ease-out hover:bg-stone-950/[0.025] md:px-12 md:py-16 lg:px-16 xl:px-20"
            >
              <div className="mx-auto w-full max-w-[32rem] origin-center transition duration-300 ease-out group-hover:scale-[1.02]">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
                  För föreningar som vill ansluta sig
                </p>
                <h2 className="mt-4 text-4xl font-semibold tracking-tight text-stone-950 sm:text-5xl">
                  Anslut BRF
                </h2>
                <p className="mt-5 max-w-[30rem] text-base leading-8 text-stone-700 sm:text-lg">
                  Ansök om att börja använda RenoApp och kom igång med ett gemensamt flöde för ansökan, granskning och beslut.
                </p>
                <div className="mt-10 text-base font-semibold text-stone-950">
                  Ansök om anslutning <span aria-hidden="true">→</span>
                </div>
              </div>
            </Link>
          </div>
        </section>

        <section className="border-t border-stone-200 pt-8">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">Vanliga frågor</p>
          <div className="mt-6 border-t border-stone-200">
            {FAQ_ITEMS.map((item) => (
              <details key={item.question} className="border-b border-stone-200 py-5">
                <summary className="cursor-pointer list-none text-lg font-semibold text-stone-950">
                  {item.question}
                </summary>
                <p className="mt-3 max-w-[54rem] text-base leading-8 text-stone-700">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
