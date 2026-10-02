'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

const TU = 'technical_investigations'
type Role = 'admin' | 'inspector'
type User = { id: string; fullName: string | null; email: string | null }
type Organization = { id: string; name: string; organizationNumber: string | null; modules: string[]; tuManaged: boolean }
type Summary = Organization & { activeMemberCount: number; activeAdminCount: number }
type MemberDraft = { role: Role; isActive: boolean; modules: string[] }
type Member = MemberDraft & { profileId: string; displayName: string; email: string | null }
type Detail = { organization: Organization; members: Member[] }
type Index = { organizations: Summary[]; users: User[] }
type CreateDraft = { requestId: string; name: string; organizationNumber: string; adminProfileId: string; modules: string[] }

const input = 'mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-base text-stone-900 disabled:bg-stone-100'
const button = 'rounded-full border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50'
const primary = 'rounded-full bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50'
const card = 'rounded-[24px] border border-stone-200 bg-white p-5 shadow-sm sm:p-6'

export function sameModules(a: string[], b: string[]) { return [...a].sort().join('|') === [...b].sort().join('|') }
export function sameMember(a: MemberDraft, b: MemberDraft) { return a.role === b.role && a.isActive === b.isActive && sameModules(a.modules, b.modules) }
function memberDraft(member: Member): MemberDraft { return { role: member.role, isActive: member.isActive, modules: [...member.modules] } }
function roleLabel(role: Role) { return role === 'admin' ? 'Organisationsadministratör' : 'Medlem / besiktningsman' }
function userLabel(user: User) { return `${user.fullName || user.email || user.id}${user.fullName && user.email ? ` · ${user.email}` : ''}` }
function moduleLabel(modules: string[]) { return modules.includes(TU) ? 'Tekniska utredningar (TU)' : 'Ingen TU-behörighet' }
function toggleTu(modules: string[], enabled: boolean) { return enabled ? [...new Set([...modules, TU])] : modules.filter((key) => key !== TU) }
function message(error: unknown) { return error instanceof Error ? error.message : 'Åtgärden kunde inte genomföras. Försök igen.' }

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...options?.headers } })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || 'Uppgifterna kunde inte hämtas eller sparas. Ladda om och försök igen.')
  if (!body) throw new Error('Servern lämnade inget svar. Ladda om och kontrollera resultatet.')
  return body as T
}

function UserSelect({ users, value, onChange, label }: { users: User[]; value: string; onChange: (value: string) => void; label: string }) {
  const [query, setQuery] = useState('')
  const filtered = users.filter((user) => user.id === value || userLabel(user).toLocaleLowerCase('sv-SE').includes(query.toLocaleLowerCase('sv-SE')))
  return <div className="space-y-3">
    <label className="block text-sm font-medium text-stone-700">Sök befintlig användare
      <input className={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Namn eller e-post" type="search" />
    </label>
    <label className="block text-sm font-medium text-stone-700">{label}
      <select className={input} required value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Välj användare…</option>
        {filtered.map((user) => <option key={user.id} value={user.id}>{userLabel(user)}</option>)}
      </select>
    </label>
    {filtered.length === 0 && <p className="text-sm text-stone-500">Ingen befintlig användare matchar sökningen.</p>}
  </div>
}

export default function OrganizationAdministrationClient() {
  const [index, setIndex] = useState<Index | null>(null)
  const [indexError, setIndexError] = useState('')
  const [indexLoading, setIndexLoading] = useState(true)
  const indexGeneration = useRef(0)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const selectedRef = useRef('')
  const detailGeneration = useRef(0)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [modules, setModules] = useState<string[]>([])
  const [drafts, setDrafts] = useState<Record<string, MemberDraft>>({})
  const [memberBaselines, setMemberBaselines] = useState<Record<string, MemberDraft>>({})
  const pendingEdits = useRef<{ id: string; drafts: Record<string, MemberDraft>; baselines: Record<string, MemberDraft>; add: { profileId: string; draft: MemberDraft } | null } | null>(null)
  const [addProfileId, setAddProfileId] = useState('')
  const [addDraft, setAddDraft] = useState<MemberDraft>({ role: 'inspector', isActive: true, modules: [] })
  const [create, setCreate] = useState<CreateDraft | null>(null)
  const [createAttempted, setCreateAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadIndex = useCallback(async () => {
    const generation = ++indexGeneration.current
    setIndexLoading(true)
    setIndexError('')
    try {
      const result = await api<Index>('/api/admin/organizations')
      if (generation === indexGeneration.current) setIndex(result)
    } catch (error) {
      if (generation === indexGeneration.current) setIndexError(message(error))
    } finally {
      if (generation === indexGeneration.current) setIndexLoading(false)
    }
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    const generation = ++detailGeneration.current
    setDetailLoading(true)
    setDetailError('')
    // A failed post-save refresh must not leave a writable stale baseline.
    setDetail(null)
    try {
      const result = await api<Detail>(`/api/admin/organizations/${encodeURIComponent(id)}`)
      if (generation !== detailGeneration.current || id !== selectedRef.current) return
      setDetail(result)
      setModules([...result.organization.modules])
      const retained = pendingEdits.current?.id === id ? pendingEdits.current : null
      const fresh = Object.fromEntries(result.members.map((member) => [member.profileId, memberDraft(member)]))
      setDrafts({ ...fresh, ...retained?.drafts })
      // Retained edits keep their original optimistic baseline, even if another
      // administrator changed that member during a different member's save.
      setMemberBaselines({ ...fresh, ...retained?.baselines })
      setAddProfileId(retained?.add?.profileId ?? '')
      setAddDraft(retained?.add?.draft ?? { role: 'inspector', isActive: true, modules: [] })
      pendingEdits.current = null
    } catch (error) {
      if (generation === detailGeneration.current && id === selectedRef.current) setDetailError(message(error))
    } finally {
      if (generation === detailGeneration.current && id === selectedRef.current) setDetailLoading(false)
    }
  }, [])

  const invalidateRequests = useCallback(() => { ++indexGeneration.current; ++detailGeneration.current }, [])
  useEffect(() => { void loadIndex(); return invalidateRequests }, [loadIndex, invalidateRequests])

  const moduleDirty = Boolean(detail && !sameModules(modules, detail.organization.modules))
  const needsModuleSave = Boolean(detail && (moduleDirty || !detail.organization.tuManaged))
  const memberDirty = Boolean(detail?.members.some((member) => drafts[member.profileId] && !sameMember(drafts[member.profileId], memberBaselines[member.profileId] ?? member)))
  const addDirty = Boolean(addProfileId || addDraft.role !== 'inspector' || addDraft.modules.length)
  const createDirty = Boolean(create && (create.name || create.organizationNumber || create.adminProfileId || create.modules.length))
  const dirty = moduleDirty || memberDirty || addDirty || createDirty || Boolean(pendingEdits.current)

  useEffect(() => {
    if (!dirty && !busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, busy])

  function mayLeave() {
    if (busy) return false
    const warning = createAttempted && create
      ? 'Skapandeförfrågan kan redan ha genomförts trots att svaret saknas. Om du lämnar utkastet förloras möjligheten att försöka igen med samma förfrågan. Kontrollera listan innan du skapar igen. Vill du lämna utkastet?'
      : 'Du har osparade ändringar. Vill du lämna dem utan att spara?'
    return !dirty || window.confirm(warning)
  }
  function selectOrganization(id: string) {
    if (id === selectedId && !create) return
    if (!mayLeave()) return
    pendingEdits.current = null
    selectedRef.current = id
    setSelectedId(id)
    setCreate(null)
    setError('')
    setNotice('')
    setModules([])
    setDrafts({})
    setAddProfileId('')
    setAddDraft({ role: 'inspector', isActive: true, modules: [] })
    void loadDetail(id)
  }
  function startCreate() {
    if (!mayLeave()) return
    if (createAttempted && create && !window.confirm('En tidigare skapandeförfrågan kan redan ha genomförts trots att svaret saknas. Kontrollera organisationslistan innan du börjar om. Vill du ändå starta ett helt nytt utkast?')) return
    pendingEdits.current = null
    ++detailGeneration.current
    selectedRef.current = ''
    setSelectedId('')
    setDetail(null)
    setDetailError('')
    setDetailLoading(false)
    setAddProfileId('')
    setAddDraft({ role: 'inspector', isActive: true, modules: [] })
    setCreate({ requestId: crypto.randomUUID(), name: '', organizationNumber: '', adminProfileId: '', modules: [] })
    setCreateAttempted(false)
    setError('')
    setNotice('')
  }
  function changeCreate(patch: Partial<Omit<CreateDraft, 'requestId'>>) {
    // Once attempted, the exact draft and idempotency key stay frozen for retry.
    if (!createAttempted) setCreate((current) => current ? { ...current, ...patch } : null)
  }

  async function createOrganization(event: FormEvent) {
    event.preventDefault()
    if (!create || busy) return
    const admin = index?.users.find((user) => user.id === create.adminProfileId)
    if (!admin || !create.name.trim()) return
    if (!window.confirm(`Skapa organisationen ${create.name.trim()} (${create.organizationNumber.trim() || 'organisationsnummer saknas'})?\n\nFörsta organisationsadministratör: ${userLabel(admin)}.\nOrganisationens modul: ${moduleLabel(create.modules)}.\nAdministratören får ingen TU-behörighet automatiskt; den tilldelas separat.\n\nAdministratören kan hantera företagets uppgifter, medlemmar och Fortnox. Ingen global HusHub-adminbehörighet tilldelas.`)) return
    setBusy(true); setError(''); setNotice('')
    setCreateAttempted(true)
    try {
      const result = await api<{ saved: true; organizationId: string }>('/api/admin/organizations', { method: 'POST', body: JSON.stringify({ ...create, name: create.name.trim(), organizationNumber: create.organizationNumber.trim() || null }) })
      setCreate(null)
      selectedRef.current = result.organizationId
      setSelectedId(result.organizationId)
      setNotice('Organisationen och dess första administratör har skapats. Ingen inbjudan har skickats.')
      await Promise.all([loadIndex(), loadDetail(result.organizationId)])
    } catch (error) { setError(message(error)) }
    finally { setBusy(false) }
  }

  async function saveModules() {
    if (!detail || busy || memberDirty || addDirty || !needsModuleSave) return
    const disabling = !modules.includes(TU) && (detail.organization.modules.includes(TU) || !detail.organization.tuManaged)
    const suffix = disabling
      ? '\n\nTU-behörigheter tas bort och väntande TU-inbjudningar återkallas. Vid återaktivering behöver medlemmarna tilldelas TU igen.'
      : '\n\nIngen medlem får TU automatiskt. Tilldela behörighet separat under Medlemmar.'
    const initialize = detail.organization.tuManaged ? '' : '\n\nÖvergå till organisationsstyrd TU. Därefter krävs separat TU-tilldelning för varje medlem; äldre globala TU-behörigheter gäller inte här.'
    if (!window.confirm(`Ändra moduler för ${detail.organization.name}?\n${detail.organization.tuManaged ? moduleLabel(detail.organization.modules) : 'Äldre modulhantering'} → ${moduleLabel(modules)}${initialize}${suffix}\nÖB och EB ändras inte.`)) return
    setBusy(true); setError(''); setNotice('')
    const id = detail.organization.id
    try {
      await api(`/api/admin/organizations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ expectedModules: detail.organization.modules, modules }) })
      setNotice('Organisationens moduler har sparats.')
      await Promise.all([loadIndex(), loadDetail(id)])
    } catch (error) { setError(message(error)) }
    finally { setBusy(false) }
  }

  async function saveMember(profileId: string, draft: MemberDraft, original: Member | null) {
    if (!detail || busy || moduleDirty) return
    const user = index?.users.find((user) => user.id === profileId)
    const name = original?.displayName || (user ? userLabel(user) : profileId)
    const expected = original ? memberBaselines[profileId] ?? memberDraft(original) : null
    const before = expected ? `${roleLabel(expected.role)}, ${expected.isActive ? 'aktiv' : 'inaktiv'}, ${moduleLabel(expected.modules)}` : 'Inte medlem'
    const after = `${roleLabel(draft.role)}, ${draft.isActive ? 'aktiv' : 'inaktiv'}, ${moduleLabel(draft.modules)}`
    const warning = !draft.isActive
      ? '\n\nInaktivering tar bort personens åtkomst i den här organisationen, även andra organisationsbundna moduler. Inget i andra organisationer ändras.'
      : draft.role === 'admin'
        ? '\n\nPersonen kan hantera denna organisations företagsuppgifter, medlemmar och Fortnox. Detta ger inte global HusHub-adminbehörighet.'
        : '\n\nMedlemskapet gäller endast denna organisation. Personens andra organisationer ändras inte.'
    if (!window.confirm(`${original ? 'Ändra medlemskap' : 'Lägg till medlem'} i ${detail.organization.name}?\n${name}\n\nFrån: ${before}\nTill: ${after}${warning}`)) return
    setBusy(true); setError(''); setNotice('')
    const id = detail.organization.id
    try {
      await api(`/api/admin/organizations/${encodeURIComponent(id)}/members`, { method: 'POST', body: JSON.stringify({ profileId, expected, ...draft }) })
      setNotice(`Medlemskapet för ${name} har sparats i ${detail.organization.name}.`)
      // Other unsaved member drafts are not silently discarded by the refresh.
      const retained = Object.fromEntries(Object.entries(drafts).filter(([key, value]) => key !== profileId && detail.members.some((member) => member.profileId === key && !sameMember(memberBaselines[key] ?? member, value))))
      pendingEdits.current = {
        id, drafts: retained,
        baselines: Object.fromEntries(Object.keys(retained).map((key) => [key, memberBaselines[key] ?? memberDraft(detail.members.find((member) => member.profileId === key)!)])),
        add: original ? { profileId: addProfileId, draft: addDraft } : null,
      }
      await Promise.all([loadIndex(), loadDetail(id)])
    } catch (error) { setError(message(error)) }
    finally { setBusy(false) }
  }

  const filtered = index?.organizations.filter((org) => `${org.name} ${org.organizationNumber ?? ''}`.toLocaleLowerCase('sv-SE').includes(query.toLocaleLowerCase('sv-SE'))) ?? []
  const availableUsers = index?.users.filter((user) => !detail?.members.some((member) => member.profileId === user.id)) ?? []
  const enabledTu = Boolean(detail?.organization.tuManaged && detail.organization.modules.includes(TU))

  return <main className="mx-auto w-full max-w-7xl px-4 py-8 text-stone-900 md:px-6 md:py-10">
    <header className="rounded-[28px] border border-stone-200 bg-stone-50 p-6 sm:p-8">
      <nav aria-label="Adminnavigering" className="flex flex-wrap gap-4 text-sm font-medium text-stone-600">
        <Link href="/admin" onClick={(event) => { if (!mayLeave()) event.preventDefault() }} className="underline underline-offset-4">Admin</Link>
        <Link href="/admin/access" onClick={(event) => { if (!mayLeave()) event.preventDefault() }} className="underline underline-offset-4">Användare och access</Link>
      </nav>
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">HusHub Admin · Organisationshantering</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Organisationer</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600">Välj först företag, sedan vem som får administrera eller arbeta i det. Ändringar gäller bara den valda organisationen och sparas först efter din bekräftelse.</p>
      <div className="mt-5 grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded-2xl bg-white p-4"><strong className="block">Medlem / besiktningsman</strong><p className="mt-1 text-stone-600">Arbetar i tilldelade moduler och ändrar egna personuppgifter.</p></div>
        <div className="rounded-2xl bg-white p-4"><strong className="block">Organisationsadministratör</strong><p className="mt-1 text-stone-600">Hanterar företagets uppgifter, medlemmar och Fortnox. Arbetsmoduler tilldelas separat.</p></div>
        <div className="rounded-2xl bg-white p-4"><strong className="block">HusHub-administratör</strong><p className="mt-1 text-stone-600">Administrerar plattformen. Denna globala behörighet tilldelas inte här.</p></div>
      </div>
    </header>

    {notice && <p role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
    {error && <p role="alert" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p>}
    {indexError && <div role="alert" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><p>Organisationslistan kunde inte uppdateras: {indexError}</p><button className={`${button} mt-3`} disabled={busy || indexLoading} onClick={() => void loadIndex()}>Försök hämta listan igen</button></div>}

    <div className="mt-6 grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className={card} aria-label="Välj organisation">
        <button className={`${primary} w-full`} onClick={startCreate} disabled={busy || !index}>Skapa organisation</button>
        <label className="mt-5 block text-sm font-medium">Sök organisation
          <input type="search" className={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Namn eller organisationsnummer" />
        </label>
        {indexLoading && <p role="status" className="mt-4 text-sm text-stone-500">Hämtar organisationer…</p>}
        <ul className="mt-4 space-y-2">
          {filtered.map((org) => <li key={org.id}>
            <button disabled={busy} aria-pressed={selectedId === org.id} onClick={() => selectOrganization(org.id)} className={`w-full rounded-2xl border p-4 text-left transition disabled:opacity-50 ${selectedId === org.id ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white hover:bg-stone-50'}`}>
              <span className="block break-words font-semibold">{org.name}</span>
              <span className={`mt-1 block text-xs ${selectedId === org.id ? 'text-stone-300' : 'text-stone-500'}`}>{org.organizationNumber || 'Organisationsnummer saknas'}</span>
              <span className="mt-3 block text-xs">{org.activeMemberCount} aktiva · {org.activeAdminCount} administratörer</span>
              {org.activeAdminCount === 0 && <span className="mt-2 block text-xs font-semibold">Saknar aktiv administratör</span>}
            </button>
          </li>)}
        </ul>
        {index && !indexLoading && filtered.length === 0 && <p className="mt-4 text-sm text-stone-500">Inga organisationer matchar sökningen.</p>}
      </aside>

      <div className="min-w-0 space-y-5" aria-busy={busy || detailLoading}>
        {!selectedId && !create && <section className={`${card} py-12`}><h2 className="text-xl font-semibold">Vilken organisation vill du hantera?</h2><p className="mt-3 text-sm text-stone-600">Välj ett företag i listan eller skapa en organisation med en första administratör.</p></section>}
        {detailLoading && <p role="status" className={card}>Hämtar organisationens uppgifter…</p>}
        {detailError && <section role="alert" className={`${card} border-rose-200`}><p className="text-rose-900">Organisationens aktuella uppgifter kunde inte hämtas: {detailError}</p><p className="mt-2 text-sm">Inga ytterligare ändringar kan sparas innan uppgifterna har hämtats igen.</p><button className={`${button} mt-4`} disabled={busy} onClick={() => void loadDetail(selectedId)}>Hämta aktuella uppgifter</button></section>}

        {create && <section className={card}>
          <h2 className="text-2xl font-semibold">Skapa organisation</h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">Välj en befintlig användare som första organisationsadministratör. Därefter kan administratören bjuda in nya användare via Inställningar → Organisation → Medlemmar. Ingen e-post skickas här.</p>
          <form onSubmit={createOrganization} className="mt-5"><fieldset disabled={busy || !index} className="space-y-5">
            {createAttempted && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Skapandeförfrågan har skickats. Uppgifterna är låsta för att ett nytt försök ska återanvända samma förfrågan utan att skapa en dubblett. Om svaret uteblev, försök igen med knappen nedan.</p>}
            <fieldset disabled={createAttempted} className="space-y-5">
            <label className="block text-sm font-medium">Organisationsnamn<input className={input} required maxLength={240} value={create.name} onChange={(event) => changeCreate({ name: event.target.value })} /></label>
            <label className="block text-sm font-medium">Organisationsnummer <span className="font-normal text-stone-500">(valfritt)</span><input className={input} maxLength={20} placeholder="XXXXXX-XXXX" value={create.organizationNumber} onChange={(event) => changeCreate({ organizationNumber: event.target.value })} /></label>
            <UserSelect users={index?.users ?? []} value={create.adminProfileId} onChange={(value) => changeCreate({ adminProfileId: value })} label="Första organisationsadministratör" />
            <label className="flex items-start gap-3 rounded-2xl bg-stone-50 p-4 text-sm"><input className="mt-1 size-4" type="checkbox" checked={create.modules.includes(TU)} onChange={(event) => changeCreate({ modules: toggleTu(create.modules, event.target.checked) })} /><span><strong className="block">Aktivera Tekniska utredningar (TU) för organisationen</strong><span className="mt-1 block text-stone-600">Ger inte administratören TU-behörighet automatiskt. Tilldela den separat under Medlemmar efter att organisationen har skapats.</span></span></label>
            <p className="text-sm text-stone-500">I detta steg hanteras TU. ÖB och EB lämnas oförändrade.</p>
            </fieldset>
            <button type="submit" className={primary}>{busy ? 'Skapar…' : createAttempted ? 'Försök skapa igen med samma uppgifter' : 'Granska och skapa organisation'}</button>
          </fieldset></form>
        </section>}

        {detail && !create && <>
          <section className={`${card} border-stone-400`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Vald organisation</p>
            <h2 className="mt-2 break-words text-2xl font-semibold">{detail.organization.name}</h2>
            <p className="mt-2 text-sm text-stone-600">Org.nr: {detail.organization.organizationNumber || 'Inte angivet'}</p>
            <p className="mt-3 text-sm text-stone-600">Företagsprofil och Fortnox hanteras av organisationens administratör under Inställningar → Organisation.</p>
            <button className={`${button} mt-4`} disabled={busy} onClick={() => { if (mayLeave()) { pendingEdits.current = null; setError(''); setNotice(''); void loadDetail(detail.organization.id) } }}>Ladda om organisationen</button>
          </section>

          <section className={card}>
            <h3 className="text-lg font-semibold">Organisationens moduler</h3>
            <p className="mt-2 text-sm text-stone-600">Modulen måste vara aktiverad här innan den kan tilldelas en medlem. ÖB och EB ändras inte i denna vy.</p>
            {!detail.organization.tuManaged && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Äldre modulhantering: organisationsstyrt TU-val är ännu inte fastställt. Äldre globala behörigheter kan finnas. Välj om TU ska vara aktivt och fastställ valet innan du tilldelar TU till medlemmar.</p>}
            <fieldset disabled={busy}>
              <label className="mt-4 flex items-center gap-3 text-sm font-medium"><input className="size-4" type="checkbox" checked={modules.includes(TU)} onChange={(event) => setModules(toggleTu(modules, event.target.checked))} />Tekniska utredningar (TU)</label>
              {moduleDirty && !modules.includes(TU) && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">TU-behörigheter tas bort och väntande TU-inbjudningar återkallas. Vid återaktivering behöver medlemmarna tilldelas TU igen.</p>}
              {(memberDirty || addDirty) && needsModuleSave && <p className="mt-3 text-sm text-amber-800">Spara eller återställ dina medlemsändringar innan du sparar organisationsmodulen.</p>}
              <div className="mt-4 flex flex-wrap gap-3"><button className={primary} onClick={() => void saveModules()} disabled={!needsModuleSave || memberDirty || addDirty}>{detail.organization.tuManaged ? 'Granska och spara moduler' : 'Granska och fastställ TU-val'}</button>{moduleDirty && <button className={button} onClick={() => setModules([...detail.organization.modules])}>Återställ modulval</button>}</div>
            </fieldset>
          </section>

          <section className={card}>
            <h3 className="text-lg font-semibold">Medlemmar i {detail.organization.name}</h3>
            <p className="mt-2 text-sm text-stone-600">Den sista aktiva administratören kan inte tas bort eller nedgraderas. Tilldela en annan administratör först.</p>
            {moduleDirty && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Spara eller återställ organisationsmodulen innan du sparar medlemskap.</p>}
            <div className="mt-5 space-y-4">
              {detail.members.map((member) => {
                const draft = drafts[member.profileId] ?? memberDraft(member)
                const changed = !sameMember(draft, memberBaselines[member.profileId] ?? member)
                const update = (patch: Partial<MemberDraft>) => setDrafts((current) => ({ ...current, [member.profileId]: { ...draft, ...patch } }))
                return <article key={member.profileId} className="rounded-2xl border border-stone-200 p-4">
                  <h4 className="break-words font-semibold">{member.displayName || member.email || member.profileId}</h4>
                  {member.email && <p className="mt-1 break-all text-sm text-stone-500">{member.email}</p>}
                  <fieldset disabled={busy} className="mt-4 space-y-4">
                    <label className="block text-sm font-medium">Roll för {member.displayName || member.email || member.profileId}<select className={input} value={draft.role} onChange={(event) => update({ role: event.target.value as Role })}><option value="inspector">Medlem / besiktningsman</option><option value="admin">Organisationsadministratör</option></select></label>
                    <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
                      <label className="flex items-center gap-2"><input className="size-4" type="checkbox" checked={draft.isActive} onChange={(event) => update({ isActive: event.target.checked, modules: event.target.checked ? draft.modules : [] })} />Aktivt medlemskap</label>
                      <label className="flex items-center gap-2"><input className="size-4" type="checkbox" disabled={!draft.isActive || (!enabledTu && !draft.modules.includes(TU))} checked={draft.modules.includes(TU)} onChange={(event) => update({ modules: toggleTu(draft.modules, event.target.checked) })} />TU-behörighet</label>
                    </div>
                    {!enabledTu && <p className="text-xs text-stone-500">TU måste först aktiveras och sparas för organisationen.</p>}
                    {draft.role === 'admin' && <p className="text-xs text-stone-600">Organisationsadministratören kan hantera företagets uppgifter, Fortnox och medlemmar.</p>}
                    {!draft.isActive && <p className="text-xs text-stone-600">Ett inaktivt medlemskap saknar arbetsbehörigheter. TU tilldelas inte automatiskt när medlemskapet aktiveras igen.</p>}
                    <div className="flex flex-wrap gap-3"><button className={primary} disabled={!changed || moduleDirty} onClick={() => void saveMember(member.profileId, draft, member)}>Granska och spara medlem</button>{changed && <button className={button} onClick={() => { update(memberDraft(member)); setMemberBaselines((current) => ({ ...current, [member.profileId]: memberDraft(member) })) }}>Återställ medlem</button>}</div>
                  </fieldset>
                </article>
              })}
              {detail.members.length === 0 && <p className="text-sm text-stone-500">Inga medlemmar ännu. Lägg till en befintlig användare som organisationsadministratör nedan.</p>}
            </div>
          </section>

          <section className={card}>
            <h3 className="text-lg font-semibold">Lägg till befintlig användare</h3>
            <p className="mt-2 text-sm text-stone-600">Användaren läggs till i {detail.organization.name}. Andra medlemskap påverkas inte. För en helt ny användare använder organisationsadministratören inbjudningsflödet under Inställningar → Organisation → Medlemmar.</p>
            <form className="mt-5" onSubmit={(event) => { event.preventDefault(); if (addProfileId) void saveMember(addProfileId, addDraft, null) }}>
              <fieldset disabled={busy || !index || Boolean(indexError)} className="space-y-4">
                <UserSelect key={detail.organization.id} users={availableUsers} value={addProfileId} onChange={setAddProfileId} label="Användare att lägga till" />
                <label className="block text-sm font-medium">Roll i organisationen<select className={input} value={addDraft.role} onChange={(event) => setAddDraft((current) => ({ ...current, role: event.target.value as Role }))}><option value="inspector">Medlem / besiktningsman</option><option value="admin">Organisationsadministratör</option></select></label>
                <label className="flex items-center gap-2 text-sm"><input className="size-4" type="checkbox" disabled={!enabledTu} checked={addDraft.modules.includes(TU)} onChange={(event) => setAddDraft((current) => ({ ...current, modules: toggleTu(current.modules, event.target.checked) }))} />Tilldela TU-behörighet</label>
                {!enabledTu && <p className="text-xs text-stone-500">TU är inte aktiverat för organisationen.</p>}
                <div className="flex flex-wrap gap-3"><button type="submit" className={primary} disabled={!addProfileId || moduleDirty}>Granska och lägg till medlem</button>{addDirty && <button type="button" className={button} onClick={() => { setAddProfileId(''); setAddDraft({ role: 'inspector', isActive: true, modules: [] }) }}>Återställ ny medlem</button>}</div>
              </fieldset>
            </form>
          </section>
        </>}
      </div>
    </div>
    {busy && <p role="status" className="mt-4 text-sm text-stone-600">Sparar och kontrollerar aktuella uppgifter…</p>}
  </main>
}
