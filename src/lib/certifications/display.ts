import type { InspectorCertificationListItem } from '@/lib/certifications/profileSummary'

export function formatCertificationDisplayLines(
  items: InspectorCertificationListItem[] | null | undefined
) {
  if (!Array.isArray(items) || items.length === 0) return []

  return items.map((item) => {
    const parts: string[] = [item.name]
    if (item.number_value) {
      parts.push(`Nummer: ${item.number_value}`)
    }
    if (item.valid_to) {
      parts.push(`Giltig till: ${item.valid_to}`)
    }
    return parts.join(' · ')
  })
}
