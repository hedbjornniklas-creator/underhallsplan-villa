'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Lock, MapPin, Plus, RefreshCw, Search, TriangleAlert, X } from 'lucide-react'
import DailyRouteMap from '@/components/dashboard/DailyRouteMap'
import type { DashboardAction, DashboardBooking, DashboardData, DashboardModule, DashboardModuleId } from '@/lib/dashboard/model'
import { bookingDate, bookingLocation, bookingMapUrl, bookingTime, bookingTimeLabel, calendarDateLabel, calendarWeek, compareBookings, directionsLinks, isCalendarDate, shiftCalendarDate } from '@/lib/dashboard/calendar'
import './dashboard.css'

type ActionFilter = 'all' | DashboardAction['category']
const ACTION_FILTERS: Array<{ id: ActionFilter; label: string }> = [
  { id: 'all', label: 'Alla' }, { id: 'inspection', label: 'Besiktningar' },
  { id: 'confirmation', label: 'Bekräftelser' }, { id: 'other', label: 'Övrigt' },
]

function ModuleBadge({ module, small = false }: { module: DashboardModule; small?: boolean }) {
  return <span className={`dh-module-badge${small ? ' dh-module-badge-small' : ''}`} data-module={module.id} title={module.title}>{module.code}</span>
}

function ModuleCard({ module, failed }: { module: DashboardModule; failed: boolean }) {
  const contents = <>
    <ModuleBadge module={module} />
    <span className="dh-module-info"><strong>{module.title.replace('besiktning', '\u00adbesiktning')}</strong><span>
      {!module.active ? 'Saknar behörighet' : failed ? 'Kunde inte hämtas' : <>{module.activeCount} aktiva <span aria-hidden>·</span> {module.actionCount} att göra</>}
    </span></span>
    {module.active ? <ArrowRight size={18} aria-hidden /> : <Lock size={16} aria-hidden />}
  </>
  return module.active
    ? <Link href={module.href} prefetch={false} className="dh-module-card" aria-label={`Öppna ${module.title}`}>{contents}</Link>
    : <div className="dh-module-card dh-module-locked" aria-label={`${module.title}: saknar behörighet`}>{contents}</div>
}

function NewAssignmentMenu({ modules }: { modules: DashboardModule[] }) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); container.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return <div className="dh-new-assignment" ref={container}>
    <button type="button" className="dh-button dh-primary" aria-label="Nytt uppdrag" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} disabled={!modules.some(module => module.active)}>
      <Plus size={18} aria-hidden />Nytt uppdrag<ChevronDown size={14} aria-hidden />
    </button>
    {open && <div id={id} className="dh-new-menu">
      <p>Välj arbetsområde</p>
      {modules.filter(module => module.active).map(module => <Link key={module.id} href={module.id === 'ob' ? `${module.href.replace(/\?.*$/, '')}/assignments/new${module.href.includes('?') ? `?${module.href.split('?')[1]}` : ''}` : module.href} prefetch={false} onClick={() => setOpen(false)}>
        <ModuleBadge module={module} small /><span>{module.title}</span><ArrowRight size={16} aria-hidden />
      </Link>)}
      <span className="dh-menu-help">Skapa uppdraget i modulens ordinarie flöde.</span>
    </div>}
  </div>
}

function DueLabel({ action, today }: { action: DashboardAction; today: string }) {
  let label = 'Nästa steg'
  if (action.priority === 'overdue') label = 'Försenat'
  else if (action.dueDate === today || action.priority === 'today') label = 'I dag'
  else if (action.dueDate === shiftCalendarDate(today, 1)) label = 'I morgon'
  else if (action.dueDate) label = calendarDateLabel(action.dueDate, { day: 'numeric', month: 'short' })
  return <span className="dh-due" data-priority={action.priority}>{label}</span>
}

function BookingCalendar({ bookings, modules, selectedDate, today, onSelectDate }: {
  bookings: DashboardBooking[]; modules: Map<DashboardModuleId, DashboardModule>; selectedDate: string; today: string; onSelectDate: (date: string) => void
}) {
  const week = calendarWeek(selectedDate)
  const weekBookings = bookings.filter(booking => week.includes(bookingDate(booking.startsAt)))
  const range = `${calendarDateLabel(week[0], { day: 'numeric', month: 'short' })} – ${calendarDateLabel(week[6], { day: 'numeric', month: 'short' })}`
  const dayBookings = weekBookings.filter(booking => bookingDate(booking.startsAt) === selectedDate)
  return <section className="dh-panel dh-calendar" aria-labelledby="dh-calendar-heading">
    <div className="dh-panel-heading"><div><h2 id="dh-calendar-heading">Bokade uppdrag</h2><p>{weekBookings.length} bokade denna vecka</p></div><CalendarDays size={21} className="dh-muted-icon" aria-hidden /></div>
    <div className="dh-calendar-toolbar">
      <div className="dh-week-navigation"><button className="dh-icon-button" type="button" aria-label="Föregående vecka" onClick={() => onSelectDate(shiftCalendarDate(selectedDate, -7))}><ChevronLeft size={18} aria-hidden /></button>
        <span aria-live="polite">{range}</span><button className="dh-icon-button" type="button" aria-label="Nästa vecka" onClick={() => onSelectDate(shiftCalendarDate(selectedDate, 7))}><ChevronRight size={18} aria-hidden /></button>
      </div><button type="button" className="dh-button dh-today-button" onClick={() => onSelectDate(today)}>I dag</button>
    </div>
    <div className="dh-calendar-grid">
      {week.map(day => <div className="dh-calendar-column" key={day} data-selected={day === selectedDate}>
        <button className="dh-calendar-day" type="button" aria-pressed={day === selectedDate} aria-label={calendarDateLabel(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} onClick={() => onSelectDate(day)}>
          <span>{calendarDateLabel(day, { weekday: 'short' }).replace('.', '')}</span><strong data-today={day === today}>{Number(day.slice(-2))}</strong>
        </button>
        <div className="dh-calendar-bookings">{weekBookings.filter(booking => bookingDate(booking.startsAt) === day).map(booking => <Link className="dh-calendar-booking" key={booking.id} href={booking.href} prefetch={false} data-module={booking.moduleId} title={`${bookingTimeLabel(booking)} · ${booking.title} · ${modules.get(booking.moduleId)?.title ?? ''}`}>
          <time dateTime={booking.startsAt}>{bookingTime(booking.startsAt) ?? 'Tid saknas'}</time><span>{booking.title}</span>
        </Link>)}</div>
      </div>)}
    </div>
    <div className="dh-calendar-mobile-list">{dayBookings.length ? dayBookings.map(booking => <Link href={booking.href} prefetch={false} key={booking.id} data-module={booking.moduleId} className="dh-calendar-mobile-booking">
      <time dateTime={booking.startsAt}>{bookingTimeLabel(booking)}</time><strong>{booking.title}</strong><ArrowRight size={16} aria-hidden />
    </Link>) : <p>Inga bokade uppdrag denna dag.</p>}</div>
    <div className="dh-calendar-footer"><label><span>Visa datum</span><input type="date" aria-label="Visa uppdrag för datum" value={selectedDate} onChange={event => { if (isCalendarDate(event.target.value)) onSelectDate(event.target.value) }} /></label><span>Välj dag för uppdragslista och karta.</span></div>
  </section>
}

export function DashboardContent({ data, onRefresh, refreshing = false, error }: { data: DashboardData; onRefresh?: () => void; refreshing?: boolean; error?: string | null }) {
  const [moduleFilter, setModuleFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<ActionFilter>('all')
  const [showAll, setShowAll] = useState(false)
  const [selectedDate, setSelectedDate] = useState(data.today)
  const activeModules = useMemo(() => new Map(data.modules.filter(module => module.active).map(module => [module.id, module])), [data.modules])
  const failedModules = new Set(data.issues?.map(issue => issue.moduleId))
  const effectiveFilter = moduleFilter === 'all' || activeModules.has(moduleFilter as DashboardModuleId) ? moduleFilter : 'all'
  const words = search.trim().toLocaleLowerCase('sv-SE').split(/\s+/).filter(Boolean)
  const matches = (moduleId: DashboardModuleId, content: string) => activeModules.has(moduleId) && (effectiveFilter === 'all' || effectiveFilter === moduleId) && words.every(word => content.toLocaleLowerCase('sv-SE').includes(word))
  const actions = data.actions.filter(action => matches(action.moduleId, `${action.title} ${action.subtitle ?? ''} ${action.nextStep}`))
  const filteredActions = actions.filter(action => category === 'all' || action.category === category)
  const visibleActions = showAll ? filteredActions : filteredActions.slice(0, 8)
  const bookings = useMemo(() => {
    const terms = search.trim().toLocaleLowerCase('sv-SE').split(/\s+/).filter(Boolean)
    return data.bookings.filter(booking => isCalendarDate(bookingDate(booking.startsAt)) && activeModules.has(booking.moduleId)
      && (effectiveFilter === 'all' || effectiveFilter === booking.moduleId)
      && terms.every(term => `${booking.title} ${booking.address ?? ''}`.toLocaleLowerCase('sv-SE').includes(term))).sort(compareBookings)
  }, [data.bookings, activeModules, effectiveFilter, search])
  const dayBookings = useMemo(() => bookings.filter(booking => bookingDate(booking.startsAt) === selectedDate), [bookings, selectedDate])
  const routeLinks = directionsLinks(dayBookings)
  const locatedCount = dayBookings.filter(booking => bookingLocation(booking)).length
  const isToday = selectedDate === data.today
  const changeCategory = (value: ActionFilter) => { setCategory(value); setShowAll(false) }

  return <div className="dh-dashboard" aria-busy={refreshing}><div className="dh-container">
    <header className="dh-heading"><div><h1>Min arbetsdag</h1><p>{calendarDateLabel(data.today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div><div className="dh-header-actions">
      {onRefresh && <button type="button" className="dh-icon-button" aria-label="Uppdatera översikten" title="Uppdatera översikten" onClick={onRefresh} disabled={refreshing}><RefreshCw size={18} className={refreshing ? 'dh-spinning' : ''} aria-hidden /></button>}<NewAssignmentMenu modules={data.modules} />
    </div></header>
    <nav className="dh-modules" aria-label="Arbetsområden">{data.modules.map(module => <ModuleCard key={module.id} module={module} failed={failedModules.has(module.id)} />)}</nav>
    <div className="dh-toolbar"><div className="dh-search"><Search size={19} aria-hidden /><input type="search" maxLength={200} placeholder="Sök uppdrag eller fastighet" aria-label="Sök uppdrag eller fastighet" value={search} onChange={event => { setSearch(event.target.value); setShowAll(false) }} />
      {search && <button type="button" className="dh-search-clear" aria-label="Rensa sökning" onClick={() => setSearch('')}><X size={17} aria-hidden /></button>}</div>
      <label className="dh-module-filter"><span className="dh-sr-only">Arbetsområde</span><select aria-label="Filtrera arbetsområde" value={effectiveFilter} onChange={event => { setModuleFilter(event.target.value); setShowAll(false) }}><option value="all">Alla moduler</option>{data.modules.filter(module => module.active).map(module => <option value={module.id} key={module.id}>{module.title}</option>)}</select></label>
    </div>
    {error && <div className="dh-error" role="alert"><TriangleAlert size={19} aria-hidden /><p>{error}</p>{onRefresh && <button className="dh-button" type="button" disabled={refreshing} onClick={onRefresh}>Försök igen</button>}</div>}
    {Boolean(data.issues?.length) && <div className="dh-partial-error" role="status"><TriangleAlert size={18} aria-hidden /><div><strong>Översikten är inte komplett</strong><p>{data.issues?.map(issue => `${data.modules.find(module => module.id === issue.moduleId)?.title ?? issue.moduleId}: ${issue.message}`).join(' ')}</p></div></div>}
    <div className="dh-workspace"><div className="dh-column dh-work-column">
      <section className="dh-panel dh-actions-panel" aria-labelledby="dh-actions-heading">
        <div className="dh-panel-heading"><div><div className="dh-heading-count"><h2 id="dh-actions-heading">Behöver göras</h2><span className="dh-count">{actions.length}</span></div><p>Nästa steg i dina aktuella uppdrag</p></div><CheckCheck size={21} className="dh-muted-icon" aria-hidden /></div>
        <div className="dh-action-tabs" role="group" aria-label="Filtrera nästa steg">{ACTION_FILTERS.map(filter => <button key={filter.id} type="button" aria-pressed={category === filter.id} onClick={() => changeCategory(filter.id)}>{filter.label}<span>{filter.id === 'all' ? actions.length : actions.filter(action => action.category === filter.id).length}</span></button>)}</div>
        <div data-testid="dashboard-actions" className="dh-action-list">{visibleActions.length ? <>
          <div className="dh-action-table-heading" aria-hidden><span>Uppdrag</span><span>Nästa steg</span><span>När</span><span /></div><ul>{visibleActions.map(action => <li className="dh-action-row" data-action-id={action.id} key={action.id}>
            <div className="dh-action-identity"><ModuleBadge module={activeModules.get(action.moduleId)!} small /><div><strong>{action.title}</strong>{action.subtitle && <span>{action.subtitle}</span>}</div></div><span className="dh-next-step">{action.nextStep}</span><DueLabel action={action} today={data.today} />
            <Link className="dh-button dh-row-button" href={action.href} prefetch={false} aria-label={`${action.actionLabel}: ${action.title} – ${action.nextStep}`}>{action.actionLabel}<ArrowRight size={14} aria-hidden /></Link>
          </li>)}</ul></> : <div className="dh-empty" role="status"><CheckCheck size={28} aria-hidden /><strong>{search || effectiveFilter !== 'all' || category !== 'all' ? 'Inga uppgifter matchar dina val' : data.issues?.length ? 'Inga nästa steg i de inlästa uppdragen' : 'Inga uppgifter att hantera just nu'}</strong><p>{search || effectiveFilter !== 'all' || category !== 'all' ? 'Prova en annan sökning eller ändra filtren.' : 'Nya uppdrag och nästa steg visas här när de finns.'}</p></div>}</div>
        <div className="dh-actions-footer"><span aria-live="polite">{filteredActions.length ? `Visar ${visibleActions.length} av ${filteredActions.length} nästa steg` : '0 nästa steg'}</span>{filteredActions.length > 8 && <button type="button" className="dh-text-button" onClick={() => setShowAll(value => !value)}>{showAll ? 'Visa färre' : `Visa alla ${filteredActions.length}`}<ArrowRight size={15} aria-hidden /></button>}</div>
      </section>
      <section className="dh-panel dh-agenda" aria-labelledby="dh-agenda-heading"><div className="dh-panel-heading"><div><div className="dh-heading-count"><h2 id="dh-agenda-heading">{isToday ? 'Dagens uppdrag' : 'Uppdrag denna dag'}</h2><span className="dh-count">{dayBookings.length} bokade</span></div>{!isToday && <p>{calendarDateLabel(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' })}</p>}</div></div>
        {dayBookings.length ? <ol className="dh-agenda-list">{dayBookings.map((booking, index) => { const mapUrl = bookingMapUrl(booking); return <li className="dh-agenda-row" key={booking.id} data-booking-id={booking.id}>
          <span className="dh-stop-number" aria-label={`Stopp ${index + 1}`}>{index + 1}</span><time dateTime={booking.startsAt}>{bookingTimeLabel(booking)}</time><div className="dh-agenda-identity"><strong>{booking.title}</strong><span>{activeModules.get(booking.moduleId)?.title}</span>
            {mapUrl ? <a className="dh-address" href={mapUrl} target="_blank" rel="noopener noreferrer" title="Visa adressen i Google Maps"><MapPin size={13} aria-hidden />{booking.address || 'Visa plats på karta'}</a> : <span className="dh-address-missing">Adress saknas</span>}
          </div><Link href={booking.href} prefetch={false} className="dh-agenda-open" aria-label={`Öppna ${booking.title}`}>Öppna<ArrowRight size={16} aria-hidden /></Link>
        </li> })}</ol> : <div className="dh-empty dh-empty-compact" role="status"><CalendarDays size={26} aria-hidden /><strong>Inga bokade uppdrag {isToday ? 'i dag' : 'denna dag'}</strong><p>Välj en annan dag i kalendern för att se dess uppdrag.</p></div>}
      </section>
    </div><div className="dh-column dh-plan-column">
      <BookingCalendar bookings={bookings} modules={activeModules} selectedDate={selectedDate} today={data.today} onSelectDate={setSelectedDate} />
      <section className="dh-panel dh-map-panel" aria-labelledby="dh-map-heading"><div className="dh-panel-heading"><div className="dh-heading-count"><h2 id="dh-map-heading">{isToday ? 'Dagens resväg' : 'Resväg för vald dag'}</h2><span className="dh-muted">{dayBookings.length} stopp</span></div>{routeLinks.length === 1 && <a className="dh-button dh-primary dh-route-button" href={routeLinks[0]} target="_blank" rel="noopener noreferrer">Öppna resväg<ExternalLink size={15} aria-hidden /></a>}</div>
        <DailyRouteMap key={`${data.organizationId ?? 'default'}:${selectedDate}:${effectiveFilter}:${search}`} bookings={dayBookings} date={selectedDate} organizationId={data.organizationId} />
        {routeLinks.length > 1 && <div className="dh-route-legs">{routeLinks.map((href, index) => <a className="dh-button" href={href} key={href} target="_blank" rel="noopener noreferrer">Resväg del {index + 1}<ExternalLink size={15} aria-hidden /></a>)}</div>}
        {dayBookings.length > locatedCount && <p className="dh-location-note">{dayBookings.length - locatedCount} uppdrag saknar adress och kan inte ingå i resvägen.</p>}
      </section>
    </div></div>
  </div></div>
}

function DashboardLoading({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return <div className="dh-dashboard"><div className="dh-container"><header className="dh-heading"><div><h1>Min arbetsdag</h1><p>Översikt över dina uppdrag</p></div></header>{error ? <div className="dh-error" role="alert"><TriangleAlert size={20} aria-hidden /><p>{error}</p><button className="dh-button" type="button" onClick={onRetry}>Försök igen</button><Link className="dh-button" href="/dashboard-v1">Återställ startsidan</Link></div> : <><div className="dh-loading-message" role="status"><RefreshCw size={18} className="dh-spinning" aria-hidden />Hämtar dina uppdrag…</div><div className="dh-modules dh-skeleton" aria-hidden>{Array.from({ length: 5 }, (_, index) => <div className="dh-module-placeholder" key={index} />)}</div><div className="dh-workspace dh-skeleton" aria-hidden><div className="dh-panel dh-panel-placeholder" /><div className="dh-panel dh-panel-placeholder" /></div></>}</div></div>
}

export default function DashboardV1Client({ initialData, initialError = null }: { initialData?: DashboardData; initialError?: string | null }) {
  const searchParams = useSearchParams()
  const selections = searchParams.getAll('orgId')
  const selectionKey = selections.join('|')
  const requestedOrgId = selections[0]
  const [revision, setRevision] = useState(0)
  const [snapshot, setSnapshot] = useState<{ key: string; revision: number; data?: DashboardData; error?: string | null } | null>(initialData || initialError ? { key: selectionKey, revision: 0, data: initialData, error: initialError } : null)
  const initialSelection = useRef(selectionKey)
  useEffect(() => {
    if (revision === 0 && selectionKey === initialSelection.current && (initialData || initialError)) return
    const controller = new AbortController()
    let current = true
    let discardPrevious = false
    if (selectionKey.includes('|')) return () => controller.abort()
    const params = new URLSearchParams()
    if (requestedOrgId !== undefined) params.set('orgId', requestedOrgId)
    void fetch(`/api/dashboard${params.size ? `?${params}` : ''}`, { signal: controller.signal, cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(async response => {
        const body = await response.json().catch(() => ({}))
        discardPrevious = response.status === 401 || response.status === 403 || response.status === 400
        if (!response.ok || !Array.isArray(body.modules) || !Array.isArray(body.actions) || !Array.isArray(body.bookings) || !isCalendarDate(body.today ?? '')) throw new Error(body.error || 'Översikten kunde inte hämtas. Försök igen.')
        if (requestedOrgId !== undefined && body.organizationId !== requestedOrgId.trim().toLowerCase()) throw new Error('Översikten kunde inte hämtas för den valda organisationen.')
        if (current) setSnapshot({ key: selectionKey, revision, data: body as DashboardData })
      })
      .catch(loadError => { if (current && !controller.signal.aborted) setSnapshot(previous => ({ key: selectionKey, revision,
        data: !discardPrevious && previous?.key === selectionKey ? previous.data : undefined,
        error: loadError instanceof Error ? loadError.message : 'Översikten kunde inte hämtas.',
      })) })
    return () => { current = false; controller.abort() }
  }, [initialData, initialError, selectionKey, requestedOrgId, revision])
  useEffect(() => {
    const visibility = () => { if (document.visibilityState === 'visible') setRevision(value => value + 1) }
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) setRevision(value => value + 1) }
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pageshow', pageShow)
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pageshow', pageShow) }
  }, [])
  const invalidSelection = selectionKey.includes('|')
  const visibleData = !invalidSelection && snapshot?.key === selectionKey ? snapshot.data : undefined
  const loading = !invalidSelection && (snapshot?.key !== selectionKey || snapshot.revision !== revision)
  const error = invalidSelection ? 'Flera organisationsval finns i adressen. Återställ startsidan.' : snapshot?.key === selectionKey && !loading ? snapshot.error : null
  const refresh = () => setRevision(value => value + 1)
  return visibleData ? <DashboardContent key={`${selectionKey}:${visibleData.today}`} data={visibleData} refreshing={loading} onRefresh={refresh} error={error} /> : <DashboardLoading error={error ?? null} onRetry={refresh} />
}
