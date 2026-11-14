'use client'

import { useState } from 'react'
import { ExternalLink, FileText, FolderOpen, Images, Loader2, Plus, RefreshCw, Search, Upload, X } from 'lucide-react'
import type { ActionCaseAttachmentView } from '@/lib/action-cases/contracts'
import { INSTRUCTION_MAX_FILES, instructionFileKey, type InstructionFile, type InstructionFileRef } from '@/lib/action-cases/workInstructions'
import { projectLibraryImages } from '@/lib/action-cases/projectImageLibrary'
import ActionCaseImageViewer, { ActionCaseAttachmentImage } from './ActionCaseImageViewer'
import { useDiaryImages } from './useDiaryImages'

export function WorkInstructionFileList({ caseId, refs, files, onRemove, disabled = false }: {
  caseId: string; refs: InstructionFileRef[]; files: InstructionFile[]; disabled?: boolean; onRemove?: (file: InstructionFileRef) => void
}) {
  const [opened, setOpened] = useState<string | null>(null)
  const byId = new Map(files.map(file => [file.id, file])), images = refs.flatMap(ref => { const file = byId.get(instructionFileKey(ref)); return file?.type === 'image' ? [file] : [] })
  return <>
    {refs.length ? <ul className="work-instruction-files">{refs.map(ref => {
      const key = instructionFileKey(ref), file = byId.get(key), name = file?.title || file?.fileName || (ref.source === 'diary' ? 'Bild från dagboken' : 'Projektfil')
      return <li key={key}>
        {file?.type === 'image' ? <button type="button" className="work-instruction-thumb" title={`Granska ${name}`} aria-label={`Granska ${name}`} onClick={() => setOpened(key)}><ActionCaseAttachmentImage caseId={caseId} file={file} src={file.url} /></button> : <FileText size={21} aria-hidden="true" />}
        <div className="work-instruction-file-name"><strong>{name}</strong><span>{ref.source === 'diary' ? 'Dagbok' : 'Projektfil'}</span></div>
        <a className="work-instruction-icon" href={file?.url || `/api/action-cases/${caseId}/${ref.source === 'diary' ? 'diary/photos' : 'attachments'}/${ref.id}`} target="_blank" rel="noreferrer" title={`Öppna ${name}`} aria-label={`Öppna ${name}`}><ExternalLink size={17} /></a>
        {onRemove && <button type="button" className="work-instruction-icon" title={`Ta bort ${name} från instruktionerna`} aria-label={`Ta bort ${name} från instruktionerna`} disabled={disabled} onClick={() => onRemove(ref)}><X size={17} /></button>}
      </li>
    })}</ul> : <p className="work-instruction-muted">Inga filer bifogade.</p>}
    {opened && images.some(file => file.id === opened) && <ActionCaseImageViewer caseId={caseId} images={images} openedId={opened} onOpen={setOpened} onClose={() => setOpened(null)} urlForFile={id => byId.get(id)!.url} />}
  </>
}

export default function WorkInstructionFiles({ caseId, refs, files, projectFiles, disabled, readOnly, onAdd, onRemove, onUpload }: {
  caseId: string; refs: InstructionFileRef[]; files: InstructionFile[]; projectFiles: ActionCaseAttachmentView[]; disabled: boolean; readOnly: boolean
  onAdd: (file: InstructionFile) => void; onRemove: (file: InstructionFileRef) => void; onUpload: () => void
}) {
  const [picker, setPicker] = useState<'project' | 'images' | null>(null), [search, setSearch] = useState(''), [opened, setOpened] = useState<string | null>(null)
  const diary = useDiaryImages(caseId, picker === 'images')
  const project: InstructionFile[] = [...new Map([...projectFiles.map(file => ({ ...file, source: 'project' as const, sourceId: file.id, url: `/api/action-cases/${caseId}/attachments/${file.id}` })), ...files.filter(file => file.source === 'project')].map(file => [file.id, file])).values()]
  const library: InstructionFile[] = projectLibraryImages(caseId, project, diary.images).map(file => ({ ...file, sourceId: file.source === 'diary' ? file.id.slice(6) : file.id }))
  const selected = new Set(refs.map(instructionFileKey)), candidates = (picker === 'images' ? library : project).filter(file => !selected.has(file.id) && `${file.title || ''} ${file.fileName}`.toLocaleLowerCase('sv').includes(search.toLocaleLowerCase('sv')))
  const full = refs.length >= INSTRUCTION_MAX_FILES, byId = new Map(library.map(file => [file.id, file]))
  return <section className="work-instruction-attachments" aria-label="Instruktionernas bifogade filer">
    <h3>Bifogade filer <span className="work-instruction-muted">{refs.length}</span></h3>
    {!readOnly && <div className="work-instruction-tools">
      <button type="button" className="gizmo-button" title={full ? 'Högst 50 bilagor' : 'Ladda upp filer, högst 25 MB per fil'} disabled={disabled || full} onClick={onUpload}><Upload size={17} />Ladda upp</button>
      <button type="button" className="gizmo-button" aria-expanded={picker === 'project'} disabled={disabled || full} onClick={() => { setPicker(picker === 'project' ? null : 'project'); setSearch('') }}><FolderOpen size={17} />Från projektet</button>
      <button type="button" className="gizmo-button" aria-expanded={picker === 'images'} disabled={disabled || full} onClick={() => { setPicker(picker === 'images' ? null : 'images'); setSearch('') }}><Images size={17} />Från bildbanken</button>
    </div>}
    {picker && !readOnly && <section className="work-instruction-picker" aria-label={picker === 'images' ? 'Välj bild' : 'Välj projektfil'}>
      <header><h4>{picker === 'images' ? 'Bildbanken' : 'Projektfiler'}</h4><button type="button" className="work-instruction-icon" title="Stäng filväljaren" aria-label="Stäng filväljaren" onClick={() => setPicker(null)}><X size={17} /></button></header>
      <label className="work-instruction-search"><Search size={17} /><span className="sr-only">Sök bland filer</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Sök bland filer" /></label>
      {picker === 'images' && diary.loading && <p role="status" className="work-instruction-muted"><Loader2 size={16} className="inline animate-spin" />Hämtar dagboksbilder…</p>}
      {picker === 'images' && diary.error && <div role="alert"><p>{diary.error}</p><button type="button" className="gizmo-button" disabled={diary.loading} onClick={() => void diary.retry()}><RefreshCw size={16} />Försök igen</button></div>}
      <ul className={picker === 'images' ? 'work-instruction-image-grid' : 'work-instruction-candidates'}>{candidates.map(file => <li key={file.id}>
        {picker === 'images' ? <button type="button" className="work-instruction-preview" title={`Granska ${file.fileName}`} aria-label={`Granska ${file.fileName}`} onClick={() => setOpened(file.id)}><ActionCaseAttachmentImage caseId={caseId} file={file} src={file.url} /></button> : <FileText size={18} aria-hidden="true" />}
        <span title={file.fileName}>{file.title || file.fileName}</span>
        <button type="button" className="work-instruction-icon" title={`Bifoga ${file.fileName}`} aria-label={`Bifoga ${file.fileName}`} disabled={disabled || full} onClick={() => onAdd(file)}><Plus size={17} /></button>
      </li>)}</ul>
      {!candidates.length && !(picker === 'images' && diary.loading) && <p className="work-instruction-muted">Inga fler matchande filer.</p>}
      {picker === 'images' && diary.nextCursor && <button type="button" className="gizmo-button" disabled={diary.loading} onClick={() => void diary.more()}><Plus size={17} />Visa fler dagboksbilder</button>}
    </section>}
    <WorkInstructionFileList caseId={caseId} refs={refs} files={files} disabled={disabled} onRemove={readOnly ? undefined : onRemove} />
    {opened && library.some(file => file.id === opened) && <ActionCaseImageViewer caseId={caseId} images={library} openedId={opened} onOpen={setOpened} onClose={() => setOpened(null)} urlForFile={id => byId.get(id)!.url} />}
  </section>
}
