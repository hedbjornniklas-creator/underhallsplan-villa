'use client'
import React, { useEffect, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import './mobile-round.css'

export default function Sheet({
  title,
  onClose,
  children,
  footer,
  actions,
  closeDisabled = false,
  className = '',
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  actions?: React.ReactNode
  closeDisabled?: boolean
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    const returnFocus = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      // React may remove the dialog before the browser restores its opener.
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
        returnFocus.focus({ preventScroll: true })
      }
    }
  }, [])
  return (
    <dialog
      ref={ref}
      role="dialog"
      aria-label={title}
      className={`obm-sheet ${className}`.trim()}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
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
