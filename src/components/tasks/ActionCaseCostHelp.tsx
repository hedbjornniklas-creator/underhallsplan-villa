'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { CircleHelp, X } from 'lucide-react'
import { costingHelpTopics } from '@/lib/action-cases/costingHelp'

function CostGuide({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null)
  const id = useId()
  useEffect(() => {
    const node = dialog.current, previous = document.activeElement as HTMLElement | null
    node?.showModal()
    heading.current?.focus()
    return () => { node?.close(); previous?.focus({ preventScroll: true }) }
  }, [])
  return <dialog ref={dialog} className="gizmo-cost-help-dialog" aria-labelledby={`${id}-title`}
    onKeyDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }}>
    <header><div><p>Projektarbete</p><h2 ref={heading} id={`${id}-title`} tabIndex={-1}>Hjälp: Kalkyl</h2></div>
      <button type="button" className="gizmo-cost-help-icon" aria-label="Stäng kalkylhjälpen" title="Stäng kalkylhjälpen" onClick={onClose}><X size={20} aria-hidden="true" /></button>
    </header>
    <div className="gizmo-cost-help-body">
      <nav aria-label="Manualens innehåll"><h3>Innehåll</h3><ol>{costingHelpTopics.map(topic => <li key={topic.id}><a href={`#${id}-${topic.id}`}>{topic.title}</a></li>)}</ol></nav>
      {costingHelpTopics.map(topic => <section key={topic.id} aria-labelledby={`${id}-${topic.id}`}>
        <h3 id={`${id}-${topic.id}`} tabIndex={-1}>{topic.title}</h3>
        {topic.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        {'steps' in topic && <ol>{topic.steps.map(step => <li key={step}>{step}</li>)}</ol>}
      </section>)}
    </div>
  </dialog>
}

export default function ActionCaseCostHelp() {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="gizmo-cost-help-icon" aria-label="Hjälp om kalkylen" title="Hjälp om kalkylen" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><CircleHelp size={20} aria-hidden="true" /></button>
    {open && <CostGuide onClose={() => setOpen(false)} />}
  </>
}
