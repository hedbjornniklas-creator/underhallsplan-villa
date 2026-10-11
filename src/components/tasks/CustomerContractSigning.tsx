'use client'

import { useState } from 'react'
import { Download, FilePlus2, LockKeyhole, Loader2, X } from 'lucide-react'
import { activeSigningVersion } from '@/lib/action-cases/contractSigning'
import type { ContractSigningVersion } from '@/lib/action-cases/customerOffers'

export default function CustomerContractSigning({ caseId, available, versions = [], disabled, accepted, busy, issues, onFreeze, onNewDraft }: {
  caseId: string; available: boolean; versions?: ContractSigningVersion[]; disabled: boolean; accepted: boolean; busy: string;
  issues: string[]; onFreeze: () => Promise<boolean>; onNewDraft: (id: string) => Promise<boolean>
}) {
  const [confirm, setConfirm] = useState<'freeze' | 'new_draft' | null>(null)
  const active = activeSigningVersion(versions)
  const blocked = disabled || accepted
  const button = 'gizmo-button inline-flex items-center justify-center gap-2 disabled:opacity-50'
  const fileUrl = (id: string, file: string) => `/api/action-cases/${caseId}/contract-signing/${id}/${file}`
  return <section className="my-4 border-y border-slate-200 py-4" aria-label="PDF och signering">
    <h3 className="font-semibold">PDF och signering</h3>
    {!available ? <p className="mt-2 text-sm text-amber-800">Låsning och PDF behöver aktiveras av administratören. Utkastet är kvar.</p> : <>
      {active ? <>
        <p className="mt-2 flex items-center gap-2 text-sm"><LockKeyhole size={16} /> Version {active.version} · Låst för signering</p>
        <p className="mt-1 text-sm text-slate-600">Inte registrerat som signerat.</p>
        {!accepted && <button className={`${button} mt-3`} disabled={disabled} onClick={() => setConfirm('new_draft')}><FilePlus2 size={16} /> Skapa nytt utkast</button>}
      </> : !accepted && <>
        <button className={`${button} mt-3`} disabled={blocked || issues.length > 0} onClick={() => setConfirm('freeze')}><LockKeyhole size={16} /> Lås för signering</button>
        {issues.length > 0 && <details className="mt-2 text-sm"><summary className="cursor-pointer text-amber-800">{issues.length} saker kvar inför låsning</summary><ul className="mt-2 space-y-1">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></details>}
      </>}
      {confirm && <div className="mt-3 border-l-2 border-teal-700 bg-slate-50 p-3 text-sm" role="alert">
        <p>{confirm === 'freeze' ? 'Låsa den sparade avtalsversionen och skapa PDF för underskrift? Texter, priser, betalningsplan och valda bilagor låses. Inget mejl skickas och inget godkännande registreras.' : 'Skapa ett nytt redigerbart utkast? Den gamla PDF-versionen och dess bilagor behålls oförändrade. Det nya utkastet behöver låsas igen före signering.'}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={button} disabled={blocked || (confirm === 'freeze' && issues.length > 0)} onClick={async () => {
            const done = confirm === 'freeze' ? await onFreeze() : active ? await onNewDraft(active.id) : false
            if (done) setConfirm(null)
          }}>{busy === confirm ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={16} />}{confirm === 'freeze' ? 'Lås och skapa PDF' : 'Skapa nytt utkast'}</button>
          <button className={button} disabled={Boolean(busy)} onClick={() => setConfirm(null)}><X size={16} /> Avbryt</button>
        </div>
      </div>}
      {versions.map((version) => <div key={version.id} className="mt-3 border-t border-slate-200 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">Version {version.version} · {version.releasedAt ? 'Tidigare version' : 'Låst för signering'}</span>
          <a className={button} href={fileUrl(version.id, 'pdf')} target="_blank" rel="noopener noreferrer"><Download size={16} /> Hämta PDF</a></div>
        {version.files.length > 0 && <details className="mt-2 text-sm"><summary className="cursor-pointer">Låsta bilagor ({version.files.length})</summary>
          <ul className="mt-2 space-y-2">{version.files.map((file) => <li key={file.id}><a className="inline-flex items-start gap-2 break-all text-teal-800 underline" href={fileUrl(version.id, file.id)} target="_blank" rel="noopener noreferrer"><Download size={15} className="mt-0.5 shrink-0" />{file.fileName}</a></li>)}</ul>
        </details>}
      </div>)}
    </>}
  </section>
}
