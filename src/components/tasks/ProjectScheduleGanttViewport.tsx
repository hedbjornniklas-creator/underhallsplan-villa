'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { GripHorizontal, RotateCcw } from 'lucide-react'

const minHeight = 180, maxHeight = 1000
const boundedHeight = (height: number) => Math.round(Math.max(minHeight, Math.min(maxHeight, height)))

export default function ProjectScheduleGanttViewport({ children, viewportRef }: { children: ReactNode; viewportRef: RefObject<HTMLDivElement | null> }) {
  const viewportId = useId()
  const [height, setHeight] = useState<number | null>(null)
  const [measuredHeight, setMeasuredHeight] = useState(minHeight)
  const drag = useRef<{ pointerId: number; y: number; height: number; previous: number | null } | null>(null)

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const observer = new ResizeObserver(() => setMeasuredHeight(boundedHeight(node.getBoundingClientRect().height)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [viewportRef])

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || drag.current || !viewportRef.current) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, y: event.clientY, height: viewportRef.current.getBoundingClientRect().height, previous: height }
  }

  function finishResize(event: PointerEvent<HTMLDivElement>, cancel = false) {
    if (drag.current?.pointerId !== event.pointerId) return
    if (cancel) setHeight(drag.current.previous)
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && drag.current) {
      event.preventDefault()
      const { pointerId, previous } = drag.current
      drag.current = null
      setHeight(previous)
      if (event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture(pointerId)
      return
    }
    const step = event.shiftKey ? 100 : 40
    const current = viewportRef.current?.getBoundingClientRect().height ?? measuredHeight
    const next = event.key === 'ArrowUp' ? current - step : event.key === 'ArrowDown' ? current + step : event.key === 'Home' ? minHeight : event.key === 'End' ? maxHeight : null
    if (next === null) return
    event.preventDefault()
    setHeight(boundedHeight(next))
  }

  return <>
    <div id={viewportId} ref={viewportRef} className="gizmo-gantt-viewport" role="region" aria-label="Gantt med projektets moment" tabIndex={0} style={height === null ? undefined : { height, maxHeight: height }}>
      {children}
    </div>
    <div className="gizmo-gantt-resize-tools">
      <div className="gizmo-gantt-resizer" role="separator" aria-label="Gantt-rutans höjd" aria-orientation="horizontal" aria-controls={viewportId} aria-valuemin={minHeight} aria-valuemax={maxHeight} aria-valuenow={height ?? measuredHeight} aria-valuetext={`${height ?? measuredHeight} pixlar`} tabIndex={0} title="Ändra höjd: dra eller använd upp-/nedpil" onPointerDown={startResize} onPointerMove={event => {
        if (drag.current?.pointerId === event.pointerId) setHeight(boundedHeight(drag.current.height + event.clientY - drag.current.y))
      }} onPointerUp={event => finishResize(event)} onPointerCancel={event => finishResize(event, true)} onLostPointerCapture={() => { drag.current = null }} onKeyDown={resizeWithKeyboard}><GripHorizontal size={20} aria-hidden="true" /></div>
      <button type="button" className="gizmo-schedule-icon gizmo-gantt-reset-height" title="Återställ Gantt-rutans höjd" aria-label="Återställ Gantt-rutans höjd" disabled={height === null} onClick={() => setHeight(null)}><RotateCcw size={16} aria-hidden="true" /></button>
    </div>
  </>
}
