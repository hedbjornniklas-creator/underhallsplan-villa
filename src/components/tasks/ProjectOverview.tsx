'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowRight, ArrowUpRight, CalendarCheck2, CalendarClock, CircleAlert, FileText, HardHat, LockKeyhole, MessageCircle, PanelsTopLeft, Plus, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react'
import type { ActionCaseView } from '@/lib/action-cases/contracts'
import { money, type CustomerOfferWorkspace } from '@/lib/action-cases/customerOffers'
import { overviewDate, overviewPointStatus, overviewTimeline, overviewToday, projectOverview, type OverviewPoint } from '@/lib/action-cases/projectOverview'
import type { QuestionWorkspace } from '@/lib/action-cases/projectQuestions'
import { scheduleStatuses, type ProjectSchedule } from '@/lib/action-cases/projectSchedule'
import type { ProjectView } from '@/lib/action-cases/projectNavigation'
import ProjectManagerField from './ProjectManagerField'
import './project-overview.css'

type Resource<T> = { data: T | null; loading: boolean; error: boolean }
const pending = <T,>(): Resource<T> => ({ data: null, loading: true, error: false })
const pointIcon = (view: ProjectView) => view === 'questions' ? MessageCircle : view === 'choices' ? PanelsTopLeft : view === 'payments' ? WalletCards : CalendarClock
const statusLabels = { late: 'Försenade', soon: 'Kommande', undated: 'Utan datum' } as const

function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="gizmo-home-sectionhead"><h3>{title}</h3>{children}</div>
}

export default function ProjectOverview({ project, offer, active, refreshKey, questionsDirty, sharingDirty, onManagerChanged, onNavigate, onQuestion }: {
  project: ActionCaseView; offer: CustomerOfferWorkspace | null; active: boolean; refreshKey: number
  questionsDirty: boolean; sharingDirty: boolean; onManagerChanged: () => void
  onNavigate: (view: ProjectView) => void; onQuestion: (id: string | null) => void
}) {
  const [questions, setQuestions] = useState<Resource<QuestionWorkspace>>(pending)
  const [schedule, setSchedule] = useState<Resource<ProjectSchedule>>(pending)
  const [reload, setReload] = useState(0), [mine, setMine] = useState(false), [all, setAll] = useState(false)
  const [now, setNow] = useState(Date.now)
  const today = overviewToday(new Date(now))
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setQuestions(pending()); setSchedule(pending())
    const load = async <T,>(endpoint: string, set: (value: Resource<T>) => void) => {
      try {
        const response = await fetch(`/api/action-cases/${project.id}/${endpoint}`, { signal: controller.signal, cache: 'no-store' })
        const data = await response.json()
        if (!response.ok) throw new Error('Read failed')
        if (endpoint === 'questions' ? !Array.isArray(data.questions) || !Array.isArray(data.assignees) || typeof data.userId !== 'string'
          : !Array.isArray(data.rows) || typeof data.available !== 'boolean') throw new Error('Invalid overview response')
        if (!controller.signal.aborted) set({ data, loading: false, error: false })
      } catch { if (!controller.signal.aborted) set({ data: null, loading: false, error: true }) }
    }
    void load('questions', setQuestions); void load('schedule', setSchedule)
    return () => controller.abort()
  }, [active, project.id, refreshKey, reload])
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [active])
  const model = projectOverview(project, offer, questions.data, schedule.data, today)
  const timeline = overviewTimeline(schedule.data, today)
  const points = model.points.filter(point => !mine || point.mine)
  const counts = { late: 0, soon: 0, undated: 0 }
  for (const point of points) counts[overviewPointStatus(point, today, now)]++
  let offset = 0
  const arcs = (Object.keys(counts) as Array<keyof typeof counts>).filter(key => counts[key]).map(key => {
    const size = counts[key] / points.length * 100, gap = Math.min(4, size / 5)
    const result = { key, size, start: offset + gap / 2, length: size - gap }
    offset += size
    return result
  })
  const loading = questions.loading || schedule.loading
  const partial = questions.error || schedule.error || !offer || schedule.data?.available === false
  const visiblePoints = all ? points : points.slice(0, 5)
  const base = model.contract.base
  const scale = Math.max(base ?? 0, model.calculation ?? 0, model.contract.planAmount ?? 0, 1)
  const openPoint = (point: OverviewPoint) => point.questionId ? onQuestion(point.questionId) : onNavigate(point.view)
  const openButton = (view: ProjectView, label: string) => <button type="button" className="gizmo-home-link" onClick={() => onNavigate(view)} aria-label={label}>Öppna<ArrowUpRight size={16} aria-hidden="true" /></button>
  const missing = model.missingPrices
  return <section className="gizmo-home" aria-label="Projektöversikt" hidden={!active}>
    <div className="gizmo-home-heading"><div><h2>Projektöversikt</h2><p><time dateTime={today}>{overviewDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</time></p></div>
      <div className="gizmo-home-actions"><button type="button" className="gizmo-home-icon-button" aria-label="Uppdatera översikten" title="Uppdatera översikten" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={17} aria-hidden="true" /></button><button type="button" className="gizmo-home-command" disabled={questionsDirty || questions.loading || questions.error} onClick={() => onQuestion(null)}><Plus size={17} aria-hidden="true" />Ny fråga</button></div>
    </div>
    <details className="gizmo-home-manager"><summary>Projektansvarig · {questions.loading ? 'Hämtar…' : questions.error ? 'Kunde inte hämtas' : questions.data?.managerId ? questions.data.assignees.find(person => person.kind === 'profile' && person.id === questions.data?.managerId)?.name || 'Utsedd' : 'Ej utsedd'}</summary><ProjectManagerField caseId={project.id} active={active} disabled={questionsDirty || sharingDirty} onChanged={onManagerChanged} /></details>
    {partial && <p className="gizmo-home-notice" role="status">{[questions.error && 'Frågor kunde inte hämtas.', schedule.error && 'Tidsplanen kunde inte hämtas.', schedule.data?.available === false && 'Tidsplaneringen är inte aktiverad.', !offer && 'Avtalsunderlaget kunde inte hämtas.'].filter(Boolean).join(' ')} Översikten är ofullständig. <button type="button" className="gizmo-home-link" onClick={() => !offer ? onNavigate('contract') : setReload(value => value + 1)}>{!offer ? 'Öppna avtalsvyn' : 'Försök igen'}</button></p>}
    <div className="gizmo-home-milestones">
      <div className="gizmo-home-milestone"><span className="gizmo-home-milestone-icon"><HardHat size={19} aria-hidden="true" /></span><div><small>Nästa start</small><strong>{schedule.loading ? 'Hämtar…' : model.nextStart ? overviewDate(model.nextStart.startDate) : 'Ingen planerad'}</strong><p>{model.nextStart?.title || (schedule.error ? 'Underlag saknas' : 'Tidsplan')}</p></div></div>
      <div className="gizmo-home-milestone"><span className="gizmo-home-milestone-icon"><CalendarCheck2 size={19} aria-hidden="true" /></span><div><small>Nästa beslut</small><strong>{model.nextDecision ? overviewDate(model.nextDecision.decisionBy) : 'Inget daterat'}</strong><p>{model.nextDecision?.title || 'Val och tillval'}</p></div></div>
      <div className="gizmo-home-milestone"><span className="gizmo-home-milestone-icon"><LockKeyhole size={18} aria-hidden="true" /></span><div><small>Avtalsstatus</small><strong>{model.contract.label}</strong><p>{model.contract.shared ? 'Publicerat för beställaren' : offer ? 'Inte delat med beställaren' : 'Underlag saknas'}</p></div></div>
    </div>
    <div className="gizmo-home-grid">
      <section className="gizmo-home-tasks" aria-label="Nästa steg">
        <div className="gizmo-home-sectionhead"><h3>Nästa steg <span className="gizmo-home-count">{loading ? '–' : points.length}</span></h3><div className="gizmo-home-segment" role="group" aria-label="Visa uppgifter"><button type="button" aria-pressed={!mine} onClick={() => { setMine(false); setAll(false) }}>Projektets</button><button type="button" aria-pressed={mine} onClick={() => { setMine(true); setAll(false) }}>Mina</button></div></div>
        {loading ? <p className="gizmo-home-empty" role="status">Hämtar nästa steg…</p> : <>
          {visiblePoints.map(point => { const Icon = pointIcon(point.view), state = overviewPointStatus(point, today, now); return <button type="button" className={`gizmo-home-task ${state}`} key={point.id} disabled={Boolean(point.questionId && questionsDirty)} onClick={() => openPoint(point)}>
            <span className={`gizmo-home-task-symbol ${point.view}`}><Icon size={17} aria-hidden="true" /></span><span><strong>{point.title}</strong><small>{point.owner} · {point.source}</small></span><span className="gizmo-home-due"><strong>{point.due ? overviewDate(point.due) : 'Odaterad'}</strong>{state === 'late' && <small>Försenad</small>}</span><ArrowRight size={14} aria-hidden="true" />
          </button> })}
          {!points.length && <p className="gizmo-home-empty">{mine ? 'Inga tillgängliga punkter är tilldelade dig.' : partial ? 'Inga punkter i tillgängligt underlag.' : 'Inga öppna frågor eller planeringspunkter.'}</p>}
          <div className="gizmo-home-taskfoot"><span aria-live="polite">{visiblePoints.length < points.length ? `Visar ${visiblePoints.length} av ${points.length} punkter` : `${points.length} ${mine ? 'punkter för dig' : 'tillgängliga punkter'}`}</span>{points.length > 5 ? <button type="button" className="gizmo-home-link" onClick={() => setAll(value => !value)}>{all ? 'Visa färre' : 'Visa alla'}</button> : counts.late > 0 ? <span className="gizmo-home-pill late">{counts.late} {counts.late === 1 ? 'försenad' : 'försenade'}</span> : null}</div>
        </>}
      </section>
      <section className="gizmo-home-pulse" aria-label="Öppna punkter efter datumstatus">
        <SectionHead title="Att hantera"><span className="gizmo-home-pill">{mine ? 'Mina' : 'Projektets'}</span></SectionHead>
        {loading ? <p className="gizmo-home-empty" role="status">Hämtar lägesbild…</p> : <>
          <div className="gizmo-home-pulse-inner"><div className="gizmo-home-ring" role="img" aria-label={`${points.length} öppna punkter: ${counts.late} ${counts.late === 1 ? 'försenad' : 'försenade'}, ${counts.soon} kommande, ${counts.undated} utan datum.`}>
            <svg viewBox="0 0 164 164" aria-hidden="true"><circle className="gizmo-home-ring-bg" cx="82" cy="82" r="64" fill="none" strokeWidth="16" />{arcs.map(arc => <circle key={arc.key} className={`gizmo-home-ring-part ${arc.key}`} cx="82" cy="82" r="64" pathLength="100" strokeDasharray={`${arc.length} ${100 - arc.length}`} strokeDashoffset={-arc.start} strokeLinecap={arc.size < 6 ? 'butt' : 'round'} />)}</svg>
            <div className="gizmo-home-ring-label"><strong>{points.length}</strong><span>öppna punkter</span></div>
          </div><dl className="gizmo-home-legend">{(Object.keys(counts) as Array<keyof typeof counts>).map(key => <div key={key}><dt><span className={`gizmo-home-dot ${key}`} />{statusLabels[key]}</dt><dd>{counts[key]}</dd></div>)}</dl></div>
          <p className="gizmo-home-pulse-note">{partial ? 'Ofullständigt underlag' : 'Tillgängliga frågor, val och planeringspunkter'}</p>
        </>}
      </section>
      <section className="gizmo-home-schedule" aria-label="Tidsplan kommande sex veckor">
        <SectionHead title="Tidsplan">{openButton('schedule', 'Öppna tidsplan')}</SectionHead>
        {schedule.loading ? <p className="gizmo-home-empty">Hämtar tidsplan…</p> : timeline.rows.length ? <>
          <div className="gizmo-home-charthead"><span>Kommande 6 veckor</span><div className="gizmo-home-weeks">{timeline.weeks.map(date => <time key={date} dateTime={date}>{overviewDate(date, { day: 'numeric' })}<small>{overviewDate(date, { month: 'short' })}</small></time>)}</div></div>
          {timeline.rows.map(row => <button type="button" className="gizmo-home-lanerow" key={row.id} onClick={() => onNavigate('schedule')} title={`${row.title} · ${overviewDate(row.startDate)}–${overviewDate(row.endDate)} · ${scheduleStatuses[row.status]}`} aria-label={`${row.title}, ${overviewDate(row.startDate)} till ${overviewDate(row.endDate)}, ${scheduleStatuses[row.status]}`}><span className="gizmo-home-lanelabel">{row.title || 'Namnlöst moment'}<small>{scheduleStatuses[row.status]}</small></span><span className="gizmo-home-lane" aria-hidden="true" style={{ '--gizmo-home-today': `${timeline.todayPercent}%` } as CSSProperties}><span className={`gizmo-home-bar ${row.status}`} style={{ left: `${row.left}%`, width: `${row.width}%` }} /></span></button>)}
          <div className="gizmo-home-schedulefoot"><span className="gizmo-home-now">Idag · {overviewDate(today)}</span><span>{timeline.total > 5 ? `Visar 5 av ${timeline.total} moment` : 'Produktionsplanering'}</span></div>
        </> : <p className="gizmo-home-empty">{schedule.error ? 'Tidsplanen kunde inte hämtas.' : 'Inga daterade moment under de kommande sex veckorna.'}</p>}
      </section>
      <section className="gizmo-home-finance" aria-label="Ekonomi">
        <SectionHead title="Ekonomi">{openButton('payments', 'Öppna betalning och fakturering')}</SectionHead>
        <div className="gizmo-home-finance-amount"><span>{model.contract.draft?.contractPricing?.mode === 'mixed' ? 'Avtalets fasta del' : 'Avtalsbelopp'} · {model.contract.source}</span><strong>{base !== null ? money(base) : model.contract.draft?.contractPricing?.mode === 'running' ? 'Löpande räkning' : 'Belopp saknas'}</strong><small>{!model.contract.draft ? 'Underlag saknas' : base !== null ? model.contract.draft.contractPricing?.mode === 'mixed' ? 'Inklusive moms · löpande del tillkommer' : 'Inklusive moms' : model.contract.draft.contractPricing?.mode === 'running' ? 'Enligt avtalets prisgrunder' : 'Inget komplett belopp i underlaget'}</small></div>
        {[{ title: 'Kundpris i Projektarbete', amount: model.calculation, className: '', view: 'work' as const }, { title: 'Fördelat i betalningsplan', amount: model.contract.planAmount, className: 'blue', view: 'payments' as const }].map(row => <div className="gizmo-home-moneyrow" key={row.title}><div><button type="button" className="gizmo-home-moneylink" onClick={() => onNavigate(row.view)}>{row.title}</button><strong>{row.amount === null ? 'Ej fastställt' : money(row.amount)}</strong></div><div className="gizmo-home-track" aria-hidden="true"><div className={`gizmo-home-fill ${row.className}`} style={{ width: `${row.amount === null ? 0 : row.amount / scale * 100}%` }} />{base !== null && <span className="gizmo-home-reference" style={{ left: `${base / scale * 100}%` }} />}</div></div>)}
        {model.contract.difference !== null && <div className="gizmo-home-finance-diff">{model.contract.difference !== 0 && <CircleAlert size={16} aria-hidden="true" />}{model.contract.difference > 0 ? `${money(model.contract.difference)} kvar att fördela` : model.contract.difference < 0 ? `${money(-model.contract.difference)} över avtalsbeloppet` : 'Betalningsplanen motsvarar avtalsbeloppet'}</div>}
        {base !== null && <p className="gizmo-home-finance-sub">Avtalets belopp</p>}{missing > 0 && <p className="gizmo-home-secondary">{missing} moment saknar komplett pris.</p>}
      </section>
      <section className="gizmo-home-activity" aria-label="Senaste aktivitet">
        <SectionHead title="Senaste aktivitet" />
        <div className="gizmo-home-log">{model.activities.map(activity => { const Icon = activity.view === 'questions' ? MessageCircle : activity.view === 'contract' ? LockKeyhole : FileText; return <div className="gizmo-home-logitem" key={activity.id}><span className="gizmo-home-avatar"><Icon size={16} aria-hidden="true" /></span><div><strong>{activity.title}</strong><small>{activity.actor && `${activity.actor} · `}<time dateTime={activity.at}>{overviewDate(activity.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></small><button type="button" className="gizmo-home-link" disabled={Boolean(activity.questionId && questionsDirty)} onClick={() => activity.questionId ? onQuestion(activity.questionId) : onNavigate(activity.view)}>Öppna<ArrowRight size={16} aria-hidden="true" /></button></div></div> })}</div>
        {!model.activities.length && <p className="gizmo-home-secondary">{questions.loading ? 'Hämtar aktivitet…' : 'Ingen aktivitet i tillgängligt underlag.'}</p>}
      </section>
    </div>
    <div className="gizmo-home-bottom"><span><ShieldCheck size={16} aria-hidden="true" />Intern översikt</span><span>{project.items.length} arbetsdelar · {project.attachments.length} filer</span><span>Beställare: {offer?.recipient?.name || project.customerName || 'Ej angiven'}</span></div>
  </section>
}
