'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ImageOff, Loader2, X } from 'lucide-react'
import type { ActionCaseAttachmentView } from '@/lib/action-cases/contracts'

export const actionCaseImageUrl = (caseId: string, imageId: string) => `/api/action-cases/${caseId}/attachments/${imageId}`

export function ActionCaseAttachmentImage({ caseId, file, eager = false, src }: { caseId: string; file: ActionCaseAttachmentView; eager?: boolean; src?: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  return <>
    {status !== 'error' ? <Image src={src ?? actionCaseImageUrl(caseId, file.id)} alt={file.title || file.fileName} fill unoptimized loading={eager ? 'eager' : 'lazy'} className="object-contain" onLoad={() => setStatus('ready')} onError={() => setStatus('error')} /> : null}
    {status === 'loading' ? <span className="pointer-events-none absolute inset-0 grid place-items-center"><Loader2 size={22} className="animate-spin opacity-60" aria-hidden="true" /><span className="sr-only">Laddar bild</span></span> : null}
    {status === 'error' ? <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center text-xs"><ImageOff size={24} aria-hidden="true" />Bilden kunde inte visas</span> : null}
  </>
}

type Props = {
  caseId: string
  images: ActionCaseAttachmentView[]
  openedId: string
  onOpen: (id: string) => void
  onClose: () => void
  urlForFile?: (id: string) => string
  selection?: { selectedIds: string[]; disabled: boolean; onChange: (id: string, checked: boolean) => void; label?: string }
}

export default function ActionCaseImageViewer({ caseId, images, openedId, onOpen, onClose, selection, urlForFile }: Props) {
  const dialog = useRef<HTMLDivElement>(null)
  const index = images.findIndex((image) => image.id === openedId)
  const opened = images[index]
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.focus()
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus() }
  }, [])
  if (!opened || typeof document === 'undefined') return null
  return createPortal(<div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-2 sm:p-5" onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="Granska bild" tabIndex={-1} className="flex h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-neutral-950 text-white shadow-2xl outline-none" onKeyDown={(e) => {
      // Keep keyboard actions inside this preview, not the underlying request sheet.
      e.stopPropagation()
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); onOpen(images[index - 1].id) }
      if (e.key === 'ArrowRight' && index < images.length - 1) { e.preventDefault(); onOpen(images[index + 1].id) }
      if (e.key !== 'Tab') return
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]') ?? [])
      const first = nodes[0], last = nodes.at(-1)
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }}>
      <header className="flex shrink-0 items-center justify-between gap-3 p-3"><p className="min-w-0 break-words text-sm">{index + 1} / {images.length} · {opened.title || opened.fileName}</p><button type="button" onClick={onClose} aria-label="Stäng bild" title="Stäng bild" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-white/10"><X /></button></header>
      <div className="relative min-h-0 flex-1"><ActionCaseAttachmentImage key={opened.id} caseId={caseId} file={opened} src={urlForFile?.(opened.id)} eager /></div>
      <footer className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-2 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {selection ? <label className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-violet-600" disabled={selection.disabled} checked={selection.selectedIds.includes(opened.id)} onChange={(e) => selection.onChange(opened.id, e.target.checked)} />{selection.label || 'Bifoga bilden'}</label> : null}
        <button type="button" disabled={index <= 0} onClick={() => onOpen(images[index - 1].id)} aria-label="Föregående bild" title="Föregående bild" className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-white/10 disabled:opacity-30"><ChevronLeft /></button>
        <a href={urlForFile?.(opened.id) ?? actionCaseImageUrl(caseId, opened.id)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm underline">Öppna original</a>
        <button type="button" disabled={index >= images.length - 1} onClick={() => onOpen(images[index + 1].id)} aria-label="Nästa bild" title="Nästa bild" className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-white/10 disabled:opacity-30"><ChevronRight /></button>
      </footer>
    </div>
  </div>, document.body)
}
