'use client'

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import Link from 'next/link'
import ActionButton from '@/components/ui/ActionButton'
import { INTEREST_LIMITS, validateInterestSubmission, type InterestField, type InterestFields } from '@/lib/besiktapp/interestContracts'

const initialFields: InterestFields = { name: '', email: '', company: '', phone: '', message: '' }
const labels: Record<InterestField, string> = { name: 'Ditt namn', email: 'E-post', company: 'Företag', phone: 'Telefon', message: 'Vad vill du veta om BesiktApp?' }
const autocomplete: Record<InterestField, string> = { name: 'name', email: 'email', company: 'organization', phone: 'tel', message: 'off' }

export default function BesiktInterestForm() {
  const [fields, setFields] = useState(initialFields)
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<{ message: string; field?: InterestField } | null>(null)
  const inFlight = useRef(false)
  const submissionId = useRef<string | null>(null)
  const successRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (sent) successRef.current?.focus() }, [sent])
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || sent) return
    submissionId.current ??= crypto.randomUUID()
    const validated = validateInterestSubmission({ ...fields, website, submissionId: submissionId.current })
    if (!validated.ok) { setError({ message: validated.message, field: validated.field }); return }
    inFlight.current = true
    setBusy(true)
    setError(null)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25_000)
    try {
      const response = await fetch('/api/besiktapp/interest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validated.value), signal: controller.signal })
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; field?: string } | null
      if (!response.ok || data?.ok !== true) {
        const field = data?.field && Object.hasOwn(INTEREST_LIMITS, data.field) ? data.field as InterestField : undefined
        setError({ message: data?.error || 'Anmälan kunde inte skickas. Dina uppgifter finns kvar. Försök igen.', field })
        return
      }
      setSent(true)
    } catch {
      setError({ message: 'Vi kunde inte bekräfta att anmälan skickades. Dina uppgifter finns kvar. Kontrollera anslutningen och försök igen.' })
    } finally {
      clearTimeout(timeout)
      inFlight.current = false
      setBusy(false)
    }
  }

  if (sent) return (
    <div className="public-notice public-notice-success" role="status">
      <h2 ref={successRef} tabIndex={-1}>Din intresseanmälan har skickats.</h2>
      <p>Tack! Vi kontaktar dig på den e-postadress du angav för att prata vidare om BesiktApp.</p>
      <Link href="/besiktapp" className="public-text-link">Tillbaka till BesiktApp</Link>
    </div>
  )

  return (
    <form className="public-form" onSubmit={submit} aria-label="Intresseanmälan för BesiktApp" aria-busy={busy}>
      <p className="public-field-hint">Namn och e-post behövs. Övriga uppgifter är valfria.</p>
      {(Object.keys(INTEREST_LIMITS) as InterestField[]).map(field => {
        const optional = field !== 'name' && field !== 'email'
        const shared = {
          id: `interest-${field}`, name: field, value: fields[field], maxLength: INTEREST_LIMITS[field],
          autoComplete: autocomplete[field], required: !optional, readOnly: busy,
          onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields(previous => ({ ...previous, [field]: event.target.value })),
          'aria-invalid': error?.field === field || undefined,
          'aria-describedby': error?.field === field ? 'interest-error' : undefined,
        }
        return <label key={field} htmlFor={shared.id}>{labels[field]}{optional && <span className="public-optional"> (valfritt)</span>}{field === 'message' ? <textarea {...shared} rows={4} /> : <input {...shared} type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'} />}</label>
      })}
      <div className="public-honeypot" aria-hidden="true"><label>Webbplats<input name="website" tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} /></label></div>
      <p className="public-field-hint">Uppgifterna skickas till oss via mejl för att vi ska kunna kontakta dig om BesiktApp. Ta inte med känsliga uppgifter eller information om dina kunder.</p>
      {error && <div id="interest-error" className="public-notice public-notice-error" role="alert" tabIndex={-1} ref={errorRef}>{error.message}</div>}
      <ActionButton type="submit" busy={busy} busyLabel="Skickar…" className="public-button">Skicka intresseanmälan</ActionButton>
    </form>
  )
}
