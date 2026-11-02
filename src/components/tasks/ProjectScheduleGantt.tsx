'use client'

import { useRef, useState } from 'react'
import { CalendarDays, LocateFixed } from 'lucide-react'
import { scheduleStatuses, type ProjectScheduleRow } from '@/lib/action-cases/projectSchedule'
import { scheduleDate, scheduleDateLabel, scheduleDays, scheduleTimeline, type ScheduleScale } from '@/lib/action-cases/scheduleTimeline'

export default function ProjectScheduleGantt({ rows, selectedId, onSelect }: { rows: ProjectScheduleRow[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [mode, setMode] = useState<ScheduleScale>('week')
  const viewport = useRef<HTMLDivElement>(null)
  const timeline = scheduleTimeline(rows, mode)
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date())
  const todayDate = scheduleDate(today)
  const todayLeft = timeline && todayDate && +todayDate >= +timeline.start && +todayDate < +timeline.end ? timeline.scale(todayDate) : null
  return <section className="gizmo-gantt" aria-label="Visuell tidsplan">
    <div className="gizmo-schedule-toolbar"><div className="gizmo-schedule-heading"><CalendarDays size={18} /><h4>Produktionsplan</h4><span>{rows.length} moment</span></div>
      <div className="gizmo-schedule-tools"><div className="gizmo-schedule-segments" role="group" aria-label="Tidsplanens skala">{(['week', 'month'] as const).map(value => <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === 'week' ? 'Vecka' : 'Månad'}</button>)}</div>
        <button type="button" className="gizmo-schedule-icon" title="Gå till idag" aria-label="Gå till idag" disabled={todayLeft === null} onClick={() => { const node = viewport.current; if (node && timeline && todayLeft !== null) node.scrollTo({ left: Math.max(0, timeline.width * todayLeft / 100 - (node.clientWidth - 190) / 2) }) }}><LocateFixed size={17} /></button>
      </div>
    </div>
    {timeline ? <div ref={viewport} className="gizmo-gantt-viewport" role="region" aria-label="Gantt med projektets moment" tabIndex={0}>
      <div className="gizmo-gantt-canvas" style={{ width: `calc(var(--schedule-label-width) + ${timeline.width}px)` }}>
        <div className="gizmo-gantt-header"><div className="gizmo-gantt-name">Moment</div><div className="gizmo-gantt-axis">{timeline.bands.map((band, index) => <span className="gizmo-gantt-month" key={index} style={{ left: `${band.left}%`, width: `${band.width}%` }}>{band.label}</span>)}{timeline.ticks.map(tick => <span className="gizmo-gantt-tick" key={tick.date} style={{ left: `${tick.left}%`, width: `${tick.width}%` }}>{tick.label}</span>)}</div></div>
        {rows.map((row, index) => { const bar = timeline.bars[index], days = scheduleDays(row)
          const label = `${row.title || 'Nytt moment'} · ${scheduleDateLabel(row.startDate)} – ${scheduleDateLabel(row.endDate)} · ${scheduleStatuses[row.status]}`
          return <div key={row.id} className={`gizmo-gantt-row${selectedId === row.id ? ' is-selected' : ''}`}>
            <button type="button" className="gizmo-gantt-name" title={row.title || 'Nytt moment'} onClick={() => onSelect(row.id)}><span>{index + 1}</span><strong>{row.title || 'Nytt moment'}</strong></button>
            <div className="gizmo-gantt-track">{timeline.ticks.map(tick => <span aria-hidden="true" className="gizmo-gantt-line" key={tick.date} style={{ left: `${tick.left}%` }} />)}
              {todayLeft !== null && <span className="gizmo-gantt-today" aria-hidden="true" style={{ left: `${todayLeft}%` }} />}
              {(bar.kind === 'range' || bar.kind === 'partial') ? <button type="button" className={`gizmo-gantt-bar is-${row.status}${bar.kind === 'partial' ? ' is-partial' : ''}`} aria-label={label} title={label} onClick={() => onSelect(row.id)} style={{ left: `${bar.left}%`, width: bar.kind === 'partial' ? 10 : `${bar.width}%` }}>{days !== null && bar.width * timeline.width / 100 > 44 ? `${days} d` : ''}</button>
                : <span className={`gizmo-gantt-unplanned${bar.kind === 'invalid' ? ' is-invalid' : ''}`}>{bar.kind === 'invalid' ? 'Kontrollera datum' : 'Datum saknas'}</span>}
            </div>
          </div>
        })}
      </div>
    </div> : <div className="gizmo-gantt-empty"><CalendarDays size={22} /><span>{rows.length ? 'Inga datum planerade' : 'Inga moment planerade'}</span></div>}
    <div className="gizmo-gantt-legend">{Object.entries(scheduleStatuses).map(([key, label]) => <span key={key}><i className={`is-${key}`} />{label}</span>)}{todayLeft !== null && <span><i className="is-today" />Idag</span>}</div>
  </section>
}
