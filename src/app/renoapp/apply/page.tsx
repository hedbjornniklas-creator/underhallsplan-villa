'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Search } from 'lucide-react'
import PublicFrame from '@/components/public/PublicFrame'
import PublicFaq from '@/components/public/PublicFaq'

type PublicBrfListItem = {
  id: string
  name: string
  slug: string
  address: string | null
}

export default function RenoAppResidentApplyEntryPage() {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<PublicBrfListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadCount, setReloadCount] = useState(0)

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return []

    return items.filter((item) => {
      const haystack = [item.name, item.slug, item.address ?? ''].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [items, search])

  useEffect(() => {
    let active = true

    const loadBrfs = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/renoapp/public/brfs', { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as {
          items?: PublicBrfListItem[]
          error?: string
        }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte hämta föreningarna. Försök igen om en stund.')
        }

        if (active) {
          setItems(payload.items ?? [])
        }
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa publika BRF:er.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadBrfs()

    return () => {
      active = false
    }
  }, [reloadCount])

  return (
    <PublicFrame activeProduct="renoapp">
      <section className="public-container public-entry">
        <div className="public-entry-heading">
          <span className="public-eyebrow">Renoveringsansökan för boende</span>
          <h1>Hitta din förening</h1>
          <p>Välj din bostadsrättsförening för att börja ansökan. Du behöver inget konto.</p>
        </div>
        <div className="public-search-panel">
          <label htmlFor="brf-search">Föreningens namn eller adress</label>
          <div className="public-search-input"><Search size={21} aria-hidden="true" /><input id="brf-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Sök förening" aria-describedby="brf-search-status" /></div>
          <p id="brf-search-status" className="public-field-hint" role="status">
            {loading ? 'Hämtar föreningar…' : error ? 'Föreningarna kunde inte hämtas.' : !search.trim() ? 'Skriv ett namn eller en adress för att se föreningar som använder RenoApp.' : filteredItems.length === 0 ? 'Ingen förening matchar sökningen. Prova en annan stavning eller sök på adressen.' : `${filteredItems.length} ${filteredItems.length === 1 ? 'förening' : 'föreningar'} hittades. Välj din förening nedan.`}
          </p>
          {error ? <div className="public-notice public-notice-error" role="alert"><p>Vi kunde inte hämta föreningarna. Försök igen eller använd ansökningslänken från din styrelse.</p><button type="button" className="public-text-link" onClick={() => setReloadCount((count) => count + 1)}>Försök igen <ArrowRight size={17} aria-hidden="true" /></button></div> : !loading && filteredItems.length > 0 ? (
            <ul className="public-search-results" aria-label="Föreningar">
              {filteredItems.map((item) => <li key={item.id}><Link href={`/renoapp/brf/${item.slug}/apply`} prefetch={false}><span><strong>{item.name}</strong>{item.address ? <span>{item.address}</span> : null}</span><ArrowRight size={20} aria-hidden="true" /></Link></li>)}
            </ul>
          ) : null}
        </div>
        <PublicFaq items={[
          { question: 'Har du redan en länk till ansökan?', answer: <>Använd länken från din styrelse för att komma direkt till föreningens ansökan. Om du redan har börjat fylla i en ansökan använder du den personliga länk du sparade, eller fick via mejl, för att fortsätta.</> },
          { question: 'Hittar du inte din förening?', answer: <>Kontakta styrelsen och be om föreningens ansökningslänk. Alla föreningar visas inte i sökningen. Om er förening inte använder RenoApp kan styrelsen <Link href="/renoapp/request-access">anmäla sitt intresse</Link>.</> },
          { question: 'Vad behöver jag ha till hands?', answer: <>Dina kontaktuppgifter, en beskrivning av renoveringen och eventuella ritningar eller andra handlingar. I ansökan ser du vilka underlag föreningen efterfrågar. Du kan spara ett utkast och fortsätta senare.</> },
        ]} />
      </section>
    </PublicFrame>
  )
}
