'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'

type SnapshotPhotoGridProps = {
  photos: string[]
  title: string
  itemIndex: number
}

export default function SnapshotPhotoGrid({
  photos,
  title,
  itemIndex,
}: SnapshotPhotoGridProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const activePhotoIndex = activeIndex ?? 0
  const activePhoto = activeIndex === null ? null : photos[activePhotoIndex] ?? null

  useEffect(() => {
    if (activeIndex === null) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveIndex(null)
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeIndex])

  if (photos.length === 0) return null

  return (
    <>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {photos.map((photoUrl, photoIndex) => (
          <button
            key={`${title}-${itemIndex}-photo-${photoIndex}`}
            type="button"
            onClick={() => setActiveIndex(photoIndex)}
            className="block rounded-md text-left focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            title="Visa bilden"
          >
            <img
              src={photoUrl}
              alt={`Foto ${photoIndex + 1}`}
              className="h-36 w-full rounded-md border border-gray-200 object-cover transition hover:brightness-95"
            />
          </button>
        ))}
      </div>

      {activePhoto ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setActiveIndex(null)}
        >
          <button
            type="button"
            onClick={() => setActiveIndex(null)}
            className="fixed right-3 top-3 z-[110] inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full bg-white px-3 text-sm font-semibold text-slate-900 shadow-lg ring-1 ring-black/10 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            <X size={18} />
            <span className="hidden sm:inline">Stäng</span>
          </button>

          <figure
            className="flex max-h-[calc(100dvh-5rem)] max-w-[calc(100vw-1.5rem)] flex-col items-center gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={activePhoto}
              alt={`Foto ${activePhotoIndex + 1}`}
              className="block max-h-[calc(100dvh-8rem)] max-w-[calc(100vw-1.5rem)] rounded-md bg-white object-contain shadow-2xl"
            />
            <figcaption className="flex max-w-full flex-wrap items-center justify-center gap-3 text-sm text-white">
              <span className="font-medium">
                Foto {activePhotoIndex + 1} av {photos.length}
              </span>
              <a
                href={activePhoto}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/20"
              >
                <ExternalLink size={15} />
                Öppna i ny flik
              </a>
            </figcaption>
          </figure>
        </div>
      ) : null}
    </>
  )
}
