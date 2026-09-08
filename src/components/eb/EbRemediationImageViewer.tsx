'use client'

/* eslint-disable @next/next/no-img-element */

import { ChevronLeft, ChevronRight, ImageOff, Loader2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

export type EbRemediationViewerImage = {
  id: string
  url: string | null
  alt: string
  caption: string
}

type Props = {
  images: EbRemediationViewerImage[]
  activeImageId: string | null
  onClose: () => void
}

function FullSizeImage({ image }: { image: EbRemediationViewerImage | undefined }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading')
  if (!image?.url || state === 'error') {
    return (
      <div role="status" className="max-w-md rounded-xl border border-white/15 bg-white/5 p-6 text-center">
        <ImageOff size={32} className="mx-auto mb-3 text-slate-300" aria-hidden />
        <p className="font-semibold">Bilden kunde inte visas.</p>
        <p className="mt-2 text-sm leading-6 text-slate-300">Den kan vara tillfälligt otillgänglig. Du kan gå vidare till andra bilder eller stänga bildvisaren och försöka igen.</p>
      </div>
    )
  }
  return (
    <>
      {state === 'loading' ? (
        <div role="status" className="pointer-events-none absolute flex items-center gap-2 text-sm text-slate-200">
          <Loader2 size={20} className="animate-spin" aria-hidden /> Bilden laddas…
        </div>
      ) : null}
      <img src={image.url} alt={image.alt} draggable={false} referrerPolicy="no-referrer"
        onLoad={() => setState('loaded')} onError={() => setState('error')}
        className={`max-h-full max-w-full object-contain ${state === 'loading' ? 'opacity-0' : ''}`} />
    </>
  )
}

function ImageViewerSession({ images, activeImageId, onClose }: Props & { activeImageId: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [selectedId, setSelectedId] = useState(activeImageId)
  const titleId = useId()
  const captionId = useId()
  const index = images.findIndex(image => image.id === selectedId)
  const image = index >= 0 ? images[index] : undefined
  const canPrevious = index > 0
  const canNext = index < images.length - 1

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    // Native modality also makes the underlying portal inert to clicks and
    // assistive technology; the explicit Tab handling below keeps focus local.
    element.showModal()
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus({ preventScroll: true })
    return () => {
      element.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  const move = (direction: -1 | 1) => {
    const next = images[index + direction]
    if (next) setSelectedId(next.id)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (!event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      move(event.key === 'ArrowLeft' ? -1 : 1)
    } else if (event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'))
        .filter(control => control.getClientRects().length > 0)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (!first) { event.preventDefault(); return }
      const focused = document.activeElement
      if (!controls.some(control => control === focused)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && focused === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  return (
    <dialog ref={dialog} aria-modal="true" aria-labelledby={titleId} aria-describedby={captionId}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-slate-950/95 p-0 text-white outline-none backdrop:bg-slate-950/80 print:hidden"
      onKeyDown={handleKeyDown} onCancel={event => { event.preventDefault(); onClose() }}
      onClick={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="break-words text-sm font-semibold leading-6">{image?.alt || 'Bildvisare'}</h2>
            <p aria-live="polite" aria-atomic="true" className="mt-1 text-xs text-slate-300">
              {index >= 0 ? `Bild ${index + 1} av ${images.length}` : 'Bilden är inte längre tillgänglig i urvalet.'}
            </p>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Stäng bildvisaren"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            <X size={22} aria-hidden />
          </button>
        </div>
        <div data-testid="remediation-image-stage" className="relative flex min-h-0 flex-1 items-center justify-center px-12 py-3 sm:px-20"
          onClick={event => { if (event.target === event.currentTarget) onClose() }}>
          {images.length > 1 ? <button type="button" onClick={() => move(-1)} disabled={!canPrevious} aria-label="Föregående bild"
            className="absolute left-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-default disabled:opacity-25 sm:left-5">
            <ChevronLeft size={28} aria-hidden />
          </button> : null}
          <FullSizeImage key={`${image?.id ?? 'missing'}:${image?.url ?? ''}`} image={image} />
          {images.length > 1 ? <button type="button" onClick={() => move(1)} disabled={!canNext} aria-label="Nästa bild"
            className="absolute right-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-default disabled:opacity-25 sm:right-5">
            <ChevronRight size={28} aria-hidden />
          </button> : null}
        </div>
        <div className="max-h-[25dvh] shrink-0 overflow-y-auto border-t border-white/10 px-4 py-4 sm:px-6">
          <p id={captionId} className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{image?.caption || 'Bilden saknar beskrivning.'}</p>
        </div>
      </div>
    </dialog>
  )
}

/** The parent supplies only images authorized for the currently selected note. */
export default function EbRemediationImageViewer(props: Props) {
  if (props.activeImageId === null) return null
  return <ImageViewerSession key={props.activeImageId} {...props} activeImageId={props.activeImageId} />
}
