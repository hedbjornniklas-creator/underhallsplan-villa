'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Menu, X } from 'lucide-react'

export default function RenoAppMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open || !dialog.current) return
    const element = dialog.current
    const triggerElement = trigger.current
    const previousOverflow = document.body.style.overflow
    const desktop = window.matchMedia('(min-width: 1100px)')
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false) }
    element.showModal()
    document.body.style.overflow = 'hidden'
    desktop.addEventListener('change', closeOnDesktop)
    closeOnDesktop()
    return () => {
      desktop.removeEventListener('change', closeOnDesktop)
      element.close()
      document.body.style.overflow = previousOverflow
      if (!desktop.matches) triggerElement?.focus()
    }
  }, [open])

  return (
    <div className="reno-mobile-menu">
      <button ref={trigger} type="button" className="reno-icon-button" aria-label="Öppna meny"
        aria-expanded={open} aria-controls={id} onClick={() => setOpen(true)}>
        <Menu size={23} aria-hidden="true" />
      </button>
      <dialog ref={dialog} id={id} className="reno-menu-dialog" aria-labelledby={`${id}-title`}
        onCancel={() => setOpen(false)} onClose={() => setOpen(false)}
        onClick={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
        <div className="reno-menu-body">
          <div className="reno-menu-heading">
            <h2 id={`${id}-title`}>RenoApp</h2>
            <button type="button" className="reno-icon-button" aria-label="Stäng meny" onClick={() => setOpen(false)}>
              <X size={23} aria-hidden="true" />
            </button>
          </div>
          <div className="reno-menu-links" onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('a, [data-reno-close-menu]')) setOpen(false)
          }}>{children}</div>
        </div>
      </dialog>
    </div>
  )
}
