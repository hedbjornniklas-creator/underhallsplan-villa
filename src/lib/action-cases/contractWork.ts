export const contractWorkFields = [
  ['title', 'Rubrik'], ['scope', 'Arbetets omfattning'], ['scopeConditions', 'Förutsättningar'],
  ['scopeExclusions', 'Ingår inte'], ['scopeAdvice', 'Avrådan'],
] as const

type WorkScope = { id: string; sourceItemId?: string; kind?: string; title: string; scope?: string | null;
  scopeConditions?: string; scopeExclusions?: string; scopeAdvice?: string }

export function sharedWorkScopeKey(items: readonly WorkScope[]): string {
  return JSON.stringify(items.filter(item => item.kind !== 'option')
    .map(item => [item.sourceItemId ?? item.id, ...contractWorkFields.map(([key]) => item[key] ?? '')])
    .sort((a, b) => a[0].localeCompare(b[0])))
}

export type ContractWorkPrice = {
  editable: boolean
  split: 'combined' | 'separate'
  amountOre: number | null
  labourOre: number | null
  materialOre: number | null
}

export type ContractWorkLink = {
  revision: number
  locked: boolean
  version: number | null
  documentId: string | null
  price: ContractWorkPrice
  differences: string[]
}

export function contractWorkPriceInput(value: unknown): Pick<ContractWorkPrice, 'amountOre' | 'labourOre' | 'materialOre'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CONTRACT_WORK_INVALID')
  const input = value as Record<string, unknown>
  const result = { amountOre: null, labourOre: null, materialOre: null } as Pick<ContractWorkPrice, 'amountOre' | 'labourOre' | 'materialOre'>
  for (const key of ['amountOre', 'labourOre', 'materialOre'] as const) {
    const amount = input[key]
    if (amount !== null && (!Number.isSafeInteger(amount) || Number(amount) < 0 || Number(amount) > 100_000_000_000)) throw new Error('CONTRACT_WORK_INVALID')
    result[key] = amount as number | null
  }
  return result
}
