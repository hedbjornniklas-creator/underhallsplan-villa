'use client'

import { useState } from 'react'
import type { EbFollowUpCustomerSettings as CustomerSettings } from '@/lib/eb/followUpCustomer'

export default function EbFollowUpCustomerSettings({
  initialSettings, endpoint,
}: { initialSettings: CustomerSettings; endpoint: string }) {
  const [settings, setSettings] = useState(initialSettings)
  const [email, setEmail] = useState(initialSettings.email ?? initialSettings.assignmentEmail ?? initialSettings.projectEmail ?? '')
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!confirmed || saving) return
    setSaving(true); setError(''); setSaved(false)
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, confirmed: true }),
      })
      const payload = await response.json() as { settings?: CustomerSettings; error?: string }
      if (!response.ok || !payload.settings) throw new Error(payload.error ?? 'Kunde inte spara beställaradressen.')
      setSettings(payload.settings); setEmail(payload.settings.email ?? email); setConfirmed(false); setSaved(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Kunde inte spara beställaradressen.')
    } finally { setSaving(false) }
  }

  if (settings.purchased) {
    return <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold text-slate-900">Beställaradressen är knuten till ett köp</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">Köpare av digital åtgärdsuppföljning: {settings.purchasedEmail ?? 'Uppgift saknas'}.</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">Adressen kan inte ändras här efter ett köp. Köpet och åtkomsten ligger kvar hos den ursprungliga köparen, även om uppgifter i entreprenaden, uppdragsbekräftelsen eller sändlistan ändras. Köparen kan återfå åtkomst via rapportlänken utan att beställa igen.</p>
    </section>
  }

  return <section className="rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="font-semibold text-slate-900">Ändra beställaradress</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">Beställarens adress sparas automatiskt vid den första leveransen från Fastställ och leverera. Det fungerar även utan uppdragsbekräftelse. Använd denna sida om adressen behöver rättas för just denna besiktning.</p>
    <p className="mt-2 text-sm leading-6 text-slate-600">Ange den som har beställt besiktningen. Övriga mottagare anges i sändlistan och blir inte beställare genom att få utlåtandet. Ändringen här påverkar inte utlåtandets innehåll.</p>
    {settings.source === 'missing' && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">Ingen beställaradress är sparad för besiktningen ännu. Ange den vid leveransen, eller spara rätt adress här.</p>}
    {settings.source === 'conflict' && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Uppdragsbekräftelsen och entreprenaden innehåller olika adresser. Kontrollera vem som har beställt besiktningen och ange rätt adress vid leveransen, eller rätta den här.</p>}
    {settings.source === 'assignment' && <p className="mt-3 text-sm text-slate-600">Beställarens adress hämtas från den godkända uppdragsbekräftelsen: {settings.email}. Du behöver inte spara den igen om den är rätt.</p>}
    {settings.source === 'confirmed' && <p className="mt-3 text-sm text-slate-600">Sparad beställaradress: {settings.email}. Senare leveranser eller ändringar i entreprenaden och uppdragsbekräftelsen byter inte beställare automatiskt.</p>}
    <dl className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
      <div><dt>Godkänd uppdragsbekräftelse</dt><dd className="font-medium text-slate-900">{settings.assignmentEmail ?? 'Saknas'}</dd></div>
      <div><dt>Beställare i entreprenadens uppgifter</dt><dd className="font-medium text-slate-900">{settings.projectEmail ?? 'Saknas'}</dd></div>
    </dl>
    <form onSubmit={save} className="mt-5 space-y-4">
      <label className="block text-sm font-medium text-slate-800">Beställarens e-postadress
        <input required type="email" maxLength={254} value={email} disabled={saving} onChange={event => { setEmail(event.target.value); setConfirmed(false); setSaved(false) }} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" />
      </label>
      <label className="flex gap-2 text-sm leading-6 text-slate-700">
        <input type="checkbox" required checked={confirmed} disabled={saving} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />
        Jag har kontrollerat att e-postadressen tillhör beställaren av denna besiktning.
      </label>
      <button type="submit" disabled={!confirmed || saving} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Sparar…' : 'Spara beställaradress'}</button>
      {saved && <p role="status" className="text-sm text-emerald-800">Beställaradressen är sparad för denna besiktning. Utlåtandet är oförändrat.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </form>
    {settings.confirmedAt && <p className="mt-4 text-xs text-slate-500">Senast bekräftad: {new Date(settings.confirmedAt).toLocaleString('sv-SE')}. Tidpunkt och ansvarig användare sparas i ändringsloggen.</p>}
  </section>
}
