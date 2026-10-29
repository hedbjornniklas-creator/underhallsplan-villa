'use client'

import { useState } from 'react'
import { Download, FilePlus2, LockKeyhole, Loader2, X } from 'lucide-react'
import { activeSigningVersion } from '@/lib/action-cases/contractSigning'
import type { ContractSigningVersion } from '@/lib/action-cases/customerOffers'

export default function CustomerContractSigning({ caseId, available, versions = [], disabled, accepted, busy, revision, blockers, allowLock = true, onFreeze, onNewDraft, onWithdraw }: {
  caseId: string; available: boolean; versions?: ContractSigningVersion[]; disabled: boolean; accepted: boolean; busy: string;
  revision: number; blockers: string[]; allowLock?: boolean; onFreeze: () => Promise<boolean>; onNewDraft: (id: string) => Promise<boolean>
  onWithdraw?: (version: ContractSigningVersion) => Promise<boolean>
}) {
  const [confirm, setConfirm] = useState<'freeze' | 'new_draft' | null>(null)
  const [unsignedConfirmed, setUnsignedConfirmed] = useState(false)
  const active = activeSigningVersion(versions)
  const blocked = disabled || accepted
  const button = 'gizmo-button inline-flex items-center justify-center gap-2 disabled:opacity-50'
  const fileUrl = (id: string, file: string) => `/api/action-cases/${caseId}/contract-signing/${id}/${file}`
  const pdfUrl = active ? fileUrl(active.id, 'pdf') : `/api/action-cases/${caseId}/contract-signing/pdf?revision=${revision}`
  return <section className="my-4 border-y border-slate-200 py-4" aria-label="PDF och signering">
    <h3 className="font-semibold">PDF och signering</h3>
    <div className="mt-3 flex flex-wrap gap-2">
      {!active && blocked ? <button className={button} disabled title={accepted ? 'Avtalet är redan digitalt godkänt' : 'Väntar på att avtalet sparas'}><Download size={16} /> Hämta PDF för signering</button> :
        <a className={button} href={pdfUrl} target="_blank" rel="noopener noreferrer"><Download size={16} /> Hämta PDF för signering</a>}
      {available && allowLock && !active && !accepted && <button className={button} disabled={blocked || blockers.length > 0} onClick={() => setConfirm('freeze')}><LockKeyhole size={16} /> Lås för signering</button>}
    </div>
    {!available ? <p className="mt-2 text-sm text-amber-800">Låsning behöver aktiveras av administratören. Utkastet är kvar.</p> : <>
      {active ? <>
        <p className="mt-2 flex items-center gap-2 text-sm"><LockKeyhole size={16} /> Version {active.version} · Låst för signering</p>
        <p className="mt-1 text-sm text-slate-600">{active.delivery?.signedCopy ? 'Underskriven kopia registrerad.' : 'Inte registrerat som signerat.'}</p>
        {active.signedCopyTask && <p className="mt-2 text-sm"><a className="text-teal-800 underline" href={`/uppdrag?task=${active.signedCopyTask.id}`}>{active.delivery?.signedCopy ? 'Uppgiften för signerad kopia är slutförd' : 'Att göra: Ladda upp signerat avtal'}</a></p>}
        {!accepted && !active.delivery?.signedCopy && <button className={`${button} mt-3`} disabled={disabled} onClick={() => { setUnsignedConfirmed(false); setConfirm('new_draft') }}><FilePlus2 size={16} /> Skapa nytt utkast</button>}
      </> : !accepted && blockers.map((message) => <p key={message} className="mt-2 text-sm text-amber-800">{message}</p>)}
      {confirm && <div className="mt-3 border-l-2 border-teal-700 bg-slate-50 p-3 text-sm" role="alert">
        <p>{confirm === 'freeze' ? 'Låsa den sparade avtalsversionen och skapa PDF för underskrift? Texter, priser, betalningsplan och valda bilagor låses, liksom de kopplade momenten i Projektarbete och deras kalkyler. En intern uppgift skapas för att ladda upp den signerade PDF-kopian. Inget mejl skickas och inget godkännande registreras.' : 'Skapa ett nytt redigerbart utkast? Kopplade moment öppnas för redigering. Den gamla PDF-versionen och dess bilagor behålls oförändrade. Ett redan underskrivet avtal får inte öppnas på detta sätt.'}</p>
        {confirm === 'new_draft' && <label className="mt-3 flex items-start gap-2"><input type="checkbox" className="mt-1" checked={unsignedConfirmed} onChange={event => setUnsignedConfirmed(event.target.checked)} disabled={Boolean(busy)} />Jag bekräftar att denna avtalsversion inte har undertecknats.</label>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={button} disabled={blocked || (confirm === 'freeze' ? blockers.length > 0 : !unsignedConfirmed)} onClick={async () => {
            const done = confirm === 'freeze' ? await onFreeze() : active ? await onNewDraft(active.id) : false
            if (done) setConfirm(null)
          }}>{busy === confirm ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={16} />}{confirm === 'freeze' ? 'Lås och skapa PDF' : 'Skapa nytt utkast'}</button>
          <button className={button} disabled={Boolean(busy)} onClick={() => setConfirm(null)}><X size={16} /> Avbryt</button>
        </div>
      </div>}
      {versions.map((version) => <div key={version.id} className="mt-3 border-t border-slate-200 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">Version {version.version} · {version.releasedAt ? 'Tidigare version' : 'Låst för signering'}</span>
          <a className={button} href={fileUrl(version.id, 'pdf')} target="_blank" rel="noopener noreferrer"><Download size={16} /> Hämta PDF</a></div>
        {version.releasedAt && version.delivery?.sharedAt && !version.delivery.withdrawnAt && onWithdraw && <button className={`${button} mt-2`} disabled={disabled} onClick={() => {
          if (window.confirm(`Sluta dela äldre avtalsversion ${version.version}? Redan nedladdade kopior kan inte återkallas.`)) void onWithdraw(version)
        }}><X size={16} /> Sluta dela äldre version</button>}
        {version.files.length > 0 && <details className="mt-2 text-sm"><summary className="cursor-pointer">Låsta bilagor ({version.files.length})</summary>
          <ul className="mt-2 space-y-2">{version.files.map((file) => <li key={file.id}><a className="inline-flex items-start gap-2 break-all text-teal-800 underline" href={fileUrl(version.id, file.id)} target="_blank" rel="noopener noreferrer"><Download size={15} className="mt-0.5 shrink-0" />{file.fileName}</a></li>)}</ul>
        </details>}
      </div>)}
    </>}
  </section>
}
