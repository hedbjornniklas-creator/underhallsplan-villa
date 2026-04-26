'use client'

import Protected from '@/components/Protected'

export default function RenoAppAdminClient() {
  return (
    <Protected>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
        <section className="rounded-[28px] border border-stone-200/80 bg-white/90 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Översikt</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900">RenoApp Admin</h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700">
            Den här sidan används som samlad översikt för aktivitet, uppföljning och kommande adminfunktioner.
            Navigationen till RenoApps inställningar och arbetsytor ligger i topbaren.
          </p>
        </section>
      </main>
    </Protected>
  )
}
