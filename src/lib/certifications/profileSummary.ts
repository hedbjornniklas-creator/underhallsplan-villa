export const CERT_KEY_SBR_APPROVED = 'av_sbr_godkand_besiktningsman'
export const CERT_KEY_KIWA = 'kiwa_certifierad_besiktningsman_sbr'
export const CERT_KEY_RISE = 'rise_certifierad_besiktningsman_sbr'
export const CERT_KEY_SBR_MEMBERSHIP = 'medlem_i_sbr_overlatelsebesiktningsgrupp'
export const CERT_KEY_SBR_MEMBER_NUMBER = 'sbr_medlemsnummer'
export const CERT_KEY_SBR_AREA_DIPLOMA = 'av_sbr_diplomerad_areamatare'

const STATUS_PRIORITY_KEYS = [CERT_KEY_SBR_APPROVED, CERT_KEY_KIWA, CERT_KEY_RISE]

export type CertificationCatalogSummaryRow = {
  id: string
  key: string
  name: string
  category: 'certification' | 'membership'
  sort_order: number | null
}

export type ProfileCertificationSummaryRow = {
  certification_id: string
  is_enabled: boolean
  number_value: string | null
  valid_to: string | null
}

export type LegacyInspectorCertificationFields = {
  sbr_group?: string | null
  sbr_status?: string | null
  membership_number?: string | null
  certification_number?: string | null
  is_sbr_diplomerad_areamatning?: boolean | null
}

type EnabledCertificationRecord = {
  key: string
  name: string
  category: 'certification' | 'membership'
  sort_order: number | null
  number_value: string | null
}

export type InspectorCertificationSummary = {
  sbr_group: string | null
  sbr_status: string | null
  membership_number: string | null
  certification_number: string | null
  is_sbr_diplomerad_areamatning: boolean
  status_key: string | null
  status_name: string | null
  membership_key: string | null
  membership_name: string | null
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sortByOrderAndName(a: EnabledCertificationRecord, b: EnabledCertificationRecord) {
  const orderA = typeof a.sort_order === 'number' ? a.sort_order : 1000
  const orderB = typeof b.sort_order === 'number' ? b.sort_order : 1000
  if (orderA !== orderB) return orderA - orderB
  return a.name.localeCompare(b.name, 'sv')
}

function pickPrimaryStatus(records: EnabledCertificationRecord[]) {
  for (const key of STATUS_PRIORITY_KEYS) {
    const match = records.find((row) => row.key === key)
    if (match) return match
  }

  const withoutArea = records.filter((row) => row.key !== CERT_KEY_SBR_AREA_DIPLOMA)
  const sorted = [...(withoutArea.length > 0 ? withoutArea : records)].sort(sortByOrderAndName)
  return sorted[0] ?? null
}

function pickPrimaryMembership(records: EnabledCertificationRecord[]) {
  const sbrMembership = records.find((row) => row.key === CERT_KEY_SBR_MEMBERSHIP)
  if (sbrMembership) return sbrMembership

  const withoutNumberOnly = records.filter((row) => row.key !== CERT_KEY_SBR_MEMBER_NUMBER)
  const sorted = [...(withoutNumberOnly.length > 0 ? withoutNumberOnly : records)].sort(
    sortByOrderAndName
  )
  return sorted[0] ?? null
}

export function buildInspectorCertificationSummary(input: {
  catalog: CertificationCatalogSummaryRow[]
  selections: ProfileCertificationSummaryRow[]
  legacy?: LegacyInspectorCertificationFields | null
}): InspectorCertificationSummary {
  const catalogById = new Map(input.catalog.map((row) => [row.id, row]))
  const enabledRecords: EnabledCertificationRecord[] = input.selections
    .filter((row) => row.is_enabled)
    .map((row) => {
      const catalogRow = catalogById.get(row.certification_id)
      if (!catalogRow) return null
      return {
        key: catalogRow.key,
        name: catalogRow.name,
        category: catalogRow.category,
        sort_order: catalogRow.sort_order,
        number_value: normalizeText(row.number_value),
      } satisfies EnabledCertificationRecord
    })
    .filter((row): row is EnabledCertificationRecord => row !== null)

  const activeCertifications = enabledRecords.filter((row) => row.category === 'certification')
  const activeMemberships = enabledRecords.filter((row) => row.category === 'membership')

  const primaryStatus = pickPrimaryStatus(activeCertifications)
  const primaryMembership = pickPrimaryMembership(activeMemberships)
  const membershipNumberRow = enabledRecords.find((row) => row.key === CERT_KEY_SBR_MEMBER_NUMBER)

  const membershipNumber =
    membershipNumberRow?.number_value ??
    primaryMembership?.number_value ??
    activeMemberships.find((row) => row.number_value)?.number_value ??
    normalizeText(input.legacy?.membership_number)

  const certificationNumber =
    primaryStatus?.number_value ??
    activeCertifications.find((row) => row.number_value)?.number_value ??
    normalizeText(input.legacy?.certification_number)

  const hasAreaDiploma = enabledRecords.some((row) => row.key === CERT_KEY_SBR_AREA_DIPLOMA)

  return {
    sbr_group: primaryMembership?.name ?? normalizeText(input.legacy?.sbr_group),
    sbr_status: primaryStatus?.name ?? normalizeText(input.legacy?.sbr_status),
    membership_number: membershipNumber,
    certification_number: certificationNumber,
    is_sbr_diplomerad_areamatning:
      hasAreaDiploma || input.legacy?.is_sbr_diplomerad_areamatning === true,
    status_key: primaryStatus?.key ?? null,
    status_name: primaryStatus?.name ?? null,
    membership_key: primaryMembership?.key ?? null,
    membership_name: primaryMembership?.name ?? null,
  }
}
