'use client'
import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { BESIKT_START, startModule } from '@/lib/besiktapp/gettingStarted'

const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener)
  return () => window.removeEventListener('popstate', listener)
}
const readModule = () => startModule(new URLSearchParams(window.location.search).get('besiktStart'))

export default function ProfileStartReturn({ pending, error, onRetry }: { pending: boolean; error: string | null; onRetry: () => void }) {
  const selectedModule = useSyncExternalStore(subscribe, readModule, () => null)
  if (!selectedModule) return null
  return <aside className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-800" aria-label="Tillbaka till startguiden">
    <h2 className="font-semibold">Börja med namn, e-post och företag</h2>
    <p className="mt-2">Uppgifterna används som avsändaruppgifter. Fyll även i relevanta kontaktuppgifter och certifieringar. Du behöver inte lägga till bild eller logga för att börja arbeta.</p>
    <p role="status" className="mt-2 text-slate-600">{error ? 'Profilen kunde inte sparas eller läsas. Kontrollera felet nedan innan du fortsätter.' : pending ? 'Vänta tills profiluppgifterna har sparats innan du fortsätter.' : 'Dina profiluppgifter är sparade. Du kan fortsätta eller komplettera mer.'}</p>
    {error && <button type="button" className="mr-4 mt-3 min-h-11 font-semibold underline" onClick={onRetry}>Försök igen</button>}
    {!pending && !error && <Link className="mt-3 inline-flex min-h-11 items-center font-semibold underline" href={BESIKT_START[selectedModule].href}>Fortsätt till {BESIKT_START[selectedModule].name.toLocaleLowerCase('sv-SE')}</Link>}
  </aside>
}
