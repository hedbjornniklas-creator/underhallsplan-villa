export function formatFurnishingLevel(value: string): string {
  switch (value.trim()) {
    case 'fullt_moblerad': return 'fullt m\u00f6blerad'
    case 'delvis_moblerad': return 'delvis m\u00f6blerad'
    case 'omoblerad': return 'om\u00f6blerad'
    default: return value
  }
}
