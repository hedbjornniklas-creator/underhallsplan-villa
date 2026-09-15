export type BuildingPurpose = {
  key: string
  source: 'boverket-andamalskatalogen'
  conceptNumber: string
  version: number
  uri: string
  label: string
  path: string[]
}
export type BuildingCategory = { key: string; label: string; is_active?: boolean; catalogue_entry?: BuildingPurpose | null }

export const BUILDING_PURPOSE_SOURCE = 'https://www.boverket.se/sv/om-boverket/oppna-data/api-tjanst-for-andamalskatalogen/'
const common = ['010101','010106','010404','010403','010402','010401','010102','010103','010104','010105']
// Search hints are app-owned, not official labels or automatic classifications.
const hints: Record<string, string> = {
  '010101': 'villa', '010106': 'attefall attefallshus gästhus gäststuga',
  '010401': 'förråd uthus friggebod attefall attefallshus',
  '010402': 'gästhus gäststuga friggebod attefall attefallshus',
}
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('sv').trim()

export function findBuildingPurposes(categories: BuildingCategory[], search: string) {
  const words = normalize(search).split(/\s+/).filter(Boolean)
  return categories.filter(row => row.catalogue_entry?.source === 'boverket-andamalskatalogen' && row.is_active !== false)
    .filter(row => words.every(word => normalize(row.catalogue_entry!.path.join(' ') + ' ' + row.catalogue_entry!.conceptNumber + ' ' + (hints[row.catalogue_entry!.conceptNumber] ?? '')).includes(word)))
    .sort((a, b) => {
      const rank = (row: BuildingCategory) => {
        const index = common.indexOf(row.catalogue_entry!.conceptNumber)
        return index < 0 ? common.length : index
      }
      return rank(a) - rank(b) || a.catalogue_entry!.conceptNumber.localeCompare(b.catalogue_entry!.conceptNumber)
    })
}

export function buildingCategoryLabel(categories: BuildingCategory[], key: string | null): string | null {
  if (!key) return null
  return categories.find(row => row.key === key)?.label ?? key
}
