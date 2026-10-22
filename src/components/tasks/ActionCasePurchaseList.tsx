'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, Printer, Trash2, X } from 'lucide-react'
import type { ActionCaseCostLineView } from '@/lib/action-cases/contracts'
import { createPurchaseListDraft, printPurchaseList, purchaseListValidation, type PurchaseListDraft, type PurchaseListLine } from '@/lib/action-cases/purchaseListPrint'
import './action-case-purchase-list.css'

type Props = {
  lines: ActionCaseCostLineView[]
  projectTitle?: string
  workTitle: string
  deliveryAddress?: string
  onClose: () => void
}

export default function ActionCasePurchaseList({ lines, projectTitle, workTitle, deliveryAddress, onClose }: Props) {
  const [draft, setDraft] = useState(() => createPurchaseListDraft(lines, { projectTitle, workTitle, deliveryAddress }))
  const [changed, setChanged] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const keepEditing = useRef<HTMLButtonElement>(null)
  const closeTrigger = useRef<HTMLElement | null>(null)
  const id = useId()
  useEffect(() => {
    const node = dialog.current, previous = document.activeElement as HTMLElement | null
    node?.showModal(); heading.current?.focus()
    return () => { node?.close(); previous?.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    if (confirmClose) keepEditing.current?.focus({ preventScroll: true })
    else if (closeTrigger.current?.isConnected) {
      closeTrigger.current.focus({ preventScroll: true }); closeTrigger.current = null
    }
  }, [confirmClose])
  const update = (patch: Partial<PurchaseListDraft>) => { setDraft(current => ({ ...current, ...patch })); setChanged(true); setError('') }
  const updateLine = (sourceId: string, patch: Partial<PurchaseListLine>) => {
    setDraft(current => ({ ...current, lines: current.lines.map(line => line.sourceId === sourceId ? { ...line, ...patch, ...(patch.unit !== undefined && patch.unit !== line.unit ? { unitCost: '' } : {}) } : line) }))
    setChanged(true); setError('')
  }
  const close = () => {
    if (printing || confirmClose) return
    if (changed) { closeTrigger.current = document.activeElement as HTMLElement | null; setConfirmClose(true) }
    else onClose()
  }
  const validation = purchaseListValidation(draft)
  const input = (key: 'supplier' | 'deliveryAddress' | 'deliveryDate' | 'reference', label: string, type = 'text') => <label>{label}<input type={type} value={draft[key]} maxLength={500} onChange={event => update({ [key]: event.target.value })} /></label>
  return <dialog ref={dialog} className="gizmo-purchase-dialog" role={confirmClose ? 'alertdialog' : undefined} aria-labelledby={`${id}-${confirmClose ? 'close-heading' : 'heading'}`} aria-describedby={confirmClose ? `${id}-close-description` : undefined} onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (confirmClose) setConfirmClose(false); else close() }}>
    <header inert={confirmClose} aria-hidden={confirmClose || undefined}><div><h2 ref={heading} tabIndex={-1} id={`${id}-heading`}>Beställningslista</h2><p>{projectTitle ? `${projectTitle} · ` : ''}{workTitle}</p></div><button type="button" className="gizmo-purchase-icon" title="Stäng beställningslista" aria-label="Stäng beställningslista" disabled={printing || confirmClose} onClick={close}><X size={20} /></button></header>
    <div className="gizmo-purchase-body" inert={confirmClose} aria-hidden={confirmClose || undefined}>
      <fieldset disabled={printing || confirmClose}>
        <div className="gizmo-purchase-fields">{input('supplier', 'Leverantör')}{input('reference', 'Referens / kontakt')}{input('deliveryAddress', 'Leveransadress')}{input('deliveryDate', 'Önskad leverans', 'date')}</div>
        <label className="gizmo-purchase-message">Meddelande<textarea rows={2} maxLength={3000} value={draft.message} onChange={event => update({ message: event.target.value })} /></label>
        <div className="gizmo-purchase-options"><h3>Produkter <span>{draft.lines.length}</span></h3><label><input type="checkbox" checked={draft.includePrices} onChange={event => update({ includePrices: event.target.checked })} />Visa inköpspriser exkl. moms</label></div>
        <table className="gizmo-purchase-table" aria-label="Produkter i beställningslistan"><thead><tr><th>Produkt</th><th>Mängd</th><th>Enhet</th>{draft.includePrices && <th>Inköpspris/enhet exkl. moms</th>}<th><span className="sr-only">Ta bort</span></th></tr></thead><tbody>{draft.lines.map((line, index) => <tr key={line.sourceId}>
          <td data-label="Produkt"><div className="gizmo-purchase-product"><input aria-label={`Produkt, rad ${index + 1}`} maxLength={1000} value={line.description} onChange={event => updateLine(line.sourceId, { description: event.target.value })} /><div><input aria-label={`Artikelnummer, rad ${index + 1}`} placeholder="Artikelnummer" maxLength={150} value={line.articleNumber} onChange={event => updateLine(line.sourceId, { articleNumber: event.target.value })} /><input aria-label={`Notering, rad ${index + 1}`} placeholder="Notering" maxLength={1000} value={line.note} onChange={event => updateLine(line.sourceId, { note: event.target.value })} /></div></div></td>
          <td data-label="Mängd"><input aria-label={`Mängd, rad ${index + 1}`} inputMode="decimal" maxLength={20} value={line.quantity} onChange={event => updateLine(line.sourceId, { quantity: event.target.value })} /></td>
          <td data-label="Enhet"><input aria-label={`Enhet, rad ${index + 1}`} maxLength={30} value={line.unit} onChange={event => updateLine(line.sourceId, { unit: event.target.value })} /></td>
          {draft.includePrices && <td data-label="Inköpspris/enhet exkl. moms"><input aria-label={`Inköpspris exkl. moms, rad ${index + 1}`} inputMode="decimal" maxLength={20} value={line.unitCost} onChange={event => updateLine(line.sourceId, { unitCost: event.target.value })} /></td>}
          <td data-label="Ta bort"><button type="button" className="gizmo-purchase-icon" title="Ta bort från beställningslistan" aria-label={`Ta bort rad ${index + 1} från beställningslistan`} onClick={() => update({ lines: draft.lines.filter(row => row.sourceId !== line.sourceId) })}><Trash2 size={17} /></button></td>
        </tr>)}</tbody></table>
      </fieldset>
      {(validation.missingQuantity > 0 || validation.missingPrice > 0) && <p className="gizmo-purchase-warning" role="status">{[validation.missingQuantity ? `${validation.missingQuantity} ${validation.missingQuantity === 1 ? 'produkt saknar' : 'produkter saknar'} mängd` : '', validation.missingPrice ? `${validation.missingPrice} ${validation.missingPrice === 1 ? 'produkt saknar' : 'produkter saknar'} inköpspris` : ''].filter(Boolean).join(' · ')}. Tomma värden lämnas tomma i utskriften.</p>}
      {validation.errors.length > 0 && <div className="gizmo-purchase-warning" role="status">{validation.errors.map(message => <p key={message}>{message}</p>)}</div>}
      {error && <p className="gizmo-purchase-warning" role="alert">{error}</p>}
    </div>
    <footer inert={confirmClose} aria-hidden={confirmClose || undefined}><div className="gizmo-purchase-footer-actions"><button type="button" disabled={printing || confirmClose} onClick={close}>Stäng</button><button type="button" className="gizmo-purchase-print" disabled={printing || confirmClose || validation.errors.length > 0} onClick={() => { if (printing || confirmClose || validation.errors.length) return; setPrinting(true); setError(''); void printPurchaseList(draft).catch(reason => setError(reason instanceof Error ? reason.message : 'Utskriften kunde inte öppnas.')).finally(() => setPrinting(false)) }}>{printing ? <Loader2 size={18} className="animate-spin" /> : <Printer size={18} />}Skriv ut</button></div></footer>
    {confirmClose && <div className="gizmo-purchase-confirm-overlay"><section className="gizmo-purchase-confirm">
      <h3 id={`${id}-close-heading`}>Stäng och kasta ändringarna?</h3>
      <p id={`${id}-close-description`}>Ändringarna i beställningslistan försvinner om du stänger.</p>
      <div className="gizmo-purchase-footer-actions"><button ref={keepEditing} type="button" onClick={() => setConfirmClose(false)}>Fortsätt redigera</button><button type="button" className="gizmo-purchase-discard" onClick={onClose}>Stäng listan</button></div>
    </section></div>}
  </dialog>
}
