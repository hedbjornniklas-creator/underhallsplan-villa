'use client'

import { useEffect, useState } from 'react'
import { FileClock, RefreshCw } from 'lucide-react'
import Sheet from './ObRoundSheet'
import { clearVerifiedObDraft, listObDraftEntries, obDraftFieldLabels, type ObDraftEntry } from '@/lib/ob/draftReview'
import { readObDraftSavedText } from '@/lib/ob/draftReviewClient'

type Comparison = { raw: string; status: 'saved' | 'different' | 'unknown' | 'error'; saved?: Record<string, string> }

export default function ObLocalDraftStatus({ inspectionId, readSaved = readObDraftSavedText }: {
  inspectionId: string
  readSaved?: typeof readObDraftSavedText
}) {
  const [entries, setEntries] = useState<ObDraftEntry[]>([])
  const [storageError, setStorageError] = useState(false)
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [comparisons, setComparisons] = useState<Record<string, Comparison>>({})
  useEffect(() => {
    const refresh = () => {
      try {
        const next = listObDraftEntries(inspectionId, localStorage)
        setEntries(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
        setStorageError(false)
      } catch { setStorageError(true) }
    }
    refresh()
    const timer = window.setInterval(refresh, 1000)
    window.addEventListener('storage', refresh)
    return () => { clearInterval(timer); window.removeEventListener('storage', refresh) }
  }, [inspectionId])

  async function compare() {
    if (checking) return
    setChecking(true)
    try {
      for (const entry of entries) {
        let result: Comparison
        try {
          const saved = await readSaved(inspectionId, entry)
          const verified = clearVerifiedObDraft(entry, saved, localStorage)
          result = { raw: entry.raw, status: verified ? 'saved' : saved ? 'different' : 'unknown', saved: saved ?? undefined }
        } catch { result = { raw: entry.raw, status: 'error' } }
        setComparisons(previous => ({ ...previous, [entry.key]: result }))
      }
    } finally { setChecking(false) }
  }
  const verified = Object.values(comparisons).filter(result => result.status === 'saved').length
  // Drafts also exist briefly during normal typing. Never insert/remove a banner
  // above the focused form as those drafts are written and acknowledged.
  return <>
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-gray-200 px-4 py-2 text-sm text-gray-600">
      <span>{storageError ? <span role="alert">Lokala utkast kunde inte läsas.</span> : <><span className="inline-block min-w-[3ch] tabular-nums">{entries.length}</span> lokala textutkast</>}</span>
      <button type="button" className="inline-flex min-h-11 items-center gap-2 underline" aria-label="Visa lokala textutkast" onClick={() => { setComparisons({}); setOpen(true) }}>
        <FileClock size={18} />Visa texter
      </button>
    </div>
    {open && <Sheet title="Lokala textutkast" onClose={() => setOpen(false)} closeDisabled={checking}
      footer={<button type="button" className="obm-primary" disabled={checking || !entries.length || storageError} onClick={() => void compare()}>
        <RefreshCw size={18} />{checking ? 'Kontrollerar...' : 'Kontrollera mot sparat'}
      </button>}>
      {storageError && <p role="alert">Lokala utkast kunde inte läsas. Stäng inte besiktningen innan sparandet har kontrollerats.</p>}
      <p className="obm-muted">Dessa texter finns på den här enheten, men är inte bekräftade som sparade på servern.</p>
      {verified > 0 && <p role="status">{verified} utkast hade exakt samma text på servern. De lokala kopiorna är borttagna.</p>}
      {!entries.length && !storageError && <p>Inga lokala textutkast återstår.</p>}
      {entries.map(entry => {
        const comparison = comparisons[entry.key]?.raw === entry.raw ? comparisons[entry.key] : undefined
        const fields = Object.entries(entry.values ?? { note: entry.preview })
        const visibleFields = fields.filter(([field, text]) => text || comparison?.saved?.[field])
        return <section key={entry.key} className="min-w-0 border-b border-slate-200 py-4">
          <h3 className="text-base font-semibold">{entry.title}</h3>
          {entry.buildingId && <p className="obm-muted text-sm">Byggnadsbundet utkast</p>}
          {(visibleFields.length ? visibleFields : fields.slice(0, 1)).map(([field, text]) => <div key={field} className={`mt-3 grid min-w-0 gap-3 ${comparison?.status === 'different' ? 'sm:grid-cols-2' : ''}`}>
            <label className="grid min-w-0 gap-1 text-sm">{obDraftFieldLabels[field] || 'Text'} · lokalt
              <textarea readOnly className="w-full min-w-0 rounded border border-slate-300 bg-white p-3 text-slate-900" rows={3} value={text} />
            </label>
            {comparison?.status === 'different' && comparison.saved && <label className="grid min-w-0 gap-1 text-sm">Sparat på servern
              <textarea readOnly className="w-full min-w-0 rounded border border-slate-300 bg-slate-50 p-3 text-slate-900" rows={3} value={comparison.saved[field] ?? ''} />
            </label>}
          </div>)}
          {comparison?.status === 'different' && <p className="mt-2 text-sm">Texten skiljer sig från serverns version eller har ändrats under kontrollen. Inget har skrivits över.</p>}
          {comparison?.status === 'unknown' && <p className="mt-2 text-sm">Detta utkast kunde inte jämföras automatiskt. Texten finns kvar.</p>}
          {comparison?.status === 'error' && <p role="alert" className="mt-2 text-sm">Kunde inte läsa sparad text. Försök igen. Det lokala utkastet finns kvar.</p>}
        </section>
      })}
    </Sheet>}
  </>
}
