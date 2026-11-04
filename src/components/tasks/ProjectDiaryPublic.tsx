'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import UppdragBrand from './UppdragBrand'
import DiaryPersonEntry from './DiaryPersonEntry'
import type { DiaryPublicState } from '@/lib/action-cases/projectDiary'
import './project-diary.css'

export default function ProjectDiaryPublic({ token, initial }: { token: string; initial: DiaryPublicState }) {
  const [data, setData] = useState(initial), [ready, setReady] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState('')
  const sequence = useRef(0), endpoint = `/api/dagbok/${token}`
  const open = useCallback(async (signal?: AbortSignal) => {
    const serial = ++sequence.current; setBusy(true); setError('')
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal }), result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Dagboken kunde inte öppnas.')
      if (result.project?.id !== initial.project.id || !Array.isArray(result.people) || !Array.isArray(result.items)) throw new Error('Dagboken kunde inte bekräftas.')
      if (serial === sequence.current) { setData(result); setReady(true) }
    } catch (reason) { if (!signal?.aborted && serial === sequence.current) setError(reason instanceof Error ? reason.message : 'Dagboken kunde inte öppnas.') }
    finally { if (!signal?.aborted && serial === sequence.current) setBusy(false) }
  }, [endpoint, initial.project.id])
  useEffect(() => { const controller = new AbortController(); void open(controller.signal); return () => controller.abort() }, [open])
  return <main className="uppdrag-scope diary-public"><header className="diary-public-header"><UppdragBrand /><div><p className="diary-eyebrow">Dagbok</p><h1>{data.project.title}</h1></div></header>
    {!ready && busy && <p className="diary-empty" role="status"><Loader2 size={18} className="inline animate-spin" /> Öppnar dagboken…</p>}
    {error && <div className="diary-error" role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={() => void open()}><RotateCcw size={17} />Försök igen</button></div>}
    {ready && <DiaryPersonEntry endpoint={endpoint} projectId={data.project.id} people={data.people} items={data.items} />}
  </main>
}
