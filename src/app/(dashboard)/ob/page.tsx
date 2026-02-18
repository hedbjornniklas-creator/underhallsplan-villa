'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'

type DashboardCard = {
  id: 'list' | 'create' | 'profile'
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

type InspectionRow = {
  id: string
  property_id: string
  status: string | null
  client_name: string | null
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

const MODULES: DashboardCard[] = [{ id: 'list' }, { id: 'create' }, { id: 'profile' }]

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
  switch (status) {
    case 'draft':
      return 'Utkast'
    case 'completed':
      return 'Klar'
    case 'archived':
      return 'Arkiverad'
    default:
      return status ?? 'Okänd'
  }
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
        className="w-fit text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-600 underline-offset-2 transition hover:text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
      >
        Mina besiktningar
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

function CreateInspectionCard() {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const handleCreateWithoutProperty = async () => {
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

      const propertyId = propertyData.id as string

      const { data: inspectionData, error: inspectionError } = await supabase
        .from('inspections')
        .insert({
          property_id: propertyId,
          type: 'OB',
          status: 'draft',
        })
        .select('id')
        .single()

      if (inspectionError || !inspectionData) {
        throw inspectionError ?? new Error('Kunde inte skapa besiktning.')
      }

      const snapshotClient = supabase as unknown as ObSnapshotClient
      const { error: snapshotError } = await snapshotClient
        .from('ob_property_snapshot')
        .upsert(
          {
            inspection_id: inspectionData.id,
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
          },
          { onConflict: 'inspection_id' }
        )

      if (snapshotError) {
        await supabase.from('inspections').delete().eq('id', inspectionData.id)
        await supabase.from('properties').delete().eq('id', propertyData.id)
        throw snapshotError
      }

      router.push(`/properties/${propertyId}/ob/${inspectionData.id}`)
    } catch (error) {
      console.error('Could not create inspection from /ob:', error)
      setCreateError('Kunde inte skapa ny besiktning. Försök igen.')
    } finally {
      setCreating(false)
    }
  }

  return cardShell(
    <div className="relative flex h-full flex-col rounded-lg border border-indigo-100 bg-white/70 p-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-600">
        Skapa ny besiktning
      </h2>

      <section className="mt-2 rounded-md border border-indigo-100 bg-white/90 p-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-700">
          Utan befintlig fastighet
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
          Skapar ett utkast och öppnar en ny besiktning direkt.
        </p>
        <button
          type="button"
          onClick={() => void handleCreateWithoutProperty()}
          disabled={creating}
          className="mt-2 inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
        >
          {creating ? 'Skapar...' : '+ Skapa besiktning'}
        </button>
      </section>

      <section className="mt-2 rounded-md border border-dashed border-gray-300 bg-white/70 p-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-600">
          Från befintlig fastighet
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          Nästa steg: välj en befintlig fastighet och starta besiktning därifrån.
        </p>
      </section>

      {createError ? <p className="mt-2 text-[11px] text-rose-700">{createError}</p> : null}
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
  const name = profile?.full_name ?? 'Niklas Hedbjörn'
  const sbrGroup = profile?.sbr_group ?? 'Medlem i SBR Överlåtelsebesiktningsgrupp'
  const sbrStatus = profile?.sbr_status ?? 'Av SBR godkänd besiktningsman'
  const membership = profile?.membership_number ?? '22015326'
  const phone = profile?.phone ?? '0735678716'
  const email = profile?.email ?? 'niklas.h@bbsab.nu'
  const company = profile?.company_name ?? 'Besiktningsbolaget Stockholm'
  const orgNo = profile?.company_orgno ?? '559281-0823'

  let addressLine = 'Bryggvägen 7, 117 71 Stockholm'
  if (profile?.company_address) {
    const postalCity = [profile.company_postal_code, profile.company_city].filter(Boolean).join(' ')
    addressLine = [profile.company_address, postalCity].filter(Boolean).join(', ')
  }

  return cardShell(
    <div className="relative flex h-full flex-col rounded-lg border border-indigo-100 bg-white/70 p-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-600">
        Min information
      </div>

      <div className="flex items-start gap-2 overflow-hidden">
        {avatarSrc && !avatarLoadError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarSrc}
            alt="Profilbild"
            className="h-11 w-11 shrink-0 rounded-full border object-cover"
            onError={() => setAvatarLoadError(true)}
          />
        ) : (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border bg-gray-100 text-[10px] text-gray-500">
            Bild
          </div>
        )}

        <div className="min-w-0 text-[10px] leading-snug text-gray-700">
          <p className="font-semibold text-gray-900">Visitkort (för utlåtanden)</p>
          <p className="mt-1 font-semibold text-gray-900">{name}</p>
          <p>{sbrGroup}</p>
          <p>{sbrStatus}</p>
          <p className="mt-1">Medlemsnummer: {membership}</p>
          <p>Telefon: {phone}</p>
          <p>E-post: {email}</p>
          <p className="mt-1">{company}</p>
          <p>Org.nr: {orgNo}</p>
          <p>{addressLine}</p>
        </div>
      </div>

      <div className="mt-auto pt-2">
        <Link
          href="/settings"
          className="inline-flex items-center text-[11px] font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-800"
        >
          Öppna settings
        </Link>
      </div>
    </div>,
    'from-indigo-500 to-violet-500'
  )
}

export default function OverlatelsebesiktningPage() {
  const [inspections, setInspections] = useState<InspectionListItem[]>([])
  const [inspectionsLoading, setInspectionsLoading] = useState(true)
  const [inspectionsError, setInspectionsError] = useState<string | null>(null)
  const [profileInfo, setProfileInfo] = useState<ProfileCardInfo | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadData = async () => {
      try {
        setInspectionsLoading(true)
        setInspectionsError(null)

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError) throw userError

        if (!user) {
          if (!cancelled) {
            setInspections([])
            setInspectionsLoading(false)
          }
          return
        }

        const [{ data: propertyData, error: propertyError }, { data: profileData, error: profileError }] =
          await Promise.all([
            supabase
              .from('properties')
              .select('id,address,client_name')
              .eq('owner', user.id),
            supabase
              .from('profiles')
              .select(
                'full_name,sbr_group,sbr_status,membership_number,phone,email,company_name,company_orgno,company_address,company_postal_code,company_city,avatar_path,logo_path,logo_url'
              )
              .eq('id', user.id)
              .maybeSingle(),
          ])

        if (!profileError && profileData && !cancelled) {
          setProfileInfo(profileData as ProfileCardInfo)
        }

        if (propertyError) throw propertyError

        const properties = (propertyData ?? []) as PropertyRow[]

        if (!properties.length) {
          if (!cancelled) {
            setInspections([])
            setInspectionsLoading(false)
          }
          return
        }

        const propertyMap = new Map(properties.map((property) => [property.id, property]))
        const propertyIds = properties.map((property) => property.id)

        const { data: inspectionData, error: inspectionError } = await supabase
          .from('inspections')
          .select('id,property_id,status,client_name')
          .in('property_id', propertyIds)
          .order('date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(8)

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

        const mapped: InspectionListItem[] = rows.map((inspection) => {
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

        if (!cancelled) setInspections(mapped)
      } catch (error) {
        console.error('Could not load module data:', error)
        if (!cancelled) setInspectionsError('Kunde inte hämta besiktningar.')
      } finally {
        if (!cancelled) setInspectionsLoading(false)
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
              'radial-gradient(100% 70% at 50% 0%, rgba(219,234,254,0.5) 0%, rgba(219,234,254,0) 60%), linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 42%, #60a5fa 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-white/10 backdrop-blur-[1px]" />

        <div className="relative mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-12">
          <header className="mx-auto max-w-4xl text-center">
            <h1 className="text-xs font-semibold uppercase tracking-[0.26em] text-white/85">
              Överlåtelsebesiktning
            </h1>
          </header>

          <section className="mx-auto mt-10 grid w-full max-w-7xl grid-cols-1 gap-5 place-items-center sm:grid-cols-2 sm:place-items-center lg:grid-cols-4">
            {MODULES.map((module) => (
              <div key={module.id} className="w-full max-w-[260px] sm:max-w-[300px]">
                {module.id === 'list' ? (
                  <InspectionsListCard
                    inspections={inspections}
                    inspectionsLoading={inspectionsLoading}
                    inspectionsError={inspectionsError}
                  />
                ) : module.id === 'create' ? (
                  <CreateInspectionCard />
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

