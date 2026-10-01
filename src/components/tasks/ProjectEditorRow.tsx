'use client'

import { useId, type ReactNode } from 'react'
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
  return <section className="gizmo-editor-row">
    <h3>
      <button type="button" className="gizmo-editor-row-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span className="gizmo-editor-row-label"><strong>{title}</strong>{summary && <span className="gizmo-editor-row-summary">{summary}</span>}</span>
        {amount && <span className="gizmo-editor-row-amount">{amount}</span>}
        <ChevronDown size={18} className={open ? 'rotate-180' : ''} aria-hidden="true" />
      </button>
    </h3>
    <div id={id} hidden={!open} className="gizmo-editor-row-body">{children}</div>
  </section>
}
