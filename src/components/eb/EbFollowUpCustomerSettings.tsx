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
      if (!response.ok || !payload.settings) throw new Error(payload.error ?? 'Kunde inte spara beställarkontakten.')
      setSettings(payload.settings); setEmail(payload.settings.email ?? email); setConfirmed(false); setSaved(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Kunde inte spara beställarkontakten.')
    } finally { setSaving(false) }
  }

  if (settings.purchased) {
    return <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold text-slate-900">Tjänsten är redan beställd</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">Ursprunglig beställare: {settings.purchasedEmail ?? 'Uppgift saknas'}.</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">Beställningen och åtkomsten är bundna till denna adress. Ändringar av entreprenadens kontakt eller uppdragsbekräftelse överför inte ägarskapet. Beställaren kan återfå åtkomst via rapportlänken utan en ny avgift.</p>
    </section>
  }

  return <section className="rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="font-semibold text-slate-900">Beställarkontakt för digital åtgärdsuppföljning</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">Gäller bara denna besiktning och ändrar inte utlåtandet. En person kan beställa tjänsten och måste verifiera sin e-postadress innan köp. Övriga rapportmottagare får läslänken.</p>
    {settings.source === 'missing' && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">En aktuell godkänd uppdragsbekräftelse med giltig kundadress saknas. Bekräfta en beställarkontakt nedan för att tillåta nya beställningar. En förifylld projektadress ger inte behörighet förrän du bekräftar den.</p>}
    {settings.source === 'conflict' && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Adresserna i uppdragsbekräftelsen och entreprenaden skiljer sig. Nya beställningar är spärrade tills du uttryckligen bekräftar en beställarkontakt för denna besiktning.</p>}
    {settings.source === 'assignment' && <p className="mt-3 text-sm text-slate-600">Nuvarande beställarkontakt hämtas från den aktuella godkända uppdragsbekräftelsen: {settings.email}. Bekräfta nedan om kontakten ska sparas särskilt för denna besiktning.</p>}
    {settings.source === 'confirmed' && <p className="mt-3 text-sm text-slate-600">Bekräftad kontakt: {settings.email}. Senare ändringar i entreprenaden eller uppdragsbekräftelsen ändrar inte denna kontakt.</p>}
    <dl className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
      <div><dt>Godkänd uppdragsbekräftelse</dt><dd className="font-medium text-slate-900">{settings.assignmentEmail ?? 'Saknas'}</dd></div>
      <div><dt>Entreprenadens kontakt (endast förslag)</dt><dd className="font-medium text-slate-900">{settings.projectEmail ?? 'Saknas'}</dd></div>
    </dl>
    <form onSubmit={save} className="mt-5 space-y-4">
      <label className="block text-sm font-medium text-slate-800">Beställarkontaktens e-postadress
        <input required type="email" maxLength={254} value={email} disabled={saving} onChange={event => { setEmail(event.target.value); setConfirmed(false); setSaved(false) }} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" />
      </label>
      <label className="flex gap-2 text-sm leading-6 text-slate-700">
        <input type="checkbox" required checked={confirmed} disabled={saving} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />
        Jag bekräftar att denna adress är beställarkontakt för just denna besiktning och får beställa digital åtgärdsuppföljning.
      </label>
      <button type="submit" disabled={!confirmed || saving} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Sparar…' : 'Bekräfta beställarkontakt'}</button>
      {saved && <p role="status" className="text-sm text-emerald-800">Beställarkontakten är sparad för denna besiktning. Utlåtandet är oförändrat.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </form>
    {settings.confirmedAt && <p className="mt-4 text-xs text-slate-500">Senast bekräftad: {new Date(settings.confirmedAt).toLocaleString('sv-SE')}. Tidpunkt och ansvarig användare sparas i ändringsloggen.</p>}
  </section>
}
