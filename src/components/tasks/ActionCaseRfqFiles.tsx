'use client'

import { useState } from 'react'
import { Download, FileText } from 'lucide-react'
import type { RfqFile } from '@/lib/action-cases/rfqDelivery'
import type { ActionCaseAttachmentView } from '@/lib/action-cases/contracts'
import ActionCaseImageViewer, { ActionCaseAttachmentImage } from './ActionCaseImageViewer'

export default function ActionCaseRfqFiles({ files, token }: { files: RfqFile[]; token: string }) {
  const [openedId, setOpenedId] = useState<string | null>(null)
  const url = (id: string) => `/api/action-cases/rfq/${encodeURIComponent(token)}/files/${id}`
  const images: ActionCaseAttachmentView[] = files.filter((file) => file.type === 'image').map((file) => ({
    ...file, actionCaseItemId: null, title: null, grantedParticipantIds: [], createdAt: '',
  }))
  if (!files.length) return null
  return <section className="border-t border-slate-200 py-6" aria-label="Bilder och dokument">
    <h2 className="mb-4 text-lg font-semibold">Bilder och dokument <span className="font-normal text-slate-500">{files.length}</span></h2>
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {images.map((file) => <li key={file.id} className="min-w-0 overflow-hidden rounded-lg border border-slate-200">
        <button type="button" className="relative block aspect-[4/3] w-full bg-slate-50" aria-label={`Granska ${file.fileName}`} onClick={() => setOpenedId(file.id)}><ActionCaseAttachmentImage caseId="" file={file} src={url(file.id)} /></button>
        <div className="flex items-center gap-2 pl-3"><span className="min-w-0 flex-1 break-all py-2 text-xs">{file.fileName}</span><a href={`${url(file.id)}?download=1`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-violet-700" aria-label={`Ladda ner ${file.fileName}`} title="Ladda ner original"><Download size={18} /></a></div>
      </li>)}
    </ul>
    <ul className="mt-3 divide-y divide-slate-200">{files.filter((file) => file.type !== 'image').map((file) => <li key={file.id} className="flex min-w-0 items-center gap-3 py-2"><FileText size={20} className="shrink-0 text-slate-500" /><a href={url(file.id)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 break-all py-3 text-sm text-violet-700 underline">{file.fileName}</a><a href={`${url(file.id)}?download=1`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-violet-700" aria-label={`Ladda ner ${file.fileName}`} title="Ladda ner original"><Download size={18} /></a></li>)}</ul>
    {openedId ? <ActionCaseImageViewer caseId="" images={images} openedId={openedId} onOpen={setOpenedId} onClose={() => setOpenedId(null)} urlForFile={url} /> : null}
  </section>
}
