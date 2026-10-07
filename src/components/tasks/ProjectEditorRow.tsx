'use client'

import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export default function ProjectEditorRow({ title, summary, amount, open, onToggle, children }: {
  title: string
  summary?: ReactNode
  amount?: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const id = useId()
  const toggle = useRef<HTMLButtonElement>(null)
  const clickedTop = useRef<number | null>(null)
  useLayoutEffect(() => {
    const previousTop = clickedTop.current
    clickedTop.current = null
    if (previousTop === null || !toggle.current) return
    const bounds = toggle.current.getBoundingClientRect()
    // Closing a preceding section must not move the clicked heading off screen.
    const formSpace = open ? Math.min(240, window.innerHeight / 2) : 0
    const targetTop = Math.max(16, Math.min(previousTop, window.innerHeight - bounds.height - formSpace - 16))
    const shift = bounds.top - targetTop
    if (Math.abs(shift) >= 1) window.scrollBy({ top: shift, behavior: 'instant' })
  }, [open])
  return <section className="gizmo-editor-row">
    <h3>
      <button ref={toggle} type="button" className="gizmo-editor-row-toggle" aria-expanded={open} aria-controls={id} onClick={() => {
        clickedTop.current = toggle.current?.getBoundingClientRect().top ?? null
        onToggle()
      }}>
        <span className="gizmo-editor-row-label"><strong>{title}</strong>{summary && <span className="gizmo-editor-row-summary">{summary}</span>}</span>
        {amount && <span className="gizmo-editor-row-amount">{amount}</span>}
        <ChevronDown size={18} className={open ? 'rotate-180' : ''} aria-hidden="true" />
      </button>
    </h3>
    <div id={id} hidden={!open} className="gizmo-editor-row-body">{children}</div>
  </section>
}
