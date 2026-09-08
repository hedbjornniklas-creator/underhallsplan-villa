'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { BESIKT_INVITE_MODULES, type BesiktInvitation, type BesiktInviteModule } from '@/lib/besiktapp/invitationContracts'
const field = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2'
export default function BesiktInvitationsAdmin() {
  const [items, setItems] = useState<BesiktInvitation[]>([])
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [org, setOrg] = useState('')
  const [orgName, setOrgName] = useState('')
  const [modules, setModules] = useState<BesiktInviteModule[]>([])
  const [review, setReview] = useState(false)
  const [actionReview, setActionReview] = useState<{ item: BesiktInvitation; action: 'resend' | 'revoke' } | null>(null)
  const requestId = useRef<string | null>(null)
  const inFlight = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      try {
        const response = await fetch(`/api/admin/besiktapp-invitations?page=${page}`, { signal: controller.signal, cache: 'no-store' })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
        if (!controller.signal.aborted) { setItems(result.items); setOrganizations(result.organizations); setTotal(result.total); setAvailable(true) }
      } catch (failure) { if (!controller.signal.aborted) { setAvailable(false); setError(failure instanceof Error ? failure.message : 'Kunde inte läsa inbjudningar.') } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load(); return () => controller.abort()
  }, [page, reload])
  async function send(payload: object) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/admin/besiktapp-invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      if ('action' in payload && payload.action === 'create') { setName(''); setEmail(''); setOrg(''); setOrgName(''); setModules([]) }
      setMessage(result.message); setReview(false); setActionReview(null); requestId.current = null; setReload(value => value + 1)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Begäran kunde inte bekräftas. Hämta listan innan du försöker igen.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  function prepare(event: FormEvent) {
    event.preventDefault()
    if (!modules.length) { setError('Välj minst ett arbetsområde.'); return }
    requestId.current ??= crypto.randomUUID(); setError(''); setReview(true)
  }
  const company = organizations.find(item => item.id === org)?.name ?? orgName
  return <main className="mx-auto max-w-5xl px-5 py-8 text-stone-900">
    <Link href="/admin/access/besiktapp-interest" className="underline">Till intresselistan</Link>
    <h1 className="mt-5 text-3xl font-semibold">Bjud in till BesiktApp</h1>
    <p className="mt-3 text-stone-600">För överenskommen tillgång till ett företag och valda arbetsområden. Befintlig BesiktApp-behörighet och andra företagskopplingar kräver manuell kontroll.</p>
    {error && <p role="alert" className="my-4 rounded-xl bg-red-50 p-4 text-red-900">{error}</p>}
    {message && <p role="status" className="my-4 rounded-xl bg-blue-50 p-4">{message}</p>}
    {loading && <p role="status">Hämtar inbjudningar…</p>}
    {available && <form onSubmit={prepare} className="my-6 rounded-xl border border-stone-200 bg-white p-5">
      <fieldset disabled={busy || review} className="grid gap-4 sm:grid-cols-2">
        <label>Namn<input className={field} value={name} onChange={event => { setName(event.target.value); requestId.current = null }} required maxLength={160} /></label>
        <label>E-post<input className={field} type="email" value={email} onChange={event => { setEmail(event.target.value); requestId.current = null }} required maxLength={254} /></label>
        <label>Företag<select className={field} value={org} onChange={event => { setOrg(event.target.value); requestId.current = null }}><option value="">Nytt företag</option>{organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {!org && <label>Det nya företagets namn<input className={field} value={orgName} onChange={event => { setOrgName(event.target.value); requestId.current = null }} required maxLength={160} /></label>}
        <div className="sm:col-span-2"><p className="mb-2 font-semibold">Arbetsområden</p>{Object.entries(BESIKT_INVITE_MODULES).map(([key, label]) => <label key={key} className="mb-2 flex items-center gap-2"><input type="checkbox" checked={modules.includes(key as BesiktInviteModule)} onChange={event => { setModules(previous => event.target.checked ? [...previous, key as BesiktInviteModule] : previous.filter(value => value !== key)); requestId.current = null }} />{label}</label>)}</div>
      </fieldset>
      {!review ? <button disabled={busy} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-white">Granska inbjudan</button> : <div className="mt-5 rounded-lg bg-stone-50 p-4">
        <h2 className="font-semibold">Kontrollera innan du skickar</h2><p>{name} · {email}</p><p>{company}</p><p>{modules.map(key => BESIKT_INVITE_MODULES[key]).join(', ')}</p><p className="my-2 text-sm">En personlig länk skickas till adressen ovan och gäller i sju dagar. Tillgång ges först när mottagaren accepterar. Inga administratörsbehörigheter ingår.</p>
        <button type="button" disabled={busy} className="mr-3 rounded-lg bg-slate-900 px-4 py-2 text-white" onClick={() => void send({ action: 'create', request_id: requestId.current, email: email.trim(), full_name: name.trim(), organization_id: org || null, organization_name: company.trim(), modules })}>{busy ? 'Skickar…' : 'Skicka inbjudan'}</button>
        <button type="button" disabled={busy} onClick={() => setReview(false)}>Ändra</button>
      </div>}
    </form>}
    <button disabled={busy} className="my-3 rounded-lg border px-4 py-2" onClick={() => { setError(''); setReload(value => value + 1) }}>Hämta listan igen</button>
    {available && !loading && <section aria-label="Skickade inbjudningar" className="grid gap-3">
      {!items.length && <p>Inga inbjudningar på den här sidan.</p>}
      {items.map(item => <article key={item.id} className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">{item.full_name}</h2><p className="break-all">{item.email} · {item.organization_name}</p>
        <p className="text-sm">{item.modules.map(key => BESIKT_INVITE_MODULES[key]).join(', ')}</p>
        <p className="my-2 text-sm">{item.status === 'accepted' ? 'Accepterad' : item.status === 'revoked' ? 'Återkallad' : Date.parse(item.expires_at) <= Date.now() ? 'Länken har gått ut' : `Väntar på mottagaren. Gäller till ${new Date(item.expires_at).toLocaleDateString('sv-SE')}.`}</p>
        {item.status === 'pending' && <><p className="text-sm">Mejl: {item.notification_state === 'accepted' ? 'accepterat av mejlleverantören' : 'utskick ej bekräftat'}</p><div className="mt-3 flex gap-4"><button disabled={busy} className="underline" onClick={() => setActionReview({ item, action: 'resend' })}>Skicka ny länk</button><button disabled={busy} className="text-red-800 underline" onClick={() => setActionReview({ item, action: 'revoke' })}>Återkalla</button></div></>}
        {actionReview?.item.id === item.id && <div className="mt-3 rounded-lg bg-amber-50 p-4"><p>{actionReview.action === 'resend' ? 'Den gamla länken slutar fungera och en ny skickas till samma mottagare.' : 'Mottagaren kommer inte längre att kunna aktivera tillgång med denna inbjudan.'}</p><button disabled={busy} className="mr-4 mt-3 font-semibold underline" onClick={() => void send({ action: actionReview.action, id: item.id, revision: item.revision })}>Bekräfta</button><button disabled={busy} onClick={() => setActionReview(null)}>Avbryt</button></div>}
      </article>)}
      <nav aria-label="Sidor med inbjudningar" className="flex gap-4"><button disabled={busy || page === 0} onClick={() => setPage(value => value - 1)}>Föregående</button><span>Sida {page + 1}</span><button disabled={busy || (page + 1) * 30 >= total} onClick={() => setPage(value => value + 1)}>Nästa</button></nav>
    </section>}
  </main>
}
