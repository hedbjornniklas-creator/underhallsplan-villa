'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import type { ActionCaseAttachmentView } from '@/lib/action-cases/contracts'
import ActionCaseImageViewer, { ActionCaseAttachmentImage, actionCaseImageUrl } from './ActionCaseImageViewer'

type Props = {
  caseId?: string
  files: ActionCaseAttachmentView[]
  selectedIds: string[]
  inputName: string
  disabled: boolean
  onChange: (id: string, checked: boolean) => void
}

export default function ActionCaseAttachmentPicker({ caseId, files, selectedIds, inputName, disabled, onChange }: Props) {
  const [openedId, setOpenedId] = useState<string | null>(null)
  const images = caseId ? files.filter((file) => file.type === 'image') : []
  const documents = files.filter((file) => !caseId || file.type !== 'image')
  return <div className="mt-3 space-y-3" data-attachment-picker>
    {!files.length ? <p className="text-sm text-slate-500">Inga tillgängliga bilagor.</p> : null}
    {images.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {images.map((file) => <article key={file.id} className={`min-w-0 overflow-hidden rounded-md border ${selectedIds.includes(file.id) ? 'border-violet-600 ring-1 ring-violet-600' : 'border-slate-200'} bg-white`}>
        <button type="button" aria-label={`Granska ${file.fileName}`} title="Granska bild" onClick={() => setOpenedId(file.id)} className="relative block aspect-[4/3] w-full bg-slate-100 text-slate-500 focus-visible:outline-2 focus-visible:outline-violet-600 focus-visible:-outline-offset-2"><ActionCaseAttachmentImage caseId={caseId!} file={file} /></button>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 px-2 py-2 text-xs"><input name={inputName} type="checkbox" value={file.id} className="h-4 w-4 shrink-0 accent-violet-600" disabled={disabled} checked={selectedIds.includes(file.id)} onChange={(e) => onChange(file.id, e.target.checked)} /><span className="min-w-0 truncate" title={file.fileName}>{file.title || file.fileName}</span></label>
      </article>)}
    </div> : null}
    {documents.length ? <ul className="divide-y divide-slate-100">{documents.map((file) => <li className="flex min-w-0 items-center gap-2" key={file.id}>
      <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 text-sm"><input name={inputName} type="checkbox" value={file.id} className="h-4 w-4 shrink-0 accent-violet-600" disabled={disabled} checked={selectedIds.includes(file.id)} onChange={(e) => onChange(file.id, e.target.checked)} /><FileText size={18} className="shrink-0 text-slate-500" /><span className="min-w-0 break-words">{file.title || file.fileName}</span></label>
      {caseId ? <a className="inline-flex min-h-11 shrink-0 items-center text-sm text-violet-700 underline" aria-label={`Öppna ${file.fileName}`} href={actionCaseImageUrl(caseId, file.id)} target="_blank" rel="noreferrer">Öppna</a> : null}
    </li>)}</ul> : null}
    {caseId && openedId && images.some((image) => image.id === openedId) ? <ActionCaseImageViewer caseId={caseId} images={images} openedId={openedId} onOpen={setOpenedId} onClose={() => setOpenedId(null)} selection={{ selectedIds, disabled, onChange }} /> : null}
  </div>
}
