'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isProfileCertificationDate, profileAddonPrice,
  type AddonEntry, type AddonValues, type CertificationEntry, type CertificationValues,
  type ProfileExtraKind, type ProfileExtrasWorkspace,
} from '@/lib/organizations/profileExtrasTypes'

type Identity = { orgId: string; profileId: string }
type Entry = CertificationEntry | AddonEntry
type Values = CertificationValues | AddonValues
const ENDPOINT = '/api/organizations/member-profile/extras'
const SWITCH_EVENT = 'hushub:before-organization-switch'
const INPUT = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 disabled:bg-slate-100'

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validEntry(value: unknown, kind: ProfileExtraKind): value is Entry {
  if (!record(value) || typeof value.id !== 'string' || typeof value.key !== 'string'
    || typeof value.name !== 'string' || typeof value.exists !== 'boolean'
    || !(value.description === null || typeof value.description === 'string')
    || !record(value.value) || typeof value.value.enabled !== 'boolean') return false
  if (kind === 'addon') return typeof value.currency === 'string' && typeof value.value.price === 'string'
  return ['certification', 'membership'].includes(String(value.category))
    && typeof value.requiresNumber === 'boolean' && typeof value.requiresValidTo === 'boolean'
    && (value.numberLabel === null || typeof value.numberLabel === 'string')
    && (value.validToLabel === null || typeof value.validToLabel === 'string')
    && typeof value.value.number === 'string' && typeof value.value.date === 'string'
}

function checkedWorkspace(body: unknown, identity: Identity): ProfileExtrasWorkspace {
  const workspace = record(body) ? body.workspace : null
  if (!record(workspace) || workspace.orgId !== identity.orgId || workspace.profileId !== identity.profileId
    || !Array.isArray(workspace.certifications) || !Array.isArray(workspace.addons)
    || !workspace.certifications.every(entry => validEntry(entry, 'certification'))
    || !workspace.addons.every(entry => validEntry(entry, 'addon'))) throw new Error('INVALID_RESPONSE')
  for (const entries of [workspace.certifications, workspace.addons]) {
    if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('INVALID_RESPONSE')
  }
  return workspace as ProfileExtrasWorkspace
}

function sameValues(left: Values, right: Values): boolean {
  if (left.enabled !== right.enabled) return false
  if ('price' in left && 'price' in right) return left.price === right.price
  return 'number' in left && 'number' in right && left.number === right.number && left.date === right.date
}

function normalized(values: Values): Values {
  if ('price' in values) {
    const price = profileAddonPrice(values.price)
    return { enabled: values.enabled, price: price === null ? '' : String(price) }
  }
  return { enabled: values.enabled, number: values.number.trim(), date: values.date.trim() }
}

function validation(entry: Entry, values: Values): string | null {
  if ('price' in values) {
    try { profileAddonPrice(values.price) } catch { return 'Ange ett giltigt pris från 0 till 9 999 999 999,99.' }
    return null
  }
  const certification = entry as CertificationEntry
  if (values.enabled && certification.requiresNumber && !values.number.trim()) return `Fyll i ${certification.numberLabel || 'certifikatnummer'}.`
  if (values.enabled && certification.requiresValidTo && !values.date.trim()) return `Fyll i ${certification.validToLabel || 'giltighetsdatum'}.`
  if (values.date && !isProfileCertificationDate(values.date)) return 'Ange ett giltigt datum.'
  return null
}

// Only replace fields that have not changed while the request was in flight.
function mergeValues(current: Values, submitted: Values, saved: Values): Values {
  const enabled = current.enabled === submitted.enabled ? saved.enabled : current.enabled
  if ('price' in current && 'price' in submitted && 'price' in saved) {
    return { enabled, price: current.price === submitted.price ? saved.price : current.price }
  }
  if ('number' in current && 'number' in submitted && 'number' in saved) {
    return {
      enabled, number: current.number === submitted.number ? saved.number : current.number,
      date: current.date === submitted.date ? saved.date : current.date,
    }
  }
  return current
}

export default function OrganizationProfileExtras(identity: Identity) {
  return <ExtrasWorkspace key={`${identity.orgId}:${identity.profileId}`} {...identity} />
}

function ExtrasWorkspace({ orgId, profileId }: Identity) {
  const [workspace, setWorkspace] = useState<ProfileExtrasWorkspace | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setError(false)
    void (async () => {
      try {
        const response = await fetch(`${ENDPOINT}?orgId=${encodeURIComponent(orgId)}`, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('LOAD_FAILED')
        const loaded = checkedWorkspace(await response.json(), { orgId, profileId })
        if (active) setWorkspace(loaded)
      } catch { if (active) setError(true) }
    })()
    return () => { active = false; controller.abort() }
  }, [orgId, profileId, attempt])

  if (!workspace) return <section className="rounded-2xl border border-slate-200 bg-white p-6">
    <h2 className="text-xl font-semibold">Certifieringar och tilläggsuppdrag</h2>
    {error ? <><p role="alert" className="mt-3 text-red-700">Uppgifterna kunde inte hämtas. Inga ändringar har gjorts.</p><button type="button" className="mt-3 underline" onClick={() => setAttempt(value => value + 1)}>Försök igen</button></>
      : <p role="status" className="mt-3 text-slate-600">Hämtar dina uppgifter…</p>}
  </section>

  return <div className="space-y-5">
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-xl font-semibold text-slate-950">Certifieringar och medlemskap</h2>
      <p className="mt-2 text-slate-600">Välj dina certifieringar och medlemskap i den här organisationen. Ändringar sparas automatiskt.</p>
      <div className="mt-5 space-y-4">
        {workspace.certifications.map(entry => <ExtraRow key={`certification:${entry.id}`} kind="certification" initialEntry={entry} orgId={orgId} profileId={profileId} />)}
        {!workspace.certifications.length && <p className="text-slate-600">Inga certifieringar eller medlemskap finns att välja just nu.</p>}
      </div>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-xl font-semibold text-slate-950">Tilläggsuppdrag</h2>
      <p className="mt-2 text-slate-600">Välj de tillägg du erbjuder och ditt pris i den här organisationen. Ändringar sparas automatiskt.</p>
      <div className="mt-5 space-y-4">
        {workspace.addons.map(entry => <ExtraRow key={`addon:${entry.id}`} kind="addon" initialEntry={entry} orgId={orgId} profileId={profileId} />)}
        {!workspace.addons.length && <p className="text-slate-600">Inga tilläggsuppdrag finns att välja just nu.</p>}
      </div>
    </section>
  </div>
}

function ExtraRow({ kind, initialEntry, orgId, profileId }: Identity & { kind: ProfileExtraKind; initialEntry: Entry }) {
  const [entry, setEntry] = useState(initialEntry)
  const [form, setForm] = useState<Values>(initialEntry.value)
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const operation = useRef(false)
  const lifetime = useRef(0)
  const dirty = !sameValues(form, entry.value)
  const invalid = validation(entry, form)
  const id = `${kind}-${entry.id}`

  useEffect(() => {
    lifetime.current += 1
    return () => { lifetime.current += 1 }
  }, [])

  useEffect(() => {
    let approved = false
    let timer: number | undefined
    const beforeSwitch = (event: Event) => {
      if (operation.current) { event.preventDefault(); return }
      if (event.defaultPrevented) return
      if (!dirty && !error) return
      const detail = (event as CustomEvent<{ confirmed?: boolean }>).detail
      if (approved && detail) detail.confirmed = true
      if ((dirty || error) && !approved && !detail?.confirmed) {
        if (!window.confirm('Profiländringarna är inte sparade ännu. Vill du lämna dem?')) { event.preventDefault(); return }
        if (detail) detail.confirmed = true
      }
      approved = true
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { approved = false }, 0)
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || error || operation.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener(SWITCH_EVENT, beforeSwitch)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener(SWITCH_EVENT, beforeSwitch)
      window.removeEventListener('beforeunload', beforeUnload)
      window.clearTimeout(timer)
    }
  }, [dirty, error])

  const save = useCallback(async () => {
    if (operation.current || !dirty || invalid || conflict) return
    operation.current = true
    setSaving(true)
    setError(null)
    const generation = lifetime.current
    const submitted = form
    try {
      const response = await fetch(ENDPOINT, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, kind, id: entry.id, expected: entry.exists ? entry.value : null, values: submitted }),
      })
      if (generation !== lifetime.current) return
      if (response.status === 409) {
        setConflict(true)
        throw new Error('CONFLICT')
      }
      if (!response.ok) throw new Error('SAVE_FAILED')
      const body: unknown = await response.json()
      if (generation !== lifetime.current) return
      if (!record(body) || body.orgId !== orgId || body.profileId !== profileId || body.kind !== kind
        || !validEntry(body.entry, kind) || body.entry.id !== entry.id || !body.entry.exists
        || !sameValues(body.entry.value, normalized(submitted))) throw new Error('INVALID_RESPONSE')
      const saved = body.entry.value
      setEntry(previous => ({ ...previous, exists: true, value: saved } as Entry))
      setForm(current => mergeValues(current, submitted, saved))
    } catch (cause) {
      if (generation === lifetime.current) setError(cause instanceof Error && cause.message === 'CONFLICT'
        ? 'Uppgiften har ändrats i ett annat fönster. Hämta den sparade uppgiften innan du fortsätter.'
        : 'Kunde inte spara. Dina ändringar finns kvar här. Försök igen.')
    } finally {
      if (generation === lifetime.current) { operation.current = false; setSaving(false) }
    }
  }, [dirty, invalid, conflict, form, orgId, profileId, kind, entry])

  useEffect(() => {
    if (!dirty || invalid || saving || reloading || error || conflict) return
    const timer = window.setTimeout(() => { void save() }, 700)
    return () => window.clearTimeout(timer)
  }, [dirty, invalid, saving, reloading, error, conflict, save])

  async function reload() {
    if (operation.current || !window.confirm(`Hämta sparade uppgifter för ${entry.name}? Dina osparade ändringar för just den här raden ersätts.`)) return
    operation.current = true
    setReloading(true)
    const generation = lifetime.current
    try {
      const response = await fetch(`${ENDPOINT}?orgId=${encodeURIComponent(orgId)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('LOAD_FAILED')
      const loaded = checkedWorkspace(await response.json(), { orgId, profileId })
      if (generation !== lifetime.current) return
      const saved = (kind === 'certification' ? loaded.certifications : loaded.addons).find(item => item.id === entry.id)
      if (!saved) throw new Error('LOAD_FAILED')
      setEntry(saved)
      setForm(saved.value)
      setError(null)
      setConflict(false)
    } catch {
      if (generation === lifetime.current) setError('Kunde inte hämta sparade uppgifter. Dina ändringar finns kvar här.')
    } finally {
      if (generation === lifetime.current) { operation.current = false; setReloading(false) }
    }
  }

  const certification = kind === 'certification' ? entry as CertificationEntry : null
  const certificationForm = form as CertificationValues
  const addon = kind === 'addon' ? entry as AddonEntry : null
  const addonForm = form as AddonValues
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" aria-labelledby={`${id}-name`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 id={`${id}-name`} className="font-semibold text-slate-900">{entry.name}</h3>
        {certification && <p className="mt-1 text-xs text-slate-500">{certification.category === 'membership' ? 'Medlemskap' : 'Certifiering'}</p>}
        {entry.description && <p className="mt-1 text-sm text-slate-600">{entry.description}</p>}
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <input type="checkbox" checked={form.enabled} disabled={reloading}
          aria-label={`${addon ? 'Erbjud till kunder' : 'Använd i min profil'}: ${entry.name}`}
          onChange={event => setForm(current => ({ ...current, enabled: event.target.checked }))} />
        {addon ? 'Erbjud till kunder' : 'Använd i min profil'}
      </label>
    </div>
    {certification && <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {(certification.requiresNumber || certificationForm.number) && <div>
        <label htmlFor={`${id}-number`} className="text-sm text-slate-700">{certification.numberLabel || 'Certifikatnummer'}{form.enabled && certification.requiresNumber ? ' *' : ''}</label>
        <input id={`${id}-number`} className={INPUT} value={certificationForm.number} disabled={reloading}
          aria-required={form.enabled && certification.requiresNumber} aria-describedby={`${id}-status`}
          onChange={event => setForm(current => ({ ...current as CertificationValues, number: event.target.value }))} />
      </div>}
      {(certification.requiresValidTo || certificationForm.date) && <div>
        <label htmlFor={`${id}-date`} className="text-sm text-slate-700">{certification.validToLabel || 'Giltig till'}{form.enabled && certification.requiresValidTo ? ' *' : ''}</label>
        <input id={`${id}-date`} type="date" className={INPUT} value={certificationForm.date} disabled={reloading}
          aria-required={form.enabled && certification.requiresValidTo} aria-describedby={`${id}-status`}
          onChange={event => setForm(current => ({ ...current as CertificationValues, date: event.target.value }))} />
      </div>}
    </div>}
    {addon && <div className="mt-3 max-w-sm">
      <label htmlFor={`${id}-price`} className="text-sm text-slate-700">Pris ({addon.currency})</label>
      <input id={`${id}-price`} className={INPUT} inputMode="decimal" value={addonForm.price} disabled={reloading}
        aria-describedby={`${id}-status ${id}-price-help`}
        onChange={event => setForm(current => ({ ...current as AddonValues, price: event.target.value }))} />
      <p id={`${id}-price-help`} className="mt-1 text-xs text-slate-500">{!addonForm.price.trim() && form.enabled
        ? `Utan angivet pris visas tillägget som 0 ${addon.currency} i erbjudanden.`
        : 'Priset används som förslag när tillägget erbjuds i ett uppdrag.'}</p>
    </div>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p id={`${id}-status`} role={error ? 'alert' : 'status'} aria-live="polite" className={`text-sm ${error ? 'text-red-700' : invalid && dirty ? 'text-amber-800' : 'text-slate-600'}`}>
        {reloading ? 'Hämtar sparade uppgifter…' : saving ? 'Sparar…' : error || (dirty && invalid) || (dirty ? 'Väntar på att spara…' : 'Sparat')}
      </p>
      {dirty && !invalid && !conflict && <button type="button" className="text-sm font-medium text-violet-700 underline disabled:text-slate-400" disabled={saving || reloading} onClick={() => { void save() }}>{error ? 'Försök spara igen' : 'Spara nu'}</button>}
      {error && <button type="button" className="text-sm font-medium text-violet-700 underline disabled:text-slate-400" disabled={saving || reloading} onClick={() => { void reload() }}>Hämta sparade uppgifter</button>}
    </div>
  </div>
}
