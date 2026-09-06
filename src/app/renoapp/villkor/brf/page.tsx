import type { Metadata } from 'next'
import {
  RENOAPP_BRF_TERMS_SECTIONS,
  RENOAPP_BRF_TERMS_TITLE,
  RENOAPP_BRF_TERMS_VERSION,
} from '@/lib/renoapp/brfTerms'

export const metadata: Metadata = {
  title: `${RENOAPP_BRF_TERMS_TITLE} | HusHub`,
}

export default function RenoAppBrfTermsPage() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10 text-stone-950 sm:px-6 sm:py-14">
      <article className="mx-auto max-w-3xl bg-white px-6 py-8 shadow-sm sm:px-10 sm:py-12">
        <header className="border-b border-stone-200 pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">RenoApp</p>
          <h1 className="mt-3 text-3xl font-semibold">{RENOAPP_BRF_TERMS_TITLE}</h1>
          <p className="mt-3 text-sm text-stone-600">Version {RENOAPP_BRF_TERMS_VERSION}</p>
        </header>

        <div className="mt-8 space-y-8">
          {RENOAPP_BRF_TERMS_SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="text-lg font-semibold text-stone-950">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-stone-700 sm:text-base">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>
      </article>
    </main>
  )
}
