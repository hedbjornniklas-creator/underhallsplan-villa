export type ScopeCode =
  | 'main_building'
  | 'outbuildings'
  | 'moisture_risk'
  | 'area'
  | 'radon'
  | 'mould'

const TOKEN_TO_CODE: Record<string, ScopeCode> = {
  main_building: 'main_building',
  outbuildings: 'outbuildings',
  moisture_risk: 'moisture_risk',
  area: 'area',
  radon: 'radon',
  mould: 'mould',
  'okulär besiktning av huvudbyggnaden': 'main_building',
  'besiktning av komplementbyggnader': 'outbuildings',
  'fuktmätning eller fuktindikering av riskkonstruktion': 'moisture_risk',
  'areamätning': 'area',
  'radonindikering': 'radon',
  'mögelprov': 'mould',
}

const DISPLAY_LABELS: Record<ScopeCode, string> = {
  main_building: 'En okulär besiktning av huvudbyggnaden',
  outbuildings: 'Besiktning av komplementbyggnader',
  moisture_risk: 'Fuktmätning eller fuktindikering av riskkonstruktion',
  area: 'Areamätning',
  radon: 'Radonindikering',
  mould: 'Mögelprov',
}

const normalizeTokens = (tokens: string[]) => {
  const codes: ScopeCode[] = []
  const unknown: string[] = []

  tokens.forEach((token) => {
    const normalized = token.trim().toLowerCase()
    if (!normalized) return
    const code = TOKEN_TO_CODE[normalized]
    if (code) {
      if (!codes.includes(code)) codes.push(code)
    } else {
      if (!unknown.includes(token.trim())) unknown.push(token.trim())
    }
  })

  return { codes, unknown }
}

export function parseScopeCodes(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
}

export function renderScopeText(scopeCodes: string[]): string {
  const { unknown } = normalizeTokens(scopeCodes)
  if (scopeCodes.length === 0 && unknown.length === 0) return '--'

  const lines = scopeCodes
    .map((token) => {
      const normalized = token.trim().toLowerCase()
      if (!normalized) return null
      const code = TOKEN_TO_CODE[normalized]
      if (!code) return token.trim()
      return DISPLAY_LABELS[code]
    })
    .filter((line): line is string => Boolean(line))

  return lines.length > 0 ? lines.join('\n') : '--'
}
