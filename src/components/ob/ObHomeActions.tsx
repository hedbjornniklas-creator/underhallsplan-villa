'use client'

import Link from 'next/link'
import { useId, useRef, useState, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardPlus, FilePlus2, Send, X } from 'lucide-react'
import { useObOrganization, useObOrganizationSwitchGuard, withObOrganization } from './ObOrganizationBoundary'
import { useToast } from '@/components/ui/AppToastProvider'
import type { ObInspectionProfileKey } from '@/lib/ob/inspectionProfile'
import type { ObObjectType } from '@/lib/ob/objectType'
import './ob-home.css'

function CreateInspectionButton() {
  const router = useRouter()
  const toast = useToast()
  const { id: orgId } = useObOrganization()
  const [creating, setCreating] = useState(false)
  useObOrganizationSwitchGuard(false, creating)

  const handleCreateFromScratch = async () => {
    if (creating) return
    setCreating(true)
    try {
      const response = await fetch(withObOrganization('/api/ob/inspections', orgId), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      })
      const body = await response.json()
      if (!response.ok || !body.propertyId || !body.inspectionId || body.orgId !== orgId) {
        throw new Error(body.error || 'Kunde inte skapa besiktningen i vald organisation.')
      }
      router.push(withObOrganization(`/properties/${body.propertyId}/ob/${body.inspectionId}`, orgId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kunde inte skapa ny besiktning. Försök igen.')
    } finally { setCreating(false) }
  }

  return <button type="button" className="obh-primary" disabled={creating} onClick={() => void handleCreateFromScratch()}>
    <ClipboardPlus size={18} aria-hidden="true" />
    <span>{creating ? 'Skapar besiktning...' : 'Skapa ny besiktning'}</span>
  </button>
}

function QuickSend({ onSent, dialogRef }: { onSent: () => void; dialogRef: RefObject<HTMLDialogElement | null> }) {
  const organization = useObOrganization()
  type QuickOrdererRole = ObInspectionProfileKey | ''

  const titleId = useId()
  const [email, setEmail] = useState('')
  const [ordererRole, setOrdererRole] = useState<QuickOrdererRole>('')
  const [objectType, setObjectType] = useState<ObObjectType | ''>('')
  const [preferredDate, setPreferredDate] = useState('')
  const [preferredTime, setPreferredTime] = useState('')
  const [priceAmount, setPriceAmount] = useState('')
  const [statusCancellationFee, setStatusCancellationFee] = useState('')
  const [scopeDescription, setScopeDescription] = useState('')
  const [isSending, setIsSending] = useState(false)
  const toast = useToast()
  const [createdLink, setCreatedLink] = useState<string | null>(null)
  useObOrganizationSwitchGuard(Boolean(email || ordererRole || preferredDate || preferredTime || priceAmount || scopeDescription || statusCancellationFee || objectType), isSending)

  const handleQuickSend = async () => {
    if (isSending) return
    const normalized = email.trim().toLowerCase()
    const normalizedPrice = priceAmount.trim()

    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      toast.error('Ange en giltig mejladress.')
      return
    }

    if (!ordererRole) {
      toast.error('Välj Säljare, Köpare, Lägenhet eller Statusbesiktning.')
      return
    }
    if (ordererRole === 'status' && !objectType) {
      toast.error('Välj om statusbesiktningen avser fastighet eller lägenhet.')
      return
    }

    if (!normalizedPrice) {
      toast.error('Pris är obligatoriskt innan utskick.')
      return
    }

    const parsedPrice = Number(normalizedPrice.replace(',', '.'))
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      toast.error('Ange ett giltigt pris.')
      return
    }
    const parsedCancellationFee = Number(statusCancellationFee.trim().replace(',', '.'))
    if (ordererRole === 'status' && (!statusCancellationFee.trim() || !Number.isFinite(parsedCancellationFee) || parsedCancellationFee < 0)) {
      toast.error('Ange en avbokningsavgift på 0 kr eller mer för statusbesiktningen.')
      return
    }
    if (ordererRole === 'status' && !scopeDescription.trim()) {
      toast.error('Ange statusbesiktningens omfattning.')
      return
    }

    try {
      setIsSending(true)
      setCreatedLink(null)

      const response = await fetch(withObOrganization('/api/ob/assignments/quick-send', organization.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerEmail: normalized,
          assignmentType: ordererRole === 'status' ? 'STATUS' : 'OB',
          ordererRole,
          preferredDate: preferredDate.trim(),
          preferredTime: preferredTime.trim(),
          priceAmount: normalizedPrice,
          ...(ordererRole === 'status' ? { statusCancellationFee: parsedCancellationFee } : {}),
          ...(ordererRole === 'status' ? { scopeDescription: scopeDescription.trim() } : {}),
          ...(ordererRole === 'status' ? { objectType } : {}),
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        acceptUrl?: string
      }

      if (!response.ok) {
        if (payload.acceptUrl) {
          setCreatedLink(payload.acceptUrl)
          toast.error('Bekräftelsen skapades, men mejlet kunde inte skickas.')
          onSent()
        } else {
          toast.error(payload.error ?? 'Kunde inte skicka uppdragsbekräftelse.')
        }
        return
      }

      setEmail('')
      setOrdererRole('')
      setPreferredDate('')
      setPreferredTime('')
      setPriceAmount('')
      setStatusCancellationFee('')
      setScopeDescription('')
      setObjectType('')
      dialogRef.current?.close()
      toast.success('Uppdragsbekräftelse skickad.')
      onSent()
    } catch {
      toast.error('Kunde inte skicka uppdragsbekräftelse.')
    } finally {
      setIsSending(false)
    }
  }


  return <dialog ref={dialogRef} className="obh-dialog" aria-labelledby={titleId}
    onCancel={event => { if (isSending) event.preventDefault() }}>
    <header className="obh-dialog-heading">
      <h2 id={titleId}>Snabbskicka uppdragsbekräftelse</h2>
      <button type="button" className="obh-dialog-close" aria-label="Stäng" title="Stäng"
        disabled={isSending} onClick={() => dialogRef.current?.close()}><X size={20} aria-hidden="true" /></button>
    </header>
    <form className="obh-quick-form" aria-busy={isSending} onSubmit={event => { event.preventDefault(); void handleQuickSend() }}>
    <p>Uppdraget skapas för <strong>{organization.name || 'vald organisation'}</strong>.</p>
    <fieldset disabled={isSending}>
      <legend>Typ av uppdrag</legend>
      <div className="obh-roles">
        {([{ value: 'seller', label: 'Säljare' }, { value: 'buyer', label: 'Köpare' }, { value: 'apartment', label: 'Lägenhet' }, { value: 'status', label: 'Statusbesiktning' }] as const).map(role =>
          <label key={role.value}>
            <input type="radio" name="quick-orderer" value={role.value} checked={ordererRole === role.value}
              onChange={() => setOrdererRole(role.value)} required />
            <span>{role.label}</span>
          </label>)}
      </div>
    </fieldset>
    {ordererRole === 'status' && <fieldset disabled={isSending}>
      <legend>Objekttyp</legend>
      <div className="obh-roles">
        {([{ value: 'property', label: 'Fastighet' }, { value: 'apartment', label: 'Lägenhet' }] as const).map(option => <label key={option.value}>
          <input type="radio" name="quick-status-object-type" value={option.value} checked={objectType === option.value}
            onChange={() => setObjectType(option.value)} required />
          <span>{option.label}</span>
        </label>)}
      </div>
    </fieldset>}
    <label className="obh-email">Kundens e-post
      <input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}
        placeholder="kund@epost.se" required disabled={isSending} />
    </label>
    <label>Datum
      <input type="date" value={preferredDate} onChange={event => setPreferredDate(event.target.value)} disabled={isSending} />
    </label>
    <label>Tid
      <input type="time" value={preferredTime} onChange={event => setPreferredTime(event.target.value)} disabled={isSending} />
    </label>
    <label className="obh-price">Pris (SEK)
      <input type="text" inputMode="decimal" value={priceAmount} onChange={event => setPriceAmount(event.target.value)}
        placeholder="0" required disabled={isSending} />
    </label>
    {ordererRole === 'status' && <label>Avbokningsavgift (SEK)
      <input type="text" inputMode="decimal" value={statusCancellationFee}
        onChange={event => setStatusCancellationFee(event.target.value)}
        placeholder="Ange belopp, även 0" required disabled={isSending} />
    </label>}
    {ordererRole === 'status' && <label>Besiktningens omfattning
      <input type="text" value={scopeDescription} onChange={event => setScopeDescription(event.target.value)}
        placeholder="Till exempel badrum eller hela byggnaden" required disabled={isSending} />
    </label>}
    {createdLink && <p className="obh-feedback">Bekräftelsen är skapad. <a href={createdLink} target="_blank" rel="noopener noreferrer">Öppna kundlänk</a></p>}
    <div className="obh-dialog-actions">
      <button type="button" disabled={isSending} onClick={() => dialogRef.current?.close()}>Avbryt</button>
      <button type="submit" className="obh-primary" disabled={isSending}>
        <Send size={18} aria-hidden="true" /><span>{isSending ? 'Skickar...' : 'Skicka bekräftelse'}</span>
      </button>
    </div>
    </form>
  </dialog>
}

export default function ObHomeActions({ onSent }: { onSent: () => void }) {
  const { id: orgId } = useObOrganization()
  const dialogRef = useRef<HTMLDialogElement>(null)
  return <section className="obh" aria-label="Skapa ÖB-uppdrag">
    <div className="obh-actions">
      <CreateInspectionButton />
      <Link href={withObOrganization('/ob/assignments/new', orgId)}><FilePlus2 size={18} aria-hidden="true" /><span>Skapa uppdragsbekräftelse</span></Link>
      <button type="button" className="obh-quick-trigger" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
        <Send size={18} aria-hidden="true" /><span>Snabbskicka UB</span>
      </button>
      <nav aria-label="Separata listor" className="obh-list-links">
        <Link href={withObOrganization('/ob/assignments', orgId)}>Uppdragsbekräftelser</Link>
        <Link href={withObOrganization('/inspections', orgId)}>Besiktningar</Link>
      </nav>
    </div>
    <QuickSend onSent={onSent} dialogRef={dialogRef} />
  </section>
}
