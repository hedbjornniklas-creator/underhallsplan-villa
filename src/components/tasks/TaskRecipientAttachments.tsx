'use client'

import { useState, type ReactNode } from 'react'
import { ChevronRight, FileText, Mic } from 'lucide-react'
import { formatTaskDateTime } from '@/lib/tasks/dateTime'
import type { ExternalTaskWorkspace } from '@/lib/tasks/external'
import ActionCaseImageViewer, { ActionCaseAttachmentImage } from './ActionCaseImageViewer'

type Attachment = ExternalTaskWorkspace['task']['attachments'][number]
type Props = {
  attachments: Attachment[]
  endpoint: string
  timeZone: string
  renderTranscript: (attachment: Attachment) => ReactNode
}

export default function TaskRecipientAttachments({ attachments, endpoint, timeZone, renderTranscript }: Props) {
  const [openedId, setOpenedId] = useState<string | null>(null)
  const images = attachments.filter(file => file.type === 'photo').map(file => ({
    id: file.id, title: file.title, fileName: file.fileName || file.title || 'Bild',
  }))
  const url = (id: string) => `${endpoint}/attachments/${encodeURIComponent(id)}`
  return <>
    {images.length > 0 ? <ul className="gizmo-recipient-photos" aria-label="Bilder">
      {images.map(file => <li key={file.id}>
        <button type="button" onClick={() => setOpenedId(file.id)} aria-label={`Granska ${file.title || file.fileName}`} className="gizmo-recipient-photo">
          <ActionCaseAttachmentImage caseId="" file={file} src={url(file.id)} />
        </button>
        <p className="mt-2 break-words text-xs text-[#596368]">{file.title || file.fileName}</p>
      </li>)}
    </ul> : null}
    <div className="gizmo-recipient-files">
      {attachments.filter(file => file.type !== 'photo').map(attachment => {
        const content = <>
          {attachment.type === 'audio' ? <Mic size={20} aria-hidden="true" className="shrink-0 text-[#206961]" /> : <FileText size={20} aria-hidden="true" className="shrink-0 text-[#206961]" />}
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-semibold">{attachment.title || attachment.fileName || (attachment.type === 'audio' ? 'Röstmeddelande' : 'Textunderlag')}</span>
            <span className="mt-1 block text-xs text-[#596368]">{formatTaskDateTime(attachment.createdAt, timeZone, 'compact')}{attachment.isCompletionEvidence ? ' · Färdigbevis' : ''}</span>
          </span>
          {attachment.type !== 'text' ? <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-[#596368]" /> : null}
        </>
        return <article key={attachment.id} className="border-b border-[#D5DCDD] last:border-0">
          {attachment.type === 'text' ? <div className="flex items-center gap-3 py-3">{content}</div> : <a href={url(attachment.id)} target="_blank" rel="noreferrer" className="flex min-h-12 items-center gap-3 py-3 hover:bg-[#F1F6F5]">{content}</a>}
          {attachment.textContent ? <p className="whitespace-pre-wrap pb-3 text-sm leading-6">{attachment.textContent}</p> : null}
          {renderTranscript(attachment)}
        </article>
      })}
    </div>
    {openedId && images.some(file => file.id === openedId) ? <ActionCaseImageViewer caseId="" images={images} openedId={openedId} onOpen={setOpenedId} onClose={() => setOpenedId(null)} urlForFile={url} /> : null}
  </>
}
