'use client'

import { useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Images, Loader2, Plus, RefreshCw, X } from 'lucide-react'
import type { ActionCaseAttachmentView } from '@/lib/action-cases/contracts'
import { projectLibraryImages } from '@/lib/action-cases/projectImageLibrary'
import ActionCaseAttachmentPicker from './ActionCaseAttachmentPicker'
import { useDiaryImages } from './useDiaryImages'

export default function QuestionDiaryImagePicker({ caseId, questionId, disabled, remaining, onAttached, onWorking }: {
  caseId: string; questionId: string; disabled: boolean; remaining: number
  onAttached: (files: ActionCaseAttachmentView[]) => void; onWorking: (busy: boolean) => void
}) {
  const [open, setOpen] = useState(false), [selected, setSelected] = useState<string[]>([])
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const running = useRef(false), callbacks = useRef({ onAttached, onWorking })
  callbacks.current = { onAttached, onWorking }
  const panelId = useId(), diary = useDiaryImages(caseId, open)
  const images = projectLibraryImages(caseId, [], diary.images)
  const byId = new Map(images.map(image => [image.id, image]))
  async function attach() {
    if (running.current || disabled || !selected.length || selected.length > remaining) return
    running.current = true; setWorking(true); callbacks.current.onWorking(true); setError(''); setNotice('')
    const completed: ActionCaseAttachmentView[] = [], done = new Set<string>()
    try {
      // Sequential transfers keep mobile memory and request concurrency bounded.
      for (const id of selected) {
        const response = await fetch(`/api/action-cases/${caseId}/questions/${questionId}/diary-photos`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoId: id.slice('diary:'.length) }),
        })
        const result = await response.json()
        if (!response.ok || !result.file?.id) throw new Error(result.error || 'Bilden kunde inte bifogas. Försök igen.')
        completed.push(result.file); done.add(id)
      }
      setNotice(`${completed.length} ${completed.length === 1 ? 'bild bifogad' : 'bilder bifogade'}. Inget har skickats.`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Bilderna kunde inte bifogas.') }
    finally {
      if (completed.length) callbacks.current.onAttached(completed)
      setSelected(current => current.filter(id => !done.has(id)))
      running.current = false; setWorking(false); callbacks.current.onWorking(false)
    }
  }
  return <section className="mt-3" aria-label="Bifoga dagboksbilder">
    <button type="button" className="gizmo-button" aria-expanded={open} aria-controls={panelId} disabled={working || (!open && disabled)} onClick={() => setOpen(value => !value)}><Images size={17} />Välj från dagboken{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
    {open && <div id={panelId} className="mt-3 border-t border-slate-200 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4>Dagboksbilder</h4><button type="button" className="gizmo-button gizmo-icon-button" title="Uppdatera dagboksbilder" aria-label="Uppdatera dagboksbilder" disabled={diary.loading || working} onClick={() => void diary.refresh()}><RefreshCw size={16} /></button></div>
      {diary.loading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />Hämtar bilder…</p>}
      {diary.error && <div role="alert" className="gizmo-question-error"><p>{diary.error}</p><button type="button" className="gizmo-button" disabled={diary.loading} onClick={() => void diary.retry()}>Försök hämta igen</button></div>}
      {images.length > 0 && <div className="max-h-[420px] overflow-y-auto pr-1"><ActionCaseAttachmentPicker caseId={caseId} files={images} selectedIds={selected} inputName={`${panelId}-photo`} disabled={disabled || working} selectionLimit={remaining} urlForFile={id => byId.get(id)!.url} captionForFile={id => byId.get(id)!.caption} selectionLabel="Välj dagboksbild" onChange={(id, checked) => { setSelected(current => checked ? [...new Set([...current, id])] : current.filter(value => value !== id)); setNotice('') }} /></div>}
      {!diary.loading && !diary.error && !images.length && <p className="py-3 text-sm text-slate-500">Inga dagboksbilder att visa.</p>}
      {diary.nextCursor && <button type="button" className="gizmo-button mt-2" disabled={diary.loading || working} onClick={() => void diary.more()}><Plus size={16} />Visa fler bilder</button>}
      {error && <p role="alert" className="gizmo-question-error">{error}</p>}{notice && <p role="status" className="gizmo-question-notice">{notice}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" className="gizmo-button" disabled={disabled || working || !selected.length || selected.length > remaining} onClick={() => void attach()}>{working ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}{working ? 'Bifogar…' : `Bifoga valda (${selected.length})`}</button>{selected.length > 0 && <button type="button" className="gizmo-button gizmo-icon-button" title="Rensa bildval" aria-label="Rensa bildval" disabled={working} onClick={() => setSelected([])}><X size={16} /></button>}<span className="text-sm text-slate-500">{remaining} bilageplatser kvar</span></div>
    </div>}
  </section>
}
