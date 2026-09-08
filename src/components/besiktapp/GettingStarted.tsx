'use client'
import { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { BESIKT_START, missingStartProfile, startStorageKey, type BesiktStartModule } from '@/lib/besiktapp/gettingStarted'
import { PUBLIC_BESIKTAPP_CONTACT_EMAIL } from '@/lib/publicCompanyInfo'

const linkStyle = 'inline-flex min-h-11 items-center py-2 font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-700'
type Props = { module: 'ob'; onStart?: never } | { module: Exclude<BesiktStartModule, 'ob'>; onStart: () => void }
export default function GettingStarted({ module, onStart }: Props) {
  const content = BESIKT_START[module]
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [missing, setMissing] = useState<string[] | null>(null)
  const [error, setError] = useState(false)
  const [storageKey, setStorageKey] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data, error: authError } = await supabase.auth.getUser()
        if (authError || !data.user) throw new Error('Profile unavailable')
        const result = await supabase.from('profiles').select('full_name,email,company_name').eq('id', data.user.id).maybeSingle()
        if (result.error) throw new Error('Profile unavailable')
        const gaps = missingStartProfile(result.data)
        const key = startStorageKey(data.user.id, module)
        let preference: string | null = null
        try { preference = window.localStorage.getItem(key) } catch { /* Optional UI preference. */ }
        if (!cancelled) {
          setStorageKey(key); setMissing(gaps); setError(false)
          setOpen(preference === 'open' || (preference !== 'closed' && gaps.length > 0))
        }
      } catch { if (!cancelled) { setMissing(null); setError(true) } }
    }
    void load()
    return () => { cancelled = true }
  }, [module, refresh])
  function toggle() {
    const next = !open; setOpen(next)
    try { if (storageKey) window.localStorage.setItem(storageKey, next ? 'open' : 'closed') } catch { /* Still usable without local storage. */ }
  }
  return <section aria-label={`Kom igång med ${content.name}`} className="@container my-4 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm text-slate-800">
    <button type="button" onClick={toggle} aria-expanded={open} aria-controls={panelId} className="flex min-h-11 w-full items-center justify-between gap-4 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-700">
      <span className="font-semibold">Kom igång med {content.name.toLocaleLowerCase('sv-SE')}</span><span className="shrink-0 text-xs text-slate-600">{open ? 'Dölj guide −' : 'Visa guide +'}</span>
    </button>
    <div id={panelId} hidden={!open}>
      <p className="mt-2 max-w-2xl text-slate-600">En hjälp inför ditt första uppdrag. Du kan stänga guiden och fortsätta arbeta som vanligt.</p>
      <ol className="my-5 grid gap-6 @2xl:grid-cols-3">
        <li><h2 className="font-semibold">1. Kontrollera din profil</h2>
          <p className="mt-2 leading-6">{error ? 'Profilen kunde inte läsas. Inga uppgifter har markerats som klara.' : missing === null ? 'Hämtar sparade profiluppgifter…' : missing.length ? `Lägg till ${missing.join(', ')} i din profil.` : 'Namn, e-post och företagsnamn finns sparade. Kontrollera att de stämmer.'}</p>
          <p className="mt-2 text-xs leading-5 text-slate-600">Kontrollera även kontaktuppgifter och eventuella certifieringar. Logga och porträtt kan läggas till senare. Guiden verifierar inte dina meriter.</p>
          <Link className={linkStyle} href={`/settings?besiktStart=${module}`}>Öppna min profil</Link>
          {error && <button type="button" className={`${linkStyle} ml-3`} onClick={() => setRefresh(value => value + 1)}>Försök igen</button>}
        </li>
        <li><h2 className="font-semibold">2. Förbered ditt första uppdrag</h2><p className="mt-2 leading-6">{content.instruction}</p>
          {onStart ? <button type="button" className={linkStyle} onClick={onStart}>{content.action}</button> : <Link className={linkStyle} href="/ob/assignments/new">{content.action}</Link>}
          <p className="text-xs leading-5 text-slate-600">Knappen öppnar formuläret. Den skickar inget till kunden.</p>
        </li>
        <li><h2 className="font-semibold">3. Granska innan du skickar</h2><p className="mt-2 leading-6">{content.next}</p>
          <a className={linkStyle} href={`mailto:${PUBLIC_BESIKTAPP_CONTACT_EMAIL}`}>Frågor? Kontakta oss</a>
        </li>
      </ol>
    </div>
  </section>
}
