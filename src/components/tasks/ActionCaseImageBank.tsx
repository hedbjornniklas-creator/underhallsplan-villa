'use client'

import { useState } from 'react'
import { Grid2X2, Grid3X3, Square, Trash2, RefreshCw, Loader2, Plus } from 'lucide-react'
import type { ActionCaseView } from '@/lib/action-cases/contracts'
import ActionCaseImageViewer, { ActionCaseAttachmentImage } from './ActionCaseImageViewer'
import { projectLibraryImages } from '@/lib/action-cases/projectImageLibrary'
import { useDiaryImages } from './useDiaryImages'

export default function ActionCaseImageBank({ actionCase, busy, onAccess, onDelete, active = true }: {
  actionCase: ActionCaseView
  busy: boolean
  onAccess: (id: string, participants: string[]) => void
  onDelete: (id: string) => void
  active?: boolean
}) {
  const diary = useDiaryImages(actionCase.id, active)
  const library = projectLibraryImages(actionCase.id, actionCase.attachments, diary.images)
  const [source, setSource] = useState<'all' | 'project' | 'diary'>('all')
  const images = library.filter(image => source === 'all' || image.source === source)
  const byId = new Map(library.map(image => [image.id, image]))
  const [columns, setColumns] = useState(2)
  const [openedId, setOpenedId] = useState<string | null>(null)
  return <section className="mt-5">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">Bildbank · {images.length} bilder</h3>
      <div className="flex gap-1">{[{ value: 3, Icon: Grid3X3, label: 'Små bilder' }, { value: 2, Icon: Grid2X2, label: 'Mellanstora bilder' }, { value: 1, Icon: Square, label: 'Stora bilder' }].map(({ value, Icon, label }) =>
        <button key={value} type="button" title={label} aria-label={label} aria-pressed={columns === value} onClick={() => setColumns(value)} className={`inline-flex h-10 w-10 items-center justify-center rounded-md border ${columns === value ? 'border-violet-700 bg-violet-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}><Icon size={18} /></button>
      )}<button type="button" title="Uppdatera dagboksbilder" aria-label="Uppdatera dagboksbilder" disabled={diary.loading} onClick={() => void diary.refresh()} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 disabled:opacity-50"><RefreshCw size={17} className={diary.loading ? 'animate-spin' : ''} /></button></div>
    </div>
    <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Bildkälla">{([['all', 'Alla bilder'], ['project', 'Projektfiler'], ['diary', 'Dagbok']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={source === value} onClick={() => { setSource(value); setOpenedId(null) }} className={`min-h-10 rounded-md border px-3 text-sm ${source === value ? 'border-[#206961] bg-[#F1F6F5]' : 'border-slate-200 bg-white'}`}>{label}</button>)}</div>
    {diary.error && <div role="alert" className="mb-3 text-sm text-rose-700"><p>{diary.error}</p><button type="button" className="min-h-10 underline" disabled={diary.loading} onClick={() => void diary.retry()}>Försök igen</button></div>}
    {diary.loading && <p role="status" className="mb-3 flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />Hämtar dagboksbilder…</p>}
    {!images.length && !diary.loading && <p className="py-3 text-sm text-slate-500">Inga bilder att visa.</p>}
    <div className="max-h-[560px] overflow-y-auto pr-1">
      <div className={`grid gap-3 ${columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {images.map((image) => <article key={image.id} className="min-w-0 rounded-md border border-slate-200 bg-white">
          <button type="button" aria-label={`Granska ${image.fileName}`} onClick={() => setOpenedId(image.id)} className="relative block aspect-[4/3] w-full overflow-hidden rounded-t-md bg-slate-100">
            <ActionCaseAttachmentImage caseId={actionCase.id} file={image} src={image.url} />
          </button>
          <div className="p-2">
            <p className="truncate text-xs font-medium" title={image.fileName}>{image.title || image.fileName}</p>
            <p className="mt-1 break-words text-xs leading-5 text-slate-500">{image.caption}</p>
            {image.source === 'project' ?
            <div className="mt-2 flex items-center justify-between gap-1">
              <details className="relative min-w-0"><summary className="cursor-pointer text-xs font-semibold text-violet-700">Åtkomst ({image.grantedParticipantIds.length})</summary>
                <div className="relative z-10 mt-2 space-y-2 text-xs">
                  <p>Internt är alltid valt.</p>
                  {actionCase.participants.map((participant) => <label key={participant.id} className="flex items-start gap-2 break-words">
                    <input type="checkbox" disabled={busy} checked={image.grantedParticipantIds.includes(participant.id)} onChange={(event) => onAccess(image.id, event.target.checked ? [...image.grantedParticipantIds, participant.id] : image.grantedParticipantIds.filter((id) => id !== participant.id))} className="accent-violet-600" />{participant.name}
                  </label>)}
                </div>
              </details>
              <button type="button" disabled={busy} title="Ta bort bild" aria-label={`Ta bort ${image.fileName}`} onClick={() => { if (window.confirm(`Ta bort ${image.fileName}?`)) onDelete(image.id) }} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"><Trash2 size={16} /></button>
            </div> : <p className="mt-2 text-xs text-slate-500">Internt · Dagbok</p>}
          </div>
        </article>)}
      </div>
    </div>
    {source !== 'project' && diary.nextCursor && <button type="button" disabled={diary.loading} onClick={() => void diary.more()} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm"><Plus size={16} />Visa fler dagboksbilder</button>}
    {openedId && images.some((image) => image.id === openedId) ? <ActionCaseImageViewer caseId={actionCase.id} images={images} openedId={openedId} onOpen={setOpenedId} onClose={() => setOpenedId(null)} urlForFile={id => byId.get(id)!.url} captionForFile={id => byId.get(id)!.caption} /> : null}
  </section>
}
