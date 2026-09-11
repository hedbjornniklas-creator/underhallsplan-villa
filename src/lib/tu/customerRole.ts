export function normalizeTuOrdererRole(value: string | null | undefined) {
  const cleaned = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!cleaned) return null

  const folded = cleaned
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2013\u2014]/g, '-')
    .toLowerCase()

  if (/^teknisk utredning\s*-\s*(?:villa|lagenhet)$/.test(folded)) return null
  return cleaned
}
