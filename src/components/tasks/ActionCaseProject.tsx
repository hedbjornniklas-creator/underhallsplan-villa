'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import PendingLink from '@/components/ui/PendingLink'
import { ArrowLeft, ArrowRight, CalendarClock, Eye, FileText, FilePenLine, FolderOpen, LayoutDashboard, ListChecks, Loader2, MapPin, Pencil, Save, WalletCards, Wrench, X } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import type { ActionCaseWorkspace } from '@/lib/action-cases/contracts'
import type { TaskPerson } from '@/lib/tasks/contracts'
import { customerOfferBaseAmount, customerPriceLabel, money, type CustomerOfferWorkspace } from '@/lib/action-cases/customerOffers'
import { parseProjectView, projectNeeds, projectStatus, projectUrl, type ProjectView } from '@/lib/action-cases/projectNavigation'
import ActionCaseWorkspaceTools from './ActionCaseWorkspace'
import CustomerOfferEditor, { type CustomerEditorView } from './CustomerOfferEditor'
import ProjectScheduleEditor from './ProjectScheduleEditor'
import type { ProjectScheduleRow } from '@/lib/action-cases/projectSchedule'
import type { ContractContractor } from '@/lib/action-cases/customerContractParties'
import { activeSigningVersion } from '@/lib/action-cases/contractSigning'

const sections = [
  { key: 'overview', label: 'Översikt', icon: LayoutDashboard },
  { key: 'work', label: 'Projektarbete', icon: Wrench },
  { key: 'offer', label: 'Offert', icon: FileText },
  { key: 'contract', label: 'Avtal', icon: FilePenLine },
  { key: 'choices', label: 'Val och tillval', icon: ListChecks },
  { key: 'payments', label: 'Betalning och fakturering', icon: WalletCards },
  { key: 'schedule', label: 'Tidsplan', icon: CalendarClock },
  { key: 'files', label: 'Bilder och filer', icon: FolderOpen },
] as const
const offerViews: Partial<Record<ProjectView, CustomerEditorView>> = { offer: 'edit', contract: 'contract', choices: 'planning', payments: 'payments', customer: 'customer', review: 'document', offerReview: 'offerDocument' }
const projectViews: Record<CustomerEditorView, ProjectView> = { edit: 'offer', contract: 'contract', planning: 'choices', payments: 'payments', customer: 'customer', document: 'review', offerDocument: 'offerReview' }
const nameIconButton = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[#D5DCDD] bg-white disabled:opacity-50'

export default function ActionCaseProject({ caseId, initialWorkspace, initialOffer, initialOfferError, initialView = 'overview', people = [], issuerName, replyEmail, contractorSource }: {
  caseId: string
  initialWorkspace: ActionCaseWorkspace
  initialOffer: CustomerOfferWorkspace | null
  initialOfferError?: string | null
  initialView?: ProjectView
  people?: TaskPerson[]
  issuerName: string
  replyEmail: string
  contractorSource?: Partial<ContractContractor>
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [renamedTitle, setRenamedTitle] = useState<string | null>(null)
  const [renameOpen, setRenameOpen] = useState(false), [nameDraft, setNameDraft] = useState('')
  const [renameBusy, setRenameBusy] = useState(false), [renameError, setRenameError] = useState('')
  const nameInput = useRef<HTMLInputElement>(null), renameButton = useRef<HTMLButtonElement>(null), renameRunning = useRef(false), wasRenaming = useRef(false)
  const toast = useToast()
  const [offer, setOffer] = useState(initialOffer)
  const [estimate, setEstimate] = useState<CustomerOfferWorkspace | null>(() => initialOffer ? {
    ...initialOffer, ...initialOffer.offerDraft, offerDraft: undefined,
  } : null)
  const [estimateDirty, setEstimateDirty] = useState(false)
  const [offerDirty, setOfferDirty] = useState(false)
  const [workBusy, setWorkBusy] = useState(false)
  const [workDirty, setWorkDirty] = useState(false)
  const [scheduleDirty, setScheduleDirty] = useState(false)
  const [sharedSchedule, setSharedSchedule] = useState<ProjectScheduleRow[]>([])
  const [customerRefresh, setCustomerRefresh] = useState(0)
  const customerChanged = useCallback(() => {
    setSharedSchedule([])
    setCustomerRefresh((value) => value + 1)
  }, [])
  const [view, setView] = useState(initialView)
  const heading = useRef<HTMLHeadingElement>(null)
  const previousView = useRef(view)
  const keyboardTabChange = useRef(false)
  const storedProject = workspace.cases.find((item) => item.id === caseId)!
  // A late response from an already-running work save cannot restore the old header name.
  const project = renamedTitle === null ? storedProject : { ...storedProject, title: renamedTitle }
  const renameDirty = renameOpen && nameDraft.trim() !== project.title
  useEffect(() => {
    if (renameOpen) { wasRenaming.current = true; nameInput.current?.focus(); nameInput.current?.select() }
    else if (wasRenaming.current) { wasRenaming.current = false; renameButton.current?.focus() }
  }, [renameOpen])
  useEffect(() => {
    if (!renameDirty && !renameBusy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [renameDirty, renameBusy])
  function closeRename() {
    if (renameRunning.current) return
    setRenameOpen(false); setRenameError(''); renameButton.current?.focus()
  }
  async function saveName() {
    if (renameRunning.current || !nameDraft.trim() || nameDraft.trim().length > 250) return
    renameRunning.current = true; setRenameBusy(true); setRenameError('')
    try {
      const response = await fetch(`/api/action-cases/${caseId}/name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: nameDraft, expectedTitle: project.title }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Projektnamnet kunde inte sparas.')
      if (result.project?.id !== caseId || typeof result.project.title !== 'string') throw new Error('Svaret kunde inte bekräftas. Försök igen.')
      setRenamedTitle(result.project.title)
      setWorkspace((current) => ({ ...current, cases: current.cases.map((item) => item.id === caseId ? { ...item, title: result.project.title, updatedAt: result.project.updatedAt } : item) }))
      setRenameOpen(false); renameButton.current?.focus(); toast.success('Projektnamnet sparades.')
    } catch (error) { setRenameError(error instanceof Error ? error.message : 'Projektnamnet kunde inte sparas.') }
    finally { renameRunning.current = false; setRenameBusy(false) }
  }
  const navigate = useCallback((next: ProjectView) => {
    setView(next)
    if (new URLSearchParams(window.location.search).get('view') !== next) {
      window.history.pushState(null, '', projectUrl(caseId, next))
    }
  }, [caseId])
  const navigateOffer = useCallback((next: CustomerEditorView) => navigate(projectViews[next]), [navigate])
  useEffect(() => {
    const onBack = () => setView(parseProjectView(new URLSearchParams(window.location.search).get('view')))
    window.addEventListener('popstate', onBack)
    return () => window.removeEventListener('popstate', onBack)
  }, [])
  useEffect(() => {
    if (previousView.current === view) return
    previousView.current = view
    if (keyboardTabChange.current) { keyboardTabChange.current = false; return }
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [view])
  const accepted = offer?.offers.find((item) => item.status === 'accepted')
  const published = offer?.offers.find((item) => item.status === 'published')
  const paper = activeSigningVersion(offer?.signingVersions)
  const contract = accepted ?? published ?? paper
  const offerLabel = !offer ? 'Kunde inte hämtas' : accepted ? 'Godkänt grundavtal' : published ? published.sentAt ? 'Skickat avtal' : 'Publicerat avtal'
    : paper?.delivery?.signedCopy ? 'Underskriven kopia registrerad' : paper?.delivery?.sharedAt && !paper.delivery.withdrawnAt ? 'Låst och delat avtal' : paper ? 'Låst avtal · Inte delat' : 'Internt avtalsutkast'
  const priceDraft = contract?.snapshot ?? offer?.draft
  const customer = offer?.recipient ?? project.participants.find((item) => item.role === 'customer')
  const currentSection = view === 'review' ? 'contract' : view === 'offerReview' ? 'offer' : view
  const sectionLabel = view === 'customer' ? 'Visa som beställare' : view === 'review' ? 'Granska avtal' : view === 'offerReview' ? 'Granska offert' : sections.find((item) => item.key === view)?.label
  const open = (next: ProjectView, label: string) => <button className="gizmo-text-button" onClick={() => navigate(next)}>{label}<ArrowRight size={17} /></button>
  return <main className="gizmo-project-page">
    <header className="gizmo-project-header">
      <PendingLink autoPending icon={<ArrowLeft size={17} />} pendingLabel="Öppnar projektlistan…" className="gizmo-back" href="/uppdrag?view=projects" onClick={(event) => {
        if ((offerDirty || estimateDirty || workDirty || scheduleDirty || renameDirty || renameBusy) && !window.confirm(workBusy || renameBusy ? 'Arbete pågår. Vill du lämna projektet?' : 'Lämna projektet med osparade ändringar?')) event.preventDefault()
      }}>Alla projekt</PendingLink>
      <div className="gizmo-project-title"><div className="flex-1"><p className="gizmo-eyebrow">Gizmo · Projekt</p><div className="flex min-w-0 items-start gap-2"><h1 ref={heading} tabIndex={-1} className="min-w-0 break-words">{project.title}</h1><button ref={renameButton} type="button" className={nameIconButton} aria-label="Byt projektnamn" title="Byt projektnamn" aria-expanded={renameOpen} aria-controls="project-name-form" disabled={renameBusy} onClick={() => {
        if (renameOpen) closeRename()
        else { setNameDraft(project.title); setRenameError(''); setRenameOpen(true) }
      }}><Pencil size={17} /></button></div>
        {renameOpen && <form id="project-name-form" className="mt-3 max-w-xl" aria-label="Byt projektnamn" aria-busy={renameBusy} onSubmit={(event) => { event.preventDefault(); void saveName() }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeRename() } }}>
          <label className="block text-sm" htmlFor="project-name-input">Projektnamn</label>
          <div className="mt-1 flex flex-wrap gap-2"><input ref={nameInput} id="project-name-input" className="min-h-11 min-w-0 flex-1 rounded-md border border-[#D5DCDD] bg-white px-3 text-base sm:text-sm" maxLength={250} required value={nameDraft} disabled={renameBusy} onChange={(event) => { setNameDraft(event.target.value); setRenameError('') }} />
            <button type="submit" className="gizmo-button" disabled={renameBusy || !nameDraft.trim() || nameDraft.trim().length > 250}>{renameBusy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Spara</button>
            <button type="button" className={nameIconButton} aria-label="Avbryt namnbyte" title="Avbryt" disabled={renameBusy} onClick={closeRename}><X size={17} /></button>
          </div>
          <div className="mt-1 min-h-5 text-sm">{renameError ? <p role="alert" className="text-rose-700">{renameError}</p> : renameBusy ? <p role="status">Sparar…</p> : null}</div>
        </form>}
        <p className="gizmo-address"><MapPin size={16} />{project.propertyAddress}</p></div>
        <button className="gizmo-button" aria-pressed={view === 'customer'} onClick={() => navigate(view === 'customer' ? 'overview' : 'customer')}><Eye size={18} />{view === 'customer' ? 'Till intern vy' : 'Visa som beställare'}</button>
      </div>
    </header>
    <div className="gizmo-project-layout">
      <nav className="gizmo-register-tabs gizmo-project-tabs" role="tablist" aria-label="Projektnavigering" onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const index = sections.findIndex((section) => section.key === currentSection)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + sections.length) % sections.length
        keyboardTabChange.current = sections[next].key !== currentSection
        navigate(sections[next].key)
        event.currentTarget.querySelector<HTMLElement>(`[data-project-tab="${sections[next].key}"]`)?.focus()
      }}>
        {sections.map(({ key, label, icon: Icon }) => <a className="gizmo-register-tab" role="tab" data-project-tab={key} key={key} href={projectUrl(caseId, key)} aria-selected={currentSection === key} tabIndex={currentSection === key ? 0 : -1}
          id={`project-tab-${key}`} aria-controls={`project-content-${caseId}`} aria-current={currentSection === key ? 'page' : undefined}
          onClick={(event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); navigate(key) } }}><Icon size={18} /><span>{label}</span></a>)}
      </nav>
      <div className="gizmo-project-content" id={`project-content-${caseId}`} role="tabpanel" aria-label={sectionLabel}>
        <section hidden={view !== 'overview'}>
          <div className="gizmo-section-heading"><h2>Översikt</h2><span className="gizmo-secondary">{projectStatus[project.status]}</span></div>
          <dl className="gizmo-overview-facts"><div><dt>Beställare</dt><dd>{customer?.name ?? project.customerName}</dd><dd>{customer?.email ?? project.customerEmail ?? 'E-post saknas'}</dd></div><div><dt>{offerLabel}</dt><dd>{priceDraft ? customerPriceLabel(priceDraft) : 'Belopp saknas'}</dd><dd>{priceDraft?.contractPricing?.mode === 'running' ? 'Enligt avtalets prisgrunder' : priceDraft?.contractPricing?.mode === 'mixed' ? 'Fast del inkl. moms + löpande del' : 'Grundåtagande inkl. moms'}</dd></div><div><dt>Underlag</dt><dd>{project.items.length} åtgärder</dd><dd>{project.attachments.length} bilder och filer</dd></div></dl>
          <div className="gizmo-overview-row"><div><h3>Projektarbete</h3><p>{projectNeeds(project)}</p></div>{open('work', 'Öppna projektarbete')}</div>
          <div className="gizmo-overview-row"><div><h3>Offert</h3><p>{estimate ? `${estimate.draft.items.filter((item) => item.kind === 'included').length} arbetsdelar · ${money(customerOfferBaseAmount(estimate.draft))}` : 'Kunde inte hämtas'}</p></div>{open('offer', 'Öppna offert')}</div>
          <div className="gizmo-overview-row"><div><h3>Avtal</h3><p>{offerLabel}{accepted ? ` · Version ${accepted.version}` : ''}</p></div>{open('contract', 'Öppna avtal')}</div>
          <div className="gizmo-overview-row"><div><h3>Val och tillval</h3><p>{offer?.planning?.available ? `${offer.planning.items.length} planerade · ${offer.planning.sharedItems.length} delade med beställaren` : 'Ingen tillgänglig planering'}</p></div>{open('choices', 'Öppna val och tillval')}</div>
          <div className="gizmo-overview-row"><div><h3>Betalning och fakturering</h3><p>{(contract ? contract.snapshot.paymentPlan : offer?.draft.paymentPlan)?.installments.length ?? 0} delbetalningar{contract ? ' · i avtalsversionen' : ' · internt utkast'}</p></div>{open('payments', 'Öppna betalning och fakturering')}</div>
        </section>
        {/* Keep the existing editors mounted so switching sections cannot discard drafts or uploads. */}
        <ActionCaseWorkspaceTools initialWorkspace={initialWorkspace} initialError={null} caseId={caseId} people={people}
          customerRefresh={customerRefresh}
          section={view === 'work' || view === 'files' ? view : 'hidden'} onWorkspaceChange={setWorkspace} onBusyChange={setWorkBusy} onDirtyChange={setWorkDirty} />
        <div hidden={!offerViews[view] || view === 'offer' || view === 'offerReview'}>
          {initialOffer ? <CustomerOfferEditor actionCase={project} initial={initialOffer} issuerName={issuerName} replyEmail={replyEmail} contractorSource={contractorSource}
            embedded draftTarget="contract" offerItems={estimate?.draft.items ?? []} active={Boolean(offerViews[view]) && view !== 'offer' && view !== 'offerReview'} view={view !== 'offer' && view !== 'offerReview' ? offerViews[view] ?? 'contract' : 'contract'} onViewChange={navigateOffer} onWorkspaceChange={setOffer} onCustomerChanged={customerChanged} onDirtyChange={setOfferDirty} sharedSchedule={sharedSchedule} sourcePending={workDirty || workBusy || scheduleDirty} />
            : <section className="gizmo-empty" role="alert"><h2>{sectionLabel}</h2><p>{initialOfferError || 'Offertuppgifterna kunde inte hämtas. Projektarbete och filer är fortfarande tillgängliga.'}</p><button className="gizmo-button" onClick={() => window.location.reload()}>Försök igen</button></section>}
        </div>
        <div hidden={view !== 'offer' && view !== 'offerReview'}>
          {estimate && <CustomerOfferEditor actionCase={project} initial={estimate} issuerName={issuerName} replyEmail={replyEmail} contractorSource={contractorSource}
            embedded draftTarget="offer" active={view === 'offer' || view === 'offerReview'} view={view === 'offerReview' ? 'offerDocument' : 'edit'}
            onViewChange={navigateOffer} onWorkspaceChange={setEstimate} onDirtyChange={setEstimateDirty} sourcePending={workDirty || workBusy || scheduleDirty} />}
        </div>
        <section hidden={view !== 'schedule'}>
          <div className="gizmo-section-heading"><h2>Tidsplan</h2></div>
          <ProjectScheduleEditor caseId={caseId} items={project.items} onDirty={setScheduleDirty} onShared={setSharedSchedule} customerRefresh={customerRefresh} />
          <section className="gizmo-schedule-section"><h3>{accepted || paper?.delivery?.signedCopy ? 'Avtalade tider' : published ? 'Tider i publicerat avtal' : paper ? 'Tider i låst avtalsversion' : 'Planerade tider i avtalsutkast'}</h3>
            <p className="whitespace-pre-wrap">{(contract?.snapshot.schedule ?? offer?.draft.schedule)?.trim() || 'Inga tider angivna.'}</p>
            {contract ? <p className="gizmo-secondary">Grundavtal version {contract.version}{accepted ? ' · Godkänt' : ' · Inte godkänt'}</p> : open('contract', 'Ange tider i grundavtalet')}
          </section>
          <section className="gizmo-schedule-section"><h3>Beslutsdatum för val och tillval</h3>
            {offer?.planning?.items.some((item) => item.decisionBy) ? <dl className="gizmo-dates">{offer.planning.items.filter((item) => item.decisionBy).map((item) => <div key={item.id}><dt>{item.title}</dt><dd>{item.decisionBy}</dd></div>)}</dl> : <p>Inga beslutsdatum angivna.</p>}
            {open('choices', 'Öppna val och tillval')}
          </section>
        </section>
      </div>
    </div>
  </main>
}
