'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Building2, Clock3, ExternalLink, RotateCcw } from 'lucide-react'
import { bookingTimeLabel, compareBookings, isTentativeBooking } from '@/lib/dashboard/calendar'
import type { DashboardBooking } from '@/lib/dashboard/model'
import type { DashboardTravelResponse } from '@/lib/dashboard/travel'
import styles from './TravelSummary.module.css'

type Props = { bookings: DashboardBooking[]; organizationId?: string; date: string }
type RequestState = { key: string; phase: 'loading' | 'ready' | 'error'; data?: DashboardTravelResponse }

function durationLabel(seconds: number) {
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 1) return 'Mindre än 1 min'
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} tim${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`
}

function distanceLabel(meters: number) {
  if (meters < 1_000) return `${Math.round(meters)} m`
  return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 }).format(meters / 1_000)} km`
}

function validMeasure(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validResponse(value: DashboardTravelResponse, date: string, organizationId: string | undefined, ids: string[], includesTentative: boolean) {
  if (!value || value.date !== date || typeof value.organizationId !== 'string' || !value.organizationId
    || (organizationId && value.organizationId !== organizationId)
    || value.includesTentative !== includesTentative
    || !Array.isArray(value.bookingIds) || value.bookingIds.length !== ids.length
    || value.bookingIds.some((id, index) => id !== ids[index])
    || !value.origin || !['located', 'address_missing', 'not_found', 'unavailable'].includes(value.origin.status)
    || typeof value.origin.label !== 'string'
    || !value.route || !['ready', 'unavailable', 'insufficient_points', 'origin_missing', 'locations_missing'].includes(value.route.status)
    || !Array.isArray(value.route.legs) || !Array.isArray(value.directionsLinks)) return false
  if (value.route.status === 'ready' && (value.origin.status !== 'located'
    || !validMeasure(value.route.durationSeconds) || !validMeasure(value.route.distanceMeters)
    || value.route.legs.length !== ids.length
    || value.route.legs.some((leg, index) => !leg || leg.fromId !== (index ? ids[index - 1] : 'company-origin')
      || leg.toId !== ids[index] || !validMeasure(leg.durationSeconds) || !validMeasure(leg.distanceMeters)))) return false
  return value.directionsLinks.every(href => {
    if (typeof href !== 'string') return false
    try {
      const url = new URL(href)
      return url.protocol === 'https:' && url.hostname === 'www.google.com' && url.pathname === '/maps/dir/'
    } catch { return false }
  })
}

export default function TravelSummary({ bookings, organizationId, date }: Props) {
  const sectionRef = useRef<HTMLElement>(null)
  const [includeTentative, setIncludeTentative] = useState(true)
  const [request, setRequest] = useState<RequestState | null>(null)
  const [retry, setRetry] = useState(0)
  const selectedBookings = useMemo(() => bookings.filter(booking => includeTentative || !isTentativeBooking(booking))
    .toSorted(compareBookings), [bookings, includeTentative])
  const key = JSON.stringify([organizationId, date, includeTentative, selectedBookings.map(booking => [
    booking.id, booking.startsAt, booking.status, booking.address, booking.latitude, booking.longitude,
  ])])

  useEffect(() => {
    if (!selectedBookings.length) return
    const controller = new AbortController()
    let observer: IntersectionObserver | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let started = false
    let disposed = false
    const load = async () => {
      if (started || controller.signal.aborted) return
      started = true
      observer?.disconnect()
      setRequest({ key, phase: 'loading' })
      timeout = setTimeout(() => {
        if (disposed) return
        controller.abort()
        setRequest({ key, phase: 'error' })
      }, 45_000)
      const params = new URLSearchParams({ date, includeTentative: includeTentative ? '1' : '0' })
      if (organizationId) params.set('orgId', organizationId)
      const ids = selectedBookings.map(booking => booking.id)
      for (const id of ids) params.append('bookingId', id)
      try {
        const response = await fetch(`/api/dashboard/travel?${params}`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('TRAVEL_UNAVAILABLE')
        const data = await response.json() as DashboardTravelResponse
        if (disposed || controller.signal.aborted) return
        if (!validResponse(data, date, organizationId, ids, includeTentative)) throw new Error('TRAVEL_SCOPE_CHANGED')
        setRequest({ key, phase: 'ready', data })
      } catch {
        if (!disposed && !controller.signal.aborted) setRequest({ key, phase: 'error' })
      } finally {
        clearTimeout(timeout)
      }
    }
    if (typeof IntersectionObserver === 'undefined') {
      void load()
    } else {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) void load()
      }, { rootMargin: '100px' })
      if (sectionRef.current) observer.observe(sectionRef.current)
    }
    return () => {
      disposed = true
      clearTimeout(timeout)
      controller.abort()
      observer?.disconnect()
    }
    // A new dashboard snapshot also rechecks the current company address, even
    // when the appointment values stayed the same. Local UI renders stay stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry, bookings])

  const currentRequest = request?.key === key ? request : null
  const data = currentRequest?.data
  const ready = currentRequest?.phase === 'ready' && data?.route.status === 'ready'
  const loading = selectedBookings.length > 0 && (!currentRequest || currentRequest.phase === 'loading')
  const missingOrigin = data?.origin.status === 'address_missing'
  const originNotFound = data?.origin.status === 'not_found'
  const routeUnavailable = currentRequest?.phase === 'error' || (data && !ready && !missingOrigin && !originNotFound)
  const getBooking = (id: string) => selectedBookings.find(booking => booking.id === id)

  return (
    <section ref={sectionRef} className={styles.wrapper} data-testid="dashboard-travel" aria-label="Restid från företaget">
      <div className={styles.heading}>
        <span className={styles.headingIcon} aria-hidden="true"><Clock3 size={19} /></span>
        <h3>Restid från företaget</h3>
      </div>
      <label className={styles.checkbox}>
        <input type="checkbox" checked={includeTentative} onChange={event => setIncludeTentative(event.target.checked)} />
        Ta med preliminära uppdrag
      </label>

      {selectedBookings.length === 0 ? (
        <div className={styles.message} role="status">
          <strong>{bookings.length && !includeTentative ? 'Inga bekräftade uppdrag den här dagen' : 'Inga uppdrag den här dagen'}</strong>
          <p>{bookings.length ? 'Ta med preliminära uppdrag för att beräkna dagens resväg.' : 'Restiden visas när det finns uppdrag i kalendern.'}</p>
        </div>
      ) : loading ? (
        <p className={styles.loading} role="status"><Clock3 size={16} aria-hidden="true" /> Beräknar restid…</p>
      ) : missingOrigin || originNotFound ? (
        <div className={styles.message} role="status">
          <strong>{missingOrigin ? 'Företagets adress saknas' : 'Företagets adress kunde inte hittas'}</strong>
          <p>{originNotFound && data?.origin.address ? `${data.origin.address}. ` : ''}Lägg till eller kontrollera adressen för att beräkna resan till första uppdraget.</p>
          <Link className={styles.settingsLink} href="/settings/organisation">Öppna företagsinställningar <ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
      ) : routeUnavailable ? (
        <div className={styles.message} role="status">
          <strong>Restiden kunde inte beräknas</strong>
          <p>{data?.route.status === 'locations_missing'
            ? 'Någon av uppdragens adresser kunde inte hittas. Kontrollera besöksadresserna i uppdragen.'
            : 'Kontrollera företagsadressen och uppdragens besöksadresser, eller försök igen.'}</p>
          <button className={styles.retry} type="button" onClick={() => setRetry(value => value + 1)}><RotateCcw size={14} aria-hidden="true" /> Försök igen</button>
        </div>
      ) : ready && data ? (
        <>
          <div className={styles.summary}>
            <div className={styles.total} data-testid="travel-total">
              <span>Beräknad körtid</span>
              <strong>{durationLabel(data.route.durationSeconds!)}</strong>
              <span>{distanceLabel(data.route.distanceMeters!)}</span>
            </div>
            <div className={styles.origin}><Building2 size={17} aria-hidden="true" /><div><strong>{data.origin.label}</strong><span>{data.origin.address || 'Företagets registrerade position'}</span></div></div>
          </div>
          <ol className={styles.legs} aria-label="Körtid mellan stoppen">
            {data.route.legs.map(leg => {
              const destination = getBooking(leg.toId)!
              const previous = getBooking(leg.fromId)
              return (
                <li key={`${leg.fromId}:${leg.toId}`} data-from-id={leg.fromId} data-to-id={leg.toId}>
                  <span className={`${styles.stopIcon}${isTentativeBooking(destination) ? ` ${styles.tentativeStop}` : ''}`} aria-hidden="true">{isTentativeBooking(destination) ? <Clock3 size={13} /> : <ArrowRight size={13} />}</span>
                  <div className={styles.legPlaces}>
                    <span className={styles.legFrom}>{previous?.title || data.origin.label} <ArrowRight size={12} aria-hidden="true" /></span>
                    <strong>{destination.title}</strong>
                    <span>{bookingTimeLabel(destination)}{isTentativeBooking(destination) && <span className={styles.tentativeLabel}> · Preliminärt</span>}</span>
                  </div>
                  <div className={styles.legMeasures}><strong>{durationLabel(leg.durationSeconds)}</strong><span>{distanceLabel(leg.distanceMeters)}</span></div>
                </li>
              )
            })}
          </ol>
        </>
      ) : null}
      {data && data.directionsLinks.length > 0 && <div className={styles.directions}>{data.directionsLinks.map((href, index) => (
        <a key={href} href={href} target="_blank" rel="noopener noreferrer">{data.directionsLinks.length > 1 ? `Öppna resväg ${index + 1}` : 'Öppna resväg'} <ExternalLink size={14} aria-hidden="true" /></a>
      ))}</div>}
      {ready && data?.approximate && <p className={styles.precision}>En eller flera adresser har ungefärlig position.</p>}
      <p className={styles.caption}>Beräknad körtid utan aktuell trafik. Ingen återresa ingår.</p>
      <p className={styles.attribution}><a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener noreferrer">OSRM · OpenStreetMap</a><span aria-hidden="true"> · </span><a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">Rätta kartan</a></p>
    </section>
  )
}
