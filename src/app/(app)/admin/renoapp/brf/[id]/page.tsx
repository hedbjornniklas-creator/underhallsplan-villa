'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, Mail, RefreshCw, Save, Trash2, UserPlus, X } from 'lucide-react'
import { BRF_ADMIN_FIELDS, type BrfAdminDetail } from '@/lib/renoapp/brfAdminTypes'
import { getBrfVisibilityLabel } from '@/lib/renoapp/brfLifecycle'

const TABS = ['Översikt', 'Föreningsuppgifter', 'Användare och inbjudningar', 'Historik'] as const
const INPUT = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 disabled:bg-slate-50'
const BUTTON = 'inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-md bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50'
const EVENT_LABELS: Record<string, string> = {
  brf_created: 'Förening skapad', brf_activated: 'Förening aktiverad', brf_updated: 'Föreningsuppgifter uppdaterade',
  member_added: 'Medlemskap aktiverat', member_removed: 'Medlemskap och styrelseåtkomst borttagna',
  member_access_restored: 'Styrelsebehörighet återställd',
  invite_created: 'Inbjudan skapad', invite_accepted: 'Inbjudan accepterad', invite_revoked: 'Inbjudan återkallad',
  invite_delivery: 'Mejlleverans uppdaterad', request_approved: 'Intresseanmälan godkänd', request_rejected: 'Intresseanmälan avslagen',
}
const INVITE_LABELS = { open: 'Väntar på accept', accepted: 'Accepterad', expired: 'Utgången', revoked: 'Återkallad' }
const INVITE_KIND_LABELS = { brf_activation: 'Aktiveringslänk för föreningen', member_access: 'Personlig användarinbjudan' }
const DELIVERY_LABELS: Record<string, string> = { pending: 'Utskick ej bekräftat', sent: 'Mejl skickat', failed: 'Mejlet misslyckades', unknown: 'Leveransstatus saknas' }
function date(value: string | null) { return value ? new Date(value).toLocaleString('sv-SE') : '-' }

function ConfirmDialog({ title, busy, error, onCancel, onConfirm }: {
  title: string; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return <dialog ref={ref} aria-labelledby="confirm-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}
    className="m-auto max-w-md rounded-lg bg-white p-6 text-slate-950 shadow-xl backdrop:bg-black/30" style={{ width: 'calc(100% - 2rem)' }}>
    <h2 id="confirm-title" className="break-words text-lg font-semibold">{title}</h2>
    {error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}
    <div className="mt-6 flex justify-end gap-3">
      <button autoFocus type="button" disabled={busy} onClick={onCancel} className={BUTTON}>Avbryt</button>
      <button type="button" disabled={busy} onClick={onConfirm} className={PRIMARY}>{busy ? 'Sparar...' : 'Bekräfta'}</button>
    </div>
  </dialog>
}

export default function BrfAdminPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<BrfAdminDetail | null>(null)
  const [tab, setTab] = useState<typeof TABS[number]>('Översikt')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [visibility, setVisibility] = useState('disabled')
  const [inviteForm, setInviteForm] = useState({ fullName: '', email: '' })
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; body: Record<string, unknown> } | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(`/api/renoapp/admin/brf/${id}`, { cache: 'no-store' })
    const result = await response.json() as BrfAdminDetail & { error?: string }
    if (!response.ok) throw new Error(result.error ?? 'Kunde inte läsa föreningen.')
    setData(result)
    setFields(Object.fromEntries(BRF_ADMIN_FIELDS.map(([key]) => [key, String(result.brf[key] ?? '')])))
    setNote(result.brf.internal_note ?? '')
    setVisibility(!result.brf.is_public_apply_enabled ? 'disabled' : result.brf.is_public_apply_listed ? 'listed' : 'direct_link')
  }, [id])
  useEffect(() => {
    setLoading(true)
    setError(null)
    void load().catch(e => setError(e instanceof Error ? e.message : 'Kunde inte läsa föreningen.')).finally(() => setLoading(false))
  }, [load])

  const mutate = async (body: Record<string, unknown>) => {
    if (busy) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      const response = await fetch(`/api/renoapp/admin/brf/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const result = await response.json() as { error?: string; invite?: { emailSent: boolean; emailError: string | null } }
      if (!response.ok) throw new Error(result.error ?? 'Kunde inte spara ändringen.')
      await load()
      setConfirm(null)
      if (body.action === 'invite') setInviteForm({ fullName: '', email: '' })
      if (result.invite && !result.invite.emailSent) setError('Inbjudan sparades, men mejlet kunde inte skickas. Försök med Skicka ny länk.')
      else setSuccess(result.invite ? 'Inbjudan skickad.' : 'Ändringen har sparats.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunde inte spara ändringen.') }
    finally { setBusy(false) }
  }

  if (loading) return <div className="p-6 text-sm text-slate-600">Laddar föreningen...</div>
  if (!data) return <div className="p-6"><Link href="/admin/renoapp/brf" className={BUTTON}><ArrowLeft size={16} /> BRF:er</Link><p role="alert" className="mt-4 text-red-800">{error}</p></div>
  const brf = data.brf
  const followup = data.invites.filter(invite => invite.state !== 'accepted' && invite.state !== 'revoked' && (invite.state === 'expired' || invite.deliveryStatus === 'failed' || invite.deliveryStatus === 'pending'))
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 text-slate-950 md:px-6">
      <Link href="/admin/renoapp/brf" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-950"><ArrowLeft size={16} /> BRF:er</Link>
      <header className="mt-5 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="min-w-0"><h1 className="break-words text-2xl font-semibold">{brf.name}</h1><p className="mt-1 text-sm text-slate-600">{brf.org_number} · {[brf.address, brf.city].filter(Boolean).join(', ')}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${brf.onboarding_completed_at ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>{brf.onboarding_completed_at ? 'Aktiv BRF' : 'Väntar på aktivering'}</span>
          {brf.is_public_apply_enabled && <Link href={`/renoapp/brf/${brf.slug}/apply`} target="_blank" className={BUTTON} title="Öppna boendes ansökningssida"><ExternalLink size={16} /> Ansökningssida</Link>}
        </div>
      </header>
      {error && <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
      {success && <p role="status" className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{success}</p>}
      <nav className="mt-4 flex flex-wrap gap-x-5 border-b border-slate-200" aria-label="Föreningsadministration">
        {TABS.map(item => <button type="button" key={item} onClick={() => setTab(item)} aria-current={tab === item ? 'page' : undefined} className={`border-b-2 py-3 text-sm font-medium ${tab === item ? 'border-emerald-700 text-emerald-900' : 'border-transparent text-slate-600 hover:text-slate-950'}`}>{item}</button>)}
      </nav>
      {tab === 'Översikt' && <div className="grid gap-8 py-6 lg:grid-cols-2">
        <section><h2 className="text-lg font-semibold">Anslutning</h2>
          <dl className="mt-4 grid grid-cols-[minmax(100px,1fr)_minmax(0,2fr)] gap-x-4 gap-y-3 text-sm">
            <dt className="text-slate-600">Skapad</dt><dd>{date(brf.created_at)}</dd>
            <dt className="text-slate-600">Skapande</dt><dd>{brf.onboarding_source === 'manual' ? 'Manuellt av HusHub' : brf.onboarding_source === 'request' || data.requests.length ? 'Intresseanmälan' : 'Tidigare registrering'}</dd>
            <dt className="text-slate-600">Aktiverad</dt><dd>{date(brf.onboarding_completed_at)}</dd>
            <dt className="text-slate-600">Villkorsversion</dt><dd>{brf.onboarding_terms_version ?? '-'}</dd>
            <dt className="text-slate-600">Villkor accepterade</dt><dd>{date(brf.onboarding_terms_accepted_at)}</dd>
            <dt className="text-slate-600">Företrädare</dt><dd>{[brf.onboarding_signatory_name, brf.onboarding_signatory_role].filter(Boolean).join(', ') || '-'}</dd>
            <dt className="text-slate-600">Aktiveringslänk skickad till</dt><dd className="break-all">{brf.onboarding_signatory_email ?? '-'}</dd>
            <dt className="text-slate-600">Medlemmar</dt><dd>{data.members.length}</dd>
            <dt className="text-slate-600">Renoveringsärenden</dt><dd>{data.caseCount}</dd>
            <dt className="text-slate-600">Boendes ansökningar</dt><dd>{getBrfVisibilityLabel({ isPublicApplyEnabled: brf.is_public_apply_enabled, isPublicApplyListed: brf.is_public_apply_listed })}</dd>
          </dl>
          {data.requests.length > 0 && <Link href="/admin/renoapp/brf-requests" className="mt-4 inline-flex text-sm font-medium text-emerald-800 underline">Intresseanmälningar</Link>}
          {followup.length > 0 && <button type="button" onClick={() => setTab('Användare och inbjudningar')} className="mt-5 block rounded-md border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-950">{followup.length} {followup.length === 1 ? 'inbjudan' : 'inbjudningar'} behöver följas upp</button>}
        </section>
        <section><h2 className="text-lg font-semibold">Boendes ansökningar</h2>
          <form onSubmit={event => { event.preventDefault(); void mutate({ action: 'save_visibility', mode: visibility }) }} className="mt-4">
            <fieldset disabled={busy || !brf.onboarding_completed_at} className="space-y-3">
              {([['listed', 'Publikt sökbar'], ['direct_link', 'Endast direktlänk'], ['disabled', 'Avstängd för nya ansökningar']] as const).map(([value, label]) => <label key={value} className="flex items-center gap-3 text-sm"><input type="radio" name="visibility" value={value} checked={visibility === value} onChange={() => setVisibility(value)} className="h-4 w-4 accent-emerald-800" />{label}</label>)}
              <button className={`${PRIMARY} mt-4`} type="submit"><Save size={16} /> Spara tillgänglighet</button>
            </fieldset>
          </form>
          <form className="mt-8" onSubmit={event => { event.preventDefault(); void mutate({ action: 'save_note', note }) }}>
            <label className="block text-sm font-semibold" htmlFor="internal-note">Intern anteckning · endast HusHub</label>
            <textarea id="internal-note" value={note} onChange={event => setNote(event.target.value)} disabled={busy} rows={5} className={INPUT} />
            <button type="submit" disabled={busy} className={`${BUTTON} mt-3`}><Save size={16} /> Spara anteckning</button>
          </form>
        </section>
      </div>}
      {tab === 'Föreningsuppgifter' && <form className="py-6" onSubmit={event => { event.preventDefault(); void mutate({ action: 'save_details', fields }) }}>
        <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
          {BRF_ADMIN_FIELDS.map(([key, label]) => <label key={key} className="block min-w-0 text-sm font-medium">{label}<input type={key.includes('email') ? 'email' : key === 'unit_count' ? 'number' : 'text'} min={key === 'unit_count' ? 1 : undefined} step={key === 'unit_count' ? 1 : undefined} required={key === 'name' || key === 'org_number'} value={fields[key] ?? ''} onChange={event => setFields(current => ({ ...current, [key]: event.target.value }))} className={INPUT} /></label>)}
        </fieldset>
        <button disabled={busy} type="submit" className={`${PRIMARY} mt-6`}><Save size={16} />{busy ? 'Sparar...' : 'Spara föreningsuppgifter'}</button>
      </form>}
      {tab === 'Användare och inbjudningar' && <div className="space-y-8 py-6">
        <section><h2 className="text-lg font-semibold">Styrelsemedlemmar</h2>
          {data.members.length === 0 ? <p className="mt-4 text-sm text-slate-600">Ingen styrelsemedlem har aktiverat sitt konto.</p> : <ul className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
            {data.members.map(member => <li key={member.profileId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0"><p className="break-words text-sm font-medium">{member.name ?? 'Namn saknas'}{member.profileId === data.viewerId ? ' (du)' : ''}</p><p className="break-all text-sm text-slate-600">{member.email}</p>{!member.hasAccess && <p className="mt-1 text-sm text-red-800">Saknar aktiv styrelsebehörighet</p>}</div>
              <div className="flex flex-wrap gap-2">
                {!member.hasAccess && <button type="button" disabled={busy} onClick={() => { setError(null); setConfirm({ title: `Återställ styrelsebehörighet för ${member.name ?? member.email}?`, body: { action: 'restore_member', profileId: member.profileId } }) }} className={BUTTON}><RefreshCw size={16} />Återställ behörighet</button>}
                <button type="button" disabled={busy || data.members.length <= 1 || member.profileId === data.viewerId} onClick={() => { setError(null); setConfirm({ title: `Ta bort medlemskap och styrelseåtkomst för ${member.name ?? member.email}?`, body: { action: 'remove_member', profileId: member.profileId } }) }} className={BUTTON} title="Ta bort medlemskap och styrelseåtkomst"><Trash2 size={16} /><span>Ta bort</span></button>
              </div>
            </li>)}
          </ul>}
        </section>
        <section><h2 className="text-lg font-semibold">Bjud in styrelsemedlem</h2>
          {!brf.onboarding_completed_at && <p className="mt-3 text-sm text-amber-900">Föreningen måste aktiveras innan personliga användarinbjudningar kan skickas.</p>}
          <form onSubmit={event => { event.preventDefault(); void mutate({ action: 'invite', ...inviteForm }) }} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 basis-56 text-sm font-medium">Namn<input required disabled={busy || !brf.onboarding_completed_at} value={inviteForm.fullName} onChange={event => setInviteForm(current => ({ ...current, fullName: event.target.value }))} className={INPUT} autoComplete="name" /></label>
            <label className="min-w-0 flex-1 basis-56 text-sm font-medium">E-post<input required type="email" disabled={busy || !brf.onboarding_completed_at} value={inviteForm.email} onChange={event => setInviteForm(current => ({ ...current, email: event.target.value }))} className={INPUT} autoComplete="email" /></label>
            <button type="submit" disabled={busy || !brf.onboarding_completed_at} className={PRIMARY}><UserPlus size={16} /> Skicka inbjudan</button>
          </form>
        </section>
        <section><h2 className="text-lg font-semibold">Inbjudningar</h2>
          {data.invites.length === 0 ? <p className="mt-3 text-sm text-slate-600">Inga inbjudningar.</p> : <ul className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
            {data.invites.map(invite => <li key={invite.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
              <div className="min-w-0 flex-1 basis-64"><p className="text-xs font-semibold uppercase text-slate-500">{INVITE_KIND_LABELS[invite.kind]}</p><p className="mt-1 break-words text-sm font-medium">{invite.fullName ?? (invite.kind === 'brf_activation' ? 'Föreningens kontaktperson' : 'Styrelsemedlem')}</p><p className="break-all text-sm">{invite.email}</p><div className="mt-2 flex flex-wrap gap-2 text-xs"><span className={`rounded border px-2 py-1 ${invite.state === 'accepted' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : invite.state === 'expired' ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-slate-200 bg-slate-50'}`}>{INVITE_LABELS[invite.state]}</span><span className={`inline-flex items-center gap-1 ${invite.deliveryStatus === 'failed' ? 'text-red-800' : 'text-slate-600'}`}><Mail size={13} />{DELIVERY_LABELS[invite.deliveryStatus] ?? 'Okänd leveransstatus'}</span></div><p className="mt-2 text-xs text-slate-600">Giltig till {date(invite.expiresAt)}</p></div>
              {invite.state !== 'accepted' && invite.state !== 'revoked' && <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void mutate({ action: 'resend_invite', inviteId: invite.id })} title="Skicka en ny länk och ersätt den tidigare länken" className={BUTTON}><RefreshCw size={16} />Skicka ny länk</button><button type="button" disabled={busy} onClick={() => setConfirm({ title: `Återkalla inbjudan till ${invite.email}?`, body: { action: 'revoke_invite', inviteId: invite.id } })} title="Återkalla inbjudan" aria-label={`Återkalla inbjudan till ${invite.email}`} className={BUTTON}><X size={16} /></button></div>}
            </li>)}
          </ul>}
        </section>
      </div>}
      {tab === 'Historik' && <section className="py-6"><h2 className="text-lg font-semibold">Senaste händelser</h2>
        {data.events.length === 0 ? <p className="mt-4 text-sm text-slate-600">Ingen registrerad historik.</p> : <ol className="mt-3 divide-y divide-slate-200">
          {data.events.map(event => <li key={event.id} className="grid gap-1 py-4 text-sm md:grid-cols-[180px_minmax(0,1fr)]"><time className="text-slate-600">{date(event.createdAt)}</time><div className="min-w-0"><p className="font-medium">{EVENT_LABELS[event.kind] ?? 'Föreningshändelse'}</p><p className="text-slate-600">{event.actor ?? 'Systemet'}</p>{typeof event.details.email === 'string' && <p className="break-all">{event.details.email}</p>}{typeof event.details.deliveryStatus === 'string' && <p>{DELIVERY_LABELS[event.details.deliveryStatus] ?? event.details.deliveryStatus}</p>}</div></li>)}
        </ol>}
      </section>}
      {confirm && <ConfirmDialog title={confirm.title} busy={busy} error={error} onCancel={() => setConfirm(null)} onConfirm={() => void mutate(confirm.body)} />}
    </main>
  )
}
