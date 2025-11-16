'use client'

import Link from 'next/link'
import Protected from '@/components/Protected'
import { useProfile } from '@/hooks/useProfile'

export default function SettingsOverview() {
  const { isAdmin, loading } = useProfile()
  if (loading) return <Protected><div className="p-6">Laddar…</div></Protected>
  if (!isAdmin) return <Protected><div className="p-6 text-rose-700">Åtkomst nekad.</div></Protected>

  const cards = [
    { title: 'Handlingar & upplysningar', desc: 'Redigera katalogen för handlingar/upplysningar.', href: '/settings/handlingar-upplysningar' },
    { title: 'Basinformation', desc: 'Fält & val för teknisk basinfo.', href: '/settings/basinformation' },
    { title: 'Utsida', desc: 'Katalog för utvändiga punkter.', href: '/settings/utsida' },
    { title: 'Insida', desc: 'Katalog för invändiga punkter.', href: '/settings/insida' },
  ]

  return (
    <Protected>
      <div className="p-4 md:p-6 space-y-6">
        <h1 className="text-xl md:text-2xl font-semibold">Settings</h1>
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map(c => (
            <Link key={c.href} href={c.href} className="block rounded-2xl border hover:shadow-md p-5">
              <h2 className="text-lg font-semibold">{c.title}</h2>
              <p className="text-sm text-gray-600 mt-1.5">{c.desc}</p>
              <div className="mt-4"><span className="underline text-sm">Öppna</span></div>
            </Link>
          ))}
        </div>
      </div>
    </Protected>
  )
}
