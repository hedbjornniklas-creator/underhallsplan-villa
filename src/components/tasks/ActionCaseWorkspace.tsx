'use client'

import { useEffect, useRef, useState } from 'react'
import PendingLink from '@/components/ui/PendingLink'
import {
  ArrowRight,
  Check,
  ChevronRight,
  ClipboardList,
  Eye,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Plus,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import type { ActionCaseItemView, ActionCaseView, ActionCaseWorkspace as Workspace } from '@/lib/action-cases/contracts'
import { supabase } from '@/lib/supabaseClient'
import ActionCaseImageBank from './ActionCaseImageBank'
import { isImageAttachment } from '@/lib/action-cases/attachmentImages'
import ActionCaseItemSheet from './ActionCaseItemSheet'
import ActionCaseRequestSheet, { ActionCaseRequestsPanel } from './ActionCaseQuoteRequests'
import { actionCaseItemCompletion, actionCaseCostCoverage } from '@/lib/action-cases/domain'
import type { TaskPerson } from '@/lib/tasks/contracts'
import ActionCaseProjectList from './ActionCaseProjectList'
import { projectUrl } from '@/lib/action-cases/projectNavigation'
import { mergeScopeSave } from '@/lib/action-cases/scopeDraft'
import { useActionScopeAutosave } from './useActionScopeAutosave'

type Props = {
  initialWorkspace: Workspace | null
  initialError: string | null
  people?: TaskPerson[]
  caseId?: string
  section?: 'work' | 'files' | 'hidden'
  onWorkspaceChange?: (workspace: Workspace) => void
  onBusyChange?: (busy: boolean) => void
  onDirtyChange?: (dirty: boolean) => void
  customerRefresh?: number
}

const ITEM_STATUS: Record<ActionCaseItemView['status'], string> = {
  scope_needed: 'Omfattning saknas', pricing_needed: 'Pris behövs',
  waiting_subcontractor: 'Väntar på UE', ready_for_quote: 'Klar för offert',
  offered: 'Offererad', approved: 'Godkänd', declined: 'Avböjd', scheduled: 'Planerad',
  in_progress: 'Pågår', ready_for_review: 'Klar för kontroll', completed: 'Slutförd', cancelled: 'Avbruten',
}

function nextAction(item: ActionCaseItemView) {
  if (!item.scope?.trim()) return 'Beskriv arbetets omfattning'
  if (item.lumpSum) return item.lumpSum.customerPrice === null ? 'Ange samlat kundpris' : item.lumpSum.verified ? 'Samlat pris kontrollerat' : 'Kontrollera det samlade priset'
  if (item.costLines.length) {
    const coverage = actionCaseCostCoverage(item.costLines)
    if (coverage.missingQuantity) return `Komplettera mängd på ${coverage.missingQuantity} rader`
    if (coverage.missingPrice) return `Inhämta pris för ${coverage.missingPrice} rader`
    if (coverage.unchecked) return `Kontrollera ${coverage.unchecked} kalkylrader`
  }
  if (!item.ownLaborReady) return 'Beräkna eget arbete'
  if (!item.materialPriceReady) return 'Kontrollera material och priser'
  if (item.requiresSubcontractor && !item.subcontractorPriceReady) return 'Begär eller registrera UE-pris'
  if (!item.wasteSolutionReady) return 'Välj avfallslösning'
  return 'Kontrollera kundpriset'
}

function completion(item: ActionCaseItemView) {
  return actionCaseItemCompletion(item)
}

function CreateCaseSheet({ busy, onClose, onCreate }: { busy: boolean; onClose: () => void; onCreate: (payload: Record<string, unknown>) => Promise<void> }) {
  const [form, setForm] = useState({ title: '', customerName: '', customerEmail: '', customerPhone: '', propertyAddress: '', sourceReference: '', description: '', siteVisitAt: '' })
  const [items, setItems] = useState([''])
  const dialog = useRef<HTMLDivElement>(null)
  const dirty = Object.values(form).some((value) => value.trim()) || items.some((item) => item.trim())
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  const close = () => {
    if (busy || (dirty && !window.confirm('Stäng utan att spara projektet?'))) return
    onClose()
  }
  return (
    <div ref={dialog} tabIndex={-1} className="fixed inset-0 z-50 flex items-end bg-slate-950/45 backdrop-blur-[2px] outline-none sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="new-action-case-title" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? []).filter((node) => node.getClientRects().length)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <div className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
          <h2 id="new-action-case-title" className="text-xl font-semibold text-slate-950">Nytt projekt</h2>
          <button type="button" disabled={busy} onClick={close} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label="Stäng"><X size={20} /></button>
        </header>
        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          <section>
            <h3 className="text-sm font-semibold text-slate-950">Projekt och objekt</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700 sm:col-span-2">Projektnamn *<input value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="Exempel: Tillbyggnad" className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100" /></label>
              <label className="text-sm font-medium text-slate-700 sm:col-span-2">Objektadress *<input value={form.propertyAddress} onChange={(e) => update('propertyAddress', e.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100" /></label>
              <label className="text-sm font-medium text-slate-700">Datum för platsbesök<input type="datetime-local" value={form.siteVisitAt} onChange={(e) => update('siteVisitAt', e.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
              <label className="text-sm font-medium text-slate-700">Referens till utlåtande<input value={form.sourceReference} onChange={(e) => update('sourceReference', e.target.value)} placeholder="Rapportnummer eller länk" className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
            </div>
          </section>
          <section className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="text-sm font-semibold text-slate-950">Beställare</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">Namn *<input value={form.customerName} onChange={(e) => update('customerName', e.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
              <label className="text-sm font-medium text-slate-700">E-post<input type="email" value={form.customerEmail} onChange={(e) => update('customerEmail', e.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
              <label className="text-sm font-medium text-slate-700">Telefon<input value={form.customerPhone} onChange={(e) => update('customerPhone', e.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
            </div>
          </section>
          <section className="mt-6 border-t border-slate-200 pt-5">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-950">Åtgärder *</h3><button type="button" onClick={() => setItems((current) => [...current, ''])} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Plus size={16} /> Lägg till</button></div>
            <div className="mt-3 space-y-2">{items.map((item, index) => <div key={index} className="flex items-center gap-2"><span className="w-7 text-center text-sm font-semibold text-slate-400">{index + 1}</span><input value={item} onChange={(e) => setItems((current) => current.map((value, itemIndex) => itemIndex === index ? e.target.value : value))} placeholder="Beskriv arbetet kort" className="min-h-11 flex-1 rounded-lg border border-slate-300 px-3" /><button type="button" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30" aria-label="Ta bort åtgärd"><Trash2 size={17} /></button></div>)}</div>
          </section>
        </div>
        <footer className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6"><button type="button" disabled={busy} onClick={close} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-slate-700 disabled:opacity-40">Avbryt</button><button type="button" disabled={busy || !form.title.trim() || !form.customerName.trim() || !form.propertyAddress.trim() || !items.some((item) => item.trim())} onClick={() => void onCreate({ ...form, siteVisitAt: form.siteVisitAt ? new Date(form.siteVisitAt).toISOString() : null, items })} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40">{busy ? <Loader2 className="animate-spin" size={17} /> : <ArrowRight size={17} />} Skapa projekt</button></footer>
      </div>
    </div>
  )
}


type ActionResult = {
  workspace: Workspace
  caseId?: string
  itemId?: string
  accessUrl?: string
  upload?: { bucket: string; filePath: string; token: string; contentType: string }
}

function CaseDocuments({
  actionCase,
  busy,
  runAction,
  onUploading,
}: {
  actionCase: ActionCaseView
  busy: boolean
  runAction: (name: string, payload: Record<string, unknown>, successMessage?: string | null) => Promise<ActionResult | null>
  onUploading?: (uploading: boolean) => void
}) {
  const toast = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadInProgress = useRef(false)
  const dragDepth = useRef(0)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [uploading, setUploading] = useState<string[]>([])
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([])
  const [selectedItemId, setSelectedItemId] = useState('')
  const [newSubcontractor, setNewSubcontractor] = useState({ name: '', companyName: '', email: '', phone: '' })
  const [showParticipantForm, setShowParticipantForm] = useState(false)
  const customer = actionCase.participants.find((participant) => participant.role === 'customer')
  const subcontractors = actionCase.participants.filter((participant) => participant.role === 'subcontractor')
  useEffect(() => { onUploading?.(uploading.length > 0) }, [uploading.length, onUploading])

  const toggleSelected = (participantId: string) => {
    setSelectedParticipantIds((current) => current.includes(participantId)
      ? current.filter((id) => id !== participantId)
      : [...current, participantId])
  }

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return
    if (busy || uploadInProgress.current) {
      toast.info('Vänta tills den pågående åtgärden är klar innan du laddar upp fler filer.')
      return
    }
    uploadInProgress.current = true
    setUploading(files.map((file) => file.name))
    try {
    for (const file of files) {
      const signed = await runAction('create_signed_upload', {
        caseId: actionCase.id,
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
      }, null)
      if (!signed?.upload) break
      const { error } = await supabase.storage.from(signed.upload.bucket).uploadToSignedUrl(
        signed.upload.filePath,
        signed.upload.token,
        file,
        { contentType: signed.upload.contentType }
      )
      if (error) {
        toast.error(error, 'Filen kunde inte laddas upp.')
        await runAction('abort_upload', { caseId: actionCase.id, filePath: signed.upload.filePath }, null)
        break
      }
      const completed = await runAction('complete_upload', {
        caseId: actionCase.id,
        filePath: signed.upload.filePath,
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
        itemId: selectedItemId || null,
        participantIds: selectedParticipantIds,
      }, `${file.name} laddades upp.`)
      if (!completed) {
        await runAction('abort_upload', { caseId: actionCase.id, filePath: signed.upload.filePath }, null)
        break
      }
      setUploading((current) => current.filter((name) => name !== file.name))
    }
    } catch (error) {
      toast.error(error, 'Filen kunde inte laddas upp. Försök igen.')
    } finally {
      uploadInProgress.current = false
      setUploading([])
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const copyParticipantLink = async (participantId: string) => {
    const result = await runAction('issue_participant_link', { caseId: actionCase.id, participantId }, null)
    if (!result?.accessUrl) return
    try {
      await navigator.clipboard.writeText(result.accessUrl)
      toast.success('Portalens länk kopierades.')
    } catch {
      toast.error('Länken skapades men kunde inte kopieras.')
    }
  }

  return (
    <section className="border-t border-slate-200">
      <button type="button" onClick={() => setExpanded((current) => !current)} className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-slate-50 sm:px-6" aria-expanded={expanded}>
        <span className="flex items-center gap-3"><span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-700"><ImageIcon size={18} /></span><span><strong className="block text-sm text-slate-950">Bilder och dokument</strong><span className="mt-0.5 block text-xs text-slate-500">{actionCase.attachments.length} filer · privat som standard</span></span></span>
        <ChevronRight size={19} className={`text-slate-400 transition ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded ? (
        <div className="border-t border-slate-200 px-5 py-5 sm:px-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div><h3 className="text-sm font-semibold text-slate-950">Bilder och filer</h3><p className="mt-1 text-xs leading-5 text-slate-500">Privat som standard</p></div>
                <button type="button" disabled={busy || uploading.length > 0} onClick={() => fileInput.current?.click()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"><Upload size={17} /> Ladda upp</button>
                <input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.doc,.docx,.xls,.xlsx,.txt" className="hidden" onChange={(event) => void uploadFiles(Array.from(event.target.files ?? []))} />
              </div>
              <label className="mt-4 block text-xs font-semibold uppercase text-slate-500">Koppla till åtgärd<select value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)} className="mt-2 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal normal-case text-slate-800"><option value="">Hela ärendet</option>{actionCase.items.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.title}</option>)}</select></label>
              <fieldset className="mt-4 border-y border-slate-200 py-3">
                <legend className="px-1 text-xs font-semibold uppercase text-slate-500">Dela nya filer med</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-slate-950 px-3 text-xs font-semibold text-white"><Check size={14} /> Internt</span>
                  {actionCase.participants.map((participant) => <label key={participant.id} className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs font-semibold ${selectedParticipantIds.includes(participant.id) ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-slate-200 text-slate-600'}`}><input type="checkbox" checked={selectedParticipantIds.includes(participant.id)} onChange={() => toggleSelected(participant.id)} className="sr-only" />{selectedParticipantIds.includes(participant.id) ? <Check size={14} /> : null}{participant.role === 'customer' ? 'Beställare' : participant.name}</label>)}
                </div>
              </fieldset>
              <button
                type="button"
                aria-label="Ladda upp bilder och dokument"
                aria-disabled={busy || uploading.length > 0}
                onClick={() => { if (!busy && !uploadInProgress.current) fileInput.current?.click() }}
                onDragEnter={(event) => {
                  if (!event.dataTransfer.types.includes('Files')) return
                  event.preventDefault()
                  dragDepth.current += 1
                  setDraggingFiles(true)
                }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes('Files')) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = busy || uploadInProgress.current ? 'none' : 'copy'
                }}
                onDragLeave={() => {
                  dragDepth.current = Math.max(0, dragDepth.current - 1)
                  if (dragDepth.current === 0) setDraggingFiles(false)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  dragDepth.current = 0
                  setDraggingFiles(false)
                  void uploadFiles(Array.from(event.dataTransfer.files))
                }}
                className={`mt-4 flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${busy || uploading.length > 0 ? 'cursor-wait border-slate-200 bg-slate-50 text-slate-500' : draggingFiles ? 'border-violet-600 bg-violet-100 text-violet-900' : 'border-slate-300 bg-slate-50 text-slate-600 hover:border-violet-400 hover:bg-violet-50'}`}
              >
                {uploading.length > 0 ? <Loader2 size={22} className="animate-spin" /> : <Upload size={22} />}
                <span className="text-sm font-semibold">{uploading.length > 0 ? 'Uppladdning pågår' : busy ? 'Vänta tills åtgärden är klar' : draggingFiles ? 'Släpp för att ladda upp' : 'Dra bilder och dokument hit'}</span>
                <span className="text-xs">Max 25 MB per fil</span>
              </button>
              {uploading.length ? <div className="mt-3 flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-3 text-sm font-medium text-violet-800" role="status"><Loader2 className="animate-spin" size={17} /> Laddar upp {uploading.join(', ')}</div> : null}
              <ActionCaseImageBank actionCase={actionCase} busy={busy}
                onAccess={(attachmentId, participantIds) => { void runAction('update_attachment_grants', { caseId: actionCase.id, attachmentId, participantIds }, 'Åtkomsten uppdaterades.') }}
                onDelete={(attachmentId) => { void runAction('delete_attachment', { caseId: actionCase.id, attachmentId }, 'Bilden togs bort.') }} />
              <h3 className="mt-5 text-sm font-semibold">Dokument</h3>
              <div className="mt-3 divide-y divide-slate-100 border-y border-slate-200">
                {actionCase.attachments.some((file) => !isImageAttachment(file)) ? actionCase.attachments.filter((file) => !isImageAttachment(file)).map((attachment) => {
                  const granted = actionCase.participants.filter((participant) => attachment.grantedParticipantIds.includes(participant.id))
                  return <div key={attachment.id} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="flex min-w-0 items-center gap-3"><span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">{attachment.type === 'image' ? <ImageIcon size={18} /> : <FileText size={18} />}</span><span className="min-w-0"><strong className="block truncate text-sm text-slate-900">{attachment.title || attachment.fileName}</strong><span className="mt-1 block truncate text-xs text-slate-500">Internt{granted.length ? ` · ${granted.map((participant) => participant.role === 'customer' ? 'Beställare' : participant.name).join(', ')}` : ' endast'}</span></span></div><div className="flex items-center gap-2"><a href={`/api/action-cases/${actionCase.id}/attachments/${attachment.id}`} target="_blank" rel="noreferrer" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label={`Öppna ${attachment.fileName}`}><Eye size={17} /></a><details className="relative"><summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Åtkomst</summary><div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-xl"><p className="text-xs font-semibold text-slate-950">Synlig för</p><p className="mt-1 text-xs text-slate-500">Internt är alltid valt.</p><div className="mt-2 space-y-1">{actionCase.participants.map((participant) => <label key={participant.id} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={attachment.grantedParticipantIds.includes(participant.id)} onChange={(event) => { const ids = event.target.checked ? [...attachment.grantedParticipantIds, participant.id] : attachment.grantedParticipantIds.filter((id) => id !== participant.id); void runAction('update_attachment_grants', { caseId: actionCase.id, attachmentId: attachment.id, participantIds: ids }, 'Åtkomsten uppdaterades.') }} className="h-4 w-4 accent-violet-600" />{participant.role === 'customer' ? `Beställare: ${participant.name}` : `UE: ${participant.name}`}</label>)}</div></div></details><button type="button" onClick={() => { if (window.confirm(`Ta bort ${attachment.fileName}?`)) void runAction('delete_attachment', { caseId: actionCase.id, attachmentId: attachment.id }, 'Filen togs bort.') }} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700" aria-label={`Ta bort ${attachment.fileName}`}><Trash2 size={17} /></button></div></div>
                }) : <p className="py-7 text-center text-sm text-slate-500">Inga dokument har lagts till.</p>}
              </div>
            </div>
            <aside className="border-t border-slate-200 pt-5 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
              <div className="flex items-start justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-950">Deltagare</h3><p className="mt-1 text-xs text-slate-500">Länken visar bara filer som personen fått åtkomst till.</p></div><button type="button" onClick={() => setShowParticipantForm((current) => !current)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200" aria-label="Lägg till underentreprenör"><Plus size={16} /></button></div>
              <div className="mt-3 divide-y divide-slate-100">{customer ? <div className="flex items-center gap-2 py-3"><UserRound size={17} className="text-slate-400" /><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{customer.name}</strong><span className="text-xs text-slate-500">Beställare</span></span><button type="button" onClick={() => void copyParticipantLink(customer.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-violet-700 hover:bg-violet-50" aria-label="Kopiera beställarens länk"><Link2 size={16} /></button></div> : <p className="py-3 text-xs text-amber-700">Beställaren saknar kontaktuppgifter och kan inte få en portalänk.</p>}{subcontractors.map((participant) => <div key={participant.id} className="flex items-center gap-2 py-3"><UsersRound size={17} className="text-slate-400" /><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{participant.name}</strong><span className="block truncate text-xs text-slate-500">{participant.companyName || 'Underentreprenör'}</span></span><button type="button" onClick={() => void copyParticipantLink(participant.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-violet-700 hover:bg-violet-50" aria-label={`Kopiera länk för ${participant.name}`}><Link2 size={16} /></button></div>)}</div>
              {showParticipantForm ? <div className="mt-3 space-y-2 border-t border-slate-200 pt-3"><input value={newSubcontractor.name} onChange={(e) => setNewSubcontractor((current) => ({ ...current, name: e.target.value }))} placeholder="Kontaktperson *" className="min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /><input value={newSubcontractor.companyName} onChange={(e) => setNewSubcontractor((current) => ({ ...current, companyName: e.target.value }))} placeholder="Företag" className="min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /><input type="email" value={newSubcontractor.email} onChange={(e) => setNewSubcontractor((current) => ({ ...current, email: e.target.value }))} placeholder="E-post *" className="min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /><button type="button" disabled={busy || !newSubcontractor.name.trim() || !newSubcontractor.email.trim()} onClick={() => void runAction('add_participant', { caseId: actionCase.id, ...newSubcontractor }, 'Underentreprenören lades till.').then((result) => { if (result) { setNewSubcontractor({ name: '', companyName: '', email: '', phone: '' }); setShowParticipantForm(false) } })} className="min-h-10 w-full rounded-lg bg-violet-700 px-3 text-sm font-semibold text-white disabled:opacity-40">Lägg till UE</button></div> : null}
            </aside>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function costActionMessage(name: string, payload: Record<string, unknown>) {
  if (name === 'revoke_rfq_delivery') return 'Länken till offertunderlaget har återkallats.'
  if (name === 'work_part') return ({ save: 'Arbetsdelen sparades.', delete: 'Arbetsdelen togs bort. Kalkylraderna är kvar.', move_lines: 'Valda rader flyttades.', bulk_update: 'Valda kalkylvärden sparades.' } as Record<string, string>)[String(payload.operation)] ?? 'Kalkylen uppdaterades.'
  if (name === 'work_quote') return payload.operation === 'select' ? 'Offerten används i kalkylen. Ingen beställning har skickats.' : payload.operation === 'save' ? 'Offerten sparades. Välj den för att använda priset i kalkylen.' : 'Prisunderlaget uppdaterades.'
  return ({ send_quote_request: 'Offertförfrågan har skickats.', generate_cost_suggestions: 'Kalkylförslaget är klart för granskning.', apply_cost_suggestions: 'Valda rader lades till i kalkylen.', delete_cost_line: 'Kalkylraden togs bort.' } as Record<string, string>)[name] ?? 'Kalkylraden sparades.'
}

export default function ActionCaseWorkspace({ initialWorkspace, initialError, people = [], caseId, section = 'work', onWorkspaceChange, onBusyChange, onDirtyChange, customerRefresh = 0 }: Props) {
  const toast = useToast()
  const [createdProjectId, setCreatedProjectId] = useState<string>()
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [error, setError] = useState(initialError)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [itemDirty, setItemDirty] = useState(false)
  const [initialCostLineId, setInitialCostLineId] = useState<string>()
  const [requestEditor, setRequestEditor] = useState<{ requestId: string | null; preselectedLineIds?: string[]; supplementId?: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [newItemTitle, setNewItemTitle] = useState('')
  const selectedCase = workspace?.cases.find((item) => item.id === caseId) ?? null
  const selectedItem = selectedCase?.items.find((item) => item.id === selectedItemId) ?? null
  const running = useRef(false)
  const openingCreatedProject = useRef(false)
  const workspaceRef = useRef(workspace)
  const receive = (next: Workspace) => {
    workspaceRef.current = next
    setWorkspace(next)
    onWorkspaceChange?.(next)
  }
  const scopeAutosave = useActionScopeAutosave({
    onSaved: (result) => { if (workspaceRef.current) receive(mergeScopeSave(workspaceRef.current, result)) },
    onError: (message) => toast.error(message),
  })
  useEffect(() => {
    if (!customerRefresh) return
    const controller = new AbortController()
    running.current = true
    setBusy(true)
    void (async () => {
      try {
        const response = await fetch('/api/action-cases', { signal: controller.signal, cache: 'no-store' })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Projektet kunde inte uppdateras efter kundbytet.')
        if (!controller.signal.aborted) {
          workspaceRef.current = result.workspace
          setWorkspace(result.workspace)
          onWorkspaceChange?.(result.workspace)
        }
      } catch (error) {
        if (!controller.signal.aborted) toast.error(error, 'Projektet kunde inte uppdateras efter kundbytet. Ladda om sidan.')
      } finally { if (!controller.signal.aborted) { running.current = false; setBusy(false) } }
    })()
    return () => { controller.abort(); running.current = false }
  }, [customerRefresh, onWorkspaceChange, toast])
  const guarded = busy || uploading || scopeAutosave.hasUnsaved || itemDirty || Boolean(requestEditor) || Boolean(newItemTitle.trim())
  useEffect(() => { onBusyChange?.(busy || uploading || scopeAutosave.isSaving) }, [busy, uploading, scopeAutosave.isSaving, onBusyChange])
  useEffect(() => { onDirtyChange?.(guarded) }, [guarded, onDirtyChange])
  useEffect(() => {
    if (!guarded) return
    const prevent = (event: BeforeUnloadEvent) => {
      if (openingCreatedProject.current) return
      event.preventDefault(); event.returnValue = ''
    }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [guarded])
  const action = async (name: string, payload: Record<string, unknown>, successMessage?: string | null): Promise<ActionResult | null> => {
    if (running.current) return null
    if (scopeAutosave.hasUnsaved) {
      toast.error(scopeAutosave.isSaving ? 'Omfattningen sparas. Försök igen när sparningen är klar.' : 'Spara ändringarna i omfattningen innan du fortsätter.')
      return null
    }
    running.current = true
    setBusy(true)
    try {
      const response = await fetch('/api/action-cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: name, payload }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Kunde inte spara.')
      receive(result.workspace)
      scopeAutosave.forgetSaved()
      setError(null)
      if (successMessage !== null) toast.success(successMessage ?? (name === 'create_case' ? 'Projektet skapades.' : 'Åtgärden sparades.'))
      return result as ActionResult
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Kunde inte spara.')
      if (['send_quote_request', 'work_quote', 'quote_request', 'send_grouped_quote_request', 'quote_package', 'work_part', 'delete_attachment', 'revoke_rfq_delivery'].includes(name)) {
        await fetch('/api/action-cases').then(async (response) => {
          if (response.ok) { const result = await response.json(); receive(result.workspace) }
        }).catch(() => undefined)
      }
      return null
    }
    finally { running.current = false; setBusy(false) }
  }

  if (!workspace) return <section className="gizmo-empty" role="alert"><ClipboardList /><h2>Projekten kunde inte hämtas</h2><p>{error}</p><button className="gizmo-button" onClick={() => window.location.reload()}>Försök igen</button></section>
  if (!caseId) return <>
    <ActionCaseProjectList cases={workspace.cases} pendingProjectId={createdProjectId} onCreate={() => setCreating(true)} />
    {creating && <CreateCaseSheet busy={busy} onClose={() => { if (!busy) setCreating(false) }} onCreate={async (payload) => {
      const result = await action('create_case', payload)
      if (result) {
        setCreating(false)
        if (result.caseId) {
          openingCreatedProject.current = true
          setCreatedProjectId(result.caseId)
          window.location.assign(projectUrl(result.caseId, 'work'))
        }
      }
    }} />}
  </>
  if (!selectedCase) return <p role="alert">Projektet är inte tillgängligt. <PendingLink autoPending pendingLabel="Öppnar projektlistan…" href="/uppdrag">Till projektlistan</PendingLink></p>

  return <>
    <section hidden={section !== 'work'} aria-label="Projektarbete">
      <div className="gizmo-section-heading"><div><h2>Projektarbete</h2><p>{selectedCase.items.length} åtgärder · {selectedCase.items.filter((item) => completion(item) === 100).length} kalkylklara</p></div></div>
      <div className="gizmo-work-columns" aria-hidden="true"><span>Åtgärd</span><span>Behöver hanteras</span><span>Status</span><span /></div>
      <ul className="gizmo-work-rows" aria-label="Projektets åtgärder">{selectedCase.items.map((item) => {
        const save = scopeAutosave.states[item.id]
        const saveIssue = save?.status === 'error' ? 'Kunde inte spara' : save && !save.draft.title.trim() ? 'Rubrik saknas' : null
        return <li key={item.id}><button type="button" onClick={() => setSelectedItemId(item.id)} className="gizmo-work-row" aria-haspopup="dialog" aria-expanded={selectedItemId === item.id}>
          <strong>{item.title}</strong><span>{saveIssue ? 'Öppna för att spara' : completion(item) === 100 ? 'Kalkylunderlaget är komplett' : nextAction(item)}</span><span>{saveIssue ?? ITEM_STATUS[item.status]}</span><ChevronRight size={18} aria-hidden="true" />
        </button></li>
      })}</ul>
      {!selectedCase.items.length && <p className="gizmo-empty">Inga åtgärder ännu.</p>}
      <form className="gizmo-add-work" onSubmit={(event) => {
        event.preventDefault()
        if (busy || !newItemTitle.trim()) return
        void action('add_item', { caseId: selectedCase.id, title: newItemTitle }, 'Åtgärden lades till.').then((result) => {
          if (result) { setNewItemTitle(''); if (result.itemId) setSelectedItemId(result.itemId) }
        })
      }}><label>Ny åtgärd<input required value={newItemTitle} onChange={(event) => setNewItemTitle(event.target.value)} placeholder="Beskriv arbetet kort" /></label><button type="submit" disabled={busy || !newItemTitle.trim()} className="gizmo-button">{busy ? <Loader2 size={17} className="animate-spin" /> : <Plus size={17} />} Lägg till åtgärd</button></form>
      <ActionCaseRequestsPanel actionCase={selectedCase} busy={busy} onOpen={(requestId) => setRequestEditor({ requestId })} />
    </section>
    <section hidden={section !== 'files'} aria-label="Bilder och filer">
      <div className="gizmo-section-heading"><h2>Bilder och filer</h2></div>
      <CaseDocuments key={selectedCase.id} actionCase={selectedCase} busy={busy} runAction={action} onUploading={setUploading} />
    </section>
    {selectedItem && <ActionCaseItemSheet
      key={`${selectedItem.id}:${initialCostLineId ?? ''}`}
      item={selectedItem}
      caseId={selectedCase.id}
      attachments={selectedCase.attachments}
      participants={selectedCase.participants}
      initialCostLineId={initialCostLineId}
      onRequest={(preselectedLineIds) => setRequestEditor({ requestId: null, preselectedLineIds })}
      onOpenRequest={(requestId) => setRequestEditor({ requestId })}
      busy={busy}
      scopeSave={scopeAutosave.states[selectedItem.id]}
      scopeBlocked={scopeAutosave.hasUnsaved}
      onDirtyChange={setItemDirty}
      onScopeChange={(draft) => scopeAutosave.change(selectedItem.id, selectedItem.updatedAt, draft)}
      onScopeFlush={() => scopeAutosave.flush(selectedItem.id)}
      onScopeRetry={() => scopeAutosave.retry(selectedItem.id)}
      onClose={() => { scopeAutosave.flush(selectedItem.id); setSelectedItemId(null); setInitialCostLineId(undefined) }}
      onSave={async (payload) => Boolean(await action('update_item', { itemId: selectedItem.id, expectedUpdatedAt: selectedItem.updatedAt, ...payload }))}
      onDelete={async () => {
        const deleted = Boolean(await action('delete_item', { caseId: selectedCase.id, itemId: selectedItem.id, expectedUpdatedAt: selectedItem.updatedAt }, 'Åtgärden togs bort.'))
        if (deleted) { setSelectedItemId(null); setInitialCostLineId(undefined) }
        return deleted
      }}
      onCostAction={async (name, payload) => Boolean(await action(name, { caseId: selectedCase.id, itemId: selectedItem.id, ...payload }, costActionMessage(name, payload)))}
    />}
    {requestEditor && <ActionCaseRequestSheet key={`${selectedCase.id}:${requestEditor.requestId ?? requestEditor.supplementId ?? 'new'}:${requestEditor.preselectedLineIds?.join(',') ?? ''}`}
      people={people}
      actionCase={selectedCase} {...requestEditor} busy={busy} onClose={() => setRequestEditor(null)}
      onSupplement={(request) => setRequestEditor({ requestId: null, supplementId: request.id })}
      onOpenWork={(itemId, costLineId) => { setRequestEditor(null); setSelectedItemId(itemId); setInitialCostLineId(costLineId) }}
      onAction={async (name, data) => Boolean(await action(name, data, name === 'revoke_rfq_delivery' ? 'Länken till offertunderlaget har återkallats.' : name === 'quote_package' ? data.operation === 'accept' ? 'Grupppriset används i kalkylen. Ingen beställning har skickats.' : 'Tidigare prisunderlag har återställts.' : name === 'send_grouped_quote_request' ? 'Den samlade offertförfrågan har skickats.' : data.operation === 'response' ? 'Prisvillkoren har sparats.' : data.operation === 'delete' ? 'Utkastet togs bort.' : 'Förfrågan är sparad. Granska den före utskick.'))}
    />}
  </>
}
