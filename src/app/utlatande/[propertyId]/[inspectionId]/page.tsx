import AutoPrintTrigger from '../../_components/AutoPrintTrigger'
import ReportToolbar from '../../_components/ReportToolbar'
import SessionBridge from '../../_components/SessionBridge'
import ClientSessionDebug from '../../_components/ClientSessionDebug'
import ReportRenderer from '@/components/report/ReportRenderer'
import { REPORT_SPEC } from '@/lib/report/reportSpec'
import {
  buildBuildingDataMap,
  buildBuildingTypeParts,
  renderBuildingDataTextFromTemplate,
} from '@/lib/report/buildingData'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { parseScopeCodes, renderScopeText } from '@/lib/report/scopeText'

export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: {
  params:
    | { propertyId: string; inspectionId: string }
    | Promise<{ propertyId: string; inspectionId: string }>
  searchParams?:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedParams = await Promise.resolve(params)
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {})
  const isEmbed = resolvedSearchParams?.embed === '1'
  const isAutoPrint = resolvedSearchParams?.autoprint === '1'
  const supabase = createSupabaseServerClient()

  const fallback = '--'
  const valueOrFallback = (value: string | null | undefined, alt = fallback) => {
    if (value === null || value === undefined) return alt
    const trimmed = String(value).trim()
    return trimmed.length > 0 ? trimmed : alt
  }

  const { data: property, error: propertyError } = await supabase
    .from('properties')
    .select('id, address, postal_code, city, municipality, cadastral_id, owner_name, cover_path')
    .eq('id', resolvedParams.propertyId)
    .maybeSingle()

  if (propertyError) {
    console.error('Kunde inte hämta fastighet', propertyError)
  }

  const { data: inspection, error: inspectionError } = await supabase
    .from('inspections')
    .select(
      'id, property_id, date, inspection_time, assignment_number, client_name, client_contact, defect_disclosures, scope, attendees, attendees_other, assignment_confirmation_delivered_date'
    )
    .eq('id', resolvedParams.inspectionId)
    .maybeSingle()

  if (inspectionError) {
    console.error('Kunde inte hämta besiktning', inspectionError)
  }

  if (inspection && inspection.property_id !== resolvedParams.propertyId) {
    console.error('Besiktning tillhör inte fastighet', {
      inspectionPropertyId: inspection.property_id,
      propertyId: resolvedParams.propertyId,
    })
  }

  const { data: authData } = await supabase.auth.getUser()
  const userId = authData.user?.id ?? null

  const { data: profile, error: profileError } = userId
    ? await supabase
        .from('profiles')
        .select(
          'full_name, sbr_group, sbr_status, membership_number, phone, email, company_name, company_orgno, company_address, company_postal_code, company_city, logo_path'
        )
        .eq('id', userId)
        .maybeSingle()
    : { data: null, error: null }

  if (profileError) {
    console.error('Kunde inte hämta profil', profileError)
  }

  const { data: documentRows, error: documentError } = await supabase
    .from('inspection_documents')
    .select('title, status, note')
    .eq('inspection_id', resolvedParams.inspectionId)

  if (documentError) {
    console.error('Kunde inte hämta handlingar', documentError)
  }

  const providedDocuments =
    documentRows
      ?.filter((doc) => doc.status === 'present')
      .map((doc) => {
        const title = valueOrFallback(doc.title, 'Handling')
        const note = (doc.note ?? '').trim()
        return note ? `${title}: ${note}` : title
      })
      .filter(Boolean) ?? []

  const { data: disclosureRow, error: disclosureError } = await supabase
    .from('inspection_disclosures')
    .select('note')
    .eq('inspection_id', resolvedParams.inspectionId)
    .is('disclosure_item_id', null)
    .maybeSingle()

  if (disclosureError) {
    console.error('Kunde inte hämta upplysningar', disclosureError)
  }

  const { data: inspectionConditions, error: conditionsError } = await supabase
    .from('inspection_conditions')
    .select(
      'furnishing_level, weather, weather_note, building_type, building_form, building_year, foundation, frame, joists, facade, windows, roof, heating, ventilation, water, sewer'
    )
    .eq('inspection_id', resolvedParams.inspectionId)
    .maybeSingle()

  if (conditionsError) {
    console.error('Kunde inte hämta förutsättningar', conditionsError)
  }

  
  const overviewItemKeys = [
    'weather',
    'building_type',
    'building_form',
    'building_year',
    'foundation',
    'structure',
    'frame',
    'joist',
    'joists',
    'facade',
    'windows',
    'roof',
    'heating',
    'ventilation',
    'water',
    'sewage',
    'sewer',
  ]

  const { data: overviewSelections, error: overviewSelectionsError } = await supabase
    .from('inspection_overview_selections')
    .select('overview_item_id, floor_key, set_index, values, note')
    .eq('inspection_id', resolvedParams.inspectionId)

  if (overviewSelectionsError) {
    console.error('Kunde inte hamta byggnadsdata-val', overviewSelectionsError)
  }

  const { data: overviewItems, error: overviewItemsError } = await supabase
    .from('settings_overview_items')
    .select('id, key, label, sort_order')
    .in('key', overviewItemKeys)
    .eq('is_active', true)

  if (overviewItemsError) {
    console.error('Kunde inte hamta byggnadsdata-installningar', overviewItemsError)
  }

  const overviewItemIds = (overviewItems ?? []).map((item) => item.id)
  const { data: overviewGroups, error: overviewGroupsError } = overviewItemIds.length
    ? await supabase
        .from('settings_overview_groups')
        .select('id, overview_item_id, key, label, sort_order')
        .in('overview_item_id', overviewItemIds)
        .eq('is_active', true)
    : { data: [], error: null }

  if (overviewGroupsError) {
    console.error('Kunde inte hamta byggnadsdata-grupper', overviewGroupsError)
  }

  const overviewGroupIds = (overviewGroups ?? []).map((group) => group.id)
  const { data: overviewOptions, error: overviewOptionsError } = overviewGroupIds.length
    ? await supabase
        .from('settings_overview_options')
        .select('group_id, value, label')
        .in('group_id', overviewGroupIds)
        .eq('is_active', true)
    : { data: [], error: null }

  if (overviewOptionsError) {
    console.error('Kunde inte hamta byggnadsdata-alternativ', overviewOptionsError)
  }

  const propertyFaultsText = valueOrFallback(
    inspection?.defect_disclosures ?? null,
    ''
  )

  const addressParts = [
    property?.address ?? null,
    property?.postal_code ?? null,
    property?.city ?? null,
  ].filter((part) => part && String(part).trim().length > 0)

  const resolveCoverImage = (path: string | null | undefined) => {
    if (!path) return null
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) {
      return path
    }
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!base) return null
    return `${base}/storage/v1/object/public/property-media/${path}`
  }

  const coverImageUrl = resolveCoverImage(property?.cover_path ?? null)

  let fullAddress = fallback
  if (addressParts.length > 0) {
    const [street, ...rest] = addressParts
    const restLine = rest.join(' ')
    fullAddress = restLine ? `${street}, ${restLine}` : String(street)
  }

  const inspectionDate = valueOrFallback(inspection?.date ?? null)
  const inspectionTime = valueOrFallback(inspection?.inspection_time ?? null, '')
  const inspectionDateTime = inspectionTime
    ? `${inspectionDate} klockan ${inspectionTime}`
    : inspectionDate
  const scopeCodes = parseScopeCodes(inspection?.scope ?? '')
  const scopeText = renderScopeText(scopeCodes)
  const assignmentDeliveredDate = valueOrFallback(
    inspection?.assignment_confirmation_delivered_date ?? null,
    '--'
  )
  const assignmentConfirmationText = `En uppdragsbekräftelse med bifogad villkorsbilaga överlämnades till uppdragsgivaren den ${assignmentDeliveredDate}.`

  const parseSemicolonList = (raw: string | null | undefined) => {
    if (!raw) return []
    return raw
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
  }

  const attendeesList = parseSemicolonList(inspection?.attendees ?? null)
  const attendeesOtherList = (inspection?.attendees_other ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const attendeesLines = [...attendeesList, ...attendeesOtherList]
  const attendeesText = attendeesLines.length > 0 ? attendeesLines.join('\n') : '-'

  const buildingDataMap = buildBuildingDataMap({
    selections: overviewSelections ?? [],
    items: overviewItems ?? [],
    groups: overviewGroups ?? [],
    options: overviewOptions ?? [],
    conditions: inspectionConditions ?? null,
  })

  const buildingTypeParts = buildBuildingTypeParts({
    selections: overviewSelections ?? [],
    items: overviewItems ?? [],
    groups: overviewGroups ?? [],
    options: overviewOptions ?? [],
    conditions: inspectionConditions ?? null,
  })
  const buildingDataText = renderBuildingDataTextFromTemplate(
    buildingDataMap,
    undefined,
    buildingTypeParts
  )

  const mockData = {
    mock: {
      company: {
        logo_url: profile?.logo_path ?? null,
      },
      profile: {
        full_name: valueOrFallback(profile?.full_name ?? null),
        sbr_group: valueOrFallback(profile?.sbr_group ?? null),
        sbr_status: valueOrFallback(profile?.sbr_status ?? null),
        membership_number: valueOrFallback(profile?.membership_number ?? null),
        phone: valueOrFallback(profile?.phone ?? null),
        email: valueOrFallback(profile?.email ?? null),
        company_name: valueOrFallback(profile?.company_name ?? null),
        company_orgno: valueOrFallback(profile?.company_orgno ?? null),
        company_address: valueOrFallback(profile?.company_address ?? null),
        company_postal_code: valueOrFallback(profile?.company_postal_code ?? null),
        company_city: valueOrFallback(profile?.company_city ?? null),
      },
      properties: {
        cadastral_id: valueOrFallback(property?.cadastral_id ?? null),
        address: valueOrFallback(fullAddress, fallback),
        city: valueOrFallback(property?.city ?? null),
        municipality: valueOrFallback(property?.municipality ?? null),
        owner_name: valueOrFallback(property?.owner_name ?? null),
        cover_path: coverImageUrl,
      },
      documents: {
        provided: providedDocuments,
      },
      disclosures: {
        acquisition_text:
          disclosureRow?.note && disclosureRow.note.trim().length > 0
            ? disclosureRow.note
            : 'Säljaren förvärvade fastigheten --.',
        renovations: [],
        property_faults: propertyFaultsText ? propertyFaultsText : '',
      },
      inspections: {
        date: inspectionDate,
        date_time: inspectionDateTime,
        inspector_name: valueOrFallback(inspection?.client_contact ?? null),
        assignment_number: valueOrFallback(inspection?.assignment_number ?? null),
        client_name: valueOrFallback(inspection?.client_name ?? null),
        scope_text: scopeText,
        attendees_text: attendeesText,
        assignment_confirmation_text: assignmentConfirmationText,
      },
      inspection_conditions: {
        furnishing_level: valueOrFallback(
          inspectionConditions?.furnishing_level ?? null,
          ''
        ),
      },
      buildingData: {
        text: buildingDataText,
      },
    },
  }

  let content = null
  let errorMessage = ''

  try {
    content = <ReportRenderer spec={REPORT_SPEC} mockData={mockData} />
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Okänt fel vid rendering.'
  }

  const pickErrorDetails = (err: any) =>
    err
      ? {
          message: err.message ?? null,
          code: err.code ?? null,
          details: err.details ?? null,
          hint: err.hint ?? null,
          status: err.status ?? null,
        }
      : null

  const cookieStore = (await Promise.resolve(cookies() as any)) as {
    getAll?: () => { name: string }[]
  }
  const cookieEntries = typeof cookieStore.getAll === 'function' ? cookieStore.getAll() : []

  const diagnostics = {
    propertyId: resolvedParams.propertyId ?? null,
    inspectionId: resolvedParams.inspectionId ?? null,
    hasUser: Boolean(authData.user),
    userId: authData.user?.id ?? null,
    cookieNames: cookieEntries.map((cookie) => cookie.name),
    supabaseCookieNames: cookieEntries
      .map((cookie) => cookie.name)
      .filter((name) => name.startsWith('sb-') || name.includes('supabase')),
    propertyFound: Boolean(property),
    inspectionFound: Boolean(inspection),
    propertyMatchesInspection: inspection
      ? inspection.property_id === resolvedParams.propertyId
      : null,
    propertyError: pickErrorDetails(propertyError),
    inspectionError: pickErrorDetails(inspectionError),
    profileError: pickErrorDetails(profileError),
    documentError: pickErrorDetails(documentError),
    disclosureError: pickErrorDetails(disclosureError),
    conditionsError: pickErrorDetails(conditionsError),
    overviewSelectionsError: pickErrorDetails(overviewSelectionsError),
    overviewItemsError: pickErrorDetails(overviewItemsError),
    overviewGroupsError: pickErrorDetails(overviewGroupsError),
    overviewOptionsError: pickErrorDetails(overviewOptionsError),
    overviewSelectionCount: overviewSelections?.length ?? null,
    overviewItemCount: overviewItems?.length ?? null,
    overviewGroupCount: overviewGroups?.length ?? null,
    overviewOptionCount: overviewOptions?.length ?? null,
    documentCount: documentRows?.length ?? null,
    providedDocumentCount: providedDocuments.length,
    disclosureNoteLength: disclosureRow?.note?.length ?? null,
  }

  const showDiagnostics =
    !property ||
    !inspection ||
    !authData.user ||
    Boolean(propertyError) ||
    Boolean(inspectionError) ||
    Boolean(profileError) ||
    Boolean(documentError) ||
    Boolean(disclosureError)
  return (
    <div className="min-h-screen bg-neutral-100 print:bg-white">
      {!authData.user && <SessionBridge />}
      {isAutoPrint && <AutoPrintTrigger />}
      {!isEmbed && (
        <ReportToolbar
          backHref={`/properties/${resolvedParams.propertyId}/ob/${resolvedParams.inspectionId}`}
        />
      )}
      {showDiagnostics && (
        <div className="mx-auto w-full max-w-3xl px-4 pt-4 print:hidden">
          <details className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <summary className="cursor-pointer font-semibold">
              Teknisk felsökning (utlåtande)
            </summary>
            <pre className="mt-2 whitespace-pre-wrap">
              {JSON.stringify(diagnostics, null, 2)}
            </pre>
            <ClientSessionDebug />
          </details>
        </div>
      )}
      {errorMessage ? (
        <div className="mx-auto w-full max-w-3xl rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : (
        content
      )}
    </div>
  )
}






