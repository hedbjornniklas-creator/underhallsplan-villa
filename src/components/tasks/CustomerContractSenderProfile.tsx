'use client'

import { useEffect, useRef, useState } from 'react'
import { Building2, Check, Loader2, RefreshCw } from 'lucide-react'
import type { CustomerOfferWorkspace } from '@/lib/action-cases/customerOffers'
import { normalizeContractSenderProfile, type ContractSenderProfileSnapshot } from '@/lib/action-cases/contractSenderProfile'
import type { OrganizationSenderProfile } from '@/lib/organizations/senderProfileTypes'

type SenderChoices = {
  available: boolean
  organization: { id: string; name: string; organizationNumber: string | null; legalName: string | null; legalNameVersion: number }
  profiles: OrganizationSenderProfile[]
  selected: ContractSenderProfileSnapshot | null
}
export type SenderProfileRequest = { requestId: string; revision: number; profileId: string; profileVersion: number; legalNameVersion: number; organizationNumber: string; confirmed: true }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50'
const definitiveCodes = new Set(['CUSTOMER_SENDER_INVALID', 'CUSTOMER_SENDER_FORBIDDEN', 'CUSTOMER_SENDER_PROFILE',
  'CUSTOMER_SENDER_STALE', 'CUSTOMER_SENDER_IDENTITY_REQUIRED', 'CUSTOMER_SENDER_CONTACT_INVALID', 'CUSTOMER_SENDER_MEDIA',
  'CUSTOMER_SENDER_IMMUTABLE', 'CUSTOMER_SENDER_WITHDRAW_FIRST', 'CUSTOMER_OFFER_STALE', 'CUSTOMER_OFFER_LOCKED',
  'CUSTOMER_OFFER_ACCEPTED', 'CUSTOMER_OFFER_NOT_FOUND'])

export function validSenderChoices(value: unknown, expectedOrganizationId?: string): value is SenderChoices {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as SenderChoices, org = input.organization
  const nullableText = (item: unknown) => item === null || typeof item === 'string'
  if (!org || typeof org !== 'object' || typeof org.id !== 'string' || !uuid.test(org.id) ||
    (expectedOrganizationId && org.id !== expectedOrganizationId) || typeof org.name !== 'string' ||
    !nullableText(org.legalName) || !nullableText(org.organizationNumber) || !Number.isSafeInteger(org.legalNameVersion) || org.legalNameVersion < 0 ||
    typeof input.available !== 'boolean' || !Array.isArray(input.profiles)) return false
  const ids = new Set<string>()
  if (!input.profiles.every(profile => {
    if (!profile || typeof profile !== 'object' || typeof profile.id !== 'string' || !uuid.test(profile.id) ||
      ids.has(profile.id) || profile.orgId !== org.id || !Number.isSafeInteger(profile.version) || profile.version < 1 ||
      typeof profile.name !== 'string' || !profile.name.trim() || typeof profile.isActive !== 'boolean' ||
      !['address', 'postalCode', 'city', 'email', 'phone', 'website', 'logoPath', 'reportFooterText'].every(key => nullableText(profile[key as keyof OrganizationSenderProfile]))) return false
    ids.add(profile.id); return true
  })) return false
  try { return input.selected === null || normalizeContractSenderProfile(input.selected).organizationId === org.id } catch { return false }
}

export function confirmedSenderWorkspace(value: unknown, request: SenderProfileRequest, organizationId: string): value is CustomerOfferWorkspace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as CustomerOfferWorkspace
  if (!Number.isSafeInteger(result.revision) || result.revision < request.revision + 1 || !Array.isArray(result.offers) ||
    !result.draft || typeof result.draft !== 'object' || !Array.isArray(result.draft.items) || !Array.isArray(result.draft.attachmentIds)) return false
  try {
    const selected = normalizeContractSenderProfile(result.draft.senderProfile)
    // The exact request receipt confirms the write; a later edit may already be
    // present in the returned workspace. Never retry over that newer selection.
    return selected.organizationId === organizationId
  } catch { return false }
}

export default function CustomerContractSenderProfile({ caseId, organizationId, selected, revision, currentCompanyName, blockedReason,
  active = true, onPendingChange, onApplied, onReload }: {
  caseId: string
  organizationId?: string
  selected: ContractSenderProfileSnapshot | null
  revision: number
  currentCompanyName: string
  blockedReason: string | null
  active?: boolean
  onPendingChange: (pending: boolean) => void
  onApplied: (workspace: CustomerOfferWorkspace) => void
  onReload: () => Promise<boolean>
}) {
  const [choices, setChoices] = useState<SenderChoices | null>(null)
  const [loading, setLoading] = useState(false)
  const [choice, setChoice] = useState(selected?.profileId ?? '')
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState<SenderProfileRequest | null>(null)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const endpoint = `/api/action-cases/${caseId}/sender-profile`
  const expectedOrganization = organizationId ?? selected?.organizationId
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setChoice(selected?.profileId ?? ''); setConfirming(false) }, [selected?.profileId, selected?.profileVersion, selected?.legalNameVersion])
  useEffect(() => {
    if (!active || pending) return
    const controller = new AbortController()
    setLoading(true)
    void (async () => {
      try {
        const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Avsändarprofilerna kunde inte hämtas.')
        if (!validSenderChoices(data, expectedOrganization)) throw new Error('Avsändarprofilerna kunde inte kontrolleras. Hämta dem igen.')
        if (!controller.signal.aborted) setChoices(data)
      } catch (failure) {
        if (!controller.signal.aborted) { setChoices(null); setError(failure instanceof Error ? failure.message : 'Avsändarprofilerna kunde inte hämtas.') }
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [active, endpoint, expectedOrganization, pending, reload])
  const available = choices?.profiles.filter(profile => profile.isActive) ?? []
  const candidate = available.find(profile => profile.id === choice)
  const changed = candidate && (candidate.id !== selected?.profileId || candidate.version !== selected.profileVersion ||
    choices?.organization.legalNameVersion !== selected.legalNameVersion || choices?.organization.organizationNumber !== selected.organizationNumber)
  const identityReady = Boolean(choices?.organization.legalName?.trim() && choices.organization.organizationNumber?.trim() && choices.organization.legalNameVersion > 0)
  const disabled = Boolean(blockedReason || loading || pending || !choices?.available || !identityReady)

  async function apply() {
    if (inFlight.current || (!pending && (disabled || !candidate || !changed || revision < 1 || !choices))) return
    const request = pending ?? { requestId: crypto.randomUUID(), revision, profileId: candidate!.id,
      profileVersion: candidate!.version, legalNameVersion: choices!.organization.legalNameVersion,
      organizationNumber: choices!.organization.organizationNumber!, confirmed: true as const }
    const orgId = choices?.organization.id ?? expectedOrganization
    if (!orgId) return
    inFlight.current = true; setPosting(true); setPending(request); onPendingChange(true); setError(''); setNotice('')
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(45000),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
      const data = await response.json().catch(() => null)
      if (!response.ok && [400, 403, 404, 409].includes(response.status) && definitiveCodes.has(data?.code)) {
        if (mounted.current) { setPending(null); onPendingChange(false); setConfirming(false); setError(data.error || 'Profilen kunde inte väljas. Hämta aktuella uppgifter och försök igen.') }
        return
      }
      if (!response.ok || data?.saved !== true || !confirmedSenderWorkspace(data.workspace, request, orgId)) throw new Error('UNCONFIRMED')
      if (mounted.current) {
        const current = data.workspace.draft.senderProfile!
        const sameSelection = current.profileId === request.profileId && current.profileVersion === request.profileVersion &&
          current.legalNameVersion === request.legalNameVersion && current.organizationNumber === request.organizationNumber
        onApplied(data.workspace); setPending(null); onPendingChange(false); setConfirming(false)
        setNotice(sameSelection ? 'Avsändarprofilen är vald. Entreprenörens företagsuppgifter har uppdaterats i avtalsutkastet.'
          : 'Profilbytet sparades. Avtalet har därefter ändrats; de aktuella uppgifterna visas.')
      }
    } catch {
      if (mounted.current) setError('Profilbytet kunde inte bekräftas. Försök samma byte igen för att kontrollera resultatet. Avtalsutkastet är låst under tiden.')
    } finally { inFlight.current = false; if (mounted.current) setPosting(false) }
  }

  return <section className="my-5 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-label="Avsändarprofil">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="flex items-center gap-2 text-base font-semibold"><Building2 size={18} aria-hidden />Avsändarprofil</h3>
        <p className="mt-2 break-words text-sm font-medium">{selected?.name ?? (currentCompanyName || 'Nuvarande avtalsuppgifter')}</p>
        {selected ? <p className="mt-1 break-words text-sm text-slate-600">Juridiskt företag: {selected.legalName} · {selected.organizationNumber}</p>
          : <p className="mt-1 text-sm text-slate-600">Ingen profil är vald för uppdraget. Entreprenörens nuvarande uppgifter används.</p>}
      </div>
      <button type="button" className={button} disabled={loading || Boolean(pending)} onClick={() => { setError(''); setConfirming(false); setReload(value => value + 1) }}><RefreshCw size={16} aria-hidden />Hämta profiler</button>
    </div>
    {loading && <p role="status" className="mt-3 text-sm text-slate-500">Hämtar avsändarprofiler…</p>}
    {choices && !choices.available && <p className="mt-3 text-sm text-slate-600">Profilval behöver aktiveras innan det kan användas. Avtalsutkastet är kvar.</p>}
    {choices?.available && <>
      {!identityReady && <p className="mt-3 text-sm text-slate-600">Organisationens registrerade bolagsnamn och organisationsnummer behöver fyllas i först.</p>}
      <div className="mt-4 flex min-w-0 flex-wrap items-end gap-3">
        <label className="min-w-0 flex-[1_1_16rem] text-sm font-medium">Välj avsändarprofil
          <select aria-label="Välj avsändarprofil" className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50" disabled={disabled} value={choice}
            onChange={event => { setChoice(event.target.value); setConfirming(false); setError(''); setNotice('') }}>
            <option value="">Välj en profil</option>
            {selected && !available.some(profile => profile.id === selected.profileId) && <option value={selected.profileId} disabled>{selected.name} (arkiverad eller inte tillgänglig)</option>}
            {available.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </label>
        <button type="button" className={button} disabled={disabled || !changed || revision < 1} onClick={() => setConfirming(true)}>{choice === selected?.profileId ? 'Uppdatera profiluppgifter' : 'Använd profil'}</button>
      </div>
      {!available.length && <p className="mt-3 text-sm text-slate-600">Det finns inga aktiva avsändarprofiler att välja.</p>}
      {blockedReason && !pending && <p className="mt-3 text-sm text-slate-600">{blockedReason}</p>}
      <a className="mt-3 inline-block text-sm underline" href={`/settings/organisation?orgId=${encodeURIComponent(choices.organization.id)}&tab=sender-profiles`} target="_blank" rel="noreferrer">Hantera organisationens avsändarprofiler</a>
    </>}
    {confirming && candidate && !pending && <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4" role="group" aria-label="Bekräfta avsändarprofil">
      <p className="break-words text-sm font-semibold">Använd {candidate.name} i det här uppdragets avtal?</p>
      <p className="mt-2 text-sm leading-6">Entreprenörens företagsnamn, organisationsnummer, adress, telefon och kontaktmejl ersätts. Kontaktperson, mobilnummer, F-skatt, beställare, pris och övrigt avtalsinnehåll behålls.</p>
      <dl className="mt-3 space-y-1 break-words text-sm"><div><dt className="inline font-medium">Juridiskt företag: </dt><dd className="inline">{choices?.organization.legalName}</dd></div>
        <div><dt className="inline font-medium">Organisationsnummer: </dt><dd className="inline">{choices?.organization.organizationNumber}</dd></div>
        <div><dt className="inline font-medium">Adress: </dt><dd className="inline">{[candidate.address, candidate.postalCode, candidate.city].filter(Boolean).join(', ') || 'Saknas i profilen'}</dd></div>
        <div><dt className="inline font-medium">Kontaktmejl: </dt><dd className="inline break-all">{candidate.email || 'Saknas i profilen'}</dd></div></dl>
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={`${button} border-indigo-700 text-indigo-900`} disabled={disabled} onClick={() => void apply()}><Check size={16} aria-hidden />Bekräfta profilbyte</button>
        <button type="button" className={button} onClick={() => setConfirming(false)}>Avbryt</button></div>
    </div>}
    {error && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900" role="alert"><p>{error}</p>
      {!pending && !blockedReason && <button type="button" className={`${button} mt-3`} disabled={loading} onClick={async () => { if (await onReload()) { setConfirming(false); setReload(value => value + 1) } }}>Hämta aktuellt avtal</button>}
    </div>}
    {pending && <div className="mt-4 flex flex-col items-stretch gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm sm:flex-row sm:items-center">
      <p className="min-w-0 sm:flex-1">{posting ? 'Bekräftar avsändarprofilen…' : 'Det skickade profilbytet behöver kontrolleras innan du fortsätter.'}</p>
      <button type="button" className={`${button} w-full sm:w-auto`} disabled={posting} onClick={() => void apply()}>{posting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <RefreshCw size={16} aria-hidden />}{posting ? 'Sparar…' : 'Försök samma byte igen'}</button>
    </div>}
    {notice && <p className="mt-4 text-sm text-emerald-800" role="status">{notice}</p>}
  </section>
}
