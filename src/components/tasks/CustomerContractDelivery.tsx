'use client'

import { useState } from 'react'
import { Check, Download, ExternalLink, Loader2, Share2, Upload, X } from 'lucide-react'
import type { ContractSigningVersion } from '@/lib/action-cases/customerOffers'
import type { ActionCaseParticipantView } from '@/lib/action-cases/contracts'

export default function CustomerContractDelivery({ caseId, version, available, recipient, disabled, busy, customerUrl, onAction }: {
  caseId: string; version: ContractSigningVersion; available: boolean; recipient?: ActionCaseParticipantView | null
  disabled: boolean; busy: string; customerUrl: string
  onAction: (operation: string, extra?: Record<string, unknown>) => Promise<boolean>
}) {
  const [confirm, setConfirm] = useState<'share' | 'withdraw_share' | null>(null)
  const [file, setFile] = useState<File | null>(null), [checked, setChecked] = useState(false)
  const d = version.delivery, shared = Boolean(d?.sharedAt && !d.withdrawnAt)
  const button = 'gizmo-button inline-flex items-center justify-center gap-2 disabled:opacity-50'
  if (!available) return <p className="my-3 text-sm text-amber-800">Delning och underskriven kopia behöver aktiveras av administratören.</p>
  return <section className="my-4 border-b border-slate-200 pb-4" aria-label="Beställarens avtalsversion">
    <h3 className="font-semibold">Beställarens avtalsversion</h3>
    <p className="mt-2 text-sm">{shared ? `Version ${version.version} är delad med beställaren.` : 'Inte synligt för beställaren.'}</p>
    <p className="mt-1 text-sm text-slate-600">Mottagare: {recipient?.name || 'Saknas'}{recipient?.email ? ` · ${recipient.email}` : ''}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button className={button} disabled={disabled || !recipient?.name || !recipient.email} onClick={() => setConfirm('share')}><Share2 size={16} />{shared ? 'Hämta beställarlänk' : 'Dela med beställaren'}</button>
      {shared && <button className={button} disabled={disabled} onClick={() => setConfirm('withdraw_share')}><X size={16} /> Sluta dela</button>}
      {customerUrl && shared && <a className={button} href={customerUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Öppna beställarens sida</a>}
    </div>
    {customerUrl && shared && <label className="mt-3 block text-sm">Beställarlänk<input className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={customerUrl} readOnly onFocus={(event) => event.currentTarget.select()} /></label>}
    {confirm && <div role="alert" className="mt-3 border-l-2 border-teal-700 bg-slate-50 p-3 text-sm">
      <p>{confirm === 'share' ? `Dela låst version ${version.version} och dess bilagor med ${recipient?.name} (${recipient?.email})? Beställaren får PDF för underskrift, utan digital godkännandeknapp. Kopian på beställarlänken utelämnar personnummer. Inget mejl skickas.` : 'Dölja denna avtalsversion och dess bilagor på beställarens sida? Redan nedladdade kopior kan inte återkallas.'}</p>
      <div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={disabled} onClick={async () => {
        const done = await onAction(confirm, { id: version.id, confirmed: true, participantId: recipient?.id, recipientName: recipient?.name, recipientEmail: recipient?.email?.trim().toLowerCase() })
        if (done) setConfirm(null)
      }}>{busy === confirm ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}{confirm === 'share' ? 'Dela version och hämta länk' : 'Sluta dela'}</button>
        <button className={button} disabled={disabled} onClick={() => setConfirm(null)}><X size={16} /> Avbryt</button></div>
    </div>}
    <div className="mt-4 border-t border-slate-200 pt-3">
      <h3 className="font-semibold">Underskriven kopia</h3>
      {d?.signedCopy ? <>
        <p className="mt-2 flex items-start gap-2 text-sm"><Check size={16} className="shrink-0" />Registrerad {new Date(d.signedCopy.registeredAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}</p>
        <a className={`${button} mt-2`} href={`/api/action-cases/${caseId}/contract-signing/${version.id}/signed`} target="_blank" rel="noopener noreferrer"><Download size={16} /> Hämta underskriven kopia</a>
      </> : <>
        <label className="mt-2 block text-sm">Underskrivet avtal (PDF)<input type="file" accept="application/pdf,.pdf" className="mt-2 block max-w-full text-sm" disabled={disabled} onChange={(event) => { setFile(event.target.files?.[0] || null); setChecked(false) }} /></label>
        <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => setChecked(event.target.checked)} className="mt-0.5 shrink-0" />Jag har kontrollerat att samtliga beställare och entreprenören har skrivit under version {version.version}.</label>
        <button className={`${button} mt-3`} disabled={disabled || !file || !checked} onClick={async () => {
          if (await onAction('upload_signed', { id: version.id, file, confirmed: true })) { setFile(null); setChecked(false) }
        }}>{busy === 'upload_signed' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Registrera underskriven kopia</button>
        <p className="mt-2 text-sm text-slate-600">Underskrifterna kontrolleras manuellt. Kopian sparas internt och avtalsversionen förblir låst.</p>
      </>}
    </div>
  </section>
}
