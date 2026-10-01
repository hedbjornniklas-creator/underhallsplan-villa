'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, CalendarClock, Eye, FileText, FolderOpen, LayoutDashboard, ListChecks, MapPin, WalletCards, Wrench } from 'lucide-react'
import type { ActionCaseWorkspace } from '@/lib/action-cases/contracts'
import type { TaskPerson } from '@/lib/tasks/contracts'
import { customerOfferBaseAmount, money, type CustomerOfferWorkspace } from '@/lib/action-cases/customerOffers'
import { parseProjectView, projectNeeds, projectStatus, projectUrl, type ProjectView } from '@/lib/action-cases/projectNavigation'
import ActionCaseWorkspaceTools from './ActionCaseWorkspace'
import CustomerOfferEditor, { type CustomerEditorView } from './CustomerOfferEditor'
import ProjectScheduleEditor from './ProjectScheduleEditor'
import type { ProjectScheduleRow } from '@/lib/action-cases/projectSchedule'

const sections = [
  { key: 'overview', label: 'Översikt', icon: LayoutDashboard },
  { key: 'work', label: 'Projektarbete', icon: Wrench },
  { key: 'contract', label: 'Offert och avtal', icon: FileText },
  { key: 'choices', label: 'Val och tillval', icon: ListChecks },
  { key: 'payments', label: 'Betalningsplan', icon: WalletCards },
  { key: 'schedule', label: 'Tidsplan', icon: CalendarClock },
  { key: 'files', label: 'Bilder och filer', icon: FolderOpen },
] as const
const offerViews: Partial<Record<ProjectView, CustomerEditorView>> = { contract: 'edit', choices: 'planning', payments: 'payments', customer: 'customer', review: 'document' }
const projectViews: Record<CustomerEditorView, ProjectView> = { edit: 'contract', planning: 'choices', payments: 'payments', customer: 'customer', document: 'review' }

export default function ActionCaseProject({ caseId, initialWorkspace, initialOffer, initialOfferError, initialView = 'overview', people = [], issuerName, replyEmail }: {
  caseId: string
  initialWorkspace: ActionCaseWorkspace
  initialOffer: CustomerOfferWorkspace | null
  initialOfferError?: string | null
  initialView?: ProjectView
  people?: TaskPerson[]
  issuerName: string
  replyEmail: string
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [offer, setOffer] = useState(initialOffer)
  const [offerDirty, setOfferDirty] = useState(false)
  const [workBusy, setWorkBusy] = useState(false)
  const [workDirty, setWorkDirty] = useState(false)
  const [scheduleDirty, setScheduleDirty] = useState(false)
  const [sharedSchedule, setSharedSchedule] = useState<ProjectScheduleRow[]>([])
  const [view, setView] = useState(initialView)
  const heading = useRef<HTMLHeadingElement>(null)
  const previousView = useRef(view)
  const project = workspace.cases.find((item) => item.id === caseId)!
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
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [view])
  const accepted = offer?.offers.find((item) => item.status === 'accepted')
  const published = offer?.offers.find((item) => item.status === 'published')
  const contract = accepted ?? published
  const offerLabel = !offer ? 'Kunde inte hämtas' : accepted ? 'Godkänt grundavtal' : published ? published.sentAt ? 'Skickad offert' : 'Publicerad offert' : 'Internt offertutkast'
  const base = contract ? customerOfferBaseAmount(contract.snapshot) : offer ? customerOfferBaseAmount(offer.draft) : null
  const customer = project.participants.find((item) => item.role === 'customer')
  const currentSection = view === 'review' ? 'contract' : view
  const sectionLabel = view === 'customer' ? 'Visa som beställare' : view === 'review' ? 'Granska grundavtal' : sections.find((item) => item.key === view)?.label
  const open = (next: ProjectView, label: string) => <button className="gizmo-text-button" onClick={() => navigate(next)}>{label}<ArrowRight size={17} /></button>
  return <main className="gizmo-project-page">
    <header className="gizmo-project-header">
      <Link className="gizmo-back" href="/uppdrag?view=projects" onClick={(event) => {
        if ((offerDirty || workDirty || scheduleDirty) && !window.confirm(workBusy ? 'Arbete pågår. Vill du lämna projektet?' : 'Lämna projektet med osparade ändringar?')) event.preventDefault()
      }}><ArrowLeft size={17} /> Alla projekt</Link>
      <div className="gizmo-project-title"><div><p className="gizmo-eyebrow">Gizmo · Projekt</p><h1 ref={heading} tabIndex={-1}>{project.title}</h1><p className="gizmo-address"><MapPin size={16} />{project.propertyAddress}</p></div>
        <button className="gizmo-button" aria-pressed={view === 'customer'} onClick={() => navigate(view === 'customer' ? 'overview' : 'customer')}><Eye size={18} />{view === 'customer' ? 'Till intern vy' : 'Visa som beställare'}</button>
      </div>
    </header>
    <div className="gizmo-project-layout">
      <nav className="gizmo-project-nav" aria-label="Projektnavigering">
        {sections.map(({ key, label, icon: Icon }) => <a key={key} href={projectUrl(caseId, key)} aria-current={currentSection === key ? 'page' : undefined}
          onClick={(event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); navigate(key) } }}><Icon size={18} /><span>{label}</span></a>)}
      </nav>
      <div className="gizmo-project-content" aria-label={sectionLabel}>
        <section hidden={view !== 'overview'}>
          <div className="gizmo-section-heading"><h2>Översikt</h2><span className="gizmo-secondary">{projectStatus[project.status]}</span></div>
          <dl className="gizmo-overview-facts"><div><dt>Beställare</dt><dd>{customer?.name ?? project.customerName}</dd><dd>{customer?.email ?? project.customerEmail ?? 'E-post saknas'}</dd></div><div><dt>{offerLabel}</dt><dd>{base === null ? 'Belopp saknas' : money(base)}</dd><dd>Grundåtagande inkl. moms</dd></div><div><dt>Underlag</dt><dd>{project.items.length} åtgärder</dd><dd>{project.attachments.length} bilder och filer</dd></div></dl>
          <div className="gizmo-overview-row"><div><h3>Projektarbete</h3><p>{projectNeeds(project)}</p></div>{open('work', 'Öppna projektarbete')}</div>
          <div className="gizmo-overview-row"><div><h3>Offert och avtal</h3><p>{offerLabel}{accepted ? ` · Version ${accepted.version}` : ''}</p></div>{open('contract', 'Öppna offert och avtal')}</div>
          <div className="gizmo-overview-row"><div><h3>Val och tillval</h3><p>{offer?.planning?.available ? `${offer.planning.items.length} planerade · ${offer.planning.sharedItems.length} delade med beställaren` : 'Ingen tillgänglig planering'}</p></div>{open('choices', 'Öppna val och tillval')}</div>
          <div className="gizmo-overview-row"><div><h3>Betalningsplan</h3><p>{(contract ? contract.snapshot.paymentPlan : offer?.draft.paymentPlan)?.installments.length ?? 0} delbetalningar{contract ? ' · i avtalsversionen' : ' · internt utkast'}</p></div>{open('payments', 'Öppna betalningsplan')}</div>
        </section>
        {/* Keep the existing editors mounted so switching sections cannot discard drafts or uploads. */}
        <ActionCaseWorkspaceTools initialWorkspace={initialWorkspace} initialError={null} caseId={caseId} people={people}
          section={view === 'work' || view === 'files' ? view : 'hidden'} onWorkspaceChange={setWorkspace} onBusyChange={setWorkBusy} onDirtyChange={setWorkDirty} />
        <div hidden={!offerViews[view]}>
          {initialOffer ? <CustomerOfferEditor actionCase={project} initial={initialOffer} issuerName={issuerName} replyEmail={replyEmail}
            embedded active={Boolean(offerViews[view])} view={offerViews[view] ?? 'edit'} onViewChange={navigateOffer} onWorkspaceChange={setOffer} onDirtyChange={setOfferDirty} sharedSchedule={sharedSchedule} />
            : <section className="gizmo-empty" role="alert"><h2>{sectionLabel}</h2><p>{initialOfferError || 'Offertuppgifterna kunde inte hämtas. Projektarbete och filer är fortfarande tillgängliga.'}</p><button className="gizmo-button" onClick={() => window.location.reload()}>Försök igen</button></section>}
        </div>
        <section hidden={view !== 'schedule'}>
          <div className="gizmo-section-heading"><h2>Tidsplan</h2></div>
          <ProjectScheduleEditor caseId={caseId} items={project.items} onDirty={setScheduleDirty} onShared={setSharedSchedule} />
          <section className="gizmo-schedule-section"><h3>{accepted ? 'Avtalade tider' : published ? 'Tider i publicerad offert' : 'Planerade tider i offertutkast'}</h3>
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
