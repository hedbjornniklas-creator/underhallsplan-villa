'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, RotateCcw } from 'lucide-react'
import type { DashboardBooking } from '@/lib/dashboard/model'
import type { DashboardMapLocation } from '@/lib/dashboard/geocoding'
import 'leaflet/dist/leaflet.css'
import styles from './DailyRouteMap.module.css'

type Props = { bookings: DashboardBooking[]; organizationId?: string; date: string }
type MapResponse = { organizationId?: string; date: string; locations: DashboardMapLocation[] }
type RequestState = { key: string; phase: 'loading' | 'ready' | 'error'; locations: DashboardMapLocation[] }
type PlottedBooking = DashboardBooking & { latitude: number; longitude: number; order: number; approximate?: boolean }

function validCoordinates(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180
}

function MapCanvas({ points, mapKey }: { points: PlottedBooking[]; mapKey: string }) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<{ key: string; tiles: boolean } | null>(null)

  useEffect(() => {
    let disposed = false
    let map: import('leaflet').Map | undefined
    let resizeObserver: ResizeObserver | undefined
    const initialize = async () => {
      const L = await import('leaflet')
      if (disposed || !canvasRef.current) return
      map = L.map(canvasRef.current, {
        scrollWheelZoom: false,
        zoomControl: true,
        attributionControl: true,
      })
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
      }).on('tileerror', () => {
        if (!disposed) setError({ key: mapKey, tiles: true })
      }).addTo(map)

      const coordinates = points.map(point => [point.latitude, point.longitude] as [number, number])
      if (coordinates.length > 1) {
        L.polyline(coordinates, { color: '#245eb5', opacity: 0.7, weight: 3, dashArray: '5 9' }).addTo(map)
      }
      for (const point of points) {
        const popup = document.createElement('div')
        popup.className = styles.popup
        const title = document.createElement('strong')
        title.textContent = `${point.order}. ${point.title}`
        popup.append(title)
        const address = document.createElement('p')
        address.textContent = point.address || 'Position registrerad på uppdraget'
        popup.append(address)
        if (point.approximate) {
          const precision = document.createElement('p')
          precision.textContent = 'Ungefärlig position på gatan'
          popup.append(precision)
        }
        if (point.href.startsWith('/') && !point.href.startsWith('//')) {
          const link = document.createElement('a')
          link.href = point.href
          link.textContent = 'Öppna uppdrag'
          popup.append(link)
        }
        L.marker([point.latitude, point.longitude], {
          icon: L.divIcon({
            className: styles.marker,
            html: `<span>${point.order}</span>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
          }),
          title: `${point.order}. ${point.title}${point.approximate ? ' – ungefärlig position' : ''}`,
          alt: `Stopp ${point.order}: ${point.title}`,
          keyboard: true,
        }).bindPopup(popup).addTo(map)
      }
      map.fitBounds(L.latLngBounds(coordinates), { padding: [45, 45], maxZoom: 14 })
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => map?.invalidateSize({ animate: false, pan: false }))
        resizeObserver.observe(canvasRef.current)
      }
    }
    initialize().catch(() => {
      if (!disposed) setError({ key: mapKey, tiles: false })
    })
    return () => {
      disposed = true
      resizeObserver?.disconnect()
      map?.remove()
    }
  }, [points, mapKey])

  const currentError = error?.key === mapKey ? error : null
  return (
    <div className={styles.mapFrame}>
      <div ref={canvasRef} className={styles.canvas} aria-label="Karta över dagens bokade uppdrag" />
      {currentError && (
        <div className={styles.mapError} role="status">
          {currentError.tiles ? 'Kartbakgrunden kunde inte laddas. Öppna vägbeskrivningen för att se körvägen.' : 'Kartan kunde inte laddas. Öppna vägbeskrivningen för dagens uppdrag.'}
        </div>
      )}
      {points.length > 1 && <p className={styles.orderLabel}><span /> Stopp i bokningsordning</p>}
    </div>
  )
}

export default function DailyRouteMap({ bookings, organizationId, date }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [request, setRequest] = useState<RequestState | null>(null)
  const [retry, setRetry] = useState(0)
  const key = JSON.stringify([organizationId, date, bookings.map(booking => [booking.id, booking.address, booking.latitude, booking.longitude])])
  const needsGeocoding = bookings.some(booking => booking.address?.trim() && !validCoordinates(booking.latitude, booking.longitude))

  useEffect(() => {
    if (!needsGeocoding) return
    const controller = new AbortController()
    let observer: IntersectionObserver | undefined
    let started = false
    let disposed = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      if (started || controller.signal.aborted) return
      started = true
      observer?.disconnect()
      setRequest({ key, phase: 'loading', locations: [] })
      timeout = setTimeout(() => {
        if (disposed) return
        controller.abort()
        setRequest({ key, phase: 'error', locations: [] })
      }, 30_000)
      const params = new URLSearchParams({ date })
      if (organizationId) params.set('orgId', organizationId)
      for (const booking of bookings) params.append('bookingId', booking.id)
      try {
        const response = await fetch(`/api/dashboard/map?${params}`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('MAP_UNAVAILABLE')
        const data = await response.json() as MapResponse
        if (controller.signal.aborted) return
        if (data.date !== date || !Array.isArray(data.locations)
          || !data.locations.every(location => location && typeof location.id === 'string'
            && ['located', 'address_missing', 'not_found', 'unavailable'].includes(location.status))
          || (organizationId && data.organizationId !== organizationId)) {
          throw new Error('MAP_SCOPE_CHANGED')
        }
        setRequest({ key, phase: 'ready', locations: data.locations })
      } catch {
        if (!controller.signal.aborted) setRequest({ key, phase: 'error', locations: [] })
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
      if (wrapperRef.current) observer.observe(wrapperRef.current)
    }
    return () => {
      disposed = true
      clearTimeout(timeout)
      controller.abort()
      observer?.disconnect()
    }
    // `key` contains every request input; parent rerenders must not repeat lookups.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, needsGeocoding, retry])

  const currentRequest = request?.key === key ? request : null
  const points = useMemo(() => {
    const locations = new Map(currentRequest?.locations.map(location => [location.id, location]))
    return bookings.flatMap((booking, index): PlottedBooking[] => {
      if (validCoordinates(booking.latitude, booking.longitude)) {
        return [{ ...booking, latitude: booking.latitude as number, longitude: booking.longitude as number, order: index + 1 }]
      }
      const location = locations.get(booking.id)
      return location?.status === 'located' && validCoordinates(location.latitude, location.longitude)
        ? [{ ...booking, latitude: location.latitude as number, longitude: location.longitude as number, order: index + 1, approximate: location.approximate }]
        : []
    })
  }, [bookings, currentRequest])

  const missingAddress = bookings.filter(booking => !booking.address?.trim() && !validCoordinates(booking.latitude, booking.longitude)).length
  const loading = needsGeocoding && (!currentRequest || currentRequest.phase === 'loading')
  const unavailable = currentRequest?.phase === 'error' || currentRequest?.locations.some(location => location.status === 'unavailable')
  const unresolved = bookings.length - points.length - missingAddress

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      {points.length > 0 ? <MapCanvas points={points} mapKey={key} /> : (
        <div className={styles.empty} role="status">
          <span className={styles.emptyIcon}><MapPin size={26} strokeWidth={1.6} /></span>
          <strong>{bookings.length === 0 ? 'Inga bokade uppdrag den här dagen' : loading ? 'Letar upp dagens adresser…' : 'Uppdragen kan inte placeras på kartan'}</strong>
          <p>{bookings.length === 0 ? 'När ett uppdrag bokas visas platsen här.' : loading ? 'Kartan visas så snart adresserna är hittade.' : missingAddress === bookings.length ? 'Lägg till besöksadress i uppdragen för att se dem här.' : 'Använd vägbeskrivningen eller kontrollera uppdragens besöksadresser.'}</p>
        </div>
      )}
      {(points.length > 0 || missingAddress > 0 || unavailable) && (
        <div className={styles.caption} aria-live="polite">
          <p>
            {points.length > 0 && `${points.length} av ${bookings.length} uppdrag visas. `}
            {loading && 'Resterande adresser hämtas. '}
            {missingAddress > 0 && `${missingAddress} uppdrag saknar adress. `}
            {!loading && unresolved > 0 && !unavailable && `${unresolved} ${unresolved === 1 ? 'adress kunde' : 'adresser kunde'} inte hittas. `}
            {unavailable && 'Några adresser kunde inte hämtas just nu. '}
            {points.length > 1 && 'Streckad linje visar stoppens ordning. Körvägen visas i vägbeskrivningen.'}
          </p>
          {unavailable && <button type="button" onClick={() => setRetry(value => value + 1)}><RotateCcw size={14} /> Försök igen</button>}
        </div>
      )}
    </div>
  )
}
