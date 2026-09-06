'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import PublicFrame from '@/components/public/PublicFrame'

type FormState = {
  name: string
  orgNumber: string
  address: string
  contactName: string
  contactEmail: string
  contactPhone: string
  message: string
}

type SubmitResult = {
  id: string
  status: 'pending'
  receipt: {
    emailSent: boolean
    emailError: string | null
  }
}

const INITIAL_FORM: FormState = {
  name: '',
  orgNumber: '',
  address: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  message: '',
}

const ORG_NUMBER_PATTERN = /^\d{6}-\d{4}$/

function formatOrgNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 6) return digits
  return `${digits.slice(0, 6)}-${digits.slice(6)}`
}

export default function RenoAppRequestAccessPage() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null)
  const successRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (success) successRef.current?.focus()
  }, [success])

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formattedOrgNumber = formatOrgNumber(form.orgNumber)

    if (!ORG_NUMBER_PATTERN.test(formattedOrgNumber)) {
      setError('Ange organisationsnummer i formatet XXXXXX-XXXX.')
      setSuccess(false)
      return
    }

    setSubmitting(true)
    setError(null)
    setSuccess(false)
    setSubmitResult(null)

    try {
      const response = await fetch('/api/renoapp/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          orgNumber: formattedOrgNumber,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as SubmitResult & { error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte skicka intresseanmälan.')
      }

      setSuccess(true)
      setSubmitResult(payload)
      setForm(INITIAL_FORM)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte skicka intresseanmälan.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PublicFrame activeProduct="renoapp">
      <div className="public-container public-interest">
        <section className="public-page-intro">
          <span className="public-eyebrow">RenoApp för er förening</span>
          <h1>Vill ni börja använda RenoApp?</h1>
          <p>Berätta vilken förening ni företräder och vem vi kan kontakta. När er förfrågan har godkänts får styrelsen en inbjudan.</p>
          <Link href="/renoapp" className="public-text-link">Läs mer om RenoApp →</Link>
          <div className="public-aside-help"><h2>Vill du ansöka om renovering?</h2><p>Den här sidan är för föreningar som vill börja använda tjänsten. Som boende går du till <Link href="/renoapp/apply">föreningens renoveringsansökan</Link>.</p></div>
        </section>
        <section className="public-form-section" aria-labelledby="interest-title">
          <h2 id="interest-title">Anmäl föreningens intresse</h2>
          {success ? (
            <div className="public-notice public-notice-success" role="status">
              <h3 ref={successRef} tabIndex={-1}>Tack, vi har tagit emot er intresseanmälan.</h3>
              <p>Er förfrågan granskas innan styrelsen får tillgång till RenoApp. Ni behöver inte skicka den igen.</p>
              {submitResult?.receipt.emailSent ? <p>En bekräftelse har skickats till kontaktpersonens e-postadress.</p> : <p>Vi kunde inte skicka en mejlbekräftelse, men intresseanmälan är sparad.</p>}
              <Link href="/renoapp" className="public-text-link">Tillbaka till RenoApp →</Link>
            </div>
          ) : (
            <form className="public-form" onSubmit={handleSubmit} aria-busy={submitting}>
              <p className="public-field-hint">Alla fält är obligatoriska om de inte är märkta valfritt.</p>
              <label>Föreningens namn<input name="organization" autoComplete="organization" value={form.name} onChange={(event) => updateField('name', event.target.value)} required /></label>
              <label>Organisationsnummer<input name="orgNumber" value={form.orgNumber} onChange={(event) => updateField('orgNumber', formatOrgNumber(event.target.value))} inputMode="numeric" autoComplete="off" maxLength={11} pattern="^\d{6}-\d{4}$" title="Ange organisationsnummer i formatet XXXXXX-XXXX." aria-describedby="org-number-hint" required /><span className="public-field-hint" id="org-number-hint">10 siffror, till exempel 769600-1234.</span></label>
              <label>Föreningens adress <span className="public-optional">(valfritt)</span><input name="street-address" autoComplete="street-address" value={form.address} onChange={(event) => updateField('address', event.target.value)} /></label>
              <label>Kontaktperson<input name="name" autoComplete="name" value={form.contactName} onChange={(event) => updateField('contactName', event.target.value)} required /></label>
              <label>E-postadress<input name="email" autoComplete="email" value={form.contactEmail} onChange={(event) => updateField('contactEmail', event.target.value)} type="email" required /></label>
              <label>Telefonnummer <span className="public-optional">(valfritt)</span><input name="tel" autoComplete="tel" value={form.contactPhone} onChange={(event) => updateField('contactPhone', event.target.value)} type="tel" /></label>
              <label>Frågor eller övrig information <span className="public-optional">(valfritt)</span><textarea name="message" rows={4} value={form.message} onChange={(event) => updateField('message', event.target.value)} /></label>
              {error ? <div className="public-notice public-notice-error" role="alert">{error}</div> : null}
              <button type="submit" disabled={submitting} className="public-button">{submitting ? 'Skickar…' : 'Skicka intresseanmälan'}</button>
            </form>
          )}
        </section>
      </div>
    </PublicFrame>
  )
}
