'use client'

import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Loader2, UploadCloud } from 'lucide-react'

type Props = {
  accept: string
  title: string
  activeTitle?: string
  description: string
  disabled?: boolean
  busy?: boolean
  multiple?: boolean
  icon?: ReactNode
  onFiles: (files: File[]) => void | Promise<void>
}

function hasExternalFiles(event: DragEvent<HTMLElement>) {
  if (!Array.from(event.dataTransfer.types).includes('Files')) return false
  const items = Array.from(event.dataTransfer.items)
  return items.length === 0 || items.some((item) => item.kind === 'file')
}

export default function TaskAttachmentDropZone({
  accept,
  title,
  activeTitle = 'Släpp filerna här',
  description,
  disabled = false,
  busy = false,
  multiple = true,
  icon,
  onFiles,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const blocked = disabled || busy

  const openPicker = () => {
    if (!blocked) inputRef.current?.click()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openPicker()
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasExternalFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    if (blocked) return
    event.dataTransfer.dropEffect = 'copy'
    setDragActive(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDragActive(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasExternalFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    if (blocked) return
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) void onFiles(files)
  }

  return (
    <div
      role="button"
      tabIndex={blocked ? -1 : 0}
      aria-disabled={blocked}
      aria-busy={busy}
      onClick={openPicker}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-5 text-center outline-none transition focus-visible:ring-4 focus-visible:ring-amber-100 ${
        dragActive
          ? 'border-amber-500 bg-amber-50 text-amber-950 ring-2 ring-amber-100'
          : 'border-slate-300 bg-slate-50/70 text-slate-600 hover:border-amber-300 hover:bg-amber-50/60'
      } ${blocked ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={blocked}
        className="sr-only"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          if (files.length > 0) void onFiles(files)
        }}
      />
      {busy ? (
        <Loader2 className="animate-spin text-amber-700" size={24} aria-hidden="true" />
      ) : (
        icon ?? <UploadCloud className="text-amber-700" size={24} aria-hidden="true" />
      )}
      <p className="mt-2 text-sm font-semibold">{busy ? 'Laddar upp…' : dragActive ? activeTitle : title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  )
}
