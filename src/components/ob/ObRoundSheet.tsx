'use client'
import React, { useEffect, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'

export default function Sheet({
  title,
  onClose,
  children,
  footer,
  actions,
  closeDisabled = false,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  actions?: React.ReactNode
  closeDisabled?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog
      ref={ref}
      role="dialog"
      aria-label={title}
      className="obm-sheet"
      onCancel={(event) => {
        event.preventDefault()
        if (!closeDisabled) onClose()
      }}
    >
      <header className="obm-sheet-header-back">
        <button
          className="obm-icon"
          title="Tillbaka"
          aria-label="Tillbaka"
          disabled={closeDisabled}
          onClick={() => {
            if (!closeDisabled) onClose()
          }}
        >
          <ArrowLeft size={23} />
        </button>
        <h2>{title}</h2>
        {actions && <div className="obm-sheet-actions">{actions}</div>}
      </header>
      <div className="obm-sheet-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  )
}
