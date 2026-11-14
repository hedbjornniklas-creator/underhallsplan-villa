'use client'
/* eslint-disable @next/next/no-img-element -- Historical images use authenticated, project-scoped URLs. */
import { useRef, useState } from 'react'
import { History, Loader2, RotateCcw } from 'lucide-react'
import { diaryTimeRange, type DiaryRevision } from '@/lib/action-cases/projectDiary'

const displayTime = (value: string) => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(value))
export default function DiaryHistory({ endpoint, entryId, revision }: { endpoint: string; entryId: string; revision: number }) {
  const [versions, setVersions] = useState<DiaryRevision[]>([]), [before, setBefore] = useState<number | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), running = useRef(false)
  async function load(cursor?: number) {
    if (running.current) return
    running.current = true; setBusy(true); setError('')
    try {
      const query = new URLSearchParams({ history: entryId }); if (cursor !== undefined) query.set('beforeRevision', String(cursor))
      const response = await fetch(`${endpoint}?${query}`, { cache: 'no-store' }), data = await response.json()
      if (!response.ok || !Array.isArray(data.versions)) throw new Error(data.error || 'Historiken kunde inte hämtas.')
      setVersions(old => cursor === undefined ? data.versions : [...old, ...data.versions.filter((v: DiaryRevision) => !old.some(existing => existing.revision === v.revision))])
      setBefore(data.nextBeforeRevision ?? null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Historiken kunde inte hämtas.') }
    finally { running.current = false; setBusy(false) }
  }
  return <details className="diary-history" onToggle={event => { if (event.currentTarget.open && !versions.length && !busy && !error) void load() }}>
    <summary><History size={16} />Historik ({revision + 1})</summary>
    {versions.map(version => <section className="diary-version" key={version.revision}>
      <h4>{version.revision === 0 ? 'Ursprunglig anteckning' : `Version ${version.revision}`}</h4>
      <p className="diary-muted">{displayTime(version.createdAt)} · {version.actorName}</p>
      <p>{[version.body.workDate, diaryTimeRange(version.body), version.itemTitle].filter(Boolean).join(' · ')}</p>
      <p className="diary-record-text">{version.body.text}</p>
      {version.photos.length > 0 && <div className="diary-record-photos">{version.photos.map(photo => <a key={photo.id} href={`${endpoint}/photos/${photo.id}`} target="_blank" rel="noreferrer" title={photo.name}><img src={`${endpoint}/photos/${photo.id}`} alt={photo.name} loading="lazy" /></a>)}</div>}
    </section>)}
    {busy && <p role="status"><Loader2 size={16} className="inline animate-spin" /> Hämtar historik…</p>}
    {error && <p role="alert" className="diary-error">{error}</p>}
    {error ? <button type="button" disabled={busy} onClick={() => void load(versions.length && before !== null ? before : undefined)}><RotateCcw size={16} />Försök igen</button> : before !== null && <button type="button" disabled={busy} onClick={() => void load(before)}><History size={16} />Visa äldre versioner</button>}
  </details>
}
