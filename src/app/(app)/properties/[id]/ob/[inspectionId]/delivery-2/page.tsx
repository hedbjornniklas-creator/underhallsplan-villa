'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Protected from '@/components/Protected'

export default function InspectionDeliveryV2Page() {
  const params = useParams()
  const router = useRouter()

  const propertyId = params?.id as string
  const inspectionId = params?.inspectionId as string

  return (
    <Protected>
      <main className="relative min-h-full overflow-hidden p-4 md:p-6">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(100% 70% at 50% 0%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 58%), linear-gradient(135deg, #5a86dc 0%, #6eaeea 45%, #87CEFA 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-white/8" />

        <div className="relative mx-auto w-full max-w-7xl space-y-4">
          <div className="grid items-start gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
            <div className="md:w-[240px]">
              <nav className="space-y-2 rounded-2xl border border-white/45 bg-white/95 p-3 shadow-xl ring-1 ring-black/5 md:sticky md:top-24 md:w-[240px]">
                <div className="mb-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== 'undefined' && window.history.length > 1) {
                        router.back()
                        return
                      }
                      router.push(`/properties/${propertyId}/ob/${inspectionId}`)
                    }}
                    aria-label="Tillbaka"
                    title="Tillbaka"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <ArrowLeft size={16} strokeWidth={2} />
                  </button>
                  <div className="text-sm font-semibold text-gray-900">Överlåtelsebesiktning</div>
                </div>

                <Link
                  href={`/properties/${propertyId}/ob/${inspectionId}`}
                  className="block w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  Tillbaka till besiktning
                </Link>

                <div className="w-full rounded-md bg-indigo-600 px-3 py-2 text-left text-sm text-white">
                  Skicka utlåtande 2
                </div>
              </nav>
            </div>

            <div className="rounded-2xl border border-white/45 bg-white/95 p-3 shadow-xl ring-1 ring-black/5 md:p-4">
              <div className="rounded-xl border bg-white p-4 text-sm text-gray-700">
                <h2 className="text-base font-semibold text-gray-900">Skicka utlåtande 2</h2>
                <p className="mt-2">
                  Detta är en helt separat sida för nästa generation av digitalt utlåtande-flöde.
                </p>
                <p className="mt-2 text-xs text-gray-600">
                  Nuvarande funktioner för “Skicka utlåtande” påverkas inte.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </Protected>
  )
}
