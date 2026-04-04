'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

function hasRecoveryContext() {
  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

  return (
    search.get('type') === 'recovery' ||
    hash.get('type') === 'recovery' ||
    search.has('code') ||
    hash.has('access_token')
  )
}

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    if (!hasRecoveryContext()) return

    const query = window.location.search ?? ''
    const hash = window.location.hash ?? ''
    router.replace(`/auth/reset-password${query}${hash}`)
  }, [router])

  const handleDashboardEntry = async () => {
    const { data } = await supabase.auth.getSession()
    router.push(data.session ? '/dashboard-v1' : '/login')
  }

  return (
    <main className="min-h-screen bg-[#f7f5f0] text-stone-950">
      <div className="mx-auto flex min-h-screen w-full max-w-[1800px] flex-col px-6 py-6 sm:px-8 lg:px-10">
        <header className="grid grid-cols-1 items-center border-b border-stone-200 pb-5">
          <div className="justify-self-center text-center">
            <div className="flex items-center justify-center gap-3">
              <Image
                src="/landing/Hushub-check2.png"
                alt="Hushub"
                width={44}
                height={44}
                className="h-9 w-9 object-contain"
                priority
              />
              <div className="text-[0.82rem] font-semibold uppercase tracking-[0.42em] text-stone-900">
                HUSHUB
              </div>
            </div>
          </div>
        </header>

        <section className="flex flex-1 flex-col md:flex-row">
          <Link
            href="/renoapp"
            className="group flex flex-1 flex-col justify-center border-b border-stone-200 px-2 py-14 transition duration-300 ease-out hover:bg-stone-950/[0.025] md:border-b-0 md:border-r md:border-stone-200 md:px-12 md:py-20 lg:px-16 xl:px-20"
          >
            <div className="mx-auto w-full max-w-[36rem] origin-center transition duration-300 ease-out group-hover:scale-[1.02]">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
                För BRF – ansökan, granskning och beslut
              </p>
              <h1 className="mt-5 max-w-[12ch] text-5xl font-semibold tracking-tight text-stone-950 sm:text-6xl xl:text-7xl">
                Planerar du att renovera?
              </h1>
              <p className="mt-6 max-w-[34rem] text-lg leading-8 text-stone-700 sm:text-xl sm:leading-9">
                För dig som bor i bostadsrätt och för styrelsen. Ansök, hantera krav och följ
                hela processen i ett gemensamt system.
              </p>
              <div className="mt-12 text-base font-semibold text-stone-950 sm:text-lg">
                Starta RenoApp <span aria-hidden="true">→</span>
              </div>
            </div>
          </Link>

          <button
            type="button"
            onClick={() => void handleDashboardEntry()}
            className="group flex flex-1 cursor-pointer flex-col justify-center px-2 py-14 text-left transition duration-300 ease-out hover:bg-stone-950/[0.025] md:px-12 md:py-20 lg:px-16 xl:px-20"
          >
            <div className="mx-auto w-full max-w-[36rem] origin-center transition duration-300 ease-out group-hover:scale-[1.02]">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
                För fastighetsägare och besiktningsmän
              </p>
              <h2 className="mt-5 max-w-[11ch] text-5xl font-semibold tracking-tight text-stone-950 sm:text-6xl xl:text-7xl">
                Din fastighet, full kontroll
              </h2>
              <p className="mt-6 max-w-[34rem] text-lg leading-8 text-stone-700 sm:text-xl sm:leading-9">
                Besiktningar, underhållsplan och historik. All fastighetsdata samlad på ett ställe.
              </p>
              <div className="mt-12 text-base font-semibold text-stone-950 sm:text-lg">
                Gå till Dashboard <span aria-hidden="true">→</span>
              </div>
            </div>
          </button>
        </section>
      </div>
    </main>
  )
}
