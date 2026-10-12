'use client'

/* eslint-disable @next/next/no-img-element -- immutable uploaded organisation logos */

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Archive, Building2, CheckCircle2, ImagePlus, Plus, RotateCcw, Save, X } from 'lucide-react'
import type { OrganizationSenderProfile, OrganizationSenderProfileValues, OrganizationSenderWorkspace } from '@/lib/organizations/senderProfileTypes'

const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-600'
const buttonBase = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50'
const buttonClass = `${buttonBase} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`
const primaryClass = `${buttonBase} border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700`
const endpoint = (orgId: string) => `/api/organizations/sender-profiles?orgId=${encodeURIComponent(orgId)}`

type Editor = { id: string; version: number; values: OrganizationSenderProfileValues; saved: string }
type SaveRequest = { action: 'legalName'; expectedVersion: number; legalName: string } |
  { action: 'saveProfile'; id: string; expectedVersion: number; values: OrganizationSenderProfileValues }

export function senderProfileValues(profile?: OrganizationSenderProfile): OrganizationSenderProfileValues {
  return {
    name: profile?.name ?? '', address: profile?.address ?? null, postalCode: profile?.postalCode ?? null,
    city: profile?.city ?? null, email: profile?.email ?? null, phone: profile?.phone ?? null,
    website: profile?.website ?? null, logoPath: profile?.logoPath ?? null,
    reportFooterText: profile?.reportFooterText ?? null, isActive: profile?.isActive ?? true,
  }
}

function logoUrl(path: string | null) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/u, '')
  return path && base ? `${base}/storage/v1/object/public/property-media/${path}` : null
}

export function validSenderWorkspace(value: unknown, orgId: string): value is OrganizationSenderWorkspace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const workspace = value as Record<string, unknown>
  const organization = workspace.organization as Record<string, unknown> | null
  const nullableText = (field: unknown) => field === null || typeof field === 'string'
  if (!organization || typeof organization !== 'object' || Array.isArray(organization) ||
    organization.id !== orgId || typeof organization.name !== 'string' ||
    !nullableText(organization.organizationNumber) || !nullableText(organization.legalName) ||
    !Number.isSafeInteger(organization.legalNameVersion) || Number(organization.legalNameVersion) < 0 ||
    typeof workspace.canEdit !== 'boolean' || typeof workspace.migrationRequired !== 'boolean' ||
    !Array.isArray(workspace.profiles)) return false
  const ids = new Set<string>()
  return workspace.profiles.every((profile: unknown) => {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false
    const row = profile as Record<string, unknown>
    if (row.orgId !== orgId || typeof row.id !== 'string' || !row.id || ids.has(row.id) ||
      !Number.isSafeInteger(row.version) || Number(row.version) < 1 || typeof row.name !== 'string' ||
      !row.name.trim() || typeof row.isActive !== 'boolean' ||
      !['address', 'postalCode', 'city', 'email', 'phone', 'website', 'logoPath', 'reportFooterText'].every(key => nullableText(row[key]))) return false
    ids.add(row.id)
    return true
  })
}

export default function OrganizationSenderProfiles({ orgId }: { orgId: string }) {
  const [workspace, setWorkspace] = useState<OrganizationSenderWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [legalName, setLegalName] = useState('')
  const [pending, setPending] = useState<SaveRequest | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const inFlight = useRef(false)
  const editorHeading = useRef<HTMLHeadingElement>(null)
  const feedback = useRef<HTMLParagraphElement>(null)
  const legalDirty = workspace !== null && legalName !== (workspace.organization.legalName ?? '')
  const dirty = legalDirty || Boolean(editor && (editor.version === 0 || JSON.stringify(editor.values) !== editor.saved)) || Boolean(pending)
  const canEdit = Boolean(workspace?.canEdit && !workspace.migrationRequired)
  const locked = busy || Boolean(pending)
  const editorId = editor?.id

  useEffect(() => {
    if (editorId) {
      editorHeading.current?.focus({ preventScroll: true })
      editorHeading.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [editorId])

  useEffect(() => {
    if (error || notice) {
      feedback.current?.focus({ preventScroll: true })
      feedback.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [error, notice])

  function applyWorkspace(value: unknown) {
    if (!validSenderWorkspace(value, orgId)) throw new Error('Organisationen i svaret stämmer inte. Hämta om uppgifterna.')
    setWorkspace(value)
    setLegalName(value.organization.legalName ?? '')
  }

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void (async () => {
      try {
        const response = await fetch(endpoint(orgId), { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Avsändarprofilerna kunde inte hämtas.')
        if (!validSenderWorkspace(payload.workspace, orgId)) throw new Error('Avsändarprofilerna kunde inte läsas.')
        if (!controller.signal.aborted) {
          setWorkspace(payload.workspace)
          setLegalName(payload.workspace.organization.legalName ?? '')
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Avsändarprofilerna kunde inte hämtas.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [orgId])

  useEffect(() => {
    if (!dirty && !busy) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const beforeSwitch = (event: Event) => {
      if (event.defaultPrevented) return
      if (inFlight.current) { event.preventDefault(); return }
      const detail = (event as CustomEvent<{ confirmed?: boolean }>).detail
      if (detail?.confirmed) return
      if (!window.confirm(pending ? 'Sparandet är inte bekräftat. Vill du ändå lämna sidan?' : 'Du har osparade profiluppgifter. Vill du lämna dem?')) event.preventDefault()
      else if (detail) detail.confirmed = true
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('hushub:before-organization-switch', beforeSwitch)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('hushub:before-organization-switch', beforeSwitch)
    }
  }, [dirty, busy, pending])

  async function refresh() {
    if (inFlight.current) return
    if (dirty && !window.confirm('Hämta de sparade uppgifterna? Osparade ändringar lämnas. Ett eventuellt tidigare sparande kontrolleras på nytt.')) return
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(endpoint(orgId), { cache: 'no-store', credentials: 'same-origin' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Uppgifterna kunde inte hämtas.')
      applyWorkspace(payload.workspace)
      setEditor(null); setPending(null); setNotice('Sparade uppgifter är hämtade.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Uppgifterna kunde inte hämtas.') }
    finally { inFlight.current = false; setBusy(false) }
  }

  async function save(request: SaveRequest) {
    if (!canEdit || inFlight.current) return
    const exactRequest = pending ?? request
    inFlight.current = true; setBusy(true); setPending(exactRequest); setError(''); setNotice('')
    try {
      const response = await fetch(endpoint(orgId), {
        method: 'PUT', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exactRequest),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok && [400, 401, 403, 404, 409, 413, 415, 429].includes(response.status) && typeof payload?.code === 'string') {
        setPending(null)
        setError(payload.error || 'Uppgifterna kunde inte sparas. Hämta om uppgifterna innan du försöker igen.')
        return
      }
      if (!response.ok || payload?.saved !== true) throw new Error('UNCONFIRMED')
      applyWorkspace(payload.workspace)
      setPending(null)
      if (exactRequest.action === 'saveProfile') setEditor(null)
      setNotice(exactRequest.action === 'legalName' ? 'Det registrerade bolagsnamnet är sparat.' : 'Avsändarprofilen är sparad. Befintliga dokument har inte ändrats.')
    } catch {
      setError('Sparandet kunde inte bekräftas. Försök spara samma uppgifter igen eller hämta de sparade uppgifterna. Ändra inte profilen innan resultatet har kontrollerats.')
    } finally { inFlight.current = false; setBusy(false) }
  }

  function openEditor(profile?: OrganizationSenderProfile) {
    if (!canEdit || locked) return
    if (legalDirty) { setError('Spara bolagsnamnet först, eller hämta om uppgifterna för att lämna ändringen.'); return }
    if (editor && dirty && !window.confirm('Lämna osparade ändringar och öppna en annan avsändarprofil?')) return
    const values = senderProfileValues(profile)
    setEditor({ id: profile?.id ?? crypto.randomUUID(), version: profile?.version ?? 0, values, saved: JSON.stringify(values) })
    setError(''); setNotice('')
  }

  function update(key: keyof OrganizationSenderProfileValues, value: string | null) {
    setEditor(current => current ? { ...current, values: { ...current.values, [key]: key === 'name' ? value ?? '' : value } } : null)
    setNotice('')
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !editor || !canEdit || inFlight.current || pending) return
    if (file.size > 5 * 1024 * 1024) { setError('Logotypen får vara högst 5 MB.'); return }
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const body = new FormData(); body.set('file', file)
      const response = await fetch(`/api/organizations/profile/media?orgId=${encodeURIComponent(orgId)}`, { method: 'POST', credentials: 'same-origin', body })
      const payload = await response.json()
      if (!response.ok || typeof payload.path !== 'string' || !payload.path.startsWith(`organizations/${orgId}/`)) throw new Error(payload.error || 'Logotypen kunde inte laddas upp.')
      update('logoPath', payload.path)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Logotypen kunde inte laddas upp.') }
    finally { inFlight.current = false; setBusy(false) }
  }

  function submitProfile(event: FormEvent) {
    event.preventDefault()
    if (editor) void save({ action: 'saveProfile', id: editor.id, expectedVersion: editor.version, values: editor.values })
  }

  if (loading) return <section aria-busy="true" className="rounded-2xl border border-slate-200 bg-white p-6"><p role="status" className="text-sm text-slate-600">Hämtar avsändarprofiler…</p></section>

  return <section className="space-y-5" aria-label="Avsändarprofiler">
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold text-slate-950">Ett företag – flera avsändarprofiler</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Samla företagets olika namn, logotyper och kontaktuppgifter här. Alla profiler tillhör samma organisation och delar organisationsnummer, kundregister, medlemmar och Fortnox-anslutning.</p></div><button type="button" className={buttonClass} disabled={busy} onClick={() => void refresh()}><RotateCcw size={16} aria-hidden />Hämta om</button></div>
      <p className="mt-4 rounded-xl bg-indigo-50 p-4 text-sm leading-6 text-indigo-950">Första steget: hantera profiler. Val av avsändarprofil i uppdrag och dokument införs i nästa steg. Att spara här byter inte avsändare i befintliga flöden eller ändrar skickade dokument.</p>
      {workspace?.migrationRequired && <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Databasstödet för avsändarprofiler behöver installeras innan uppgifter kan sparas. Befintliga företagsuppgifter och dokument fungerar som tidigare.</p>}
      {workspace && !workspace.canEdit && <p className="mt-4 text-sm text-slate-600">Du kan läsa profilerna. Organisationens administratör gör ändringar.</p>}
    </div>

    {error && <p ref={feedback} tabIndex={-1} role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 outline-none">{error}</p>}
    {notice && <p ref={feedback} tabIndex={-1} role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 outline-none"><CheckCircle2 size={18} className="shrink-0" aria-hidden />{notice}</p>}
    {pending && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="flex-1 text-sm text-amber-900">Uppgifterna är låsta tills sparandet är bekräftat.</p><button type="button" disabled={busy} className={buttonClass} onClick={() => void save(pending)}>{busy ? 'Sparar…' : 'Försök spara igen'}</button></div>}

    {workspace && <>
      <form onSubmit={event => { event.preventDefault(); void save({ action: 'legalName', expectedVersion: workspace.organization.legalNameVersion, legalName }) }} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-lg font-semibold text-slate-950">Juridiskt företag</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">Det registrerade bolagsnamnet är gemensamt för alla avsändarprofiler. Organisationsnumret ändras endast under Organisation.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-[2fr_1fr]">
          <label className="text-sm font-medium text-slate-700">Registrerat bolagsnamn<input name="legalName" value={legalName} maxLength={240} required disabled={!canEdit || locked || Boolean(editor)} onChange={event => { setLegalName(event.target.value); setNotice('') }} placeholder="Bolagets registrerade namn" className={inputClass} /><span className="mt-1 block text-xs font-normal text-slate-500">Visningsnamnet {workspace.organization.name} och tidigare dokument lämnas oförändrade.</span></label>
          <div className="text-sm"><p className="font-medium text-slate-700">Organisationsnummer</p><p className="mt-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-slate-700">{workspace.organization.organizationNumber || 'Saknas – fyll i under Organisation'}</p></div>
        </div>
        {canEdit && <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-500">{workspace.organization.legalName ? 'Samma juridiska företag bakom alla profiler.' : 'Ange bolagets registrerade namn innan du skapar profiler.'}</p><button type="submit" className={primaryClass} disabled={locked || Boolean(editor) || !legalDirty || !legalName.trim()}><Save size={16} aria-hidden />Spara bolagsnamn</button></div>}
      </form>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold text-slate-950">Avsändarprofiler</h3><p className="mt-1 text-sm text-slate-600">Till exempel bolagets huvudnamn och ett särskilt företagsnamn, tidigare kallat bifirma.</p></div>{canEdit && <button type="button" className={primaryClass} disabled={locked || !workspace.organization.legalName || legalDirty || workspace.profiles.length >= 20} onClick={() => openEditor()}><Plus size={17} aria-hidden />Ny avsändarprofil</button>}</div>
        {workspace.profiles.some(profile => !profile.isActive) && <label className="mt-4 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />Visa arkiverade profiler</label>}
        {workspace.profiles.length >= 20 && <p className="mt-3 text-sm text-slate-600">Högst 20 profiler kan sparas, inklusive arkiverade.</p>}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {workspace.profiles.filter(profile => showArchived || profile.isActive).map(profile => <article key={profile.id} className={`flex items-start gap-3 rounded-xl border p-4 ${profile.isActive ? 'border-slate-200' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-50 p-1">{logoUrl(profile.logoPath) ? <img src={logoUrl(profile.logoPath)!} alt="" className="max-h-full max-w-full object-contain" /> : <Building2 size={24} className="text-slate-400" aria-hidden />}</div>
            <div className="min-w-0 flex-1"><h4 className="break-words font-semibold text-slate-950">{profile.name}</h4><p className="mt-1 text-xs text-slate-500">{profile.isActive ? 'Aktiv profil' : 'Arkiverad profil'} · Samma organisation</p>{profile.email && <p className="mt-2 break-all text-sm text-slate-600">{profile.email}</p>}{profile.phone && <p className="text-sm text-slate-600">{profile.phone}</p>}{canEdit && <button type="button" disabled={locked} onClick={() => openEditor(profile)} className="mt-3 min-h-9 text-sm font-semibold text-indigo-700 underline disabled:opacity-50">Öppna profil</button>}</div>
          </article>)}
        </div>
        {!workspace.profiles.some(profile => showArchived || profile.isActive) && <p className="mt-4 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">{workspace.profiles.length ? 'Inga aktiva avsändarprofiler. Välj Visa arkiverade för att se sparade profiler.' : 'Inga avsändarprofiler har skapats ännu. Den nuvarande företagsprofilen används som tidigare.'}</p>}
      </div>

      {editor && canEdit && <form onSubmit={submitProfile} className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h3 ref={editorHeading} tabIndex={-1} className="scroll-mt-28 text-lg font-semibold text-slate-950 outline-none">{editor.version ? 'Redigera avsändarprofil' : 'Ny avsändarprofil'}</h3><p className="mt-1 text-sm text-slate-600">Tillhör {workspace.organization.legalName} · {workspace.organization.organizationNumber || 'Organisationsnummer saknas'}</p></div><button type="button" className={buttonClass} disabled={locked} onClick={() => { if (!dirty || window.confirm('Lämna osparade profiluppgifter?')) { setEditor(null); setError('') } }}><X size={16} aria-hidden />Stäng</button></div>
        <fieldset disabled={locked} className="grid gap-6 md:grid-cols-[180px_1fr]"><legend className="sr-only">Avsändarprofilens uppgifter</legend>
          <div><p className="text-sm font-medium text-slate-700">Logotyp</p><div className="mt-2 flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">{logoUrl(editor.values.logoPath) ? <img src={logoUrl(editor.values.logoPath)!} alt="Profilens logotyp" className="max-h-full max-w-full object-contain" /> : <Building2 size={36} className="text-slate-300" aria-hidden />}</div><label className={`${buttonClass} mt-3 w-full cursor-pointer`}><ImagePlus size={16} aria-hidden />Ladda upp<input aria-label="Ladda upp profilens logotyp" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void upload(event)} className="sr-only" /></label><p className="mt-2 text-xs leading-5 text-slate-500">PNG, JPG eller WebP, högst 5 MB. Spara profilen efter uppladdning.</p>{editor.values.logoPath && <button type="button" onClick={() => update('logoPath', null)} className="mt-2 min-h-9 text-sm text-rose-700 underline">Ta bort från profilen</button>}</div>
          <div className="grid gap-4 sm:grid-cols-2">{([
            { key: 'name', label: 'Avsändarnamn', max: 240, required: true, type: 'text' },
            { key: 'email', label: 'Kontaktmejl', max: 254, type: 'email' },
            { key: 'phone', label: 'Telefon', max: 50, type: 'tel' },
            { key: 'website', label: 'Webbplats', max: 500, type: 'text' },
            { key: 'address', label: 'Adress', max: 300, type: 'text' },
            { key: 'postalCode', label: 'Postnummer', max: 40, type: 'text' },
            { key: 'city', label: 'Ort', max: 160, type: 'text' },
          ] as const).map(field => <label key={field.key} className="text-sm font-medium text-slate-700">{field.label}<input name={field.key} type={field.type} required={'required' in field && field.required} maxLength={field.max} value={editor.values[field.key] ?? ''} onChange={event => update(field.key, event.target.value || null)} className={inputClass} /></label>)}
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">Dokumentsidfot<textarea name="reportFooterText" value={editor.values.reportFooterText ?? ''} onChange={event => update('reportFooterText', event.target.value || null)} rows={3} maxLength={2000} className={inputClass} /><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Förbered profilens kontaktuppgifter för kommande dokumentkoppling. Ingen egen e-postdomän eller utskickstjänst ansluts här.</span></label>
          </div>
        </fieldset>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
          <div>{editor.version > 0 && <button type="button" className={buttonClass} disabled={locked || JSON.stringify(editor.values) !== editor.saved} onClick={() => { if (window.confirm(editor.values.isActive ? 'Arkivera profilen? Den sparas och kan återaktiveras. Befintliga dokument ändras inte.' : 'Återaktivera avsändarprofilen?')) void save({ action: 'saveProfile', id: editor.id, expectedVersion: editor.version, values: { ...editor.values, isActive: !editor.values.isActive } }) }}>{editor.values.isActive ? <Archive size={16} aria-hidden /> : <RotateCcw size={16} aria-hidden />}{editor.values.isActive ? 'Arkivera profil' : 'Återaktivera profil'}</button>}</div>
          <button type="submit" className={primaryClass} disabled={locked || !editor.values.name.trim() || (editor.version > 0 && JSON.stringify(editor.values) === editor.saved)}><Save size={16} aria-hidden />{busy ? 'Sparar…' : 'Spara avsändarprofil'}</button>
        </div>
      </form>}
    </>}
  </section>
}
