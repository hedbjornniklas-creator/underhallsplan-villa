export const contractWorkFields = [
  ['title', 'Rubrik'], ['scope', 'Arbetets omfattning'], ['scopeConditions', 'Förutsättningar'],
  ['scopeExclusions', 'Ingår inte'], ['scopeAdvice', 'Avrådan'],
] as const

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
