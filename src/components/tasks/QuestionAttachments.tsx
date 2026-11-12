'use client'

import { useState } from 'react'
import { ExternalLink, FileText, FolderOpen, Plus, Search, Upload, X } from 'lucide-react'
import type { ActionCaseAttachmentView } from '@/lib/action-cases/contracts'
import type { QuestionFile, QuestionTask } from '@/lib/action-cases/projectQuestions'
import ActionCaseImageViewer, { ActionCaseAttachmentImage } from './ActionCaseImageViewer'
import QuestionDiaryImagePicker from './QuestionDiaryImagePicker'

export default function QuestionAttachments({ caseId, questionId, attachedIds, files, historicalFiles, projectFiles, task, disabled, readOnly, onChange, onUpload, onAttached, onWorking }: {
  caseId: string; questionId: string | null; attachedIds: string[]; files: ActionCaseAttachmentView[]; historicalFiles: QuestionFile[]; projectFiles: ActionCaseAttachmentView[]
  task?: QuestionTask; disabled: boolean; readOnly: boolean; onChange: (ids: string[]) => void; onUpload: () => void
  onAttached: (files: ActionCaseAttachmentView[]) => void; onWorking: (working: boolean) => void
}) {
  const [projectOpen, setProjectOpen] = useState(false), [search, setSearch] = useState(''), [openedId, setOpenedId] = useState<string | null>(null)
  const byId = new Map(files.map(file => [file.id, file]))
  const shared = new Set(task?.files.flatMap(file => file.sourceAttachmentId ? [file.sourceAttachmentId] : []) || [])
  const name = (id: string) => byId.get(id)?.fileName || historicalFiles.find(file => file.id === id)?.name || 'Bilagan är inte längre tillgänglig'
  const candidates = [...new Map(files.map(file => [file.id, file])).values()].filter(file => !file.isQuoteDocument && !attachedIds.includes(file.id) && `${file.title || ''} ${file.fileName}`.toLocaleLowerCase('sv').includes(search.toLocaleLowerCase('sv')))
  const previous = task?.files.filter(file => file.sourceAttachmentId && !attachedIds.includes(file.sourceAttachmentId)) || []
  function remove(id: string) {
    if (shared.has(id) && !window.confirm('Ta bort filen från frågans aktuella bilagor? Mottagarens redan delade kopia och historiken behålls.')) return
    onChange(attachedIds.filter(value => value !== id))
  }
  return <section className="gizmo-question-attachments" aria-label="Bifogade filer">
    <div className="gizmo-question-attachment-heading"><h3>Bifogade filer <span>{attachedIds.length}</span></h3></div>
    {!readOnly && <div className="gizmo-question-attachment-sources">
      <button type="button" className="gizmo-button" aria-expanded={projectOpen} disabled={disabled || attachedIds.length >= 20} onClick={() => setProjectOpen(value => !value)}><FolderOpen size={17} />Från projektet</button>
      {questionId && <QuestionDiaryImagePicker key={questionId} caseId={caseId} questionId={questionId} buttonLabel="Från bildbanken" projectFiles={projectFiles.filter(file => !attachedIds.includes(file.id) && !file.isQuoteDocument)} remaining={20 - attachedIds.length} disabled={disabled} onAttached={onAttached} onWorking={onWorking} />}
      <button type="button" className="gizmo-button" disabled={disabled || attachedIds.length >= 20} onClick={onUpload}><Upload size={17} />Ladda upp fil</button>
    </div>}
    {projectOpen && !readOnly && <div className="gizmo-question-project-picker">
      <div className="gizmo-question-attachment-heading"><h4>Filer i projektet</h4><button type="button" className="gizmo-button gizmo-icon-button" title="Stäng projektfiler" aria-label="Stäng projektfiler" disabled={disabled} onClick={() => setProjectOpen(false)}><X size={16} /></button></div>
      <label className="gizmo-question-attachment-search"><Search size={16} /><span className="sr-only">Sök projektfil</span><input className="gizmo-question-field" value={search} onChange={e => setSearch(e.target.value)} placeholder="Sök projektfil" /></label>
      <ul>{candidates.map(file => <li key={file.id}><span>{file.fileName}</span><a href={`/api/action-cases/${caseId}/attachments/${file.id}`} target="_blank" rel="noreferrer" title={`Öppna ${file.fileName}`} aria-label={`Öppna ${file.fileName}`}><ExternalLink size={16} /></a><button type="button" className="gizmo-button gizmo-icon-button" title={`Bifoga ${file.fileName}`} aria-label={`Bifoga ${file.fileName}`} disabled={disabled || attachedIds.length >= 20} onClick={() => onChange([...attachedIds, file.id])}><Plus size={17} /></button></li>)}</ul>
      {!candidates.length && <p className="gizmo-secondary">Inga fler matchande projektfiler.</p>}
    </div>}
    {attachedIds.length ? <ul className="gizmo-question-attached-list">{attachedIds.map(id => {
      const file = byId.get(id), image = file?.type === 'image'
      return <li key={id}>
        {image ? <button type="button" className="gizmo-question-thumbnail" aria-label={`Granska ${name(id)}`} title="Granska bild" onClick={() => setOpenedId(id)}><ActionCaseAttachmentImage caseId={caseId} file={file} /></button> : <FileText size={21} aria-hidden="true" />}
        <div className="gizmo-question-attachment-name"><strong>{name(id)}</strong><span className="gizmo-secondary">{projectFiles.some(f => f.id === id) ? 'Från projektet' : 'Tillagd till frågan'}</span></div>
        <span className={`gizmo-question-file-sharing${shared.has(id) ? ' is-shared' : ''}`}>{task && !task.awaitingDispatch && shared.has(id) ? `Delad med ${task.assigneeName}` : task && !task.awaitingDispatch ? `Inte delad med ${task.assigneeName}` : 'Inte skickad'}</span>
        {file && <a className="gizmo-question-file-open" href={`/api/action-cases/${caseId}/attachments/${id}`} target="_blank" rel="noreferrer" title={`Öppna ${name(id)}`} aria-label={`Öppna ${name(id)}`}><ExternalLink size={17} /></a>}
        {!readOnly && <button type="button" className="gizmo-button gizmo-icon-button" title={`Ta bort ${name(id)} från frågan`} aria-label={`Ta bort ${name(id)} från frågan`} disabled={disabled} onClick={() => remove(id)}><X size={17} /></button>}
      </li>
    })}</ul> : <p className="gizmo-secondary">Inga filer bifogade.</p>}
    {previous.length > 0 && <details className="gizmo-question-previous-files"><summary>Tidigare delade filer ({previous.length})</summary><ul>{previous.map(file => <li key={file.id}><a href={`/api/action-cases/${caseId}/questions/tasks/${task!.id}/files/${file.id}`} target="_blank" rel="noreferrer">{file.name}<ExternalLink size={15} /></a></li>)}</ul><p className="gizmo-secondary">Mottagaren har kvar dessa kopior.</p></details>}
    {openedId && files.some(file => file.id === openedId) && <ActionCaseImageViewer caseId={caseId} images={files.filter(file => attachedIds.includes(file.id) && file.type === 'image')} openedId={openedId} onOpen={setOpenedId} onClose={() => setOpenedId(null)} />}
  </section>
}
