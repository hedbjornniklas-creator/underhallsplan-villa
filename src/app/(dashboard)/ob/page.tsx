'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import Protected from '@/components/Protected'
import GettingStarted from '@/components/besiktapp/GettingStarted'
import ObOverview from '@/components/ob/ObOverview'
import ObHomeActions from '@/components/ob/ObHomeActions'

export default function OverlatelsebesiktningPage() {
  const [overviewRefreshKey, setOverviewRefreshKey] = useState(0)

  return <Protected>
    <main className="obo-home min-h-screen">
      <div className="obo-home-inner mx-auto w-full p-4 md:p-6">
        <GettingStarted module="ob" heading={<>
          <Link href="/dashboard-v1" aria-label="Tillbaka" title="Tillbaka"
            className="inline-flex items-center justify-center rounded border border-gray-300 bg-white text-gray-700">
            <ArrowLeft size={20} aria-hidden="true" />
          </Link>
          <h1>Överlåtelsebesiktning</h1>
        </>} />
        <ObHomeActions onSent={() => setOverviewRefreshKey(value => value + 1)} />
        <ObOverview refreshKey={overviewRefreshKey} />
      </div>
    </main>
  </Protected>
}
