'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Mail, Send } from 'lucide-react'
import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import { resolveInspectorCertificationSummary } from '@/lib/certifications/profileResolver'
import { formatCertificationDisplayLines } from '@/lib/certifications/display'
import type { InspectorCertificationListItem } from '@/lib/certifications/profileSummary'

type DashboardCard = {
  id: 'list' | 'create' | 'profile' | 'assignments'
}

type InspectionListItem = {
  id: string
  address: string | null
  customer: string | null
  status: string | null
  href: string
}

type PropertyRow = {
  id: string
  address: string | null
  client_name: string | null
}

type PropertySeedRow = {
  id: string
  owner: string | null
  created_at: string | null
  name: string
  address: string | null
  postal_code: string | null
  city: string | null
  municipality: string | null
  cadastral_id: string | null
  owner_name: string | null
  client_name: string | null
  contact_person: string | null
  tenure_type: string | null
  dwelling_type: string | null
  property_type: string | null
  plot_area_m2: number | null
  area_m2: number | null
  area_sqm: number | null
  tax_value: number | null
  planning_status: string | null
  type_code: string | null
  heating: string | null
  ventilation: string | null
  roof_type: string | null
  year_built: number | null
  cover_path: string | null
  status: string | null
  last_inspected: string | null
  last_inspection_at: string | null
}

type InspectionRow = {
  id: string
  property_id: string
  status: string | null
  client_name: string | null
}

type BookedAssignmentRow = {
  id: string
  status: string | null
  customer_name: string | null
  customer_email: string | null
  property_address: string | null
  preliminary_address: string | null
  preferred_date: string | null
  booked_at: string | null
}

type BookedAssignmentListItem = {
  id: string
  customer: string | null
  address: string | null
  preferredDate: string | null
  bookedAt: string | null
}

type SnapshotRow = {
  inspection_id: string
  address: string | null
  client_name: string | null
}

type ObSnapshotClient = {
  from: (table: 'ob_property_snapshot') => {
    upsert: (
      payload: Record<string, unknown>,
      options: { onConflict: string }
    ) => Promise<{ error: unknown | null }>
    select: (columns: string) => {
      in: (
        column: 'inspection_id',
        values: string[]
      ) => Promise<{ data: SnapshotRow[] | null; error: unknown | null }>
    }
  }
}

type ProfileCardInfo = {
  full_name: string | null
  sbr_group: string | null
  sbr_status: string | null
  membership_number: string | null
  certification_number: string | null
  certification_items: InspectorCertificationListItem[]
  phone: string | null
  email: string | null
  company_name: string | null
  company_orgno: string | null
  company_address: string | null
  company_postal_code: string | null
  company_city: string | null
  avatar_path: string | null
  logo_path?: string | null
  logo_url?: string | null
}

const MODULES: DashboardCard[] = [{ id: 'assignments' }, { id: 'create' }, { id: 'list' }, { id: 'profile' }]

function resolvePublicMediaUrl(path: string | null | undefined) {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null

  if (path.startsWith('/storage/')) {
    return `${base}${path}`
  }

  if (path.startsWith('storage/')) {
    return `${base}/${path}`
  }

  if (path.startsWith('/')) {
    return path
  }

  return `${base}/storage/v1/object/public/property-media/${path}`
}

function getStatusLabel(status: string | null) {
  switch (getStatusBucket(status)) {
    case 'draft':
      return 'Utkast'
    case 'completed':
      return 'Klar'
    case 'archived':
      return 'Arkiverad'
    default:
      return 'Pågående'
  }
}

function getStatusBucket(status: string | null): 'draft' | 'ongoing' | 'completed' | 'archived' {
  const value = status?.trim().toLowerCase() ?? ''
  if (value === 'draft' || value === 'utkast') return 'draft'
  if (value === 'completed' || value === 'klar' || value === 'done') return 'completed'
  if (value === 'archived' || value === 'arkiverad') return 'archived'
  return 'ongoing'
}

function formatDate(raw: string | null) {
  if (!raw) return '-'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleDateString('sv-SE')
}

function cardShell(children: React.ReactNode, accent = 'from-indigo-500 to-sky-400') {
  return (
    <article className="group relative aspect-square h-full overflow-hidden rounded-2xl border border-white/40 bg-white/90 p-3 shadow-2xl ring-1 ring-black/5 backdrop-blur-md transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_30px_70px_-26px_rgba(15,23,42,0.65)]">
      <div className={`pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b ${accent}`} />
      <div className="pointer-events-none absolute left-4 right-4 top-0 h-px bg-white/60" />
      {children}
    </article>
  )
}

function InspectionsListCard({
  inspections,
  inspectionsLoading,
  inspectionsError,
}: {
  inspections: InspectionListItem[]
  inspectionsLoading: boolean
  inspectionsError: string | null
}) {
  return cardShell(
    <div className="relative flex h-full flex-col rounded-lg border border-indigo-100 bg-white/70 p-2">
      <Link
        href="/inspections"
        className="inline-flex w-fit items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-600 underline-offset-2 transition hover:text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
      >
        Mina besiktningar
        <ArrowRight size={11} aria-hidden="true" />
      </Link>

      {inspectionsLoading ? (
        <p className="mt-1 text-xs text-gray-500">Laddar besiktningar...</p>
      ) : inspectionsError ? (
        <p className="mt-1 text-xs text-rose-700">Kunde inte hämta besiktningar.</p>
      ) : inspections.length === 0 ? (
        <p className="mt-1 text-xs text-gray-500">Inga besiktningar hittades.</p>
      ) : (
        <ul className="mt-1 flex-1 space-y-1 overflow-auto pr-1">
          {inspections.map((inspection) => (
            <li
              key={inspection.id}
              className="rounded-md border border-gray-200 bg-white/90 transition-colors hover:bg-indigo-50/70"
            >
              <Link
                href={inspection.href}
                className="block cursor-pointer px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
              >
                <div className="truncate text-[11px] font-medium text-gray-900">
                  {inspection.address ?? 'Adress saknas'}
                </div>
                <div className="truncate text-[11px] text-gray-500">
                  {inspection.customer ?? 'Kund saknas'}
                </div>
                <div className="mt-1 text-[10px] font-semibold text-indigo-700">
                  {getStatusLabel(inspection.status)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CreateInspectionCard({
  bookedAssignments,
  bookedAssignmentsLoading,
  bookedAssignmentsError,
}: {
  bookedAssignments: BookedAssignmentListItem[]
  bookedAssignmentsLoading: boolean
  bookedAssignmentsError: string | null
}) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [convertError, setConvertError] = useState<string | null>(null)
  const [selectedAssignment, setSelectedAssignment] = useState<BookedAssignmentListItem | null>(null)
  const [convertingAssignmentId, setConvertingAssignmentId] = useState<string | null>(null)

  const buildSnapshotPayload = (inspectionId: string, propertyData: PropertySeedRow) => ({
    inspection_id: inspectionId,
    source_property_id: propertyData.id,
    source_property_owner: propertyData.owner ?? null,
    source_property_created_at: propertyData.created_at ?? null,
    imported_at: new Date().toISOString(),
    snapshot_version: 1,
    name: propertyData.name ?? null,
    address: propertyData.address ?? null,
    postal_code: propertyData.postal_code ?? null,
    city: propertyData.city ?? null,
    municipality: propertyData.municipality ?? null,
    cadastral_id: propertyData.cadastral_id ?? null,
    owner_name: propertyData.owner_name ?? null,
    client_name: propertyData.client_name ?? null,
    contact_person: propertyData.contact_person ?? null,
    tenure_type: propertyData.tenure_type ?? null,
    dwelling_type: propertyData.dwelling_type ?? null,
    property_type: propertyData.property_type ?? null,
    plot_area_m2: propertyData.plot_area_m2 ?? null,
    area_m2: propertyData.area_m2 ?? null,
    area_sqm: propertyData.area_sqm ?? null,
    tax_value: propertyData.tax_value ?? null,
    planning_status: propertyData.planning_status ?? null,
    type_code: propertyData.type_code ?? null,
    heating: propertyData.heating ?? null,
    ventilation: propertyData.ventilation ?? null,
    roof_type: propertyData.roof_type ?? null,
    year_built: propertyData.year_built ?? null,
    cover_path: propertyData.cover_path ?? null,
    status: propertyData.status ?? null,
    last_inspected: propertyData.last_inspected ?? null,
    last_inspection_at: propertyData.last_inspection_at ?? null,
  })

  const handleCreateFromScratch = async () => {
    if (creating) return

    try {
      setCreating(true)
      setCreateError(null)

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) throw userError
      if (!user) {
        router.replace('/login')
        return
      }

      const today = new Date().toISOString().slice(0, 10)
      const short = Math.random().toString(36).slice(2, 6).toUpperCase()
      const tempName = `Fastighet ${today} ${short}`

      const { data: propertyData, error: propertyError } = await supabase
        .from('properties')
        .insert({
          owner: user.id,
          name: tempName,
          status: 'Utkast',
        })
        .select(
          'id,owner,created_at,name,address,postal_code,city,municipality,cadastral_id,owner_name,client_name,contact_person,tenure_type,dwelling_type,property_type,plot_area_m2,area_m2,area_sqm,tax_value,planning_status,type_code,heating,ventilation,roof_type,year_built,cover_path,status,last_inspected,last_inspection_at'
        )
        .single()

      if (propertyError || !propertyData) {
        throw propertyError ?? new Error('Kunde inte skapa fastighet.')
      }

      const sourceProperty = propertyData as PropertySeedRow

      const { data: inspectionData, error: inspectionError } = await supabase
        .from('inspections')
        .insert({
          property_id: sourceProperty.id,
          type: 'OB',
          status: 'draft',
        })
        .select('id')
        .single()

      if (inspectionError || !inspectionData) {
        throw inspectionError ?? new Error('Kunde inte skapa besiktning.')
      }

      const { error: conditionsError } = await supabase
        .from('inspection_conditions')
        .insert({
          inspection_id: inspectionData.id,
          furnishing_level: 'fullt_moblerad',
        })

      if (conditionsError) {
        await supabase.from('inspections').delete().eq('id', inspectionData.id)
        await supabase.from('properties').delete().eq('id', sourceProperty.id)
        throw conditionsError
      }

      const snapshotClient = supabase as unknown as ObSnapshotClient
      const { error: snapshotError } = await snapshotClient
        .from('ob_property_snapshot')
        .upsert(buildSnapshotPayload(inspectionData.id, sourceProperty), {
          onConflict: 'inspection_id',
        })

      if (snapshotError) {
        await supabase.from('inspections').delete().eq('id', inspectionData.id)
        await supabase.from('properties').delete().eq('id', sourceProperty.id)
        throw snapshotError
      }

      router.push(`/properties/${sourceProperty.id}/ob/${inspectionData.id}`)
    } catch (error) {
      console.error('Could not create inspection from scratch:', error)
      setCreateError('Kunde inte skapa ny tom besiktning.')
    } finally {
      setCreating(false)
    }
  }

  const handleConvertFromAssignment = async () => {
    if (!selectedAssignment || convertingAssignmentId) return

    try {
      setConvertError(null)
      setConvertingAssignmentId(selectedAssignment.id)
      const response = await fetch(`/api/ob/assignments/${selectedAssignment.id}/convert`, {
        method: 'POST',
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; propertyId?: string; inspectionId?: string }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Kunde inte starta besiktning från uppdragsbekräftelse.')
      }

      if (!payload?.propertyId || !payload?.inspectionId) {
        throw new Error('Konvertering saknar property/inspection-id.')
      }

      setSelectedAssignment(null)
      router.push(`/properties/${payload.propertyId}/ob/${payload.inspectionId}`)
    } catch (error) {
      setConvertError(error instanceof Error ? error.message : 'Kunde inte starta besiktning.')
    } finally {
      setConvertingAssignmentId(null)
    }
  }

  return cardShell(
    <div className="relative flex h-full flex-col rounded-lg border border-indigo-100 bg-white/70 p-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-600">
        Starta besiktning
      </h2>

      <section className="mt-2 rounded-md border border-indigo-100 bg-white/90 p-2">
        <button
          type="button"
          onClick={() => void handleCreateFromScratch()}
          disabled={creating}
          className="inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
        >
          {creating ? 'Skapar...' : 'Skapa ny tom besiktning'}
        </button>
      </section>

      <section className="mt-2 flex min-h-0 flex-1 flex-col rounded-md border border-indigo-100 bg-white/90 p-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
          Skapa från uppdragsbekräftelse
        </h3>
        {bookedAssignmentsLoading ? (
          <p className="mt-1 text-[10px] text-gray-500">Laddar bokade uppdragsbekräftelser...</p>
        ) : bookedAssignmentsError ? (
          <p className="mt-1 text-[10px] text-rose-700">Kunde inte hämta bokade uppdragsbekräftelser.</p>
        ) : bookedAssignments.length === 0 ? (
          <p className="mt-1 text-[10px] text-gray-500">Inga bokade uppdragsbekräftelser.</p>
        ) : (
          <ul className="mt-1 min-h-0 flex-1 space-y-1 overflow-auto pr-1">
            {bookedAssignments.map((assignment) => (
              <li key={assignment.id} className="rounded-md border border-gray-200 bg-white px-2 py-1">
                <button
                  type="button"
                  onClick={() => {
                    setCreateError(null)
                    setConvertError(null)
                    setSelectedAssignment(assignment)
                  }}
                  className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
                  title="Klicka för att starta besiktning från uppdragsbekräftelsen"
                >
                  <div className="truncate text-[10px] font-medium text-gray-900">
                    {assignment.address ?? 'Adress saknas'}
                  </div>
                  <div className="truncate text-[10px] text-gray-600">
                    {assignment.customer ?? 'Kund saknas'}
                  </div>
                  <div className="mt-0.5 text-[9px] text-indigo-700">
                    Besiktningsdag: {formatDate(assignment.preferredDate)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {createError ? <p className="mt-2 text-[11px] text-rose-700">{createError}</p> : null}
      {convertError ? <p className="mt-2 text-[11px] text-rose-700">{convertError}</p> : null}

      {selectedAssignment ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-indigo-200 bg-white p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-gray-900">Starta besiktning?</h3>
            <p className="mt-2 text-xs text-gray-700">
              Detta skapar en besiktning från uppdragsbekräftelsen och kan inte ångras.
            </p>
            <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
              <p className="truncate">
                <span className="font-medium text-gray-900">Adress:</span>{' '}
                {selectedAssignment.address ?? 'Adress saknas'}
              </p>
              <p className="truncate">
                <span className="font-medium text-gray-900">Kund:</span>{' '}
                {selectedAssignment.customer ?? 'Kund saknas'}
              </p>
              <p>
                <span className="font-medium text-gray-900">Besiktningsdag:</span>{' '}
                {formatDate(selectedAssignment.preferredDate)}
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedAssignment(null)}
                disabled={Boolean(convertingAssignmentId)}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => void handleConvertFromAssignment()}
                disabled={Boolean(convertingAssignmentId)}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                {convertingAssignmentId ? 'Startar...' : 'Starta besiktning'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>,
    'from-sky-500 to-indigo-500'
  )
}
function ProfileMiniCard({ profile }: { profile: ProfileCardInfo | null }) {
  const [avatarLoadError, setAvatarLoadError] = useState(false)
  const avatarSrc =
    resolvePublicMediaUrl(profile?.avatar_path) ??
    resolvePublicMediaUrl(profile?.logo_path) ??
    resolvePublicMediaUrl(profile?.logo_url)
  const name = profile?.full_name ?? 'Niklas Hedbj\u00f6rn'
  const sbrGroup = profile?.sbr_group ?? 'Medlem i SBR \u00d6verl\u00e5telsebesiktningsgrupp'
  const sbrStatus = profile?.sbr_status ?? 'Av SBR godk\u00e4nd besiktningsman'
  const membership = profile?.membership_number ?? '22015326'
  const certification = profile?.certification_number ?? null
  const certificationLines = formatCertificationDisplayLines(profile?.certification_items)
  const phone = profile?.phone ?? '0735678716'
  const email = profile?.email ?? 'niklas.h@bbsab.nu'
  const company = profile?.company_name ?? 'Besiktningsbolaget Stockholm'
  const orgNo = profile?.company_orgno ?? '559281-0823'

  let addressLine = 'Bryggv\u00e4gen 7, 117 71 Stockholm'
  if (profile?.company_address) {
    const postalCity = [profile.company_postal_code, profile.company_city].filter(Boolean).join(' ')
    addressLine = [profile.company_address, postalCity].filter(Boolean).join(', ')
  }

  return cardShell(
    <div className="relative flex h-full flex-col rounded-lg border border-indigo-100 bg-white/70 p-2.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-600">
        Visitkort
      </h2>

      <div className="mt-1.5 flex items-start gap-3">
        {avatarSrc && !avatarLoadError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarSrc}
            alt="Profilbild"
            className="h-16 w-16 shrink-0 rounded-full border object-cover"
            onError={() => setAvatarLoadError(true)}
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border bg-gray-100 text-[10px] text-gray-500">
            Bild
          </div>
        )}

        <div className="min-w-0 flex-1 text-[10px] leading-snug text-gray-700">
          <p className="truncate font-semibold text-gray-900">{name}</p>
          {certificationLines.length > 0 ? (
            certificationLines.map((line) => (
              <p key={line} className="truncate">
                {line}
              </p>
            ))
          ) : (
            <>
              <p className="truncate">{sbrGroup}</p>
              <p className="truncate">{sbrStatus}</p>
              <p className="mt-0.5 truncate">Medlem: {membership}</p>
              <p className="truncate">Cert: {certification ?? '\u2013'}</p>
            </>
          )}
          <p className="truncate">Tel: {phone}</p>
          <p className="truncate">E-post: {email}</p>
          <p className="mt-0.5 truncate">{company}</p>
          <p className="truncate">Org.nr: {orgNo}</p>
          <p className="truncate">{addressLine}</p>
        </div>
      </div>

      <div className="mt-auto pt-1.5">
        <Link
          href="/ob/settings"
          aria-label="Redigera visitkort"
          title="Redigera visitkort"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-indigo-200 bg-white text-indigo-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-800 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          <span className="sr-only">Redigera visitkort</span>
        </Link>
      </div>
    </div>,
    'from-indigo-500 to-violet-500'
  )
}

function AssignmentConfirmationsCard() {
  type QuickOrdererRole = 'seller' | 'buyer' | 'apartment' | ''

  const [email, setEmail] = useState('')
  const [ordererRole, setOrdererRole] = useState<QuickOrdererRole>('')
  const [preferredDate, setPreferredDate] = useState('')
  const [preferredTime, setPreferredTime] = useState('')
  const [priceAmount, setPriceAmount] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleQuickSend = async () => {
    const normalized = email.trim().toLowerCase()
    const normalizedPrice = priceAmount.trim()

    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setErrorMessage('Ange en giltig mejladress.')
      setSuccessMessage(null)
      return
    }

    if (!ordererRole) {
      setErrorMessage('V\u00e4lj uppdragsgivare (S\u00e4ljare, K\u00f6pare eller L\u00e4genhet).')
      setSuccessMessage(null)
      return
    }

    if (!normalizedPrice) {
      setErrorMessage('Pris är obligatoriskt innan utskick.')
      setSuccessMessage(null)
      return
    }

    const parsedPrice = Number(normalizedPrice.replace(',', '.'))
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setErrorMessage('Ange ett giltigt pris.')
      setSuccessMessage(null)
      return
    }

    try {
      setIsSending(true)
      setErrorMessage(null)
      setSuccessMessage(null)

      const response = await fetch('/api/ob/assignments/quick-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerEmail: normalized,
          ordererRole,
          preferredDate: preferredDate.trim(),
          preferredTime: preferredTime.trim(),
          priceAmount: normalizedPrice,
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        acceptUrl?: string
      }

      if (!response.ok) {
        if (payload.acceptUrl) {
          setErrorMessage(`Mejl kunde inte skickas. Länk skapades: ${payload.acceptUrl}`)
        } else {
          setErrorMessage(payload.error ?? 'Kunde inte skicka uppdragsbekräftelse.')
        }
        return
      }

      setEmail('')
      setPreferredDate('')
      setPreferredTime('')
      setPriceAmount('')
      setSuccessMessage('Uppdragsbekräftelse skickad.')
    } catch {
      setErrorMessage('Kunde inte skicka uppdragsbekräftelse.')
    } finally {
      setIsSending(false)
    }
  }

  return cardShell(
    <div className="relative flex h-full flex-col rounded-lg border border-indigo-100 bg-white/70 p-2.5">
      <Link
        href="/ob/assignments"
        className="inline-flex w-fit items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600 underline-offset-2 transition hover:text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
      >
        Uppdragsbekräftelser
        <ArrowRight size={11} aria-hidden="true" />
      </Link>

      <p className="mt-1.5 text-[10px] leading-relaxed text-gray-600">
        Skicka en ny uppdragsbekräftelse direkt.
      </p>

      <div className="mt-1.5 flex flex-wrap gap-1">
        {[
          { value: 'seller' as const, label: 'S\u00e4ljare' },
          { value: 'buyer' as const, label: 'K\u00f6pare' },
          { value: 'apartment' as const, label: 'L\u00e4genhet' },
        ].map((chip) => {
          const active = ordererRole === chip.value
          return (
            <button
              key={chip.value}
              type="button"
              aria-pressed={active}
              onClick={() => setOrdererRole(chip.value)}
              className={[
                'inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium leading-none transition-colors',
                active
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-indigo-400 hover:text-indigo-700',
              ].join(' ')}
            >
              {chip.label}
            </button>
          )
        })}
      </div>

      <div className="mt-1.5 space-y-1.5">
        <label className="relative block">
          <Mail
            size={12}
            className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="kund@epost.se"
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 pl-6 text-[11px] text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>

        <div className="grid grid-cols-2 gap-1.5">
          <label className="space-y-1">
            <span className="block text-[9px] font-medium uppercase tracking-wide text-gray-600">Datum</span>
            <input
              type="date"
              value={preferredDate}
              onChange={(event) => setPreferredDate(event.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>

          <label className="space-y-1">
            <span className="block text-[9px] font-medium uppercase tracking-wide text-gray-600">Tid</span>
            <input
              type="time"
              value={preferredTime}
              onChange={(event) => setPreferredTime(event.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>
        </div>

        <label className="space-y-1">
          <span className="block text-[9px] font-medium uppercase tracking-wide text-gray-600">Pris (SEK)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={priceAmount}
            onChange={(event) => setPriceAmount(event.target.value)}
            placeholder="0"
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>

        <button
          type="button"
          onClick={() => void handleQuickSend()}
          disabled={isSending}
          className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
        >
          <Send size={12} />
          {isSending ? 'Skickar...' : 'Skicka uppdragsbekräftelse'}
        </button>
      </div>

      {errorMessage ? (
        <p className="mt-1.5 rounded-md bg-rose-100 px-2 py-1 text-[9px] text-rose-700">{errorMessage}</p>
      ) : null}
      {successMessage ? (
        <p className="mt-1.5 rounded-md bg-emerald-100 px-2 py-1 text-[9px] text-emerald-700">
          {successMessage}
        </p>
      ) : null}

      <div className="mt-auto pt-1.5" />
    </div>,
    'from-indigo-500 to-cyan-500'
  )
}
export default function OverlatelsebesiktningPage() {
  const [inspections, setInspections] = useState<InspectionListItem[]>([])
  const [inspectionsLoading, setInspectionsLoading] = useState(true)
  const [inspectionsError, setInspectionsError] = useState<string | null>(null)
  const [bookedAssignments, setBookedAssignments] = useState<BookedAssignmentListItem[]>([])
  const [bookedAssignmentsLoading, setBookedAssignmentsLoading] = useState(true)
  const [bookedAssignmentsError, setBookedAssignmentsError] = useState<string | null>(null)
  const [profileInfo, setProfileInfo] = useState<ProfileCardInfo | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadData = async () => {
      try {
        setInspectionsLoading(true)
        setInspectionsError(null)
        setBookedAssignmentsLoading(true)
        setBookedAssignmentsError(null)

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError) throw userError

        if (!user) {
          if (!cancelled) {
            setInspections([])
            setBookedAssignments([])
            setInspectionsLoading(false)
            setBookedAssignmentsLoading(false)
          }
          return
        }

        const [
          { data: propertyData, error: propertyError },
          { data: profileData, error: profileError },
          { data: bookedAssignmentsData, error: bookedAssignmentsLoadError },
        ] =
          await Promise.all([
            supabase
              .from('properties')
              .select('id,address,client_name')
              .eq('owner', user.id),
            supabase
              .from('profiles')
              .select(
                'full_name,phone,email,company_name,company_orgno,company_address,company_postal_code,company_city,avatar_path,logo_path,logo_url'
              )
              .eq('id', user.id)
              .maybeSingle(),
            supabase
              .from('assignments')
              .select(
                'id,status,customer_name,customer_email,property_address,preliminary_address,preferred_date,booked_at'
              )
              .eq('responsible_profile_id', user.id)
              .eq('status', 'booked')
              .is('inspection_id', null)
              .is('archived_at', null)
              .order('booked_at', { ascending: false, nullsFirst: false })
              .order('accepted_at', { ascending: false, nullsFirst: false })
              .order('updated_at', { ascending: false })
              .limit(8),
          ])

        if (!profileError && profileData && !cancelled) {
          const rawProfile = profileData as Omit<
            ProfileCardInfo,
            | 'sbr_group'
            | 'sbr_status'
            | 'membership_number'
            | 'certification_number'
            | 'certification_items'
          >
          const { summary } = await resolveInspectorCertificationSummary(supabase, {
            profileId: user.id,
          })

          if (!cancelled) {
            setProfileInfo({
              ...rawProfile,
              sbr_group: summary.sbr_group,
              sbr_status: summary.sbr_status,
              membership_number: summary.membership_number,
              certification_number: summary.certification_number,
              certification_items: summary.all_selected_items,
            })
          }
        }

        if (bookedAssignmentsLoadError) {
          console.error('Could not load booked assignments for create card:', bookedAssignmentsLoadError)
          if (!cancelled) setBookedAssignmentsError('Kunde inte hämta bokade uppdragsbekräftelser.')
        } else if (!cancelled) {
          const mappedBookedAssignments = ((bookedAssignmentsData ?? []) as BookedAssignmentRow[])
            .filter((assignment) => (assignment.status ?? '').trim().toLowerCase() === 'booked')
            .map((assignment) => ({
              id: assignment.id,
              customer: assignment.customer_name ?? assignment.customer_email ?? null,
              address: assignment.property_address ?? assignment.preliminary_address ?? null,
              preferredDate: assignment.preferred_date ?? null,
              bookedAt: assignment.booked_at ?? null,
            }))
          setBookedAssignments(mappedBookedAssignments)
        }

        if (propertyError) throw propertyError

        const properties = (propertyData ?? []) as PropertyRow[]
        let mapped: InspectionListItem[] = []
        if (properties.length > 0) {
          const propertyMap = new Map(properties.map((property) => [property.id, property]))
          const propertyIds = properties.map((property) => property.id)

          const { data: inspectionData, error: inspectionError } = await supabase
            .from('inspections')
            .select('id,property_id,status,client_name')
            .in('property_id', propertyIds)
            .order('date', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false })
            .limit(24)

          if (inspectionError) throw inspectionError

          const rows = (inspectionData ?? []) as InspectionRow[]
          const inspectionIds = rows.map((inspection) => inspection.id)
          const snapshotClient = supabase as unknown as ObSnapshotClient
          const { data: snapshotData, error: snapshotError } =
            inspectionIds.length > 0
              ? await snapshotClient
                  .from('ob_property_snapshot')
                  .select('inspection_id,address,client_name')
                  .in('inspection_id', inspectionIds)
              : { data: [], error: null }

          if (snapshotError) {
            console.error('Could not load OB snapshots for card list:', snapshotError)
          }

          const snapshotMap = new Map(
            ((snapshotData ?? []) as SnapshotRow[]).map((snapshot) => [snapshot.inspection_id, snapshot])
          )

          const rawMapped = rows.map((inspection) => {
            const property = propertyMap.get(inspection.property_id)
            const snapshot = snapshotMap.get(inspection.id)
            return {
              id: inspection.id,
              address: snapshot?.address ?? property?.address ?? null,
              customer: inspection.client_name ?? snapshot?.client_name ?? property?.client_name ?? null,
              status: inspection.status,
              href: `/properties/${inspection.property_id}/ob/${inspection.id}`,
            }
          })

          const ongoingInspections = rawMapped.filter(
            (inspection) => getStatusBucket(inspection.status) === 'ongoing'
          )
          const completedInspections = rawMapped.filter(
            (inspection) => getStatusBucket(inspection.status) === 'completed'
          )

          mapped = [...ongoingInspections, ...completedInspections]
        }

        if (!cancelled) setInspections(mapped)
      } catch (error) {
        console.error('Could not load module data:', error)
        if (!cancelled) setInspectionsError('Kunde inte h\u00e4mta besiktningar.')
      } finally {
        if (!cancelled) {
          setInspectionsLoading(false)
          setBookedAssignmentsLoading(false)
        }
      }
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Protected>
      <main className="relative min-h-full overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(135deg, #f7fbff 0%, #ffffff 52%, #f3f9ff 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-transparent" />

        <div className="relative mx-auto w-full max-w-7xl p-4 md:p-6">
          <header className="mx-auto w-full max-w-7xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard-v1"
                aria-label="Tillbaka"
                title="Tillbaka"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                <ArrowLeft size={16} strokeWidth={2} />
              </Link>
              <h1 className="text-2xl font-semibold text-slate-950">{'\u00d6verl\u00e5telsebesiktning'}</h1>
            </div>
          </header>

          <section className="mx-auto mt-4 grid w-full max-w-7xl grid-cols-1 gap-5 place-items-center sm:grid-cols-2 sm:place-items-center lg:grid-cols-4">
            {MODULES.map((module) => (
              <div key={module.id} className="w-full max-w-[260px] sm:max-w-[300px]">
                {module.id === 'list' ? (
                  <InspectionsListCard
                    inspections={inspections}
                    inspectionsLoading={inspectionsLoading}
                    inspectionsError={inspectionsError}
                  />
                ) : module.id === 'create' ? (
                  <CreateInspectionCard
                    bookedAssignments={bookedAssignments}
                    bookedAssignmentsLoading={bookedAssignmentsLoading}
                    bookedAssignmentsError={bookedAssignmentsError}
                  />
                ) : module.id === 'assignments' ? (
                  <AssignmentConfirmationsCard />
                ) : (
                  <ProfileMiniCard profile={profileInfo} />
                )}
              </div>
            ))}
          </section>
        </div>
      </main>
    </Protected>
  )
}



