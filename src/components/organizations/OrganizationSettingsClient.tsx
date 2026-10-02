'use client'

/* eslint-disable @next/next/no-img-element -- uploaded organisation logos are stored as versioned paths */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Building2, CheckCircle2, ImagePlus, Plug, Save, ShieldCheck, UserRound, UserRoundPlus, UsersRound } from 'lucide-react'
import FortnoxConnectionCard from '@/components/settings/FortnoxConnectionCard'
import type { OrganizationAdministrationWorkspace, OrganizationProfileValues } from '@/lib/organizations/administrationTypes'

type Role = 'admin' | 'inspector'
type OrganizationProfile = OrganizationProfileValues
type OrganizationSettingsWorkspace = OrganizationAdministrationWorkspace
type Member = { profileId: string; displayName: string | null; email: string | null; role: Role; isActive: boolean; modules: string[] }
type Invitation = { id: string; email: string; fullName: string; role: Role; modules: string[]; status: 'pending' | 'accepted' | 'revoked'; expiresAt: string; revision: number; notificationState: string }
type MembersPayload = { members: Member[]; invitations: Invitation[]; enabledModules: string[] }
type Tab = 'organization' | 'members' | 'integrations'
const TU_MODULE = 'technical_investigations'
const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-600'
const primaryClass = 'inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryClass = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
const roleLabel = (role: Role) => role === 'admin' ? 'Organisationsadministratör' : 'Medlem / besiktningsman'
const moduleLabel = (key: string) => ({ technical_investigations: 'TU', inspections: 'ÖB', construction_inspections: 'EB', moisture_safety: 'Fuktsäkerhet' })[key] ?? key

function profileValues(organization: OrganizationSettingsWorkspace['organization']): OrganizationProfile {
  return { name: organization.name, organizationNumber: organization.organizationNumber ?? '', address: organization.address ?? '', postalCode: organization.postalCode ?? '', city: organization.city ?? '', website: organization.website ?? '', logoPath: organization.logoPath, reportFooterText: organization.reportFooterText ?? '' }
}

function publicLogoUrl(path: string | null) {
  if (!path) return null
  if (/^https?:\/\//u.test(path) || path.startsWith('/')) return path
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/u, '')
  return base ? `${base}/storage/v1/object/public/property-media/${path}` : null
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || (response.status === 409 ? 'Uppgifterna har ändrats. Hämta aktuell information och försök igen.' : 'Begäran kunde inte slutföras. Försök igen.'))
  return payload as T
}

function useUnsavedChanges(dirty: boolean, busy = false) {
  useEffect(() => {
    if (!dirty && !busy) return
    const onUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const onSwitch = (event: Event) => {
      if (busy) { event.preventDefault(); return }
      if (event.defaultPrevented) return
      const detail = (event as CustomEvent<{ confirmed?: boolean }>).detail
      if (detail?.confirmed) return
      if (!window.confirm('Du har osparade ändringar. Vill du lämna dem och gå vidare?')) event.preventDefault()
      else if (detail) detail.confirmed = true
    }
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('hushub:before-organization-switch', onSwitch)
    return () => { window.removeEventListener('beforeunload', onUnload); window.removeEventListener('hushub:before-organization-switch', onSwitch) }
  }, [busy, dirty])
}

export default function OrganizationSettingsClient({ initialWorkspace, initialTab = 'organization' }: { initialWorkspace: OrganizationSettingsWorkspace; initialTab?: Tab }) {
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [form, setForm] = useState(() => profileValues(initialWorkspace.organization))
  const [saved, setSaved] = useState(() => JSON.stringify(profileValues(initialWorkspace.organization)))
  const [tab, setTab] = useState<Tab>(initialTab === 'members' && initialWorkspace.role !== 'admin' ? 'organization' : initialTab)
  const [busy, setBusy] = useState<'save' | 'upload' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const inFlight = useRef(false)
  const isAdmin = workspace.role === 'admin'
  const canEdit = isAdmin && !workspace.migrationRequired
  const dirty = JSON.stringify(form) !== saved
  const orgId = workspace.organization.id
  const logo = publicLogoUrl(form.logoPath)
  useUnsavedChanges(dirty, Boolean(busy))

  function canNavigate() {
    return window.dispatchEvent(new CustomEvent('hushub:before-organization-switch', { cancelable: true, detail: { fromOrgId: orgId, orgId } }))
  }

  const update = (key: keyof OrganizationProfile, value: string | null) => { setForm(current => ({ ...current, [key]: value })); setNotice('') }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!canEdit || inFlight.current) return
    inFlight.current = true; setBusy('save'); setError(''); setNotice('')
    try {
      const result = await requestJson<{ workspace: OrganizationSettingsWorkspace }>('/api/organizations/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, expectedVersion: workspace.organization.version, profile: form }),
      })
      if (result.workspace?.organization.id !== orgId) throw new Error('Organisationen i svaret stämmer inte. Ladda om sidan.')
      const next = profileValues(result.workspace.organization)
      setWorkspace(result.workspace); setForm(next); setSaved(JSON.stringify(next)); setNotice('Organisationens uppgifter har sparats.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Kunde inte spara organisationsprofilen.') }
    finally { inFlight.current = false; setBusy(null) }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !canEdit || inFlight.current) return
    if (file.size > 5 * 1024 * 1024) { setError('Logotypen får vara högst 5 MB.'); return }
    inFlight.current = true; setBusy('upload'); setError(''); setNotice('')
    try {
      const body = new FormData(); body.set('file', file)
      const result = await requestJson<{ path: string }>(`/api/organizations/profile/media?orgId=${encodeURIComponent(orgId)}`, { method: 'POST', body })
      if (!result.path) throw new Error('Logotypen kunde inte laddas upp.')
      update('logoPath', result.path)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Kunde inte ladda upp logotypen.') }
    finally { inFlight.current = false; setBusy(null) }
  }

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-xl bg-indigo-50 p-3 text-indigo-600"><Building2 size={24} aria-hidden /></span>
            <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Aktiv arbetsorganisation</p><h1 className="mt-1 break-words text-2xl font-semibold tracking-tight text-slate-950">{workspace.organization.name}</h1></div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700"><ShieldCheck size={14} aria-hidden />{roleLabel(workspace.role)}</span>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-600">Företagets gemensamma uppgifter, medlemmar och anslutningar finns här. Du hittar dina egna kontaktuppgifter, profilbild och underskrift under Min profil.</p>
      </header>

      <nav aria-label="Organisationsinställningar" className="flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {([{ id: 'organization', label: 'Organisation', icon: Building2 }, ...(isAdmin ? [{ id: 'members', label: 'Medlemmar', icon: UsersRound }] : []), { id: 'integrations', label: 'Integrationer', icon: Plug }] as const).map(item => {
          const Icon = item.icon
          return <button key={item.id} type="button" aria-current={tab === item.id ? 'page' : undefined} onClick={() => { if (item.id !== tab && canNavigate()) setTab(item.id as Tab) }} className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${tab === item.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Icon size={17} aria-hidden />{item.label}</button>
        })}
        <Link href={`/settings/profil?orgId=${encodeURIComponent(orgId)}`} onClick={event => { if (!canNavigate()) event.preventDefault() }} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"><UserRound size={17} aria-hidden />Min profil</Link>
      </nav>

      {workspace.migrationRequired && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Organisationsinställningarna förbereds. Du kan läsa uppgifterna, men ändringar och inbjudningar är tillfälligt avstängda.</p>}
      {tab === 'organization' && <form onSubmit={save} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-6"><h2 className="text-lg font-semibold text-slate-950">Företagsuppgifter</h2><p className="mt-1 text-sm text-slate-600">Gemensamma uppgifter för alla som arbetar i {workspace.organization.name}.</p></div>
        {!isAdmin && <p className="mb-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Du kan läsa företagets uppgifter. En organisationsadministratör gör ändringar.</p>}
        {!workspace.organization.configured && isAdmin && <p className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">Kontrollera företagets gemensamma uppgifter och spara dem innan ni börjar använda organisationsprofilen.</p>}
        <div className="grid gap-8 md:grid-cols-[220px_1fr]">
          <div><p className="text-sm font-medium text-slate-700">Företagslogotyp</p><div className="mt-2 flex h-44 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">{logo ? <img src={logo} alt={`Logotyp för ${workspace.organization.name}`} className="max-h-full max-w-full object-contain" /> : <Building2 size={44} className="text-slate-300" aria-hidden />}</div>
            {isAdmin && <><label className={`mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700 ${!canEdit || busy ? 'pointer-events-none opacity-50' : 'hover:bg-slate-50'}`}><ImagePlus size={16} aria-hidden />{busy === 'upload' ? 'Laddar upp…' : 'Ladda upp logotyp'}<input aria-label="Ladda upp företagslogotyp" type="file" accept="image/png,image/jpeg,image/webp" disabled={!canEdit || Boolean(busy)} onChange={event => void upload(event)} className="sr-only" /></label><p className="mt-2 text-xs leading-5 text-slate-500">PNG, JPG eller WebP, högst 5 MB. Spara efter uppladdningen.</p>{form.logoPath && <button type="button" disabled={!canEdit || Boolean(busy)} onClick={() => update('logoPath', null)} className="mt-2 text-sm text-rose-700 underline disabled:opacity-50">Ta bort logotyp</button>}</>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {([{ key: 'name', label: 'Företagsnamn', max: 160, required: true }, { key: 'organizationNumber', label: 'Organisationsnummer', max: 13 }, { key: 'address', label: 'Adress', max: 240 }, { key: 'postalCode', label: 'Postnummer', max: 20 }, { key: 'city', label: 'Ort', max: 120 }, { key: 'website', label: 'Webbplats', max: 500 }] as const).map(field => <label key={field.key} className="text-sm font-medium text-slate-700">{field.label}<input value={form[field.key] ?? ''} onChange={event => update(field.key, event.target.value)} disabled={!canEdit || Boolean(busy)} required={'required' in field && field.required} maxLength={field.max} className={inputClass} autoComplete="off" /></label>)}
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">Rapportsidfot<textarea value={form.reportFooterText ?? ''} onChange={event => update('reportFooterText', event.target.value)} disabled={!canEdit || Boolean(busy)} maxLength={1500} rows={3} className={inputClass} /><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Företagets gemensamma kontaktuppgifter eller annan text som ska visas längst ned i nya dokument.</span></label>
          </div>
        </div>
        {error && <p role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {notice && <p role="status" className="mt-5 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={17} aria-hidden />{notice}</p>}
        {isAdmin && <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5"><p className="text-sm text-slate-500">{dirty ? 'Du har osparade ändringar.' : workspace.organization.configured ? 'Alla ändringar är sparade.' : 'Kontrollera uppgifterna och spara organisationsprofilen.'}</p><button type="submit" className={primaryClass} disabled={!canEdit || (!dirty && workspace.organization.configured) || Boolean(busy) || !form.name.trim()}><Save size={17} aria-hidden />{busy === 'save' ? 'Sparar…' : 'Spara företagsuppgifter'}</button></div>}
      </form>}
      {tab === 'members' && isAdmin && <OrganizationMembers key={orgId} orgId={orgId} viewerProfileId={workspace.profileId} disabled={workspace.migrationRequired} />}
      {tab === 'integrations' && (isAdmin ? <FortnoxConnectionCard preferredOrgId={orgId} externalNavigationBlocked={dirty || Boolean(busy) || workspace.migrationRequired} /> : <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600"><h2 className="mb-2 text-lg font-semibold text-slate-950">Integrationer</h2>Organisationens administratör hanterar Fortnox och andra anslutningar.</section>)}
    </div>
  )
}

function OrganizationMembers({ orgId, viewerProfileId, disabled }: { orgId: string; viewerProfileId: string; disabled: boolean }) {
  const [data, setData] = useState<MembersPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('inspector')
  const [includeTu, setIncludeTu] = useState(true)
  const requestId = useRef<string | null>(null)
  const inFlight = useRef(false)
  useUnsavedChanges(Boolean(fullName || email), busy)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const result = await requestJson<MembersPayload>(`/api/organizations/members?orgId=${encodeURIComponent(orgId)}`, { signal })
    if (!Array.isArray(result.members) || !Array.isArray(result.invitations) || !Array.isArray(result.enabledModules)) throw new Error('Medlemslistan kunde inte läsas.')
    setData(result)
  }, [orgId])
  useEffect(() => {
    if (disabled) { setLoading(false); return }
    const controller = new AbortController()
    void refresh(controller.signal).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Kunde inte läsa medlemmar.') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [disabled, refresh])
  async function action(body: Record<string, unknown>) {
    if (inFlight.current || disabled) return
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await requestJson<{ message: string }>('/api/organizations/invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId, ...body }) })
      setNotice(result.message)
      if (body.action === 'create') { setFullName(''); setEmail(''); setRole('inspector'); setIncludeTu(true); requestId.current = null }
      await refresh()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Inbjudan kunde inte sparas.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  function invite(event: FormEvent) {
    event.preventDefault()
    requestId.current ??= crypto.randomUUID()
    void action({ action: 'create', requestId: requestId.current, fullName: fullName.trim(), email: email.trim(), role, modules: includeTu && tuEnabled ? [TU_MODULE] : [] })
  }
  const tuEnabled = Boolean(data?.enabledModules.includes(TU_MODULE))
  const pending = data?.invitations.filter(invitation => invitation.status === 'pending') ?? []
  return <div className="space-y-5">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950"><UserRoundPlus size={20} aria-hidden />Bjud in en kollega</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">Kollegan använder sitt befintliga HusHub-konto eller skapar ett konto via inbjudan. Du väljer rollen och arbetsområdet i den här organisationen.</p>
      <form onSubmit={invite} className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Namn<input required maxLength={160} autoComplete="off" value={fullName} onChange={event => { setFullName(event.target.value); requestId.current = null }} disabled={disabled || busy || loading} className={inputClass} /></label><label className="text-sm font-medium text-slate-700">E-post<input required type="email" maxLength={254} autoComplete="off" value={email} onChange={event => { setEmail(event.target.value); requestId.current = null }} disabled={disabled || busy || loading} className={inputClass} /></label></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Roll<select value={role} onChange={event => { setRole(event.target.value as Role); requestId.current = null }} disabled={disabled || busy || loading} className={inputClass}><option value="inspector">Medlem / besiktningsman</option><option value="admin">Organisationsadministratör</option></select></label><fieldset><legend className="text-sm font-medium text-slate-700">Arbetsområde</legend><label className="mt-1.5 flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={includeTu && tuEnabled} disabled={disabled || busy || !tuEnabled} onChange={event => { setIncludeTu(event.target.checked); requestId.current = null }} className="h-4 w-4 accent-indigo-600" />TU – teknisk utredning</label><p className="mt-1 text-xs leading-5 text-slate-500">{tuEnabled ? 'ÖB och EB ansluts i ett senare steg.' : 'TU är inte aktiverat för nya medlemmar i organisationen.'}</p></fieldset></div>
        {role === 'admin' && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">En organisationsadministratör kan ändra företagsuppgifter, hantera Fortnox och administrera medlemmar.</p>}
        <button type="submit" className={primaryClass} disabled={disabled || busy || loading || (role === 'inspector' && (!tuEnabled || !includeTu)) || !fullName.trim() || !email.trim()}><UserRoundPlus size={17} aria-hidden />{busy ? 'Arbetar…' : 'Skicka inbjudan'}</button>
      </form>
    </section>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><p>{error}</p><button type="button" className="mt-2 underline" disabled={busy || disabled} onClick={() => { setError(''); void refresh().catch(failure => setError(failure instanceof Error ? failure.message : 'Kunde inte läsa listan.')) }}>Hämta aktuell medlemslista</button></div>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-lg font-semibold text-slate-950">Medlemmar {data && <span className="ml-1 text-sm font-normal text-slate-500">({data.members.length})</span>}</h2><p className="mt-1 text-sm leading-6 text-slate-600">När en medlem avaktiveras sparas tidigare uppdrag och dokument. Organisationen måste ha minst en aktiv administratör.</p>{loading && <p role="status" className="mt-4 text-sm text-slate-500">Laddar medlemmar…</p>}<div className="mt-5 space-y-3">{data?.members.map(member => <MemberEditor key={`${member.profileId}:${JSON.stringify(member)}`} member={member} orgId={orgId} isSelf={member.profileId === viewerProfileId} disabled={disabled || busy} enabledModules={data.enabledModules} onSaved={refresh} />)}</div></section>
    {pending.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-lg font-semibold text-slate-950">Väntande inbjudningar</h2><div className="mt-4 divide-y divide-slate-100">{pending.map(invitation => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><p className="break-words font-medium text-slate-900">{invitation.fullName}</p><p className="break-all text-sm text-slate-600">{invitation.email}</p><p className="mt-1 text-xs text-slate-500">{roleLabel(invitation.role)} · {invitation.modules.map(moduleLabel).join(', ')} · Giltig till {new Date(invitation.expiresAt).toLocaleDateString('sv-SE')}</p>{invitation.notificationState === 'failed' && <p className="mt-1 text-xs text-amber-800">Mejlet kunde inte bekräftas. Skicka en ny länk.</p>}</div><div className="flex flex-wrap gap-2"><button type="button" className={secondaryClass} disabled={disabled || busy} onClick={() => void action({ action: 'resend', id: invitation.id, revision: invitation.revision })}>Skicka ny länk</button><button type="button" className="rounded-xl px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50" disabled={disabled || busy} onClick={() => void action({ action: 'revoke', id: invitation.id, revision: invitation.revision })}>Återkalla</button></div></div>)}</div></section>}
  </div>
}

function MemberEditor({ member, orgId, isSelf, enabledModules, disabled, onSaved }: { member: Member; orgId: string; isSelf: boolean; enabledModules: string[]; disabled: boolean; onSaved: () => Promise<void> }) {
  const router = useRouter()
  const [role, setRole] = useState(member.role)
  const [isActive, setActive] = useState(member.isActive)
  const [modules, setModules] = useState(member.modules)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const dirty = role !== member.role || isActive !== member.isActive || JSON.stringify(modules) !== JSON.stringify(member.modules)
  useUnsavedChanges(dirty, busy)
  async function save(event: FormEvent) {
    event.preventDefault()
    if (disabled || inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      await requestJson('/api/organizations/members', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId, profileId: member.profileId, role, isActive, modules }) })
      if (isSelf && (role !== member.role || isActive !== member.isActive)) { router.refresh(); return }
      await onSaved()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Medlemmen kunde inte uppdateras.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <form onSubmit={save} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words font-semibold text-slate-900">{member.displayName || member.email || 'Medlem'}</h3><p className="break-all text-sm text-slate-500">{member.email}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${member.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{member.isActive ? 'Aktiv' : 'Avaktiverad'}</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-600">Roll för {member.displayName || member.email}<select value={role} onChange={event => setRole(event.target.value as Role)} disabled={disabled || busy} className={inputClass}><option value="inspector">Medlem / besiktningsman</option><option value="admin">Organisationsadministratör</option></select></label><label className="text-xs font-medium text-slate-600">Medlemskap<select value={isActive ? 'active' : 'inactive'} onChange={event => setActive(event.target.value === 'active')} disabled={disabled || busy} className={inputClass}><option value="active">Aktivt</option><option value="inactive">Avaktiverat</option></select></label></div><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={modules.includes(TU_MODULE)} disabled={disabled || busy || !enabledModules.includes(TU_MODULE)} onChange={event => setModules(current => event.target.checked ? [...current.filter(module => module !== TU_MODULE), TU_MODULE] : current.filter(module => module !== TU_MODULE))} />TU</label><button type="submit" className={secondaryClass} disabled={!dirty || disabled || busy}>{busy ? 'Sparar…' : 'Spara medlem'}</button></div>{member.modules.some(module => module !== TU_MODULE) && <p className="mt-2 text-xs text-slate-500">Övriga befintliga arbetsområden: {member.modules.filter(module => module !== TU_MODULE).map(moduleLabel).join(', ')}</p>}{error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}</form>
}
