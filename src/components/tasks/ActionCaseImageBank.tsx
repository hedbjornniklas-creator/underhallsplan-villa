'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Grid2X2, Grid3X3, Square, Trash2, X } from 'lucide-react'
import type { ActionCaseView } from '@/lib/action-cases/contracts'

export default function ActionCaseImageBank({ actionCase, busy, onAccess, onDelete }: {
  actionCase: ActionCaseView
  busy: boolean
  onAccess: (id: string, participants: string[]) => void
  onDelete: (id: string) => void
}) {
  const images = actionCase.attachments.filter((file) => file.type === 'image')
  const [columns, setColumns] = useState(2)
  const [openedId, setOpenedId] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const openedIndex = images.findIndex((image) => image.id === openedId)
  const opened = images[openedIndex]
  const url = (id: string) => `/api/action-cases/${actionCase.id}/attachments/${id}`
  useEffect(() => {
    if (openedId) dialog.current?.showModal()
    else dialog.current?.close()
  }, [openedId])
  if (!images.length) return null
  return <section className="mt-5">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">Bildbank · {images.length} bilder</h3>
      <div className="flex gap-1">{[{ value: 3, Icon: Grid3X3, label: 'Små bilder' }, { value: 2, Icon: Grid2X2, label: 'Mellanstora bilder' }, { value: 1, Icon: Square, label: 'Stora bilder' }].map(({ value, Icon, label }) =>
        <button key={value} type="button" title={label} aria-label={label} aria-pressed={columns === value} onClick={() => setColumns(value)} className={`inline-flex h-10 w-10 items-center justify-center rounded-md border ${columns === value ? 'border-violet-700 bg-violet-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}><Icon size={18} /></button>
      )}</div>
    </div>
    <div className="max-h-[560px] overflow-y-auto pr-1">
      <div className={`grid gap-3 ${columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {images.map((image) => <article key={image.id} className="min-w-0 rounded-md border border-slate-200 bg-white">
          <button type="button" aria-label={`Granska ${image.fileName}`} onClick={() => setOpenedId(image.id)} className="relative block aspect-[4/3] w-full overflow-hidden rounded-t-md bg-slate-100">
            <Image src={url(image.id)} alt={image.title || image.fileName} fill unoptimized className="object-cover" />
          </button>
          <div className="p-2">
            <p className="truncate text-xs font-medium" title={image.fileName}>{image.title || image.fileName}</p>
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
            </div>
          </div>
        </article>)}
      </div>
    </div>
    <dialog ref={dialog} onCancel={() => setOpenedId(null)} onClose={() => setOpenedId(null)} aria-label="Granska bild" className="fixed inset-0 m-auto h-[90dvh] w-[94vw] max-w-6xl rounded-lg bg-slate-950 p-0 text-white backdrop:bg-black/70">
      {opened ? <div className="flex h-full flex-col">
        <header className="flex items-center justify-between gap-3 p-3"><p className="min-w-0 truncate text-sm">{openedIndex + 1} / {images.length} · {opened.title || opened.fileName}</p><button type="button" onClick={() => setOpenedId(null)} aria-label="Stäng bild" className="h-11 w-11 shrink-0"><X className="mx-auto" /></button></header>
        <div className="relative min-h-0 flex-1"><Image src={url(opened.id)} alt={opened.title || opened.fileName} fill unoptimized className="object-contain" /></div>
        <footer className="flex items-center justify-center gap-6 p-3"><button type="button" disabled={openedIndex <= 0} onClick={() => setOpenedId(images[openedIndex - 1].id)} aria-label="Föregående bild" className="h-11 w-11 disabled:opacity-30"><ChevronLeft className="mx-auto" /></button><a href={url(opened.id)} target="_blank" rel="noreferrer" className="text-sm underline">Öppna original</a><button type="button" disabled={openedIndex >= images.length - 1} onClick={() => setOpenedId(images[openedIndex + 1].id)} aria-label="Nästa bild" className="h-11 w-11 disabled:opacity-30"><ChevronRight className="mx-auto" /></button></footer>
      </div> : null}
    </dialog>
  </section>
}
