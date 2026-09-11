'use client'

import { useEffect, useEffectEvent, useRef, type MouseEvent } from 'react'

type Gesture = {
  roomKey: string
  identifier: number
  x: number
  y: number
  scrollY: number
  startedAt: number
  control: Element | null
}

const fields = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

export function useObRoomSwipe(roomKey: string | null, onStep: (step: -1 | 1) => void) {
  const root = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const suppressedClick = useRef<{ control: Element; until: number } | null>(null)

  function blocked() {
    return !roomKey || Boolean(document.querySelector('dialog[open], [aria-modal="true"]')) ||
      Boolean(document.activeElement?.matches(fields)) ||
      window.getSelection()?.isCollapsed === false
  }

  function onTouchStart(event: TouchEvent) {
    gesture.current = null
    suppressedClick.current = null
    if (event.touches.length !== 1 || blocked()) return
    const target = event.target
    if (!(target instanceof Element) || target.closest(`${fields}, label, a, img, video, canvas, .obm-place-images, nav`)) return
    const control = target.closest('button, summary, [role="button"]')
    if (control && !control.matches('.obm-note-row, .obm-result-text, .obm-category > summary')) return
    const touch = event.touches[0]
    // Leave screen-edge gestures to the browser/OS. Never prevent vertical scrolling or zoom.
    if (touch.clientX < 24 || touch.clientX > window.innerWidth - 24) return
    gesture.current = {
      roomKey: roomKey!, identifier: touch.identifier,
      x: touch.clientX, y: touch.clientY, scrollY: window.scrollY, startedAt: event.timeStamp,
      control,
    }
  }

  function onTouchMove(event: TouchEvent) {
    const start = gesture.current
    if (!start || event.timeStamp < start.startedAt || event.timeStamp > start.startedAt + 1000) return
    if (!Array.from(event.touches).some(touch => touch.identifier === start.identifier)) return
    const touch = event.touches[0]
    if (event.touches.length !== 1 || blocked()) {
      gesture.current = null
      return
    }
    const dx = Math.abs(touch.clientX - start.x), dy = Math.abs(touch.clientY - start.y)
    if (dy > 16 && dy > dx * 0.6) gesture.current = null
  }

  function onTouchEnd(event: TouchEvent) {
    const start = gesture.current
    if (!start || event.timeStamp < start.startedAt) return
    gesture.current = null
    if (start.roomKey !== roomKey || blocked() || event.touches.length) return
    const touch = Array.from(event.changedTouches).find(row => row.identifier === start.identifier)
    if (!touch) return
    const dx = touch.clientX - start.x, dy = Math.abs(touch.clientY - start.y)
    if (Math.abs(dx) < 64 || dy > 48 || Math.abs(dx) < dy * 2 ||
      event.timeStamp - start.startedAt > 1000 || Math.abs(window.scrollY - start.scrollY) > 8) return
    // A swipe over a note/category must not also open it on touch release.
    if (start.control) suppressedClick.current = { control: start.control, until: performance.now() + 500 }
    onStep(dx < 0 ? 1 : -1)
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    const suppressed = suppressedClick.current
    if (event.detail > 0 && suppressed && performance.now() < suppressed.until &&
      event.target instanceof Node && suppressed.control.contains(event.target)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const onTouch = useEffectEvent((event: TouchEvent) => {
    if (event.type === 'touchstart') onTouchStart(event)
    else if (event.type === 'touchmove') onTouchMove(event)
    else if (event.type === 'touchend') onTouchEnd(event)
    else if (gesture.current && event.timeStamp >= gesture.current.startedAt) gesture.current = null
  })
  useEffect(() => {
    const element = root.current!
    const listener = (event: TouchEvent) => onTouch(event)
    const types = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const
    // Native listeners keep gesture events ordered without React's continuous-event replay.
    for (const type of types) element.addEventListener(type, listener, { capture: true, passive: true })
    return () => {
      for (const type of types) element.removeEventListener(type, listener, true)
      gesture.current = null
    }
  }, [])

  return { ref: root, onClickCapture }
}
